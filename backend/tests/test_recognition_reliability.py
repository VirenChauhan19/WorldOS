"""Synthetic inference regressions; these tests make no live provider calls."""
import asyncio
import json

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.ai_adapters import ConceptDiscovery, validate_concepts
from backend.ai_service import AIService
from backend.inference_cache import InferenceCache
from backend.models import AIAnalysisRequest
from backend.main import app, get_ai_service
from backend.providers import AISettings, ProviderError, ProviderHTTP
from backend.tests.test_ai import chat, photo, sam_response, sam_text, service


def records(*items):
    return "<0f>" + ",".join(item.replace("<0f>0", f"<0f>{index}", 1)[4:]
                            for index, item in enumerate(items))


def test_overlapping_instances_from_one_sam_response_are_not_removed():
    text = records(sam_text(), sam_text(x1=41, x2=55))
    ai = service(lambda _: httpx.Response(200, json=sam_response(text)))
    result = asyncio.run(ai.analyze(AIAnalysisRequest(image_url=photo(), concepts=["book"])))
    assert len(result["objects"]) == 2
    assert len({obj.id for obj in result["objects"]}) == 2
    assert result["total_objects"] == 2 and not result["truncated"]


def test_cross_concept_matching_keeps_instance_count_and_stronger_detections():
    def handler(request):
        concept = json.loads(request.content)["input"][0]["content"][0]["text"]
        confidence = ";c=0.6" if concept == "book" else ";c=0.9"
        text = records(sam_text(confidence=confidence), sam_text(confidence=confidence, x1=41, x2=55))
        return httpx.Response(200, json=sam_response(text))

    result = asyncio.run(service(handler).analyze(AIAnalysisRequest(image_url=photo(), concepts=["book", "notebook"])))
    assert len(result["objects"]) == 2
    assert all(obj.confidence == .9 and obj.label == "notebook" for obj in result["objects"])
    assert "Removed 2" in result["warnings"][1]


def test_live_preview_caps_clutter_without_weakening_the_planning_contract():
    calls = []
    text = records(*(sam_text(confidence=f";c={.1 + index * .05:.2f}", x1=index * 7, x2=index * 7 + 4, y1=10, y2=14)
                     for index in range(13)))
    ai = service(lambda request: (calls.append(request) or httpx.Response(200, json=sam_response(text))))

    async def run():
        base = AIAnalysisRequest(image_url=photo(), concepts=["book"])
        with pytest.raises(ProviderError, match="13 distinct objects"):
            await ai.analyze(base)
        result = await ai.analyze(base.model_copy(update={"purpose": "live"}))
        assert result["total_objects"] == 13 and result["truncated"]
        assert len(result["objects"]) == 12
        assert result["objects"][0].confidence == .7
        assert all(obj.confidence > .1 for obj in result["objects"])
        assert "12 of 13" in result["message"]
        assert "complete planning inventory" in result["warnings"][-1]
        # A live preview must not make a subsequent planning request appear safe.
        with pytest.raises(ProviderError, match="13 distinct objects"):
            await ai.analyze(base)

    asyncio.run(run())
    assert len(calls) == 1  # Reuse the validated same-image segmentation.


def test_discovery_evidence_and_unmatched_concepts_are_preserved():
    def handler(request):
        if request.url.path.endswith("chat/completions"):
            return httpx.Response(200, json=chat({"concepts": ["book", "coffee cup"], "summary": "A book and a cup on the desk."}))
        concept = json.loads(request.content)["input"][0]["content"][0]["text"]
        return httpx.Response(200, json=sam_response("" if concept == "coffee cup" else sam_text()))

    result = asyncio.run(service(handler).analyze(AIAnalysisRequest(image_url=photo(), purpose="live")))
    assert result["summary"] == "A book and a cup on the desk."
    assert result["concept_discovery"]["model"] == "muse-spark-1.3"
    assert result["concept_discovery"]["live_request"] is False
    assert result["unmatched_concepts"] == ["coffee cup"]


def test_live_preview_retains_object_types_when_repeated_items_fill_the_scene():
    def handler(request):
        concept = json.loads(request.content)["input"][0]["content"][0]["text"]
        text = (records(*(sam_text(confidence=f";c={.9 + index * .005:.3f}", x1=index * 7, x2=index * 7 + 4, y1=10, y2=14)
                          for index in range(13))) if concept == "cable" else
                sam_text(confidence=";c=0.3", x1=0, x2=25, y1=40, y2=55))
        return httpx.Response(200, json=sam_response(text))

    result = asyncio.run(service(handler).analyze(AIAnalysisRequest(image_url=photo(), concepts=["cable", "tablet"], purpose="live")))
    assert result["total_objects"] == 14 and result["truncated"]
    assert len(result["objects"]) == 12
    assert sum(obj.label == "tablet" for obj in result["objects"]) == 1
    assert sum(obj.label == "cable" for obj in result["objects"]) == 11
    scores = [obj.confidence for obj in result["objects"]]
    assert scores == sorted(scores, reverse=True)
    assert min(obj.confidence for obj in result["objects"] if obj.label == "cable") == .91


