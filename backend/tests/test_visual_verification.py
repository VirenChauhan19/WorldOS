import asyncio
import base64
import io
import json

import httpx
import pytest
from fastapi.testclient import TestClient
from PIL import Image
from pydantic import ValidationError

from backend.evaluation import evaluate_detections
from backend.ai_service import AIService
from backend.main import app, get_ai_service, plan_with_constraints
from backend.models import Box, PlanningConstraints, PlanRequest, SceneObject
from backend.providers import AISettings, ProviderError, ProviderHTTP
from backend.visual_verification import (ReviewedStateRequest, VisualVerifyRequest, adaptive_replan,
    automatic_verify, match_identities, verify_reviewed)


def obj(id, x, y, label=None, confidence=.95, locked=False):
    return SceneObject(id=id, label=label or id, box=Box(x=x, y=y, width=.1, height=.1),
                       confidence=confidence, source="sam_3_1", locked=locked)


def scene():
    return PlanRequest(objects=[obj("book", .4, .4), obj("coffee", .8, .1, locked=True)],
                       target=Box(x=.3, y=.3, width=.4, height=.4), goal="Make space without moving coffee")


def photo(size=(100, 60)):
    stream = io.BytesIO()
    Image.new("RGB", size, "gray").save(stream, "PNG")
    return "data:image/png;base64," + base64.b64encode(stream.getvalue()).decode()


class FakeService:
    def __init__(self, detections=None, error=None):
        self.detections = detections if detections is not None else plan_with_constraints(scene()).final_objects
        self.calls = []
        self.error = error

    async def analyze(self, request):
        self.calls.append(request)
        if self.error:
            raise self.error
        return {"objects": self.detections, "warnings": []}


def visual(service=None, **kwargs):
    request = VisualVerifyRequest(plan_request=scene(), image_url=photo(), framing_confirmed=True, inventory_confirmed=True, **kwargs)
    return asyncio.run(automatic_verify(request, service or FakeService(), plan_with_constraints))


def reviewed(objects=None, **kwargs):
    original = scene()
    observed = objects if objects is not None else plan_with_constraints(original).final_objects
    return ReviewedStateRequest.model_validate({"original_request": original.model_dump(), "plan_request": original.model_dump(),
        "observed_objects": [o.model_dump() for o in observed], "reviewed_ids": [o.id for o in observed],
        "framing_confirmed": True, "inventory_confirmed": True, **kwargs})


def test_unique_labels_preserve_identity_despite_provider_id_changes():
    detections = [o.model_copy(update={"id": f"detection-{i}"}) for i, o in enumerate(plan_with_constraints(scene()).final_objects)]
    service = FakeService(detections)
    result = visual(service)
    assert result["passed"] and result["goal_achieved"]
    assert result["status"] == "passed"
    assert result["steps"][0]["status"] == "completed"
    assert {o.id for o in result["observed_objects"]} == {"book", "coffee"}
    assert service.calls[0].concepts == ["book", "coffee"]
    assert len(service.calls) == 1


def test_unchanged_scene_is_failed_with_incomplete_step():
    result = visual(FakeService(scene().objects))
    assert not result["passed"]
    assert result["status"] == "failed"
    assert result["steps"][0]["status"] == "incomplete"
    assert any("target" in issue for issue in result["issues"])


def test_protected_movement_is_reported_and_blocks_replanning():
    observed = [o.model_copy(update={"box": Box(x=.7, y=.1, width=.1, height=.1)}) if o.id == "coffee" else o for o in plan_with_constraints(scene()).final_objects]
    result = visual(FakeService(observed))
    assert not result["passed"]
    assert result["unexpected_movements"] == ["coffee"]
    revision = adaptive_replan(reviewed(observed), plan_with_constraints)
    assert revision["status"] == "blocked"
    assert revision["revised_plan"] is None


