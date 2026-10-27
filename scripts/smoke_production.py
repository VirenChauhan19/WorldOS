"""Real local HTTP behind simulated TLS termination; synthetic data, no live AI.

This proves production application behavior, NOT public HTTPS deployment.
"""
import io
import os
from pathlib import Path
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
from contextlib import closing
from datetime import datetime, timedelta, timezone
import httpx
from PIL import Image
from smoke_process import stop_server

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from backend.security import password_hash


def launch(env,port):
    # Test-only route proves a NEW process answered after restart. It is not
    # included in the application or public deployment.
    code="import os; from backend.main import app; import uvicorn; app.add_api_route('/api/testing/process',lambda:{'pid':os.getpid()},methods=['GET']); app.router.routes.insert(0,app.router.routes.pop()); uvicorn.run(app,host='127.0.0.1',port="+str(port)+",proxy_headers=True,forwarded_allow_ips='127.0.0.1',access_log=False)"
    process=subprocess.Popen([sys.executable,'-c',code],cwd=ROOT,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    with httpx.Client(base_url=f'http://127.0.0.1:{port}',headers={'Host':'worldos.test'},trust_env=False,timeout=5) as ready:
        for _ in range(100):
            if process.poll() is not None: raise RuntimeError('Production smoke process exited.')
            try:
                if ready.get('/healthz').status_code==200:return process
            except httpx.ConnectError:pass
            time.sleep(.1)
    stop(process);raise RuntimeError('Production smoke startup timed out.')


def stop(process):
    stop_server(process)


def main():
    (ROOT/'artifacts').mkdir(exist_ok=True)
    with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
    with tempfile.TemporaryDirectory(prefix='production-http-',dir=ROOT/'artifacts') as directory:
        password='synthetic production smoke passphrase'
        judge_password='synthetic judge smoke passphrase'
        env={**os.environ,'WORLDOS_DEPLOYMENT':'public','WORLDOS_AUTH_PASSWORD_HASH':password_hash(password),
             'WORLDOS_JUDGE_PASSWORD_HASH':password_hash(judge_password),
             'WORLDOS_JUDGE_ACCESS_EXPIRES_AT':(datetime.now(timezone.utc)+timedelta(hours=1)).isoformat(),
             'WORLDOS_ALLOWED_HOSTS':'worldos.test','WORLDOS_CORS_ORIGINS':'https://worldos.test',
             'WORLDOS_DATA_DIR':directory,'MODEL_API_KEY':'','BASETEN_API_KEY':'','WORLDOS_BACKUPS_ENABLED':'1'}
        process=launch(env,port)
        try:
            with httpx.Client(base_url=f'http://127.0.0.1:{port}',headers={'Host':'worldos.test'},trust_env=False,timeout=10) as client:
                assert client.get('/healthz').json()=={'status':'ok'}
                assert client.get('/api/auth/status').status_code==403
                client.headers.update({'X-Forwarded-Proto':'https','Origin':'https://worldos.test'})
                assert client.get('/').headers['cache-control']=='no-store'
                for path in ('/api/inspect/templates','/api/ai/diagnostics','/api/admin/backups/latest','/docs','/app'):
                    assert client.get(path).status_code==401
                assert client.post('/api/analyze',content='not-an-image').status_code==401
                response=client.post('/api/auth/login',json={'password':password,'mode':'cookie'})
                assert response.status_code==200 and 'access_token' not in response.json()
                assert all(flag in response.headers['set-cookie'] for flag in ('Secure','HttpOnly','SameSite=strict'))
                # Transport here is deliberately local HTTP. Explicitly forward the
                # Secure cookie as a TLS proxy would, rather than weakening its flags.
                cookie=response.cookies.get('__Host-worldos_session')
                client.headers['Cookie']='__Host-worldos_session='+cookie
                assert client.get('/api/auth/status').json()['authenticated']
                first_process=client.get('/api/testing/process').json()['pid']
                assert client.post('/api/analyze',content='bad').status_code==403
                client.headers['X-CSRF-Token']=response.json()['csrf_token']
                image=io.BytesIO();Image.new('RGB',(640,480),'gray').save(image,'JPEG')
                upload=client.post('/api/analyze',files={'image':('SYNTHETIC.jpg',image.getvalue(),'image/jpeg')})
                assert upload.status_code==200
                failed=client.post('/api/analyze',files={'image':('bad.jpg',b'bad','image/jpeg')})
                assert failed.status_code==415
                body={'name':'SYNTHETIC production persistence test','reference_image_url':upload.json()['image_url'],
                      'objects':[{'id':'box','label':'synthetic box','box':{'x':.1,'y':.1,'width':.1,'height':.1}}],'annotations_reviewed':True}
                saved=client.post('/api/inspect/templates',json=body)
                assert saved.status_code==201
                identity=saved.json()['id']
                backup=client.post('/api/admin/backups');assert backup.status_code==200
                downloaded=client.get('/api/admin/backups/latest');assert downloaded.status_code==200 and downloaded.headers['cache-control']=='no-store'
                snapshot=Path(directory)/'downloaded.sqlite3';snapshot.write_bytes(downloaded.content)
                assert cookie.encode() not in downloaded.content and password.encode() not in downloaded.content
                with closing(sqlite3.connect(snapshot)) as db:
                    assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
                    assert db.execute('SELECT id FROM templates').fetchone()[0]==identity
                owner_csrf=client.headers['X-CSRF-Token']
                demo=client.post('/api/auth/login',json={'password':judge_password,'mode':'cookie','access':'judge'})
                assert demo.status_code==200 and demo.json()['access']=='judge'
                judge_cookie=demo.cookies.get('__Host-worldos_session')
                client.headers.update({'Cookie':'__Host-worldos_session='+judge_cookie,'X-CSRF-Token':demo.json()['csrf_token']})
                assert client.get('/api/inspect/templates').json()=={'templates':[]}
                assert client.get('/api/inspect/templates/'+identity).status_code==404
                assert client.get('/api/admin/backups/latest').status_code==403
                assert client.post('/api/ai/connection-test',json={'integration':'sam'}).status_code==403
                assert client.post('/api/analyze',files={'image':('SYNTHETIC.jpg',image.getvalue(),'image/jpeg')}).status_code==200
                demo_saved=client.post('/api/inspect/templates',json={**body,'name':'SYNTHETIC judge persistence test'})
                assert demo_saved.status_code==201
                judge_identity=demo_saved.json()['id']
                client.headers.update({'Cookie':'__Host-worldos_session='+cookie,'X-CSRF-Token':owner_csrf})
                stop(process);process=launch(env,port)
                assert client.get('/api/auth/status').json()['authenticated']
                assert client.get('/api/testing/process').json()['pid']!=first_process
                persisted=client.get('/api/inspect/templates/'+identity)
                assert persisted.status_code==200 and persisted.json()['reference_image_url']==body['reference_image_url']
                assert client.get('/api/inspect/templates/'+judge_identity).status_code==404
                client.headers['Cookie']='__Host-worldos_session='+judge_cookie
                assert client.get('/api/auth/status').json()['access']=='judge'
                assert client.get('/api/inspect/templates/'+judge_identity).status_code==200
                assert client.get('/api/inspect/templates/'+identity).status_code==404
                client.headers['Cookie']='__Host-worldos_session='+cookie
                assert client.post('/api/auth/logout').status_code==200
                assert client.get('/api/inspect/templates').status_code==401
                print('PASS: production auth/cookie/CSRF, blocked HTTP/unauthorized uploads, valid upload/error recovery, owner/judge isolation, owner-only backups/probes, backup download/integrity, SQLite photos and both session roles after real process restart, logout revocation. Local HTTP with SIMULATED TLS termination; no public deployment or live AI.')
        finally: stop(process)


if __name__=='__main__':main()
