"""Connection diagnostics use mocked responses and never perform live inference."""
import asyncio
import json

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.ai_service import AIService
from backend.connection import ConnectionRegistry, ConnectionTester, diagnostics
from backend.main import app, get_ai_service, get_connection_registry
from backend.providers import AISettings, ProviderError, ProviderHTTP


def run(coro):
    return asyncio.run(coro)


def chat(**kwargs):
    return {"model": "muse-spark-1.3", "object": "chat.completion", "choices": [{"finish_reason": "stop", "message": {"role": "assistant", "content": "OK"}}], **kwargs}


def make_tester(handler, **settings):
    http = ProviderHTTP(AISettings(meta_key="synthetic-secret", sam_provider="meta", **settings), httpx.MockTransport(handler))
    return ConnectionTester(http, ConnectionRegistry())


def test_configuration_never_establishes_connection_or_makes_requests():
    registry = ConnectionRegistry()
    settings = AISettings(meta_key="do-not-expose", baseten_key="also-private", sam_provider="meta")
    result = diagnostics(settings, registry)
    assert result["credentials"]["meta_api_key_configured"] is True
    assert result["selected_sam_provider"] == "meta"
    for entry in result["integrations"].values():
        assert entry["configuration"]["status"] == "configured_not_verified"
        assert entry["last_test"]["status"] == "not_tested"
        assert not entry["last_test"]["ever_live_request_succeeded"]
    serialized = json.dumps(result)
    assert "do-not-expose" not in serialized and "also-private" not in serialized
    assert "fingerprint" not in serialized


def test_missing_key_makes_no_request():
    def fail(_):
        pytest.fail("No provider call may occur without credentials")
    connection = ConnectionTester(ProviderHTTP(AISettings(sam_provider="meta"), httpx.MockTransport(fail)), ConnectionRegistry())
    for model in ("muse", "sam"):
        result = run(connection.test(model))
        assert result["integrations"][model]["last_test"]["status"] == "missing_credentials"


def test_baseten_contract_is_not_invented_even_with_a_key_and_model_id():
    def fail(_):
        pytest.fail("Do not invent Baseten SAM request formats")
    settings = AISettings(baseten_key="synthetic-key", baseten_sam_model_id="actual-id")
    connection = ConnectionTester(ProviderHTTP(settings, httpx.MockTransport(fail)), ConnectionRegistry())
    result = run(connection.test("sam"))
    assert result["selected_sam_provider"] == "baseten"
    assert result["integrations"]["sam"]["last_test"]["status"] == "blocked_deployment_contract"
    assert result["credentials"]["baseten_sam_model_id_configured"] is True
    assert "actual-id" not in json.dumps(result)


def test_muse_probe_is_one_small_documented_request_and_mocks_are_not_live():
    calls = []
    def handler(request):
        calls.append(request)
        data = json.loads(request.content)
        assert str(request.url) == "https://api.meta.ai/v1/chat/completions"
        assert request.headers["authorization"] == "Bearer synthetic-secret"
        assert data == {"model": "muse-spark-1.3", "messages": [{"role": "user", "content": "Reply briefly with OK."}], "max_completion_tokens": 256, "reasoning_effort": "minimal"}
        return httpx.Response(200, json=chat())
    result = run(make_tester(handler).test("muse"))
    state = result["integrations"]["muse"]["last_test"]
    assert state["status"] == "validated_test_response"
    assert state["live_request_succeeded"] is False
    assert state["last_success_at"] is None
    assert len(calls) == 1
    assert result["integrations"]["sam"]["last_test"]["status"] == "not_tested"


def test_meta_sam_probe_sends_only_generated_image_and_one_concept():
    def handler(request):
        data = json.loads(request.content)
        assert request.url.path == "/v1/responses"
        assert data["model"] == "sam-3.1"
        assert data["input"][0]["content"][0]["text"] == "red square"
        assert data["input"][0]["content"][1]["image_url"].startswith("data:image/jpeg;base64,")
        return httpx.Response(200, json={"status": "completed", "output": []})
    result = run(make_tester(handler).test("sam"))
    assert result["integrations"]["sam"]["last_test"]["status"] == "validated_test_response"
    assert result["integrations"]["sam"]["test_scope"] == "synthetic_image_segmentation"


@pytest.mark.parametrize("http_status,code,expected", [(401, "invalid_api_key", "invalid_credentials"), (402, "billing_not_configured", "insufficient_credits"), (403, None, "unsupported_model_access"), (404, "model_not_found", "unsupported_model_access"), (404, "file_not_found", "provider_error"), (408, None, "timeout"), (504, "gateway_timeout", "timeout"), (429, "rate_limit_exceeded", "rate_limited"), (503, "backend_unavailable", "provider_error")])
def test_provider_failure_states_are_distinct_and_sanitized(http_status, code, expected):
    result = run(make_tester(lambda _: httpx.Response(http_status, json={"error": {"code": code, "message": "private-upstream-message-and-key"}})).test("muse"))
    state = result["integrations"]["muse"]["last_test"]
    assert state["status"] == expected
    assert state["provider_http_status"] == http_status
    assert not state["live_request_succeeded"]
    assert "private-upstream-message" not in json.dumps(result)


