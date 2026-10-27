"""Conservative photo verification. Scores are evidence, never calibrated identity confidence."""
import base64
import io
import re
from math import hypot
from time import perf_counter

from PIL import Image
from pydantic import BaseModel, ConfigDict, Field, model_validator

from .models import AIAnalysisRequest, PlanRequest, SceneObject
from .planner import contains, overlaps
from .imaging import image_from_data_url


class VisualVerifyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    plan_request: PlanRequest
    original_request: PlanRequest | None = None
    image_url: str = Field(max_length=18_000_000)
    before_image_url: str | None = Field(default=None, max_length=18_000_000)
    framing_confirmed: bool = False
    inventory_confirmed: bool = False
    tolerance: float = Field(default=.025, ge=.001, le=.1)


class ReviewedStateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    original_request: PlanRequest
    plan_request: PlanRequest
    observed_objects: list[SceneObject] = Field(min_length=1, max_length=12)
    reviewed_ids: list[str] = Field(max_length=12)
    framing_confirmed: bool
    inventory_confirmed: bool
    tolerance: float = Field(default=.025, ge=.001, le=.1)

    @model_validator(mode="after")
    def validate_review(self):
        ids = [o.id for o in self.observed_objects]
        if len(set(ids)) != len(ids):
            raise ValueError("Observed object IDs must be unique.")
        if set(ids) != set(self.reviewed_ids) or len(ids) != len(self.reviewed_ids):
            raise ValueError("Review every current annotation, including added obstacles, first.")
        if not self.framing_confirmed or not self.inventory_confirmed:
            raise ValueError("Confirm matching camera framing and a complete obstacle inventory first.")
        if not {o.id for o in self.plan_request.objects} <= set(ids):
            raise ValueError("Missing original identities; locate and annotate every original object first.")
        validate_lineage(self.original_request, self.plan_request)
        labels = {o.id: o.label for o in self.plan_request.objects}
        if any(o.id in labels and o.label != labels[o.id] for o in self.observed_objects):
            raise ValueError("Preserve identity labels when assigning final observations.")
        return self


def validate_lineage(original, current):
    if (original.goal != current.goal or original.target != current.target
            or original.workspace != current.workspace or original.clearance != current.clearance
            or original.constraints != current.constraints):
        raise ValueError("Keep the original goal, target, workspace, clearance, and constraints when revising a plan.")
    if not {o.id for o in original.objects} <= {o.id for o in current.objects}:
        raise ValueError("Current plan must retain every original identity.")
    current_by_id = {o.id: o for o in current.objects}
    if any(o.label != current_by_id[o.id].label or (o.locked and not current_by_id[o.id].locked) for o in original.objects):
        raise ValueError("Original identity labels and object locks must be retained.")


def label_key(label):
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", " ", label.casefold())).strip()


def edge_error(a, b):
    return max(abs(a.x-b.x), abs(a.y-b.y), abs(a.x+a.width-b.x-b.width), abs(a.y+a.height-b.y-b.height))


def appearance_image(url):
    if not url:
        return None
    canonical = image_from_data_url(url)
    return Image.open(io.BytesIO(base64.b64decode(canonical["image_url"].split(",", 1)[1]))).convert("RGB")


def color_similarity(before, after, a, b):
    if before is None or after is None:
        return None
    def histogram(image, box):
        crop = image.crop((int(box.x*image.width), int(box.y*image.height),
                           max(int(box.x*image.width)+1, int((box.x+box.width)*image.width)),
                           max(int(box.y*image.height)+1, int((box.y+box.height)*image.height))))
        # Coarse RGB histogram: illumination-sensitive corroboration, not an identity model.
        h = crop.resize((32, 32)).histogram()
        bins = [sum(h[channel*256+i:channel*256+i+32]) / 3072 for channel in range(3) for i in range(0, 256, 32)]
        return bins
    return round(sum(min(x, y) for x, y in zip(histogram(before, a), histogram(after, b))), 4)


