"""Opt-in real requests. Never runs or incurs charges in the default test suite."""
import asyncio
import os
from pathlib import Path

import pytest

from backend.ai_service import AIService
from backend.imaging import prepare_image
from backend.models import AIAnalysisRequest, ReasonRequest
from backend.providers import AISettings, ProviderHTTP

pytestmark = pytest.mark.live


def live_setup():
    if os.getenv("WORLDOS_RUN_LIVE_AI") != "1":
        pytest.skip("Set WORLDOS_RUN_LIVE_AI=1 to opt into real billable requests.")
    settings = AISettings.from_env()
    if not settings.meta_key:
        pytest.skip("MODEL_API_KEY is unavailable; live integration is not verified.")
    path = os.getenv("WORLDOS_LIVE_IMAGE_PATH", "")
    if not path:
        pytest.skip("Set WORLDOS_LIVE_IMAGE_PATH to a real photograph you authorize sending to Meta.")
    image = prepare_image(Path(path).read_bytes())
    return AIService(ProviderHTTP(settings)), image


def test_live_sam_concept_segmentation():
    service, image = live_setup()
    if service.http.settings.sam_provider != "meta":
        pytest.skip("Baseten SAM contract is blocked. Set WORLDOS_SAM_PROVIDER=meta for the verified alternative.")
    concept = os.getenv("WORLDOS_LIVE_SAM_CONCEPT", "coffee cup")
    result = asyncio.run(service.analyze(AIAnalysisRequest(image_url=image["image_url"], concepts=[concept])))
    assert result["model"] == "sam-3.1"
    # An empty match set is legitimate, not a reason to fabricate detections.
    assert all(obj.source == "sam_3_1" for obj in result["objects"])


def test_live_muse_multimodal_reasoning():
    service, image = live_setup()
    req = ReasonRequest.model_validate({"goal": "Clear the selected area without moving coffee", "image_url": image["image_url"],
        "target": {"x": .1, "y": .1, "width": .5, "height": .5},
        "objects": [{"id": "coffee", "label": "Coffee", "box": {"x": .8, "y": .1, "width": .1, "height": .1}, "locked": True}]})
    result = asyncio.run(service.reason(req))
    assert "coffee" in result["constraints"].protected_object_ids
    assert result["confidence"] is None
