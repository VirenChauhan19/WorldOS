// Browser integration checks with a synthetic camera and explicitly mocked AI.
// No physical camera permission or external provider call is used.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const option = name => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
const moduleDir = option('--playwright-dir');
const { chromium } = await import(moduleDir ? pathToFileURL(path.resolve(moduleDir, 'index.mjs')).href : 'playwright');
const baseURL = option('--base-url') ?? 'http://127.0.0.1:5173';
const output = path.resolve('artifacts/v18');
await fs.mkdir(output, { recursive: true });
const fixture = {
  objects: [
    {id:'phone',label:'smartphone',box:{x:.4375,y:.6484,width:.06875,height:.211},locked:false,confidence:.94,source:'sam_3_1'},
    {id:'mouse',label:'mouse',box:{x:.5542,y:.7406,width:.0833,height:.1734},locked:false,confidence:.96,source:'sam_3_1'},
    {id:'keyboard',label:'keyboard',box:{x:.5354,y:.4547,width:.4042,height:.1656},locked:false,confidence:.97,source:'sam_3_1'},
  ],concepts:['smartphone','mouse','keyboard'],summary:'A smartphone, keyboard and mouse are visible on the desk.',warnings:[],message:'Synthetic browser test response.',provider:'fixture',model:'SAM fixture',live_request:false,concept_discovery:{model:'Muse fixture',live_request:false},unmatched_concepts:[],total_objects:3,truncated:false,
};
const browser = await chromium.launch({ headless:true });
const report = {scope:'Chromium software integration with a canvas camera and mocked AI. No physical device or model accuracy claim.',viewports:[],cases:[]};
try {
  for (const width of [320,390,768,1440]) {
    const context = await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let requests = 0, mode = 'success';
    await page.route('**/api/**',async route=>{
      const endpoint=new URL(route.request().url()).pathname;
      if(endpoint.endsWith('/auth/status'))return route.fulfill({json:{required:false,authenticated:true,access:'owner'}});
      if(endpoint.endsWith('/ai/analyze')){
        requests++;
        const body=route.request().postDataJSON();
        assert.deepEqual(body.concepts,[]);assert.equal(body.purpose,'live');
        assert.ok(body.image_url.startsWith('data:image/jpeg;base64,'));
        if(mode==='permanent')return route.fulfill({status:502,headers:{'X-WorldOS-Error-Code':'unsupported_model_access'},json:{detail:'The model is unavailable for this account.'}});
        if(mode==='temporary') {mode='success';return route.fulfill({status:503,headers:{'X-WorldOS-Error-Code':'network_error'},json:{detail:'Temporary connection problem.'}});}
        await new Promise(resolve=>setTimeout(resolve,mode==='slow'?2500:100));
        return route.fulfill({json:fixture});
      }
      return route.fulfill({json:{templates:[],status:'ok'}});
    });
    await page.addInitScript(({portrait})=>{
      window.__cameraStreams=[];
      navigator.mediaDevices.getUserMedia=async()=>{
        if(window.__denyCamera)throw new DOMException('Synthetic permission failure','NotAllowedError');
        const canvas=document.createElement('canvas');canvas.width=portrait?720:1280;canvas.height=portrait?1280:854;
        const ctx=canvas.getContext('2d');
        const photo=new Image();photo.src='/desk-preview.webp';await photo.decode();
        ctx.drawImage(photo,0,0,canvas.width,canvas.height);
        window.__moveCamera=()=>{ctx.fillStyle='#859b54';ctx.fillRect(0,0,canvas.width,canvas.height);};
        const stream=canvas.captureStream(5);window.__cameraStreams.push(stream);
        return stream;
      };
    },{portrait:width===768});
    await page.goto(`${baseURL}/#/live`);
    await page.getByRole('button',{name:'Detailed Steady SAM scan'}).click();
    await page.getByRole('button',{name:'Open camera & recognize'}).click();
    await page.getByRole('heading',{name:'3 items located'}).waitFor();
    const item=page.getByRole('group',{name:'Recognized items'}).getByRole('button',{name:/smartphone/});
    await item.click();
    assert.equal(await page.getByRole('button',{name:'Highlight smartphone in camera'}).getAttribute('aria-pressed'),'true');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
    assert.ok(await page.evaluate(()=>{const video=document.querySelector('.live-video-wrap').getBoundingClientRect();const viewer=document.querySelector('.live-viewer').getBoundingClientRect();return video.width<=viewer.width+1&&video.height<=viewer.height-60;}),'Entire video and matching overlays fit the viewer in both orientations.');
    await page.screenshot({path:path.join(output,`camera-${width}.png`),fullPage:true});
    if(width===390){
      await page.waitForTimeout(13000);assert.equal(requests,1);
      mode='slow';
      await page.getByRole('button',{name:'Scan this view again'}).click();
      await page.waitForFunction(()=>document.querySelector('.scene-understanding')?.getAttribute('aria-busy')==='true');
      await page.evaluate(()=>window.__moveCamera());
      await page.getByAltText('The captured camera frame used for these recognition results').waitFor();
      assert.equal(await page.getByRole('button',{name:'Highlight smartphone in camera'}).count(),0);
      await page.screenshot({path:path.join(output,'captured-view-390.png'),fullPage:true});
      report.cases.push('unchanged scene sends one request','camera motion clears live overlays and retains captured results');
    }
    await page.getByRole('button',{name:'Stop camera',exact:true}).click();
    assert.ok(await page.evaluate(()=>window.__cameraStreams.every(stream=>stream.getTracks().every(track=>track.readyState==='ended'))));
    assert.equal(await page.getByRole('group',{name:'Recognized items'}).count(),0);
    if(width===390){
      await page.evaluate(()=>{window.__denyCamera=true;});
      await page.getByRole('button',{name:'Open camera & recognize'}).click();
      await page.getByText(/Camera access was not allowed/).waitFor();
      await page.evaluate(()=>{window.__denyCamera=false;});mode='temporary';
      await page.getByRole('button',{name:'Retry camera',exact:true}).click();
      await page.getByRole('heading',{name:'Reconnecting to recognition…'}).waitFor();
      await page.getByRole('heading',{name:'3 items located'}).waitFor({timeout:15000});
      mode='permanent';
      await page.getByRole('button',{name:'Scan this view again'}).click();
      await page.getByRole('heading',{name:'Recognition needs attention'}).waitFor();
      const failedCount=requests;await page.waitForTimeout(4000);assert.equal(requests,failedCount);
      await page.getByRole('button',{name:'Back to home',exact:true}).click();
      assert.ok(await page.evaluate(()=>window.__cameraStreams.every(stream=>stream.getTracks().every(track=>track.readyState==='ended'))));
      report.cases.push('camera permission recovery','temporary recognition failure retries automatically','permanent model failure pauses','navigation stops every camera track');
    }
    assert.deepEqual(errors,[]);
    report.viewports.push({width,height:900,horizontalOverflow:false,pageErrors:errors,cameraStopped:true});
    await context.close();
  }
  report.passed=true;
} finally {
  await browser.close();
  await fs.writeFile(path.join(output,'browser-results.json'),JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify(report,null,2));
