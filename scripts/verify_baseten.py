"""Explicit paid reasoning checks. Uses authored text facts, NOT physical photographs."""
import argparse
import asyncio
from dataclasses import replace
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
from time import perf_counter

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from dotenv import load_dotenv
from fastapi.encoders import jsonable_encoder
from backend.ai_service import AIService
from backend.connection import ConnectionRegistry, ConnectionTester
from backend.inspection import explain_inspection
from backend.models import ReasonRequest
from backend.providers import AISettings, ProviderError, ProviderHTTP


async def verify(output):
    load_dotenv(Path(__file__).resolve().parents[1]/'.env')
    configured=AISettings.from_env()
    # These checks must demonstrate Baseten itself, never a fallback success.
    settings=replace(configured,muse_provider='baseten',meta_key='')
    service=AIService(ProviderHTTP(settings));registry=ConnectionRegistry()
    report={'version':'0.6.0','checked_at':datetime.now(timezone.utc).isoformat(),'provider':'baseten','model':settings.baseten_muse_model,
            'input_scope':'Authored text goal and inspection facts. No real photographs, SAM inference, physical actions, or physical accuracy claims.', 'checks':{}}
    started=perf_counter()
    connection=(await ConnectionTester(service.http,registry).test('muse'))['integrations']['muse']
    state=connection['last_test']
    report['checks']['connection']={'passed':state['live_request_succeeded'],'status':state['status'],'wall_ms':round((perf_counter()-started)*1000),
        'inference_latency_ms':state['inference_latency_ms'],'usage':state['usage']}
    objects=[{'id':'book','label':'book','box':{'x':.4,'y':.4,'width':.15,'height':.2},'locked':False},
             {'id':'cup','label':'cup','box':{'x':.8,'y':.1,'width':.1,'height':.1},'locked':True}]
    if state['live_request_succeeded']:
        request=ReasonRequest(goal='Clear the selected target area. Keep the cup in place.',objects=objects,target={'x':.3,'y':.3,'width':.4,'height':.4})
        for name,operation in [('goal_interpretation',lambda:service.reason(request)),('inspection_explanation',lambda:explain_inspection({
            'template_snapshot':{'name':'Authored workshop example','description':'Text-only integration test; not a physical inspection.'},'reviewed_result':None,
            'automatic_result':{'status':'issues_found','objects':[{'object_id':'book','label':'book','status':'misplaced','source':'human_confirmed','expected_box':{'x':.1,'y':.1,'width':.15,'height':.2}},
                {'object_id':'cup','label':'cup','status':'correct','protected':True,'source':'human_confirmed'}],'additional_objects':[],'issues':[]}},service))]:
            started=perf_counter()
            try:
                value=jsonable_encoder(await operation())
                if name=='goal_interpretation':
                    assert value['constraints']['protected_object_ids']==['cup'] and not value['constraints']['needs_clarification'] and not value['constraints']['unsupported_requirements']
                assert value['provider']=='baseten' and value['model']==settings.baseten_muse_model and value.get('live_request') is True
                report['checks'][name]={'passed':True,'wall_ms':round((perf_counter()-started)*1000),'result':value}
            except ProviderError as error:
                report['checks'][name]={'passed':False,'code':error.code,'status':error.status,'wall_ms':round((perf_counter()-started)*1000)}
            except (AssertionError,KeyError,TypeError):
                report['checks'][name]={'passed':False,'code':'semantic_validation_failed','wall_ms':round((perf_counter()-started)*1000)}
    encoded=json.dumps(report,indent=2)
    if any(secret and secret in encoded for secret in (configured.meta_key,configured.baseten_key)):
        raise RuntimeError('Refusing to write a report containing a credential.')
    destination=Path(output);destination.parent.mkdir(parents=True,exist_ok=True);destination.write_text(encoded,encoding='utf-8')
    print(json.dumps({name:{k:v for k,v in check.items() if k!='result'} for name,check in report['checks'].items()}))
    return 0 if len(report['checks'])==3 and all(c['passed'] for c in report['checks'].values()) else 1


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--live',action='store_true',help='Authorize three small, potentially billable Baseten requests.')
    parser.add_argument('--output',default='artifacts/baseten-live.json')
    args=parser.parse_args()
    if not args.live:parser.error('Use --live to explicitly authorize provider requests.')
    try:sys.exit(asyncio.run(verify(args.output)))
    except (ProviderError,ValueError,OSError,RuntimeError):
        print('Baseten verification could not complete. Check backend settings/network; no successful inference is claimed.',file=sys.stderr);sys.exit(2)
