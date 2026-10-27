"""Synthetic software scenarios, never evidence of physical or live AI accuracy."""
from uuid import uuid4
import sqlite3
import pytest
from backend.consumer_routes import build_consumer_router
from backend.inspect_store import InspectionStore
from backend.tests.test_inspect import client, photo, template_input
from backend.tests.test_judge_access import make_app, settings, sign_in


def test_v11_database_migration_preserves_saved_setup_and_inspection(client):
    browser, store = client
    template = setup(browser)
    recorded = scan(browser, template, review(template, True)).json()
    with sqlite3.connect(store.path) as db:
        db.execute('DROP TABLE wizard_drafts')
        db.execute('PRAGMA user_version=3')
    upgraded = InspectionStore(store.path)
    assert upgraded.template(template['id']) == template
    assert upgraded.inspection(recorded['id']) == recorded
    with upgraded.connect() as db:
        assert db.execute('PRAGMA user_version').fetchone()[0] == 4
        assert db.execute('SELECT COUNT(*) FROM wizard_drafts').fetchone()[0] == 0


def setup(client):
    body=template_input().model_dump()
    body['objects'][0].update(id='phone',label='phone')
    response=client.post('/api/inspect/templates',json=body)
    assert response.status_code==201
    return response.json()


def review(template,moved=False,complete=True):
    objects=[{k:v for k,v in o.items() if k not in {'required','tolerance'}} for o in template['objects']]
    if moved:objects[0]['box']={**objects[0]['box'],'x':.35}
    return {'revision':1,'assignments':{o['id']:o['id'] for o in objects},'manual_objects':objects,
            'inventory_confirmed':complete,'confirmed_missing_ids':[],'ignored_detection_ids':[]}


def scan(client,t,reviewed,**changes):
    return client.post('/api/inspect/manual-scans',json={'template_id':t['id'],'template_revision':t['revision'],
        'image_url':photo('#aaaaaa'),'alignment':{'confirmed':True},'review':reviewed,**changes})


def test_manual_phone_move_and_fresh_verification_never_claim_automatic_success(client):
    browser,store=client;t=setup(browser)
    response=scan(browser,t,review(t,True));assert response.status_code==201,response.text
    moved=response.json()
    assert moved['analysis']['provider']=='human' and moved['analysis']['objects']==[]
    assert not moved['analysis']['live_request'] and moved['inference_wall_ms']==0
    assert not moved['automatic_result']['passed']
    assert moved['reviewed_result']['objects'][0]['status']=='misplaced'
    plan=browser.post(f"/api/inspect/scans/{moved['id']}/corrections",json={'revision':1}).json()['correction_plan']
    assert plan['status']=='ready' and [m['object_id'] for m in plan['movements']]==['phone']
    assert scan(browser,t,review(t),previous_inspection_id=moved['id']).status_code==422
    assert scan(browser,t,review(t),previous_inspection_id=moved['id'],image_url=t['reference_image_url']).status_code==422
    fresh=scan(browser,t,review(t),previous_inspection_id=moved['id'],image_url=photo('#bbbbbb'))
    assert fresh.status_code==201,fresh.text
    verified=fresh.json()
    assert verified['reviewed_result']['passed'] and verified['reviewed_result']['evidence_mode']=='human_assisted'
    assert not verified['automatic_result']['passed']
    assert InspectionStore(store.path).inspection(verified['id'])==verified


def test_uncertain_missing_extra_and_unaligned_manual_checks_withhold_corrections(client):
    browser,_=client;t=setup(browser)
    r=review(t);r['assignments'].pop('phone');r['manual_objects']=r['manual_objects'][1:]
    uncertain=scan(browser,t,r).json()
    assert uncertain['reviewed_result']['review_required'] and not uncertain['reviewed_result']['passed']
    assert browser.post(f"/api/inspect/scans/{uncertain['id']}/corrections",json={'revision':1}).json()['correction_plan']['status']=='blocked'
    r['assignments']['phone']=None;r['confirmed_missing_ids']=['phone']
    missing=scan(browser,t,r).json()
    assert missing['reviewed_result']['objects'][0]['status']=='confirmed_missing'
    assert not missing['reviewed_result']['passed']
    r=review(t);r['manual_objects'].append({'id':'extra','label':'keys','box':{'x':.5,'y':.5,'width':.1,'height':.1}})
    extra=scan(browser,t,r).json()
    assert extra['reviewed_result']['additional_objects'][0]['status']=='unexpected'
    assert not extra['reviewed_result']['passed']
    assert scan(browser,t,review(t),alignment={'confirmed':False}).status_code==422
    incomplete=scan(browser,t,review(t,complete=False)).json()
    assert not incomplete['reviewed_result']['passed']


def test_private_draft_survives_reload_conflicts_and_validates_photos(client):
    browser,store=client;identity=str(uuid4())
    state={'name':'Desk in progress','step':'setup','reference':{'image_url':photo(),'width':300,'height':200,'name':'desk.jpg'}}
    saved=browser.put(f'/api/inspect/drafts/{identity}',json={'revision':0,'state':state})
    assert saved.status_code==200,saved.text
    loaded=browser.get(f'/api/inspect/drafts/{identity}')
    assert loaded.headers['cache-control']=='no-store'
    assert loaded.json()['state']['reference']==state['reference']
    assert browser.get('/api/inspect/drafts').json()['drafts'][0]['name']=='Desk in progress'
    assert browser.put(f'/api/inspect/drafts/{identity}',json={'revision':0,'state':state}).status_code==409
    assert browser.put(f'/api/inspect/drafts/{identity}',json={'revision':1,'state':{**state,'step':'fake_success'}}).status_code==422
    invalid={**state,'reference':{**state['reference'],'image_url':'https://example.test/private.jpg'}}
    assert browser.put(f'/api/inspect/drafts/{identity}',json={'revision':1,'state':invalid}).status_code==422
    with InspectionStore(store.path).connect() as db:
        assert db.execute('SELECT COUNT(*) FROM wizard_drafts').fetchone()[0]==1
        assert db.execute('PRAGMA user_version').fetchone()[0]==4
    assert browser.delete(f'/api/inspect/drafts/{identity}').status_code==200
    assert browser.get(f'/api/inspect/drafts/{identity}').status_code==404


def test_judge_cannot_read_owner_drafts_or_submit_owner_manual_check(settings,tmp_path,monkeypatch):
    monkeypatch.setenv('WORLDOS_DATA_DIR',str(tmp_path))
    browser,auth=make_app(settings,tmp_path/'sessions.sqlite3');browser.app.include_router(build_consumer_router())
    assert browser.get('/api/inspect/drafts').status_code==401
    sign_in(browser);t=setup(browser);identity=str(uuid4())
    body={'revision':0,'state':{'name':'Private owner draft','template_id':t['id'],'step':'check'}}
    assert browser.put(f'/api/inspect/drafts/{identity}',json=body).status_code==200
    assert browser.put(f'/api/inspect/drafts/{identity}',json={**body,'revision':1},headers={'X-CSRF-Token':''}).status_code==403
    sign_in(browser,'judge')
    assert browser.get('/api/inspect/drafts').json()=={'drafts':[]}
    assert browser.get(f'/api/inspect/drafts/{identity}').status_code==404
    assert browser.put(f'/api/inspect/drafts/{identity}',json=body).status_code==404
    assert scan(browser,t,review(t)).status_code==404
    auth.store.close()
