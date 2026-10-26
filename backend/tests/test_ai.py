"""Synthetic API responses matching official schemas, never represented as live recordings."""
import asyncio
import base64
import io
import json
import logging

import httpx
import pytest
from fastapi.testclient import TestClient
from PIL import Image
from pydantic import ValidationError

from backend.ai_adapters import SAM31Segmentation, parse_sam_image, validate_concepts
from backend.ai_service import AIService
from backend.main import app, get_ai_service, plan_with_constraints
from backend.models import AIAnalysisRequest, PlanRequest, PlanningConstraints, ReasonRequest
from backend.providers import AISettings, BasetenDeployment, ProviderError, ProviderHTTP


def photo():
    stream = io.BytesIO()
    Image.new("RGB", (100, 60), "#a9b59c").save(stream, "PNG")
    return "data:image/png;base64," + base64.b64encode(stream.getvalue()).decode()


def constraints(**kwargs):
    return {"protected_object_ids": ["coffee"], "summary": "Clear the selected target, keeping coffee fixed.", "unsupported_requirements": [], "needs_clarification": False, **kwargs}


def reasoning_request(**kwargs):
    return ReasonRequest.model_validate({"goal": "Give my laptop room and leave my drink alone", "target": {"x": .3, "y": .3, "width": .4, "height": .4}, "image_url": photo(), "objects": [
        {"id": "book", "label": "Book", "box": {"x": .4, "y": .4, "width": .15, "height": .2}},
        {"id": "coffee", "label": "Coffee", "box": {"x": .8, "y": .1, "width": .1, "height": .1}, "locked": True}], **kwargs})


def chat(value, **overrides):
    return {"model": "muse-spark-1.3", "choices": [{"finish_reason": "stop", "message": {"role": "assistant", "content": json.dumps(value)}}], "usage": {"prompt_tokens": 123, "completion_tokens": 34, "total_tokens": 157}, **overrides}


def sam_text(confidence=";c=0.9609375", x1=40, y1=24, x2=54, y2=35, w=100, h=60):
    # Payload is intentionally opaque: production consumes bounding boxes and confidence only.
    return f"<0f>0<|box;x1={x1};y1={y1};x2={x2};y2={y2};w={w};h={h}{confidence}|><|mask;x=0;y=0{confidence};data=12,15,!MOCK_PAYLOAD|>"


def sam_response(text=None, **kwargs):
    return {"status": "completed", "output": [{"type": "message", "content": [{"type": "output_text", "text": sam_text() if text is None else text}]}], **kwargs}


def service(handler, **settings):
    return AIService(ProviderHTTP(AISettings(meta_key="test-meta-key", sam_provider="meta", **settings), httpx.MockTransport(handler)))


def run(coro):
    return asyncio.run(coro)


def test_meta_sam_request_format_confidence_and_normalization():
    def handler(request):
        assert str(request.url) == "https://api.meta.ai/v1/responses"
        assert request.headers["authorization"] == "Bearer test-meta-key"
        data = json.loads(request.content)
        assert data["model"] == "sam-3.1"
        assert data["metadata"] == {"include_confidence": "true", "mask_encoding": "one_bit"}
        assert data["stream"] is False
        assert data["input"][0]["content"][0] == {"type": "input_text", "text": "book"}
        assert data["input"][0]["content"][1]["image_url"].startswith("data:image/jpeg;base64,")
        return httpx.Response(200, json=sam_response())
    result = run(service(handler).analyze(AIAnalysisRequest(image_url=photo(), concepts=["book"])))
    obj = result["objects"][0]
    assert obj.box.model_dump() == {"x": .4, "y": .4, "width": .15, "height": .2}
    assert obj.confidence == .9609375
    assert obj.source == "sam_3_1"


def test_absent_confidence_is_none_and_inclusive_edges_are_preserved():
    items = parse_sam_image(sam_text(confidence="", x1=99, y1=59, x2=99, y2=59), "button", 100, 60)
    assert items[0].confidence is None
    assert items[0].box.width == .01
    assert items[0].box.x + items[0].box.width == 1


@pytest.mark.parametrize("text", ["garbage", "<1f>something", sam_text(w=200), sam_text(x2=100), sam_text(confidence=";c=1.5"), sam_text().replace(";x1=40", ";x1=-1"), sam_text().replace(";data=12,15", ";data=0,15"), sam_text() + ",", sam_text().replace("<|mask", "<|unknown"), sam_text() + "," + sam_text()[4:]])
def test_malformed_detections_fail_closed(text):
    with pytest.raises(ProviderError):
        parse_sam_image(text, "book", 100, 60)


