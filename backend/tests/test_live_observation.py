"""Synthetic provider fixtures verify contracts, not recognition accuracy."""
import asyncio
import json

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.main import app, get_ai_service
from backend.models import LiveAnalysisRequest
from backend.providers import ProviderError
from backend.tests.test_ai import chat, photo, service


def observation():
    return {"summary": "A cup on a desk.", "objects": [{"label": "Cup", "detail": "White ceramic cup",
        "box": {"x": .2, "y": .3, "width": .1, "height": .2}}]}


def test_live_is_one_call_per_frame_without_sam_or_cached_results():
    calls = []
    def handler(req):
        body = json.loads(req.content)
        calls.append(body)
        assert body['max_completion_tokens'] == 1200
        assert body['reasoning_effort'] == 'minimal'
        assert body['messages'][1]['content'][1]['image_url']['url'].startswith('data:image/')
        return httpx.Response(200, json=chat(observation()))
    async def run():
        ai = service(handler)
        for _ in range(2):
            result = await ai.observe_live(LiveAnalysisRequest(image_url=photo()))
            assert result['objects'][0].source == 'muse_spark'
            assert result['objects'][0].confidence is None
            assert result['details'] == {'live-0': 'White ceramic cup'}
            assert result['live_request'] is False
    asyncio.run(run())
    assert len(calls) == 2


@pytest.mark.parametrize('box', [dict(x=.9, y=.2, width=.4, height=.1), dict(x=-.1, y=.1, width=.2, height=.2)])
def test_bad_locations_are_rejected(box):
    data = observation(); data['objects'][0]['box'] = box
    with pytest.raises(ProviderError, match='invalid structured'):
        asyncio.run(service(lambda _: httpx.Response(200, json=chat(data))).observe_live(LiveAnalysisRequest(image_url=photo())))


def test_live_does_not_fallback_or_fan_out_after_provider_failure():
    calls = []
    def handler(req):
        calls.append(req.url.host)
        return httpx.Response(503)
    with pytest.raises(ProviderError):
        asyncio.run(service(handler, baseten_key='test-key').observe_live(LiveAnalysisRequest(image_url=photo())))
    assert calls == ['api.meta.ai']


def test_live_concurrency_is_bounded_and_cancellation_releases_capacity():
    async def run():
        ai = service(lambda _: None)
        started = 0
        async def pending(**kwargs):
            nonlocal started
            started += 1
            await asyncio.Event().wait()
        ai.muse.structured = pending
        tasks = [asyncio.create_task(ai.observe_live(LiveAnalysisRequest(image_url=photo()))) for _ in range(2)]
        await asyncio.sleep(0)
        with pytest.raises(ProviderError) as failure:
            await ai.observe_live(LiveAnalysisRequest(image_url=photo()))
        assert failure.value.status == 429 and started == 2
        for task in tasks: task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        assert ai._live_active == 0
    asyncio.run(run())


def test_route_validates_inputs_and_returns_empty_scenes():
    calls = []
    def handler(req):
        calls.append(req)
        return httpx.Response(200, json=chat({'summary': 'No clear objects.', 'objects': []}))
    app.dependency_overrides[get_ai_service] = lambda: service(handler)
    try:
        with TestClient(app) as client:
            assert client.post('/api/ai/live', json={'image_url': 'https://invalid.test/private'}).status_code == 422
            assert not calls
            response = client.post('/api/ai/live', json={'image_url': photo()})
            assert response.status_code == 200 and response.json()['objects'] == []
    finally:
        app.dependency_overrides.pop(get_ai_service, None)
