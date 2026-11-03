"""Isolated production-browser regression test; synthetic AI, no external services.

Uses a fresh headless browser profile and only a loopback fixture server. Does not
open or read any of the user's browser windows, tabs, cookies or profiles.
"""
import argparse
import base64
import json
import threading
import time
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright, expect

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--browser')
args = parser.parse_args()
output = root/'artifacts'/'workspace-upgrade'
output.mkdir(exist_ok=True, parents=True)
fixture = output/'synthetic-room.png'
photo = Image.new('RGB', (1000, 750), '#e9e5dc')
draw = ImageDraw.Draw(photo)
draw.polygon([(200,350),(800,350),(1000,750),(0,750)],fill='#baa68c')
draw.rectangle((260,100,540,310),fill='#adcbd3',outline='white',width=12)
draw.text((20,20),'SYNTHETIC ROOM / MOCKED AI',fill='#384230')
photo.save(fixture)
image = 'data:image/png;base64,'+base64.b64encode(fixture.read_bytes()).decode()
survey = {'status':'ready','summary':'Synthetic room with a window on the back wall.',
    'room':{'width':4,'depth':5,'height':2.7,'width_min':3.2,'width_max':4.8,'depth_min':4,'depth_max':6},
    'floor_corners':[{'x':.2,'y':.4667},{'x':.8,'y':.4667},{'x':1,'y':1},{'x':0,'y':1}],
    'evidence':['Synthetic fixture only.'],'uncertainty':'Not physical measurement evidence.','confidence':'low',
    'features':[{'label':'Back window','kind':'window','x':.4,'z':0,'observation':'Visible in the fixture.'}],
    'zones':[],'ideas':['Add a sofa and a plant'],'image_url':image,'image_width':1000,'image_height':750}
design = {'title':'A calm reading room','summary':'A synthetic arrangement for software testing.',
    'items':[{'id':'sofa','kind':'sofa','label':'Sage sofa','width':1.8,'depth':.85,'height':.85,'color':'#7d8e73'},
             {'id':'plant','kind':'plant','label':'Corner plant','width':.55,'depth':.55,'height':1.3,'color':'#6f8c56'}],
    'placements':[{'itemId':'sofa','x':.4,'z':1.2,'rotation':0,'reason':'A seat beside the window.'},
                  {'itemId':'plant','x':3,'z':1.2,'rotation':0,'reason':'Leaves open space in the centre.'}],
    'tradeoffs':['Example sizes only.']}
jobs = {}
calls = []


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def reply(self, value, status=200):
        body=json.dumps(value).encode()
        self.send_response(status)
        self.send_header('Content-Type','application/json')
        self.send_header('Content-Length',str(len(body)))
        self.send_header('Cache-Control','no-store')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path=urlparse(self.path).path
        if path=='/api/auth/status':
            return self.reply({'required':False,'authenticated':True,'access':'owner','storage_mode':'persistent'})
        if path.startswith('/api/ai/room/jobs/'):
            identity=path.rsplit('/',1)[-1]
            if identity not in jobs:return self.reply({'detail':'Missing request'},404)
            job=jobs[identity]
            complete=time.monotonic()>=job['ready']
            return self.reply({'id':identity,'stage':job['stage'],'status':'completed' if complete else 'running','result':job['result'] if complete else None,'error':''})
        if path.startswith('/api/'):
            return self.reply({'detail':'Unexpected API call in isolated test'},503)
        return super().do_GET()

    def do_POST(self):
        path=urlparse(self.path).path
        body=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        if path=='/api/ai/room/jobs':
            identity=body['id'];stage='design' if 'goal' in body['request'] else 'survey'
            calls.append(stage)
            jobs[identity]={'stage':stage,'result':({'survey':survey,'design':design} if 'survey_job_id' in body['request'] else design) if stage=='design' else survey,'ready':time.monotonic()+2}
            return self.reply({'id':identity,'stage':stage,'status':'queued','result':None,'error':''},202)
        return self.reply({'detail':'Unexpected mutation in isolated test'},503)


