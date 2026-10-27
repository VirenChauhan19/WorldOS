"""Opt-in live integration check using a real photo and explicitly reviewed SAM results.

Not a physical movement trial: Inspect compares the same unmodified photo, and
planner validation checks geometry only. No physical evaluation rows are created.
"""
import argparse
import asyncio
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys
from time import perf_counter

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.encoders import jsonable_encoder
from backend.ai_service import AIService
from backend.connection import ConnectionRegistry, diagnostics
from backend.imaging import prepare_image
from backend.inspect_models import Alignment, InspectionInput, TemplateInput
from backend.inspect_store import InspectionStore
from backend.inspection import corrective_plan, explain_inspection, scan_workspace
from backend.main import plan_with_constraints
from backend.models import Box, PlanRequest, ReasonRequest, SceneObject, VerifyRequest
from backend.planner import contains, overlaps, verify_positions
from backend.providers import AISettings, ProviderError, ProviderHTTP


class RecordingHTTP(ProviderHTTP):
    """Real transport only; retain safe timing/usage, never request headers/bodies."""
    def __init__(self, settings):
        super().__init__(settings)
        self.events = []

    async def post(self, **kwargs):
        started = perf_counter()
        event = {key: kwargs[key] for key in ("provider", "model", "operation")}
        try:
            result = await super().post(**kwargs)
            event.update(status="http_success", **result.get("_worldos_metadata", {}))
            return result
        except ProviderError as error:
            event.update(status="failed", error_code=error.code, provider_http_status=error.http_status)
            raise
        finally:
            event["wall_ms"] = round((perf_counter()-started)*1000)
            self.events.append(event)


def reviewed_input(image_path, detections_path, review_path):
    raw = Path(image_path).read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    cases = json.loads(Path(detections_path).read_text(encoding="utf-8"))["cases"]
    matching = [row for row in cases if row.get("image_sha256") == digest and row.get("status") == "success"]
    if len(matching) != 1:
        raise ValueError("Require one successful recorded detection case for this exact photograph.")
    review = json.loads(Path(review_path).read_text(encoding="utf-8"))
    if review.get("actor") not in {"agent_visual_review", "human_review"} or not review.get("notes"):
        raise ValueError("Declare who reviewed the photograph and record the scope/limitations.")
    included, protected = review["included_detection_ids"], review["protected_ids"]
    observations = [SceneObject.model_validate(obj) for obj in matching[0]["objects"]]
    ids = {obj.id for obj in observations}
    if len(ids) != len(observations) or len(set(included)) != len(included) or not set(included) <= ids or not set(protected) <= set(included):
        raise ValueError("Review must select distinct actual detections and protect selected identities only.")
    workspace = Box.model_validate(review["workspace"])
    excluded = [obj for obj in observations if obj.id not in included]
    if any(overlaps(obj.box, workspace) for obj in excluded):
        raise ValueError("This check cannot silently exclude a detected obstacle inside the selected workspace.")
    selected = [obj.model_copy(update={"locked": obj.id in protected}) for obj in observations if obj.id in included]
    plan = PlanRequest(objects=selected, target=review["target"], workspace=workspace, goal=review["goal"], clearance=review["clearance"])
    if not all(contains(workspace, obj.box) for obj in selected):
        raise ValueError("Selected detections must fit entirely inside the reviewed workspace.")
    return prepare_image(raw), matching[0], review, plan, excluded


def validate_movements(request, plan):
    """Independently walk every proposed lift/place; this is not photo verification."""
    if plan.status != "ready" or not plan.movements:
        raise ValueError("The selected clearing task did not produce an executable geometric plan.")
    positions = {obj.id: obj.box for obj in request.objects}
    protected = {obj.id for obj in request.objects if obj.locked}
    protected.update(request.constraints.protected_object_ids if request.constraints else [])
    for number, move in enumerate(plan.movements, 1):
        if move.number != number or move.object_id in protected or positions.get(move.object_id) != move.source or not move.instruction.strip():
            raise ValueError("Invalid movement identity, ordering, protection, or instruction.")
        if abs(move.source.width-move.destination.width) > 1e-8 or abs(move.source.height-move.destination.height) > 1e-8:
            raise ValueError("Movement changes the object's footprint.")
        if not contains(request.workspace, move.destination) or overlaps(move.destination, request.target, request.clearance):
            raise ValueError("Movement violates the workspace or target clearance.")
        if any(overlaps(move.destination, box, request.clearance) for identity, box in positions.items() if identity != move.object_id):
            raise ValueError("Movement collides with a current footprint.")
        positions[move.object_id] = move.destination
    if positions != {obj.id: obj.box for obj in plan.final_objects}:
        raise ValueError("Final scene does not agree with the movement sequence.")
    geometry = verify_positions(VerifyRequest(plan_request=request, observed_objects=plan.final_objects), plan)
    unchanged = verify_positions(VerifyRequest(plan_request=request, observed_objects=request.objects), plan)
    if not geometry["passed"] or unchanged["passed"]:
        raise ValueError("Geometric verification or unchanged-annotation negative control failed.")
    return {"passed": True, "scope": "Deterministic geometry only; proposed final boxes are NOT observed physical positions.",
            "movement_count": len(plan.movements), "geometry": geometry,
            "unchanged_annotations_negative_control": unchanged, "physical_verification": "not_performed"}


def without_photos(value):
    if isinstance(value, dict):
        return {key: without_photos(item) for key, item in value.items() if key not in {"image_url", "reference_image_url", "current_image_url"}}
    if isinstance(value, list):
        return [without_photos(item) for item in value]
    return value


