"""Synthetic regression fixtures only; none are physical evaluation evidence."""
import argparse
import asyncio
import json

import httpx
import pytest
from PIL import Image

from backend.ai_service import AIService
from backend.inference_cache import InferenceCache
from backend.main import configured_ai_service, plan_with_constraints
from backend.models import AIAnalysisRequest, Box, PlanRequest
from backend.movement_evaluation import score_case, summarize
from backend.providers import AISettings, ProviderError, ProviderHTTP
from backend.visual_verification import match_identities
from backend.tests.test_ai import chat, constraints, photo, reasoning_request, sam_response
from backend.tests.test_visual_verification import obj, scene, visual
from backend.tests.test_worldos import assert_safe
from scripts.evaluate_movements import evaluate, load_cases, template


def test_identical_concurrent_inference_is_shared_and_later_cached():
    calls = []
    async def handler(request):
        calls.append(request)
        await asyncio.sleep(.01)
        return httpx.Response(200, json=sam_response())
    service = AIService(ProviderHTTP(AISettings(meta_key="fixture", sam_provider="meta"), httpx.MockTransport(handler)))
    request = AIAnalysisRequest(image_url=photo(), concepts=["book"])
    async def run():
        first, second = await asyncio.gather(service.analyze(request), service.analyze(request))
        assert {first["inference_cache"]["status"], second["inference_cache"]["status"]} == {"miss", "shared"}
        first["objects"].clear()
        cached = await service.analyze(request)
        assert len(cached["objects"]) == 1
        assert cached["inference_cache"]["status"] == "hit"
        assert cached["inferred_at"] == second["inferred_at"]
        await service.analyze(request.model_copy(update={"concepts": ["cup"]}))
    asyncio.run(run())
    assert len(calls) == 2


def test_failed_and_malformed_inference_is_never_cached():
    calls = []
    def handler(request):
        calls.append(request)
        return httpx.Response(200, json={"status": "completed", "output": ["malformed"]} if len(calls) == 1 else sam_response())
    service = AIService(ProviderHTTP(AISettings(meta_key="fixture", sam_provider="meta"), httpx.MockTransport(handler)))
    async def run():
        request = AIAnalysisRequest(image_url=photo(), concepts=["book"])
        with pytest.raises(ProviderError):
            await service.analyze(request)
        assert (await service.analyze(request))["inference_cache"]["status"] == "miss"
    asyncio.run(run())
    assert len(calls) == 2


def test_cache_expiration_capacity_and_changed_image_or_goal():
    now = [0]
    cache = InferenceCache(ttl=2, capacity=1, clock=lambda: now[0])
    calls = []
    async def operation():
        calls.append(1)
        return {"objects": []}
    async def run():
        await cache.get({"image": "a", "goal": "a"}, operation)
        assert (await cache.get({"goal": "a", "image": "a"}, operation))["inference_cache"]["status"] == "hit"
        now[0] = 2
        assert (await cache.get({"image": "a", "goal": "a"}, operation))["inference_cache"]["status"] == "miss"
        await cache.get({"image": "b", "goal": "a"}, operation)
        await cache.get({"image": "b", "goal": "b"}, operation)
        assert len(cache.results) == 1
    asyncio.run(run())
    assert len(calls) == 4


def test_cancelled_caller_does_not_cancel_another_waiter():
    async def run():
        cache, entered, release = InferenceCache(), asyncio.Event(), asyncio.Event()
        async def operation():
            entered.set()
            await release.wait()
            return {"valid": True}
        first = asyncio.create_task(cache.get("same", operation))
        await entered.wait()
        second = asyncio.create_task(cache.get("same", operation))
        await asyncio.sleep(0)
        first.cancel()
        await asyncio.gather(first, return_exceptions=True)
        release.set()
        assert (await second)["valid"]
        assert not cache.pending
    asyncio.run(run())


def test_last_cancelled_waiter_cleans_up_work_and_busy_limit():
    async def run():
        cache, entered, cancelled = InferenceCache(max_pending=1), asyncio.Event(), asyncio.Event()
        async def operation():
            entered.set()
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.set()
        task = asyncio.create_task(cache.get("a", operation))
        await entered.wait()
        with pytest.raises(ProviderError, match="busy"):
            await cache.get("b", operation)
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        assert cancelled.is_set() and not cache.pending and not cache.results
    asyncio.run(run())


def test_cache_is_scoped_to_credentials_and_backend_configuration():
    a = AISettings(meta_key="fixture-a", sam_provider="meta")
    b = AISettings(meta_key="fixture-b", sam_provider="meta")
    assert configured_ai_service(a) is configured_ai_service(a)
    assert configured_ai_service(a).cache is not configured_ai_service(b).cache
    assert "fixture-a" not in repr(a)
    configured_ai_service.cache_clear()