def test_live_discovery_covers_furniture_without_broadening_workspace_inspection():
    instructions = []

    def handler(request):
        body = json.loads(request.content)
        instructions.append(body["messages"][0]["content"])
        return httpx.Response(200, json=chat({"concepts": [], "summary": "No objects."}))

    ai = service(handler)

    async def run():
        await ai.analyze(AIAnalysisRequest(image_url=photo(), purpose="live"))
        await ai.analyze(AIAnalysisRequest(image_url=photo()))

    asyncio.run(run())
    assert "Include furniture such as tables and desks" in instructions[0]
    assert "exclude the supporting surface itself and objects outside the workspace" in instructions[1]


def test_provider_errors_expose_safe_code_and_keep_readable_detail_for_clients():
    ai = service(lambda _: httpx.Response(404, json={"error": {"code": "model_not_found", "message": "UPSTREAM_SECRET_MUST_NOT_LEAK"}}))
    app.dependency_overrides[get_ai_service] = lambda: ai
    try:
        with TestClient(app) as client:
            response = client.post("/api/ai/analyze", json={"image_url": photo(), "concepts": ["book"]}, headers={"Origin": "http://localhost:5173"})
        assert response.status_code == 502
        assert response.headers["X-WorldOS-Error-Code"] == "unsupported_model_access"
        assert "X-WorldOS-Error-Code" in response.headers["access-control-expose-headers"]
        assert isinstance(response.json()["detail"], str)
        assert "UPSTREAM_SECRET" not in response.text
    finally:
        app.dependency_overrides.clear()


def test_empty_discovery_never_claims_a_live_sam_inference(monkeypatch):
    ai = AIService(ProviderHTTP(AISettings(meta_key="synthetic-unused", sam_provider="meta")))

    async def discover(_, **_options):
        return ConceptDiscovery(concepts=[], summary="Only an empty surface is visible.")

    async def forbidden(**_):
        raise AssertionError("No provider request is allowed in this test.")

    monkeypatch.setattr(ai.muse, "discover", discover)
    monkeypatch.setattr(ai.http, "post", forbidden)
    result = asyncio.run(ai.analyze(AIAnalysisRequest(image_url=photo())))
    assert result["objects"] == [] and result["live_request"] is False
    assert result["unmatched_concepts"] == []
    assert "No recognizable objects" in result["message"]


def test_nested_inference_cannot_exhaust_its_own_admission_budget():
    async def run():
        cache = InferenceCache(max_pending=1)
        entered, release = asyncio.Event(), asyncio.Event()

        async def leaf():
            entered.set()
            await release.wait()
            return {"value": "validated"}

        async def nested():
            values = await asyncio.gather(*(cache.get({"leaf": index}, leaf) for index in range(4)))
            return {"values": values}

        first = asyncio.create_task(cache.get({"root": 1}, nested))
        await entered.wait()
        with pytest.raises(ProviderError) as failure:
            await cache.get({"root": 2}, nested)
        assert failure.value.code == "busy"
        release.set()
        result = await first
        assert len(result["values"]) == 4
        assert not cache.pending

    asyncio.run(run())


def test_sam_concurrency_limit_is_shared_by_concurrent_scans():
    active = peak = 0

    async def handler(_):
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        try:
            await asyncio.sleep(.005)
            return httpx.Response(200, json=sam_response())
        finally:
            active -= 1

    ai = service(handler)

    async def run():
        return await asyncio.gather(*(ai.analyze(AIAnalysisRequest(image_url=photo(),
            concepts=[f"object {scan} {concept}" for concept in range(4)])) for scan in range(3)))

    result = asyncio.run(run())
    assert len(result) == 3 and all(item["objects"] for item in result)
    assert peak == 3 and active == 0


@pytest.mark.parametrize("concept", ["book+cup", "book\rcup", "book\ncup"])
def test_lists_are_rejected_before_provider_requests(concept):
    with pytest.raises(ValueError, match="one concept"):
        validate_concepts([concept])


def test_equivalent_whitespace_is_deduplicated():
    assert validate_concepts(["coffee  cup", " Coffee\tCup "]) == ["coffee cup"]
