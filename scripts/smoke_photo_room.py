"""Production-browser photo designer QA with synthetic, explicitly mocked AI output."""
import base64
import argparse
import json
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright, expect

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--browser', help='Optional installed Chromium browser executable')
parser.add_argument('--recording', help='Replay a real provider result JSON (no network calls)')
args = parser.parse_args()
output = root / 'artifacts' / ('photo-room' if not args.recording else 'real-room-ui-' + Path(args.recording).stem)
output.mkdir(parents=True, exist_ok=True)
fixture = output / 'synthetic-room.png'
photo = Image.new('RGB', (1000, 750), '#e8e3d8')
draw = ImageDraw.Draw(photo)
draw.polygon([(200, 350), (800, 350), (1000, 750), (0, 750)], fill='#bda786')
draw.polygon([(0, 0), (200, 120), (200, 350), (0, 750)], fill='#d5d5c6')
draw.polygon([(800, 120), (1000, 0), (1000, 750), (800, 350)], fill='#eeeade')
draw.rectangle((240, 130, 530, 320), fill='#adc9d0', outline='#fffaf0', width=12)
draw.line((385, 140, 385, 310), fill='#fffaf0', width=8)
draw.rectangle((680, 150, 780, 350), fill='#9b8569', outline='#f4ead9', width=8)
draw.ellipse((755, 250, 762, 257), fill='#4f4b41')
draw.text((25, 20), 'SYNTHETIC QA ROOM - mocked AI, not accuracy evidence', fill='#34452e')
photo.save(fixture)
image_url = 'data:image/png;base64,' + base64.b64encode(fixture.read_bytes()).decode()
survey = {
    'status': 'ready', 'summary': 'A bright room with a window on the back wall and a door to the right.',
    'room': {'width': 4, 'depth': 5, 'height': 2.7, 'width_min': 3.2, 'width_max': 4.8, 'depth_min': 4, 'depth_max': 6},
    'floor_corners': [{'x': .2, 'y': .4667}, {'x': .8, 'y': .4667}, {'x': 1, 'y': 1}, {'x': 0, 'y': 1}],
    'evidence': ['Synthetic fixture: door proportions supply an assumed scale cue.'],
    'uncertainty': 'This fixture is for software QA, not real-room measurement validation.', 'confidence': 'low',
    'features': [{'label': 'Back window', 'kind': 'window', 'x': .35, 'z': 0, 'observation': 'A window is visible on the back wall.'}],
    'zones': [{'id': 'door', 'label': 'Door access', 'kind': 'access', 'x': 3, 'z': 0, 'width': 1, 'depth': 1}],
    'ideas': ['Add a sofa, a desk, and a plant for a calm creative room'],
    'image_url': image_url, 'image_width': 1000, 'image_height': 750,
}
design = {
    'title': 'A room for slow mornings', 'summary': 'A bright work spot and a quiet place to unwind, with the centre open.',
    'items': [
        {'id': 'sofa', 'kind': 'sofa', 'label': 'Sage sofa', 'width': 1.8, 'depth': .85, 'height': .85, 'color': '#7d8e73'},
        {'id': 'desk', 'kind': 'desk', 'label': 'Writing desk', 'width': 1.2, 'depth': .6, 'height': .75, 'color': '#b59a73'},
        {'id': 'plant', 'kind': 'plant', 'label': 'Corner plant', 'width': .55, 'depth': .55, 'height': 1.3, 'color': '#6f8c56'},
    ],
    'placements': [
        {'itemId': 'sofa', 'x': 0, 'z': 2.7, 'rotation': 0, 'reason': 'Along the left side to make a separate lounging area.'},
        {'itemId': 'desk', 'x': .6, 'z': 0, 'rotation': 0, 'reason': 'Under the visible window for a brighter work spot.'},
        {'itemId': 'plant', 'x': 3.3, 'z': 4.3, 'rotation': 0, 'reason': 'In the rear corner of the plan, away from the door reservation.'},
    ], 'tradeoffs': ['Furniture uses editable example sizes. Photo estimates can differ from the actual room.'],
}


if args.recording:
    recording = json.loads(Path(args.recording).read_text(encoding='utf-8'))
    survey, design = recording['survey'], recording['design']
    fixture = root / recording['photo']
