"""Isolated synthetic software fixtures. Never physical benchmark evidence."""
import json
import sqlite3
from datetime import datetime, timedelta, timezone

import pytest

from backend.inspect_store import InspectionStore
from backend.inspection_trials import SCENARIOS, begin_attempt, get_capture
from backend.inspect_models import InspectionInput
from backend.main import app, get_ai_service
from backend.providers import ProviderError
from backend.tests.test_inspect import client, documented_service, photo, template_input, detections


def start(client):
    t = client.post('/api/inspect/templates', json=template_input().model_dump()).json()
    response = client.post('/api/inspect/evaluation/trials', json={"template_id":t["id"],"name":"SYNTHETIC UNIT TEST","scenario":"correct_workspace","operator":"Test fixture","reference_captured_at":"2026-10-26T12:00:00Z","physical_reference_confirmed":True})
    assert response.status_code == 201, response.text
    return t, response.json()


def capture_body(t, color="#818181", stage="inspection"):
    objects=[{**o.model_dump(),"id":r["id"]} for o,r in zip(detections(t),t["objects"])]
    return {"stage":stage,"image_url":photo(color),"alignment":{"confirmed":True},"captured_at":"2026-10-26T12:01:00Z","notes":"SYNTHETIC software test only","physical_photograph_confirmed":True,
            "truth":{"objects":objects,"issues":[],"workspace_correct":True,"inventory_complete":True,"independently_reviewed":True,"reviewed_by":"Test fixture"}}


def freeze(client, t, trial, **kwargs):
    response=client.post(f"/api/inspect/evaluation/trials/{trial['id']}/captures",json=capture_body(t,**kwargs))
    assert response.status_code==201,response.text
    return response.json()


def scan(client, t, capture, **kwargs):
    return client.post('/api/inspect/scans',json={"template_id":t["id"],"template_revision":t["revision"],"image_url":capture["image_url"],"alignment":capture["alignment"],"discover_unexpected":False,"evaluation_capture_id":capture["id"],**kwargs})


def test_empty_report_has_null_denominators_and_all_ten_pending(client):
    c,_=client
    report=c.get('/api/inspect/evaluation/report').json()
    assert report["measurement_status"] == "unmeasured"
    assert report["pending_scenarios"] == SCENARIOS
    assert report["metrics"]["inspection"]["automatic"]["issue_precision"] == {"numerator":0,"denominator":0,"value":None}
    assert report["task_success"]["automatic"]["over_started_trials"]["value"] is None


def test_capture_requires_independent_complete_truth_and_distinct_photos(client):
    c,_=client;t,trial=start(c)
    for mutation in (lambda b:b.update(physical_photograph_confirmed=False),lambda b:b["truth"].update(independently_reviewed=False),lambda b:b["truth"].update(objects=[]),lambda b:b.update(image_url=t["reference_image_url"]),lambda b:b["truth"].update(workspace_correct=False)):
        body=capture_body(t);mutation(body)
        assert c.post(f"/api/inspect/evaluation/trials/{trial['id']}/captures",json=body).status_code==422
    trial=freeze(c,t,trial)
    assert c.post(f"/api/inspect/evaluation/trials/{trial['id']}/captures",json=capture_body(t,color='blue')).status_code==409
    assert c.delete(f"/api/inspect/templates/{t['id']}").status_code==409


