"""Isolated Chromium QA: device persistence and real local model on a synthetic camera.

Run against a production build served locally; no backend or real camera required.
"""
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect


parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:5173')
parser.add_argument('--browser', default=None)
args = parser.parse_args()
output = Path('artifacts/device-app')
output.mkdir(parents=True, exist_ok=True)
report = {'scope': 'Isolated Chromium, recorded example and synthetic camera feed; no physical-phone benchmark.', 'viewports': []}

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, **({'executable_path': args.browser} if args.browser else {}))
    try:
        for width in [320, 390, 1440]:
            context = browser.new_context(viewport={'width': width, 'height': 900}, service_workers='block')
            page = context.new_page()
            errors, private_calls = [], []
            page.on('pageerror', lambda error: errors.append(str(error)))
            def private_route(route):
                private_calls.append(route.request.url)
                route.fulfill(json={'required': True, 'authenticated': False})
            page.route('**/api/**', private_route)
            page.goto(args.url)
            expect(page.get_by_role('heading', name='Your space, in focus.')).to_be_visible()
            expect(page.get_by_label('Workspace passphrase')).to_have_count(0)
            page.get_by_role('button', name='Open live camera', exact=True).click()
            page.get_by_role('button', name='Try an interactive example').click()
            expect(page.get_by_alt_text('Recorded desk example')).to_be_visible()
            rail = page.get_by_role('group', name='Quick object selection')
            rail.get_by_role('button', name='smartphone', exact=True).click()
            expect(rail.get_by_role('button', name='smartphone', exact=True)).to_have_attribute('aria-pressed', 'true')
            page.get_by_role('button', name='Hide labels', exact=True).click()
            expect(page.get_by_role('button', name='Highlight smartphone in camera')).to_have_count(0)
            page.get_by_role('button', name='Show labels', exact=True).click()
            expect(page.get_by_role('button', name='Highlight smartphone in camera')).to_be_visible()
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), f'Horizontal overflow at {width}'
            page.screenshot(path=str(output / f'live-{width}.png'), full_page=True)
            page.get_by_role('button', name='Check fit', exact=True).click()
            expect(page.get_by_label('Item name')).to_have_value('smartphone')
            expect(page.get_by_label('Item width')).to_have_value('')
            page.get_by_role('button', name='Save view', exact=True).click()
            expect(page.get_by_text('Saved on this device in My Spaces.', exact=True)).to_be_visible()
            page.get_by_role('button', name='Open saved view').click()
            page.get_by_label('Setup name').fill(f'QA desk {width}')
            page.get_by_label('Setup notes').fill('A saved example for a reload check.')
            page.get_by_role('button', name='Add a step', exact=True).click()
            page.get_by_label('Step 1', exact=True).fill('Put my notebook by the keyboard.')
            page.get_by_label('Complete step 1').check()
            page.get_by_role('button', name='Save on this device').click()
            expect(page.get_by_text('Saved on this device. You can come back after reloading.', exact=True)).to_be_visible()
            page.reload()
            expect(page.get_by_label('Setup name')).to_have_value(f'QA desk {width}')
            expect(page.get_by_label('Complete step 1')).to_be_checked()
            expect(page.get_by_alt_text('Your saved reference setup')).to_be_visible()
            with page.expect_download() as download:
                page.get_by_role('button', name='Export backup').click()
            backup = output / f'setup-{width}.json'
            download.value.save_as(backup)
            content = json.loads(backup.read_text(encoding='utf-8'))
            assert content['space']['photo'].startswith('data:image/webp;base64,')
            assert content['space']['steps'][0]['done'] is True
            page.get_by_role('button', name='My Spaces', exact=True).click()
            page.get_by_label('Restore device setup backup').set_input_files(backup)
            expect(page.get_by_role('button', name=f'QA desk {width} 1 of 1 steps complete', exact=True)).to_have_count(2)
            page.screenshot(path=str(output / f'saved-{width}.png'), full_page=True)
            page.get_by_role('button', name='New setup', exact=True).click()
            page.get_by_label('Setup name').fill(f'New checklist {width}')
            page.get_by_role('button', name='Save on this device').click()
            page.wait_for_url('**/#/mission?device=*')
            page.reload()
            expect(page.get_by_label('Setup name')).to_have_value(f'New checklist {width}')
            page.get_by_role('button', name='My Spaces', exact=True).click()
            page.get_by_role('button', name='Open my room layout').click()
            page.get_by_role('button', name='I already know my room size').click()
            page.get_by_label('Room width', exact=True).fill('4.2')
            page.get_by_label('Room length', exact=True).fill('5.1')
            page.reload()
            page.get_by_role('button', name='Edit room dimensions').click()
            expect(page.get_by_label('Room width', exact=True)).to_have_value('4.2')
            expect(page.get_by_label('Room length', exact=True)).to_have_value('5.1')
            assert private_calls == [], private_calls
            page.get_by_role('navigation', name='App navigation').get_by_role('button', name='Settings', exact=True).click()
            page.get_by_role('button', name='Open private workspace for cloud AI', exact=True).click()
            expect(page.get_by_label('Workspace passphrase')).to_be_visible()
            assert len(private_calls) >= 1
            page.get_by_role('button', name='Back to device workspace').click()
            expect(page.get_by_label('Workspace passphrase')).to_have_count(0)
            assert errors == [], errors
            report['viewports'].append({'width': width, 'example_interaction': True, 'photo_and_progress_reload': True, 'backup_restore': True, 'room_reload': True, 'private_calls_before_opt_in': 0})
            context.close()

        context = browser.new_context(viewport={'width': 390, 'height': 900}, service_workers='block')
        page = context.new_page()
        calls, errors = [], []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.route('**/api/**', lambda route: (calls.append(route.request.url), route.fulfill(status=401, json={'detail': 'Private access blocked during device test'})))
        page.add_init_script("""navigator.mediaDevices.getUserMedia=async()=>{
          const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=854;
          const ctx=canvas.getContext('2d'),photo=new Image();photo.src='/desk-preview.webp';await photo.decode();
          ctx.drawImage(photo,0,0,1280,854);const stream=canvas.captureStream(30);
          window.__deviceTestTrack=stream.getVideoTracks()[0];return stream;
        };""")
        page.goto(args.url + '/#/live')
        page.get_by_role('button', name='Open camera & recognize').click()
        page.locator('.camera-object').first.wait_for(timeout=45000)
        report['local_model_labels'] = page.locator('.camera-object').all_text_contents()
        page.get_by_role('group', name='Quick object selection').get_by_role('button').first.click()
        expect(page.get_by_alt_text('Held camera view')).to_be_visible()
        page.get_by_role('button', name='Resume live', exact=True).click()
        expect(page.get_by_alt_text('Held camera view')).to_have_count(0)
        page.get_by_role('button', name='Save view', exact=True).click()
        expect(page.get_by_text('Saved on this device in My Spaces.', exact=True)).to_be_visible()
        page.screenshot(path=str(output / 'real-model-held-view.png'), full_page=True)
        page.get_by_role('button', name='Stop camera', exact=True).click()
        assert page.evaluate('window.__deviceTestTrack.readyState') == 'ended'
        assert calls == [], calls
        assert errors == [], errors
        report['real_model_synthetic_camera'] = {'tap_holds_view': True, 'resume': True, 'save': True, 'track_stopped': True, 'cloud_requests': 0}
        report['passed'] = True
        context.close()
    except Exception as error:
        report['error'] = str(error)
        page.screenshot(path=str(output / 'failure.png'), full_page=True)
        raise
    finally:
        (output / 'report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
        browser.close()
print(json.dumps(report, indent=2))
