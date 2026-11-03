"""Fresh browser regression checks for navigation and device save failures.

Only synthetic photos, local IndexedDB, and a loopback HTTP fixture are used.
"""
import argparse
import json
import threading
import traceback
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright, expect

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--browser')
parser.add_argument('--report', default='journey-reliability')
args = parser.parse_args()
out = root/'artifacts'/args.report
out.mkdir(parents=True, exist_ok=True)


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args): pass

    def do_GET(self):
        path = urlparse(self.path).path
        replies = {
            '/api/auth/status': {'required': False, 'authenticated': True, 'storage_mode': 'persistent'},
            '/api/missions': {'missions': [], 'routines': []},
            '/api/inspect/templates': {'templates': []},
            '/api/health': {'status': 'ok'},
        }
        if path in replies:
            body = json.dumps(replies[path]).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if path.startswith('/api/'):
            self.send_error(503, 'Synthetic offline service')
            return
        super().do_GET()


server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=str(root/'dist')))
threading.Thread(target=server.serve_forever, daemon=True).start()
origin = f'http://127.0.0.1:{server.server_port}'
report = {'scope': 'Synthetic loopback browser checks; no real model or phone benchmark.', 'checks': []}


def open_private(page):
    page.goto(origin)
    page.get_by_role('button', name='Settings', exact=True).click()
    page.get_by_role('button', name='Open private workspace', exact=True).click()
    expect(page.get_by_role('heading', name='Make room. Get going.', exact=True)).to_be_visible()


def record(page, identity):
    return page.evaluate("""id => new Promise((resolve, reject) => {
        const open = indexedDB.open('worldos-device', 2);
        open.onsuccess = () => {
            const db = open.result, tx = db.transaction('spaces'), read = tx.objectStore('spaces').get(id);
            tx.oncomplete = () => { db.close(); resolve(read.result); };
            tx.onerror = () => reject(tx.error);
        };
        open.onerror = () => reject(open.error);
    })""", identity)


def setup(page):
    page.goto(origin+'/#/mission')
    page.get_by_label('Setup name', exact=True).fill('Journey desk')
    expect(page.get_by_text('Saved on this device. You can come back after reloading.', exact=True)).to_be_visible()
    return page.url.split('device=')[1].split('&')[0]


def private_reload(context, page):
    open_private(page)
    page.get_by_role('button', name='Settings', exact=True).click()
    page.reload()
    expect(page.get_by_role('button', name='Back to device workspace', exact=True)).to_be_visible()


def private_history(context, page):
    open_private(page)
    page.get_by_role('button', name='Back to device workspace', exact=True).click()
    page.go_back()
    expect(page.get_by_role('heading', name='Make room. Get going.', exact=True)).to_be_visible()


def private_room(context, page):
    open_private(page)
    page.get_by_role('button', name='Furnish a room', exact=False).click()
    expect(page.get_by_label('Room name', exact=True)).to_be_visible()
    page.get_by_label('Room name', exact=True).fill('Private room saved locally')
    expect(page.get_by_text('Saved on this device', exact=True)).to_be_visible()
    page.reload()
    expect(page.get_by_label('Room name', exact=True)).to_have_value('Private room saved locally')
    page.get_by_role('button', name='My Spaces', exact=True).click()
    expect(page.get_by_role('button', name='ROOM PROJECT Private room saved locally', exact=False)).to_be_visible()


def setup_conflict(context, page):
    identity = setup(page)
    second = context.new_page()
    second.goto(page.url)
    expect(second.get_by_label('Setup name', exact=True)).to_have_value('Journey desk')
    page.get_by_label('Setup notes', exact=True).fill('Keep the first tab changes')
    expect(page.get_by_text('Saved on this device. You can come back after reloading.', exact=True)).to_be_visible()
    second.get_by_label('Setup name', exact=True).fill('Second tab name')
    expect(second.get_by_text('Saved on this device. You can come back after reloading.', exact=True)).to_be_visible()
    assert record(page, identity)['notes'] == 'Keep the first tab changes', 'A stale setup tab overwrote newer notes'
    expect(second.get_by_text('recovered setup', exact=False)).to_be_visible()
    second.close()


def setup_quota(context, page):
    identity = setup(page)
    page.evaluate("""() => {
        window.originalPut = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function(...args) {
            if (this.transaction.db.name === 'worldos-device') throw new DOMException('Synthetic full storage', 'QuotaExceededError');
            return window.originalPut.apply(this, args);
        };
    }""")
    page.get_by_label('Setup notes', exact=True).fill('Export these unsaved notes')
    expect(page.get_by_text('Changes not saved', exact=True)).to_be_visible()
    with page.expect_download() as result:
        page.get_by_role('button', name='Export backup', exact=True).click()
    target = out/'unsaved-setup.json'
    result.value.save_as(str(target))
    assert json.loads(target.read_text())['space']['notes'] == 'Export these unsaved notes'
    page.evaluate('() => { IDBObjectStore.prototype.put = window.originalPut; }')
    page.get_by_role('button', name='Retry save', exact=True).click()
    expect(page.get_by_text('Saved on this device. You can come back after reloading.', exact=True)).to_be_visible()
    assert record(page, identity)['notes'] == 'Export these unsaved notes'


def study_notes(context, page):
    page.goto(origin+'/#/settings')
    page.get_by_text('Try a usability session', exact=True).click()
    page.get_by_label('What confused them or went wrong?', exact=True).fill('The first task took too many steps')
    page.get_by_label('Did they need help?', exact=True).select_option('assisted')
    page.reload()
    page.get_by_text('Try a usability session', exact=True).click()
    expect(page.get_by_label('What confused them or went wrong?', exact=True)).to_have_value('The first task took too many steps')
    expect(page.get_by_label('Did they need help?', exact=True)).to_have_value('assisted')


def mobile_long_names(context, page):
    page.set_viewport_size({'width': 320, 'height': 740})
    setup(page)
    page.get_by_label('Setup name', exact=True).fill('Workspace'*13)
    expect(page.get_by_text('Saved on this device. You can come back after reloading.', exact=True)).to_be_visible()
    page.get_by_role('button', name='Back to My Spaces', exact=True).click()
    expect(page.get_by_role('heading', name='My Spaces', exact=True)).to_be_visible()
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), 'Saved names cause horizontal overflow'


try:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path=args.browser)
        for check in (private_reload, private_history, private_room, setup_conflict, setup_quota, study_notes, mobile_long_names):
            context = browser.new_context(viewport={'width': 390, 'height': 844}, service_workers='block')
            page = context.new_page()
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.set_default_timeout(5000)
            entry = {'name': check.__name__}
            try:
                check(context, page)
                assert not errors, errors
                entry['passed'] = True
            except Exception:
                entry.update(passed=False, error=traceback.format_exc())
            page.screenshot(path=str(out/(check.__name__+'.png')), full_page=True)
            report['checks'].append(entry)
            print(check.__name__+': '+str(entry['passed']), flush=True)
            context.close()
        browser.close()
finally:
    server.shutdown()
    server.server_close()
    (out/'report.json').write_text(json.dumps(report, indent=2))
if not all(item['passed'] for item in report['checks']):
    raise SystemExit(1)