def test_full_trial_keeps_automatic_assisted_and_verification_separate(client):
    c,store=client;t,trial=start(c);calls=[];app.dependency_overrides[get_ai_service]=lambda:documented_service(t,calls)
    trial=freeze(c,t,trial);capture=trial["captures"][0]
    result=scan(c,t,capture);assert result.status_code==201,result.text
    initial=result.json();assert not initial["automatic_result"]["passed"] and initial["automatic_result"]["evidence_mode"]=="automatic"
    count=len(calls)
    assert scan(c,t,capture).json()["id"]==initial["id"] and len(calls)==count
    reviewed=c.post(f"/api/inspect/scans/{initial['id']}/review",json={"inventory_confirmed":True,"revision":1}).json()
    assert reviewed["reviewed_result"]["passed"] and reviewed["reviewed_result"]["evidence_mode"]=="human_assisted"
    assert not reviewed["automatic_result"]["passed"]
    assert len(reviewed["review_history"])==1
    plan=c.post(f"/api/inspect/scans/{initial['id']}/corrections",json={"revision":2}).json()
    assert plan["correction_plan"]["status"]=="already_clear"
    trial=freeze(c,t,trial,color='#828282',stage='corrected');corrected=next(x for x in trial["captures"] if x["stage"]=='corrected')
    final=scan(c,t,corrected).json();assert final["previous_inspection_id"]==initial["id"]
    c.post(f"/api/inspect/scans/{final['id']}/review",json={"inventory_confirmed":True,"revision":1})
    report=c.get('/api/inspect/evaluation/report').json()
    assert report["measurement_status"]=="preliminary" and report["attempt_count"]==2
    assert report["task_success"]["automatic"]["over_started_trials"]["numerator"]==0
    assert report["task_success"]["human_assisted"]["over_started_trials"]["numerator"]==1
    assert report["human_review_actions"]==2 and len(report["latency_samples"])==2
    export=c.get(f"/api/inspect/evaluation/trials/{trial['id']}/export")
    assert 'data:image' in export.text and 'synthetic-key' not in export.text
    persisted=InspectionStore(store.path)
    assert get_capture(persisted,capture["id"])["record"]["correction_plan"]["status"]=="already_clear"
    assert get_capture(persisted,corrected["id"])["record"]["reviewed_result"]["passed"]


def test_api_failure_is_recorded_can_retry_and_does_not_count_success(client):
    c,store=client;t,trial=start(c);trial=freeze(c,t,trial);capture=trial["captures"][0]
    class Failing:
        async def analyze(self,*args):raise ProviderError("Provider timed out.",504,code="timeout")
    app.dependency_overrides[get_ai_service]=lambda:Failing()
    response=scan(c,t,capture);assert response.status_code==504,response.text
    saved=get_capture(store,capture["id"])
    assert saved["attempts"][0]["status"]=="failed" and saved["attempts"][0]["pipeline_ms"]>=0 and saved["record"] is None
    report=c.get('/api/inspect/evaluation/report').json()
    assert report["attempted_trials"]==1 and report["failed_or_interrupted_attempts"]==1
    assert report["task_success"]["human_assisted"]["over_started_trials"]["denominator"]==1
    app.dependency_overrides[get_ai_service]=lambda:documented_service(t,[])
    assert scan(c,t,capture).status_code==201
    assert len(get_capture(store,capture["id"])["attempts"])==2


def test_alignment_abstention_is_saved_without_provider_calls(client):
    c,store=client;t,trial=start(c);calls=[];app.dependency_overrides[get_ai_service]=lambda:documented_service(t,calls)
    body=capture_body(t);body["alignment"]={"confirmed":False}
    trial=c.post(f"/api/inspect/evaluation/trials/{trial['id']}/captures",json=body).json();capture=trial["captures"][0]
    assert scan(c,t,capture).status_code==422
    assert not calls and get_capture(store,capture["id"])["attempts"][0]["error"]["status"]==422


def test_pinned_reference_and_input_guards_and_duplicate_lease(client):
    c,store=client;t,trial=start(c);trial=freeze(c,t,trial);capture=trial["captures"][0]
    calls=[];app.dependency_overrides[get_ai_service]=lambda:documented_service(t,calls)
    assert scan(c,t,capture,inventory_confirmed=True).status_code==422
    assert scan(c,t,capture,image_url=photo('green')).status_code==422
    assert scan(c,t,capture,alignment={"confirmed":True,"tx":.1}).status_code==422
    request=InspectionInput(template_id=t["id"],template_revision=1,image_url=capture["image_url"],alignment=capture["alignment"],discover_unexpected=False,evaluation_capture_id=capture["id"])
    begin_attempt(store,capture["id"],request)
    assert scan(c,t,capture).status_code==409 and not calls
    running=c.get('/api/inspect/evaluation/report').json()
    assert running['attempted_trials']==1 and running['running_attempts']==1
    assert running['task_success']['automatic']['over_started_trials']['value']==0
    stale=get_capture(store,capture["id"]);stale["attempts"][0]["started_at"]=(datetime.now(timezone.utc)-timedelta(seconds=160)).isoformat()
    with store.connect() as db:db.execute("UPDATE evaluation_captures SET data=? WHERE id=?",(json.dumps(stale),capture["id"]))
    updated=c.put(f"/api/inspect/templates/{t['id']}",json={**template_input().model_dump(),"revision":1,"name":"Edited template"})
    assert updated.status_code==200
    response=scan(c,t,capture);assert response.status_code==201,response.text
    assert response.json()["template_revision"]==1
    assert get_capture(store,capture["id"])["attempts"][0]["status"]=="interrupted"


