"""Bounded, workspace-scoped room jobs that outlive a browser connection.

Results persist in SQLite. An interrupted server job expires visibly; inference is
never silently replayed. Existing authentication selects the store and role.
"""
import asyncio
import hashlib
import json
import time
from uuid import UUID
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from .inspect_routes import errors, get_store
from .room_design import PhotoRequest, DesignRequest, survey_room, design_room

tasks = {}
MAX_SECONDS = 360


class QueuedDesign(BaseModel):
    model_config = ConfigDict(extra='forbid')
    survey_job_id: UUID
    goal: str = Field(min_length=1, max_length=1200)
    style: Literal['balanced', 'open', 'focus'] = 'balanced'
    gap: float = Field(ge=0, le=3)


class JobInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    id: UUID
    request: PhotoRequest | DesignRequest | QueuedDesign


def load_job(store, identity):
    with store.connect() as db:
        row = db.execute('SELECT kind,status,result,error,created_at FROM room_jobs WHERE id=?', (identity,)).fetchone()
        if not row:
            raise HTTPException(404, 'This room request is no longer available. Retry this stage from your saved room.')
        kind, status, result, error, created = row
        if status in ('queued', 'running') and time.time() - created > MAX_SECONDS:
            status, error = 'failed', 'The server could not finish this request. Your room is saved; retry this stage.'
            db.execute('UPDATE room_jobs SET status=?,error=? WHERE id=?', (status, error, identity))
    return {'id': identity, 'stage': kind, 'status': status, 'result': json.loads(result) if result else None, 'error': error}


def build_room_jobs_router(get_service, run_ai):
    router = APIRouter(prefix='/api/ai/room/jobs', tags=['Resumable room requests'])

    async def execute(store, identity, body, service):
        completed_survey = None
        try:
            if isinstance(body, QueuedDesign):
                async def wait_for_survey():
                    while True:
                        parent = load_job(store, str(body.survey_job_id))
                        if parent['status'] == 'completed':
                            return parent['result']
                        if parent['status'] in ('failed', 'cancelled'):
                            raise HTTPException(422, 'Room analysis did not finish. Retry analysis before designing.')
                        await asyncio.sleep(.25)
                completed_survey = await asyncio.wait_for(wait_for_survey(), timeout=MAX_SECONDS-130)
                if completed_survey.get('status') != 'ready' or not completed_survey.get('room'):
                    raise HTTPException(422, 'This photo needs a clearer room view. Choose another photo.')
                dimensions = completed_survey['room']
                body = DesignRequest(image_url=completed_survey['image_url'], goal=body.goal, style=body.style, gap=body.gap,
                                     room={key: dimensions[key] for key in ('width','depth','height') if key in dimensions},
                                     zones=completed_survey['zones'], features=completed_survey['features'], items=[], placements=[])
            with store.connect() as db:
                changed = db.execute("UPDATE room_jobs SET status='running' WHERE id=? AND status='queued'", (identity,)).rowcount
            if not changed:
                return
            work = design_room(body, service) if isinstance(body, DesignRequest) else survey_room(body, service)
            result = await asyncio.wait_for(run_ai(work), timeout=MAX_SECONDS-10)
            if completed_survey is not None:
                result = {'survey': completed_survey, 'design': result}
            with store.connect() as db:
                db.execute("UPDATE room_jobs SET status='completed',result=? WHERE id=? AND status='running'", (json.dumps(result), identity))
        except asyncio.CancelledError:
            with store.connect() as db:
                db.execute("UPDATE room_jobs SET status='cancelled',error='Request cancelled. Your saved room is unchanged.' WHERE id=? AND status IN ('queued','running')", (identity,))
            raise
        except Exception as error:
            message = error.detail if isinstance(error, HTTPException) and isinstance(error.detail, str) else 'Room AI could not finish. Retry this stage; your saved room is unchanged.'
            with store.connect() as db:
                partial = json.dumps({'survey': completed_survey}) if completed_survey is not None else None
                db.execute("UPDATE room_jobs SET status='failed',error=?,result=? WHERE id=? AND status IN ('queued','running')", (message, partial, identity))
        finally:
            tasks.pop((str(store.path), identity), None)

    @router.post('', status_code=202)
    async def start(body: JobInput, store=Depends(get_store), service=Depends(get_service)):
        identity = str(body.id)
        fingerprint = hashlib.sha256(body.request.model_dump_json().encode()).hexdigest()
        stage = 'design' if isinstance(body.request, (DesignRequest, QueuedDesign)) else 'survey'
        with errors(), store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            previous = db.execute('SELECT fingerprint FROM room_jobs WHERE id=?', (identity,)).fetchone()
            if previous and previous[0] != fingerprint:
                raise HTTPException(409, 'This request ID belongs to a different room action.')
            if not previous:
                if len(tasks) >= 4:
                    raise HTTPException(429, 'The AI designer is busy. Wait for a request to finish and retry; no new action was queued.')
                if isinstance(body.request, QueuedDesign):
                    parent = db.execute('SELECT kind,status FROM room_jobs WHERE id=?', (str(body.request.survey_job_id),)).fetchone()
                    if not parent or parent[0] != 'survey':
                        raise HTTPException(404, 'The room analysis request was not found in this workspace.')
                    if parent[1] in ('failed','cancelled'):
                        raise HTTPException(422, 'Room analysis stopped. Retry analysis before designing.')
                db.execute("DELETE FROM room_jobs WHERE created_at<? AND status NOT IN ('queued','running')", (time.time()-7*86400,))
                db.execute("UPDATE room_jobs SET status='failed',error='Server request interrupted. Retry this stage.' WHERE created_at<? AND status IN ('queued','running')", (time.time()-MAX_SECONDS,))
                if db.execute("SELECT COUNT(*) FROM room_jobs WHERE status IN ('queued','running')").fetchone()[0] >= 2:
                    raise HTTPException(429, 'Two room requests are already running. Let one finish or cancel it before starting another.')
                # Old delivered results are expendable; saved room projects live
                # on the device. Always retain the newest forty job records.
                excess = db.execute('SELECT COUNT(*) FROM room_jobs').fetchone()[0] - 39
                if excess > 0:
                    db.execute("DELETE FROM room_jobs WHERE id IN (SELECT id FROM room_jobs WHERE status NOT IN ('queued','running') ORDER BY created_at LIMIT ?)", (excess,))
                db.execute('INSERT INTO room_jobs VALUES (?,?,?,?,?,?,?)', (identity, stage, fingerprint, 'queued', None, '', time.time()))
        if not previous:
            tasks[(str(store.path), identity)] = asyncio.create_task(execute(store, identity, body.request, service))
        return load_job(store, identity)

    @router.get('/{identity}')
    def status(identity: UUID, store=Depends(get_store)):
        with errors():
            return load_job(store, str(identity))

    @router.post('/{identity}/cancel')
    async def cancel(identity: UUID, store=Depends(get_store)):
        identity = str(identity)
        with errors():
            load_job(store, identity)
            with store.connect() as db:
                db.execute("UPDATE room_jobs SET status='cancelled',error='Request cancelled.' WHERE id=? AND status IN ('queued','running')", (identity,))
        task = tasks.get((str(store.path), identity))
        if task:
            task.cancel()
        # A late result cannot replace cancelled state, even if transport cancellation is delayed.
        return load_job(store, identity)

    return router


async def stop_room_jobs():
    running = list(tasks.values())
    for task in running:
        task.cancel()
    await asyncio.gather(*running, return_exceptions=True)
