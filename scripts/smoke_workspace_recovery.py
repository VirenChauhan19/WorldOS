"""Recovery regressions for the local production build, using synthetic fixtures only."""
import argparse
import copy
import json
import sys
import threading
import time
import traceback
import uuid
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse
from PIL import Image
from playwright.sync_api import sync_playwright, expect

root = Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser();parser.add_argument('--browser');args=parser.parse_args()
out = root/'artifacts/workspace-recovery'
out.mkdir(parents=True,exist_ok=True)
sample = json.loads((root/'artifacts/workspace-upgrade/room-backup-390.json').read_text())['project']
photo = root/'artifacts/workspace-upgrade/synthetic-room.png'
large = out/'large-photo.png'
Image.new('RGB', (2400, 2000), '#c9c5ba').save(large)
ref = sample['reference']
survey = {**ref['survey'], 'image_url': ref['image_url'], 'image_width': ref['width'], 'image_height': ref['height']}
design = sample['draft']['design']
state = {'mode': 'normal', 'release': False, 'jobs': {}, 'designs': [], 'pipelines': set()}

class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args): pass
    def reply(self, value, status=200):
        body = json.dumps(value).encode()
        self.send_response(status); self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body))); self.send_header('Cache-Control', 'no-store')

        if status==429:self.send_header('Retry-After','1')
        self.end_headers(); self.wfile.write(body)
    def do_GET(self):
        path = urlparse(self.path).path
        if path == '/api/auth/status':
            return self.reply({'required': False, 'authenticated': True, 'session_mode': 'cookie', 'csrf_token': 'audit', 'access': 'owner', 'storage_mode': 'persistent'})
        if path.startswith('/api/ai/room/jobs/'):
            identity = path.rsplit('/', 1)[-1]
            if state['mode'] in ('401', '429'):
                return self.reply({'detail': 'Synthetic temporary access failure'}, int(state['mode']))
            if identity not in state['jobs']: return self.reply({'detail': 'Missing request'}, 404)
            stage = state['jobs'][identity]
            completed = state['release'] or stage == 'design' and identity not in state['pipelines']
            return self.reply({'id': identity, 'stage': stage, 'status': 'completed' if completed else 'running', 'result': (survey if stage == 'survey' else {'survey':survey,'design':design} if identity in state['pipelines'] else design) if completed else None, 'error': ''})
        if path.startswith('/api/'): return self.reply({'detail': 'Synthetic unavailable endpoint'}, 503)
        return super().do_GET()
    def do_POST(self):
        path = urlparse(self.path).path
        data = self.rfile.read(int(self.headers.get('Content-Length', '0')))
        body = json.loads(data) if data else {}
        if state['mode'] == 'unavailable': return self.reply({'detail': 'Synthetic server unavailable'}, 503)
        if path == '/api/ai/room/jobs':
            stage = 'design' if 'goal' in body['request'] else 'survey'
            state['jobs'][body['id']] = stage
            if stage == 'design': state['designs'].append(body['request'])
            if 'survey_job_id' in body['request']:state['pipelines'].add(body['id'])
            return self.reply({'id': body['id'], 'stage': stage, 'status': 'queued', 'result': None, 'error': ''}, 202)
        return self.reply({'detail': 'Synthetic unavailable mutation'}, 503)

read_project = """async id => {const db=await new Promise((ok,no)=>{const r=indexedDB.open('worldos-projects',1);r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error);});return new Promise((ok,no)=>{const tx=db.transaction('records');const r=tx.objectStore('records').get('room:'+id);tx.oncomplete=()=>{db.close();ok(r.result);};tx.onerror=()=>no(tx.error);});}"""
seed_js = """async ([name,version,store,key,value])=>{const db=await new Promise((ok,no)=>{const r=indexedDB.open(name,version);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(store))r.result.createObjectStore(store);};r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error);});await new Promise((ok,no)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).put(value,key);tx.oncomplete=ok;tx.onerror=()=>no(tx.error);});db.close();}"""
server = ThreadingHTTPServer(('127.0.0.1',0), partial(Handler,directory=str(root/'dist')))
threading.Thread(target=server.serve_forever,daemon=True).start()
origin = f'http://127.0.0.1:{server.server_port}'
report = {'scope':'Fresh isolated Chromium, loopback server, synthetic photos and API responses. Recovery and persistence regression checks.', 'checks': []}

def seed_project(page, pending=None):
    project = copy.deepcopy(sample); project['id']=str(uuid.uuid4()); project['name']='Audit room'
    project['versions']=[]; project['draft']['goal']='Original wish list'; project['draft'].pop('roomJob',None)
    project['draft']['designQueued']=False
    if pending:
        project['draft']['roomJob']={'id':pending,'stage':'design'};state['jobs'][pending]='design'
    page.evaluate(seed_js,['worldos-projects',1,'records','room:'+project['id'],project])
    return project

def wait_project(page, identity, predicate):
    until=time.monotonic()+8
    while time.monotonic()<until:
        value=page.evaluate(read_project,identity)
        if predicate(value):return value
        page.wait_for_timeout(100)
    raise AssertionError('Expected project state was not persisted: '+str(value.get('draft',{}).get('goal')))

