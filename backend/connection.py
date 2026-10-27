"""Explicit, small inference probes; configuration checks never invoke a provider."""
import hashlib
import hmac
import io
import json
import os
import threading
from datetime import datetime, timezone
from typing import Literal

from PIL import Image, ImageDraw
from pydantic import BaseModel, ConfigDict

from .ai_adapters import SAM31Segmentation
from .imaging import prepare_image
from .providers import AISettings, META_BASE, ProviderError, ProviderHTTP, logger

Integration = Literal["muse", "sam"]


class ConnectionTestRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    integration: Integration = "muse"


def timestamp():
    return datetime.now(timezone.utc).isoformat()


class ConnectionRegistry:
    """At most two records, scoped to this process and the current configuration.

    Credential fingerprints are keyed with a random boot secret and never leave
    the process. No credentials, response text, or uploads are persisted.
    """
    def __init__(self):
        self._secret = os.urandom(32)
        self._records: dict[str, tuple[bytes, dict]] = {}
        self._lock = threading.Lock()

    def _identity(self, settings: AISettings, integration: Integration):
        fields = list(settings.reasoning_config()) if integration == "muse" else [settings.sam_provider, settings.meta_key if settings.sam_provider == "meta" else settings.baseten_key, settings.baseten_sam_model_id if settings.sam_provider == "baseten" else "sam-3.1"]
        return hmac.digest(self._secret, json.dumps(fields).encode(), hashlib.sha256)

    def _record(self, settings: AISettings, integration: Integration):
        identity = self._identity(settings, integration)
        saved = self._records.get(integration)
        if not saved or not hmac.compare_digest(saved[0], identity):
            saved = (identity, {"status": "not_tested", "message": "No connection inference has been tested with this configuration in this server process.", "last_attempt_at": None, "last_completed_at": None, "last_success_at": None, "live_request_succeeded": False, "ever_live_request_succeeded": False, "test_in_progress": False, "provider_http_status": None, "inference_latency_ms": None, "usage": {}})
            self._records[integration] = saved
        return saved[1]

    def state(self, settings: AISettings, integration: Integration):
        with self._lock:
            return dict(self._record(settings, integration))

    def begin(self, settings: AISettings, integration: Integration):
        with self._lock:
            state = self._record(settings, integration)
            if state["test_in_progress"]:
                raise ProviderError("A connection test is already running for this model. Wait for it to finish.", 409, "test_in_progress")
            state.update(test_in_progress=True, live_request_succeeded=False, status="testing", message="An explicit connection inference is running.", last_attempt_at=timestamp(), provider_http_status=None)

    def finish(self, settings: AISettings, integration: Integration, status: str, message: str, *, live=False, http_status=None, metadata=None):
        with self._lock:
            saved = self._records.get(integration)
            # A completed request for old credentials must not replace a newer result.
            if not saved or not hmac.compare_digest(saved[0], self._identity(settings, integration)):
                return
            state = saved[1]
            state.update(status=status, message=message, test_in_progress=False, live_request_succeeded=live, provider_http_status=http_status, last_completed_at=timestamp())
            if live:
                state.update(last_success_at=timestamp(), ever_live_request_succeeded=True)
            if metadata:
                state.update(inference_latency_ms=metadata.get("inference_latency_ms"), usage=metadata.get("usage", {}))


def configuration(settings: AISettings, integration: Integration):
    provider = settings.reasoning_provider if integration == "muse" else settings.sam_provider
    configured = bool(settings.meta_key if provider == "meta" else settings.baseten_key)
    if not configured:
        return {"status": "missing_credentials", "credentials_configured": False, "message": f"Set {'MODEL_API_KEY' if provider == 'meta' else 'BASETEN_API_KEY'} on the backend. No provider request has been made."}
    if integration == "sam" and provider == "baseten":
        return {"status": "blocked_deployment_contract", "credentials_configured": True, "message": "Baseten SAM requires your deployment ID and its verified input/output contract. A key alone cannot enable a safe inference test; no Baseten request will be sent."}
    return {"status": "configured_not_verified", "credentials_configured": True, "message": "A credential is configured. This does not establish validity, credits, model access, or a working connection."}


def readiness(config, state, latest, provider, last_failure=None):
    """Current-process evidence, never an uptime or physical-accuracy guarantee."""
    required = "MODEL_API_KEY" if provider == "meta" else "BASETEN_API_KEY"
    if config["status"] != "configured_not_verified":
        status, message = "blocked", config["message"]
    elif state["test_in_progress"]:
        status, message = "checking", "A connection check is running. Wait for its validated result."
    else:
        last_live = (latest or {}) if (latest or {}).get("live_request") else {}
        failed = state["status"] not in {"not_tested", "success", "validated_test_response"}
        failure_time = state.get("last_completed_at") or state.get("last_attempt_at")
        inference_time = last_live.get("inferred_at")
        later_inference = bool(inference_time and failure_time and datetime.fromisoformat(inference_time) > datetime.fromisoformat(failure_time))
        if failed and not later_inference:
            status, message = "needs_retest", "The latest connection check failed. Resolve the reported error and test again; earlier success is historical."
        elif state["live_request_succeeded"] or last_live:
            status, message = "verified", "A validated live inference succeeded in this process. This verifies connectivity, not photograph accuracy or physical task completion."
        else:
            status, message = "unverified", "Credentials are configured; run an explicit connection check to verify access. No live success is assumed."
    successes = [value for value in (state.get("last_success_at"), (latest or {}).get("inferred_at") if (latest or {}).get("live_request") else None) if value]
    if (last_failure and last_failure.get("live_request") and not state["test_in_progress"]
            and config["status"] == "configured_not_verified"
            and (not successes or last_failure["failed_at"] >= max(successes))):
        status, message = "needs_retest", "The latest provider request failed. " + last_failure["message"] + " No success is assumed; retry explicitly after resolving the problem."
    return {"status": status, "message": message, "required_variable": required}


