"""Production-mode contracts with synthetic credentials/data; no live AI calls."""
import asyncio
from contextlib import closing
import json
import sqlite3
import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from backend.backups import backup_database, scheduled_backup
from backend.inspect_store import InspectionStore
from backend.launch_render import configure_render
from backend.request_limits import RequestLimitsMiddleware
from backend.security import SecuritySettings, SessionAuth, password_hash

PASSWORD='synthetic production test passphrase'


@pytest.fixture(scope='module')
def encoded(): return password_hash(PASSWORD)


def private_app(encoded,path,clock=lambda:1000):
    auth=SessionAuth(SecuritySettings('public',encoded,('https://testserver',),('testserver',)),clock,session_path=path)
    app=FastAPI();app.middleware('http')(auth.middleware);app.include_router(auth.router())
    @app.get('/api/private')
    def private(): return {'private':True}
    @app.post('/api/private')
    def write(): return {'saved':True}
    return TestClient(app,base_url='https://testserver'),auth


def test_cookie_flags_csrf_reload_and_restart_persistence(encoded,tmp_path):
    path=tmp_path/'auth.sqlite3';client,auth=private_app(encoded,path)
    response=client.post('/api/auth/login',json={'password':PASSWORD,'mode':'cookie'},headers={'Origin':'https://testserver'})
    assert response.status_code==200
    assert 'access_token' not in response.json()
    cookie=response.headers['set-cookie']
    assert all(value in cookie for value in ('__Host-worldos_session=','HttpOnly','Secure','SameSite=strict','Max-Age=28800','Path=/'))
    assert 'Domain=' not in cookie
    csrf=response.json()['csrf_token'];raw=client.cookies.get('__Host-worldos_session')
    auth.store.close()
    assert raw.encode() not in path.read_bytes() and PASSWORD.encode() not in path.read_bytes()
    restarted,auth2=private_app(encoded,path)
    restarted.cookies.update(client.cookies)
    status=restarted.get('/api/auth/status')
    assert status.json()['authenticated'] is True and status.json()['csrf_token']==csrf
    assert restarted.get('/api/private').status_code==200
    assert restarted.post('/api/private',headers={'Origin':'https://testserver'}).status_code==403
    assert restarted.post('/api/private',headers={'Origin':'https://evil.example','X-CSRF-Token':csrf}).status_code==403
    assert restarted.post('/api/private',headers={'Origin':'https://testserver','X-CSRF-Token':csrf}).status_code==200
    assert restarted.post('/api/auth/logout',headers={'Origin':'https://testserver','X-CSRF-Token':csrf}).status_code==200
    assert restarted.get('/api/private').status_code==401
    # Revocation persists; a copied old browser cookie cannot restore the session.
    restarted.cookies.update(client.cookies)
    assert restarted.get('/api/private').status_code==401
    auth2.store.close()


def test_cookie_login_rejects_cross_origin_and_expired_or_rotated_credentials(encoded,tmp_path):
    now=[1000];path=tmp_path/'auth.sqlite3';client,auth=private_app(encoded,path,lambda:now[0])
    assert client.post('/api/auth/login',json={'password':PASSWORD,'mode':'cookie'}).status_code==403
    assert client.post('/api/auth/login',json={'password':PASSWORD,'mode':'cookie'},headers={'Origin':'https://evil.example'}).status_code==403
    response=client.post('/api/auth/login',json={'password':PASSWORD,'mode':'cookie'},headers={'Origin':'https://testserver'})
    assert response.status_code==200
    now[0]+=28801
    assert client.get('/api/private').status_code==401
    now[0]=1001
    assert client.get('/api/private').status_code==200
    auth.store.close()
    rotated,new_auth=private_app(password_hash('different synthetic passphrase'),path)
    rotated.cookies.update(client.cookies)
    assert rotated.get('/api/private').status_code==401
    new_auth.store.close()


def test_auth_blocks_upload_without_reading_body(encoded,tmp_path):
    client,auth=private_app(encoded,tmp_path/'auth.sqlite3')
    # This body exceeds the limit and is deliberately unauthenticated: no parsing.
    response=client.post('/api/private',content='x',headers={'Content-Length':'999999999'})
    assert response.status_code==401
    assert client.get('/app').status_code==401 and client.get('/inspect/private').status_code==401
    auth.store.close()