def test_missing_truth_counts_recall_abstention_and_assisted_confirmation(client):
    c,_=client;t,trial=start(c);body=capture_body(t);body['truth']['objects']=body['truth']['objects'][1:]
    body['truth'].update(issues=[{"object_id":"book","kind":"missing"}],workspace_correct=False)
    trial=c.post(f"/api/inspect/evaluation/trials/{trial['id']}/captures",json=body).json()
    app.dependency_overrides[get_ai_service]=lambda:documented_service(t,[],missing=True)
    r=scan(c,t,trial['captures'][0]).json()
    c.post(f"/api/inspect/scans/{r['id']}/review",json={"revision":1,"inventory_confirmed":True,"assignments":{"book":None},"confirmed_missing_ids":["book"]})
    report=c.get('/api/inspect/evaluation/report').json();metrics=report['metrics']['inspection']
    assert metrics['automatic']['issue_recall']=={"numerator":0,"denominator":1,"value":0}
    assert metrics['automatic']['false_alarm_count']==0
    assert metrics['human_assisted']['issue_recall']=={"numerator":1,"denominator":1,"value":1}


def test_migrates_v2_and_preserves_templates_and_records(tmp_path):
    path=tmp_path/'old.sqlite3';store=InspectionStore(path)
    from backend.inspect_routes import template_data
    t=store.save_template(template_data(template_input()));record=store.save_inspection({"template_id":t['id'],"fixture":True})
    with sqlite3.connect(path) as db:
        db.execute('DROP TABLE evaluation_captures');db.execute('DROP TABLE evaluation_trials');db.execute('PRAGMA user_version=2')
    upgraded=InspectionStore(path)
    assert upgraded.template(t['id'])==t and upgraded.inspection(record['id'])==record
    with upgraded.connect() as db:assert db.execute('PRAGMA user_version').fetchone()[0]==3


def test_reference_inference_is_retained_separately_from_template_corrections(client):
    c,_=client
    body=template_input().model_dump();body['reference_analysis']={"objects":[o.model_dump() for o in detections()],"concepts":["book","cup"],"summary":"SYNTHETIC","message":"Review","warnings":[],"provider":"meta","model":"sam-3.1"}
    body['reference_inference_wall_ms']=123
    body['objects'][0]['label']='Corrected label'
    result=c.post('/api/inspect/templates',json=body);assert result.status_code==201,result.text
    t=result.json();assert t['reference_analysis']['objects'][0]['label']=='book' and t['objects'][0]['label']=='Corrected label'
    assert c.get(f"/api/inspect/templates/{t['id']}").json()['reference_inference_wall_ms']==123


def test_realistic_jpeg_bytes_are_not_changed_after_labeling(client):
    # Textured synthetic data exercises lossy JPEG re-encoding, unlike flat fixtures.
    from PIL import Image
    import numpy as np
    from backend.inspect_alignment import encode
    from backend.imaging import image_from_data_url
    c,_=client;t,trial=start(c);body=capture_body(t)
    body['image_url']=encode(Image.fromarray(np.random.default_rng(81).integers(0,255,(200,300,3),dtype=np.uint8)))['image_url']
    assert image_from_data_url(body['image_url'])['image_url'] != body['image_url']
    response=c.post(f"/api/inspect/evaluation/trials/{trial['id']}/captures",json=body)
    assert response.status_code==201,response.text
    capture=response.json()['captures'][0]
    assert capture['image_url']==body['image_url']
    app.dependency_overrides[get_ai_service]=lambda:documented_service(t,[])
    assert scan(c,t,capture,image_url=body['image_url']).status_code==201
