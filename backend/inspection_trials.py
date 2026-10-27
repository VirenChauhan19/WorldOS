"""Guided physical evaluation. Labels are frozen before inference, never inferred."""
import hashlib
import json
from datetime import datetime, timezone
from uuid import uuid4

from pydantic import Field, StrictBool, model_validator

from .inspect_alignment import align_scene
from .inspect_evaluation import score_inspection, summarize_inspections
from .inspect_models import Alignment, StrictModel
from .inspect_store import StoreConflict, now
from .models import SceneObject
from .movement_evaluation import ratio


SCENARIOS = ["correct_workspace", "missing_object", "misplaced_object", "unexpected_object", "multiple_misplaced",
             "duplicate_objects", "protected_moved", "different_camera_angle", "partial_occlusion", "failed_detection"]


class TrialInput(StrictModel):
    template_id: str
    name: str = Field(min_length=1, max_length=120)
    scenario: str
    operator: str = Field(min_length=1, max_length=120)
    reference_captured_at: str = Field(min_length=1, max_length=100)
    physical_reference_confirmed: StrictBool

    @model_validator(mode="after")
    def declarations(self):
        if self.scenario not in SCENARIOS or not self.physical_reference_confirmed or not self.name.strip() or not self.operator.strip():
            raise ValueError("Choose an evaluation scenario, name the operator, and confirm a real physical reference photograph.")
        return self


class TruthIssue(StrictModel):
    object_id: str
    kind: str


class CaptureTruth(StrictModel):
    objects: list[SceneObject] = Field(max_length=24)
    issues: list[TruthIssue] = Field(max_length=24)
    workspace_correct: StrictBool
    inventory_complete: StrictBool
    independently_reviewed: StrictBool
    reviewed_by: str = Field(min_length=1, max_length=120)


class CaptureInput(StrictModel):
    stage: str
    image_url: str = Field(max_length=18_000_000)
    alignment: Alignment
    captured_at: str = Field(min_length=1, max_length=100)
    notes: str = Field(min_length=1, max_length=2000)
    physical_photograph_confirmed: StrictBool
    truth: CaptureTruth


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def validate_truth(template, truth):
    refs = {o["id"]: o for o in template["objects"]}
    present = {o.id for o in truth.objects}
    issues = {(i.object_id, i.kind) for i in truth.issues}
    if not truth.inventory_complete or not truth.independently_reviewed or not truth.reviewed_by.strip():
        raise ValueError("Independently label the full inventory before viewing model output.")
    if len(present) != len(truth.objects) or len(issues) != len(truth.issues):
        raise ValueError("Ground-truth identities and issues must be unique.")
    if any(not o.label.strip() for o in truth.objects):
        raise ValueError("Label every ground-truth observation.")
    for identity, kind in issues:
        if kind == "unexpected" and identity in present - refs.keys():
            continue
        if identity not in refs:
            raise ValueError("Use reference identities for missing or misplaced objects.")
        obj = refs[identity]
        valid = ((kind == "missing" and obj["required"] and identity not in present)
                 or (kind == "protected_moved" and obj["locked"] and identity in present)
                 or (kind == "misplaced" and not obj["locked"] and identity in present))
        if not valid:
            raise ValueError("Truth issues must agree with presence, required status, and protection.")
    missing = {identity for identity, kind in issues if kind == "missing"}
    if not {identity for identity, obj in refs.items() if obj["required"]} <= present | missing:
        raise ValueError("Draw each required identity at its observed position, or label it physically missing.")
    if any((identity, "unexpected") not in issues for identity in present - refs.keys()):
        raise ValueError("Label every non-reference observation as unexpected.")
    if truth.workspace_correct != (not issues):
        raise ValueError("Workspace correctness must agree with the independently labeled issues.")


def create_trial(store, body):
    template = store.template(body.template_id)
    result = {**body.model_dump(), "id": uuid4().hex, "created_at": now(), "template_snapshot": template}
    with store.connect() as db:
        db.execute("INSERT INTO evaluation_trials VALUES (?, ?, ?, ?)", (result["id"], body.template_id, json.dumps(result), result["created_at"]))
    return get_trial(store, result["id"])


def get_trial(store, identity):
    with store.connect() as db:
        row = db.execute("SELECT data FROM evaluation_trials WHERE id=?", (identity,)).fetchone()
        if not row:
            raise KeyError("Evaluation trial not found.")
        captures = db.execute("SELECT data FROM evaluation_captures WHERE trial_id=? ORDER BY stage DESC", (identity,)).fetchall()
    return {**json.loads(row[0]), "captures": [json.loads(c[0]) for c in captures]}


def list_trials(store, template_id=None):
    with store.connect() as db:
        rows = db.execute("SELECT data FROM evaluation_trials ORDER BY created_at DESC").fetchall()
    return [{k: t[k] for k in ("id", "template_id", "name", "scenario", "operator", "created_at")}
            for row in rows if (t := json.loads(row[0])) and (template_id is None or t["template_id"] == template_id)]