def test_muse_cache_includes_the_full_goal_scene_and_image_context():
    calls = []
    async def handler(request):
        calls.append(request)
        await asyncio.sleep(.01)
        return httpx.Response(200, json=chat(constraints()))
    service = AIService(ProviderHTTP(AISettings(meta_key="fixture", sam_provider="meta"), httpx.MockTransport(handler)))
    request = reasoning_request()
    async def run():
        results = await asyncio.gather(service.reason(request), service.reason(request))
        assert {r["inference_cache"]["status"] for r in results} == {"miss", "shared"}
        assert (await service.reason(request))["inference_cache"]["status"] == "hit"
        await service.reason(request.model_copy(update={"goal": "Keep coffee fixed and clear the target"}))
        await service.reason(request.model_copy(update={"image_url": None}))
        await service.reason(request.model_copy(update={"target": Box(x=.2, y=.2, width=.4, height=.4)}))
    asyncio.run(run())
    assert len(calls) == 4


def test_geometry_ranks_duplicate_candidates_without_accepting_identity():
    original = obj("book", .1, .1)
    wrong = original.model_copy(update={"id": "near", "box": Box(x=.1, y=.1, width=.3, height=.1)})
    right = original.model_copy(update={"id": "shape", "box": Box(x=.4, y=.1, width=.1, height=.1)})
    row = match_identities([original], [original], [wrong, right])[0]
    assert row["detection_id"] == "shape"
    assert row["certainty"] == "uncertain" and row["evidence_score"] is not None
    assert len(row["candidate_evidence"]) == 2


def test_appearance_ranks_duplicate_candidates_conservatively():
    original = obj("cup", .1, .1)
    before, after = Image.new("RGB", (100, 100), "red"), Image.new("RGB", (100, 100), "blue")
    after.paste("red", (60, 10, 70, 20))
    near, red = original.model_copy(update={"id": "blue"}), obj("red", .6, .1, label="cup")
    row = match_identities([original], [original], [near, red], before, after)[0]
    assert row["detection_id"] == "red" and row["certainty"] == "uncertain"
    assert row["appearance_similarity"] == 1


def test_related_labels_and_many_to_one_matches_always_require_review():
    originals = [obj("cup1", .1, .1, label="coffee cup"), obj("cup2", .6, .1, label="cup")]
    rows = match_identities(originals, originals, [obj("d", .1, .1, label="cup")])
    assert all(r["certainty"] == "uncertain" for r in rows)
    assert all(any("multiple identities" in reason for reason in r["reasons"]) for r in rows)


def test_stationary_anchor_context_is_exposed_and_large_disagreement_reviewed():
    originals = [obj("book", .1, .1), obj("anchor", .8, .1, locked=True)]
    changed = [obj("det-book", .1, .8, label="book"), obj("det-anchor", .8, .1, label="anchor")]
    row = match_identities(originals, originals, changed)[0]
    assert row["candidate_evidence"][0]["spatial_context_error"] == .7
    assert row["certainty"] == "uncertain"
    assert any("stationary-anchor" in reason for reason in row["reasons"])


def compact_scene(helper_locked=False):
    return PlanRequest.model_validate({"goal": "Clear space", "clearance": .008,
        "workspace": {"x": 0, "y": 0, "width": 1, "height": .4},
        "target": {"x": .4, "y": 0, "width": .3, "height": .4}, "objects": [
            {"id": "blocker", "label": "Book", "box": {"x": .42, "y": .1, "width": .26, "height": .25}},
            {"id": "helper", "label": "Mouse", "locked": helper_locked, "box": {"x": .05, "y": .15, "width": .2, "height": .1}},
            {"id": "fixed", "label": "Keyboard", "locked": True, "box": {"x": .75, "y": 0, "width": .25, "height": .4}}]})


def test_helper_moves_first_when_it_occupies_the_only_viable_destination():
    request = compact_scene()
    plan = plan_with_constraints(request)
    assert_safe(request, plan)
    assert [s.object_id for s in plan.movements] == ["helper", "blocker"]
    assert "later move" in plan.movements[0].instruction


def test_locked_footprint_impossibility_explains_conflict_without_moving_locks():
    request = compact_scene(helper_locked=True)
    plan = plan_with_constraints(request)
    assert plan.status == "impossible" and not plan.movements
    assert "protected footprints" in plan.message and "Book" in plan.message
    assert plan.final_objects[1].box == request.objects[1].box


