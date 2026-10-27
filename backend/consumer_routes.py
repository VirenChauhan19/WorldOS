"""Photo-first workflow: private resumable drafts and explicit human inspection.

No fallback fabricates AI output. Manual observations use the existing comparison,
review, alignment and planning gates, and remain labeled as human assistance.
"""
import json
from time import perf_counter
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import Field, StrictBool

from .imaging import image_from_data_url, same_photograph
from .inspect_alignment import align_scene
from .inspect_models import Alignment, InspectionInput, InspectionReview, ReferenceAnalysis, StrictModel, TemplateObject
from .inspect_routes import errors, get_store
from .inspect_store import StoreConflict, now
from .inspection import inspect_facts, review_inspection


class DraftPhoto(StrictModel):
    image_url: str = Field(max_length=8_500_000)
    width: int = Field(ge=1, le=1800)
    height: int = Field(ge=1, le=1800)
    name: str = Field(max_length=255)


class DraftState(StrictModel):
    step: Literal['setup', 'check', 'result', 'fix', 'verify'] = 'setup'
    name: str = Field(default='My space', max_length=120)
    reference: DraftPhoto | None = None
    current: DraftPhoto | None = None
    objects: list[TemplateObject] = Field(default_factory=list, max_length=12)
    analysis: ReferenceAnalysis | None = None
    reference_ms: int | None = Field(default=None, ge=0)
    template_id: str | None = Field(default=None, max_length=80)
    record_id: str | None = Field(default=None, max_length=80)
    previous_id: str | None = Field(default=None, max_length=80)
    alignment: Alignment = Field(default_factory=Alignment)
    manual: StrictBool = False
    review: InspectionReview | None = None


class DraftInput(StrictModel):
    revision: int = Field(ge=0)
    state: DraftState


class ManualInspection(InspectionInput):
    review: InspectionReview


def build_consumer_router():
    router = APIRouter(prefix='/api/inspect', tags=['Guided inspection'])

    @router.get('/drafts')
    def drafts(store=Depends(get_store)):
        with errors(), store.connect() as db:
            # Extract metadata inside SQLite: listing 20 drafts must not load
            # every embedded photograph into Python on the 512 MB Free service.
            rows = db.execute("SELECT id,revision,json_extract(data,'$.name'),json_extract(data,'$.step'),updated_at FROM wizard_drafts ORDER BY updated_at DESC").fetchall()
        return {'drafts': [{'id': r[0], 'revision': r[1], 'name': r[2],
                            'step': r[3], 'updated_at': r[4]} for r in rows]}

    @router.get('/drafts/{identity}')
    def draft(identity: str, store=Depends(get_store)):
        with errors(), store.connect() as db:
            row = db.execute('SELECT revision,data,updated_at FROM wizard_drafts WHERE id=?', (identity,)).fetchone()
            if not row:
                raise KeyError()
            return {'id': identity, 'revision': row[0], 'state': json.loads(row[1]), 'updated_at': row[2]}

    @router.put('/drafts/{identity}')
    def save_draft(identity: str, body: DraftInput, store=Depends(get_store)):
        with errors():
            UUID(identity)
            state = body.state
            # References are resolved only inside the authenticated role's store.
            if state.template_id:
                store.template(state.template_id)
            for record_id in (state.record_id, state.previous_id):
                if record_id:
                    saved = store.inspection(record_id)
                    if saved['template_id'] != state.template_id:
                        raise ValueError('This check belongs to a different saved space.')
            for photo in (state.reference, state.current):
                if photo:
                    checked = image_from_data_url(photo.image_url)
                    if (checked['width'], checked['height']) != (photo.width, photo.height):
                        raise ValueError('Photo dimensions changed. Choose the photo again.')
            data = state.model_dump()
            timestamp = now()
            with store.connect() as db:
                db.execute('BEGIN IMMEDIATE')
                row = db.execute('SELECT revision FROM wizard_drafts WHERE id=?', (identity,)).fetchone()
                if (row[0] if row else 0) != body.revision:
                    raise StoreConflict('This draft changed in another tab. Reopen it from My Spaces before saving more changes.')
                if not row and db.execute('SELECT COUNT(*) FROM wizard_drafts').fetchone()[0] >= 20:
                    raise ValueError('There are 20 unfinished checks. Finish or remove an old draft in My Spaces first.')
                db.execute('INSERT INTO wizard_drafts VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,data=excluded.data,updated_at=excluded.updated_at',
                           (identity, body.revision+1, json.dumps(data), timestamp))
            return {'id': identity, 'revision': body.revision+1, 'updated_at': timestamp}

    @router.delete('/drafts/{identity}')
    def delete_draft(identity: str, store=Depends(get_store)):
        with errors(), store.connect() as db:
            db.execute('DELETE FROM wizard_drafts WHERE id=?', (identity,))
        return {'deleted': True}

    @router.post('/manual-scans', status_code=201)
    def manual_scan(body: ManualInspection, store=Depends(get_store)):
        with errors():
            started = perf_counter()
            if body.evaluation_capture_id:
                raise ValueError('Guided evaluation trials require their separate evidence workflow.')
            template = store.template(body.template_id)
            if body.previous_inspection_id:
                previous = store.inspection(body.previous_inspection_id)
                if previous['template_id'] != body.template_id:
                    raise ValueError('Check again using the same saved space.')
                template = previous['template_snapshot']
                if any(same_photograph(body.image_url, image) for image in
                       (previous['current_image_url'], template['reference_image_url'])):
                    raise ValueError('Take a fresh photo after moving your things. An earlier photo was reused.')
            if template['revision'] != body.template_revision:
                raise StoreConflict('This setup changed. Reopen it from My Spaces.')
            aligned = align_scene(template, body.image_url, body.alignment)
            if not aligned['comparison_allowed']:
                raise ValueError('Line up the photos and include the whole setup before checking.')
            # Empty automatic evidence is explicitly inconclusive. Only a person's
            # submitted observations can inform the separate reviewed result.
            automatic = inspect_facts(template, [], aligned['image_url'], inventory=False)
            record = {'template_id': template['id'], 'template_revision': template['revision'], 'template_snapshot': template,
                'current_image_url': body.image_url, 'aligned_image': aligned,
                'analysis': {'objects': [], 'concepts': [], 'summary': 'Human review only.', 'message': 'No automatic detection was run.',
                    'warnings': [], 'provider': 'human', 'model': 'manual-review', 'annotation_source': 'manual', 'live_request': False},
                'concept_discovery': None, 'automatic_result': automatic, 'explanation': None, 'correction_plan': None,
                'previous_inspection_id': body.previous_inspection_id, 'inference_wall_ms': 0,
                'warnings': ['Human-assisted comparison; this is not independent AI verification.']}
            record['reviewed_result'] = review_inspection(record, body.review)
            record['review'] = body.review.model_dump()
            record['latency_ms'] = round((perf_counter()-started)*1000)
            return store.save_inspection(record)

    return router