def get_capture(store, identity):
    with store.connect() as db:
        row = db.execute("SELECT data FROM evaluation_captures WHERE id=?", (identity,)).fetchone()
    if not row:
        raise KeyError("Evaluation capture not found.")
    return json.loads(row[0])


def save_capture(store, trial_id, body):
    trial = get_trial(store, trial_id)
    template = trial["template_snapshot"]
    if body.stage not in {"inspection", "corrected"} or not body.physical_photograph_confirmed or not body.notes.strip():
        raise ValueError("Capture a real inspection or corrected photograph and describe the physical setup.")
    if any(c["stage"] == body.stage for c in trial["captures"]):
        raise StoreConflict("This stage is already frozen. Start another trial for a new photograph or revised ground truth.")
    initial = next((c for c in trial["captures"] if c["stage"] == "inspection"), None)
    if body.stage == "corrected" and not (initial and initial.get("attempts")):
        raise ValueError("Attempt the initial inspection before recording the correction photograph.")
    validate_truth(template, body.truth)
    # Validate, but freeze the exact input used by the labeling preview. Repeated
    # JPEG re-encoding is lossy and would break the input binding on real photos.
    from .imaging import image_from_data_url
    image = image_from_data_url(body.image_url)
    canonical = body.image_url
    image_hash = digest(canonical)
    if (image_hash == digest(template["reference_image_url"]) or image["image_url"] == template["reference_image_url"]
            or any(c["image_hash"] == image_hash for c in trial["captures"])):
        raise ValueError("Use a separately captured photograph for each stage; do not reuse the reference or inspection image.")
    aligned = align_scene(template, canonical, body.alignment)
    result = {**body.model_dump(), "image_url": canonical, "id": uuid4().hex, "trial_id": trial_id, "revision": 1,
              "saved_at": now(), "image_hash": image_hash, "image_width": image["width"], "image_height": image["height"], "aligned_image": aligned, "attempts": [], "record": None}
    with store.connect() as db:
        db.execute("BEGIN IMMEDIATE")
        if db.execute("SELECT 1 FROM evaluation_captures WHERE trial_id=? AND stage=?", (trial_id, body.stage)).fetchone():
            raise StoreConflict("This stage was already saved. Reload the trial.")
        rows = db.execute("SELECT data FROM evaluation_captures").fetchall()
        if any(json.loads(row[0])["image_hash"] == image_hash for row in rows):
            raise ValueError("This photograph is already counted in an evaluation trial. Capture a new independent trial.")
        db.execute("INSERT INTO evaluation_captures VALUES (?, ?, ?, ?, ?)", (result["id"], trial_id, body.stage, 1, json.dumps(result)))
    return get_trial(store, trial_id)


def begin_attempt(store, identity, request):
    """Atomic lease, including crash recovery. Completed capture retries never infer."""
    with store.connect() as db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT data FROM evaluation_captures WHERE id=?", (identity,)).fetchone()
        if not row:
            raise KeyError("Evaluation capture not found.")
        capture = json.loads(row[0])
        trial = json.loads(db.execute("SELECT data FROM evaluation_trials WHERE id=?", (capture["trial_id"],)).fetchone()[0])
        template = trial["template_snapshot"]
        if (request.template_id != template["id"] or request.template_revision != template["revision"]
                or request.image_url != capture["image_url"] or request.alignment.model_dump() != capture["alignment"]):
            raise ValueError("Use the saved evaluation photograph, alignment, and pinned reference. Ground truth cannot change after capture.")
        if request.inventory_confirmed:
            raise ValueError("Evaluation starts without inventory confirmation. Apply human confirmation after the automatic result is saved.")
        if capture.get("record"):
            return capture, template, None
        attempts = capture["attempts"]
        if attempts and attempts[-1]["status"] == "running":
            age = (datetime.now(timezone.utc)-datetime.fromisoformat(attempts[-1]["started_at"])).total_seconds()
            if age < 150:
                raise StoreConflict("This photograph is still being inspected. Reload the trial; retry after 150 seconds only if it was interrupted.")
            attempts[-1].update(status="interrupted", error="Server or connection interrupted; no successful result was saved.")
        token = uuid4().hex
        attempts.append({"id": token, "status": "running", "started_at": now(), "request_settings": {
            "discover_unexpected": request.discover_unexpected, "extra_concepts": request.extra_concepts}})
        capture["revision"] += 1
        db.execute("UPDATE evaluation_captures SET data=?, revision=? WHERE id=?", (json.dumps(capture), capture["revision"], identity))
    return capture, template, token


def finish_attempt(store, identity, token, elapsed_ms, *, record=None, error=None):
    with store.connect() as db:
        db.execute("BEGIN IMMEDIATE")
        capture = json.loads(db.execute("SELECT data FROM evaluation_captures WHERE id=?", (identity,)).fetchone()[0])
        if capture["attempts"][-1]["id"] != token:
            raise StoreConflict("A newer explicit retry owns this capture. Reload the trial.")
        capture["attempts"][-1].update(status="completed" if record else "failed", finished_at=now(), pipeline_ms=elapsed_ms, error=error)
        capture["revision"] += 1
        if record:
            record = {**record, "id": uuid4().hex, "revision": 1, "created_at": now(), "evaluation_capture_id": identity}
            capture["record"] = record
            db.execute("INSERT INTO inspections VALUES (?, ?, ?, ?, ?)", (record["id"], record["template_id"], 1, json.dumps(record), record["created_at"]))
        db.execute("UPDATE evaluation_captures SET data=?, revision=? WHERE id=?", (json.dumps(capture), capture["revision"], identity))
    return record


