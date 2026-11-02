"""Task workflow tests use synthetic photos and provider output, never real accuracy claims."""
import json
from unittest.mock import AsyncMock
from uuid import uuid4

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.main import app, get_ai_service, run_ai
from backend.inspect_store import InspectionStore
from backend.missions import build_mission_router, load
from backend.providers import ProviderError
from backend.tests.test_ai import chat, service
from backend.tests.test_inspect import photo
from backend.tests.test_judge_access import make_app, settings, sign_in


OBJECTS = [{'id':'phone','label':'phone','box':{'x':.2,'y':.3,'width':.1,'height':.2},'locked':False},
           {'id':'cup','label':'cup','box':{'x':.7,'y':.3,'width':.1,'height':.1},'locked':False}]


def plan_response():
    return {'title':'Ready to focus','outcome':'A clear working area and a dedicated place for your phone.',
            'steps':[{'title':'Choose a spot for your phone','instruction':'Check a stable clear spot away from your working area, then place your phone there.',
                      'why':'This leaves the central area available for your task.','success_check':'Your chosen work area is free of the phone.',
                      'object_ids':['phone'],'move_ids':['phone']}], 'limitation':'Check the destination yourself; the image does not establish physical clearance.'}


@pytest.fixture
def setup(tmp_path, monkeypatch):
    monkeypatch.setenv('WORLDOS_DATA_DIR',str(tmp_path))
    control={'bad_ids':False,'move_cup':False,'no_ids':False,'comparable':True,'fail':False,'bad_review':False,'calls':[]}
    def handler(req):
        body=json.loads(req.content);control['calls'].append(body)
        if control['fail']:return httpx.Response(503,json={'error':{'code':'server_error'}})
        schema=body['response_format']['json_schema']['name']
        context=json.loads(body['messages'][1]['content'][0]['text'])
        if schema=='MissionPlan':
            result=plan_response()
            if control['bad_ids']:result['steps'][0]['object_ids']=['invented']
            if control['move_cup']:result['steps'][0].update(object_ids=['cup'],move_ids=['cup'])
            if control['no_ids']:result['steps'][0].update(object_ids=[],move_ids=[])
            assert body['messages'][1]['content'][1]['image_url']['url'].startswith('data:image/jpeg;')
            return httpx.Response(200,json=chat(result))
        assert schema=='MissionAssessment'
        result={'comparable':control['comparable'],'summary':'The phone is away from the work area in the second view.',
                'steps':[{'step_id':step['id'],'status':'looks_done','evidence':'The phone is visible outside the central area.'} for step in context['steps']],
                'next_step':'Check whether the work area is comfortable for your task.'}
        if control['bad_review']:result['steps'][0]['step_id']='invented'
        return httpx.Response(200,json=chat(result))
    ai=service(handler)
    ai.analyze=AsyncMock(return_value={'objects':OBJECTS,'concepts':['phone','cup'],'summary':'A phone and a cup.','model':'SAM fixture','live_request':False})
    app.dependency_overrides[get_ai_service]=lambda:ai
    with TestClient(app) as client:
        yield client,ai,control,InspectionStore(tmp_path/'worldos.sqlite3')
    app.dependency_overrides.pop(get_ai_service,None)


def create(client,**changes):
    body={'id':str(uuid4()),'goal':'Get ready to study','constraints':'Keep my cup in place.','image_url':photo(),**changes}
    result=client.post('/api/missions',json=body);assert result.status_code==201,result.text
    return result.json(),body


def action(client,task,operation,**changes):
    return client.post(f"/api/missions/{task['id']}/{operation}",json={'revision':task['revision'],**changes})


def planned(client):
    task,_=create(client)
    task=action(client,task,'observe').json()
    response=action(client,task,'plan',protected_ids=['cup']);assert response.status_code==200,response.text
    return response.json()


