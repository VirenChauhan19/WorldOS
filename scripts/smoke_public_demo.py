"""Fresh browsers + real auth, SQLite and room jobs; synthetic AI only.

Run after smoke_workspace_upgrade.py, which creates the labelled photo fixture.
Uses loopback HTTP with local cookies; HTTPS flags are covered by backend tests.
Never accesses an existing browser profile or any external service.
"""
import argparse
import asyncio
from contextlib import asynccontextmanager
import json
import os
from pathlib import Path
import socket
import sys
import threading
import time
from uuid import uuid4

import uvicorn
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from playwright.sync_api import sync_playwright, expect

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root))
from backend import room_jobs
from backend.request_limits import RequestLimitsMiddleware
from backend.security import SecuritySettings, SessionAuth, password_hash

parser=argparse.ArgumentParser();parser.add_argument('--browser');args=parser.parse_args()
out=root/'artifacts/public-demo';out.mkdir(parents=True,exist_ok=True)
os.environ['WORLDOS_DATA_DIR']=str(out/('stores-'+uuid4().hex))
sample=json.loads((root/'artifacts/workspace-upgrade/room-backup-390.json').read_text())['project']
reference=sample['reference']
survey={**reference['survey'],'image_url':reference['image_url'],'image_width':reference['width'],'image_height':reference['height']}
design=sample['draft']['design'];calls=[]


async def survey_fixture(body, service):
    calls.append('survey');await asyncio.sleep(.5);return survey


async def design_fixture(body, service):
    calls.append('design');await asyncio.sleep(.5);return design


room_jobs.survey_room=survey_fixture;room_jobs.design_room=design_fixture
auth=SessionAuth(SecuritySettings(encoded_password=password_hash('synthetic smoke owner passphrase'),public_demo=True),
                 session_path=Path(os.environ['WORLDOS_DATA_DIR'])/'auth.sqlite3')


@asynccontextmanager
async def lifespan(app):
    yield
    await room_jobs.stop_room_jobs()


app=FastAPI(lifespan=lifespan)
app.add_middleware(RequestLimitsMiddleware,demo_limits=auth.demo_limits)
app.middleware('http')(auth.middleware);app.include_router(auth.router())


async def run(work): return await work


app.include_router(room_jobs.build_room_jobs_router(lambda:object(),run))
app.mount('/',StaticFiles(directory=root/'dist',html=True),name='app')
listener=socket.socket();listener.bind(('127.0.0.1',0))
origin=f'http://127.0.0.1:{listener.getsockname()[1]}'
server=uvicorn.Server(uvicorn.Config(app,log_level='error'))
thread=threading.Thread(target=server.run,kwargs={'sockets':[listener]},daemon=True);thread.start()
deadline=time.monotonic()+10
while not server.started:
    if time.monotonic()>deadline:raise RuntimeError('Local demo fixture did not start.')
    time.sleep(.02)

report={'scope':'Real browser cookies, CSRF, SQLite and room jobs with synthetic AI. No external calls.','checks':[]}
try:
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,executable_path=args.browser)
        try:
            for width in (390,1440,320):
                context=browser.new_context(viewport={'width':width,'height':950},accept_downloads=True)
                page=context.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
                page.goto(origin+'/#/room')
                page.get_by_label('Choose room photo library input').set_input_files(str(root/'artifacts/workspace-upgrade/synthetic-room.png'))
                page.get_by_label('What would make this room yours?').fill('A sofa and a plant')
                page.get_by_role('button',name='Design when room is ready',exact=True).click()
                expect(page.get_by_text(design['title'],exact=True)).to_be_visible(timeout=20000)
                assert page.get_by_label('Workspace passphrase').count()==0
                session=context.request.get(origin+'/api/auth/status').json()
                assert session['authenticated'] and session['access']=='guest'
                csrf=session['csrf_token']
                assert context.request.get(origin+'/api/admin/backups/latest').status==403
                assert context.request.post(origin+'/api/ai/room/jobs',data='{}').status==403
                assert context.request.post(origin+'/api/ai/room/jobs',data='{}',headers={'Origin':origin,'X-CSRF-Token':csrf,'Content-Type':'application/json'}).status==422
                before=len(calls);page.reload()
                expect(page.get_by_text(design['title'],exact=True)).to_be_visible()
                assert len(calls)==before, 'Reload replayed inference'
                with page.expect_download() as download:
                    page.get_by_role('button',name='Export room',exact=True).click()
                download.value.save_as(str(out/f'demo-room-{width}.json'))
                page.goto(origin+'/#/home?workspace=private')
                expect(page.get_by_text('Demo ready · No password needed',exact=True)).to_be_visible()
                assert page.get_by_label('Workspace passphrase').count()==0
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth+1')
                page.screenshot(path=str(out/f'demo-{width}.png'))
                page.get_by_text('Demo ready · No password needed',exact=True).click()
                page.get_by_role('button',name='Owner sign-in',exact=True).click()
                expect(page.get_by_label('Workspace passphrase')).to_be_visible()
                page.get_by_role('button',name='Return to demo',exact=True).click()
                expect(page.get_by_text('Demo ready · No password needed',exact=True)).to_be_visible()
                assert not errors,errors
                report['checks'].append({'width':width,'passed':True,'checks':['automatic guest access','room survey and queued design','CSRF','owner restriction','reload without inference replay','export','explicit owner login','return to demo','no overflow']})
                context.close()
        except Exception:
            page.screenshot(path=str(out/'failure.png'),full_page=True)
            raise
        finally:browser.close()
finally:
    server.should_exit=True;thread.join(timeout=10);listener.close();auth.store.close()
(out/'report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report,indent=2))
