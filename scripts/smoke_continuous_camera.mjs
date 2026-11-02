// Synthetic camera + synthetic AI. Tests UI/tracking, never model accuracy.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const option = name => { const i=process.argv.indexOf(name); return i<0?undefined:process.argv[i+1]; };
const moduleDir=option('--playwright-dir');
const {chromium}=await import(moduleDir?pathToFileURL(path.resolve(moduleDir,'index.mjs')).href:'playwright');
const baseURL=option('--base-url')??'http://127.0.0.1:8000';
const output=path.resolve('artifacts/v22');
await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true});
const report={scope:'Synthetic camera and AI integration. No physical device or recognition accuracy claim.',viewports:[]};
try {
  for(const width of [320,390,768,1440]) {
    const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();
    let requests=0;
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    const objects=[{id:'keyboard',label:'Keyboard',box:{x:.5354,y:.4547,width:.4042,height:.1656},locked:false,source:'muse_spark'}];
    await page.route('**/api/**',async route=>{
      const endpoint=new URL(route.request().url()).pathname;
      if(endpoint.endsWith('/auth/status'))return route.fulfill({json:{required:false,authenticated:true,access:'owner'}});
      if(endpoint.endsWith('/ai/live')){
        requests++;
        assert.ok(route.request().postDataJSON().image_url.startsWith('data:image/jpeg;base64,'));
        await new Promise(resolve=>setTimeout(resolve,500));
        return route.fulfill({json:{objects,concepts:['keyboard'],summary:'A keyboard on the desk.',details:{keyboard:'Light keys on a desk.'},warnings:[],message:'Synthetic response',provider:'fixture',model:'Vision fixture',live_request:false}});
      }
      return route.fulfill({json:{templates:[],status:'ok'}});
    });
    await page.addInitScript(({portrait})=>{
      window.Worker=undefined; // Isolate the cloud fallback/tracking fixture.
      window.__streams=[];
      navigator.mediaDevices.getUserMedia=async()=>{
        const canvas=document.createElement('canvas');canvas.width=portrait?720:1280;canvas.height=portrait?1280:854;
        const ctx=canvas.getContext('2d');const photo=new Image();photo.src='/desk-preview.webp';await photo.decode();
        const draw=dx=>{ctx.fillStyle='#eee';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(photo,dx,0,canvas.width,canvas.height);};draw(0);
        window.__shift=dx=>draw(dx);
        window.__occlude=()=>{ctx.fillStyle='#111';ctx.fillRect(0,0,canvas.width,canvas.height);};
        const stream=canvas.captureStream(30);window.__streams.push(stream);return stream;
      };
    },{portrait:width===768});
    await page.goto(`${baseURL}/#/live`);
    await page.getByRole('button',{name:'Open camera & recognize'}).click();
    const outline=page.getByRole('button',{name:'Highlight Keyboard in camera'});
    await outline.waitFor();
    await outline.click();
    await page.getByText('Light keys on a desk.',{exact:true}).first().waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    const initialLeft=await outline.evaluate(el=>parseFloat(el.style.left));
    await page.evaluate(()=>window.__shift(20));
    await page.waitForFunction(left=>{
      const el=document.querySelector('.camera-object');return el&&parseFloat(el.style.left)>left+.5;
    },initialLeft,{timeout:2000});
    await page.screenshot({path:path.join(output,`live-${width}.png`),fullPage:true});
    await page.getByRole('button',{name:'Expand camera view'}).click();
    assert.equal(await page.getByRole('complementary',{name:'Space and fit controls'}).isVisible(),false);
    assert.ok(await page.evaluate(()=>{const video=document.querySelector('.live-video-wrap').getBoundingClientRect();const tools=document.querySelector('.live-viewer-tools').getBoundingClientRect();return video.bottom<=tools.top+2;}),'Video is not covered by the camera toolbar');
    await page.screenshot({path:path.join(output,`expanded-${width}.png`),fullPage:true});
    await page.getByRole('button',{name:'Show controls'}).click();
    // Verify automatic refresh and a scene cut that removes old live labels.
    await page.waitForFunction(()=>Number(document.querySelector('.live-performance')?.textContent?.includes('Captured'))===1);
    await page.waitForTimeout(3800);assert.ok(requests>=2);
    await page.evaluate(()=>window.__occlude());
    await outline.waitFor({state:'detached',timeout:2000});
    await page.getByRole('button',{name:'Stop camera',exact:true}).click();
    const stopped=requests;await page.waitForTimeout(3600);assert.equal(requests,stopped);
    assert.ok(await page.evaluate(()=>window.__streams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))));
    assert.deepEqual(errors,[]);
    report.viewports.push({width,passed:true,requests,translationTracked:true,staleLabelsRemoved:true});
    await context.close();
  }
  report.passed=true;
} finally {await browser.close();await fs.writeFile(path.join(output,'browser-results.json'),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify(report,null,2));
