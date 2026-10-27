"""Synthetic metric/runner regression tests, excluded from physical reports."""
import argparse
import asyncio
import json

import pytest
from PIL import Image

from backend.inspect_evaluation import score_inspection, summarize_inspections
from backend.inspect_models import InspectionReview
from backend.inspection import review_inspection
from backend.tests.test_inspect import detections, documented_service, facts, record, template, template_input
from scripts import evaluate_inspections as runner


def truth():
    return {'physical_photographs':True,'independently_reviewed':True,'inventory_complete':True,
            'reviewed_by':'Synthetic regression fixture','captured_at':'2026-10-26','notes':'Synthetic test only, not physical evidence.',
            'objects':[{**o.model_dump(),'id':o.id.removeprefix('d-')} for o in detections()], 'issues':[],'workspace_correct':True}


def test_empty_inspection_metrics_are_unmeasured():
    result=summarize_inspections([])
    assert result['issue_precision']=={'numerator':0,'denominator':0,'value':None}
    assert result['detection_coverage']['value'] is None
    assert len(runner.manifest_template()['cases'])==10
    assert all(not c['captured'] for c in runner.manifest_template()['cases'])


def test_detection_identity_and_goal_denominators():
    row=score_inspection(template(),truth(),record(),facts())
    result=summarize_inspections([row])
    assert result['detection_coverage']=={'numerator':2,'denominator':2,'value':1}
    assert result['identity_correct_over_present_reference_objects']['denominator']==2
    assert result['verification_success_on_correct_workspaces']['value']==1
    assert result['issue_precision']['value'] is None


def test_failed_detection_is_review_abstention_not_false_missing_alarm():
    current=record([detections()[1]])
    row=score_inspection(template(),truth(),current,current['automatic_result'])
    result=summarize_inspections([row])
    assert result['false_alarm_count']==0
    assert result['detection_coverage']['value']==.5
    assert result['verification_decision_coverage']['numerator']==0
    assert result['human_review_required']['value']==1


def test_issue_precision_recall_and_human_assisted_missing_are_separate():
    current=record([detections()[1]])
    reference=truth();reference.update(objects=[reference['objects'][1]],issues=[{'object_id':'book','kind':'missing'}],workspace_correct=False)
    automatic=score_inspection(template(),reference,current,current['automatic_result'])
    review=InspectionReview(assignments={'book':None},confirmed_missing_ids=['book'],inventory_confirmed=True,revision=1)
    corrected=review_inspection(current,review)
    assisted=score_inspection(template(),reference,current,corrected)
    assert summarize_inspections([automatic])['issue_recall']['value']==0
    assert summarize_inspections([assisted])['issue_recall']['value']==1
    assert current['automatic_result']['objects'][0]['status']=='suspected_missing'


def test_false_alarms_and_false_acceptances_are_counted():
    current=record();current['automatic_result']['objects'][0]['status']='misplaced'
    row=score_inspection(template(),truth(),current,current['automatic_result'])
    assert summarize_inspections([row])['false_alarm_count']==1
    reference=truth();reference['workspace_correct']=False
    row=score_inspection(template(),reference,record(),facts())
    assert summarize_inspections([row])['false_acceptance_over_incorrect_workspaces']['value']==1


def captured_fixture(tmp_path):
    case={**runner.manifest_template()['cases'][0],'captured':True,'reference':'reference.png','current':'current.png','template':'template.json','truth':'truth.json','recording':'inference.json',
          'alignment':{'confirmed':True},'inventory_confirmed':True,'discover_unexpected':False}
    Image.new('RGB',(300,200),'#808080').save(tmp_path/'reference.png')
    Image.new('RGB',(300,200),'#818181').save(tmp_path/'current.png')
    (tmp_path/'template.json').write_text(template_input().model_dump_json())
    (tmp_path/'truth.json').write_text(json.dumps(truth()))
    path=tmp_path/'manifest.json';path.write_text(json.dumps({**runner.manifest_template(),'cases':[case]}))
    return path


def test_live_fixture_recording_replays_without_inference_or_photo_data(tmp_path,monkeypatch):
    path=captured_fixture(tmp_path);calls=[]
    monkeypatch.setattr(runner,'AIService',lambda _:documented_service(template(),calls))
    args=argparse.Namespace(manifest=str(path),output=str(tmp_path/'report.json'),live=True,recorded=False,require_complete=False)
    assert asyncio.run(runner.evaluate(args))==0
    report=json.loads((tmp_path/'report.json').read_text());assert report['latency_sample_count']==1
    assert 'data:image' not in (tmp_path/'inference.json').read_text()
    # Added optional fields must not invalidate pre-guided V0.5 recordings.
    _,loaded,_=runner.load_cases(path)
    _,pinned,_,request,hashes,_=loaded[0]
    old_template={k:v for k,v in pinned.items() if k not in {'reference_analysis','reference_inference_wall_ms'}}
    old_request={k:v for k,v in request.model_dump().items() if k!='evaluation_capture_id'}
    assert hashes['template_sha256']==runner.digest(old_template)
    assert hashes['request_sha256']==runner.digest(old_request)
    count=len(calls);args.live=False;args.recorded=True
    assert asyncio.run(runner.evaluate(args))==0
    assert len(calls)==count
    replay=json.loads((tmp_path/'report.json').read_text())
    assert replay['automatic_metrics']==report['automatic_metrics']


def test_changed_photograph_invalidates_recorded_inputs(tmp_path,monkeypatch):
    path=captured_fixture(tmp_path)
    monkeypatch.setattr(runner,'AIService',lambda _:documented_service(template(),[]))
    args=argparse.Namespace(manifest=str(path),output=str(tmp_path/'report.json'),live=True,recorded=False,require_complete=False)
    asyncio.run(runner.evaluate(args))
    Image.new('RGB',(300,200),'red').save(tmp_path/'current.png')
    args.live=False;args.recorded=True
    with pytest.raises(ValueError,match='hashes'):asyncio.run(runner.evaluate(args))


def test_pending_scenarios_fail_completion_gate_without_fabricating_metrics(tmp_path):
    path=tmp_path/'manifest.json';path.write_text(json.dumps(runner.manifest_template()))
    args=argparse.Namespace(manifest=str(path),output=str(tmp_path/'report.json'),live=False,recorded=True,require_complete=True)
    assert asyncio.run(runner.evaluate(args))==1
    report=json.loads((tmp_path/'report.json').read_text())
    assert report['measurement_status']=='unmeasured' and report['captured_pairs']==0