@pytest.mark.parametrize("confidence", [None, .2, .749])
def test_low_or_missing_confidence_requires_review(confidence):
    observed = [o.model_copy(update={"confidence": confidence}) for o in plan_with_constraints(scene()).final_objects]
    result = visual(FakeService(observed))
    assert not result["passed"] and result["review_required"]
    assert result["confidence"] == "uncertain"


def test_missing_detection_never_implies_goal_success():
    result = visual(FakeService([plan_with_constraints(scene()).final_objects[1]]))
    assert result["status"] == "needs_review"
    assert result["objects"][0]["status"] == "missing"
    assert result["steps"][0]["status"] == "missing"


def test_empty_detection_set_is_not_verified():
    result = visual(FakeService([]))
    assert not result["passed"]
    assert len(result["uncertain_ids"]) == 2


def test_duplicate_labels_are_uncertain_even_at_perfect_positions():
    originals = [obj("a", .1, .1, label="cup"), obj("b", .6, .6, label="cup")]
    rows = match_identities(originals, originals, originals)
    assert all(r["certainty"] == "uncertain" for r in rows)


def test_multiple_same_label_detections_require_identity_assignment():
    original = [obj("a", .1, .1, label="cup")]
    rows = match_identities(original, original, [*original, obj("b", .7, .7, label="cup")])
    assert rows[0]["certainty"] == "uncertain"


def test_changed_size_requires_review():
    objects = plan_with_constraints(scene()).final_objects
    changed = objects[0].model_copy(update={"box": Box(x=0, y=0, width=.3, height=.1)})
    assert visual(FakeService([changed, objects[1]]))["review_required"]


def test_camera_and_inventory_acknowledgment_required():
    request = VisualVerifyRequest(plan_request=scene(), image_url=photo())
    result = asyncio.run(automatic_verify(request, FakeService(), plan_with_constraints))
    assert not result["passed"] and result["review_required"]


def test_image_validation_happens_before_inference():
    service = FakeService()
    with pytest.raises(ValueError):
        visual(service, before_image_url="https://untrusted.invalid/photo.jpg")
    assert not service.calls


def test_aspect_ratio_rejected_before_inference():
    service = FakeService()
    with pytest.raises(ValueError, match="aspect"):
        visual(service, before_image_url=photo((60, 100)))
    assert not service.calls


def test_studio_reused_before_photo_never_starts_inference():
    service = FakeService()
    with pytest.raises(ValueError, match="fresh photograph"):
        visual(service, before_image_url=photo())
    assert not service.calls


def test_visual_color_mismatch_requires_review():
    # Pixel evidence is only a conservative corroborating heuristic.
    before = Image.new("RGB", (100, 60), "red")
    after = Image.new("RGB", (100, 60), "blue")
    originals = scene().objects
    rows = match_identities(originals, originals, originals, before, after)
    assert all(r["certainty"] == "uncertain" for r in rows)
    assert all(r["appearance_similarity"] < .45 for r in rows)


def test_new_obstacles_require_review_even_outside_target():
    objects = [*plan_with_constraints(scene()).final_objects, obj("phone", .1, .8)]
    result = visual(FakeService(objects))
    assert not result["passed"] and result["review_required"]
    assert result["additional_detection_ids"] == ["extra:phone"]


def test_unexpected_movement_of_unplanned_object_is_reported():
    request = scene().model_copy(update={"objects": [*scene().objects, obj("pen", .1, .8)]})
    observed = [o.model_copy(update={"box": Box(x=.2, y=.8, width=.1, height=.1)}) if o.id == "pen" else o for o in plan_with_constraints(request).final_objects]
    result = asyncio.run(automatic_verify(VisualVerifyRequest(plan_request=request, image_url=photo(), framing_confirmed=True, inventory_confirmed=True), FakeService(observed), plan_with_constraints))
    assert "pen" in result["unexpected_movements"]


