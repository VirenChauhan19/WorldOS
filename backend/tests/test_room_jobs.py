import asyncio
import time
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI, HTTPException

from backend import room_jobs
from backend.inspect_routes import get_store
from backend.inspect_store import InspectionStore
from backend.tests.test_ai import photo
from backend.tests.test_room_design import design_request, survey as survey_fixture, design as design_fixture


def setup_app(tmp_path, monkeypatch):
    store = InspectionStore(tmp_path/'jobs.sqlite3')
    app = FastAPI()
    async def run(work):
        return await work
    app.include_router(room_jobs.build_room_jobs_router(lambda: object(), run))
    app.dependency_overrides[get_store] = lambda: store
    gate, calls = asyncio.Event(), []
    async def survey(body, service):
        calls.append(body.image_url)
        await gate.wait()
        return {'summary': 'A completed synthetic survey'}
    monkeypatch.setattr(room_jobs, 'survey_room', survey)
    return app, store, gate, calls


def test_job_survives_client_disconnect_and_identical_submission_is_idempotent(tmp_path, monkeypatch):
    async def run():
        app, store, gate, calls = setup_app(tmp_path, monkeypatch)
        identity = str(uuid4())
        body = {'id': identity, 'request': {'image_url': photo()}}
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url='http://test') as client:
            assert (await client.post('/api/ai/room/jobs', json=body)).status_code == 202
            await asyncio.sleep(0)
            assert (await client.post('/api/ai/room/jobs', json=body)).status_code == 202
            assert len(calls) == 1
        gate.set()
        await asyncio.sleep(.01)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url='http://test') as reconnected:
            result = (await reconnected.get('/api/ai/room/jobs/'+identity)).json()
            assert result['status'] == 'completed'
            assert result['result']['summary'].startswith('A completed')
        assert room_jobs.load_job(InspectionStore(store.path), identity)['status'] == 'completed'
    asyncio.run(run())


def test_jobs_across_workspaces_share_server_capacity(tmp_path, monkeypatch):
    async def run():
        app, store, gate, calls = setup_app(tmp_path, monkeypatch)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url='http://test') as client:
            for index in range(5):
                workspace=InspectionStore(tmp_path/f'visitor-{index}.sqlite3')
                app.dependency_overrides[get_store]=lambda:workspace
                response=await client.post('/api/ai/room/jobs',json={'id':str(uuid4()),'request':{'image_url':photo()}})
                assert response.status_code==(202 if index<4 else 429)
            gate.set()
            await asyncio.sleep(.01)
        await room_jobs.stop_room_jobs()
    asyncio.run(run())


def test_ai_operations_share_two_slots_and_cancel_queued_coroutines(monkeypatch):
    from backend import main
    import inspect
    async def run():
        monkeypatch.setattr(main,'ai_slots',asyncio.Semaphore(2))
        gate=asyncio.Event();active=[]
        async def work(identity):
            active.append(identity)
            await gate.wait()
            return identity
        operations=[work(index) for index in range(3)]
        tasks=[asyncio.create_task(main.run_ai(work)) for work in operations]
        await asyncio.sleep(.01)
        assert active==[0,1]
        tasks[2].cancel()
        await asyncio.gather(tasks[2],return_exceptions=True)
        assert inspect.getcoroutinestate(operations[2])==inspect.CORO_CLOSED
        gate.set();assert await asyncio.gather(*tasks[:2])==[0,1]
    asyncio.run(run())


def test_cancel_and_workspace_isolation(tmp_path, monkeypatch):
    async def run():
        app, store, gate, calls = setup_app(tmp_path, monkeypatch)
        identity = str(uuid4())
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url='http://test') as client:
            await client.post('/api/ai/room/jobs', json={'id':identity,'request':{'image_url':photo()}})
            await asyncio.sleep(0)
            other = InspectionStore(tmp_path/'other.sqlite3')
            app.dependency_overrides[get_store] = lambda: other
            assert (await client.get('/api/ai/room/jobs/'+identity)).status_code == 404
            assert (await client.post('/api/ai/room/jobs/'+identity+'/cancel')).status_code == 404
            app.dependency_overrides[get_store] = lambda: store
            assert (await client.post('/api/ai/room/jobs/'+identity+'/cancel')).json()['status'] == 'cancelled'
            gate.set()
            await asyncio.sleep(.01)
            assert (await client.get('/api/ai/room/jobs/'+identity)).json()['result'] is None
    asyncio.run(run())


def test_bounds_conflicts_failures_and_expired_jobs(tmp_path, monkeypatch):
    async def run():
        app, store, gate, calls = setup_app(tmp_path, monkeypatch)
        identities = [str(uuid4()) for _ in range(3)]
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url='http://test') as client:
            for identity in identities[:2]:
                assert (await client.post('/api/ai/room/jobs',json={'id':identity,'request':{'image_url':photo()}})).status_code == 202
            assert (await client.post('/api/ai/room/jobs',json={'id':identities[2],'request':{'image_url':photo()}})).status_code == 429
            assert (await client.post('/api/ai/room/jobs',json={'id':identities[0],'request':{'image_url':'different'}})).status_code == 409
            with store.connect() as db:
                db.execute('UPDATE room_jobs SET created_at=? WHERE id=?',(time.time()-room_jobs.MAX_SECONDS-60,identities[0]))
            assert (await client.get('/api/ai/room/jobs/'+identities[0])).json()['status'] == 'failed'
            gate.set()
            await asyncio.sleep(.01)
            assert (await client.get('/api/ai/room/jobs/'+identities[0])).json()['result'] is None
        await room_jobs.stop_room_jobs()
    asyncio.run(run())


