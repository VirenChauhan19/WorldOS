"""Isolated browser QA server. Synthetic fixtures; never contacts an AI provider.

Run after npm run build: python scripts/serve_interaction_qa.py
The server binds only loopback. Its dataset and profiling UI never ship in dist.
"""
import asyncio
import io
import json
import os
import sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
DATA=ROOT/'artifacts'/('v12/qa' if '--empty' in sys.argv else 'interaction-qa')
DATA.mkdir(parents=True,exist_ok=True)
os.environ.update(WORLDOS_DEPLOYMENT='local',WORLDOS_DATA_DIR=str(DATA),
    WORLDOS_AUTH_PASSWORD_HASH='',WORLDOS_JUDGE_PASSWORD_HASH='',WORLDOS_JUDGE_ACCESS_EXPIRES_AT='',
    WORLDOS_ALLOWED_HOSTS='localhost,127.0.0.1',WORLDOS_CORS_ORIGINS='http://127.0.0.1:8765',
    WORLDOS_STORAGE_MODE='ephemeral',MODEL_API_KEY='',BASETEN_API_KEY='',WORLDOS_SAM_PROVIDER='meta')

from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.testclient import TestClient
from PIL import Image,ImageDraw
from backend.main import app,get_ai_service
from backend.tests.test_inspect import documented_service,template

fixture=template()
image=Image.new('RGB',(300,200),'#b8a084');draw=ImageDraw.Draw(image)
draw.rectangle((30,30,60,54),fill='#375771');draw.ellipse((225,30,255,54),fill='#eee7ce')
draw.text((18,172),'SYNTHETIC QA - NOT MODEL VALIDATION',fill='#242b22')
image.save(DATA/'synthetic-workspace.png')
if '--empty' in sys.argv:
    for stage in ('reference','moved','corrected'):
        scene=Image.new('RGB',(1000,700),'#e9dfcd');p=ImageDraw.Draw(scene)
        p.rectangle((20,20,980,680),outline='#c1b49e',width=3)
        x=390 if stage=='moved' else 100
        p.rounded_rectangle((x,120,x+100,310),radius=14,fill='#243f64')
        p.rounded_rectangle((x+9,135,x+91,285),radius=8,fill='#93c7ed')
        p.text((x+20,200),'PHONE',fill='#18375b')
        p.ellipse((720,430,820,570),fill='#434c58');p.text((735,490),'MOUSE',fill='white')
        p.rectangle((580,100,830,330),fill='#f9fbff',outline='#7a9cbd',width=5)
        for y in range(145,300,30):p.line((610,y,795,y),fill='#c6d5e5',width=2)
        p.text((625,112),'NOTEBOOK',fill='#48637b')
        p.ellipse((280,430,410,560),fill='#f9fbff');p.ellipse((298,448,392,542),fill='#9c6c43')
        p.text((40,635),f'SYNTHETIC SOFTWARE QA - {stage.upper()} - NOT A PHYSICAL TEST',fill='#22384e')
        scene.save(DATA/f'qa-{stage}.png')
calls=[]
app.dependency_overrides[get_ai_service]=lambda:documented_service(fixture,calls)

