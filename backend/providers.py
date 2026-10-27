"""Verified provider transports. Do not log request bodies, URLs, or provider errors."""
import asyncio
import json
import logging
import os
import re
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone

import httpx

logger = logging.getLogger("uvicorn.error.worldos.usage")
META_BASE = "https://api.meta.ai/v1"
BASETEN_BASE = "https://inference.baseten.co/v1"


class ProviderError(Exception):
    def __init__(self, message: str, status: int = 502, code: str = "provider_error", http_status: int | None = None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.http_status = http_status


@dataclass(frozen=True)
class AISettings:
    meta_key: str = field(default="", repr=False)
    baseten_key: str = field(default="", repr=False)
    sam_provider: str = "baseten"
    baseten_sam_model_id: str = ""
    muse_model: str = "muse-spark-1.3"
    muse_provider: str = "auto"
    baseten_muse_model: str = "meta-models/muse-spark-open-1026"
    baseten_base_url: str = BASETEN_BASE
    timeout: float = 45

    @classmethod
    def from_env(cls):
        return cls(meta_key=os.getenv("MODEL_API_KEY", "").strip(),
                   baseten_key=os.getenv("BASETEN_API_KEY", "").strip(),
                   sam_provider=os.getenv("WORLDOS_SAM_PROVIDER", "baseten"),
                   baseten_sam_model_id=os.getenv("BASETEN_SAM_MODEL_ID", ""),
                   muse_model=os.getenv("WORLDOS_MUSE_MODEL", "muse-spark-1.3"),
                   muse_provider=os.getenv("WORLDOS_MUSE_PROVIDER", "auto").strip(),
                   baseten_muse_model=os.getenv("BASETEN_MUSE_MODEL", "meta-models/muse-spark-open-1026").strip(),
                   baseten_base_url=os.getenv("BASETEN_BASE_URL", BASETEN_BASE).rstrip('/'),
                   timeout=float(os.getenv("WORLDOS_AI_TIMEOUT_SECONDS", "45")))

    def validate(self):
        if self.muse_provider not in {"auto", "meta", "baseten"}:
            raise ProviderError("WORLDOS_MUSE_PROVIDER must be auto, meta, or baseten.", 503)
        if self.baseten_base_url != BASETEN_BASE:
            raise ProviderError("BASETEN_BASE_URL must use the official Baseten HTTPS Model API endpoint.", 503)
        if not re.fullmatch(r"meta-models/muse-spark-open(?:-\d{4})?", self.baseten_muse_model):
            raise ProviderError("BASETEN_MUSE_MODEL must name a Muse Spark Open model.", 503)
        if self.sam_provider not in {"meta", "baseten"}:
            raise ProviderError("WORLDOS_SAM_PROVIDER must be meta or baseten.", 503)
        if self.muse_model not in {"muse-spark-1.1", "muse-spark-1.2", "muse-spark-1.3"}:
            raise ProviderError("WORLDOS_MUSE_MODEL must name a documented standard Muse Spark model.", 503)
        if not 1 <= self.timeout <= 90:
            raise ProviderError("WORLDOS_AI_TIMEOUT_SECONDS must be between 1 and 90.", 503)

    @property
    def reasoning_provider(self):
        return ("baseten" if self.baseten_key else "meta") if self.muse_provider == "auto" else self.muse_provider

    def reasoning_config(self, provider=None):
        provider = provider or self.reasoning_provider
        return (provider, self.baseten_muse_model, self.baseten_base_url, self.baseten_key) if provider == "baseten" else (provider, self.muse_model, META_BASE, self.meta_key)


class ProviderHTTP:
    def __init__(self, settings: AISettings, transport: httpx.AsyncBaseTransport | None = None):
        settings.validate()
        self.settings = settings
        self.transport = transport
        self.validated_inferences = {}
        self.failed_inferences = {}

    def record_failure(self, provider, model, operation, error, started):
        # Only bounded, app-authored error messages are retained; never upstream
        # response bodies, request payloads, headers, or credentials.
        self.failed_inferences[(provider, model)] = {
            "provider": provider, "model": model, "operation": operation,
            "code": error.code, "message": str(error), "provider_http_status": error.http_status,
            "failed_at": datetime.now(timezone.utc).isoformat(),
            "inference_latency_ms": round((time.monotonic()-started)*1000),
            "live_request": self.transport is None}

    def record_validated(self, metadata):
        if metadata:
            self.validated_inferences[(metadata["provider"], metadata["model"])] = dict(metadata)

    async def post(self, *, provider: str, model: str, operation: str, url: str, key: str, payload: dict, include_metadata=False):
        if not key:
            name = "MODEL_API_KEY" if provider == "meta" else "BASETEN_API_KEY"
            raise ProviderError(f"{name} is not configured on the backend. Manual mode remains available.", 503, "missing_credentials")
        event = {"event": "ai_usage", "request_id": uuid.uuid4().hex, "provider": provider,
                 "model": model, "operation": operation}
        start = time.monotonic()
        event["outcome"] = "failed"
        try:
            # Separate connect/read limits plus a total wall-clock deadline; no automatic billable retries.
            async with asyncio.timeout(self.settings.timeout):
                async with httpx.AsyncClient(transport=self.transport, timeout=httpx.Timeout(self.settings.timeout, connect=min(10, self.settings.timeout)), follow_redirects=False, trust_env=False) as client:
                    async with client.stream("POST", url, headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"}, json=payload) as response:
                        event["http_status"] = response.status_code
                        raw = bytearray()
                        async for chunk in response.aiter_bytes():
                            raw.extend(chunk)
                            if len(raw) > 8_000_000:
                                raise ProviderError("Provider response exceeded the supported size.", code="malformed_response", http_status=response.status_code)
                        # Classify by stable HTTP status and the documented error code;
                        # never return or log raw upstream messages (they can echo secrets).
                        if response.status_code >= 400 or response.is_redirect:
                            raise provider_failure(response.status_code, raw)
                        data = json.loads(raw)
                        if not isinstance(data, dict):
                            raise ProviderError("Provider returned an invalid response envelope.", code="malformed_response", http_status=response.status_code)
                        usage = data.get("usage", {})
                        if isinstance(usage, dict):
                            for name in ("prompt_tokens", "completion_tokens", "total_tokens", "input_tokens", "output_tokens"):
                                value = usage.get(name)
                                if type(value) is int and value >= 0:
                                    event[name] = value
                        event["outcome"] = "http_success"  # Output validation happens separately.
                        metadata = {"provider": provider, "model": model, "operation": operation,
                            "inference_latency_ms": round((time.monotonic()-start)*1000), "inferred_at": datetime.now(timezone.utc).isoformat(),
                            "usage": {name:event[name] for name in ("prompt_tokens", "completion_tokens", "total_tokens", "input_tokens", "output_tokens") if name in event},
                            "live_request": self.transport is None}
                        return {**data, "_worldos_metadata": metadata} if include_metadata else data
        except (TimeoutError, httpx.TimeoutException):
            event["outcome"] = "timeout"
            error = ProviderError("AI request timed out. Manual mode remains available.", 504, "timeout")
            self.record_failure(provider, model, operation, error, start)
            raise error from None
        except httpx.RequestError:
            error = ProviderError("Cannot reach the AI provider. Check server network access.", code="network_error")
            self.record_failure(provider, model, operation, error, start)
            raise error from None
        except (ValueError, UnicodeDecodeError):
            error = ProviderError("Provider returned invalid JSON.", code="malformed_response")
            self.record_failure(provider, model, operation, error, start)
            raise error from None
        except ProviderError as error:
            self.record_failure(provider, model, operation, error, start)
            raise
        finally:
            event["duration_ms"] = round((time.monotonic() - start) * 1000)
            logger.info(json.dumps(event))


def provider_failure(status: int, raw: bytes) -> ProviderError:
    code = None
    try:
        data = json.loads(raw)
        if isinstance(data, dict) and isinstance(data.get("error"), dict):
            code = data["error"].get("code")
    except (ValueError, UnicodeDecodeError):
        pass
    if status == 401:
        return ProviderError("Provider rejected the API credential. Check for an invalid, revoked, or incorrectly copied key.", 502, "invalid_credentials", status)
    if status == 402 or (status == 429 and code in {"insufficient_quota", "insufficient_credits", "billing_hard_limit_reached"}):
        return ProviderError("Provider reports insufficient credits or an unconfigured billing account. Check credits and payment settings.", 502, "insufficient_credits", status)
    if status == 403 or (status == 404 and code == "model_not_found"):
        return ProviderError("The requested model is unavailable to this credential. Check the model ID, team permissions, and model access.", 502, "unsupported_model_access", status)
    if status in {408, 504}:
        return ProviderError("Provider request timed out. Try again later.", 504, "timeout", status)
    if status == 429:
        return ProviderError("Provider rate limit reached. Wait before retrying; no automatic retry was sent.", 429, "rate_limited", status)
    return ProviderError("Provider rejected the request or is unavailable. Check the documented model access and contract.", 502, "provider_error", status)


class BasetenDeployment:
    """Verified general transport only. Model payloads are deployment-specific.

    This is intentionally not wired as a SAM implementation until its actual
    deployment request/response contract is supplied. No guessed model slug.
    """
    def __init__(self, http: ProviderHTTP):
        self.http = http

    async def predict(self, verified_payload: dict):
        model_id = self.http.settings.baseten_sam_model_id
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", model_id):
            raise ProviderError("Set BASETEN_SAM_MODEL_ID to your dedicated deployment ID.", 503)
        return await self.http.post(provider="baseten", model="dedicated_deployment", operation="predict",
                                    url=f"https://model-{model_id}.api.baseten.co/environments/production/predict",
                                    key=self.http.settings.baseten_key, payload=verified_payload)


def capabilities(settings: AISettings):
    settings.validate()
    provider, model, _, key = settings.reasoning_config()
    return {"live_tested": False, "sam": {
        "provider": settings.sam_provider, "model": "sam-3.1" if settings.sam_provider == "meta" else None,
        "status": "configured_not_live_verified" if settings.sam_provider == "meta" and settings.meta_key else "missing_credentials" if settings.sam_provider == "meta" else "blocked_deployment_contract",
        "message": "Meta SAM requires MODEL_API_KEY; one concept per request." if settings.sam_provider == "meta" else "Baseten SAM requires your deployment ID and its verified request/response contract. No SAM payload is guessed."},
        "muse": {"provider": provider, "model": model,
                 "status": "configured_not_live_verified" if key else "missing_credentials",
                 "message": "Baseten Muse Spark Open is preferred when configured; Meta reasoning remains available as fallback. SAM uses its separate provider configuration."}}
