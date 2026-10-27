"""Inspection benchmark scoring; uncertainty is abstention, never success."""
from .ai_service import iou
from .evaluation import evaluate_detections
from .models import Box, SceneObject
from .movement_evaluation import ratio
from .visual_verification import label_key


def score_inspection(template, truth, record, facts):
    observations = [SceneObject.model_validate(o) for o in truth["objects"]]
    reference_ids = {o["id"] for o in template["objects"]}
    raw = record["analysis"]["objects"] if record else []
    coverage = evaluate_detections([SceneObject.model_validate(o) for o in raw], observations, reference_complete=True)
    by_id = {o.id:o for o in observations}
    rows = {r["object_id"]:r for r in facts["objects"]} if facts else {}
    identities = []
    for identity in sorted(reference_ids & set(by_id)):
        row=rows.get(identity,{})
        decided=row.get("certainty") in {"supported","reviewed"} and row.get("observed_box") is not None
        correct=bool(decided and iou(Box.model_validate(row["observed_box"]),by_id[identity].box)>=.5)
        identities.append({"id":identity,"decided":decided,"correct":correct})
    expected={(issue["object_id"],issue["kind"]) for issue in truth["issues"]}
    predicted=set()
    mapping={"misplaced":"misplaced","protected_moved":"protected_moved","confirmed_missing":"missing"}
    for row in rows.values():
        if row["status"] in mapping and row["certainty"] in {"supported","reviewed"}:
            predicted.add((row["object_id"],mapping[row["status"]]))
    used=set()
    for row in facts.get("additional_objects",[]) if facts else []:
        if row["status"]!="unexpected" or row["certainty"] not in {"supported","reviewed"}:
            continue
        candidates=[o for o in observations if o.id not in reference_ids|used and label_key(o.label)==label_key(row["label"])
                    and iou(o.box,Box.model_validate(row["observed_box"]))>=.5]
        if candidates:
            match=max(candidates,key=lambda o:iou(o.box,Box.model_validate(row["observed_box"])))
            identity=match.id;used.add(identity)
        else:identity=f"unmatched:{row['object_id']}"
        predicted.add((identity,"unexpected"))
    tp=len(predicted&expected)
    prediction=(True if facts["passed"] else False if facts["status"]=="issues_found" else None) if facts else None
    return {"detection_matched":coverage["true_positives"],"visible_truth_objects":len(observations),
            "identities":identities,"issue_tp":tp,"issue_fp":len(predicted)-tp,"issue_fn":len(expected)-tp,
            "predicted_issues":sorted(predicted),"truth_issues":sorted(expected),
            "workspace_correct":truth["workspace_correct"],"verification_prediction":prediction,
            "human_review_required":facts["review_required"] if facts else True}


def summarize_inspections(rows):
    identities=[o for row in rows for o in row["identities"]]
    tp=sum(r["issue_tp"] for r in rows);fp=sum(r["issue_fp"] for r in rows);fn=sum(r["issue_fn"] for r in rows)
    decided=[r for r in rows if r["verification_prediction"] is not None]
    return {"detection_coverage":ratio(sum(r["detection_matched"] for r in rows),sum(r["visible_truth_objects"] for r in rows)),
            "identity_correct_over_present_reference_objects":ratio(sum(o["correct"] for o in identities),len(identities)),
            "identity_precision_among_decided":ratio(sum(o["correct"] for o in identities),sum(o["decided"] for o in identities)),
            "identity_coverage":ratio(sum(o["decided"] for o in identities),len(identities)),
            "issue_precision":ratio(tp,tp+fp),"issue_recall":ratio(tp,tp+fn),"false_alarm_count":fp,
            "false_alarms_per_trial":ratio(fp,len(rows)),
            "verification_correct_over_all":ratio(sum(r["verification_prediction"]==r["workspace_correct"] for r in decided),len(rows)),
            "verification_decision_coverage":ratio(len(decided),len(rows)),
            "verification_success_on_correct_workspaces":ratio(sum(r["verification_prediction"] is True and r["workspace_correct"] for r in rows),sum(r["workspace_correct"] for r in rows)),
            "false_acceptance_over_incorrect_workspaces":ratio(sum(r["verification_prediction"] is True and not r["workspace_correct"] for r in rows),sum(not r["workspace_correct"] for r in rows)),
            "human_review_required":ratio(sum(r["human_review_required"] for r in rows),len(rows))}