try:
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,executable_path=args.browser)
        def run(name, check):
            state.update(mode='normal',release=False,jobs={},designs=[],pipelines=set())
            context=browser.new_context(viewport={'width':390,'height':950},accept_downloads=True)
            page=context.new_page();page.set_default_timeout(12000);page.goto(origin)
            try:
                details=check(context,page)
                details.pop('issue_reproduced',None)
                report['checks'].append({'name':name,'passed':True,'evidence':details})
                print(name+': passed',flush=True)
            except Exception as error:
                report['checks'].append({'name':name,'passed':False,'error':traceback.format_exc()})
                print(name+': FAILED: '+str(error),flush=True)
            finally:
                page.screenshot(path=str(out/(name+'.png')),full_page=False)
                context.close()
        def style_check(context,page):
            page.goto(origin+'/#/room')
            page.get_by_label('Choose room photo library input').set_input_files(str(photo))
            page.get_by_label('What would make this room yours?').fill('A sofa and a plant')
            page.get_by_role('button',name='More open space',exact=True).click()
            page.get_by_role('button',name='Design when room is ready',exact=True).click()
            expect(page.get_by_role('button',name='Design queued',exact=True)).to_be_visible()
            expect(page.get_by_text('Saved on this device',exact=True)).to_be_visible()
            page.reload();expect(page.get_by_role('button',name='Design queued',exact=True)).to_be_visible()
            state['release']=True
            expect(page.get_by_text(design['title'],exact=True)).to_be_visible()
            assert state['designs'][-1]['style']=='open'
            return {'selected_before_reload':'open','submitted_after_reload':state['designs'][-1]['style']}
        run('queued-style-preserved',style_check)
        def access_check(code):
            def check(context,page):
                pending=str(uuid.uuid4());project=seed_project(page,pending);state['mode']=code
                page.goto(origin+'/#/room?project='+project['id'])
                expect(page.get_by_text('Synthetic temporary access failure' if code=='401' else 'Waiting to reconnect',exact=True)).to_be_visible()
                expect(page.get_by_text('Saved on this device',exact=True)).to_be_visible()
                after=page.evaluate(read_project,project['id'])
                assert after['draft']['roomJob']['id']==pending
                state['mode']='normal';state['release']=True
                if code=='401':page.get_by_role('button',name='Sign in for AI design',exact=False).click()
                expect(page.get_by_text(design['title'],exact=True)).to_be_visible(timeout=12000)
                assert not state['designs'], 'Recovery must not submit another design'
                return {'http_status':int(code),'previous_job':pending,'server_still_has_job':pending in state['jobs'],'saved_job_after_error':after['draft'].get('roomJob')}
            return check
        run('expired-session-recovery',access_check('401'))
        run('rate-limit-recovery',access_check('429'))
        def tabs_check(context,page):
            project=seed_project(page);url=origin+'/#/room?project='+project['id'];page.goto(url)
            expect(page.get_by_label('Room name',exact=True)).to_have_value('Audit room')
            page.wait_for_timeout(650)
            before_second=page.evaluate(read_project,project['id'])
            other=context.new_page();other.goto(url);expect(other.get_by_label('Room name',exact=True)).to_have_value('Audit room')
            other.wait_for_timeout(650)
            page.get_by_label('What would make this room yours?').fill('Keep the lamp by the window')
            first=wait_project(page,project['id'],lambda v:v['draft']['goal']=='Keep the lamp by the window')
            assert first['draft']['goal']=='Keep the lamp by the window',str(first['draft']['goal'])
            other.get_by_label('Room name',exact=True).fill('Renamed in second tab')
            expect(other.get_by_label('Room name',exact=True)).to_have_value('Recovered: Renamed in second tab',timeout=12000)
            after=page.evaluate(read_project,project['id'])
            assert after['draft']['goal']=='Keep the lamp by the window'
            assert after['name']=='Audit room'
            other.close()
            return {'first_tab_saved_goal':first['draft']['goal'],'stored_goal_after_second_tab_rename':after['draft']['goal']}
        run('two-tabs-preserve-both-versions',tabs_check)
        def reset_check(context,page):
            space={'id':'reset-audit','name':'Audit desk','notes':'Original notes','photo':ref['image_url'],'after':'','steps':[],'updatedAt':'2026-11-02'}
            page.evaluate("""async s=>{const db=await new Promise((ok,no)=>{const r=indexedDB.open('worldos-device',2);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains('spaces'))r.result.createObjectStore('spaces',{keyPath:'id'});if(!r.result.objectStoreNames.contains('room'))r.result.createObjectStore('room');};r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error);});await new Promise((ok,no)=>{const tx=db.transaction('spaces','readwrite');tx.objectStore('spaces').put(s);tx.oncomplete=ok;tx.onerror=()=>no(tx.error);});db.close();}""",space)
            page.goto(origin+'/#/prepare?reset=reset-audit')
            page.get_by_label('Choose a photo library input').set_input_files(str(photo))
            expect(page.get_by_alt_text('Your starting photograph')).to_be_visible()
            page.get_by_text('Goal and things that should stay',exact=True).click()
            page.get_by_label('Keep in place or keep in mind',exact=True).fill('Keep the new monitor')
            # Confirm the edit has committed before reloading.
            until=time.monotonic()+8
            while time.monotonic()<until:
                captured=page.evaluate(read_project.replace("'room:'+id","'task-capture'"),None)
                if captured and captured['constraints']=='Keep the new monitor' and captured['photo']:break
                page.wait_for_timeout(100)
            assert captured['constraints']=='Keep the new monitor' and captured['photo']
            page.reload();expect(page.get_by_role('heading',name='Reset Audit desk')).to_be_visible()
            expect(page.get_by_alt_text('Your starting photograph')).to_be_visible()
            expect(page.get_by_label('Keep in place or keep in mind',exact=True)).to_have_value('Keep the new monitor')
            return {'photo_after_reload':True,'notes_after_reload':'Keep the new monitor','saved_task_notes_before_reload':'Keep the new monitor'}
        run('reset-draft-restored',reset_check)
        def backup_check(context,page):
            state['mode']='unavailable';page.goto(origin+'/#/room')
            page.get_by_label('Choose room photo library input').set_input_files(str(large))
            expect(page.get_by_text('Synthetic server unavailable',exact=True)).to_be_visible()
            expect(page.get_by_text('Saved on this device',exact=True)).to_be_visible()
            with page.expect_download() as download:page.get_by_role('button',name='Export room',exact=True).click()
            target=out/'large-photo-backup.json';download.value.save_as(str(target))
            exported=json.loads(target.read_text())['project']
            assert exported['reference']['width']==1800
            page.get_by_role('button',name='My Spaces',exact=True).click()
            page.get_by_label('Restore device setup backup').set_input_files(str(target))
            expect(page.get_by_role('button',name='ROOM PROJECT Untitled room',exact=False)).to_have_count(2)
            assert page.get_by_text('This backup contains an invalid room photo.',exact=False).count()==0
            return {'issue_reproduced':False,'input_dimensions':[2400,2000],'stored_dimensions':[exported['reference']['width'],exported['reference']['height']],'bytes':large.stat().st_size,'restore_result':'Accepted under a new room ID'}
        run('large-photo-backup-roundtrip',backup_check)
        def management_check(context,page):
            project=seed_project(page);page.goto(origin+'/#/room?project='+project['id'])
            page.get_by_text('Saved alternatives (0)',exact=True).click()
            page.get_by_label('Layout name',exact=True).fill('First idea')
            page.get_by_role('button',name='Save this layout',exact=True).click()
            expect(page.get_by_text('Saved alternatives (1)',exact=True)).to_be_visible()
            page.get_by_role('button',name='Remove alternative First idea',exact=True).click()
            expect(page.get_by_text('Saved alternatives (0)',exact=True)).to_be_visible()
            page.get_by_role('button',name='Undo removal',exact=True).click()
            expect(page.get_by_text('Saved alternatives (1)',exact=True)).to_be_visible()
            page.get_by_role('button',name='Archive room',exact=True).click()
            expect(page.get_by_role('heading',name='My Spaces',exact=True)).to_be_visible()
            page.get_by_text('Archived rooms (1)',exact=True).click()
            page.get_by_role('button',name='Restore room',exact=True).click()
            expect(page.get_by_role('button',name='ROOM PROJECT Audit room',exact=False)).to_be_visible()
            page.get_by_role('button',name='Settings',exact=True).click()
            expect(page.get_by_text('Ready offline:',exact=False)).to_be_visible(timeout=12000)
            return {'alternative_removal_undo':True,'archive_restore':True,'offline_readiness_confirmed':True}
        run('saved-work-controls',management_check)
        def quota_check(context,page):
            project=seed_project(page);page.goto(origin+'/#/room?project='+project['id'])
            expect(page.get_by_label('Room name',exact=True)).to_have_value('Audit room')
            page.wait_for_timeout(650)
            page.evaluate("""()=>{window.auditOriginalPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.transaction.db.name==='worldos-projects')throw new DOMException('Synthetic storage full','QuotaExceededError');return window.auditOriginalPut.apply(this,args);};}""")
            page.get_by_label('Room name',exact=True).fill('Unsaved edits')
            expect(page.get_by_text('Changes not saved',exact=True)).to_be_visible()
            with page.expect_download() as download:page.get_by_role('button',name='Export room',exact=True).click()
            target=out/'unsaved-export.json';download.value.save_as(str(target))
            assert json.loads(target.read_text())['project']['name']=='Unsaved edits'
            page.evaluate('() => { IDBObjectStore.prototype.put=window.auditOriginalPut; }')
            page.get_by_role('button',name='Retry save',exact=True).click()
            wait_project(page,project['id'],lambda value:value['name']=='Unsaved edits')
            return {'failed_save_visible':True,'unsaved_edits_exported':True,'retry_saved':True}
        run('storage-failure-recovery',quota_check)
        browser.close()
finally:
    server.shutdown();server.server_close()
    (out/'report.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2))
if not all(check.get('passed') for check in report['checks']):raise SystemExit(1)