def test_complete_task_persists_progress_reviews_and_reusable_routine(setup):
    client,ai,control,store=setup
    task=planned(client);step=task['plan']['steps'][0]
    assert task['plan']['live_request'] is False
    marked=action(client,task,'progress',step_id=step['id'],done=True).json()
    assert marked['review'] is None and marked['status']=='guiding'
    assert action(client,task,'progress',step_id=step['id'],done=True).status_code==409
    assert load(InspectionStore(store.path),task['id'])['completed_ids']==[step['id']]
    checked=action(client,marked,'check',image_url=photo('#ffffff'));assert checked.status_code==200,checked.text
    checked=checked.json();assert checked['review']['source']=='photo_assessment'
    assert checked['completed_ids']==[step['id']] and checked['status']=='reviewed'
    saved=action(client,checked,'routine',name='Study setup',preferred_setup_confirmed=True)
    assert saved.status_code==201,saved.text
    routine=saved.json()['routine'];task=saved.json()['mission']
    assert routine['source']=='user_selected_reference'
    repeated=action(client,task,'routine',name='Study setup',preferred_setup_confirmed=True).json()
    assert repeated['routine']['id']==routine['id']
    resumed,_=create(client,routine_id=routine['id'],image_url=photo('#bbbbbb'))
    assert resumed['reference']['image']==checked['after'] and resumed['completed_ids']==[]
    listed=client.get('/api/missions');assert listed.headers['cache-control']=='no-store'
    assert 'image_url' not in listed.text and len(listed.json()['routines'])==1
    assert client.delete(f"/api/missions/{task['id']}").status_code==200
    assert client.get(f"/api/missions/routines/{routine['id']}").status_code==200


def test_creation_is_idempotent_and_images_are_validated_before_provider_requests(setup):
    client,ai,control,_=setup
    task,body=create(client)
    assert client.post('/api/missions',json=body).json()==task
    assert client.post('/api/missions',json={**body,'goal':'Different goal'}).status_code==409
    assert client.post('/api/missions',json={**body,'id':str(uuid4()),'image_url':'https://invalid.test/private'}).status_code==422
    assert control['calls']==[] and ai.analyze.await_count==0


@pytest.mark.parametrize('problem',['bad_ids','move_cup'])
def test_plan_rejects_unknown_or_protected_movement_and_keeps_capture(setup,problem):
    client,ai,control,_=setup;control[problem]=True
    task,_=create(client);task=action(client,task,'observe').json()
    response=action(client,task,'plan',protected_ids=['cup'])
    assert response.status_code==502 and response.headers['X-WorldOS-Error-Code']=='malformed_response'
    fresh=client.get(f"/api/missions/{task['id']}").json()
    assert fresh['plan'] is None and fresh['working_image'] and fresh['analysis']


def test_unknown_protected_id_fails_before_billing_and_fallback_can_use_photo(setup):
    client,ai,control,_=setup;task,_=create(client)
    assert action(client,task,'plan',protected_ids=['invented']).status_code==422
    assert not control['calls']
    # No detections means provider instructions must not manufacture an object reference.
    assert action(client,task,'plan').status_code==502


def test_photo_only_plan_can_succeed_without_manufacturing_object_ids(setup):
    client,ai,control,_=setup;control['no_ids']=True
    task,_=create(client)
    result=action(client,task,'plan',feedback='Keep the visible cup where it is.')
    assert result.status_code==200,result.text
    assert result.json()['plan']['steps'][0]['object_ids']==[]
    assert ai.analyze.await_count==0
    context=json.loads(control['calls'][-1]['messages'][1]['content'][0]['text'])
    assert context['objects']==[] and context['constraints']=='Keep my cup in place.'


def test_routine_restores_keep_preferences_against_new_capture_ids(setup):
    client,ai,control,_=setup;task=planned(client)
    checked=action(client,task,'check',image_url=photo('#ffffff')).json()
    routine=action(client,checked,'routine',name='Study setup',preferred_setup_confirmed=True).json()['routine']
    reset,_=create(client,routine_id=routine['id'])
    ai.analyze.return_value={'objects':[{**obj,'id':'new-'+obj['id']} for obj in OBJECTS]}
    observed=action(client,reset,'observe').json()
    assert observed['protected_ids']==['new-cup']
    assert observed['keep_preferences']==['cup']