def test_simple_plan_never_relocates_unnecessary_helpers():
    request = scene()
    plan = plan_with_constraints(request)
    assert_safe(request, plan)
    assert [s.object_id for s in plan.movements] == ["book"]


def test_empty_evaluation_has_no_invented_percentages():
    metrics = summarize([])
    assert metrics["goal"]["correct_over_all"] == {"numerator": 0, "denominator": 0, "value": None}
    assert metrics["object_matching"]["precision_among_decided"]["value"] is None
    assert len(template()["cases"]) == 10 and all(not e["captured"] for e in template()["cases"])


def test_abstentions_and_provider_errors_remain_in_all_opportunity_denominators():
    request, result = scene(), visual()
    plan = plan_with_constraints(request)
    from fastapi.encoders import jsonable_encoder
    result = jsonable_encoder(result)
    truth = {"objects": plan.final_objects, "completed_movements": {"book": True}, "protected_preserved": {"coffee": True}, "goal_achieved": True}
    success = score_case(request, plan, truth, result)
    result["objects"][0]["certainty"] = "uncertain"
    result.update(status="needs_review", passed=False)
    abstain = score_case(request, plan, truth, result)
    error = score_case(request, plan, truth, None)
    metrics = summarize([success, abstain, error])
    assert metrics["movements"]["correct_over_all"]["denominator"] == 3
    assert metrics["movements"]["coverage"]["numerator"] == 1
    assert metrics["goal"]["abstentions"] == 2
    assert metrics["object_matching"]["correct_over_all_identities"]["denominator"] == 6


def test_false_success_denominators_are_actual_negatives_and_positive_decisions():
    base = {"identities": [], "movements": [], "protected": [], "decision": "passed"}
    metrics = summarize([{**base, "goal": {"truth": False, "prediction": True}}, {**base, "goal": {"truth": True, "prediction": True}}])
    assert metrics["goal"]["false_success_over_actual_negatives"] == {"numerator": 1, "denominator": 1, "value": 1}
    assert metrics["goal"]["false_success_over_positive_decisions"]["value"] == .5


def capture_fixture(tmp_path):
    """Synthetic files test validation only; never enter a checked-in real report."""
    entry = {**template()["cases"][0], "captured": True}
    directory = tmp_path / entry["id"]
    directory.mkdir()
    Image.new("RGB", (100, 60), "red").save(directory / "before.jpg")
    Image.new("RGB", (100, 60), "blue").save(directory / "after.jpg")
    request = scene()
    plan = plan_with_constraints(request)
    truth = {"physical_photo_pair": True, "independent_reference": True, "inventory_complete": True,
        "reviewed_by": "Synthetic regression fixture", "captured_at": "2026-10-26", "notes": "Synthetic test only; NOT real evaluation evidence.",
        "objects": [o.model_dump() for o in plan.final_objects], "completed_movements": {"book": True}, "protected_preserved": {"coffee": True}, "goal_achieved": True}
    (directory / "plan.json").write_text(request.model_dump_json())
    (directory / "truth.json").write_text(json.dumps(truth))
    path = tmp_path / "manifest.json"
    path.write_text(json.dumps({**template(), "cases": [entry]}))
    return path, directory, truth


def test_reference_validation_and_repeated_photo_pair_rejection(tmp_path):
    path, directory, truth = capture_fixture(tmp_path)
    assert len(load_cases(path)[1]) == 1
    truth["completed_movements"] = {}
    (directory / "truth.json").write_text(json.dumps(truth))
    with pytest.raises(ValueError, match="Grade every"):
        load_cases(path)
    (directory / "after.jpg").write_bytes((directory / "before.jpg").read_bytes())
    with pytest.raises(ValueError, match="separate after"):
        load_cases(path)


def test_recording_hash_mismatch_rejected_before_scoring(tmp_path):
    path, directory, _ = capture_fixture(tmp_path)
    (directory / "inference.json").write_text(json.dumps({"provenance": "recorded_live_provider_result", "hashes": {}}))
    args = argparse.Namespace(manifest=str(path), recorded=True, live=False, validate=False, output=str(tmp_path / "report.json"), require_complete=False)
    with pytest.raises(ValueError, match="hashes"):
        asyncio.run(evaluate(args))
    assert not (tmp_path / "report.json").exists()


def test_pending_report_is_unmeasured_and_complete_gate_fails(tmp_path):
    path = tmp_path / "manifest.json"
    path.write_text(json.dumps(template()))
    args = argparse.Namespace(manifest=str(path), recorded=True, live=False, validate=False, output=str(tmp_path / "report.json"), require_complete=True)
    assert asyncio.run(evaluate(args)) == 1
    report = json.loads((tmp_path / "report.json").read_text())
    assert report["measurement_status"] == "unmeasured"
    assert report["captured_pairs"] == report["evaluated_pairs"] == 0