server=ThreadingHTTPServer(('127.0.0.1',0),partial(Handler,directory=str(root/'dist')))
threading.Thread(target=server.serve_forever,daemon=True).start()
origin=f'http://127.0.0.1:{server.server_port}'
report={'scope':'Production app, isolated Chromium, synthetic AI fixtures. Not physical-phone or model accuracy evidence.','viewports':[]}
try:
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,executable_path=args.browser)
        try:
            for width in (390,1440,320):
                context=browser.new_context(viewport={'width':width,'height':950},accept_downloads=True)
                page=context.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
                page.goto(origin)
                expect(page.get_by_role('button',name='Get my space ready',exact=True)).to_be_visible()
                page.screenshot(path=str(output/f'home-{width}.png'))
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
                page.get_by_role('button',name='Get my space ready',exact=True).click()
                page.get_by_label('Choose a photo library input').set_input_files(str(fixture))
                expect(page.get_by_alt_text('Your starting photograph')).to_be_visible()
                page.get_by_text('Goal and things that should stay',exact=True).click()
                page.get_by_label('My goal',exact=True).fill('Make room for drawing')
                page.screenshot(path=str(output/f'prepare-{width}.png'))
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
                page.get_by_role('button',name='Continue to guided steps',exact=True).click()
                expect(page.get_by_role('heading',name='Ready for your next step.',exact=True)).to_be_visible()
                expect(page.get_by_alt_text('Your selected starting photograph')).to_be_visible()
                page.reload()
                expect(page.get_by_alt_text('Your selected starting photograph')).to_be_visible()
                page.get_by_role('button',name='Back to device workspace',exact=True).click()
                page.get_by_role('button',name='Plan a room',exact=False).click()
                page.get_by_label('Room name',exact=True).fill('Reading room')
                page.get_by_label('Choose room photo library input').set_input_files(str(fixture))
                page.get_by_label('What would make this room yours?').fill('A sofa and a plant')
                page.get_by_role('button',name='Design when room is ready',exact=True).click()
                expect(page.get_by_role('button',name='Design queued',exact=True)).to_be_visible()
                # Persist the pending job before simulating a real reload.
                expect(page.get_by_text('Saved on this device',exact=True)).to_be_visible()
                page.reload()
                expect(page.get_by_text(design['title'],exact=True)).to_be_visible(timeout=25000)
                expect(page.get_by_role('button',name='Inspect Sage sofa in room photo',exact=True)).to_be_visible()
                page.locator('#room-plan-stage').screenshot(path=str(output/f'preview-{width}.png'))
                with page.expect_download() as concept:
                    page.get_by_role('button',name='Save concept',exact=True).click()
                concept.value.save_as(str(output/f'concept-{width}.png'))
                page.get_by_text('Saved alternatives (0)',exact=True).click()
                page.get_by_label('Layout name',exact=True).fill('Reading layout')
                page.get_by_role('button',name='Save this layout',exact=True).click()
                expect(page.get_by_text('Saved alternatives (1)',exact=True)).to_be_visible()
                page.get_by_role('button',name='Compare',exact=True).first.click()
                expect(page.get_by_role('dialog',name='Compare room layouts',exact=True)).to_be_visible()
                page.get_by_role('dialog').screenshot(path=str(output/f'alternatives-{width}.png'))
                page.get_by_role('button',name='Use Reading layout',exact=True).click()
                expect(page.get_by_text('Saved alternatives (2)',exact=True)).to_be_visible()
                with page.expect_download() as backup:
                    page.get_by_role('button',name='Export room',exact=True).click()
                backup.value.save_as(str(output/f'room-backup-{width}.json'))
                page.get_by_role('button',name='Duplicate room',exact=True).click()
                expect(page.get_by_label('Room name',exact=True)).to_have_value('Reading room copy')
                page.get_by_role('button',name='My Spaces',exact=True).click()
                expect(page.get_by_role('button',name='Reading room copy',exact=False)).to_be_visible()
                expect(page.get_by_role('button',name='Reading room',exact=False)).to_have_count(2)
                page.get_by_label('Restore device setup backup').set_input_files(str(output/f'room-backup-{width}.json'))
                expect(page.get_by_role('button',name='Reading room',exact=False)).to_have_count(3)
                page.evaluate('navigator.serviceWorker.ready.then(()=>true)')
                page.wait_for_function('navigator.serviceWorker.controller !== null')
                context.set_offline(True);page.reload()
                expect(page.get_by_text('You’re offline.',exact=False)).to_be_visible()
                expect(page.get_by_role('button',name='Reading room copy',exact=False)).to_be_visible()
                page.get_by_role('button',name='Reading room copy',exact=False).click()
                expect(page.get_by_label('Room name',exact=True)).to_have_value('Reading room copy')
                expect(page.get_by_text(design['title'],exact=True)).to_be_visible()
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), 'Horizontal overflow'
                page.screenshot(path=str(output/f'offline-{width}.png'))
                assert not errors, errors
                report['viewports'].append({'width':width,'passed':True,'checks':['capture handoff','queued design','reload recovery','versions','comparison','restore','duplicate','backup roundtrip','offline cold start']})
                context.close()
        except Exception:
            page.screenshot(path=str(output/'failure.png'),full_page=True)
            (output/'failure.html').write_text(page.content(),encoding='utf-8')
            raise
        finally:
            browser.close()
finally:
    server.shutdown()
report['room_requests']=calls
(output/'report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report,indent=2))
