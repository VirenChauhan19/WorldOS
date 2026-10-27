"""Synthetic single-user resource probe. No network, real keys, or paid inference.

Reports this process's peak RSS; it does NOT emulate Render's CPU or cgroup limit.
Run in a fresh process: python scripts/check_free_resources.py
"""
import io
import json
import os
from pathlib import Path
import platform
import sys
import tempfile
from time import perf_counter

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def peak_rss_mib():
    if sys.platform == 'win32':
        import ctypes
        from ctypes import wintypes
        class Counters(ctypes.Structure):
            _fields_ = [('cb', wintypes.DWORD), ('PageFaultCount', wintypes.DWORD)] + [
                (name, ctypes.c_size_t) for name in ('PeakWorkingSetSize', 'WorkingSetSize',
                'QuotaPeakPagedPoolUsage', 'QuotaPagedPoolUsage', 'QuotaPeakNonPagedPoolUsage',
                'QuotaNonPagedPoolUsage', 'PagefileUsage', 'PeakPagefileUsage')]
        counters = Counters()
        counters.cb = ctypes.sizeof(counters)
        current = ctypes.windll.kernel32.GetCurrentProcess
        current.restype = wintypes.HANDLE
        get_memory = ctypes.windll.psapi.GetProcessMemoryInfo
        get_memory.argtypes = [wintypes.HANDLE, ctypes.POINTER(Counters), wintypes.DWORD]
        if not get_memory(current(), ctypes.byref(counters), counters.cb):
            raise ctypes.WinError()
        return counters.PeakWorkingSetSize / 1024**2
    import resource
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / (1024**2 if sys.platform == 'darwin' else 1024)


def main():
    import yaml
    service = yaml.safe_load((ROOT/'render.yaml').read_text(encoding='utf-8'))['services'][0]
    environment = {entry['key']:entry['value'] for entry in service['envVars'] if 'value' in entry}
    os.environ.update(environment)
    os.environ.update(MODEL_API_KEY='', BASETEN_API_KEY='', WORLDOS_JUDGE_PASSWORD_HASH='',
                      WORLDOS_JUDGE_ACCESS_EXPIRES_AT='', WORLDOS_ALLOWED_HOSTS='testserver',
                      WORLDOS_CORS_ORIGINS='https://testserver')
    # Everything is explicitly synthetic; never load a developer's auth values.
    from backend.security import password_hash
    password = 'synthetic free resource probe passphrase'
    os.environ['WORLDOS_AUTH_PASSWORD_HASH'] = password_hash(password)
    (ROOT/'artifacts').mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='free-resources-', dir=ROOT/'artifacts') as directory:
        os.environ['WORLDOS_DATA_DIR'] = directory
        import cv2
        cv2.setNumThreads(1)
        from PIL import Image
        from fastapi.testclient import TestClient
        from backend.main import app, session_auth
        timings = {}
        try:
            with TestClient(app, base_url='https://testserver', headers={'Origin':'https://testserver'}) as client:
                assert client.get('/healthz').json() == {'status':'ok'}
                assert client.get('/api/auth/status').json()['storage_mode'] == 'ephemeral'
                assert client.get('/api/inspect/templates').status_code == 401
                login = client.post('/api/auth/login', json={'password':password, 'mode':'cookie'})
                assert login.status_code == 200
                assert client.post('/api/admin/backups').status_code == 403
                client.headers['X-CSRF-Token'] = login.json()['csrf_token']
                startup_peak = peak_rss_mib()
                # RGBA PNG reaches the configured 6 MP decode ceiling; browser
                # photos normally arrive already reduced to <=1800 px per side.
                for iteration in range(3):
                    started = perf_counter()
                    image = io.BytesIO()
                    with Image.effect_noise((3000,2000),64).point(lambda value:(value//32)*32).convert('RGBA') as pixels:
                        pixels.save(image,'PNG')
                    assert image.tell() <= 6*1024*1024
                    upload = client.post('/api/analyze', files={'image':('SYNTHETIC.png',image.getvalue(),'image/png')})
                    assert upload.status_code == 200, upload.status_code
                    body = {'name':'SYNTHETIC memory probe', 'reference_image_url':upload.json()['image_url'],
                            'objects':[{'id':'box','label':'synthetic box','box':{'x':.1,'y':.1,'width':.1,'height':.1}}],
                            'annotations_reviewed':True}
                    saved = client.post('/api/inspect/templates', json=body)
                    assert saved.status_code == 201
                    identity = saved.json()['id']
                    for automatic in (True, False):
                        alignment = client.post('/api/inspect/alignment',json={'template_id':identity,
                            'image_url':body['reference_image_url'], 'automatic':automatic, 'alignment':{'confirmed':True}})
                        assert alignment.status_code == 200
                    assert client.post('/api/admin/backups').status_code == 200
                    assert client.get('/api/admin/backups/latest').content.startswith(b'SQLite format 3\x00')
                    assert client.delete('/api/inspect/templates/'+identity).status_code == 200
                    timings[f'iteration_{iteration+1}_seconds'] = round(perf_counter()-started,2)
                peak = peak_rss_mib()
                assert client.post('/api/auth/logout').status_code == 200
                assert client.get('/api/inspect/templates').status_code == 401
        finally:
            session_auth.store.close()
    report = {'platform':platform.platform(), 'python':platform.python_version(),
              'startup_peak_rss_mib':round(startup_peak,1), 'peak_rss_mib':round(peak,1),
              'render_memory_mib':512, 'below_512_mib':peak < 512, 'timings':timings,
              'scope':'Synthetic sequential 6 MP PNG upload, auth/CSRF, SQLite template, automatic/manual alignment, backup/download/delete; no live inference.',
              'limitations':'Local measurement, not a Linux container/cgroup or 0.1 CPU benchmark. Concurrent reads, large libraries and provider payloads may increase memory.'}
    (ROOT/'artifacts/free-resource-check.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(report,indent=2))
    return 0 if report['below_512_mib'] else 1


if __name__ == '__main__':
    sys.exit(main())
