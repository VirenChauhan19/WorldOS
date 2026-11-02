// App integration and layout with a synthetic camera and explicitly mocked AI.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const arg=name=>process.argv[process.argv.indexOf(name)+1];
const moduleDir=process.argv.includes('--playwright-dir')?arg('--playwright-dir'):null;
const {chromium}=await import(moduleDir?pathToFileURL(path.resolve(moduleDir,'index.mjs')).href:'playwright');
const output=path.resolve('artifacts/v19');await fs.mkdir(output,{recursive:true});
const report={scope:'Chromium UI checks. Home displays recorded real model output; live camera and answers are software fixtures.',viewports:[],cases:[]};
const recorded=JSON.parse(await fs.readFile('docs/v18-live-recognition.json','utf8'));
const fixture={objects:recorded.objects,concepts:recorded.concepts,summary:recorded.summary,model:'SAM fixture',provider:'fixture',live_request:false,concept_discovery:{model:'Muse fixture',live_request:false},warnings:[],message:'Browser fixture',total_objects:recorded.total_objects,truncated:true,unmatched_concepts:recorded.unmatched_concepts};
const phone=fixture.objects.find(object=>object.label==='smartphone');
const browser=await chromium.launch({headless:true});
try{
  for(const width of [320,390,768,1440]){
    const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    let questions=0;
    await page.route('**/api/**',async route=>{
      const endpoint=new URL(route.request().url()).pathname;
      if(endpoint.endsWith('/auth/status'))return route.fulfill({json:{required:false,authenticated:true,access:'owner'}});
      if(endpoint.endsWith('/missions'))return route.fulfill({json:{missions:[],routines:[]}});
      if(endpoint.endsWith('/ai/analyze'))return route.fulfill({json:fixture});
      if(endpoint.endsWith('/ai/ask')){
        const body=route.request().postDataJSON();assert.ok(body.image_url.startsWith('data:image/jpeg'));assert.equal(body.question,'How can I make room?');assert.ok(body.objects.some(object=>object.id===phone.id));questions++;
        return route.fulfill({json:{answer:'Consider a dedicated spot for the phone beside the keyboard, after checking the surrounding items.',observations:['The phone is below the keyboard.'],object_ids:[phone.id],next_action:'measure',limitation:'Measure the available width and depth before comparing another device.',model:'Muse fixture',provider:'fixture',source:'captured_view',live_request:false}});
      }
      return route.fulfill({json:{templates:[],status:'ok'}});
    });
    await page.addInitScript(()=>{
      window.__streams=[];
      navigator.mediaDevices.getUserMedia=async()=>{const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=854;const ctx=canvas.getContext('2d');const photo=new Image();photo.src='/desk-preview.webp';await photo.decode();ctx.drawImage(photo,0,0,1280,854);const stream=canvas.captureStream(5);window.__streams.push(stream);const frames=setInterval(()=>{if(stream.active)ctx.drawImage(photo,0,0,1280,854);else clearInterval(frames);},200);return stream;};
    });
    await page.goto('http://127.0.0.1:5173/#/home');
    await page.getByRole('heading',{name:/Make room.*Get going/}).waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:path.join(output,`home-${width}.png`),fullPage:true});
    const layers=page.getByRole('group',{name:'Explore scan layers'});
    await layers.getByRole('button',{name:'Understanding'}).click();await page.getByText('WHAT MUSE SPARK SAW').waitFor();
    await layers.getByRole('button',{name:'Image',exact:true}).click();assert.equal(await page.getByLabel('Recorded SAM detections').count(),0);
    await layers.getByRole('button',{name:/Objects/}).click();
    await page.getByRole('group',{name:'Recorded object types'}).getByRole('button',{name:'Laptop',exact:true}).click();
    assert.equal(await page.getByRole('button',{name:'Explore Laptop',exact:true}).getAttribute('aria-pressed'),'true');
    await page.getByRole('button',{name:/Check my space/}).click();
    await page.getByRole('button',{name:'Open camera & recognize'}).click();
    try{await page.getByRole('heading',{name:'12 items located'}).waitFor();}catch(error){
      await page.screenshot({path:path.join(output,`failure-${width}.png`),fullPage:true});
      report.failure={width,message:error.message,text:await page.locator('body').innerText(),camera:await page.locator('video').evaluate(video=>({readyState:video.readyState,width:video.videoWidth,height:video.videoHeight,paused:video.paused,visibility:document.visibilityState})),pageErrors:errors};throw error;
    }
    await page.getByRole('button',{name:'Ask',exact:true}).click();
    await page.getByRole('button',{name:'How can I make room?'}).click();
    await page.getByText('Consider a dedicated spot for the phone beside the keyboard, after checking the surrounding items.').waitFor();
    await page.locator('.ask-evidence').getByRole('button',{name:'smartphone'}).click();
    assert.equal(await page.getByRole('button',{name:'Highlight smartphone in camera'}).getAttribute('aria-pressed'),'true');
    await page.getByRole('button',{name:'Ask',exact:true}).click();
    assert.equal(questions,1);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.locator('.ask-scene').scrollIntoViewIfNeeded();
    assert.ok(await page.locator('.skip-link').evaluate(link=>link.getBoundingClientRect().bottom<=0),'Keyboard skip link stays offscreen until focused.');
    await page.screenshot({path:path.join(output,`ask-viewport-${width}.png`)});
    await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));
    await page.screenshot({path:path.join(output,`ask-${width}.png`),fullPage:true});
    await page.getByRole('button',{name:'Check the dimensions',exact:true}).click();await page.getByLabel('Space width').waitFor();
    await page.getByRole('button',{name:'Back to home',exact:true}).click();
    assert.ok(await page.evaluate(()=>window.__streams.every(stream=>stream.getTracks().every(track=>track.readyState==='ended'))));
    assert.deepEqual(errors,[]);
    report.viewports.push({width,horizontalOverflow:false,pageErrors:[],sceneQuestion:true});await context.close();
  }
  report.cases=['recorded scan layers and object selection','camera → question → grounded object highlight → dimension entry','camera released on navigation'];report.passed=true;
}finally{await browser.close();await fs.writeFile(path.join(output,'browser-results.json'),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify(report,null,2));
