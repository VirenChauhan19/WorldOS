"""Verify an operator-supplied public HTTPS WorldOS deployment. No provider keys here."""
import argparse
from datetime import datetime, timezone
from getpass import getpass
import io
import ipaddress
import json
from pathlib import Path
import sys
import socket
from urllib.parse import urlparse
import httpx
from PIL import Image


class VerificationFailure(Exception):
    def __init__(self,report):
        self.report=report
        super().__init__('Deployment checks did not pass.')


def origin(value):
    url=urlparse(value)
    if url.scheme!='https' or not url.hostname or url.username or url.password or url.path not in {'','/'} or url.query or url.fragment or url.port not in {None,443} or url.hostname in {'localhost','testserver'} or url.hostname.endswith(('.localhost','.invalid','.test')):
        raise ValueError('Supply the actual public HTTPS origin without credentials, paths or query parameters.')
    try:
        if not ipaddress.ip_address(url.hostname).is_global:raise ValueError('Local/private addresses do not prove public deployment.')
    except ValueError as error:
        if 'Local/private' in str(error):raise
    return f'https://{url.hostname}'


def verify(url,password,live_ai=False,check_restart=False):
    addresses={entry[4][0] for entry in socket.getaddrinfo(urlparse(url).hostname,443,type=socket.SOCK_STREAM)}
    if not addresses or not all(ipaddress.ip_address(value).is_global for value in addresses):
        raise ValueError('Deployment hostname must resolve to public addresses.')
    report={'url':url,'checked_at':datetime.now(timezone.utc).isoformat(),'scope':'public HTTPS; synthetic software QA, not physical accuracy','checks':[],'live_ai':[],'passed':False}
    identity=None
    with httpx.Client(base_url=url,timeout=90,follow_redirects=False,trust_env=False,headers={'Origin':url}) as client:
        def check(condition,name):
            if not condition:
                report['passed']=False;report['failed_check']=name
                raise VerificationFailure(report)
            report['checks'].append(name)
        check(client.get('/healthz').json()=={'status':'ok'},'HTTPS certificate and minimal database health')
        page=client.get('/');check(page.status_code==200 and 'manifest.webmanifest' in page.text,'production application shell')
        manifest=client.get('/manifest.webmanifest');check(manifest.status_code==200 and manifest.json().get('display')=='standalone','PWA manifest')
        for icon in manifest.json()['icons']:
            check(icon['src'].startswith('/icons/') and client.get(icon['src']).status_code==200,'PWA icon '+icon['sizes'])
        check(client.get('/sw.js').status_code==200 and client.get('/offline.html').status_code==200,'service worker and offline page')
        check(client.get('/api/inspect/templates').status_code==401,'private data requires authentication')
        check(client.post('/api/analyze',content=b'').status_code==401,'unauthorized upload rejected')
        check(client.post('/api/ai/connection-test',json={'integration':'muse'}).status_code==401,'unauthorized inference rejected')
        login=client.post('/api/auth/login',json={'password':password,'mode':'cookie'})
        check(login.status_code==200,'sign-in')
        flags=login.headers.get('set-cookie','').lower()
        check(all(flag in flags for flag in ('__host-worldos_session=','secure','httponly','samesite=strict')) and 'domain=' not in flags,'secure host-only cookie')
        try:
            check(client.get('/api/auth/status').json().get('authenticated') is True,'cookie session restored on subsequent request')
            check(client.post('/api/admin/backups').status_code==403,'missing CSRF token rejected')
            client.headers['X-CSRF-Token']=login.json()['csrf_token']
            image=io.BytesIO();Image.new('RGB',(640,480),'gray').save(image,'JPEG')
            upload=client.post('/api/analyze',files={'image':('SYNTHETIC-deployment-check.jpg',image.getvalue(),'image/jpeg')})
            check(upload.status_code==200,'JPEG upload')
            check(client.post('/api/analyze',files={'image':('invalid.jpg',b'invalid','image/jpeg')}).status_code==415,'invalid-image recovery')
            template={'name':'SYNTHETIC DEPLOYMENT QA — temporary','reference_image_url':upload.json()['image_url'],
                      'objects':[{'id':'box','label':'synthetic box','box':{'x':.1,'y':.1,'width':.1,'height':.1}}],'annotations_reviewed':True}
            saved=client.post('/api/inspect/templates',json=template);check(saved.status_code==201,'temporary QA template saved');identity=saved.json()['id']
            if check_restart:
                input('Restart the service in Render now. When it is healthy, press Enter to check the SAME session and template: ')
                check(client.get('/api/auth/status').json().get('authenticated') is True,'session survived backend restart')
                check(client.get('/api/inspect/templates/'+identity).json().get('reference_image_url')==template['reference_image_url'],'template and photo survived backend restart')
            check(client.post('/api/admin/backups').status_code==200,'consistent backup created')
            backup=client.get('/api/admin/backups/latest')
            check(backup.status_code==200 and backup.content.startswith(b'SQLite format 3\x00') and backup.headers.get('cache-control')=='no-store','private backup downloadable')
            if live_ai:
                for integration in ('sam','muse'):
                    response=client.post('/api/ai/connection-test',json={'integration':integration})
                    check(response.status_code==200,integration+' connection check response')
                    entry=response.json()['integrations'][integration];result=entry['last_test']
                    report['live_ai'].append({'integration':integration,'provider':entry['provider'],'model':entry['model'],
                        'succeeded':result['live_request_succeeded'],'status':result['status'],
                        'latency_ms':result.get('inference_latency_ms'),'usage':result.get('usage',{})})
                check(all(item['succeeded'] for item in report['live_ai']),'both real providers responded successfully')
            report['passed']=True
        finally:
            if identity:
                try:
                    removed=client.delete('/api/inspect/templates/'+identity)
                    if removed.status_code not in {200,204,404}:report['passed']=False;report['cleanup_required_template_id']=identity
                except httpx.HTTPError:report['passed']=False;report['cleanup_required_template_id']=identity
            try:
                logout=client.post('/api/auth/logout')
                if logout.status_code!=200:report['passed']=False;report['logout']='failed; sign out in browser'
            except httpx.HTTPError:report['passed']=False;report['logout']='unconfirmed; retry sign-out online'
        check(client.get('/api/inspect/templates').status_code==401,'logout revoked access')
    return report


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url',required=True)
    parser.add_argument('--live-ai',action='store_true',help='Make two real, potentially billed provider connectivity requests using synthetic fixtures.')
    parser.add_argument('--check-restart',action='store_true',help='Pause for the operator to restart Render; keep this process open.')
    parser.add_argument('--report',type=Path,default=Path('artifacts/public-deployment-verification.json'))
    args=parser.parse_args()
    try:
        url=origin(args.url)
        report=verify(url,getpass('WorldOS workspace passphrase (hidden): '),args.live_ai,args.check_restart)
        args.report.parent.mkdir(parents=True,exist_ok=True);args.report.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
        print('PASS: public deployment checks completed.' if report['passed'] else 'FAIL: deployment verification incomplete.')
        return 0 if report['passed'] else 1
    except VerificationFailure as failure:
        args.report.parent.mkdir(parents=True,exist_ok=True);args.report.write_text(json.dumps(failure.report,indent=2)+'\n',encoding='utf-8')
        print('FAIL: deployment checks did not all pass. See the sanitized verification report.')
        return 1
    except Exception:
        # Never echo submitted credentials, provider payloads or exception URLs.
        args.report.parent.mkdir(parents=True,exist_ok=True)
        args.report.write_text(json.dumps({'passed':False,'checked_at':datetime.now(timezone.utc).isoformat(),'public_deployment_verified':False,'error':'Transport, configuration, or verification failure. No new successful deployment is claimed.'},indent=2)+'\n',encoding='utf-8')
        print('Deployment verification failed. Check the target HTTPS service, passphrase and server diagnostics. No successful deployment is claimed.')
        return 1


if __name__=='__main__':sys.exit(main())
