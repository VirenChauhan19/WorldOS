// Camera/AI fixtures prove view recall and UI behavior, not physical mapping.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const option=name=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
const moduleDir=option('--playwright-dir');
const {chromium}=await import(moduleDir?pathToFileURL(path.resolve(moduleDir,'index.mjs')).href:'playwright');
const output=path.resolve('artifacts/v23');await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true});
const report={scope:'Synthetic moving camera and mocked AI. Tests visual recall, not native world tracking.',viewports:[]};
try{
  for(const width of [390,1440]){
    const context=await browser.newContext({viewport:{width,height:950}}),page=await context.newPage();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    let scene='A',requests=0,hold=false,omitEarlierItem=false;
    const objectA={id:'live-0',label:'Keyboard',box:{x:.5354,y:.4547,width:.4042,height:.1656},locked:false};
    const objectB={id:'live-0',label:'Book',box:{x:.25,y:.3,width:.3,height:.3},locked:false};
    await page.route('**/api/**',async route=>{
      const endpoint=new URL(route.request().url()).pathname;
      if(endpoint.endsWith('/auth/status'))return route.fulfill({json:{required:false,authenticated:true,access:'owner'}});
      if(endpoint.endsWith('/ai/live')){
        requests++;const capturedScene=scene;
        if(hold){await new Promise(resolve=>setTimeout(resolve,3000));return route.fulfill({status:503,json:{detail:'Synthetic delay'}}).catch(()=>{});}
        await new Promise(resolve=>setTimeout(resolve,200));
        const objects=[capturedScene==='A'&&!omitEarlierItem?objectA:objectB];
        return route.fulfill({json:{objects,concepts:objects.map(o=>o.label),summary:capturedScene==='A'?'Computer desk.':'A book in another area.',details:{'live-0':'Synthetic visible detail'},warnings:[],message:'Fixture',provider:'fixture',model:'fixture',live_request:false}});
      }
      return route.fulfill({json:{templates:[],missions:[],routines:[],status:'ok'}});
    });
    await page.addInitScript(()=>{
      window.Worker=undefined; // Isolate the cloud fallback/memory fixture.
      navigator.mediaDevices.getUserMedia=async()=>{
        const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=854;
        const ctx=canvas.getContext('2d');const photo=new Image();photo.src='/desk-preview.webp';await photo.decode();
        window.__scene=id=>{
          if(id==='A'){ctx.drawImage(photo,0,0,canvas.width,canvas.height);return;}
          ctx.fillStyle='#345970';ctx.fillRect(0,0,1280,854);
          for(let y=0;y<90;y++)for(let x=0;x<120;x++){
            const value=((x*7349^y*2939^x*y*43)>>>0)%256;
            ctx.fillStyle=`rgb(${value},${255-value},${value/2})`;ctx.fillRect(x*11,y*10,7,7);
          }
          ctx.fillStyle='#e49a52';ctx.fillRect(320,256,384,256);
        };
        window.__scene('A');const stream=canvas.captureStream(30);return stream;
      };
    });
    try{
      await page.goto('http://127.0.0.1:8000/#/live');
      await page.getByRole('button',{name:'Open camera & recognize'}).click();
      await page.getByRole('button',{name:/1 views remembered/}).waitFor();
      await page.getByRole('button',{name:'Memory',exact:true}).click();
      const rename=page.getByRole('textbox',{name:'Name this remembered area'});
      await rename.fill('My desk');await rename.press('Enter');
      scene='B';await page.evaluate(()=>window.__scene('B'));
      await page.getByRole('button',{name:/2 views remembered/}).waitFor();
      await page.getByRole('button',{name:/Find Keyboard, last seen in My desk/}).click();
      await page.getByAltText('Last seen view of Keyboard').waitFor();
      assert.equal(await page.getByRole('button',{name:'Highlight Keyboard in camera'}).count(),0);
      // Wait past the old tracking expiry. Suppress new model results to prove
      // that recovery uses the retained visual memory rather than another API.
      hold=true;await page.waitForTimeout(8500);
      scene='A';const before=performance.now();await page.evaluate(()=>window.__scene('A'));
      const recovered=page.locator('.camera-object.is-remembered').filter({hasText:'Keyboard'});
      await recovered.waitFor({timeout:2200});
      const recallMs=Math.round(performance.now()-before);
      assert.ok(recallMs<2200);
      await page.getByText('View recognized. Check the remembered spot.',{exact:true}).waitFor();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      await page.evaluate(()=>window.scrollTo(0,0));
      await page.screenshot({path:path.join(output,`recalled-${width}.png`),fullPage:true});
      // A fresh scan can omit a remembered object. Finding it should still
      // show its older spot alongside genuinely fresh labels, with attribution.
      hold=false;omitEarlierItem=true;
      await page.locator('.camera-object:not(.is-remembered)').filter({hasText:'Book'}).waitFor();
      await recovered.waitFor();
      await page.getByRole('button',{name:'Stop camera',exact:true}).click();
      assert.equal(await page.getByRole('button',{name:/Find Keyboard, last seen in My desk/}).count(),1);
      await page.getByRole('button',{name:'Clear memory & start a new scan'}).click();
      await page.getByText('Look around slowly to build your memory.',{exact:true}).waitFor();
      assert.equal(await page.getByRole('group',{name:'Remembered items'}).count(),0);
      assert.deepEqual(errors,[]);
      report.viewports.push({width,recallMs,requests,returnedWithoutAI:true,earlierItemSurvivesOmission:true,retainedAfterStop:true,cleared:true});
    }catch(error){await page.screenshot({path:path.join(output,`failure-${width}.png`),fullPage:true});throw error;}
    finally{await context.close();}
  }
  report.passed=true;
}finally{await browser.close();await fs.writeFile(path.join(output,'browser-results.json'),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify(report,null,2));