PROFILER='''<details id="qa-profiler" style="margin:20px;padding:12px;border:1px solid #62744c;font:12px monospace">
<summary>Local QA only · synthetic AI · interaction measurements</summary>
<div id="qa-fixture-actions"><button data-photo="reference">Load synthetic setup photo</button><button data-photo="moved">Load synthetic moved photo</button><button data-photo="corrected">Load synthetic corrected photo</button></div>
<button id="qa-profile-start" style="padding:12px">Measure next 5 seconds</button>
<output id="qa-profile-results" style="display:block;white-space:pre-wrap">No sample recorded.</output></details>
<script>
(()=>{let running=false,frames=[],longTasks=[],shifts=[],start=0,last=0;
document.getElementById('qa-fixture-actions').onclick=async event=>{const stage=event.target.dataset.photo;if(!stage)return;const input=document.querySelector('.route-screen[data-active="true"] input[type="file"]:not([capture])');if(!input){document.getElementById('qa-profile-results').textContent='Open a photo step first.';return;}const response=await fetch('/qa/fixture/'+stage);if(!response.ok)return;const file=new File([await response.blob()],'synthetic-'+stage+'.png',{type:'image/png'});const transfer=new DataTransfer();transfer.items.add(file);input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));};
try{new PerformanceObserver(list=>{if(running)longTasks.push(...list.getEntries().map(e=>e.duration));}).observe({type:'longtask'});}catch{}
try{new PerformanceObserver(list=>{if(running)shifts.push(...list.getEntries().filter(e=>!e.hadRecentInput).map(e=>e.value));}).observe({type:'layout-shift'});}catch{}
const output=document.getElementById('qa-profile-results');
document.getElementById('qa-profile-start').onclick=()=>{if(running)return;running=true;frames=[];longTasks=[];shifts=[];start=performance.now();last=0;output.textContent='Sampling for 5 seconds…';
function sample(now){if(last)frames.push(now-last);last=now;if(now-start<5000){requestAnimationFrame(sample);return;}
running=false;const sorted=[...frames].sort((a,b)=>a-b);output.textContent=JSON.stringify({viewport:[innerWidth,innerHeight],frames:frames.length,p95FrameMs:+sorted[Math.floor(sorted.length*.95)].toFixed(2),maxFrameMs:+Math.max(...frames).toFixed(2),framesOver20ms:frames.filter(v=>v>20).length,longTasks:longTasks.length,maxLongTaskMs:Math.max(0,...longTasks),layoutShift:+shifts.reduce((a,b)=>a+b,0).toFixed(4)},null,2);}
requestAnimationFrame(sample);};})();</script>'''

@app.middleware('http')
async def qa(request,call_next):
    if request.url.path.startswith('/qa/fixture/'):
        stage=request.url.path.rsplit('/',1)[-1]
        if stage in {'reference','moved','corrected'} and (DATA/f'qa-{stage}.png').exists():
            return FileResponse(DATA/f'qa-{stage}.png',media_type='image/png')
        return JSONResponse({'detail':'No synthetic fixture.'},status_code=404)
    if request.url.path=='/qa/phone':
        # A real nested layout viewport, useful when extension viewport overrides
        # are unavailable. This is Chrome responsive QA, never iPhone/Safari proof.
        return HTMLResponse('''<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>WorldOS responsive QA</title></head><body style="margin:0;background:#dbe5f0;color:#273f59;font:14px system-ui"><p style="position:absolute;margin:12px;max-width:220px">Local responsive QA · 390 × 844 CSS pixels · synthetic fixtures · not an iPhone</p><iframe title="WorldOS phone viewport" src="/" style="display:block;width:390px;height:844px;max-width:100%;border:0;margin:0 auto"></iframe></body></html>''')
    if request.url.path=='/':
        html=(ROOT/'dist/index.html').read_text(encoding='utf-8')
        return HTMLResponse(html.replace('</body>',PROFILER+'</body>'))
    config_path=DATA/'mode.json'
    config=json.loads(config_path.read_text()) if config_path.exists() else {}
    if request.method=='POST' and request.url.path.startswith('/api/'):
        await asyncio.sleep(config.get('delay_seconds',0))
        if config.get('error'):
            return JSONResponse({'detail':'Synthetic QA timeout. Retry when the backend is available.'},status_code=504)
    return await call_next(request)

if __name__=='__main__':
    with TestClient(app,base_url='http://127.0.0.1') as client:
        if '--empty' not in sys.argv and not client.get('/api/inspect/templates').json()['templates']:
            stream=io.BytesIO();image.save(stream,'PNG')
            uploaded=client.post('/api/analyze',files={'image':('synthetic.png',stream.getvalue(),'image/png')}).json()
            response=client.post('/api/inspect/templates',json={'name':'SYNTHETIC QA workspace','reference_image_url':uploaded['image_url'],'objects':fixture['objects'],'annotations_reviewed':True})
            response.raise_for_status()
    import uvicorn
    uvicorn.run(app,host='127.0.0.1',port=8765)
