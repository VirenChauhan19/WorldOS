"""Reproduce real physical inspection trials; --live explicitly authorizes inference."""
import argparse
import asyncio
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))

from dotenv import load_dotenv
from pydantic import BaseModel, ConfigDict, Field, StrictBool

from backend.ai_service import AIService
from backend.imaging import prepare_image
from backend.inspect_evaluation import score_inspection, summarize_inspections
from backend.inspect_models import Alignment, InspectionInput, InspectionReview, TemplateInput
from backend.inspect_routes import template_data
from backend.inspection import review_inspection, scan_workspace
from backend.models import SceneObject
from backend.providers import AISettings, ProviderError, ProviderHTTP

ROOT=Path(__file__).resolve().parents[1]
SCENARIOS=['correct_workspace','missing_object','misplaced_object','unexpected_object','multiple_misplaced',
           'duplicate_objects','protected_moved','different_camera_angle','partial_occlusion','failed_detection']


class Truth(BaseModel):
    model_config=ConfigDict(extra='forbid')
    physical_photographs:StrictBool
    independently_reviewed:StrictBool
    inventory_complete:StrictBool
    reviewed_by:str=Field(min_length=1)
    captured_at:str=Field(min_length=1)
    notes:str=Field(min_length=1)
    objects:list[SceneObject]=Field(max_length=24)
    issues:list[dict[str,str]]=Field(max_length=24)
    workspace_correct:StrictBool


def digest(value):
    return hashlib.sha256(value if isinstance(value,bytes) else json.dumps(value,sort_keys=True).encode()).hexdigest()


def read(path):return json.loads(path.read_text(encoding='utf-8-sig'))


def manifest_template():
    return {'schema_version':1,'fixture_type':'physical_inspection_pairs','cases':[
        {'id':name,'captured':False,'reference':f'{name}/reference.jpg','current':f'{name}/current.jpg',
         'template':f'{name}/template.json','truth':f'{name}/truth.json','recording':f'{name}/inference.json',
         'reviewed':None,'alignment':Alignment().model_dump(),'inventory_confirmed':False,'discover_unexpected':True,'extra_concepts':[]}
        for name in SCENARIOS]}


def load_cases(path):
    manifest=read(path)
    if manifest.get('schema_version')!=1 or manifest.get('fixture_type')!='physical_inspection_pairs':
        raise ValueError('Use physical_inspection_pairs schema version 1.')
    entries=manifest['cases'];pending=[];cases=[];seen=set()
    if len({e['id'] for e in entries})!=len(entries):raise ValueError('Duplicate scenario IDs.')
    for entry in entries:
        if entry.get('captured') is not True:pending.append(entry['id']);continue
        raw_ref=(path.parent/entry['reference']).read_bytes();raw_current=(path.parent/entry['current']).read_bytes()
        hashes={'reference_sha256':digest(raw_ref),'current_sha256':digest(raw_current)}
        if hashes['reference_sha256']==hashes['current_sha256'] or tuple(hashes.values()) in seen:
            raise ValueError('Use separately captured photographs and distinct photo pairs.')
        seen.add(tuple(hashes.values()))
        ref,cur=prepare_image(raw_ref),prepare_image(raw_current)
        truth=Truth.model_validate(read(path.parent/entry['truth']))
        if not (truth.physical_photographs and truth.independently_reviewed and truth.inventory_complete and truth.reviewed_by.strip()):
            raise ValueError('Physical photographs and independently reviewed complete truth are required.')
        exported=read(path.parent/entry['template'])
        data={k:v for k,v in exported.items() if k in TemplateInput.model_fields}
        data.update(reference_image_url=ref['image_url'],annotations_reviewed=True)
        validated=TemplateInput.model_validate(data)
        template={**template_data(validated),'id':exported.get('id',entry['id']),'revision':exported.get('revision') or 1}
        truth_ids=[o.id for o in truth.objects]
        if len(set(truth_ids))!=len(truth_ids):raise ValueError('Truth observation IDs must be unique.')
        refs={o['id'] for o in template['objects']}
        issues={(i['object_id'],i['kind']) for i in truth.issues}
        if any(kind not in {'missing','misplaced','protected_moved','unexpected'} or identity not in refs|set(truth_ids) for identity,kind in issues):
            raise ValueError('Unknown truth issue kind or object identity.')
        missing={identity for identity,kind in issues if kind=='missing'}
        if not {o['id'] for o in template['objects'] if o['required']} <= set(truth_ids)|missing or missing & set(truth_ids):
            raise ValueError('Locate each required identity in truth or explicitly grade it missing.')
        if truth.workspace_correct and issues:raise ValueError('Correct workspace truth cannot contain issues.')
        if type(entry['inventory_confirmed']) is not bool or type(entry['discover_unexpected']) is not bool:
            raise ValueError('Inventory/discovery declarations must be booleans.')
        request=InspectionInput(template_id=template['id'],template_revision=template['revision'],image_url=cur['image_url'],
            alignment=Alignment.model_validate(entry['alignment']),inventory_confirmed=entry['inventory_confirmed'],
            discover_unexpected=entry['discover_unexpected'],extra_concepts=entry.get('extra_concepts',[]))
        # Preserve hashes for older V0.5 recordings when new optional guided-
        # evaluation/reference-evidence fields are absent. Existing evidence
        # must not require a new billable scan solely because fields were added.
        hash_template={k:v for k,v in template.items() if k not in {'reference_analysis','reference_inference_wall_ms'} or v is not None}
        hash_request={k:v for k,v in request.model_dump().items() if k!='evaluation_capture_id' or v is not None}
        hashes.update(template_sha256=digest(hash_template),request_sha256=digest(hash_request))
        reviewed=InspectionReview.model_validate(read(path.parent/entry['reviewed'])) if entry.get('reviewed') else None
        cases.append((entry,template,truth,request,hashes,reviewed))
    return entries,cases,pending


