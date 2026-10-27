"""Synthetic transport tests, not real-photo or physical accuracy evidence."""
import asyncio
import httpx
import pytest

from backend.inspection import recognize_workspace, scan_workspace
from backend.inspect_models import Alignment, InspectionInput
from backend.main import app, get_ai_service
from backend.models import AIAnalysisRequest
from backend.providers import ProviderError
from backend.providers import AISettings, ProviderHTTP
from backend.ai_service import AIService
from backend.tests.test_ai import service, photo as small_photo
from backend.tests.test_inspect import client, documented_service, photo, template, template_input


def request(t, **changes):
    return InspectionInput(template_id=t['id'], template_revision=t['revision'],
        image_url=photo('beige'), alignment=Alignment(), **changes)


def test_model_access_failure_sends_one_request_not_a_batch():
    calls = []
    def handler(req):
        calls.append(req)
        return httpx.Response(404, json={'error': {'code': 'model_not_found'}})
    ai = service(handler)
    with pytest.raises(ProviderError, match='unavailable'):
        asyncio.run(ai.analyze(AIAnalysisRequest(image_url=small_photo(), concepts=['phone', 'mouse', 'mug', 'notebook'])))
    assert len(calls) == 1


def test_current_photo_checks_sam_before_spending_on_discovery():
    calls = []
    def handler(req):
        calls.append(req)
        return httpx.Response(404, json={'error': {'code': 'model_not_found'}})
    with pytest.raises(ProviderError):
        asyncio.run(recognize_workspace(template(), request(template()), service(handler)))
    assert len(calls) == 1 and calls[0].url.path == '/v1/responses'


def test_missing_sam_key_cannot_spend_on_muse_discovery():
    calls=[]
    def handler(req):
        calls.append(req)
        raise AssertionError('No provider request is allowed.')
    ai=AIService(ProviderHTTP(AISettings(sam_provider='meta',baseten_key='synthetic'),httpx.MockTransport(handler)))
    with pytest.raises(ProviderError,match='MODEL_API_KEY'):
        asyncio.run(ai.analyze(AIAnalysisRequest(image_url=small_photo())))
    assert calls==[]


def test_recognition_has_boxes_but_no_comparison_until_camera_confirmation():
    async def run():
        t=template(); calls=[]; ai=documented_service(t,calls)
        req=request(t, discover_unexpected=False)
        preview=await recognize_workspace(t,req,ai)
        assert preview['analysis']['objects']
        assert not preview['aligned_image']['comparison_allowed']
        assert 'automatic_result' not in preview and 'passed' not in preview
        with pytest.raises(ValueError, match='Confirm alignment'):
            await scan_workspace(t,req,ai)
        before=len(calls)
        checked=await scan_workspace(t,req.model_copy(update={'alignment':Alignment(confirmed=True)}),ai)
        assert len(calls)==before  # No repeated inference to compare this exact photo.
        assert not checked['automatic_result']['passed']  # Incomplete inventory cannot pass.
        assert not checked['analysis']['live_request']
    asyncio.run(run())


def test_recognition_route_keeps_photos_private_and_rejects_stale_or_reused_evidence(client):
    c,store=client
    t=c.post('/api/inspect/templates',json=template_input().model_dump()).json()
    calls=[]; ai=documented_service(t,calls)
    app.dependency_overrides[get_ai_service]=lambda:ai
    payload=request(t, discover_unexpected=False).model_dump()
    preview=c.post('/api/inspect/recognize',json=payload)
    assert preview.status_code==200,preview.text
    assert preview.headers['cache-control']=='no-store'
    assert store.history(t['id'])==[]  # Recognition alone creates no successful inspection.
    before=len(calls)
    assert c.post('/api/inspect/recognize',json={**payload,'template_revision':99}).status_code==409
    assert c.post('/api/inspect/recognize',json={**payload,'template_id':'another-role-space'}).status_code==404
    scan=c.post('/api/inspect/scans',json={**payload,'alignment':{'confirmed':True}}).json()
    for image in (payload['image_url'],t['reference_image_url']):
        response=c.post('/api/inspect/recognize',json={**payload,'image_url':image,'previous_inspection_id':scan['id']})
        assert response.status_code==422
    assert len(calls)==before