@pytest.mark.parametrize("response", [chat(choices=[]), chat(model="wrong-model"), chat(choices=[{"finish_reason": "length", "message": {"role": "assistant", "content": "OK"}}]), chat(choices=[{"finish_reason": "stop", "message": {"role": "assistant", "content": ""}}]), chat(choices=["malformed"]), {"some": "other schema"}])
def test_malformed_success_envelopes_are_never_connected(response):
    result = run(make_tester(lambda _: httpx.Response(200, json=response)).test("muse"))
    assert result["integrations"]["muse"]["last_test"]["status"] == "malformed_response"


def test_invalid_json_and_sam_output_fail_validation():
    result = run(make_tester(lambda _: httpx.Response(200, text="not-json")).test("muse"))
    assert result["integrations"]["muse"]["last_test"]["status"] == "malformed_response"
    result = run(make_tester(lambda _: httpx.Response(200, json={"status": "completed", "output": ["not-a-record"]})).test("sam"))
    assert result["integrations"]["sam"]["last_test"]["status"] == "malformed_response"


@pytest.mark.parametrize("error,expected", [(httpx.ReadTimeout("private-timeout"), "timeout"), (httpx.ConnectError("private-network"), "network_error")])
def test_network_and_timeout_states(error, expected):
    def handler(_):
        raise error
    result = run(make_tester(handler).test("muse"))
    assert result["integrations"]["muse"]["last_test"]["status"] == expected
    assert "private-" not in json.dumps(result)


def test_success_history_survives_later_failure_but_not_key_model_or_process_change():
    # Unit-test the registry's recording logic; this does not perform or claim a live call.
    registry = ConnectionRegistry()
    settings = AISettings(meta_key="first", sam_provider="meta")
    registry.begin(settings, "muse")
    registry.finish(settings, "muse", "success", "unit fixture", live=True)
    assert registry.state(settings, "muse")["last_success_at"]
    registry.begin(settings, "muse")
    registry.finish(settings, "muse", "invalid_credentials", "unit fixture")
    state = registry.state(settings, "muse")
    assert state["ever_live_request_succeeded"] and not state["live_request_succeeded"]
    assert not registry.state(AISettings(meta_key="changed", sam_provider="meta"), "muse")["ever_live_request_succeeded"]
    assert not registry.state(AISettings(meta_key="first", muse_model="muse-spark-1.2"), "muse")["ever_live_request_succeeded"]
    assert not ConnectionRegistry().state(settings, "muse")["ever_live_request_succeeded"]


def test_duplicate_test_does_not_send_a_second_request_and_old_config_cannot_overwrite_new():
    registry = ConnectionRegistry()
    old = AISettings(meta_key="first")
    registry.begin(old, "muse")
    with pytest.raises(ProviderError, match="already running"):
        registry.begin(old, "muse")
    new = AISettings(meta_key="second")
    registry.state(new, "muse")
    registry.finish(old, "muse", "success", "old result", live=True)
    assert not registry.state(new, "muse")["ever_live_request_succeeded"]


def test_diagnostics_and_action_endpoints_are_secret_safe_and_get_is_passive(monkeypatch):
    registry = ConnectionRegistry()
    calls = []
    def handler(request):
        calls.append(request)
        return httpx.Response(401, text="SECRET_BODY")
    settings = AISettings(meta_key="server-secret", sam_provider="meta")
    monkeypatch.setenv("MODEL_API_KEY", "server-secret")
    monkeypatch.setenv("WORLDOS_SAM_PROVIDER", "meta")
    app.dependency_overrides[get_connection_registry] = lambda: registry
    app.dependency_overrides[get_ai_service] = lambda: AIService(ProviderHTTP(settings, httpx.MockTransport(handler)))
    try:
        client = TestClient(app)
        result = client.get("/api/ai/diagnostics")
        assert result.status_code == 200
        assert result.headers["cache-control"] == "no-store"
        assert not calls
        assert "server-secret" not in result.text
        result = client.post("/api/ai/connection-test", json={"integration": "muse"})
        assert result.json()["integrations"]["muse"]["last_test"]["status"] == "invalid_credentials"
        assert len(calls) == 1
        assert "SECRET_BODY" not in result.text
        assert client.post("/api/ai/connection-test", json={"integration": "muse", "api_key": "not-accepted"}).status_code == 422
        assert not client.get("/api/health").json()["ai"]["live_tested"]
    finally:
        app.dependency_overrides.clear()


def test_invalid_backend_settings_are_reported_without_echoing_values(monkeypatch):
    monkeypatch.setenv("WORLDOS_MUSE_MODEL", "secret-misconfigured-value")
    response = TestClient(app).get("/api/ai/diagnostics")
    assert "configuration_error" in response.json()
    assert "secret-misconfigured-value" not in response.text


def test_test_result_is_recorded_only_after_validated_default_transport(monkeypatch):
    # Unit simulation of an actual transport return, not a live inference result.
    http = ProviderHTTP(AISettings(meta_key="synthetic-key", sam_provider="meta"))
    async def returned(**_):
        return chat()
    monkeypatch.setattr(http, "post", returned)
    registry = ConnectionRegistry()
    result = run(ConnectionTester(http, registry).test("muse"))
    state = result["integrations"]["muse"]["last_test"]
    assert state["status"] == "success" and state["live_request_succeeded"]
    assert state["last_success_at"] is not None
    # Validate-first guard must still apply even when the default transport is selected.
    async def malformed(**_):
        return chat(choices=[])
    monkeypatch.setattr(http, "post", malformed)
    result = run(ConnectionTester(http, registry).test("muse"))
    state = result["integrations"]["muse"]["last_test"]
    assert state["status"] == "malformed_response"
    assert not state["live_request_succeeded"] and state["ever_live_request_succeeded"]