def diagnostics(settings: AISettings, registry: ConnectionRegistry, http=None):
    settings.validate()
    result = {"selected_sam_provider": settings.sam_provider, "scope": "current_server_process_and_configuration", "credentials": {
        "meta_api_key_configured": bool(settings.meta_key), "baseten_api_key_configured": bool(settings.baseten_key), "baseten_sam_model_id_configured": bool(settings.baseten_sam_model_id)}, "integrations": {}}
    for integration in ("muse", "sam"):
        state = registry.state(settings, integration)
        provider = settings.reasoning_provider if integration == "muse" else settings.sam_provider
        model = settings.reasoning_config()[1] if integration == "muse" else "sam-3.1" if settings.sam_provider == "meta" else None
        latest = http.validated_inferences.get((provider, model)) if http else None
        failure = http.failed_inferences.get((provider, model)) if http else None
        config = configuration(settings, integration)
        result["integrations"][integration] = {"provider": provider,
            "model": model,
            "last_inference": latest,
            "last_failure": failure,
            "readiness": readiness(config, state, latest, provider, failure),
            "fallback_available": bool(integration == "muse" and provider == "baseten" and settings.meta_key),
            "configuration": config, "last_test": state,
            "test_scope": "text_inference" if integration == "muse" else "synthetic_image_segmentation" if settings.sam_provider == "meta" else "blocked_deployment_contract"}
    return result


class ConnectionTester:
    def __init__(self, http: ProviderHTTP, registry: ConnectionRegistry):
        self.http, self.registry = http, registry

    async def _probe(self, integration: Integration):
        if integration == "sam":
            # Exercise SAM's actual image contract without uploading user data.
            image = Image.new("RGB", (64, 64), "white")
            ImageDraw.Draw(image).rectangle((16, 16, 47, 47), fill="red")
            stream = io.BytesIO()
            image.save(stream, format="PNG")
            adapter = SAM31Segmentation(self.http)
            await adapter.segment(prepare_image(stream.getvalue()), "red square", connection_probe=True)
            # Zero matches still proves completion of inference, not detection accuracy.
            return adapter.metadata()
        provider, model, base_url, key = self.http.settings.reasoning_config()
        options = {"max_tokens": 256} if provider == "baseten" else {"max_completion_tokens": 256, "reasoning_effort": "minimal"}
        data = await self.http.post(provider=provider, model=model, operation="test_connection", url=f"{base_url}/chat/completions", key=key, include_metadata=True,
            payload={"model": model, "messages": [{"role": "user", "content": "Reply briefly with OK."}], **options})
        try:
            choice = data["choices"][0]
            if data["model"] != model or data["object"] != "chat.completion" or choice["finish_reason"] != "stop":
                raise ValueError()
            message = choice["message"]
            if message.get("role") != "assistant" or message.get("refusal") or not isinstance(message.get("content"), str) or not message["content"].strip():
                raise ValueError()
        except (KeyError, IndexError, TypeError, ValueError, AttributeError):
            raise ProviderError("The provider returned an incomplete or malformed Muse inference response. No connection success was recorded.", code="malformed_response") from None
        metadata=data.get("_worldos_metadata")
        self.http.record_validated(metadata)
        return metadata

    async def test(self, integration: Integration):
        settings = self.http.settings
        self.registry.begin(settings, integration)
        try:
            config = configuration(settings, integration)
            if config["status"] in {"missing_credentials", "blocked_deployment_contract"}:
                raise ProviderError(config["message"], 503, config["status"])
            metadata = await self._probe(integration)
            # Test fixtures use an injected transport. Never label those as live.
            live = self.http.transport is None
            self.registry.finish(settings, integration, "success" if live else "validated_test_response", "A real provider inference completed with a validated response." if live else "An injected test response was validated; no live connection was verified.", live=live, http_status=200, metadata=metadata)
        except ProviderError as error:
            self.registry.finish(settings, integration, error.code, str(error), http_status=error.http_status)
        except BaseException:
            self.registry.finish(settings, integration, "interrupted", "Connection test was interrupted. No success was recorded.")
            raise
        state = self.registry.state(settings, integration)
        logger.info(json.dumps({"event": "ai_connection_test", "integration": integration, "status": state["status"], "live_request_succeeded": state["live_request_succeeded"]}))
        return diagnostics(settings, self.registry, self.http)
