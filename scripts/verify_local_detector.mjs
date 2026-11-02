// Real on-device model; synthetic camera feed from the bundled public photo.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const arg=name=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
const moduleDir=arg('--playwright-dir');
const {chromium}=await import(moduleDir?pathToFileURL(path.resolve(moduleDir,'index.mjs')).href:'playwright');
const output=path.resolve('artifacts/v24');await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:390,height:900}});
const report={scope:'Real local EfficientDet model on a synthetic camera using a public desk image. Cloud inference blocked. Desktop Chromium, not a phone benchmark.'};
const external=[],errors=[];
page.on('request',request=>{if(new URL(request.url()).hostname!=='127.0.0.1')external.push(request.url());});
page.on('pageerror',error=>errors.push(error.message));
page.on('console',msg=>{if(msg.type()==='error')console.error(msg.text().slice(0,240));});
try{
  // Use the real production policy on the page and its dedicated worker.
  const security=await fs.readFile('backend/security.py','utf8');
  const policy=security.match(/response.headers\['Content-Security-Policy'\] = "([^"]+)"/)[1];
  for(const pattern of ['http://127.0.0.1:8000/','**/vision-worker.js'])await page.route(pattern,async route=>{
    const response=await route.fetch();await route.fulfill({response,headers:{...response.headers(),'Content-Security-Policy':policy}});
  });
  await page.route('**/api/**',route=>{
    const endpoint=new URL(route.request().url()).pathname;
    if(endpoint.endsWith('/auth/status'))return route.fulfill({json:{required:false,authenticated:true,access:'owner'}});
    if(endpoint.endsWith('/ai/live'))return route.fulfill({status:503,json:{detail:'Cloud deliberately unavailable in local-model test'}});
    return route.fulfill({json:{templates:[],missions:[],routines:[],status:'ok'}});
  });
  await page.addInitScript(()=>{
    window.__vision={ready:false,frames:0,results:[],roundTrips:[],loads:[],sent:{}};
    const OriginalWorker=window.Worker;
    window.Worker=class extends OriginalWorker{
      constructor(...args){super(...args);this.addEventListener('message',event=>{
        const data=event.data;
        if(data.type==='ready'){window.__vision.ready=true;window.__vision.loads.push(data.loadMs);}
        if(data.type==='error')window.__vision.error=data.message;
        if(data.type==='result'){window.__vision.results.push(data.latencyMs);window.__vision.roundTrips.push(performance.now()-window.__vision.sent[data.id]);}
      });}
      postMessage(data,...args){if(data.type==='frame'){window.__vision.frames++;window.__vision.sent[data.id]=performance.now();}return super.postMessage(data,...args);}
    };
    navigator.mediaDevices.getUserMedia=async()=>{
      const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=854;
      const ctx=canvas.getContext('2d'),photo=new Image();photo.src='/desk-preview.webp';await photo.decode();
      window.__showBlank=blank=>{ctx.fillStyle='#1d2230';ctx.fillRect(0,0,1280,854);if(!blank)ctx.drawImage(photo,0,0,1280,854);};
      window.__showBlank(false);return canvas.captureStream(30);
    };
  });
  await page.goto('http://127.0.0.1:8000/#/live');
  await page.waitForFunction(()=>window.__vision.ready||window.__vision.error,{},{timeout:25000});
  assert.equal(await page.evaluate(()=>window.__vision.error),undefined);
  const start=performance.now();await page.getByRole('button',{name:'Open camera & recognize'}).click();
  await page.locator('.camera-object').first().waitFor({timeout:5000});
  report.firstLabelAfterStartMs=Math.round(performance.now()-start);
  await page.waitForFunction(()=>window.__vision.results.length>=15);
  report.labels=await page.locator('.camera-object').allTextContents();
  assert.ok(report.labels.some(label=>/keyboard|laptop|mouse|phone/i.test(label)),JSON.stringify(report.labels));
  const selected=page.locator('.camera-object').first();await selected.click();await page.waitForTimeout(500);
  assert.equal(await selected.getAttribute('aria-pressed'),'true');
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:path.join(output,'local-labels-390.png'),fullPage:true});
  await page.evaluate(()=>window.__showBlank(true));
  await page.waitForFunction(()=>document.querySelectorAll('.camera-object:not(.is-remembered)').length===0);
  await page.evaluate(()=>window.__showBlank(false));
  await page.locator('.camera-object:not(.is-remembered)').first().waitFor();
  await page.getByRole('button',{name:'Stop camera',exact:true}).click();
  const count=await page.evaluate(()=>window.__vision.frames);await page.waitForTimeout(800);
  assert.equal(await page.evaluate(()=>window.__vision.frames),count);
  report.metrics=await page.evaluate(()=>window.__vision);
  delete report.metrics.sent;
  assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
  report.externalRequests=external.length;report.productionCsp=true;report.selectionSurvivesRefresh=true;report.disappearedOnBlank=true;report.stopped=true;report.passed=true;
}catch(error){report.error=String(error);report.metrics=await page.evaluate(()=>window.__vision).catch(()=>null);await page.screenshot({path:path.join(output,'failure.png'),fullPage:true});throw error;}
finally{await fs.writeFile(path.join(output,'local-model-results.json'),JSON.stringify(report,null,2)+'\n');await browser.close();}
console.log(JSON.stringify(report,null,2));