def test_request_limits_chunked_lengths_rate_limit_and_recovery():
    clock=[0];app=FastAPI()
    app.add_middleware(RequestLimitsMiddleware,max_bytes=10,production=True,clock=lambda:clock[0],ai_per_minute=2)
    @app.post('/api/ai/analyze')
    async def analyze(request:Request): return {'size':len(await request.body())}
    with TestClient(app) as client:
        assert client.post('/api/ai/analyze',content='x'*11).status_code==413
        assert client.post('/api/ai/analyze',content='x',headers={'Content-Length':'bad'}).status_code==400
        assert client.post('/api/ai/analyze',content='x').status_code==200
        assert client.post('/api/ai/analyze',content='x').status_code==200
        limited=client.post('/api/ai/analyze',content='x')
        assert limited.status_code==429 and limited.headers['retry-after']=='60'
        clock[0]=61
        assert client.post('/api/ai/analyze',content='x').status_code==200
    async def chunks():
        responses=[];body=[{'type':'http.request','body':b'x'*6,'more_body':True},{'type':'http.request','body':b'x'*6,'more_body':False}]
        async def inner(*_): pytest.fail('Oversized body reached the application')
        async def receive(): return body.pop(0)
        async def send(value): responses.append(value)
        limiter=RequestLimitsMiddleware(inner,max_bytes=10)
        await limiter({'type':'http','path':'/api/analyze','method':'POST','headers':[]},receive,send)
        assert responses[0]['status']==413
    asyncio.run(chunks())


def test_concurrent_request_cap_releases_after_error():
    async def run():
        release=asyncio.Event();started=asyncio.Event();count=[0]
        async def inner(_scope,_receive,_send):
            count[0]+=1
            if count[0]==2: started.set()
            await release.wait()
            raise RuntimeError('synthetic request failure')
        async def receive(): return {'type':'http.request','body':b'','more_body':False}
        async def discard(_): pass
        limiter=RequestLimitsMiddleware(inner,production=True)
        scope={'type':'http','path':'/api/analyze','method':'POST','headers':[]}
        tasks=[asyncio.create_task(limiter(scope,receive,discard)) for _ in range(2)]
        await started.wait();response=[]
        async def capture(value): response.append(value)
        await limiter(scope,receive,capture)
        assert response[0]['status']==429
        release.set();await asyncio.gather(*tasks,return_exceptions=True)
        assert limiter.active_writes==0
    asyncio.run(run())


def test_backup_restore_embedded_photos_and_retention(tmp_path):
    source=tmp_path/'data';store=InspectionStore(source/'worldos.sqlite3')
    saved=store.save_template({'name':'SYNTHETIC backup test','reference_image_url':'data:image/png;base64,SYNTHETIC','objects':[]})
    backup=backup_database(store.path,tmp_path/'copy.sqlite3')
    with pytest.raises(ValueError): backup_database(store.path,backup)
    restored=backup_database(backup,tmp_path/'restored'/'worldos.sqlite3')
    assert InspectionStore(restored).template(saved['id'])==saved
    for _ in range(4): scheduled_backup(source,retain=2)
    assert len(list((source/'backups').glob('worldos-*.sqlite3')))==2
    metadata=json.loads((source/'backups/latest.json').read_text())
    with closing(sqlite3.connect(source/'backups'/metadata['file'])) as db:
        assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
        assert not db.execute("SELECT name FROM sqlite_master WHERE name='sessions'").fetchall()
    assert not list((source/'backups').glob('*.partial-*'))


def test_restore_rejects_non_workspace_databases(tmp_path):
    source=tmp_path/'wrong.sqlite3'
    with closing(sqlite3.connect(source)) as db: db.execute('CREATE TABLE unrelated (id INT)');db.commit()
    with pytest.raises(ValueError,match='workspace database'):backup_database(source,tmp_path/'restored.sqlite3')
    assert not (tmp_path/'restored.sqlite3').exists()


