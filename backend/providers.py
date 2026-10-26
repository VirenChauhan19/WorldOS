"""Verified provider transports. Do not log request bodies, URLs, or provider errors."""
import asyncio
import json
import logging
import os
import re
import time
import uuid
from dataclasses import dataclass, field

import httpx

logger = logging.getLogger("uvicorn.error.worldos.usage")
META_BASE = "https://api.meta.ai/v1"


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
    timeout: float = 45

    @classmethod
    def from_env(cls):
        return cls(meta_key=os.getenv("MODEL_API_KEY", "").strip(),
                   baseten_key=os.getenv("BASETEN_API_KEY", "").strip(),
                   sam_provider=os.getenv("WORLDOS_SAM_PROVIDER", "baseten"),
                   baseten_sam_model_id=os.getenv("BASETEN_SAM_MODEL_ID", ""),
                   muse_model=os.getenv("WORLDOS_MUSE_MODEL", "muse-spark-1.3"),
                   timeout=float(os.getenv("WORLDOS_AI_TIMEOUT_SECONDS", "45")))

    def validate(self):
        if self.sam_provider not in {"meta", "baseten"}:
            raise ProviderError("WORLDOS_SAM_PROVIDER must be meta or baseten.", 503)
        if self.muse_model not in {"muse-spark-1.1", "muse-spark-1.2", "muse-spark-1.3"}:
            raise ProviderError("WORLDOS_MUSE_MODEL must name a documented standard Muse Spark model.", 503)
        if not 1 <= self.timeout <= 90:
            raise ProviderError("WORLDOS_AI_TIMEOUT_SECONDS must be between 1 and 90.", 503)


class ProviderHTTP:
    def __init__(self, settings: AISettings, transport: httpx.AsyncBaseTransport | None = None):
        settings.validate()
        self.settings = settings
        self.transport = transport

    async def post(self, *, provider: str, model: str, operation: str, url: str, key: str, payload: dict):
        if not key:
            name = "MODEL_API_KEY" if provider == "meta" else "BASETEN_API_KEY"
            raise ProviderError(f"{name} is not configured on the backend. Manual mode remains available.", 503, "missing_credentials")
        event = {"event": "ai_usage", "request_id": uuid.uuid4().hex, "provider": provider,
                 "model": model if provider == "meta" else "dedicated_deployment", "operation": operation}
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
                        return data
        except (TimeoutError, httpx.TimeoutException):
            event["outcome"] = "timeout"
            raise ProviderError("AI request timed out. Manual mode remains available.", 504, "timeout") from None
        except httpx.RequestError:
            raise ProviderError("Cannot reach the AI provider. Check server network access.", code="network_error") from None
        except (ValueError, UnicodeDecodeError):
            raise ProviderError("Provider returned invalid JSON.", code="malformed_response") from None
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
    if status == 402:
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
    return {"live_tested": False, "sam": {
        "provider": settings.sam_provider, "model": "sam-3.1" if settings.sam_provider == "meta" else None,
        "status": "configured_not_live_verified" if settings.sam_provider == "meta" and settings.meta_key else "missing_credentials" if settings.sam_provider == "meta" else "blocked_deployment_contract",
        "message": "Meta SAM requires MODEL_API_KEY; one concept per request." if settings.sam_provider == "meta" else "Baseten SAM requires your deployment ID and its verified request/response contract. No SAM payload is guessed."},
        "muse": {"provider": "meta", "model": settings.muse_model,
                 "status": "configured_not_live_verified" if settings.meta_key else "missing_credentials",
                 "message": "Set MODEL_API_KEY with Muse Spark model access and credits."}}
