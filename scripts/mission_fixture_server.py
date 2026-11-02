"""Local-only full HTTP task fixture. No real provider calls or private workspace."""
import argparse
import json
import os
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--port',type=int,default=8011)
args=parser.parse_args()
os.environ.update(WORLDOS_DEPLOYMENT='local',WORLDOS_AUTH_PASSWORD_HASH='',WORLDOS_JUDGE_PASSWORD_HASH='',
                  MODEL_API_KEY='',BASETEN_API_KEY='',WORLDOS_DATA_DIR=str(ROOT/'artifacts/mission-http-fixture'),
                  WORLDOS_ALLOWED_HOSTS='127.0.0.1,localhost',WORLDOS_CORS_ORIGINS='http://127.0.0.1:5173')

import httpx
import uvicorn
from backend.main import app,get_ai_service
from backend.ai_service import AIService
from backend.providers import AISettings,ProviderHTTP

recorded=json.loads((ROOT/'docs/v18-live-recognition.json').read_text(encoding='utf-8'))
phone=next(obj for obj in recorded['objects'] if obj['label']=='smartphone')


def handler(request):
    body=json.loads(request.content)
    schema=body['response_format']['json_schema']['name']
    context=json.loads(body['messages'][1]['content'][0]['text'])
    if schema=='MissionPlan':
        value={'title':'Ready for a focused session','outcome':'Give your main task a clear place to start, using what you already have.',
               'steps':[{'title':'Choose a spot for your phone','instruction':'Choose a clear stable spot outside your central working area, then place your phone there.',
                         'why':'This leaves your central area available for the work you chose.','success_check':'Your phone is away from the area you want to use.',
                         'object_ids':[phone['id']],'move_ids':[phone['id']]},
                        {'title':'Check your working area','instruction':'Set out the things you need for this session and check that you can use them comfortably.',
                         'why':'A practical setup should support the task you actually want to do.','success_check':'You can start your chosen task without another setup step.',
                         'object_ids':[],'move_ids':[]}], 'limitation':'Check physical clearance and your own comfort; the photo does not measure either.'}
    else:
        assert schema=='MissionAssessment'
        value={'comparable':True,'summary':'Fixture review: the phone appears away from the working area. Personal comfort needs your own check.',
               'steps':[{'step_id':step['id'],'status':'looks_done' if index==0 else 'uncertain','evidence':'Synthetic browser fixture evidence; this is not a real physical comparison.'} for index,step in enumerate(context['steps'])],
               'next_step':'Check that you can begin your task, then save the setup if you like it.'}
    return httpx.Response(200,json={'choices':[{'finish_reason':'stop','message':{'content':json.dumps(value)}}]})


service=AIService(ProviderHTTP(AISettings(meta_key='synthetic-key',sam_provider='meta'),httpx.MockTransport(handler)))
async def analyze(_request):
    return {**{key:recorded[key] for key in ('objects','concepts','summary','total_objects','truncated','unmatched_concepts')},
            'warnings':[],'message':'Synthetic HTTP fixture','provider':'fixture','model':'SAM fixture','live_request':False}
service.analyze=analyze
app.dependency_overrides[get_ai_service]=lambda:service
uvicorn.run(app,host='127.0.0.1',port=args.port,access_log=False)