def match_identities(expected, originals, detections, before=None, after=None):
    """Rank evidence, with a separate conservative gate for identity acceptance.

    Scores are heuristics, not identity probabilities. A planned destination must
    never be the sole reason an identity is accepted.
    """
    def center(box):
        return box.x + box.width/2, box.y + box.height/2

    def footprint(a, b):
        return min(a.width/b.width, b.width/a.width) * min(a.height/b.height, b.height/a.height)

    # Stationary, uniquely labelled anchors corroborate relative scene geometry.
    anchors = []
    for source in originals:
        item = next(o for o in expected if o.id == source.id)
        peers = [d for d in detections if label_key(d.label) == label_key(source.label)]
        if (edge_error(source.box, item.box) <= .01 and len(peers) == 1
                and sum(label_key(o.label) == label_key(source.label) for o in originals) == 1
                and (peers[0].confidence or 0) >= .75 and footprint(source.box, peers[0].box) >= .6):
            anchors.append((item, peers[0]))
    rows = []
    for obj in expected:
        source = next(o for o in originals if o.id == obj.id)
        tokens = set(label_key(obj.label).split())
        def label_score(d):
            other = set(label_key(d.label).split())
            return len(tokens & other)/len(tokens | other) if tokens | other else 0
        candidates = [d for d in detections if label_score(d) >= .5]
        evidence = []
        for detection in candidates:
            similarity = color_similarity(before, after, source.box, detection.box)
            x, y = center(detection.box)
            ex, ey = center(obj.box)
            residuals = []
            for anchor, seen in anchors:
                if anchor.id == obj.id:
                    continue
                ax, ay = center(anchor.box)
                sx, sy = center(seen.box)
                residuals.append(hypot((x-sx)-(ex-ax), (y-sy)-(ey-ay)))
            residual = sum(residuals)/len(residuals) if residuals else None
            shape = footprint(source.box, detection.box)
            distance = hypot(x-ex, y-ey)
            score = (.35*label_score(detection) + .3*shape
                     + .15*(similarity if similarity is not None else .5)
                     + .1*max(0, 1-distance) + .05*(detection.confidence or 0)
                     + .05*(max(0, 1-residual) if residual is not None else .5))
            evidence.append({"detection_id": detection.id, "score": round(score, 4),
                             "label_similarity": label_score(detection), "footprint_similarity": round(shape, 4),
                             "appearance_similarity": similarity, "expected_center_distance": round(distance, 4),
                             "spatial_context_error": round(residual, 4) if residual is not None else None})
        evidence.sort(key=lambda e: (-e["score"], e["detection_id"]))
        candidates = [next(d for d in candidates if d.id == e["detection_id"]) for e in evidence]
        duplicate_label = sum(label_key(o.label) == label_key(obj.label) for o in expected) > 1
        detection = candidates[0] if candidates else None
        reasons = []
        similarity = None
        if not detection:
            reasons.append("No detection for this identity; absence is not proof it was removed.")
        else:
            if duplicate_label or len(candidates) != 1:
                reasons.append("Repeated label: identity requires user assignment, even if geometry is close.")
            if label_key(detection.label) != label_key(obj.label):
                reasons.append("Related label only; confirm the identity and label manually.")
            if evidence[0]["score"] < .72:
                reasons.append("Combined matching evidence is below the 0.72 support threshold.")
            if len(evidence) > 1 and evidence[0]["score"] - evidence[1]["score"] < .12:
                reasons.append("Candidate score margin is below 0.12; identity is ambiguous.")
            if detection.confidence is None or detection.confidence < .75:
                reasons.append("Provider confidence is missing or below the 0.75 review threshold.")
            ratios = [detection.box.width/source.box.width, detection.box.height/source.box.height]
            if any(r < .6 or r > 1.6 for r in ratios):
                reasons.append("Footprint size changed substantially; check framing, orientation, and identity.")
            if evidence[0]["footprint_similarity"] < .6:
                reasons.append("Footprint agreement is below 0.60; review size and orientation.")
            similarity = evidence[0]["appearance_similarity"]
            if similarity is not None and similarity < .45:
                reasons.append("Crop colors differ; lighting or identity may have changed.")
            if evidence[0]["spatial_context_error"] is not None and evidence[0]["spatial_context_error"] > .35:
                reasons.append("Placement differs substantially from stationary-anchor context; review framing and identity.")
        rows.append({"object_id": obj.id, "label": obj.label,
                     "detection_id": detection.id if detection else None,
                     "candidate_ids": [d.id for d in candidates],
                     "certainty": "missing" if not detection else "uncertain" if reasons else "supported",
                     "provider_confidence": detection.confidence if detection else None,
                     "appearance_similarity": similarity, "reasons": reasons})
        rows[-1].update(candidate_evidence=evidence, evidence_score=evidence[0]["score"] if evidence else None,
                        score_margin=round(evidence[0]["score"]-evidence[1]["score"], 4) if len(evidence) > 1 else None)
    # Related labels can share candidates. Never promote a many-to-one assignment.
    for row in rows:
        if row["detection_id"] and sum(r["detection_id"] == row["detection_id"] for r in rows) > 1:
            row["certainty"] = "uncertain"
            row["reasons"].append("Detection is proposed for multiple identities; assign distinct objects manually.")
    return rows


