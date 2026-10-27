"""HTTP PWA + authenticated API smoke. Synthetic login and pixels, no paid AI."""
import io
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time

import httpx
from PIL import Image
from smoke_process import stop_server

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.security import password_hash

if not (ROOT/'dist/index.html').exists():
    raise SystemExit('Run npm.cmd run build first.')
(ROOT/'artifacts').mkdir(exist_ok=True)
with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    port = sock.getsockname()[1]

with tempfile.TemporaryDirectory(prefix='mobile-http-', dir=ROOT/'artifacts') as directory:
    passphrase = 'synthetic mobile smoke passphrase'
    environment = {**os.environ, 'MODEL_API_KEY':'', 'BASETEN_API_KEY':'',
        'WORLDOS_AUTH_PASSWORD_HASH':password_hash(passphrase), 'WORLDOS_DEPLOYMENT':'local',
        'WORLDOS_JUDGE_PASSWORD_HASH':'', 'WORLDOS_JUDGE_ACCESS_EXPIRES_AT':'',
        'WORLDOS_DATA_DIR':directory, 'WORLDOS_ALLOWED_HOSTS':'localhost,127.0.0.1',
        'WORLDOS_CORS_ORIGINS':'https://localhost,capacitor://localhost'}
    process = subprocess.Popen([sys.executable,'-m','uvicorn','backend.main:app','--host','127.0.0.1','--port',str(port)], cwd=ROOT, env=environment, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        with httpx.Client(base_url=f'http://127.0.0.1:{port}', timeout=10, trust_env=False) as client:
            for _ in range(100):
                if process.poll() is not None: raise RuntimeError('Mobile smoke server exited.')
                try:
                    if client.get('/api/auth/status').status_code == 200: break
                except httpx.ConnectError: pass
                time.sleep(.1)
            else: raise RuntimeError('Mobile smoke server did not start.')
            page = client.get('/')
            assert page.status_code == 200 and 'manifest.webmanifest' in page.text and 'viewport-fit=cover' in page.text
            manifest = client.get('/manifest.webmanifest')
            assert manifest.status_code == 200 and 'manifest+json' in manifest.headers['content-type']
            assert manifest.json()['display'] == 'standalone'
            for icon in manifest.json()['icons']:
                response = client.get(icon['src'])
                assert response.status_code == 200 and response.headers['content-type'] == 'image/png'
                size = int(icon['sizes'].split('x')[0])
                assert Image.open(io.BytesIO(response.content)).size == (size,size)
            worker = client.get('/sw.js')
            assert worker.status_code == 200 and 'javascript' in worker.headers['content-type']
            assert 'cache.addAll(PUBLIC_ASSETS)' in worker.text
            assert 'offline' in client.get('/offline.html').text.lower()
            for path in ('/.env','/.env.auth','/backend/security.py','/data/worldos.sqlite3'):
                assert client.get(path).status_code == 404
            for path in ('/api/health','/api/inspect/templates','/api/ai/diagnostics','/openapi.json'):
                response = client.get(path)
                assert response.status_code == 401 and response.headers['cache-control'] == 'no-store'
            assert client.get('/api/auth/status').json()['authenticated'] is False
            invalid = client.post('/api/auth/login', json={'password':passphrase,'extra':passphrase})
            assert invalid.status_code == 422 and passphrase not in invalid.text
            login = client.post('/api/auth/login', json={'password':passphrase})
            assert login.status_code == 200 and login.headers['cache-control'] == 'no-store'
            client.headers['Authorization'] = 'Bearer '+login.json()['access_token']
            assert client.get('/api/auth/status').json()['authenticated'] is True
            assert client.get('/api/inspect/templates').status_code == 200
            assert client.get('/api/health').json()['status'] == 'ok'
            image = io.BytesIO(); Image.new('RGB',(1800,1350),'gray').save(image,'JPEG')
            upload = client.post('/api/analyze',files={'image':('SYNTHETIC-mobile.jpg',image.getvalue(),'image/jpeg')})
            assert upload.status_code == 200 and upload.headers['cache-control'] == 'no-store'
            assert upload.json()['width'] == 1800 and upload.json()['height'] == 1350
            for origin in ('https://localhost','capacitor://localhost'):
                preflight=client.options('/api/analyze',headers={'Origin':origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'Authorization'})
                assert preflight.status_code == 200 and preflight.headers['access-control-allow-origin'] == origin
            assert client.post('/api/auth/logout').status_code == 200
            assert client.get('/api/inspect/templates').status_code == 401
            print('PASS: mobile HTTP auth gate, sign-in/out, no-store API, safe validation errors, native CORS, JPEG upload, manifest MIME/icons, offline assets, and private-file isolation. Synthetic QA only; no live AI requests.')
    finally:
        stop_server(process)
