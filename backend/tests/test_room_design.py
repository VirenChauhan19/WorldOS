"""Synthetic provider responses test contracts, not real photo-measurement accuracy."""
import asyncio
import json

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.main import app, get_ai_service
from backend.room_design import DesignRequest, PhotoRequest, Survey, design_room, survey_room
from backend.providers import ProviderError
from backend.tests.test_ai import chat, photo, service


def survey(**overrides):
    return {"status": "ready", "summary": "An open floor with a window on the left.",
        "room": {"width": 4, "depth": 5, "height": None, "width_min": 3.2, "width_max": 4.8, "depth_min": 4, "depth_max": 6},
        "floor_corners": [{"x": .2, "y": .4}, {"x": .8, "y": .4}, {"x": .95, "y": .95}, {"x": .05, "y": .95}],
        "evidence": ["Scale assumes an ordinary door width."], "uncertainty": "Unseen walls may change the area.",
        "confidence": "low", "features": [{"label": "Left window", "kind": "window", "x": 0, "z": .3, "observation": "A window is visible on the left wall."}],
        "zones": [{"id": "door", "label": "Door access", "kind": "access", "x": 3, "z": 4, "width": 1, "depth": 1}],
        "ideas": ["Add a reading chair by the window"], **overrides}


def design(**overrides):
    return {"title": "A quiet reading corner", "summary": "Keep the centre open.",
        "items": [{"id": "sofa", "kind": "sofa", "label": "Compact sofa", "width": 1.8, "depth": .85, "height": .8, "color": "#718b65"}],
        "placements": [{"itemId": "sofa", "x": 0, "z": 1, "rotation": 90, "reason": "Beside the visible window for reading light."}],
        "tradeoffs": ["Furniture dimensions are example sizes."], **overrides}


def design_request(**overrides):
    return DesignRequest.model_validate({"image_url": photo(), "goal": "Add a compact sofa for reading", "room": {"width": 4, "depth": 5},
        "zones": survey()["zones"], "features": survey()["features"], "items": [], "gap": .3, **overrides})


def test_photo_survey_sends_actual_image_and_caches_validated_estimate():
    calls = []
    def handler(req):
        body = json.loads(req.content)
        calls.append(body)
        assert body["messages"][1]["content"][1]["image_url"]["url"].startswith("data:image/jpeg;base64,")
        assert "One photo cannot establish" in body["messages"][0]["content"]
        return httpx.Response(200, json=chat(survey()))
    async def run():
        ai = service(handler)
        first = await survey_room(PhotoRequest(image_url=photo()), ai)
        again = await survey_room(PhotoRequest(image_url=photo()), ai)
        assert first["source"] == "photo_estimate" and first["live_request"] is False
        assert first["room"]["width"] == 4 and first["image_width"] == 100
        assert again["inference_cache"]["status"] == "hit"
    asyncio.run(run())
    assert len(calls) == 1


@pytest.mark.parametrize("changes", [
    {"floor_corners": [{"x": .2, "y": .4}] * 4},
    {"floor_corners": [survey()["floor_corners"][i] for i in [0, 2, 1, 3]]},
    {"zones": [{**survey()["zones"][0], "x": 4}]},
    {"zones": survey()["zones"] * 2},
    {"room": {**survey()["room"], "width_min": 4}},
    {"room": {**survey()["room"], "width": float("nan")}},
    {"confidence": "high"},
])
def test_invalid_survey_geometry_and_exact_scale_claims_fail_closed(changes):
    ai = service(lambda _: httpx.Response(200, json=chat(survey(**changes))))
    with pytest.raises(ProviderError) as error:
        asyncio.run(survey_room(PhotoRequest(image_url=photo()), ai))
    assert error.value.code == "malformed_response"


def test_unreadable_photo_returns_recapture_guidance_without_fake_dimensions():
    value = survey(status="needs_photo", room=None, floor_corners=[], zones=[], features=[],
        summary="Take a wider photo with the floor visible.")
    ai = service(lambda _: httpx.Response(200, json=chat(value)))
    result = asyncio.run(survey_room(PhotoRequest(image_url=photo()), ai))
    assert result["room"] is None and result["floor_corners"] == []
    with pytest.raises(ValidationError):
        Survey.model_validate(survey(status="needs_photo"))


def test_wall_height_anchor_must_match_a_visible_back_floor_corner():
    value = Survey.model_validate(survey(vertical_reference={"corner": 1, "ceiling_y": .1, "height_m": 2.7}))
    assert value.vertical_reference.height_m == 2.7
    with pytest.raises(ValidationError):
        Survey.model_validate(survey(vertical_reference={"corner": 1, "ceiling_y": .5, "height_m": 2.7}))


def test_refinement_forwards_current_positions_and_rejects_unrelated_ids():
    placement = {"itemId": "sofa", "x": 1, "z": 2, "rotation": 270}
    def handler(req):
        context = json.loads(json.loads(req.content)["messages"][1]["content"][0]["text"])
        assert context["placements"] == [placement]
        return httpx.Response(200, json=chat(design()))
    asyncio.run(design_room(design_request(items=design()["items"], placements=[placement]), service(handler)))
    with pytest.raises(ValidationError):
        design_request(placements=[placement])


def test_external_image_is_rejected_before_provider_call():
    calls = []
    ai = service(lambda req: calls.append(req))
    with pytest.raises(ValueError):
        asyncio.run(survey_room(PhotoRequest(image_url="https://example.com/photo.jpg"), ai))
    assert calls == []


def test_design_includes_wishlist_priority_features_and_reserved_area_in_context():
    def handler(req):
        body = json.loads(req.content)
        context = json.loads(body["messages"][1]["content"][0]["text"])
        assert context["goal"] == "Add a compact sofa for reading"
        assert context["style"] == "open"
        assert context["features"][0]["kind"] == "window"
        assert context["zones"][0]["id"] == "door"
        assert body["max_completion_tokens"] == 8192
        return httpx.Response(200, json=chat(design()))
    result = asyncio.run(design_room(design_request(style="open"), service(handler)))
    assert result["items"][0]["kind"] == "sofa"
    assert "window" in result["placements"][0]["reason"]


@pytest.mark.parametrize("changes", [
    {"placements": []}, {"placements": [{**design()["placements"][0], "itemId": "invented"}]},
    {"items": design()["items"] * 2}, {"items": [{**design()["items"][0], "color": "url(bad)"}]},
])
def test_incomplete_designs_never_reach_client(changes):
    ai = service(lambda _: httpx.Response(200, json=chat(design(**changes))))
    with pytest.raises(ProviderError):
        asyncio.run(design_room(design_request(), ai))


def test_routes_return_estimates_and_preserve_error_contract():
    ai = service(lambda _: httpx.Response(200, json=chat(survey())))
    app.dependency_overrides[get_ai_service] = lambda: ai
    try:
        with TestClient(app) as client:
            response = client.post('/api/ai/room/survey', json={"image_url": photo()})
            assert response.status_code == 200 and response.json()["source"] == "photo_estimate"
            invalid = client.post('/api/ai/room/design', json=design_request().model_dump() | {"goal": " "})
            assert invalid.status_code == 422
            malformed = client.post('/api/ai/room/design', json=design_request().model_dump())
            assert malformed.status_code == 502
            assert malformed.headers["X-WorldOS-Error-Code"] == "malformed_response"
    finally:
        app.dependency_overrides.pop(get_ai_service, None)