def assess_positions(request, original, plan, original_plan, observed, matches, *, framing, inventory, tolerance=.025):
    observed_by_id = {o.id: o for o in observed}
    expected = {o.id: o for o in plan.final_objects}
    baseline = {o.id: o for o in request.objects}
    baseline.update({o.id: o for o in original.objects})
    locked = set(original_plan.locked_ids) | set(plan.locked_ids)
    issues, rows, unexpected = [], [], []
    for match in matches:
        identity = match["object_id"]
        actual = observed_by_id.get(identity)
        tol = min(tolerance, .01) if identity in locked else tolerance
        anchor = baseline.get(identity, expected[identity]) if identity in locked else expected[identity]
        error = edge_error(actual.box, anchor.box) if actual else None
        reliable = match["certainty"] in {"supported", "reviewed"}
        matched = reliable and error is not None and error <= tol + 1e-8
        status = "missing" if actual is None else "uncertain" if not reliable else "completed" if matched else "incomplete"
        moved = actual is not None and identity in baseline and edge_error(actual.box, baseline[identity].box) > (min(tolerance, .01) if identity in locked else tolerance) + 1e-8
        if reliable and moved and (identity in locked or identity not in {s.object_id for s in plan.movements}):
            unexpected.append(identity)
            issues.append(f"{match['label']}: {'protected object moved' if identity in locked else 'unexpected movement'}.")
        rows.append({**match, "status": status, "matched": matched, "edge_error": error, "tolerance": tol, "protected": identity in locked})
    for index, obj in enumerate(observed):
        if not contains(request.workspace, obj.box):
            issues.append(f"{obj.label} is outside the workspace.")
        if overlaps(obj.box, request.target, request.clearance):
            issues.append(f"{obj.label} intrudes into the target or its clearance.")
        for other in observed[:index]:
            if overlaps(obj.box, other.box):
                issues.append(f"{obj.label} overlaps {other.label}.")
    extra = [o.id for o in observed if o.id not in expected]
    uncertain = [r["object_id"] for r in rows if r["certainty"] not in {"supported", "reviewed"}]
    if not framing:
        issues.append("Confirm the same camera framing; coordinates cannot prove camera alignment.")
    if not inventory:
        issues.append("Review the complete scene for missed and new obstacles.")
    review_required = bool(uncertain or not framing or not inventory)
    # Additional detections must be explicitly reviewed, even if outside the target.
    if extra and any(r["certainty"] != "reviewed" for r in rows):
        review_required = True
        issues.append("Additional detections require obstacle/identity review.")
    passed = not review_required and all(r["matched"] for r in rows) and not issues
    steps = [{"number": s.number, "object_id": s.object_id, "status": next(r["status"] for r in rows if r["object_id"] == s.object_id)} for s in plan.movements]
    return {"passed": passed, "status": "needs_review" if review_required else "passed" if passed else "failed",
            "review_required": review_required, "objects": rows, "steps": steps,
            "matched_count": sum(r["matched"] for r in rows), "issues": issues,
            "unexpected_movements": unexpected, "uncertain_ids": uncertain, "additional_detection_ids": extra,
            "goal_achieved": passed, "confidence": "user_reviewed" if all(r["certainty"] == "reviewed" for r in rows) else "supported" if not review_required else "uncertain",
            "message": "Reviewed evidence matches the plan and the target is clear." if passed else "Review uncertain identities and scene coverage." if review_required else "Observed placements differ from the plan; review positions before replanning.",
            "source": "sam_after_photo"}