def test_sam_empty_matches_are_not_simulated_success():
    result = run(service(lambda _: httpx.Response(200, json=sam_response(""))).analyze(AIAnalysisRequest(image_url=photo(), concepts=["unicorn"])))
    assert result["objects"] == []
    assert "No matches" in result["message"]


@pytest.mark.parametrize("body", [{"status": "incomplete", "output": []}, {"status": "completed", "output": ["invalid"]}, {"status": "completed", "output": [{"type": "message", "content": [{"type": "refusal", "refusal": "no"}]}]}, {"status": "completed", "output": {"unexpected": True}}])
def test_invalid_sam_envelopes_do_not_become_empty_detections(body):
    with pytest.raises(ProviderError):
        run(service(lambda _: httpx.Response(200, json=body)).analyze(AIAnalysisRequest(image_url=photo(), concepts=["book"])))


def test_invalid_provider_json_is_sanitized():
    with pytest.raises(ProviderError, match="invalid JSON"):
        run(service(lambda _: httpx.Response(200, text="SECRET not JSON")).reason(reasoning_request()))


def test_health_does_not_expose_credentials(monkeypatch):
    monkeypatch.setenv("MODEL_API_KEY", "test-secret-not-for-browser")
    monkeypatch.setenv("BASETEN_API_KEY", "test-baseten-secret-not-for-browser")
    response = TestClient(app).get("/api/health")
    assert "test-secret" not in response.text
    assert "test-baseten-secret" not in response.text
    assert response.json()["ai"]["muse"]["status"] == "configured_not_live_verified"


def test_muse_discovers_concepts_then_one_sam_call_per_concept():
    seen = []
    def handler(request):
        data = json.loads(request.content)
        if request.url.path.endswith("chat/completions"):
            assert data["response_format"]["type"] == "json_schema"
            assert data["messages"][1]["content"][1]["type"] == "image_url"
            return httpx.Response(200, json=chat({"concepts": ["book", "coffee cup"], "summary": "Two visible obstacles."}))
        concept = data["input"][0]["content"][0]["text"]
        seen.append(concept)
        text = sam_text() if concept == "book" else sam_text(x1=80, y1=6, x2=89, y2=11)
        return httpx.Response(200, json=sam_response(text))
    result = run(service(handler).analyze(AIAnalysisRequest(image_url=photo())))
    assert seen == ["book", "coffee cup"]
    assert len(result["objects"]) == 2
    assert len({o.id for o in result["objects"]}) == 2


def test_duplicate_concept_boxes_are_removed_without_inventing_confidence():
    result = run(service(lambda _: httpx.Response(200, json=sam_response(sam_text(confidence="")))).analyze(AIAnalysisRequest(image_url=photo(), concepts=["book", "notebook"])))
    assert len(result["objects"]) == 1
    assert result["objects"][0].confidence is None
    assert "near-identical" in result["warnings"][1]


def test_muse_reasoning_uses_ids_json_schema_and_multimodal_input():
    def handler(request):
        assert request.url.path == "/v1/chat/completions"
        data = json.loads(request.content)
        assert data["model"] == "muse-spark-1.3"
        assert data["response_format"]["json_schema"]["name"] == "PlanningConstraints"
        assert data["messages"][0]["role"] == "developer"
        assert data["messages"][1]["content"][1]["type"] == "image_url"
        return httpx.Response(200, json=chat(constraints(protected_object_ids=["book"])))
    result = run(service(handler).reason(reasoning_request()))
    # Explicit locks cannot be removed by a model response.
    assert result["constraints"].protected_object_ids == ["book", "coffee"]
    assert result["confidence"] is None


@pytest.mark.parametrize("body", [chat({"made_up": True}), chat(constraints(protected_object_ids=["unknown"])), {"choices": []}, chat(constraints(), choices=[{"finish_reason": "length", "message": {"content": "{}"}}]), chat(constraints(), choices=[{"finish_reason": "stop", "message": {"refusal": "refused"}}])])
def test_invalid_reasoning_is_not_applied(body):
    with pytest.raises(ProviderError):
        run(service(lambda _: httpx.Response(200, json=body)).reason(reasoning_request()))


def test_reviewed_protection_reaches_unchanged_deterministic_planner():
    req = reasoning_request()
    request = PlanRequest(objects=req.objects, target=req.target, goal="Clear target", constraints=PlanningConstraints(**constraints(protected_object_ids=["book"])))
    assert plan_with_constraints(request).status == "impossible"
    assert request.objects[0].locked is False  # Applying constraints does not mutate user annotations.


@pytest.mark.parametrize("extra", [{"needs_clarification": True}, {"unsupported_requirements": ["stack objects"]}, {"protected_object_ids": ["unknown"]}])
def test_unresolved_and_unknown_constraints_cannot_reach_planner(extra):
    req = reasoning_request()
    with pytest.raises(ValidationError):
        PlanRequest(objects=req.objects, target=req.target, goal=req.goal, constraints=PlanningConstraints(**constraints(**extra)))