async def verify(args):
    image, detection_case, review, request, excluded = reviewed_input(args.image, args.detections, args.review)
    directory = Path(args.output_dir)
    if (directory / "report.json").exists():
        raise ValueError("Use a new output directory to preserve previous attempts.")
    settings = AISettings.from_env()
    settings.validate()
    if settings.sam_provider != "meta" or not settings.meta_key or settings.reasoning_provider != "baseten" or not settings.baseten_key:
        raise ValueError("This check requires configured Meta SAM and preferred Baseten reasoning.")
    http = RecordingHTTP(settings)
    service = AIService(http)
    directory.mkdir(parents=True, exist_ok=True)
    report = {"version": "0.6.0", "recorded_at": datetime.now(timezone.utc).isoformat(),
              "scope": "Real public photograph + actual provider calls. Agent/human review is explicitly attributed. No physical object movement or fresh after-photo.",
              "physical_trials": 0, "physical_accuracy_metrics": None,
              "initial_detection": detection_case, "review": review,
              "excluded_outside_workspace": [obj.model_dump() for obj in excluded], "checks": {}}
    stage = "goal_interpretation"
    try:
        reason = await service.reason(ReasonRequest(objects=request.objects, target=request.target, goal=request.goal, image_url=image["image_url"]))
        report["checks"][stage] = jsonable_encoder(reason)
        if reason["provider"] != "baseten" or not reason.get("live_request") or reason.get("fallback"):
            raise ValueError("Baseten itself must succeed for this check; fallback is retained but does not pass it.")
        request = PlanRequest.model_validate({**request.model_dump(), "constraints": reason["constraints"]})
        stage = "geometric_plan"
        plan = plan_with_constraints(request)
        report["checks"][stage] = {"request": request.model_dump(), "plan": plan.model_dump(), "validation": validate_movements(request, plan)}

        stage = "inspect_live_sam"
        # This is the SAME actual photo, not an invented physical before/after pair.
        template_body = TemplateInput(name="Live SAM integration — unchanged public desk photo", description=review["notes"],
            reference_image_url=image["image_url"], objects=[obj.model_dump() for obj in request.objects],
            workspace=request.workspace, clearance=request.clearance, annotations_reviewed=True)
        store = InspectionStore(directory / "worldos-live.sqlite3")
        template = store.save_template(template_body.model_dump(exclude={"annotations_reviewed", "revision"}))
        inspected = await scan_workspace(template, InspectionInput(template_id=template["id"], template_revision=template["revision"],
            image_url=image["image_url"], alignment=Alignment(confirmed=True), inventory_confirmed=False, discover_unexpected=False), service)
        record = store.save_inspection(inspected)
        report["checks"][stage] = without_photos(record)
        if not record["analysis"]["objects"] or record["analysis"]["provider"] != "meta":
            raise ValueError("Inspect did not return live Meta detections.")
        if record["automatic_result"]["passed"]:
            raise ValueError("Inspect must require inventory review; no human review is invented.")
        stage = "inspect_explanation"
        explanation = await explain_inspection(record, service)
        report["checks"][stage] = explanation
        if explanation["provider"] != "baseten" or not explanation.get("live_request") or explanation.get("fallback"):
            raise ValueError("Inspection explanation must come from live Baseten for this check.")
        automatic_plan = corrective_plan(record)
        if automatic_plan["status"] != "blocked":
            raise ValueError("Unreviewed Inspect inventory must keep correction planning blocked.")
        store.update_inspection(record["id"], {"explanation": explanation, "correction_plan": automatic_plan}, record["revision"])
        report["checks"]["inspect_review_gate"] = automatic_plan
        reopened = InspectionStore(directory / "worldos-live.sqlite3").inspection(record["id"])
        report["checks"]["persistence"] = {"passed": bool(reopened["explanation"] and reopened["current_image_url"]), "isolated_database": "worldos-live.sqlite3"}
        report["status"] = "passed_integration_not_physical_completion"
    except (ProviderError, ValueError) as error:
        report.update(status="failed", failed_stage=stage,
                      error={"code": error.code if isinstance(error, ProviderError) else "validation_failed",
                             "message": str(error) if isinstance(error, ProviderError) else "Pipeline validation failed; no completion is claimed.",
                             "http_status": error.http_status if isinstance(error, ProviderError) else None})
    finally:
        report["provider_requests"] = http.events
        report["readiness"] = diagnostics(settings, ConnectionRegistry(), http)
        encoded = json.dumps(jsonable_encoder(report), indent=2)
        if any(key in encoded for key in (settings.meta_key, settings.baseten_key) if key):
            raise RuntimeError("Refusing to save a report containing a credential.")
        (directory / "report.json").write_text(encoded, encoding="utf-8")
        print(json.dumps({"status": report.get("status", "interrupted"), "failed_stage": report.get("failed_stage"),
                          "new_provider_requests": len(http.events), "physical_trials": 0, "report": str(directory / "report.json")}))
    return 0 if report.get("status") == "passed_integration_not_physical_completion" else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", action="store_true", required=True, help="Authorize paid SAM and Baseten calls on the named real photograph.")
    parser.add_argument("--image", required=True)
    parser.add_argument("--detections", required=True)
    parser.add_argument("--review", required=True)
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()
    try:
        sys.exit(asyncio.run(verify(args)))
    except (ValueError, OSError, KeyError, RuntimeError):
        print("Live pipeline check could not complete. Check local input, output path, and backend configuration; no success is assumed.", file=sys.stderr)
        sys.exit(2)
