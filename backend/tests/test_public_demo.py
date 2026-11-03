"""No-passphrase browser access, isolation and persisted spending limits."""
from dataclasses import replace
import json
import os
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.demo_cleanup import cleanup_demo_spaces
from backend.inspect_routes import build_inspect_router
from backend.inspect_store import get_inspection_store
from backend.request_limits import RequestLimitsMiddleware
from backend.security import SecuritySettings, SessionAuth, password_hash
from backend.session_store import fingerprint
from backend.tests.test_inspect import documented_service, template, template_input

PASSWORD = 'synthetic owner passphrase only'


@pytest.fixture(scope='module')
def settings():
    return SecuritySettings('public', password_hash(PASSWORD), ('https://testserver',), ('testserver',), public_demo=True)


def make_app(settings, path, clock=lambda:1000):
    auth = SessionAuth(settings, clock, session_path=path)
    app = FastAPI()
    app.add_middleware(RequestLimitsMiddleware, demo_limits=auth.demo_limits)
    app.middleware('http')(auth.middleware)
    app.include_router(auth.router())
    async def run(work): return await work
    app.include_router(build_inspect_router(lambda:documented_service(template(), []), run))
    @app.post('/api/ai/reason')
    @app.post('/api/ai/live')
    def reason(): return {'result':'synthetic'}
    @app.post('/api/ai/room/jobs/{identity}/cancel')
    def cancel(identity:str): return {'cancelled':identity}
    @app.get('/api/admin/backups/latest')
    def backup(): return {'owner_only':True}
    return app, auth


def join(client):
    response = client.post('/api/auth/demo', headers={'Origin':'https://testserver'})
    assert response.status_code == 200, response.text
    client.headers.update({'Origin':'https://testserver', 'X-CSRF-Token':response.json()['csrf_token']})
    return response


def test_no_password_required_but_owner_and_other_visitors_stay_private(settings, tmp_path, monkeypatch):
    monkeypatch.setenv('WORLDOS_DATA_DIR', str(tmp_path))
    app, auth = make_app(settings, tmp_path/'auth.sqlite3')
    first, second, owner = [TestClient(app, base_url='https://testserver') for _ in range(3)]
    assert first.get('/api/auth/status').json()['demo_enabled'] is True
    assert first.post('/api/ai/reason').headers['X-WorldOS-Error-Code'] == 'demo_available'
    assert 'X-WorldOS-Error-Code' not in first.get('/api/admin/backups/latest').headers
    response = join(first)
    assert response.json()['access'] == 'guest' and 'access_token' not in response.json()
    assert all(flag in response.headers['set-cookie'] for flag in ('HttpOnly','Secure','SameSite=strict','Max-Age=7200'))
    cookie = first.cookies.get(auth.cookie_name)
    assert join(first).json()['access'] == 'guest'
    assert first.cookies.get(auth.cookie_name) == cookie
    saved = first.post('/api/inspect/templates', json=template_input().model_dump()).json()
    join(second)
    assert second.get('/api/inspect/templates').json() == {'templates':[]}
    assert second.get('/api/inspect/templates/'+saved['id']).status_code == 404
    assert second.delete('/api/inspect/templates/'+saved['id']).status_code == 404
    assert first.get('/api/admin/backups/latest').status_code == 403
    assert first.get('/openapi.json').status_code == 403
    assert first.post('/api/ai/connection-test').status_code == 403
    assert first.get('/api/auth/status?access=owner', headers={'X-WorldOS-Role':'owner'}).json()['access']=='guest'
    assert first.post('/api/ai/live').status_code == 200
    login = owner.post('/api/auth/login', json={'password':PASSWORD,'mode':'cookie'}, headers={'Origin':'https://testserver'})
    assert login.status_code == 200
    assert join(owner).json()['access'] == 'owner'
    assert owner.get('/api/inspect/templates').json() == {'templates':[]}
    assert owner.get('/api/admin/backups/latest').status_code == 200
    auth.store.close()