def test_adaptive_replanning_uses_actual_positions_and_preserves_goal_and_locks():
    request = reviewed(scene().objects)
    result = adaptive_replan(request, plan_with_constraints)
    assert result["status"] == "ready"
    assert result["plan_request"].goal == scene().goal
    assert result["plan_request"].target == scene().target
    assert result["revised_plan"].movements[0].source == scene().objects[0].box
    assert "coffee" in result["revised_plan"].locked_ids
    assert result["reasons"]


def test_replan_retains_muse_protected_constraints():
    original = scene().model_copy(update={"constraints": PlanningConstraints(
        protected_object_ids=["coffee"], summary="Keep coffee", unsupported_requirements=[], needs_clarification=False)})
    req = reviewed(original.objects, original_request=original.model_dump(), plan_request=original.model_dump())
    result = adaptive_replan(req, plan_with_constraints)
    assert result["plan_request"].constraints == original.constraints
    assert "coffee" in result["revised_plan"].locked_ids


def test_impossible_replan_is_honest_and_has_no_moves():
    objects = [*scene().objects, obj("new", .3, .3, locked=True)]
    # New locked obstacle covers the target without overlapping the book.
    objects[-1] = objects[-1].model_copy(update={"box": Box(x=.3, y=.3, width=.08, height=.08)})
    result = adaptive_replan(reviewed(objects), plan_with_constraints)
    assert result["status"] == "impossible"
    assert result["revised_plan"].movements == []


@pytest.mark.parametrize("changes", [{"reviewed_ids": ["book"]}, {"framing_confirmed": False}, {"inventory_confirmed": False}, {"observed_objects": [obj("coffee", .8, .1).model_dump()], "reviewed_ids": ["coffee"]}])
def test_unreviewed_or_missing_state_cannot_replan(changes):
    with pytest.raises(ValidationError):
        reviewed(**changes)


def test_altered_goal_cannot_be_smuggled_into_revision():
    current = scene().model_dump()
    current["goal"] = "Move coffee too"
    with pytest.raises(ValidationError, match="original goal"):
        reviewed(plan_request=current)


def test_protected_anchor_survives_multiple_revisions():
    original = scene()
    first = adaptive_replan(reviewed(original.objects), plan_with_constraints)
    current = first["plan_request"]
    moved = [o.model_copy(update={"box": Box(x=.82, y=.1, width=.1, height=.1)}) if o.id == "coffee" else o for o in current.objects]
    request = reviewed(moved, plan_request=current.model_dump())
    assert adaptive_replan(request, plan_with_constraints)["status"] == "blocked"


def test_reviewed_positions_can_verify_despite_missing_provider_confidence():
    observed = [o.model_copy(update={"confidence": None}) for o in plan_with_constraints(scene()).final_objects]
    result = verify_reviewed(reviewed(observed), plan_with_constraints)
    assert result["passed"] and result["confidence"] == "user_reviewed"


@pytest.mark.parametrize("code,status", [("rate_limited", 429), ("timeout", 504), ("malformed_response", 502), ("invalid_credentials", 502)])
def test_api_failures_never_return_verification_success(code, status):
    service = FakeService(error=ProviderError("Safe provider failure", status, code))
    app.dependency_overrides[get_ai_service] = lambda: service
    try:
        with TestClient(app) as client:
            response = client.post("/api/ai/verify", json={"plan_request": scene().model_dump(), "image_url": photo()})
        assert response.status_code == status
        assert response.json() == {"detail": "Safe provider failure"}
    finally:
        app.dependency_overrides.clear()


def test_reviewed_and_replan_endpoints_use_no_model_inference():
    with TestClient(app) as client:
        assert client.post("/api/verify/reviewed", json=reviewed().model_dump()).json()["passed"]
        assert client.post("/api/replan", json=reviewed(scene().objects).model_dump()).json()["status"] == "ready"


