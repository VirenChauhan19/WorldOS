"""Synthetic access-control and inspection regressions; no physical accuracy claims."""
from contextlib import closing
from dataclasses import replace
import sqlite3
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from backend.inspect_routes import build_inspect_router
from backend.request_limits import RequestLimitsMiddleware
from backend.security import SecuritySettings, SessionAuth, password_hash
from backend.session_store import SessionStore, fingerprint
from backend.tests.test_inspect import documented_service, template, template_input, photo

OWNER = 'synthetic owner passphrase'
JUDGE = 'synthetic judge passphrase'


@pytest.fixture(scope='module')
def settings():
    return SecuritySettings('public',password_hash(OWNER),('https://testserver',),('testserver',),
                            password_hash(JUDGE),'1970-01-01T02:00:00Z')


def make_app(settings,path,clock=lambda:1000,limited=False):
    auth = SessionAuth(settings,clock,session_path=path)
    app = FastAPI()
    if limited: app.add_middleware(RequestLimitsMiddleware,production=True,ai_per_minute=2)
    app.middleware('http')(auth.middleware)
    app.include_router(auth.router())
    async def run_ai(task): return await task
    app.include_router(build_inspect_router(lambda:documented_service(template(),[]),run_ai))
    @app.get('/api/admin/backups/latest')
    def backup(): return {'owner_only':True}
    @app.post('/api/ai/connection-test')
    def connection(): return {'owner_only':True}
    @app.post('/api/ai/reason')
    def reason(): return {'fixture':True}
    return TestClient(app,base_url='https://testserver'), auth


def sign_in(client,access='owner',password=None):
    response = client.post('/api/auth/login',json={'password':password or (JUDGE if access=='judge' else OWNER),'mode':'cookie','access':access},headers={'Origin':'https://testserver'})
    assert response.status_code == 200
    client.headers.update({'Origin':'https://testserver','X-CSRF-Token':response.json()['csrf_token']})
    return response.json()


def test_role_isolation_full_inspection_and_persisted_judge_session(settings,tmp_path,monkeypatch):
    monkeypatch.setenv('WORLDOS_DATA_DIR',str(tmp_path))
    client,auth = make_app(settings,tmp_path/'auth.sqlite3')
    sign_in(client)
    owner_cookie=client.cookies.get('__Host-worldos_session')
    owned=client.post('/api/inspect/templates',json=template_input().model_dump()).json()
    response=sign_in(client,'judge')
    assert response['expires_in']==6200 and response['access']=='judge'
    judge_cookie=client.cookies.get('__Host-worldos_session')
    assert client.get('/api/inspect/templates').json()=={'templates':[]}
    for method in ('get','delete'):
        assert getattr(client,method)('/api/inspect/templates/'+owned['id']).status_code==404
    assert client.get('/api/admin/backups/latest').status_code==403
    assert client.post('/api/ai/connection-test').status_code==403
    assert client.get('/openapi.json').status_code==403
    assert client.get('/api/future-admin-action').status_code==403
    saved=client.post('/api/inspect/templates',json=template_input().model_dump()).json()
    scan={'template_id':saved['id'],'template_revision':1,'image_url':photo(),
          'alignment':{'confirmed':True},'inventory_confirmed':True,'discover_unexpected':False}
    detected=client.post('/api/inspect/scans',json=scan)
    assert detected.status_code==201
    record=detected.json()
    observed={**record['analysis']['objects'][0]}
    observed['box']={**observed['box'],'x':.25}
    reviewed=client.post(f"/api/inspect/scans/{record['id']}/review",json={
        'assignments':{'book':observed['id']},'manual_objects':[observed],'inventory_confirmed':True,'revision':1})
    assert reviewed.status_code==200 and not reviewed.json()['reviewed_result']['passed']
    correction=client.post(f"/api/inspect/scans/{record['id']}/corrections",json={'revision':2})
    assert correction.status_code==200 and correction.json()['correction_plan']['status']=='ready'
    verified=client.post('/api/inspect/scans',json={**scan,'previous_inspection_id':record['id']})
    assert verified.status_code==201 and verified.json()['automatic_result']['passed']
    auth.store.close()
    restarted,new_auth=make_app(settings,tmp_path/'auth.sqlite3')
    restarted.headers['Cookie']='__Host-worldos_session='+judge_cookie
    assert restarted.get('/api/auth/status').json()['access']=='judge'
    persisted=restarted.get('/api/inspect/templates/'+saved['id'])
    assert persisted.status_code==200 and persisted.json()['reference_image_url']==saved['reference_image_url']
    restarted.headers['Cookie']='__Host-worldos_session='+owner_cookie
    assert restarted.get('/api/auth/status').json()['access']=='owner'
    assert restarted.get('/api/inspect/templates/'+owned['id']).status_code==200
    assert restarted.get('/api/inspect/templates/'+saved['id']).status_code==404
    assert restarted.get('/api/inspect/scans/'+record['id']).status_code==404
    assert restarted.get('/api/admin/backups/latest').status_code==200
    new_auth.store.close()


