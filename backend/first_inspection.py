"""Summarize recorded phone-moved evidence without inventing missing outcomes."""
import re


def first_inspection_summary(trial):
    template = trial["template_snapshot"]
    is_phone = lambda label: re.sub(r"[^a-z]", "", label.lower()) in {"phone", "smartphone", "mobilephone", "cellphone"}
    phones = [o for o in template["objects"] if is_phone(o["label"])]
    initial = next((c for c in trial["captures"] if c["stage"] == "inspection"), None)
    corrected = next((c for c in trial["captures"] if c["stage"] == "corrected"), None)
    record = initial.get("record") if initial else None
    after = corrected.get("record") if corrected else None
    reference_analysis = template.get("reference_analysis")
    detected = (any(is_phone(o["label"]) for o in reference_analysis["objects"]) if reference_analysis else None)
    identification = None
    if len(phones) == 1 and record:
        facts = record["automatic_result"]
        identification = (any(o["object_id"] == phones[0]["id"] and o["status"] == "misplaced" for o in facts["objects"])
            and all(o["status"] == "correct" for o in facts["objects"] if o["object_id"] != phones[0]["id"])
            and not facts["additional_objects"] and not facts["issues"])
        # This question only has a measured answer when the independent labels
        # establish that precisely the phone moved in this physical trial.
        truth = initial["truth"]
        if truth["issues"] != [{"object_id": phones[0]["id"], "kind": "misplaced"}]:
            identification = None
    records = [r for r in (record, after) if r]
    analyses = [a for a in [reference_analysis, *(r.get("analysis") for r in records)] if a]
    provenance = "test" if any(a.get("live_request") is False for a in analyses) else "live" if analyses and all(a.get("live_request") is True for a in analyses) else "unknown"
    manual = any(o.get("source") in {None, "manual", "ai_corrected"} for o in template["objects"])
    manual |= any((r.get("review") or {}).get("manual_objects") for r in records)
    confirmed = (after.get("reviewed_result") or after["automatic_result"]) if after else None
    samples = [a["pipeline_ms"] for c in trial["captures"] for a in c.get("attempts", []) if a.get("pipeline_ms") is not None]
    if template.get("reference_inference_wall_ms") is not None:
        samples.insert(0, template["reference_inference_wall_ms"])
    return {
        "scope": "Recorded physical trial; null means unmeasured. Human review is separate from automatic detection.",
        "phone_detected_automatically": detected,
        "recorded_ai_provenance": provenance,
        "correct_phone_discrepancy_identified_automatically": identification,
        "manual_annotation_used": bool(manual),
        "human_identity_review_used": any(bool((r.get("review") or {}).get("assignments")) for r in records),
        "movement_instruction_correct_operator_report": corrected.get("movement_instruction_correct") if corrected else None,
        "verification_succeeded": bool(confirmed["passed"] and corrected["truth"]["workspace_correct"]) if confirmed else None,
        "verification_evidence_mode": confirmed["evidence_mode"] if confirmed else None,
        "recorded_processing_ms": sum(samples) if samples else None,
        "processing_scope": "Reference detection plus all completed scan attempts, including failed attempts. Excludes capture, review, network transfer outside these timers, and advisory explanation.",
        "failed_scan_attempts": sum(a["status"] in {"failed", "interrupted"} for c in trial["captures"] for a in c.get("attempts", [])),
        "complete_capture_sequence": bool(initial and corrected and record and after),
    }