def evaluation_report(store):
    trials = [get_trial(store, t["id"]) for t in list_trials(store)]
    cohorts = {stage: {"automatic": [], "human_assisted": []} for stage in ("inspection", "corrected")}
    outcomes = []; latencies = []; attempts = []; actions = 0
    for trial in trials:
        summaries = {}
        for capture in trial["captures"]:
            record = capture["record"]
            attempts.extend(capture["attempts"])
            if not capture["attempts"]:
                continue
            truth = capture["truth"]
            automatic = score_inspection(trial["template_snapshot"], truth, record, record["automatic_result"] if record else None)
            assisted = score_inspection(trial["template_snapshot"], truth, record, record["reviewed_result"]) if record and record.get("reviewed_result") else None
            cohorts[capture["stage"]]["automatic"].append(automatic)
            if assisted:
                cohorts[capture["stage"]]["human_assisted"].append(assisted)
            if record:
                latencies.append({"capture_id": capture["id"], "milliseconds": record["inference_wall_ms"], "cache": record["analysis"].get("inference_cache")})
                for event in record.get("review_history", []):
                    review = event["review"]
                    actions += len(review["assignments"]) + len(review["manual_objects"]) + len(review["ignored_detection_ids"]) + int(review["inventory_confirmed"])
            summaries[capture["stage"]] = {"capture_id": capture["id"], "image_hash": capture["image_hash"], "automatic": automatic,
                "human_assisted": assisted, "attempt_count": len(capture["attempts"]), "record_id": record["id"] if record else None}
        outcomes.append({"id": trial["id"], "scenario": trial["scenario"], "name": trial["name"], "stages": summaries})
    started = [o for o in outcomes if "inspection" in o["stages"]]
    verified = [o for o in started if "corrected" in o["stages"]]
    scenarios = {o["scenario"] for o in verified}
    def success(outcome, mode):
        row = outcome["stages"].get("corrected", {}).get(mode)
        return bool(row and row["workspace_correct"] and row["verification_prediction"] is True)
    return {"schema_version": 1, "generated_at": now(), "measurement_status": "unmeasured" if not started else "complete_scenario_coverage" if len(verified)>=10 and len(scenarios)==10 else "preliminary",
        "provenance_notice": "Physical photographs and independent labels are operator declarations. Frozen labels and image hashes support reproducibility; they do not authenticate physical capture. Software fixtures are never real-world evidence.",
        "automatic_definition": "Original model decisions on a reviewed reference and manually confirmed camera alignment, without identity edits or inventory confirmation. Success remains withheld until a human checks the inventory.",
        "human_assisted_definition": "Post-inference review, including inventory-only confirmation; original model results are retained unchanged.",
        "trial_count": len(trials), "attempted_trials": len(started), "trials_with_corrected_attempt": len(verified), "pending_scenarios": [s for s in SCENARIOS if s not in scenarios],
        "metrics": {stage: {mode: summarize_inspections(rows) for mode, rows in modes.items()} for stage, modes in cohorts.items()},
        "task_success": {mode: {"over_started_trials": ratio(sum(success(o,mode) for o in started),len(started)),
                                "over_trials_with_corrected_attempt": ratio(sum(success(o,mode) for o in verified),len(verified))} for mode in ("automatic", "human_assisted")},
        "attempt_count": len(attempts), "running_attempts": sum(a["status"] == "running" for a in attempts),
        "failed_or_interrupted_attempts": sum(a["status"] in {"failed", "interrupted"} for a in attempts),
        "human_review_actions": actions, "latency_samples": latencies, "mean_inference_wall_ms": sum(l["milliseconds"] for l in latencies)/len(latencies) if latencies else None,
        "denominators": {"issue_precision": "correctly detected labeled issues / all decided predicted issues", "issue_recall": "correctly detected labeled issues / all labeled issues (abstentions count as misses)",
            "false_alarms_per_trial": "incorrect decided issues / attempted photographs in this stage and cohort", "task_success": "corrected photograph independently labeled correct AND verified passed / all started trials, also reported over trials with a corrected attempt",
            "human_assisted": "Only captures with saved human review enter assisted issue metrics; task denominators still include every started trial.", "latency": "Successful scan inference wall time including discovery and cache lookup; failures have attempt duration separately. Not provider-only latency.",
            "in_progress": "Started captures remain in opportunity denominators during retry; no result means abstention, not success. Reports update when the attempt finishes.",
            "zero_denominator": "value=null means unmeasured, never zero accuracy"}, "trials": outcomes}


def export_trial(trial):
    """Download complete, portable evidence, including photographs; contains no keys."""
    return {"app": "WorldOS Inspect", "schema_version": 1, "provenance": "saved_evaluation_evidence", **trial}