async def evaluate(args):
    path=Path(args.manifest).resolve();entries,cases,pending=load_cases(path)
    # Validate every recording before scoring any; never turn malformed files into successful results.
    if args.recorded:
        for entry,_,_,_,hashes,_ in cases:
            recorded=read(path.parent/entry['recording'])
            if recorded.get('provenance')!='recorded_live_inspection' or recorded.get('hashes')!=hashes:
                raise ValueError('Recording provenance or input hashes differ. Rerun the actual inference.')
    service=None
    if args.live and cases:
        load_dotenv(ROOT/'.env');service=AIService(ProviderHTTP(AISettings.from_env()))
    rows=[];assisted=[];report_cases=[];latencies=[];correction_actions=0
    for entry,template,truth,request,hashes,reviewed in cases:
        result,error=None,None
        if args.live:
            try:result=await scan_workspace(template,request,service)
            except ProviderError as exc:error={'code':exc.code,'status':exc.status}
            except TimeoutError:error={'code':'timeout','status':504}
            except ValueError:error={'code':'alignment_or_input_review_required','status':422}
            recording={'provenance':'recorded_live_inspection','recorded_at':datetime.now(timezone.utc).isoformat(),'hashes':hashes,'result':result,'error':error}
            destination=path.parent/entry['recording'];destination.parent.mkdir(parents=True,exist_ok=True)
            # Do not duplicate photo data URLs in recordings; reconstruct inputs from hashes on replay.
            if result:
                recording['result']={k:v for k,v in result.items() if k not in {'template_snapshot','current_image_url','aligned_image'}}
                recording['result']['alignment_metadata']={k:v for k,v in result['aligned_image'].items() if k!='image_url'}
            destination.write_text(json.dumps(recording,indent=2),encoding='utf-8')
        else:
            recording=read(path.parent/entry['recording']);result,error=recording['result'],recording.get('error')
            if result:
                from backend.inspect_alignment import align_scene
                result={**result,'template_snapshot':template,'current_image_url':request.image_url,'aligned_image':align_scene(template,request.image_url,request.alignment)}
        truth_dict=truth.model_dump()
        automatic=score_inspection(template,truth_dict,result,result['automatic_result'] if result else None);rows.append(automatic)
        row={'id':entry['id'],'hashes':hashes,'reviewed_by':truth.reviewed_by,'captured_at':truth.captured_at,'error':error,'automatic':automatic,'human_assisted':None,
             'inference_wall_ms':result.get('inference_wall_ms') if result else None,'pipeline_ms':result.get('latency_ms') if result else None}
        if result:latencies.append(result['inference_wall_ms'])
        if reviewed and result:
            corrected=review_inspection(result,reviewed);row['human_assisted']=score_inspection(template,truth_dict,result,corrected);assisted.append(row['human_assisted'])
            actions=len(reviewed.assignments)+len(reviewed.manual_objects)+len(reviewed.ignored_detection_ids)
            correction_actions+=actions;row['human_review_actions']=actions
        report_cases.append(row)
    report={'version':'0.5.0','recorded_at':datetime.now(timezone.utc).isoformat(),'mode':'live' if args.live else 'recorded',
        'provenance_notice':'Physical capture and independent truth are author declarations. Hashes bind inputs, not provider authenticity. Test fixtures are not physical validation.',
        'measurement_status':'measured' if cases else 'unmeasured','scenario_count':len(entries),'captured_pairs':len(cases),'pending_scenarios':pending,
        'automatic_metrics':summarize_inspections(rows),'human_assisted_metrics':summarize_inspections(assisted),'human_assisted_trials':len(assisted),
        'human_review_actions':correction_actions,'mean_inference_wall_ms':sum(latencies)/len(latencies) if latencies else None,'latency_sample_count':len(latencies),
        'cases':report_cases}
    destination=Path(args.output);destination.parent.mkdir(parents=True,exist_ok=True);destination.write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps({k:report[k] for k in ('measurement_status','scenario_count','captured_pairs','human_assisted_trials','latency_sample_count')}))
    provider_errors=any(row['error'] and row['error']['code']!='alignment_or_input_review_required' for row in report_cases)
    return 1 if provider_errors or (args.require_complete and (len(cases)<10 or pending)) else 0


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--init');parser.add_argument('--manifest');parser.add_argument('--output',default='artifacts/inspect-evaluation.json');parser.add_argument('--require-complete',action='store_true')
    mode=parser.add_mutually_exclusive_group();mode.add_argument('--live',action='store_true');mode.add_argument('--recorded',action='store_true')
    args=parser.parse_args()
    if args.init:
        destination=Path(args.init)/'manifest.json';destination.parent.mkdir(parents=True,exist_ok=True)
        with destination.open('x',encoding='utf-8') as handle:json.dump(manifest_template(),handle,indent=2)
        print(f'Created {destination}; 10 pending physical scenarios. No measurements generated.');return 0
    if not args.manifest or not (args.live or args.recorded):parser.error('Use --init or --manifest with --live/--recorded.')
    return asyncio.run(evaluate(args))


if __name__=='__main__':
    try:sys.exit(main())
    except (ValueError,OSError,KeyError,TypeError,ProviderError):
        print('Invalid inspection benchmark input. Check photographs, reviewed references, truth, and hashes. No successful evaluation is claimed.',file=sys.stderr);sys.exit(2)