def test_routine_backup_can_be_restored_after_removal_without_inference(setup):
    client,ai,control,_=setup;task=planned(client)
    checked=action(client,task,'check',image_url=photo('#ffffff')).json()
    original=action(client,checked,'routine',name='Study setup',preferred_setup_confirmed=True).json()['routine']
    client.delete(f"/api/missions/routines/{original['id']}")
    count=len(control['calls'])
    payload={key:original[key] for key in ('name','goal','constraints','keep_preferences')}
    payload['image_url']=original['image']['image_url']
    restored=client.post('/api/missions/routines/import',json=payload)
    assert restored.status_code==201,restored.text
    value=restored.json()
    assert value['id']!=original['id'] and value['keep_preferences']==['cup']
    assert value['image']==original['image'] and value['source']=='user_selected_reference'
    assert client.post('/api/missions/routines/import',json={**payload,'image_url':'https://invalid.test/private'}).status_code==422
    assert len(control['calls'])==count


def test_freshness_and_review_reference_validation_leave_progress_honest(setup):
    client,ai,control,_=setup;task=planned(client)
    count=len(control['calls'])
    assert action(client,task,'check',image_url=task['working_image']['image_url']).status_code==422
    assert len(control['calls'])==count
    control['bad_review']=True
    assert action(client,task,'check',image_url=photo('#ffffff')).status_code==502
    fresh=client.get(f"/api/missions/{task['id']}").json()
    assert fresh['after'] and fresh['review'] is None and fresh['completed_ids']==[]


def test_noncomparable_review_cannot_mark_steps_as_looks_done(setup):
    client,ai,control,_=setup;control['comparable']=False
    task=planned(client);checked=action(client,task,'check',image_url=photo('#ffffff')).json()
    assert not checked['review']['comparable']
    assert {step['status'] for step in checked['review']['steps']}=={'uncertain'}
    assert checked['completed_ids']==[]


def test_adaptation_saves_new_capture_and_preserves_reported_history_on_failure(setup):
    client,ai,control,_=setup;task=planned(client)
    task=action(client,task,'progress',step_id=task['plan']['steps'][0]['id'],done=True).json()
    assert action(client,task,'plan').status_code==422
    ai.analyze.side_effect=ProviderError('Temporary provider problem.',503,'network_error')
    response=action(client,task,'observe',image_url=photo('#cccccc'));assert response.status_code==503
    fresh=client.get(f"/api/missions/{task['id']}").json()
    assert fresh['initial_image']!=fresh['working_image'] and len(fresh['history'])==1
    assert fresh['plan'] is None and fresh['completed_ids']==[] and fresh['keep_preferences']==['cup']


def test_progress_ids_and_routine_confirmation_cannot_be_forged(setup):
    client,*_=setup;task=planned(client)
    assert action(client,task,'progress',step_id='invented',done=True).status_code==422
    assert action(client,task,'progress',step_id=task['plan']['steps'][0]['id'],done='true').status_code==422
    assert action(client,task,'routine',name='Pretend result',preferred_setup_confirmed=True).status_code==422
    task=action(client,task,'check',image_url=photo('#ffffff')).json()
    assert action(client,task,'routine',name='Study setup',preferred_setup_confirmed=False).status_code==422


def test_mission_workspace_isolation_csrf_and_inference_rate_limit(settings,tmp_path,monkeypatch):
    monkeypatch.setenv('WORLDOS_DATA_DIR',str(tmp_path))
    client,auth=make_app(settings,tmp_path/'auth.sqlite3',limited=True)
    ai=service(lambda _:httpx.Response(200,json=chat(plan_response())))
    ai.analyze=AsyncMock(return_value={'objects':OBJECTS})
    client.app.include_router(build_mission_router(lambda:ai,run_ai))
    assert client.get('/api/missions').status_code==401
    sign_in(client);owner,_=create(client)
    assert client.post('/api/missions',json={'id':str(uuid4()),'goal':'Study','image_url':photo()},headers={'X-CSRF-Token':''}).status_code==403
    sign_in(client,'judge')
    assert client.get('/api/missions').json()=={'missions':[],'routines':[]}
    assert client.get(f"/api/missions/{owner['id']}").status_code==404
    assert action(client,owner,'observe').status_code==404
    task,_=create(client)
    assert action(client,task,'observe').status_code==200
    # The earlier isolated lookup still counts as an AI attempt; no third call can fan out.
    assert action(client,task,'plan').status_code==429
    assert ai.analyze.await_count==1
