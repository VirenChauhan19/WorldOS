// Real application and task HTTP routes, isolated SQLite, synthetic model output.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const option=name=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
const moduleDir=option('--playwright-dir');
const {chromium}=await import(moduleDir?pathToFileURL(path.resolve(moduleDir,'index.mjs')).href:'playwright');
const base=option('--base-url')??'http://127.0.0.1:5173',apiBase=option('--api-url')??'http://127.0.0.1:8011';
const output=path.resolve('artifacts/v20');await fs.mkdir(output,{recursive:true});
const report={scope:'Full task HTTP routes and isolated persistence with synthetic model output. No physical camera or accuracy claim.',viewports:[]};
const browser=await chromium.launch({headless:true});
let lastPage;
try{
  for(const width of [320,390,768,1440]){
    const context=await browser.newContext({viewport:{width,height:950},reducedMotion:'reduce'}),page=await context.newPage();lastPage=page;
    const errors=[],requests=[];page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(({backend})=>localStorage.setItem('worldos.backendUrl',backend),{backend:apiBase});
    page.on('request',request=>{const url=new URL(request.url());if(url.pathname.startsWith('/api/'))requests.push({path:url.pathname,method:request.method()});});
    await page.goto(base+'/#/home');await page.getByRole('heading',{name:/Make room.*Get going/}).waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:path.join(output,`home-${width}.png`),fullPage:true});
    await page.getByRole('button',{name:'Get my space ready',exact:true}).click();
    await page.getByLabel('Anything we should work around?',{exact:false}).fill('Keep my monitor in place.');
    await page.getByLabel('Choose a photo library input').setInputFiles('public/desk-preview.webp');
    await page.getByAltText('Your selected starting photograph').waitFor();
    await page.screenshot({path:path.join(output,`start-${width}.png`),fullPage:true});
    await page.getByRole('button',{name:'Help me get started',exact:true}).click();
    await page.getByRole('button',{name:'monitor',exact:true}).waitFor();
    await page.getByRole('button',{name:'monitor',exact:true}).click();
    await page.getByRole('button',{name:'Make my step-by-step plan'}).click();
    await page.getByRole('heading',{name:'Ready for a focused session'}).waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    const identity=new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('id');assert.ok(identity);
    await page.getByText('Why this helps', {exact:true}).click();
    await page.screenshot({path:path.join(output,`guide-${width}.png`),fullPage:true});
    await page.getByRole('button',{name:'I’ve done this step'}).click();await page.getByText('1 of 2 marked done by you',{exact:true}).waitFor();
    await page.reload();await page.getByText('1 of 2 marked done by you',{exact:true}).waitFor();
    await page.getByRole('button',{name:'I’ve done this step'}).click();await page.getByText('2 of 2 marked done by you',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Check my result'}).click();
    // Deliberately altered public fixture pixels exercise upload/freshness only, not real task completion.
    const after=await page.evaluate(async()=>{const photo=new Image();photo.src='/desk-preview.webp';await photo.decode();const canvas=document.createElement('canvas');canvas.width=800;canvas.height=534;const ctx=canvas.getContext('2d');ctx.drawImage(photo,0,0,800,534);ctx.fillStyle='#d5e2ba';ctx.fillRect(0,0,50,50);return canvas.toDataURL('image/jpeg',.8).split(',')[1];});
    await page.getByLabel('Choose after photo library input').setInputFiles({name:'SYNTHETIC-after.jpg',mimeType:'image/jpeg',buffer:Buffer.from(after,'base64')});
    await page.getByRole('region',{name:'AI photo review'}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Save my routine'}).isDisabled(),true);
    await page.getByRole('checkbox',{name:'This photo shows the setup I want to return to.'}).check();
    const routineName=`SYNTHETIC study setup ${width}`;await page.getByLabel('Routine name').fill(routineName);
    await page.getByRole('button',{name:'Save my routine',exact:true}).click();await page.getByText('Your routine is ready.',{exact:true}).waitFor();
    await page.screenshot({path:path.join(output,`review-${width}.png`),fullPage:true});
    await page.getByRole('button',{name:'Use this routine again'}).click();await page.getByRole('heading',{name:`Back to ${routineName}.`}).waitFor();
    await page.getByAltText('Your saved preferred setup').waitFor();
    await page.getByRole('button',{name:'Back to home'}).click();await page.getByRole('button',{name:new RegExp(routineName)}).first().waitFor();
    if(width===390){
      await page.getByRole('button',{name:'All routines and saved spaces'}).click();
      const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:`Export routine ${routineName}`,exact:true}).click()]);
      const backup=path.join(output,'SYNTHETIC-routine-backup.json');await download.saveAs(backup);
      const exported=JSON.parse(await fs.readFile(backup,'utf8'));assert.equal(exported.format,'worldos-routine-v1');
      await page.getByRole('button',{name:`Remove routine ${routineName}`,exact:true}).click();
      await page.getByRole('dialog').getByRole('button',{name:'Remove routine',exact:true}).click();
      await page.getByRole('button',{name:`Export routine ${routineName}`,exact:true}).waitFor({state:'hidden'});
      await page.getByLabel('Import a routine backup').setInputFiles(backup);
      await page.getByRole('button',{name:`Export routine ${routineName}`,exact:true}).waitFor();
      await page.getByRole('button',{name:new RegExp(`^${routineName}`)}).click();
      await page.getByRole('heading',{name:`Back to ${routineName}.`}).waitFor();
      await page.getByAltText('Your saved preferred setup').waitFor();
      report.routineBackupRestored=true;
    }
    assert.deepEqual(errors,[]);assert.ok(requests.some(r=>r.path.endsWith('/check')&&r.method==='POST'));
    report.viewports.push({width,passed:true,reloadPreservedProgress:true,routineReusable:true,horizontalOverflow:false,pageErrors:errors});
    // Remove only this run's synthetic task/routine from the isolated fixture server.
    const index=await (await context.request.get(apiBase+'/api/missions')).json();
    for(const routine of index.routines.filter(r=>r.name===routineName))await context.request.delete(apiBase+'/api/missions/routines/'+routine.id);
    await context.request.delete(apiBase+'/api/missions/'+identity);
    await context.close();lastPage=null;
  }
  // Portrait photos must keep the same displayed aspect as their overlay container.
  const portraitContext=await browser.newContext({viewport:{width:390,height:950},reducedMotion:'reduce'});
  const portraitPage=await portraitContext.newPage();lastPage=portraitPage;
  await portraitPage.addInitScript(({backend})=>localStorage.setItem('worldos.backendUrl',backend),{backend:apiBase});
  await portraitPage.goto(base+'/#/mission');
  const portrait=await portraitPage.evaluate(async()=>{const photo=new Image();photo.src='/desk-preview.webp';await photo.decode();const canvas=document.createElement('canvas');canvas.width=400;canvas.height=800;const ctx=canvas.getContext('2d');ctx.fillStyle='#e8eddf';ctx.fillRect(0,0,400,800);ctx.drawImage(photo,0,220,400,267);return canvas.toDataURL('image/jpeg',.8).split(',')[1];});
  await portraitPage.getByLabel('Choose a photo library input').setInputFiles({name:'SYNTHETIC-portrait.jpg',mimeType:'image/jpeg',buffer:Buffer.from(portrait,'base64')});
  await portraitPage.getByAltText('Your selected starting photograph').waitFor();
  await portraitPage.getByRole('button',{name:'Help me get started',exact:true}).click();
  await portraitPage.getByRole('button',{name:'monitor',exact:true}).waitFor();
  const proportions=await portraitPage.locator('.mission-photo-image').evaluate(el=>{const img=el.querySelector('img'),r=el.getBoundingClientRect();return {display:r.width/r.height,source:img.naturalWidth/img.naturalHeight};});
  assert.ok(Math.abs(proportions.display-proportions.source)<.005,JSON.stringify(proportions));
  await portraitPage.getByRole('link',{name:'Skip to content'}).focus();
  assert.equal(await portraitPage.getByRole('link',{name:'Skip to content'}).evaluate(el=>getComputedStyle(el).clipPath),'none');
  await portraitPage.getByRole('link',{name:'Skip to content'}).click();
  assert.equal(await portraitPage.locator('#screen-mission').evaluate(el=>el===document.activeElement),true);
  const portraitId=new URLSearchParams(new URL(portraitPage.url()).hash.split('?')[1]).get('id');
  await portraitContext.request.delete(apiBase+'/api/missions/'+portraitId);
  await portraitContext.close();lastPage=null;
  report.portraitOverlayAligned=true;report.keyboardSkipLinkWorks=true;
  report.passed=true;
}catch(error){report.error=error.message;if(lastPage){await lastPage.screenshot({path:path.join(output,'failure.png'),fullPage:true});report.pageText=await lastPage.locator('body').innerText();}throw error;
}finally{await browser.close();await fs.writeFile(path.join(output,'browser-results.json'),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify(report,null,2));