def test_judge_expiry_revocation_rotation_and_role_escalation(settings,tmp_path):
    now=[1000];path=tmp_path/'auth.sqlite3'
    client,auth=make_app(settings,path,lambda:now[0])
    response=client.post('/api/auth/login',json={'password':JUDGE,'access':'owner'})
    assert response.status_code==401
    sign_in(client,'judge');cookie=client.cookies.get('__Host-worldos_session')
    assert client.get('/api/auth/status?access=owner',headers={'X-WorldOS-Role':'owner'}).json()['access']=='judge'
    now[0]=7200
    assert client.get('/api/auth/status').json()['judge_enabled'] is False
    assert client.post('/api/ai/reason').status_code==401
    assert client.post('/api/auth/login',json={'password':JUDGE,'access':'judge'}).status_code==401
    now[0]=1000;auth.store.close()
    for updated in (replace(settings,judge_password=''),replace(settings,judge_password=password_hash('rotated synthetic judge passphrase'))):
        client,new_auth=make_app(updated,path)
        client.headers['Cookie']='__Host-worldos_session='+cookie
        assert client.post('/api/ai/reason').status_code==401
        new_auth.store.close()


def test_judge_logout_does_not_revoke_owner_and_limit_survives_relogin(settings,tmp_path):
    client,auth=make_app(settings,tmp_path/'auth.sqlite3',limited=True)
    sign_in(client);owner_cookie=client.cookies.get('__Host-worldos_session')
    sign_in(client,'judge')
    assert client.post('/api/ai/reason').status_code==200
    assert client.post('/api/auth/logout').status_code==200
    assert client.post('/api/ai/reason').status_code==401
    sign_in(client,'judge')
    assert client.post('/api/ai/reason').status_code==200
    assert client.post('/api/ai/reason').status_code==429
    client.headers['Cookie']='__Host-worldos_session='+owner_cookie
    status=client.get('/api/auth/status').json()
    assert status['access']=='owner'
    client.headers['X-CSRF-Token']=status['csrf_token']
    assert client.post('/api/ai/reason').status_code==200
    auth.store.close()


@pytest.mark.parametrize('change',[
    {'judge_expires_at':''}, {'judge_expires_at':'not-a-date'}, {'judge_expires_at':'2026-11-04T12:00:00'},
    {'judge_password':'invalid'}, {'encoded_password':''},
])
def test_invalid_judge_configuration_fails_closed(settings,change):
    with pytest.raises(ValueError): replace(settings,**change).validate()


def test_same_owner_and_judge_passphrase_is_refused(settings,tmp_path):
    client,auth=make_app(replace(settings,judge_password=password_hash(OWNER)),tmp_path/'auth.sqlite3')
    assert client.post('/api/auth/login',json={'password':OWNER,'access':'judge'}).status_code==409
    auth.store.close()


def test_v1_session_migration_preserves_owner_and_never_promotes_judge(settings,tmp_path):
    path=tmp_path/'auth.sqlite3'
    with closing(sqlite3.connect(path)) as db:
        db.execute('CREATE TABLE sessions (fingerprint TEXT PRIMARY KEY, expires REAL NOT NULL, credential_id TEXT NOT NULL)')
        db.execute('INSERT INTO sessions VALUES (?,?,?)',(fingerprint('old-owner-session'),9000,fingerprint(settings.encoded_password)))
        db.execute('PRAGMA user_version = 1');db.commit()
    store=SessionStore(path)
    assert store.valid('old-owner-session',fingerprint(settings.encoded_password),1000)
    assert store.create('judge-session',7000,fingerprint(settings.judge_password),1000,'judge')
    assert store.valid('old-owner-session',fingerprint(settings.encoded_password),1000)
    assert not store.valid('judge-session',fingerprint(settings.encoded_password),1000)
    assert store.db.execute('PRAGMA user_version').fetchone()[0]==2
    store.close()
