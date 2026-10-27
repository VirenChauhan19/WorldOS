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
DATA=ROOT/'artifacts'/'interaction-qa'
DATA.mkdir(parents=True,exist_ok=True)
os.environ.update(WORLDOS_DEPLOYMENT='local',WORLDOS_DATA_DIR=str(DATA),
    WORLDOS_AUTH_PASSWORD_HASH='',WORLDOS_JUDGE_PASSWORD_HASH='',WORLDOS_JUDGE_ACCESS_EXPIRES_AT='',
    WORLDOS_ALLOWED_HOSTS='localhost,127.0.0.1',WORLDOS_CORS_ORIGINS='http://127.0.0.1:8765',
    WORLDOS_STORAGE_MODE='ephemeral',MODEL_API_KEY='',BASETEN_API_KEY='',WORLDOS_SAM_PROVIDER='meta')

from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.testclient import TestClient
from PIL import Image,ImageDraw
from backend.main import app,get_ai_service
from backend.tests.test_inspect import documented_service,template

fixture=template()
image=Image.new('RGB',(300,200),'#b8a084');draw=ImageDraw.Draw(image)
draw.rectangle((30,30,60,54),fill='#375771');draw.ellipse((225,30,255,54),fill='#eee7ce')
draw.text((18,172),'SYNTHETIC QA - NOT MODEL VALIDATION',fill='#242b22')
image.save(DATA/'synthetic-workspace.png')
calls=[]
app.dependency_overrides[get_ai_service]=lambda:documented_service(fixture,calls)

PROFILER='''<details id="qa-profiler" style="margin:20px;padding:12px;border:1px solid #62744c;font:12px monospace">
<summary>Local QA only · synthetic AI · interaction measurements</summary>
<button id="qa-profile-start" style="padding:12px">Measure next 5 seconds</button>
<output id="qa-profile-results" style="display:block;white-space:pre-wrap">No sample recorded.</output></details>
<script>
(()=>{let running=false,frames=[],longTasks=[],shifts=[],start=0,last=0;
try{new PerformanceObserver(list=>{if(running)longTasks.push(...list.getEntries().map(e=>e.duration));}).observe({type:'longtask'});}catch{}
try{new PerformanceObserver(list=>{if(running)shifts.push(...list.getEntries().filter(e=>!e.hadRecentInput).map(e=>e.value));}).observe({type:'layout-shift'});}catch{}
const output=document.getElementById('qa-profile-results');
document.getElementById('qa-profile-start').onclick=()=>{if(running)return;running=true;frames=[];longTasks=[];shifts=[];start=performance.now();last=0;output.textContent='Sampling for 5 seconds…';
function sample(now){if(last)frames.push(now-last);last=now;if(now-start<5000){requestAnimationFrame(sample);return;}
running=false;const sorted=[...frames].sort((a,b)=>a-b);output.textContent=JSON.stringify({viewport:[innerWidth,innerHeight],frames:frames.length,p95FrameMs:+sorted[Math.floor(sorted.length*.95)].toFixed(2),maxFrameMs:+Math.max(...frames).toFixed(2),framesOver20ms:frames.filter(v=>v>20).length,longTasks:longTasks.length,maxLongTaskMs:Math.max(0,...longTasks),layoutShift:+shifts.reduce((a,b)=>a+b,0).toFixed(4)},null,2);}
requestAnimationFrame(sample);};})();</script>'''

@app.middleware('http')
async def qa(request,call_next):
    if request.url.path=='/qa/phone':
        # A real nested layout viewport, useful when extension viewport overrides
        # are unavailable. This is Chrome responsive QA, never iPhone/Safari proof.
        return HTMLResponse('''<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>WorldOS responsive QA</title></head><body style="margin:0;background:#10160d;color:#dce9cf;font:14px system-ui"><p style="margin:12px">Local responsive QA · 390 × 844 CSS pixels · synthetic fixtures · not an iPhone</p><iframe title="WorldOS phone viewport" src="/" style="display:block;width:390px;height:844px;max-width:100%;border:0;margin:0 auto"></iframe></body></html>''')
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
        if not client.get('/api/inspect/templates').json()['templates']:
            stream=io.BytesIO();image.save(stream,'PNG')
            uploaded=client.post('/api/analyze',files={'image':('synthetic.png',stream.getvalue(),'image/png')}).json()
            response=client.post('/api/inspect/templates',json={'name':'SYNTHETIC QA workspace','reference_image_url':uploaded['image_url'],'objects':fixture['objects'],'annotations_reviewed':True})
            response.raise_for_status()
    import uvicorn
    uvicorn.run(app,host='127.0.0.1',port=8765)