async def automatic_verify(request, service, planner):
    started = perf_counter()
    original = request.original_request or request.plan_request
    validate_lineage(original, request.plan_request)
    plan, baseline = planner(request.plan_request), planner(original)
    if plan.status not in {"ready", "already_clear"} or baseline.status not in {"ready", "already_clear"}:
        raise ValueError("Generate a feasible plan before automatic verification.")
    # Decode and validate both images before billable inference.
    before, after = appearance_image(request.before_image_url), appearance_image(request.image_url)
    if before is not None and abs((before.width/before.height)/(after.width/after.height)-1) > .02:
        raise ValueError("Use matching before/after aspect ratios and camera framing.")
    concepts = list(dict.fromkeys(label_key(o.label) for o in request.plan_request.objects))
    analysis = await service.analyze(AIAnalysisRequest(image_url=request.image_url, concepts=concepts))
    all_detections = [SceneObject.model_validate(d) for d in analysis["objects"]]
    # The selected usable surface defines the task. Retain boundary-crossing objects for review.
    detections = [d for d in all_detections if overlaps(d.box, request.plan_request.workspace)]
    matches = match_identities(plan.final_objects, request.plan_request.objects, detections, before, after)
    observed, used = [], set()
    for row in matches:
        if row["detection_id"] and row["detection_id"] not in used:
            used.add(row["detection_id"])
            detection = next(d for d in detections if d.id == row["detection_id"])
            observed.append(detection.model_copy(update={"id": row["object_id"]}))
    reserved = {o.id for o in plan.final_objects}
    for detection in detections:
        if detection.id in used:
            continue
        identity = f"extra:{detection.id}"
        while identity in reserved:
            identity += ":new"
        reserved.add(identity)
        observed.append(detection.model_copy(update={"id": identity}))
    result = assess_positions(request.plan_request, original, plan, baseline, observed, matches,
                              framing=request.framing_confirmed, inventory=request.inventory_confirmed, tolerance=request.tolerance)
    result.update(detections=detections, observed_objects=observed, concepts=concepts,
                  excluded_outside_workspace_ids=[d.id for d in all_detections if d not in detections],
                  latency_ms=round((perf_counter()-started)*1000), warnings=analysis["warnings"],
                  provider=analysis.get("provider"), model=analysis.get("model"),
                  inferred_at=analysis.get("inferred_at"), inference_cache=analysis.get("inference_cache"))
    return result


def verify_reviewed(request, planner):
    plan, baseline = planner(request.plan_request), planner(request.original_request)
    if plan.status not in {"ready", "already_clear"}:
        raise ValueError("A feasible current plan is required for verification.")
    matches = [{"object_id": o.id, "label": o.label, "certainty": "reviewed", "detection_id": None,
                "provider_confidence": None, "appearance_similarity": None, "reasons": [], "candidate_ids": []} for o in request.plan_request.objects]
    result = assess_positions(request.plan_request, request.original_request, plan, baseline, request.observed_objects, matches,
                              framing=True, inventory=True, tolerance=request.tolerance)
    result["source"] = "reviewed_final_annotations"
    return result


def adaptive_replan(request, planner):
    original_plan = planner(request.original_request)
    previous = planner(request.plan_request)
    if original_plan.status not in {"ready", "already_clear"} or previous.status not in {"ready", "already_clear"}:
        raise ValueError("A feasible original and current plan are required before replanning.")
    locked = set(original_plan.locked_ids) | set(previous.locked_ids)
    by_id = {o.id: o for o in request.observed_objects}
    anchors = {o.id: o for o in request.plan_request.objects}
    anchors.update({o.id: o for o in request.original_request.objects})
    violations = [o.label for o in anchors.values() if o.id in locked and edge_error(o.box, by_id[o.id].box) > .01 + 1e-8]
    if violations:
        return {"status": "blocked", "reasons": ["Protected objects moved: " + ", ".join(violations) + ". Restore their original positions before replanning."], "original_plan": original_plan, "previous_plan": previous, "revised_plan": None, "plan_request": None}
    # Preserve the original protective anchors, never relock a displaced object at a new position.
    objects = [o.model_copy(update={"locked": o.locked or o.id in locked, "source": "ai_corrected", "confidence": None}) for o in request.observed_objects]
    current = request.original_request.model_copy(update={"objects": objects})
    current = PlanRequest.model_validate(current.model_dump())
    revised = planner(current)
    assessment = verify_reviewed(request, planner)
    reasons = [f"{r['label']}: {r['status']} placement." for r in assessment["objects"] if not r["matched"]]
    reasons.extend(assessment["issues"])
    if len(objects) > len(request.plan_request.objects):
        reasons.append("Additional reviewed obstacles were included in the current scene.")
    return {"status": revised.status, "reasons": reasons or ["Reviewed current state; target already satisfies the original constraints."],
            "original_plan": original_plan, "previous_plan": previous, "revised_plan": revised, "plan_request": current}
