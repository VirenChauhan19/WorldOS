"""Real HTTP + restart persistence; explicitly MOCKED provider, synthetic images."""
import io
import os
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import httpx
from PIL import Image
from smoke_process import stop_server

ROOT=Path(__file__).resolve().parents[1]
if not (ROOT/'dist/index.html').exists():raise SystemExit('Run npm.cmd run build first.')
(ROOT/'artifacts').mkdir(exist_ok=True)


def launch(directory):
    with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
    # Uses the documented SAM-response fixture through the real adapter. This is
    # an isolated test process, never an application environment switch/backdoor.
    code="from backend.main import app,get_ai_service; from backend.tests.test_inspect import documented_service,template; import uvicorn; app.dependency_overrides[get_ai_service]=lambda:documented_service(template(),[]); uvicorn.run(app,host='127.0.0.1',port="+str(port)+")"
    env={**os.environ,'WORLDOS_DATA_DIR':directory,'MODEL_API_KEY':'','BASETEN_API_KEY':'','WORLDOS_SAM_PROVIDER':'baseten'}
    env.update(WORLDOS_DEPLOYMENT='local', WORLDOS_AUTH_PASSWORD_HASH='', WORLDOS_ALLOWED_HOSTS='localhost,127.0.0.1', WORLDOS_CORS_ORIGINS='http://localhost:5173')
    env.update(WORLDOS_JUDGE_PASSWORD_HASH='', WORLDOS_JUDGE_ACCESS_EXPIRES_AT='')
    process=subprocess.Popen([sys.executable,'-c',code],cwd=ROOT,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    client=httpx.Client(base_url=f'http://127.0.0.1:{port}',timeout=15,trust_env=False)
    for _ in range(100):
        if process.poll() is not None:raise RuntimeError('Isolated Inspect smoke server exited.')
        try:
            if client.get('/api/health').status_code==200:return process,client
        except httpx.ConnectError:pass
        time.sleep(.1)
    raise RuntimeError('Inspect smoke server did not become ready.')


def stop(process,client):
    client.close();stop_server(process)


with tempfile.TemporaryDirectory(prefix='inspect-http-',dir=ROOT/'artifacts') as directory:
    process,client=launch(directory)
    try:
        assert client.get('/').status_code==200
        data=io.BytesIO();Image.new('RGB',(300,200),'gray').save(data,'PNG')
        photo=client.post('/api/analyze',files={'image':('synthetic.png',data.getvalue(),'image/png')}).json()['image_url']
        objects=[{'id':'book','label':'book','box':{'x':.1,'y':.15,'width':.1,'height':.12},'required':True,'tolerance':.025},
                 {'id':'cup','label':'cup','box':{'x':.75,'y':.15,'width':.1,'height':.12},'required':True,'locked':True,'tolerance':.025}]
        body={'name':'SYNTHETIC HTTP SMOKE','reference_image_url':photo,'objects':objects,'annotations_reviewed':True}
        response=client.post('/api/inspect/templates',json=body);assert response.status_code==201,response.text
        template=response.json();identity=template['id']
        scan={'template_id':identity,'template_revision':1,'image_url':photo,'alignment':{'confirmed':True},'inventory_confirmed':True,'discover_unexpected':False}
        assert client.post('/api/inspect/scans',json={**scan,'alignment':{'confirmed':False}}).status_code==422
        response=client.post('/api/inspect/scans',json=scan);assert response.status_code==201,response.text
        trial=response.json();assert trial['automatic_result']['passed']
        observed={**trial['analysis']['objects'][0]};observed['box']={**observed['box'],'x':.25}
        review={'assignments':{'book':observed['id']},'manual_objects':[observed],'inventory_confirmed':True,'revision':1}
        response=client.post(f"/api/inspect/scans/{trial['id']}/review",json=review);assert response.status_code==200,response.text
        reviewed=response.json();assert not reviewed['reviewed_result']['passed'] and reviewed['automatic_result']['passed']
        response=client.post(f"/api/inspect/scans/{trial['id']}/corrections",json={'revision':2});assert response.status_code==200,response.text
        assert response.json()['correction_plan']['status']=='ready'
        assert client.post('/api/inspect/scans',json={**scan,'previous_inspection_id':trial['id']}).status_code==422
        corrected=io.BytesIO();Image.new('RGB',(300,200),'#818181').save(corrected,'PNG')
        correction_photo=client.post('/api/analyze',files={'image':('synthetic-corrected.png',corrected.getvalue(),'image/png')}).json()['image_url']
        response=client.post('/api/inspect/scans',json={**scan,'image_url':correction_photo,'previous_inspection_id':trial['id']});assert response.status_code==201,response.text
        verified=response.json();assert verified['automatic_result']['passed']
        exported=client.get(f"/api/inspect/scans/{trial['id']}/report")
        assert exported.status_code==200 and 'data:image' not in exported.text and 'synthetic-key' not in exported.text
        # Guided evaluation uses only isolated, explicitly synthetic fixtures here.
        evaluation_template=client.post('/api/inspect/templates',json={**body,'name':'SYNTHETIC EVALUATION SMOKE'}).json()
        response=client.post('/api/inspect/evaluation/trials',json={'template_id':evaluation_template['id'],'name':'SYNTHETIC HTTP TEST','operator':'Software QA fixture','scenario':'correct_workspace','reference_captured_at':'2026-10-26T12:00:00Z','physical_reference_confirmed':True})
        assert response.status_code==201,response.text
        evaluation=response.json();evaluation_id=evaluation['id']
        for stage,color in [('inspection','#818181'),('corrected','#828282')]:
            data=io.BytesIO();Image.new('RGB',(300,200),color).save(data,'PNG')
            current_photo=client.post('/api/analyze',files={'image':('synthetic.png',data.getvalue(),'image/png')}).json()['image_url']
            truth_objects=[{k:v for k,v in o.items() if k not in {'required','tolerance'}} for o in objects]
            capture_body={'stage':stage,'image_url':current_photo,'alignment':{'confirmed':True},'captured_at':'2026-10-26T12:01:00Z','notes':'SYNTHETIC SOFTWARE FIXTURE ONLY','physical_photograph_confirmed':True,
                'truth':{'objects':truth_objects,'issues':[],'workspace_correct':True,'inventory_complete':True,'independently_reviewed':True,'reviewed_by':'Software QA fixture'}}
            response=client.post(f'/api/inspect/evaluation/trials/{evaluation_id}/captures',json=capture_body);assert response.status_code==201,response.text
            capture=next(c for c in response.json()['captures'] if c['stage']==stage)
            response=client.post('/api/inspect/scans',json={**scan,'template_id':evaluation_template['id'],'image_url':current_photo,'inventory_confirmed':False,'evaluation_capture_id':capture['id']})
            assert response.status_code==201,response.text
            scan_result=response.json();assert not scan_result['automatic_result']['passed']
            response=client.post(f"/api/inspect/scans/{scan_result['id']}/review",json={'revision':1,'inventory_confirmed':True})
            assert response.status_code==200 and response.json()['reviewed_result']['passed'],response.text
        report=client.get('/api/inspect/evaluation/report').json()
        assert report['task_success']['human_assisted']['over_started_trials']['numerator']==1
        assert report['task_success']['automatic']['over_started_trials']['numerator']==0
        exported_trial=client.get(f'/api/inspect/evaluation/trials/{evaluation_id}/export')
        assert exported_trial.status_code==200 and 'data:image' in exported_trial.text and 'synthetic-key' not in exported_trial.text
    finally:stop(process,client)
    process,client=launch(directory)
    try:
        persisted=client.get(f'/api/inspect/templates/{identity}').json()
        assert persisted['reference_image_url']==template['reference_image_url']
        assert client.get(f"/api/inspect/scans/{trial['id']}").json()['reviewed_result']['evidence_mode']=='human_assisted'
        assert len(client.get(f'/api/inspect/templates/{identity}/history').json()['inspections'])==2
        assert client.delete(f'/api/inspect/templates/{identity}').status_code==200
        assert client.get(f"/api/inspect/scans/{trial['id']}").status_code==404
        saved_trial=client.get(f'/api/inspect/evaluation/trials/{evaluation_id}').json()
        assert len(saved_trial['captures'])==2 and all(c['record']['reviewed_result']['passed'] for c in saved_trial['captures'])
        assert client.delete(f"/api/inspect/templates/{evaluation_template['id']}").status_code==409
        print('PASS: Inspect HTTP CRUD, alignment gate, SAM adapter with MOCKED provider, separate human review, correction planning, photo verification, report export, guided trial captures and scoring, SQLite persistence across server restart, and evidence deletion protection. Synthetic software QA only; NO live AI or physical validation.')
    finally:stop(process,client)
