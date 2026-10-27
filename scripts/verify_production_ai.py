"""Opt-in real provider connectivity through local production-mode authentication.

The ASGI transport simulates inbound HTTPS only; both outbound provider requests
are real. Connection fixtures are synthetic. This is NOT a public deployment or
a physical workspace evaluation.
"""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import secrets
import sys
import tempfile

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-live',action='store_true',required=True,help='Authorize two potentially billed provider connectivity requests.')
    parser.add_argument('--report',type=Path,default=ROOT/'artifacts/production-ai-connectivity.json')
    args=parser.parse_args()
    from backend.security import password_hash
    from fastapi.testclient import TestClient
    (ROOT/'artifacts').mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='production-ai-',dir=ROOT/'artifacts') as directory:
        password=secrets.token_urlsafe(32)
        os.environ.update(WORLDOS_DEPLOYMENT='public',WORLDOS_AUTH_PASSWORD_HASH=password_hash(password),
            WORLDOS_JUDGE_PASSWORD_HASH='',WORLDOS_JUDGE_ACCESS_EXPIRES_AT='',
            WORLDOS_ALLOWED_HOSTS='production-qa.invalid',WORLDOS_CORS_ORIGINS='https://production-qa.invalid',
            WORLDOS_DATA_DIR=directory,WORLDOS_SAM_PROVIDER='meta',WORLDOS_MUSE_PROVIDER='auto',WORLDOS_BACKUPS_ENABLED='0')
        from backend.main import app,session_auth
        report={'checked_at':datetime.now(timezone.utc).isoformat(),'scope':'Local production-mode ASGI authentication, simulated inbound HTTPS, real outbound provider inference using synthetic connection fixtures.',
                'public_deployment_verified':False,'physical_evaluation_performed':False,'providers':[]}
        try:
            with TestClient(app,base_url='https://production-qa.invalid') as client:
                client.headers['Origin']='https://production-qa.invalid'
                login=client.post('/api/auth/login',json={'password':password,'mode':'cookie'})
                if login.status_code!=200:raise RuntimeError('Local production authentication failed.')
                client.headers['X-CSRF-Token']=login.json()['csrf_token']
                for integration in ('sam','muse'):
                    response=client.post('/api/ai/connection-test',json={'integration':integration})
                    if response.status_code!=200:
                        report['providers'].append({'integration':integration,'succeeded':False,'http_status':response.status_code});continue
                    entry=response.json()['integrations'][integration];result=entry['last_test']
                    report['providers'].append({'integration':integration,'provider':entry['provider'],'model':entry['model'],
                        'succeeded':result['live_request_succeeded'],'status':result['status'],
                        'provider_http_status':result.get('provider_http_status'),'latency_ms':result.get('inference_latency_ms'),'usage':result.get('usage',{})})
                client.post('/api/auth/logout')
        finally:
            session_auth.store.close()
        report['passed']=len(report['providers'])==2 and all(row['succeeded'] for row in report['providers'])
        args.report.parent.mkdir(parents=True,exist_ok=True);args.report.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
        print(json.dumps(report,indent=2))
        return 0 if report['passed'] else 1


if __name__=='__main__':sys.exit(main())