@pytest.mark.parametrize("status,expected", [(401, 502), (403, 502), (402, 502), (429, 429), (500, 502), (302, 502)])
def test_provider_errors_are_sanitized_without_retries(status, expected):
    calls = []
    def handler(request):
        calls.append(request)
        return httpx.Response(status, text="SECRET_PROVIDER_BODY_and_key", headers={"location": "https://evil.example"})
    with pytest.raises(ProviderError) as error:
        run(service(handler).reason(reasoning_request()))
    assert error.value.status == expected
    assert "SECRET" not in str(error.value)
    assert len(calls) == 1


def test_timeout_is_explicit_and_safe():
    def handler(request):
        raise httpx.ReadTimeout("secret detail", request=request)
    with pytest.raises(ProviderError) as error:
        run(service(handler).reason(reasoning_request()))
    assert error.value.status == 504
    assert "secret" not in str(error.value)


def test_missing_credentials_make_no_request():
    def fail(_):
        pytest.fail("No external request may be attempted without credentials")
    instance = AIService(ProviderHTTP(AISettings(sam_provider="meta"), httpx.MockTransport(fail)))
    with pytest.raises(ProviderError, match="MODEL_API_KEY"):
        run(instance.reason(reasoning_request()))


def test_baseten_sam_contract_is_blocked_even_with_credentials():
    def fail(_):
        pytest.fail("Do not guess Baseten SAM's contract")
    instance = AIService(ProviderHTTP(AISettings(sam_provider="baseten", baseten_key="test-key", baseten_sam_model_id="example"), httpx.MockTransport(fail)))
    with pytest.raises(ProviderError, match="contract"):
        run(instance.analyze(AIAnalysisRequest(image_url=photo())))


def test_verified_baseten_general_transport_url_and_auth_only():
    def handler(request):
        assert str(request.url) == "https://model-test123.api.baseten.co/environments/production/predict"
        assert request.headers["authorization"] == "Bearer test-baseten-key"
        assert json.loads(request.content) == {"caller_verified_contract": "fixture"}
        return httpx.Response(200, json={"result": "fixture"})
    transport = ProviderHTTP(AISettings(baseten_key="test-baseten-key", baseten_sam_model_id="test123"), httpx.MockTransport(handler))
    assert run(BasetenDeployment(transport).predict({"caller_verified_contract": "fixture"})) == {"result": "fixture"}


def test_usage_logs_never_include_secrets_image_goal_or_response(caplog):
    caplog.set_level(logging.INFO, logger="uvicorn.error.worldos.usage")
    run(service(lambda _: httpx.Response(200, json=chat(constraints()))).reason(reasoning_request()))
    text = caplog.text
    assert '"prompt_tokens": 123' in text
    assert '"operation": "interpret_goal"' in text
    for private in ["test-meta-key", "base64", "Give my laptop", "selected target", "Authorization"]:
        assert private not in text


@pytest.mark.parametrize("url", ["https://example.com/image.png", "data:image/svg+xml;base64,AAAA", "data:image/png;base64,invalid"])
def test_client_images_are_validated_without_fetching_arbitrary_urls(url):
    def fail(_):
        pytest.fail("Invalid images must fail before sending a request")
    with pytest.raises(ValueError):
        run(service(fail).analyze(AIAnalysisRequest(image_url=url, concepts=["book"])))


def test_concepts_are_deduplicated_and_lists_are_not_sent_as_single_prompt():
    assert validate_concepts(["book", " Book "]) == ["book"]
    with pytest.raises(ValueError):
        validate_concepts(["book, cup"])


def test_api_integration_with_mocked_upstream_and_manual_fallback():
    instance = service(lambda request: httpx.Response(200, json=sam_response() if request.url.path.endswith("responses") else chat(constraints())))
    app.dependency_overrides[get_ai_service] = lambda: instance
    try:
        client = TestClient(app)
        detected = client.post("/api/ai/analyze", json={"image_url": photo(), "concepts": ["book"]})
        assert detected.status_code == 200
        assert detected.json()["objects"][0]["confidence"] == .9609375
        interpreted = client.post("/api/ai/reason", json=reasoning_request().model_dump())
        assert interpreted.status_code == 200
        assert interpreted.json()["constraints"]["protected_object_ids"] == ["coffee"]
        req = reasoning_request()
        assert client.post("/api/plan", json={"objects": [o.model_dump() for o in req.objects], "target": req.target.model_dump(), "goal": "Clear target"}).status_code == 200
    finally:
        app.dependency_overrides.clear()
