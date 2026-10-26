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
        fields = [settings.meta_key, settings.muse_model] if integration == "muse" else [settings.sam_provider, settings.meta_key if settings.sam_provider == "meta" else settings.baseten_key, settings.baseten_sam_model_id if settings.sam_provider == "baseten" else "sam-3.1"]
        return hmac.digest(self._secret, json.dumps(fields).encode(), hashlib.sha256)

    def _record(self, settings: AISettings, integration: Integration):
        identity = self._identity(settings, integration)
        saved = self._records.get(integration)
        if not saved or not hmac.compare_digest(saved[0], identity):
            saved = (identity, {"status": "not_tested", "message": "No connection inference has been tested with this configuration in this server process.", "last_attempt_at": None, "last_success_at": None, "live_request_succeeded": False, "ever_live_request_succeeded": False, "test_in_progress": False, "provider_http_status": None})
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

    def finish(self, settings: AISettings, integration: Integration, status: str, message: str, *, live=False, http_status=None):
        with self._lock:
            saved = self._records.get(integration)
            # A completed request for old credentials must not replace a newer result.
            if not saved or not hmac.compare_digest(saved[0], self._identity(settings, integration)):
                return
            state = saved[1]
            state.update(status=status, message=message, test_in_progress=False, live_request_succeeded=live, provider_http_status=http_status)
            if live:
                state.update(last_success_at=timestamp(), ever_live_request_succeeded=True)


def configuration(settings: AISettings, integration: Integration):
    provider = "meta" if integration == "muse" else settings.sam_provider
    configured = bool(settings.meta_key if provider == "meta" else settings.baseten_key)
    if not configured:
        return {"status": "missing_credentials", "credentials_configured": False, "message": f"Set {'MODEL_API_KEY' if provider == 'meta' else 'BASETEN_API_KEY'} on the backend. No provider request has been made."}
    if integration == "sam" and provider == "baseten":
        return {"status": "blocked_deployment_contract", "credentials_configured": True, "message": "Baseten SAM requires your deployment ID and its verified input/output contract. A key alone cannot enable a safe inference test; no Baseten request will be sent."}
    return {"status": "configured_not_verified", "credentials_configured": True, "message": "A credential is configured. This does not establish validity, credits, model access, or a working connection."}


def diagnostics(settings: AISettings, registry: ConnectionRegistry):
    settings.validate()
    result = {"selected_sam_provider": settings.sam_provider, "scope": "current_server_process_and_configuration", "credentials": {
        "meta_api_key_configured": bool(settings.meta_key), "baseten_api_key_configured": bool(settings.baseten_key), "baseten_sam_model_id_configured": bool(settings.baseten_sam_model_id)}, "integrations": {}}
    for integration in ("muse", "sam"):
        state = registry.state(settings, integration)
        result["integrations"][integration] = {"provider": "meta" if integration == "muse" else settings.sam_provider,
            "model": settings.muse_model if integration == "muse" else "sam-3.1" if settings.sam_provider == "meta" else None,
            "configuration": configuration(settings, integration), "last_test": state,
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
            await SAM31Segmentation(self.http).segment(prepare_image(stream.getvalue()), "red square")
            # Zero matches still proves completion of inference, not detection accuracy.
            return
        data = await self.http.post(provider="meta", model=self.http.settings.muse_model, operation="test_connection", url=f"{META_BASE}/chat/completions", key=self.http.settings.meta_key,
            payload={"model": self.http.settings.muse_model, "messages": [{"role": "user", "content": "Reply briefly with OK."}], "max_completion_tokens": 256, "reasoning_effort": "minimal"})
        try:
            choice = data["choices"][0]
            if data["model"] != self.http.settings.muse_model or data["object"] != "chat.completion" or choice["finish_reason"] != "stop":
                raise ValueError()
            message = choice["message"]
            if message.get("role") != "assistant" or message.get("refusal") or not isinstance(message.get("content"), str) or not message["content"].strip():
                raise ValueError()
        except (KeyError, IndexError, TypeError, ValueError, AttributeError):
            raise ProviderError("The provider returned an incomplete or malformed Muse inference response. No connection success was recorded.", code="malformed_response") from None

    async def test(self, integration: Integration):
        settings = self.http.settings
        self.registry.begin(settings, integration)
        try:
            config = configuration(settings, integration)
            if config["status"] in {"missing_credentials", "blocked_deployment_contract"}:
                raise ProviderError(config["message"], 503, config["status"])
            await self._probe(integration)
            # Test fixtures use an injected transport. Never label those as live.
            live = self.http.transport is None
            self.registry.finish(settings, integration, "success" if live else "validated_test_response", "A real provider inference completed with a validated response." if live else "An injected test response was validated; no live connection was verified.", live=live, http_status=200)
        except ProviderError as error:
            self.registry.finish(settings, integration, error.code, str(error), http_status=error.http_status)
        except BaseException:
            self.registry.finish(settings, integration, "interrupted", "Connection test was interrupted. No success was recorded.")
            raise
        state = self.registry.state(settings, integration)
        logger.info(json.dumps({"event": "ai_connection_test", "integration": integration, "status": state["status"], "live_request_succeeded": state["live_request_succeeded"]}))
        return diagnostics(settings, self.registry)