def test_timeout_is_not_cached_and_explicit_retry_can_succeed():
    async def run():
        cache = InferenceCache()
        async def timed_out():
            raise TimeoutError()
        async def recovered():
            return {"valid": True}
        with pytest.raises(TimeoutError):
            await cache.get("same", timed_out)
        assert not cache.pending and not cache.results
        assert (await cache.get("same", recovered))["valid"]
    asyncio.run(run())


def test_retry_can_start_while_cancelled_provider_work_is_cleaning_up():
    async def run():
        cache = InferenceCache()
        entered, cleaning, release = asyncio.Event(), asyncio.Event(), asyncio.Event()
        async def cancelled_operation():
            entered.set()
            try:
                await asyncio.Event().wait()
            finally:
                cleaning.set()
                await release.wait()
        async def recovered():
            return {"valid": True}
        first = asyncio.create_task(cache.get("same", cancelled_operation))
        await entered.wait()
        first.cancel()
        await cleaning.wait()
        try:
            assert (await asyncio.wait_for(cache.get("same", recovered), .5))["valid"]
        finally:
            release.set()
            await asyncio.gather(first, return_exceptions=True)
        assert not cache.pending
    asyncio.run(run())


def test_evaluator_keeps_raw_automatic_and_reviewed_results_separate(tmp_path, monkeypatch):
    from backend.tests.test_visual_verification import FakeService, reviewed
    from scripts import evaluate_movements
    path, directory, _ = capture_fixture(tmp_path)
    entry = json.loads(path.read_text())["cases"][0]
    entry["reviewed"] = f"{entry['id']}/reviewed.json"
    path.write_text(json.dumps({**template(), "cases": [entry]}))
    (directory / "reviewed.json").write_text(reviewed().model_dump_json())
    # This transport is deliberately synthetic; no physical result is published.
    monkeypatch.setattr(evaluate_movements, "AIService", lambda _: FakeService(scene().objects))
    args = argparse.Namespace(manifest=str(path), recorded=False, live=True, validate=False, output=str(tmp_path / "report.json"), require_complete=False)
    assert asyncio.run(evaluate(args)) == 0
    report = json.loads((tmp_path / "report.json").read_text())
    assert report["evaluated_pairs"] == report["user_corrected_pairs"] == 1
    # Deliberately different-color test images trigger appearance review.
    assert report["cases"][0]["automated"]["goal"]["prediction"] is None
    assert report["cases"][0]["user_corrected"]["goal"]["prediction"] is True
    args.live, args.recorded = False, True
    assert asyncio.run(evaluate(args)) == 0
    replay = json.loads((tmp_path / "report.json").read_text())
    assert replay["automated_metrics"] == report["automated_metrics"]
    assert replay["user_corrected_metrics"] == report["user_corrected_metrics"]


def test_provider_errors_are_retained_as_abstentions_in_evaluation(tmp_path, monkeypatch):
    from backend.tests.test_visual_verification import FakeService
    from scripts import evaluate_movements
    path, _, _ = capture_fixture(tmp_path)
    monkeypatch.setattr(evaluate_movements, "AIService", lambda _: FakeService(error=ProviderError("Synthetic timeout", 504, "timeout")))
    args = argparse.Namespace(manifest=str(path), recorded=False, live=True, validate=False, output=str(tmp_path / "report.json"), require_complete=False)
    assert asyncio.run(evaluate(args)) == 1
    report = json.loads((tmp_path / "report.json").read_text())
    assert report["automated_metrics"]["goal"]["coverage"] == {"numerator": 0, "denominator": 1, "value": 0}
    assert report["automated_metrics"]["decision_counts"]["provider_error"] == 1


def test_duplicate_pairs_do_not_inflate_scenario_count(tmp_path):
    path, _, _ = capture_fixture(tmp_path)
    manifest = json.loads(path.read_text())
    manifest["cases"].append({**manifest["cases"][0], "id": "another-scenario"})
    path.write_text(json.dumps(manifest))
    with pytest.raises(ValueError, match="Repeated photo pair"):
        load_cases(path)


def test_reference_truth_must_be_complete_and_boolean(tmp_path):
    path, directory, truth = capture_fixture(tmp_path)
    truth["completed_movements"]["book"] = "yes"
    (directory / "truth.json").write_text(json.dumps(truth))
    with pytest.raises(ValueError):
        load_cases(path)
    truth["completed_movements"]["book"] = True
    truth["inventory_complete"] = False
    (directory / "truth.json").write_text(json.dumps(truth))
    with pytest.raises(ValueError, match="complete references"):
        load_cases(path)
