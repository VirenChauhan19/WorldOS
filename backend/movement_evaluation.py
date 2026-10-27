"""Physical-photo benchmark scoring. Ground truth is never used as AI input."""
from .evaluation import iou
from .models import Box


def ratio(numerator, denominator):
    return {"numerator": numerator, "denominator": denominator,
            "value": numerator/denominator if denominator else None}


def score_case(request, plan, truth, result):
    references = {o.id: o for o in truth["objects"]}
    rows = {r["object_id"]: r for r in result.get("objects", [])} if result else {}
    observed = {o["id"]: o for o in result.get("observed_objects", [])} if result else {}
    identities = []
    for obj in request.objects:
        row, actual = rows.get(obj.id, {}), observed.get(obj.id)
        decided = row.get("certainty") in {"supported", "reviewed"} and actual is not None
        # Identity is credited only against an independently labelled after box.
        correct = bool(decided and iou(Box.model_validate(actual["box"]), references[obj.id].box) >= .5)
        identities.append({"id": obj.id, "decided": decided, "correct": correct})

    def decision(identity):
        row = rows.get(identity, {})
        return row.get("matched", False) if row.get("certainty") in {"supported", "reviewed"} else None

    movements = [{"id": step.object_id, "truth": truth["completed_movements"][step.object_id],
                  "prediction": decision(step.object_id)} for step in plan.movements]
    protected = [{"id": identity, "truth": truth["protected_preserved"][identity],
                  "prediction": decision(identity)} for identity in plan.locked_ids]
    prediction = (True if result["passed"] else False if result["status"] == "failed" else None) if result else None
    return {"identities": identities, "movements": movements, "protected": protected,
            "goal": {"truth": truth["goal_achieved"], "prediction": prediction},
            "decision": result["status"] if result else "provider_error"}


def summarize(cases):
    identities = [row for case in cases for row in case["identities"]]
    result = {"object_matching": {
        "correct_over_all_identities": ratio(sum(r["correct"] for r in identities), len(identities)),
        "precision_among_decided": ratio(sum(r["correct"] for r in identities), sum(r["decided"] for r in identities)),
        "coverage": ratio(sum(r["decided"] for r in identities), len(identities))}}
    for key in ("movements", "protected", "goal"):
        rows = [row for case in cases for row in (case[key] if key != "goal" else [case[key]])]
        decided = [r for r in rows if r["prediction"] is not None]
        result[key] = {
            "correct_over_all": ratio(sum(r["prediction"] == r["truth"] for r in decided), len(rows)),
            "accuracy_among_decided": ratio(sum(r["prediction"] == r["truth"] for r in decided), len(decided)),
            "coverage": ratio(len(decided), len(rows)),
            "false_success_over_actual_negatives": ratio(sum(r["prediction"] is True and r["truth"] is False for r in rows), sum(r["truth"] is False for r in rows)),
            "false_success_over_positive_decisions": ratio(sum(r["prediction"] is True and r["truth"] is False for r in rows), sum(r["prediction"] is True for r in rows)),
            "abstentions": len(rows)-len(decided),
        }
    result["decision_counts"] = {status: sum(c["decision"] == status for c in cases) for status in ("passed", "failed", "needs_review", "provider_error")}
    return result
