import io
import random

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from pydantic import ValidationError

from backend import planner
from backend.adapters import RuleBasedReasoning
from backend.main import app
from backend.models import Box, PlanRequest, SceneObject, VerifyRequest
from backend.planner import contains, generate_plan, overlaps, verify_positions

client = TestClient(app)


def obj(key="book", x=.4, y=.4, width=.15, height=.2, locked=False):
    return SceneObject(id=key, label=key.title(), box=Box(x=x, y=y, width=width, height=height), locked=locked)


def scene(**kwargs):
    return PlanRequest(**{"objects": [obj(), obj("coffee", .8, .1, .1, .1, True)],
                          "target": Box(x=.3, y=.3, width=.4, height=.4),
                          "goal": "Make room without moving coffee", **kwargs})


def assert_safe(request, result):
    assert result.status in {"ready", "already_clear"}
    current = {o.id: o.box for o in request.objects}
    for move in result.movements:
        assert move.object_id not in result.locked_ids
        assert move.source == current[move.object_id]
        assert contains(request.workspace, move.destination)
        assert not overlaps(move.destination, request.target, request.clearance)
        assert all(not overlaps(move.destination, box, request.clearance) for key, box in current.items() if key != move.object_id)
        current[move.object_id] = move.destination
    for item in result.final_objects:
        assert item.box == current[item.id]
        assert not overlaps(item.box, request.target, request.clearance)
        if item.id in result.locked_ids:
            assert item.box == next(o.box for o in request.objects if o.id == item.id)


def test_plan_is_deterministic_and_sequentially_collision_free():
    req = scene()
    a, b = generate_plan(req), generate_plan(req)
    assert a == b
    assert len(a.movements) == 1
    assert_safe(req, a)


def test_clear_target_needs_no_movements():
    req = scene(target=Box(x=0, y=.7, width=.3, height=.3))
    result = generate_plan(req)
    assert result.status == "already_clear"
    assert result.movements == []


def test_locked_target_conflict_is_impossible():
    result = generate_plan(scene(objects=[obj(locked=True)]))
    assert result.status == "impossible"
    assert "protected" in result.message
    assert result.movements == []


@pytest.mark.parametrize("goal", ["without moving my book", "do not move the book", "don't move book", "keep book here", "leave book alone", "avoid moving book"])
def test_goal_protection(goal):
    req = scene(goal=goal)
    assert generate_plan(req).status == "impossible"


def test_goal_matching_uses_word_boundaries_and_all_labels():
    things = [obj("cup"), obj("cupboard", .1, .1, .1, .1), obj("coffee", .8, .8, .1, .1)]
    locks = RuleBasedReasoning().locked_ids("Do not move cupboard and coffee.", things)
    assert locks == {"cupboard", "coffee"}


def test_area_impossibility():
    req = scene(objects=[obj(width=.5, height=.5, x=0, y=0), obj("other", x=.5, y=.5, width=.5, height=.5)], target=Box(x=.1, y=.1, width=.8, height=.8))
    assert generate_plan(req).status == "impossible"


def test_geometrically_impossible_target():
    req = scene(objects=[obj(x=.4, y=.4, width=.2, height=.2)], target=Box(x=.1, y=.1, width=.8, height=.8))
    result = generate_plan(req)
    assert result.status == "impossible"
    assert "without rotating" in result.message


def test_target_inside_restricted_workspace():
    req = scene(workspace=Box(x=.2, y=.2, width=.6, height=.6), objects=[obj()], target=Box(x=.4, y=.3, width=.3, height=.4))
    assert_safe(req, generate_plan(req))


def test_outside_workspace_and_overlapping_inputs_rejected():
    with pytest.raises(ValueError, match="inside the workspace"):
        generate_plan(scene(workspace=Box(x=.1, y=.1, width=.5, height=.5)))
    with pytest.raises(ValueError, match="overlap"):
        generate_plan(scene(objects=[obj(), obj("other", .45, .45)]))


def test_search_exhaustion_is_not_claimed_impossible(monkeypatch):
    monkeypatch.setattr(planner, "MAX_STATES", 0)
    result = generate_plan(scene())
    assert result.status == "search_limit"
    assert result.explored_states == 0
    assert "not proof" in result.message


