"""Production UI QA with a synthetic camera; physical scale comes from entered dimensions."""
import argparse
import json
from pathlib import Path
from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright, expect

parser=argparse.ArgumentParser()
parser.add_argument('--url',default='http://127.0.0.1:5173')
parser.add_argument('--browser')
args=parser.parse_args()
output=Path('artifacts/room-planning')
output.mkdir(parents=True,exist_ok=True)
photo=Image.new('RGB',(1000,750),'#e7e8df')
draw=ImageDraw.Draw(photo)
draw.polygon([(200,160),(800,160),(960,700),(40,700)],fill='#cab99c',outline='#6f765d',width=5)
draw.text((25,20),'SYNTHETIC ROOM FIXTURE - enter real dimensions for your room',fill='black')
fixture=output/'room-fixture.jpg'
photo.save(fixture)
report={'scope':'Desktop Chromium with a synthetic camera/photo. Manual measured area and modeled reservations; no physical-device accuracy claim.','viewports':[]}

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,**({'executable_path':args.browser} if args.browser else {}))
    try:
        for width in [320,390,1440]:
            context=browser.new_context(viewport={'width':width,'height':950},service_workers='block',reduced_motion='reduce')
            page=context.new_page()
            errors,calls=[],[]
            page.on('pageerror',lambda e:errors.append(str(e)))
            def reject_api(route):
                calls.append(route.request.url)
                route.fulfill(status=401,json={'detail':'No private backend during device test'})
            page.route('**/api/**',reject_api)
            page.add_init_script("""navigator.mediaDevices.getUserMedia=async()=>{
              const canvas=document.createElement('canvas');canvas.width=1000;canvas.height=750;
              const ctx=canvas.getContext('2d');ctx.fillStyle='#cbb99a';ctx.fillRect(0,0,1000,750);
              const image=new Image();image.src='/desk-preview.webp';await image.decode();ctx.drawImage(image,0,0,1000,750);
              const stream=canvas.captureStream(30);window.__roomTrack=stream.getVideoTracks()[0];return stream;
            };""")
            page.goto(args.url+'/#/room')
            page.get_by_role('button',name='Use camera',exact=True).click()
            expect(page.get_by_role('button',name='Capture this area',exact=True)).to_be_visible(timeout=15000)
            page.wait_for_function("document.querySelector('video[aria-label=\"Room camera preview\"]').videoWidth>0")
            page.get_by_role('button',name='Capture this area',exact=True).click()
            expect(page.get_by_alt_text('Your captured room with a floor outline and proposed furniture footprints')).to_be_visible()
            assert page.evaluate('window.__roomTrack.readyState')=='ended'
            page.get_by_label('Room width',exact=True).fill('2')
            page.get_by_label('Room length',exact=True).fill('2')
            page.get_by_label('Ceiling height',exact=True).fill('1.5')
            page.get_by_label('I checked the dimensions and reserved areas').check()
            expect(page.get_by_role('button',name='Add suggested Compact desk',exact=True)).to_have_count(0)
            floor=page.get_by_role('group',name='Outline the measured floor area')
            box=floor.bounding_box()
            for x,y in [(0.2,0.2),(0.8,0.2),(0.95,0.9),(0.05,0.9)]:
                floor.click(position={'x':box['width']*x,'y':box['height']*y})
            page.get_by_role('button',name='Reserve a door or occupied area').click()
            page.get_by_label('Reserved area 1 name').fill('Door path')
            page.get_by_label('Reserved area 1 width').fill('0.8')
            page.get_by_label('I checked the dimensions and reserved areas').check()
            expect(page.get_by_role('button',name='Add suggested Compact desk',exact=True)).to_be_visible()
            expect(page.get_by_role('button',name='Add suggested Wardrobe',exact=True)).to_have_count(0)
            page.get_by_role('button',name='Add suggested Compact desk',exact=True).click()
            expect(page.get_by_role('button',name='Select Compact desk footprint')).to_be_visible()
            before=page.evaluate("JSON.parse(localStorage.getItem('worldos.device.room.v1')).manual")
            page.get_by_role('button',name='Add suggested Side table',exact=True).click()
            after=page.evaluate("JSON.parse(localStorage.getItem('worldos.device.room.v1')).manual")
            assert after[0]==before[0], (before,after)
            assert len(after)==2
            page.get_by_role('button',name='Floor plan',exact=True).click()
            path=page.get_by_role('button',name='Move reserved Door path')
            expect(path).to_be_visible()
            path.press('ArrowRight')
            expect(page.get_by_label('I checked the dimensions and reserved areas')).not_to_be_checked()
            page.get_by_label('Reserved area 1 from left').fill('0')
            page.get_by_label('Reserved area 1 width').fill('3')
            page.get_by_label('I checked the dimensions and reserved areas').check()
            expect(page.get_by_role('button',name='Add suggested Compact desk',exact=True)).to_have_count(0)
            expect(page.get_by_text('Resolve the measurements or placement conflicts listed in Room plan issues.',exact=False)).to_be_visible()
            page.get_by_label('Reserved area 1 width').fill('0.8')
            page.get_by_label('I checked the dimensions and reserved areas').check()
            page.get_by_role('button',name='Photo plan',exact=True).click()
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'), f'overflow {width}'
            page.screenshot(path=str(output/f'photo-plan-{width}.png'),full_page=True)
            page.reload()
            page.get_by_role('button',name='Photo plan',exact=True).click()
            expect(page.get_by_role('button',name='Select Compact desk footprint')).to_be_visible()
            expect(page.get_by_role('button',name='Select Side table footprint')).to_be_visible()
            expect(page.get_by_label('Reserved area 1 name')).to_have_value('Door path')
            page.get_by_role('button',name='3D room',exact=True).click()
            expect(page.get_by_role('button',name='Edit Compact desk',exact=True)).to_be_visible()
            page.screenshot(path=str(output/f'3d-plan-{width}.png'),full_page=True)
            page.get_by_role('button',name='Start a fresh arrangement',exact=True).click()
            expect(page.get_by_role('button',name='Photo plan',exact=True)).to_have_count(0)
            expect(page.get_by_label('Reserved area 1 name')).to_have_count(0)
            page.reload()
            expect(page.get_by_role('button',name='Photo plan',exact=True)).to_have_count(0)
            page.evaluate("() => {navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('Camera denied for fallback test','NotAllowedError');};}")
            page.get_by_role('button',name='Use camera',exact=True).click()
            expect(page.get_by_text('Camera access was not allowed. Enable camera permission for this site, then try again.',exact=True)).to_be_visible()
            page.get_by_label('Choose room photo library input').set_input_files(fixture)
            expect(page.get_by_alt_text('Your captured room with a floor outline and proposed furniture footprints')).to_be_visible()
            expect(page.get_by_role('button',name='Set corners with controls')).to_be_visible()
            assert errors==[],errors
            assert calls==[],calls
            report['viewports'].append({'width':width,'camera_capture_and_stop':True,'measured_suggestions':True,'reserved_areas':True,'stable_existing_placement':True,'photo_overlay':True,'reload_and_reset':True,'camera_denied_upload_fallback':True,'private_api_calls':0})
            context.close()
        context=browser.new_context(service_workers='block')
        page=context.new_page()
        page.goto(args.url+'/offline.html')
        page.evaluate("""() => new Promise((resolve,reject)=>{
          const request=indexedDB.open('worldos-device',1);
          request.onupgradeneeded=()=>request.result.createObjectStore('spaces',{keyPath:'id'});
          request.onerror=()=>reject(request.error);
          request.onsuccess=()=>{const db=request.result,tx=db.transaction('spaces','readwrite');
            tx.objectStore('spaces').put({id:'legacy',name:'Legacy saved setup',notes:'Preserved through upgrade',photo:'',after:'',steps:[],updatedAt:new Date().toISOString()});
            tx.oncomplete=()=>{db.close();resolve(true);};};
        })""")
        page.goto(args.url+'/#/room')
        page.get_by_role('button',name='Start with measurements').click()
        page.get_by_label('Room width',exact=True).fill('2')
        page.get_by_label('Room length',exact=True).fill('2')
        page.goto(args.url+'/#/history')
        expect(page.get_by_role('button',name='Legacy saved setup 0 of 0 steps complete',exact=True)).to_be_visible()
        report['existing_device_data_preserved_on_upgrade']=True
        context.close()
        report['passed']=True
    except Exception as error:
        report['error']=str(error)
        page.screenshot(path=str(output/'failure.png'),full_page=True)
        raise
    finally:
        (output/'report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
        browser.close()
print(json.dumps(report,indent=2))
