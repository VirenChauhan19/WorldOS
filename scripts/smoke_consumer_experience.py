"""Consumer journey checks in isolated Chromium. No physical camera or cloud inference."""
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

parser=argparse.ArgumentParser()
parser.add_argument('--url',default='http://127.0.0.1:5173')
parser.add_argument('--browser')
args=parser.parse_args()
output=Path('artifacts/consumer-experience');output.mkdir(parents=True,exist_ok=True)
report={'scope':'Production browser UI at mobile and desktop sizes, recorded camera example, real device storage; no physical-device testing.','viewports':[]}
def capture(page, name):
    page.evaluate('window.scrollTo(0, 0)')
    page.screenshot(path=str(output/name),full_page=True)

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,**({'executable_path':args.browser} if args.browser else {}))
    try:
        for width in [320,390,1440]:
            context=browser.new_context(viewport={'width':width,'height':950},reduced_motion='reduce',service_workers='block')
            page=context.new_page();errors=[];calls=[]
            page.on('pageerror',lambda e:errors.append(str(e)))
            def reject_private(route):
                calls.append(route.request.url);route.fulfill(status=401,json={'detail':'Device experience must not need private requests'})
            page.route('**/api/**',reject_private)
            page.goto(args.url)
            nav=page.get_by_role('navigation',name='App navigation')
            expect(nav).to_be_visible()
            expect(page.get_by_role('button',name='Open private workspace',exact=True)).to_have_count(0)
            expect(page.get_by_role('button',name='Open live camera',exact=True)).to_be_visible()
            capture(page,f'home-{width}.png')
            page.get_by_role('button',name='Try the camera example',exact=True).click()
            expect(page.get_by_alt_text('Recorded desk example')).to_be_visible()
            dock=page.get_by_role('group',name='Camera actions')
            expect(dock.get_by_role('button',name='Save view',exact=True)).to_be_visible()
            expect(nav).to_be_visible()
            page.get_by_role('group',name='Quick object selection').get_by_role('button',name='smartphone',exact=True).click()
            expect(page.get_by_role('button',name='Clear selected object')).to_be_visible()
            capture(page,f'camera-{width}.png')
            for button in dock.get_by_role('button').all():
                box=button.bounding_box();assert box['height']>=44 and box['width']>=44,box
            nav.get_by_role('button',name='Room',exact=True).click()
            expect(page.get_by_role('navigation',name='Room planning steps')).to_be_visible()
            page.get_by_role('button',name='Try an example room',exact=True).click()
            example=page.get_by_role('dialog',name='Room plan example')
            expect(example).to_be_visible()
            example.get_by_role('button',name='Desk',exact=False).click()
            capture(page,f'room-example-{width}.png')
            example.get_by_role('button',name='Plan my own space',exact=True).click()
            expect(page.get_by_label('Room width',exact=True)).to_have_value('')
            page.get_by_label('Room width',exact=True).fill('2')
            page.get_by_label('Room length',exact=True).fill('2')
            page.get_by_label('I checked the dimensions and reserved areas').check()
            page.get_by_role('button',name='Add suggested Compact desk',exact=True).click()
            expect(page.get_by_role('heading',name='1 item fits this area')).to_be_visible()
            expect(page.get_by_text('Adjust size, finish & spacing',exact=True)).to_be_visible()
            assert not page.locator('.room-fine-controls').evaluate('(el)=>el.open')
            capture(page,f'room-{width}.png')
            nav.get_by_role('button',name='My Spaces',exact=True).click()
            expect(page.get_by_role('button',name='Continue my room plan')).to_be_visible()
            page.get_by_role('button',name='New setup',exact=True).click()
            expect(page.locator('input[type=file]:visible')).to_have_count(0)
            page.get_by_label('Setup name').fill(f'My everyday desk {width}')
            page.get_by_label('Setup notes').fill('Leave the space ready for a fresh start.')
            page.get_by_label('Complete step 1').check()
            nav.get_by_role('button',name='My Spaces',exact=True).click()
            saved=page.get_by_role('button',name=f'My everyday desk {width} 1 of 3 steps complete',exact=True)
            expect(saved).to_be_visible()
            saved.click()
            expect(page.get_by_label('Setup notes')).to_have_value('Leave the space ready for a fresh start.')
            page.reload()
            expect(page.get_by_label('Setup name')).to_have_value(f'My everyday desk {width}')
            expect(page.get_by_label('Complete step 1')).to_be_checked()
            nav.get_by_role('button',name='My Spaces',exact=True).click()
            expect(saved).to_be_visible()
            expect(page.get_by_role('button',name='Continue my room plan')).to_be_visible()
            capture(page,f'saved-{width}.png')
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),f'horizontal overflow {width}'
            nav.get_by_role('button',name='Home',exact=True).click()
            page.get_by_role('button',name='Try the camera example',exact=True).click()
            expect(page.get_by_alt_text('Recorded desk example')).to_be_visible()
            dock.get_by_role('button',name='Close example',exact=True).click()
            expect(page.get_by_role('button',name='Open camera & recognize',exact=True)).to_be_visible()
            assert calls==[],calls
            assert errors==[],errors
            report['viewports'].append({'width':width,'clear_home_actions':True,'persistent_navigation':True,'camera_controls_reachable':True,'non_destructive_room_example':True,'guided_room_plan':True,'saved_room_card':True,'autosave_on_navigation_and_reload':True,'repeat_camera_example':True,'private_requests':0})
            context.close()
        report['passed']=True
    except Exception as e:
        report['error']=str(e)
        page.screenshot(path=str(output/'failure.png'),full_page=True)
        raise
    finally:
        (output/'report.json').write_text(json.dumps(report,indent=2),encoding='utf-8');browser.close()
print(json.dumps(report,indent=2))