def test_multi_object_plan_and_randomized_safety():
    rng = random.Random(2026)
    for _ in range(15):
        objects = [obj(str(i), x=.08 + (i % 3) * .3, y=.1 + (i // 3) * .4, width=rng.uniform(.08, .16), height=rng.uniform(.08, .16), locked=i == 5) for i in range(6)]
        req = scene(objects=objects, goal="Clear target", target=Box(x=.05, y=.05, width=.55, height=.45))
        result = generate_plan(req)
        assert_safe(req, result)


def test_verification_passes_expected_positions():
    req = scene()
    plan = generate_plan(req)
    result = verify_positions(VerifyRequest(plan_request=req, observed_objects=plan.final_objects), plan)
    assert result["passed"]
    assert result["matched_count"] == 2


def test_verification_rejects_unchanged_positions_and_target_intrusion():
    req = scene()
    result = verify_positions(VerifyRequest(plan_request=req, observed_objects=req.objects), generate_plan(req))
    assert not result["passed"]
    assert any("target" in issue for issue in result["issues"])


def test_verification_locks_have_tighter_tolerance():
    req = scene()
    plan = generate_plan(req)
    observed = [o.model_copy(deep=True) for o in plan.final_objects]
    observed[1].box.x += .015
    result = verify_positions(VerifyRequest(plan_request=req, observed_objects=observed), plan)
    assert not result["passed"]
    assert result["objects"][1]["tolerance"] == .01


def test_verification_detects_size_change():
    req = scene()
    plan = generate_plan(req)
    observed = [o.model_copy(deep=True) for o in plan.final_objects]
    observed[0].box.width += .1
    assert not verify_positions(VerifyRequest(plan_request=req, observed_objects=observed), plan)["passed"]


def test_verification_requires_exact_ids():
    req = scene()
    with pytest.raises(ValueError, match="exactly"):
        verify_positions(VerifyRequest(plan_request=req, observed_objects=[obj("different")]), generate_plan(req))


@pytest.mark.parametrize("box", [dict(x=-.1, y=0, width=.1, height=.1), dict(x=.9, y=0, width=.2, height=.1), dict(x=0, y=0, width=0, height=.1), dict(x=float('nan'), y=0, width=.1, height=.1)])
def test_invalid_normalized_boxes(box):
    with pytest.raises(ValidationError):
        Box(**box)


def test_duplicate_ids_rejected():
    with pytest.raises(ValidationError, match="unique"):
        scene(objects=[obj(), obj()])


def test_api_health_and_end_to_end_plan_verify():
    assert client.get("/api/health").json()["vision"] == "manual"
    req = scene().model_dump()
    response = client.post("/api/plan", json=req)
    assert response.status_code == 200
    result = client.post("/api/verify", json={"plan_request": req, "observed_objects": response.json()["final_objects"]})
    assert result.status_code == 200
    assert result.json()["passed"]


def test_api_rejects_bad_scene_and_infeasible_verification():
    req = scene(objects=[obj(), obj("other", .45, .45)]).model_dump()
    assert client.post("/api/plan", json=req).status_code == 422
    req = scene(objects=[obj(locked=True)]).model_dump()
    assert client.post("/api/verify", json={"plan_request": req, "observed_objects": req["objects"]}).status_code == 422


def image_bytes(format="PNG", size=(100, 60), exif=None):
    output = io.BytesIO()
    image = Image.new("RGB", size, (100, 120, 90))
    image.save(output, format=format, **({"exif": exif} if exif else {}))
    return output.getvalue()


def test_analyze_returns_real_dimensions_no_fake_detections():
    response = client.post("/api/analyze", files={"image": ("desk.png", image_bytes(), "image/png")})
    assert response.status_code == 200
    data = response.json()
    assert (data["width"], data["height"]) == (100, 60)
    assert data["objects"] == []
    assert data["annotation_source"] == "manual"
    assert data["image_url"].startswith("data:image/jpeg;base64,")


def test_analyze_honors_exif_orientation():
    exif = Image.Exif()
    exif[274] = 6
    result = client.post("/api/analyze", files={"image": ("portrait.jpg", image_bytes("JPEG", exif=exif), "image/jpeg")}).json()
    assert (result["width"], result["height"]) == (60, 100)


def test_analyze_downsamples_large_images():
    result = client.post("/api/analyze", files={"image": ("large.png", image_bytes(size=(2400, 1200)), "image/png")}).json()
    assert (result["width"], result["height"]) == (1800, 900)
    assert result["original_width"] == 2400


def test_analyze_rejects_invalid_unsupported_and_oversized(monkeypatch):
    assert client.post("/api/analyze", files={"image": ("bad.png", b"not an image", "image/png")}).status_code == 415
    assert client.post("/api/analyze", files={"image": ("bad.gif", image_bytes("GIF"), "image/gif")}).status_code == 415
    monkeypatch.setattr("backend.main.MAX_BYTES", 10)
    assert client.post("/api/analyze", files={"image": ("large.png", image_bytes(), "image/png")}).status_code == 413


def test_unconfigured_adapters_do_not_call_invented_apis(monkeypatch):
    monkeypatch.delenv("MODEL_API_KEY", raising=False)
    monkeypatch.setenv("WORLDOS_SAM_PROVIDER", "baseten")
    response = client.post("/api/ai/analyze", json={"image_url": "not-a-photo", "concepts": ["book"]})
    assert response.status_code == 503
    assert "contract" in response.json()["detail"]