first_item = design['items'][0]['label']


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(root / 'dist')))
threading.Thread(target=server.serve_forever, daemon=True).start()
report = {'scope': 'Production Chromium UI; real photograph and recorded live AI result replayed.' if args.recording else 'Production Chromium UI; synthetic photo and mocked AI responses. No physical accuracy claim.', 'viewports': []}
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, **({'executable_path': args.browser} if args.browser else {}))
        try:
            for width in [320, 390, 1440]:
                context = browser.new_context(viewport={'width': width, 'height': 950}, service_workers='block', reduced_motion='reduce')
                page = context.new_page()
                errors, calls = [], []
                page.on('pageerror', lambda error: errors.append(str(error)))

                def api(route):
                    path = route.request.url.split('/api/')[-1]
                    calls.append(path)
                    if path == 'ai/room/survey':
                        assert route.request.post_data_json['image_url'].startswith('data:image/')
                        route.fulfill(json=survey)
                    elif path == 'ai/room/design':
                        body = route.request.post_data_json
                        assert body['zones'] == survey['zones']
                        assert body['goal'] == 'A sofa, desk and plant'
                        route.fulfill(json=design)
                    else:
                        route.fulfill(status=503, json={'detail': 'Unexpected API request in isolated room test.'})

                page.route('**/api/**', api)
                page.goto(f'http://127.0.0.1:{server.server_port}/#/room')
                expect(page.get_by_role('heading', name='Room planner', exact=True)).to_be_visible()
                expect(page.get_by_label('Room width', exact=True)).to_have_count(0)
                page.screenshot(path=str(output / f'entry-{width}.png'))
                page.get_by_label('Choose room photo library input').set_input_files(str(fixture))
                expect(page.get_by_text(survey['summary'], exact=True)).to_be_visible(timeout=15000)
                expect(page.get_by_label('Room width', exact=True)).to_have_count(0)
                expect(page.get_by_label('I checked the dimensions and reserved areas')).to_have_count(0)
                page.get_by_label('What would make this room yours?').fill('A sofa, desk and plant')
                page.get_by_role('button', name='Design my room', exact=True).click()
                expect(page.get_by_text(design['title'], exact=True)).to_be_visible(timeout=15000)
                expect(page.get_by_role('button', name=f'Select {first_item} footprint', exact=True)).to_be_visible()
                assert page.locator('.room-photo-furniture').evaluate('(c) => c.getContext("2d").getImageData(0,0,c.width,c.height).data.some((v,i)=>i%4===3&&v>0)'), 'No furniture pixels rendered'
                page.get_by_role('button', name='Compare', exact=True).click()
                page.get_by_label('Compare original and furnished room').fill('60')
                page.locator('#room-plan-stage').screenshot(path=str(output / f'compare-{width}.png'))
                page.get_by_role('button', name='With furniture plan', exact=True).click()
                with page.expect_download() as download_info:
                    page.get_by_role('button', name='Save concept', exact=True).click()
                download_info.value.save_as(str(output / f'concept-{width}.png'))
                page.locator('#room-plan-stage').screenshot(path=str(output / f'plan-{width}.png'))
                page.locator('#room-designer').screenshot(path=str(output / f'designer-{width}.png'))
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), 'Horizontal overflow'
                before = page.evaluate("JSON.parse(localStorage.getItem('worldos.device.room.v1'))")
                assert before['source'] == 'photo' and len(before['manual']) == len(design['items'])
                page.get_by_role('button', name='Photo plan', exact=True).click()
                expect(page.get_by_role('button', name=f'Select {first_item} footprint')).to_be_visible()
                page.get_by_role('button', name='Original photo', exact=True).click()
                expect(page.get_by_role('button', name=f'Select {first_item} footprint')).to_have_count(0)
                page.get_by_role('button', name='With furniture plan', exact=True).click()
                expect(page.get_by_role('button', name=f'Select {first_item} footprint')).to_be_visible()
                page.get_by_role('button', name='Floor plan', exact=True).click()
                for zone in survey['zones']:
                    expect(page.get_by_role('button', name=f"Move reserved {zone['label']}", exact=True)).to_be_visible()
                page.get_by_role('button', name='3D room', exact=True).click()
                page.locator('#room-plan-stage').screenshot(path=str(output / f'3d-{width}.png'))
                page.reload()
                expect(page.get_by_text(design['title'], exact=True)).to_be_visible()
                expect(page.get_by_text(survey['summary'], exact=True)).to_be_visible()
                after = page.evaluate("JSON.parse(localStorage.getItem('worldos.device.room.v1'))")
                assert after['manual'] == before['manual']
                assert calls == ['ai/room/survey', 'ai/room/design'], calls
                assert not errors, errors
                report['viewports'].append({'width': width, 'passed': True, 'api_calls': calls})
                context.close()
        finally:
            browser.close()
finally:
    server.shutdown()
(output / 'report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report, indent=2))
