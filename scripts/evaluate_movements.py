"""Capture/score genuine physical before/after trials, with explicit live opt-in."""
import argparse
import asyncio
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dotenv import load_dotenv
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, ConfigDict, Field, StrictBool

from backend.ai_service import AIService
from backend.imaging import prepare_image
from backend.main import plan_with_constraints
from backend.models import PlanRequest, SceneObject
from backend.movement_evaluation import score_case, summarize
from backend.providers import AISettings, ProviderError, ProviderHTTP
from backend.visual_verification import ReviewedStateRequest, VisualVerifyRequest, automatic_verify, verify_reviewed

ROOT = Path(__file__).resolve().parents[1]
SCENARIOS = [
    ("single_move", "Complete one real movement; retain a protected anchor."),
    ("multiple_moves", "Complete two or more planned movements in order."),
    ("unchanged_control", "Take another photograph without executing the plan; expect rejection."),
    ("partial_completion", "Execute only part of a multi-movement plan."),
    ("protected_moved", "Displace one protected object as a negative control."),
    ("duplicate_objects", "Move one of two same-label objects; record physical identities independently."),
    ("occluded_object", "Partially occlude an original object after movement; retain its true identity."),
    ("new_obstacle", "Introduce an additional obstacle into the target after executing the plan."),
    ("lighting_change", "Complete the movements, then change lighting while retaining camera framing."),
    ("camera_shift", "Complete movements, shift the camera, and leave framing_confirmed false."),
]


class Truth(BaseModel):
    model_config = ConfigDict(extra="forbid")
    physical_photo_pair: StrictBool
    independent_reference: StrictBool
    inventory_complete: StrictBool
    reviewed_by: str = Field(min_length=1)
    captured_at: str = Field(min_length=1)
    notes: str = Field(min_length=1)
    objects: list[SceneObject] = Field(min_length=1, max_length=12)
    completed_movements: dict[str, StrictBool]
    protected_preserved: dict[str, StrictBool]
    goal_achieved: StrictBool


def digest(value):
    return hashlib.sha256(value if isinstance(value, bytes) else json.dumps(value, sort_keys=True).encode()).hexdigest()