def test_design_errors_are_persisted_and_only_explicit_new_jobs_retry(tmp_path, monkeypatch):
    async def run():
        app, store, gate, calls = setup_app(tmp_path, monkeypatch)
        async def fail_design(body, service):
            calls.append(body.goal)
            raise HTTPException(502, 'Design provider is temporarily unavailable.')
        monkeypatch.setattr(room_jobs, 'design_room', fail_design)
        identity = str(uuid4())
        body = {'id':identity,'request':design_request().model_dump()}
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url='http://test') as client:
            assert (await client.post('/api/ai/room/jobs',json=body)).status_code == 202
            await asyncio.sleep(.01)
            saved = (await client.get('/api/ai/room/jobs/'+identity)).json()
            assert saved['stage'] == 'design' and saved['status'] == 'failed'
            assert 'temporarily unavailable' in saved['error']
            assert (await client.post('/api/ai/room/jobs',json=body)).json()['status'] == 'failed'
            assert len(calls) == 1
            await client.post('/api/ai/room/jobs',json={**body,'id':str(uuid4())})
            await asyncio.sleep(.01)
            assert len(calls) == 2
    asyncio.run(run())


@pytest.mark.parametrize('fail_design', [False, True])
def test_queued_design_finishes_without_a_client_and_retains_a_completed_survey(tmp_path, monkeypatch, fail_design):
    async def run():
        app, store, gate, calls = setup_app(tmp_path, monkeypatch)
        async def survey(body, service):
            calls.append('survey');await gate.wait()
            return {**survey_fixture(), 'image_url':photo(), 'image_width':100, 'image_height':100}
        async def design(body, service):
            calls.append(('design',body.style,body.goal))
            if fail_design:raise HTTPException(502,'Design unavailable; survey is saved.')
            return design_fixture()
        monkeypatch.setattr(room_jobs,'survey_room',survey);monkeypatch.setattr(room_jobs,'design_room',design)
        parent,child=str(uuid4()),str(uuid4())
        queued={'id':child,'request':{'survey_job_id':parent,'goal':'Keep the centre open','style':'open','gap':.3}}
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app),base_url='http://test') as client:
            await client.post('/api/ai/room/jobs',json={'id':parent,'request':{'image_url':photo()}})
            assert (await client.post('/api/ai/room/jobs',json=queued)).status_code==202
            assert (await client.post('/api/ai/room/jobs',json=queued)).status_code==202
            await asyncio.sleep(.01);assert calls==['survey']
        gate.set()
        for _ in range(100):
            result=room_jobs.load_job(store,child)
            if result['status'] in ('completed','failed'):break
            await asyncio.sleep(.01)
        assert calls==['survey',('design','open','Keep the centre open')]
        assert result['result']['survey']['room']['width']==4
        assert result['status']==('failed' if fail_design else 'completed')
        if not fail_design:assert result['result']['design']['title']==design_fixture()['title']
        await room_jobs.stop_room_jobs()
    asyncio.run(run())


def test_queued_design_validates_workspace_dependency_and_cancellation(tmp_path, monkeypatch):
    async def run():
        app,store,gate,calls=setup_app(tmp_path,monkeypatch)
        parent,child=str(uuid4()),str(uuid4())
        queued={'id':child,'request':{'survey_job_id':parent,'goal':'Reading','style':'focus','gap':.3}}
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app),base_url='http://test') as client:
            assert (await client.post('/api/ai/room/jobs',json=queued)).status_code==404
            await client.post('/api/ai/room/jobs',json={'id':parent,'request':{'image_url':photo()}})
            assert (await client.post('/api/ai/room/jobs',json=queued)).status_code==202
            assert (await client.post('/api/ai/room/jobs/'+child+'/cancel')).json()['status']=='cancelled'
            gate.set();await asyncio.sleep(.3)
            assert room_jobs.load_job(store,child)['result'] is None
        await room_jobs.stop_room_jobs()
    asyncio.run(run())


def test_queued_design_preserves_the_actual_analysis_error(tmp_path,monkeypatch):
    async def run():
        app,store,gate,calls=setup_app(tmp_path,monkeypatch)
        async def fail_survey(body,service):
            await gate.wait()
            raise HTTPException(502,'Muse Spark reached its response limit before finishing.')
        monkeypatch.setattr(room_jobs,'survey_room',fail_survey)
        parent,child=str(uuid4()),str(uuid4())
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app),base_url='http://test') as client:
            await client.post('/api/ai/room/jobs',json={'id':parent,'request':{'image_url':photo()}})
            assert (await client.post('/api/ai/room/jobs',json={'id':child,'request':{'survey_job_id':parent,'goal':'Reading corner','gap':.3}})).status_code==202
            gate.set()
            for _ in range(100):
                result=room_jobs.load_job(store,child)
                if result['status']=='failed':break
                await asyncio.sleep(.01)
            assert result['status']=='failed' and result['result'] is None
            assert result['error']=='Room analysis stopped: Muse Spark reached its response limit before finishing.'
        await room_jobs.stop_room_jobs()
    asyncio.run(run())
