"""Grounded scene questions use synthetic provider responses in software tests."""
import asyncio
import json

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.main import app, get_ai_service
from backend.models import SceneQuestionRequest
from backend.providers import ProviderError
from backend.tests.test_ai import chat, photo, service


def request(**overrides):
    return SceneQuestionRequest.model_validate({"image_url": photo(), "question": "How can I make room here?", "objects": [
        {"id": "phone", "label": "Phone", "box": {"x": .2, "y": .3, "width": .1, "height": .2}}], **overrides})


def answer(**overrides):
    return {"answer": "The phone occupies part of the workspace. Consider a dedicated spot near the edge, after checking the surrounding items.",
            "observations": ["A phone is visible on the surface."], "object_ids": ["phone"],
            "next_action": "measure", "limitation": "Measure the available width and depth before checking whether another device fits.", **overrides}


def test_question_sends_the_actual_photo_with_object_context_and_reuses_identical_request():
    calls = []

    def handler(req):
        body = json.loads(req.content)
        calls.append(body)
        instruction = body["messages"][0]["content"]
        assert "Never invent IDs, boxes, physical dimensions" in instruction
        context = json.loads(body["messages"][1]["content"][0]["text"])
        assert context["objects"][0]["id"] == "phone"
        assert body["messages"][1]["content"][1]["image_url"]["url"].startswith("data:image/jpeg;base64,")
        return httpx.Response(200, json=chat(answer()))

    async def run():
        ai = service(handler)
        first = await ai.ask(request())
        repeated = await ai.ask(request())
        assert first["source"] == "captured_view" and first["live_request"] is False
        assert first["object_ids"] == ["phone"]
        assert repeated["inference_cache"]["status"] == "hit"
        assert first["next_action"] == "measure"

    asyncio.run(run())
    assert len(calls) == 1


@pytest.mark.parametrize("ids", [["invented"], ["phone", "phone"]])
def test_unsupported_evidence_is_rejected(ids):
    ai = service(lambda _: httpx.Response(200, json=chat(answer(object_ids=ids))))
    with pytest.raises(ProviderError) as failure:
        asyncio.run(ai.ask(request()))
    assert failure.value.code == "malformed_response"


def test_bad_image_is_rejected_before_inference():
    calls = []
    ai = service(lambda req: calls.append(req))
    with pytest.raises(ValueError):
        asyncio.run(ai.ask(request(image_url="https://untrusted.invalid/private.jpg")))
    assert not calls


@pytest.mark.parametrize("changes", [{"question": "  "}, {"question": "x" * 601}, {"objects": [request().objects[0].model_dump()] * 2}])
def test_input_bounds_and_unique_ids(changes):
    with pytest.raises(ValidationError):
        request(**changes)


def test_empty_scene_can_be_described_without_invented_ids():
    ai = service(lambda _: httpx.Response(200, json=chat(answer(object_ids=[], next_action="none"))))
    result = asyncio.run(ai.ask(request(objects=[])))
    assert result["object_ids"] == [] and result["next_action"] == "none"


def test_unrecognized_action_and_oversized_observation_are_not_applied():
    for response in [answer(next_action="buy"), answer(observations=["a" * 501])]:
        ai = service(lambda _: httpx.Response(200, json=chat(response)))
        with pytest.raises(ProviderError):
            asyncio.run(ai.ask(request()))


def test_scene_question_route_uses_the_existing_service_and_safe_error_contract():
    ai = service(lambda _: httpx.Response(200, json=chat(answer(object_ids=["invented"]))))
    app.dependency_overrides[get_ai_service] = lambda: ai
    try:
        with TestClient(app) as client:
            result = client.post('/api/ai/ask', json=request().model_dump())
            assert result.status_code == 502
            assert result.headers['X-WorldOS-Error-Code'] == 'malformed_response'
            assert 'unrecognized item' in result.json()['detail']
    finally:
        app.dependency_overrides.pop(get_ai_service, None)


def test_interactive_auto_routing_uses_meta_first_and_retains_configured_fallback():
    hosts = []
    def handler(req):
        hosts.append(req.url.host)
        if req.url.host == 'api.meta.ai':
            return httpx.Response(503, json={"error": {"code": "server_error"}})
        return httpx.Response(200, json=chat(answer()))
    ai = service(handler, baseten_key='synthetic-baseten-key')
    result = asyncio.run(ai.ask(request()))
    assert hosts == ['api.meta.ai', 'inference.baseten.co']
    assert result['fallback']['from_provider'] == 'meta'


def test_explicit_baseten_choice_is_preserved_for_interactive_questions():
    hosts = []
    def handler(req):
        hosts.append(req.url.host)
        return httpx.Response(200, json=chat(answer()))
    ai = service(handler, baseten_key='synthetic-baseten-key', muse_provider='baseten')
    asyncio.run(ai.ask(request()))
    assert hosts == ['inference.baseten.co']