def read(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def template():
    return {"schema_version": 1, "fixture_type": "physical_photo_pairs", "cases": [
        {"id": name, "instructions": instructions, "captured": False,
         "before": f"{name}/before.jpg", "after": f"{name}/after.jpg",
         "plan": f"{name}/plan.json", "truth": f"{name}/truth.json",
         "recording": f"{name}/inference.json", "reviewed": None,
         "framing_confirmed": name != "camera_shift", "inventory_confirmed": True}
        for name, instructions in SCENARIOS]}


def load_cases(manifest_path):
    manifest = read(manifest_path)
    if manifest.get("schema_version") != 1 or manifest.get("fixture_type") != "physical_photo_pairs":
        raise ValueError("Use schema_version 1 and fixture_type physical_photo_pairs. Synthetic fixtures cannot be scored as physical trials.")
    entries = manifest["cases"]
    if len({e["id"] for e in entries}) != len(entries):
        raise ValueError("Case IDs must be unique.")
    cases, pending, seen_pairs = [], [], set()
    for entry in entries:
        if entry.get("captured") is not True:
            pending.append(entry["id"])
            continue
        if type(entry["framing_confirmed"]) is not bool or type(entry["inventory_confirmed"]) is not bool:
            raise ValueError("Framing and inventory declarations must be booleans.")
        raw_before = (manifest_path.parent / entry["before"]).read_bytes()
        raw_after = (manifest_path.parent / entry["after"]).read_bytes()
        hashes = {"before_sha256": digest(raw_before), "after_sha256": digest(raw_after)}
        if hashes["before_sha256"] == hashes["after_sha256"]:
            raise ValueError("Take a separate after photograph, including for unchanged controls; copying the same file is not a physical trial.")
        pair = tuple(hashes.values())
        if pair in seen_pairs:
            raise ValueError("Repeated photo pair cannot count as another scenario.")
        seen_pairs.add(pair)
        before, after = prepare_image(raw_before), prepare_image(raw_after)
        if abs((before["width"]/before["height"])/(after["width"]/after["height"])-1) > .02:
            raise ValueError("Use matching aspect ratios; camera-shift trials must retain the same aspect ratio.")
        export = read(manifest_path.parent / entry["plan"])
        request = PlanRequest.model_validate(export.get("request", export))
        if export.get("revision"):
            raise ValueError("Capture the initial plan, before replanning, for each independent trial.")
        plan = plan_with_constraints(request)
        if plan.status not in {"ready", "already_clear"}:
            raise ValueError("Each trial requires a feasible initial plan.")
        truth = Truth.model_validate(read(manifest_path.parent / entry["truth"]))
        if not all((truth.physical_photo_pair, truth.independent_reference, truth.inventory_complete)) or not truth.reviewed_by.strip():
            raise ValueError("Physical photos and independently reviewed complete references are required.")
        ids = [o.id for o in truth.objects]
        if len(set(ids)) != len(ids) or not {o.id for o in request.objects} <= set(ids):
            raise ValueError("Reference must locate each original identity exactly once, plus any additional obstacles.")
        if set(truth.completed_movements) != {s.object_id for s in plan.movements} or set(truth.protected_preserved) != set(plan.locked_ids):
            raise ValueError("Grade every planned movement and every protected object, with exact original IDs.")
        hashes.update(request_sha256=digest(request.model_dump()), plan_sha256=digest(plan.model_dump()))
        reviewed = None
        if entry.get("reviewed"):
            reviewed = ReviewedStateRequest.model_validate(read(manifest_path.parent / entry["reviewed"]))
            if reviewed.original_request != request or reviewed.plan_request != request:
                raise ValueError("Reviewed trial must refer to the exact initial request.")
        cases.append((entry, request, plan, truth, before, after, hashes, reviewed))
    return entries, cases, pending


async def evaluate(args):
    path = Path(args.manifest).resolve()
    entries, cases, pending = load_cases(path)  # Validate ALL references before any billable call.
    if args.recorded:
        for entry, _, _, _, _, _, hashes, _ in cases:
            recording = read(path.parent / entry["recording"])
            if recording.get("provenance") != "recorded_live_provider_result" or recording.get("hashes") != hashes:
                raise ValueError("Recording provenance, photo hashes, request, or planner output differs. Rerun with --live.")
            if recording.get("result") is not None and recording["result"].get("source") != "sam_after_photo":
                raise ValueError("Recorded automatic result must originate from SAM after-photo verification.")
    service = None
    if args.live and cases:
        load_dotenv(ROOT / ".env")
        service = AIService(ProviderHTTP(AISettings.from_env()))
    report = {"schema_version": 1, "version": "0.4.0", "recorded_at": datetime.now(timezone.utc).isoformat(),
              "mode": "live" if args.live else "recorded" if args.recorded else "validation_only",
              "provenance_notice": "Physical capture and independent truth are author declarations. Recordings bind inputs by hash; this is not a provider authenticity attestation.",
              "scenario_count": len(entries), "captured_pairs": len(cases), "evaluated_pairs": 0,
              "pending_scenarios": pending, "cases": []}
    automated, corrected = [], []
    for entry, request, plan, truth, before, after, hashes, reviewed in cases:
        if args.validate:
            continue
        result, error = None, None
        if args.live:
            try:
                result = jsonable_encoder(await automatic_verify(VisualVerifyRequest(
                    plan_request=request, before_image_url=before["image_url"], image_url=after["image_url"],
                    framing_confirmed=entry["framing_confirmed"], inventory_confirmed=entry["inventory_confirmed"]), service, plan_with_constraints))
            except ProviderError as exc:
                error = {"code": exc.code, "status": exc.status}
            except TimeoutError:
                error = {"code": "timeout", "status": 504}
            recording = {"provenance": "recorded_live_provider_result", "recorded_at": datetime.now(timezone.utc).isoformat(),
                         "hashes": hashes, "result": result, "error": error}
            destination = path.parent / entry["recording"]
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_text(json.dumps(recording, indent=2), encoding="utf-8")
        else:
            recording = read(path.parent / entry["recording"])
            result, error = recording["result"], recording.get("error")
        reference = {**truth.model_dump(), "objects": truth.objects}
        scored = score_case(request, plan, reference, result)
        automated.append(scored)
        row = {"id": entry["id"], "hashes": hashes, "reviewed_by": truth.reviewed_by,
               "captured_at": truth.captured_at, "error": error, "automated": scored,
               "provider": result.get("provider") if result else None,
               "model": result.get("model") if result else None,
               "latency_ms": result.get("latency_ms") if result else None, "user_corrected": None}
        if reviewed:
            review_result = jsonable_encoder(verify_reviewed(reviewed, plan_with_constraints))
            review_result["observed_objects"] = jsonable_encoder(reviewed.observed_objects)
            row["user_corrected"] = score_case(request, plan, reference, review_result)
            corrected.append(row["user_corrected"])
        report["cases"].append(row)
    report.update(evaluated_pairs=len(automated), user_corrected_pairs=len(corrected),
                  automated_metrics=summarize(automated), user_corrected_metrics=summarize(corrected),
                  measurement_status="measured" if automated else "unmeasured")
    destination = Path(args.output)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({k: report[k] for k in ("measurement_status", "scenario_count", "captured_pairs", "evaluated_pairs", "user_corrected_pairs")}))
    if any(c["error"] for c in report["cases"]) or (args.require_complete and (len(automated) < 10 or pending)):
        return 1
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--init", help="Create a ten-scenario capture directory; no images/results are generated.")
    parser.add_argument("--manifest")
    parser.add_argument("--output", default="artifacts/movement-evaluation.json")
    parser.add_argument("--require-complete", action="store_true")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--live", action="store_true", help="Explicitly send captured photos to the configured provider (may use credits).")
    mode.add_argument("--recorded", action="store_true", help="Score hash-matched recordings without provider calls.")
    mode.add_argument("--validate", action="store_true", help="Validate capture inputs without inference/scoring.")
    args = parser.parse_args()
    if args.init:
        destination = Path(args.init) / "manifest.json"
        destination.parent.mkdir(parents=True, exist_ok=True)
        with destination.open("x", encoding="utf-8") as handle:
            json.dump(template(), handle, indent=2)
        print(f"Created {destination}; 10 pending scenarios, no measurements.")
        return 0
    if not args.manifest or not any((args.live, args.recorded, args.validate)):
        parser.error("Use --init, or --manifest with --validate, --recorded, or --live.")
    return asyncio.run(evaluate(args))


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, OSError, KeyError, TypeError, ProviderError):
        print("Invalid/unreadable evaluation input. Check manifest, physical photos, independent truth, and recording hashes. No successful measurement is claimed.", file=sys.stderr)
        sys.exit(2)