def test_evaluation_metrics_detect_misses_duplicates_and_false_positives():
    refs = [obj("a", .1, .1, label="book"), obj("b", .5, .5, label="mouse")]
    detections = [obj("d1", .1, .1, label="book"), obj("d2", .1, .1, label="book"), obj("d3", .8, .8, label="cup")]
    metrics = evaluate_detections(detections, refs, reference_complete=True)
    assert metrics["true_positives"] == 1
    assert metrics["false_positives"] == 2
    assert metrics["recall"] == .5
    assert metrics["missing_reference_ids"] == ["b"]


def test_incomplete_references_do_not_fabricate_precision_or_false_positives():
    refs = [obj("a", .1, .1)]
    result = evaluate_detections([*refs, obj("extra", .7, .7)], refs)
    assert result["precision"] is None and result["false_positives"] is None
    assert result["unmatched_detection_count"] == 1


def test_outside_workspace_objects_do_not_become_missing_scene_obstacles():
    request = scene().model_copy(update={"workspace": Box(x=.2, y=0, width=.8, height=1)})
    # Narrow target leaves a valid layout within this workspace.
    planned = plan_with_constraints(request)
    service = FakeService([*planned.final_objects, obj("outside", 0, .8)])
    result = asyncio.run(automatic_verify(VisualVerifyRequest(plan_request=request, image_url=photo(), framing_confirmed=True, inventory_confirmed=True), service, plan_with_constraints))
    assert result["passed"]
    assert result["excluded_outside_workspace_ids"] == ["outside"]


def test_new_protected_obstacle_keeps_its_anchor_across_revisions():
    objects = [*scene().objects, obj("added", .1, .8, locked=True)]
    first = adaptive_replan(reviewed(objects), plan_with_constraints)
    current = first["plan_request"]
    moved = [o.model_copy(update={"box": Box(x=.15, y=.8, width=.1, height=.1)}) if o.id == "added" else o for o in current.objects]
    request = reviewed(moved, plan_request=current.model_dump())
    assert adaptive_replan(request, plan_with_constraints)["status"] == "blocked"


def test_duplicate_observation_ids_and_missing_revised_identity_rejected():
    with pytest.raises(ValidationError, match="unique"):
        reviewed([*scene().objects, scene().objects[0]])
    current = scene().model_copy(update={"objects": [*scene().objects, obj("added", .1, .8)]})
    with pytest.raises(ValidationError, match="Missing original"):
        reviewed(scene().objects, plan_request=current.model_dump())


def test_full_visual_endpoint_with_mocked_documented_sam_contract():
    """Exercise real adapter/normalization/matching/API together; no live claim."""
    plan = plan_with_constraints(scene())
    def handler(request):
        payload = json.loads(request.content)
        label = payload["input"][0]["content"][0]["text"]
        box = next(o.box for o in plan.final_objects if o.label == label)
        x, y, w, h = round(box.x*100), round(box.y*60), round(box.width*100), round(box.height*60)
        text = f"<0f>0<|box;x1={x};y1={y};x2={x+w-1};y2={y+h-1};w=100;h=60;c=0.95|><|mask;x=0;y=0;c=0.95;data=12,15,!MOCK_PAYLOAD|>"
        return httpx.Response(200, json={"status": "completed", "output": [{"type": "message", "content": [{"type": "output_text", "text": text}]}]})
    service = AIService(ProviderHTTP(AISettings(meta_key="mock-key", sam_provider="meta"), httpx.MockTransport(handler)))
    app.dependency_overrides[get_ai_service] = lambda: service
    try:
        with TestClient(app) as client:
            response = client.post("/api/ai/verify", json={"plan_request": scene().model_dump(), "image_url": photo(), "framing_confirmed": True, "inventory_confirmed": True})
        assert response.status_code == 200
        result = response.json()
        assert result["passed"] and result["steps"][0]["status"] == "completed"
        assert all(r["provider_confidence"] == .95 for r in result["objects"])
        assert all(o["source"] == "sam_3_1" for o in result["observed_objects"])
    finally:
        app.dependency_overrides.clear()