@pytest.mark.parametrize('value',['http://example.com','https://localhost','https://127.0.0.1','https://10.0.0.1','https://host.invalid','https://user:secret@example.com','https://example.com/path','https://example.com?secret=value'])
def test_public_verification_rejects_nonpublic_or_credential_urls(value):
    from scripts.verify_deployment import origin
    with pytest.raises(ValueError):origin(value)


def test_render_configuration_is_exact_and_fails_closed(encoded):
    env={'RENDER':'true','RENDER_EXTERNAL_HOSTNAME':'actual-name.onrender.com','WORLDOS_AUTH_PASSWORD_HASH':encoded,
         'WORLDOS_CORS_ORIGINS':'*','WORLDOS_DEPLOYMENT':'local','MODEL_API_KEY':'synthetic-meta-secret'}
    configure_render(env)
    assert env['WORLDOS_DEPLOYMENT']=='public' and env['WORLDOS_DATA_DIR']=='/var/data/worldos'
    assert env['WORLDOS_ALLOWED_HOSTS']=='actual-name.onrender.com' and '*' not in env['WORLDOS_CORS_ORIGINS']
    assert env['MODEL_API_KEY']=='synthetic-meta-secret'
    restored={**env,'WORLDOS_DATA_DIR':'/var/data/worldos-restored'};configure_render(restored)
    assert restored['WORLDOS_DATA_DIR']=='/var/data/worldos-restored'
    for changes in ({'RENDER':'false'},{'RENDER_EXTERNAL_HOSTNAME':'attacker.invalid'},{'WORLDOS_AUTH_PASSWORD_HASH':''},{'WORLDOS_PUBLIC_URL':'http://unsafe.example'},{'WORLDOS_DATA_DIR':'/tmp/worldos'},{'WORLDOS_DATA_DIR':'/var/data/../worldos'}):
        with pytest.raises(ValueError): configure_render({**env,**changes})


def test_production_health_is_minimal_and_has_no_model_calls(monkeypatch):
    import backend.main as main
    monkeypatch.setattr(main,'storage_ready',lambda:True)
    with TestClient(main.app) as client:
        response=client.get('/healthz')
        assert response.status_code==200 and response.json()=={'status':'ok'}
        assert response.headers['cache-control']=='no-store'
        def failed(): raise OSError('sensitive-internal-path')
        monkeypatch.setattr(main,'storage_ready',failed)
        response=client.get('/healthz')
        assert response.status_code==503 and 'sensitive-internal-path' not in response.text


def test_render_free_configuration_and_security(encoded):
    env={'RENDER':'true','RENDER_EXTERNAL_HOSTNAME':'free-worldos.onrender.com',
         'WORLDOS_AUTH_PASSWORD_HASH':encoded,'WORLDOS_STORAGE_MODE':'ephemeral',
         'MODEL_API_KEY':'synthetic-meta','BASETEN_API_KEY':'synthetic-baseten'}
    configure_render(env)
    assert env['WORLDOS_DATA_DIR']=='/tmp/worldos'
    assert env['WORLDOS_DEPLOYMENT']=='public'
    assert env['WORLDOS_ALLOWED_HOSTS']=='free-worldos.onrender.com'
    assert env['MODEL_API_KEY']=='synthetic-meta' and env['BASETEN_API_KEY']=='synthetic-baseten'
    for changes in ({'WORLDOS_STORAGE_MODE':'typo'},{'WORLDOS_DATA_DIR':'/var/data/worldos'},
                    {'WORLDOS_DATA_DIR':'/tmp/../worldos'},{'WORLDOS_DATA_DIR':'/tmp/unrelated'},
                    {'WORLDOS_AUTH_PASSWORD_HASH':''},{'RENDER':'false'}):
        with pytest.raises(ValueError):configure_render({**env,**changes})