def test_origin_csrf_expiry_and_disable(settings, tmp_path):
    now=[1000]
    app, auth = make_app(settings, tmp_path/'auth.sqlite3', lambda:now[0])
    client=TestClient(app, base_url='https://testserver')
    assert client.post('/api/auth/demo').status_code == 403
    assert client.post('/api/auth/demo',headers={'Origin':'https://evil.example'}).status_code == 403
    join(client)
    csrf=client.headers.pop('X-CSRF-Token')
    assert client.post('/api/ai/reason').status_code == 403
    client.headers['X-CSRF-Token']=csrf
    assert client.post('/api/ai/reason').status_code == 200
    now[0] += 7201
    assert client.get('/api/auth/status').json()['authenticated'] is False
    assert client.post('/api/ai/reason').status_code == 401
    auth.store.close()
    app, auth = make_app(replace(settings,public_demo=False), tmp_path/'auth.sqlite3')
    disabled=TestClient(app, base_url='https://testserver');disabled.cookies.update(client.cookies)
    assert disabled.post('/api/ai/reason').status_code == 401
    assert disabled.post('/api/auth/demo',headers={'Origin':'https://testserver'}).status_code == 404
    auth.store.close()


def test_limits_survive_restart_new_sessions_and_preserve_reads_cancel_logout(settings,tmp_path):
    path=tmp_path/'auth.sqlite3'
    app,auth=make_app(settings,path)
    client=TestClient(app,base_url='https://testserver');join(client)
    for _ in range(12): assert client.post('/api/ai/reason').status_code == 200
    assert client.post('/api/ai/reason').status_code == 429
    assert client.get('/api/auth/status').status_code == 200
    assert client.post('/api/ai/room/jobs/fixture/cancel').status_code == 200
    auth.store.close()
    app,auth=make_app(settings,path)
    restarted=TestClient(app,base_url='https://testserver');restarted.cookies.update(client.cookies);join(restarted)
    assert restarted.post('/api/ai/reason').status_code == 429
    assert restarted.post('/api/auth/logout').status_code == 200
    assert restarted.get('/api/auth/status').json()['authenticated'] is False
    # The per-address daily budget also survives replacement sessions.
    for _ in range(4):
        client=TestClient(app,base_url='https://testserver');join(client)
        for _ in range(12): assert client.post('/api/ai/reason').status_code == 200
    client=TestClient(app,base_url='https://testserver');join(client)
    assert client.post('/api/ai/reason').status_code == 429
    another=TestClient(app,base_url='https://testserver')
    assert another.post('/api/auth/demo',headers={'Origin':'https://testserver'}).status_code==429
    auth.store.close()


def test_accepted_room_reconnect_does_not_spend_more_demo_actions(settings,tmp_path,monkeypatch):
    monkeypatch.setenv('WORLDOS_DATA_DIR',str(tmp_path))
    app,auth=make_app(settings,tmp_path/'auth.sqlite3')
    client=TestClient(app,base_url='https://testserver');join(client)
    visitor=fingerprint(client.cookies.get(auth.cookie_name))
    identity=str(uuid4())
    store=get_inspection_store(guest=visitor)
    with store.connect() as db:
        db.execute('INSERT INTO room_jobs VALUES (?,?,?,?,?,?,?)',(identity,'survey','fixture','completed','{}','',1000))
    scope={'state':{'auth_fingerprint':visitor},'path':'/api/ai/room/jobs','client':('testclient',1)}
    for _ in range(13): assert auth.demo_limits(scope,True,json.dumps({'id':identity}).encode())
    for _ in range(12): assert auth.demo_limits(scope,True,json.dumps({'id':str(uuid4())}).encode())
    assert not auth.demo_limits(scope,True,b'{}')
    for invalid in (b'[]', b'null', b'{"id":123}', b'{"id":null}', b'{"id":"bad"}'):
        assert not auth.demo_limits(scope,True,invalid)
    auth.store.close()


def test_cleanup_only_removes_old_demo_stores(tmp_path):
    old=tmp_path/'public-demo'/('a'*64);old.mkdir(parents=True)
    (old/'worldos.sqlite3').write_text('expired')
    os.utime(old/'worldos.sqlite3',(1,1))
    recent=tmp_path/'public-demo'/('b'*64);recent.mkdir();(recent/'worldos.sqlite3').write_text('active')
    owner=tmp_path/'worldos.sqlite3';owner.write_text('owner')
    unexpected=tmp_path/'public-demo'/'do-not-delete';unexpected.mkdir()
    cleanup_demo_spaces(tmp_path,now=90000)
    assert not old.exists() and recent.exists() and owner.exists() and unexpected.exists()


@pytest.mark.parametrize('guest',['../owner','a'*63,'G'*64])
def test_guest_store_rejects_non_fingerprints(guest):
    with pytest.raises(ValueError): get_inspection_store(guest=guest)
