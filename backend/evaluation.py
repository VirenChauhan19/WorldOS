"""Scoped detection evaluation against reviewed boxes, independent of planner feasibility."""
from .ai_service import iou
from .visual_verification import label_key


def evaluate_detections(detections, references, threshold=.5, reference_complete=False):
    pairs = sorted(((iou(d.box, r.box), d.id, r.id) for d in detections for r in references
                    if label_key(d.label) == label_key(r.label)), reverse=True)
    used_d, used_r, matches = set(), set(), []
    for score, detection, reference in pairs:
        if score >= threshold and detection not in used_d and reference not in used_r:
            used_d.add(detection)
            used_r.add(reference)
            matches.append({"detection_id": detection, "reference_id": reference, "iou": round(score, 6)})
    return {"iou_threshold": threshold, "matching": "label-exact, greedy descending IoU, one-to-one", "reference_complete": reference_complete,
            "true_positives": len(matches), "false_positives": len(detections)-len(matches) if reference_complete else None, "false_negatives": len(references)-len(matches),
            "unmatched_detection_count": len(detections)-len(matches),
            "precision": len(matches)/len(detections) if detections and reference_complete else None,
            "recall": len(matches)/len(references) if references else None,
            "mean_matched_iou": sum(m["iou"] for m in matches)/len(matches) if matches else None,
            "matches": matches, "missing_reference_ids": [r.id for r in references if r.id not in used_r],
            "unmatched_detection_ids": [d.id for d in detections if d.id not in used_d]}