def test_free_storage_starts_without_mount_and_paid_storage_still_requires_it(tmp_path,monkeypatch,caplog):
    from pathlib import Path
    from backend import launch_render
    monkeypatch.setattr(launch_render.os,'getuid',lambda:10001,raising=False)
    monkeypatch.setattr(launch_render.os,'umask',lambda _:None)
    monkeypatch.setattr(Path,'is_mount',lambda _:False)
    directory=tmp_path/'worldos'
    launch_render.prepare_storage({'WORLDOS_STORAGE_MODE':'ephemeral','WORLDOS_DATA_DIR':str(directory)})
    assert directory.is_dir()
    assert all(word in caplog.text for word in ('EPHEMERAL','SQLite','photos','login/session','spin-down'))
    with pytest.raises(RuntimeError,match='persistent disk'):
        launch_render.prepare_storage({'WORLDOS_STORAGE_MODE':'persistent','WORLDOS_DATA_DIR':str(tmp_path/'paid')})
    assert not (tmp_path/'paid').exists()


def test_render_storage_drops_privileges_before_serving(tmp_path,monkeypatch):
    from backend import launch_render
    actions=[]
    monkeypatch.setattr(launch_render.os,'getuid',lambda:0,raising=False)
    monkeypatch.setattr(launch_render.os,'umask',lambda _:None)
    for operation in ('chown','setgroups','setgid','setuid'):
        monkeypatch.setattr(launch_render.os,operation,lambda *args,op=operation:actions.append((op,args)),raising=False)
    launch_render.prepare_storage({'WORLDOS_STORAGE_MODE':'ephemeral','WORLDOS_DATA_DIR':str(tmp_path/'worldos')})
    assert actions[-3:]==[('setgroups',([],)),('setgid',(10001,)),('setuid',(10001,))]


def test_ephemeral_session_loss_requires_login_and_csrf_again(encoded,tmp_path,monkeypatch):
    monkeypatch.setenv('WORLDOS_STORAGE_MODE','ephemeral')
    client,auth=private_app(encoded,tmp_path/'before'/'auth.sqlite3')
    response=client.post('/api/auth/login',json={'password':PASSWORD,'mode':'cookie'},headers={'Origin':'https://testserver'})
    assert response.status_code==200
    assert client.get('/api/auth/status').json()['storage_mode']=='ephemeral'
    # A fresh directory models Render replacing the ephemeral filesystem.
    restarted,new_auth=private_app(encoded,tmp_path/'after'/'auth.sqlite3')
    restarted.cookies.update(client.cookies)
    assert restarted.get('/api/private').status_code==401
    assert restarted.get('/api/auth/status').json()['authenticated'] is False
    login=restarted.post('/api/auth/login',json={'password':PASSWORD,'mode':'cookie'},headers={'Origin':'https://testserver'})
    assert login.status_code==200
    assert restarted.post('/api/private',headers={'Origin':'https://testserver','X-CSRF-Token':response.json()['csrf_token']}).status_code==403
    assert restarted.post('/api/private',headers={'Origin':'https://testserver','X-CSRF-Token':login.json()['csrf_token']}).status_code==200
    auth.store.close();new_auth.store.close()


def test_free_resource_limits_reject_before_decoding_or_buffering(monkeypatch):
    import io
    from PIL import Image
    from backend.imaging import prepare_image, image_from_data_url
    import base64
    monkeypatch.setenv('WORLDOS_MAX_IMAGE_PIXELS','6000000')
    image=io.BytesIO();Image.new('RGB',(3000,2001)).save(image,'PNG')
    with pytest.raises(ValueError,match='6 megapixels'):prepare_image(image.getvalue())
    monkeypatch.setenv('WORLDOS_MAX_UPLOAD_MB','1')
    with pytest.raises(ValueError,match='under 1 MB'):
        image_from_data_url('data:image/png;base64,'+base64.b64encode(b'x'*(1024*1024+1)).decode())
    async def run():
        release=asyncio.Event();started=asyncio.Event();responses=[]
        async def inner(*_):started.set();await release.wait()
        async def receive():return {'type':'http.request','body':b'x','more_body':False}
        async def never_read():pytest.fail('Rejected request body must not be read')
        async def send(value):responses.append(value)
        limiter=RequestLimitsMiddleware(inner,production=True,max_concurrent_writes=1)
        scope={'type':'http','path':'/api/inspect/templates','method':'POST','headers':[]}
        first=asyncio.create_task(limiter(scope,receive,send))
        await started.wait()
        await limiter(scope,never_read,send)
        assert responses[0]['status']==429
        release.set();await first
        assert limiter.active_writes==0
    asyncio.run(run())
