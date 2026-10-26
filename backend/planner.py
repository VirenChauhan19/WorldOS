"""Deterministic bounded relocation search in normalized, axis-aligned 2D space."""
from itertools import product
from math import hypot

from .adapters import RuleBasedReasoning
from .models import Box, Movement, PlanRequest, PlanResponse, SceneObject

EPS = 1e-8
MAX_STATES = 2500
MAX_CHECKS = 180000


def overlaps(a: Box, b: Box, gap: float = 0) -> bool:
    return (a.x < b.x + b.width + gap - EPS and a.x + a.width + gap > b.x + EPS
            and a.y < b.y + b.height + gap - EPS and a.y + a.height + gap > b.y + EPS)


def contains(outer: Box, inner: Box) -> bool:
    return (inner.x >= outer.x - EPS and inner.y >= outer.y - EPS
            and inner.x + inner.width <= outer.x + outer.width + EPS
            and inner.y + inner.height <= outer.y + outer.height + EPS)


def validate_scene(req: PlanRequest):
    if not contains(req.workspace, req.target):
        raise ValueError("The target must be inside the workspace.")
    for i, obj in enumerate(req.objects):
        if not contains(req.workspace, obj.box):
            raise ValueError(f"{obj.label} must be inside the workspace. Adjust its box or the workspace.")
        for other in req.objects[:i]:
            if overlaps(obj.box, other.box):
                raise ValueError(f"Annotations overlap: {obj.label} and {other.label}. Refine their boxes before planning.")


def candidates(box: Box, obstacles: list[Box], workspace: Box, gap: float):
    # Edge contacts plus a coarse grid. No randomness; stable distance ordering.
    xs = {workspace.x, workspace.x + workspace.width - box.width}
    ys = {workspace.y, workspace.y + workspace.height - box.height}
    for other in obstacles:
        xs.update((other.x - box.width - gap, other.x + other.width + gap, other.x))
        ys.update((other.y - box.height - gap, other.y + other.height + gap, other.y))
    xs.update(workspace.x + (workspace.width - box.width) * i / 10 for i in range(11))
    ys.update(workspace.y + (workspace.height - box.height) * i / 10 for i in range(11))
    positions = [(round(x, 8), round(y, 8)) for x, y in product(xs, ys)
                 if x >= workspace.x - EPS and y >= workspace.y - EPS
                 and x + box.width <= workspace.x + workspace.width + EPS
                 and y + box.height <= workspace.y + workspace.height + EPS]
    return sorted(set(positions), key=lambda p: (hypot(p[0] - box.x, p[1] - box.y), p))


def generate_plan(req: PlanRequest) -> PlanResponse:
    validate_scene(req)
    locked = RuleBasedReasoning().locked_ids(req.goal, req.objects)
    initial = {obj.id: obj.box for obj in req.objects}
    warnings = ["Manual annotations; no AI vision is connected.",
                "Lift objects to move them. Only final 2D footprints are checked; height, reach, stability, and travel paths are not modeled.",
                "The selected target defines the cleared space. Goal text only supports label-based keep / do not move / without moving constraints; review all locks."]

    def response(status, message, boxes=None, steps=None, explored=0):
        return PlanResponse(status=status, message=message,
                            final_objects=[obj.model_copy(update={"box": (boxes or initial)[obj.id], "locked": obj.id in locked}) for obj in req.objects],
                            locked_ids=sorted(locked), movements=steps or [], warnings=warnings, explored_states=explored)

    blockers = [obj for obj in req.objects if overlaps(obj.box, req.target, req.clearance)]
    protected = [obj.label for obj in blockers if obj.id in locked]
    if protected:
        return response("impossible", f"Target intersects protected object(s): {', '.join(protected)}. Move the target or explicitly change the lock / goal.")
    if not blockers:
        return response("already_clear", "Your target is already clear. No objects need to move.")
    area = sum(obj.box.width * obj.box.height for obj in req.objects)
    if area + req.target.width * req.target.height > req.workspace.width * req.workspace.height + EPS:
        return response("impossible", "The workspace does not have enough area for all objects and the target. Reduce the target or enlarge the workspace.")
    for obj in blockers:
        # If no side of the target can fit this rectangle, even an empty workspace cannot help.
        w, t, b = req.workspace, req.target, obj.box
        if not ((b.width <= t.x - w.x - req.clearance + EPS)
                or (b.width <= w.x + w.width - t.x - t.width - req.clearance + EPS)
                or (b.height <= t.y - w.y - req.clearance + EPS)
                or (b.height <= w.y + w.height - t.y - t.height - req.clearance + EPS)):
            return response("impossible", f"{obj.label} cannot fit on any side of the target without rotating. Resize the target.")

    explored = 0
    checks = 0
    seen = set()

    def search(boxes: dict[str, Box], moved: frozenset[str], steps: list[Movement]):
        nonlocal explored, checks
        if explored >= MAX_STATES or checks >= MAX_CHECKS:
            return None
        blocking = {key for key, box in boxes.items() if overlaps(box, req.target, req.clearance)}
        if not blocking:
            return boxes, steps
        state = (tuple((key, round(box.x, 7), round(box.y, 7)) for key, box in boxes.items()), moved)
        if state in seen:
            return None
        seen.add(state)
        explored += 1
        movable = sorted((o for o in req.objects if o.id not in locked | moved),
                         key=lambda o: (o.id not in blocking, -o.box.width * o.box.height, o.id))
        for obj in movable:
            obstacles = [b for key, b in boxes.items() if key != obj.id] + [req.target]
            for x, y in candidates(boxes[obj.id], obstacles, req.workspace, req.clearance):
                checks += 1
                if checks >= MAX_CHECKS or explored >= MAX_STATES:
                    return None
                destination = Box(x=max(0, x), y=max(0, y), width=obj.box.width, height=obj.box.height)
                if not contains(req.workspace, destination) or any(overlaps(destination, other, req.clearance) for other in obstacles):
                    continue
                if hypot(x - boxes[obj.id].x, y - boxes[obj.id].y) < EPS:
                    continue
                step = Movement(number=len(steps) + 1, object_id=obj.id, label=obj.label,
                                source=boxes[obj.id], destination=destination,
                                instruction=f"Lift {obj.label} and place its top-left corner at {x:.1%} across, {y:.1%} down the image. Keep its orientation.")
                found = search({**boxes, obj.id: destination}, moved | {obj.id}, steps + [step])
                if found:
                    return found
        return None

    result = search(initial, frozenset(), [])
    if result:
        boxes, steps = result
        return response("ready", f"A collision-free layout is ready in {len(steps)} movement{'s' if len(steps) != 1 else ''}.", boxes, steps, explored)
    return response("search_limit", "No plan found in the bounded search. This is not proof of impossibility. Try a smaller target, fewer objects, or more workspace. Temporary staging and rotation are not supported.", explored=explored)


def verify_positions(req, plan: PlanResponse):
    expected = {obj.id: obj for obj in plan.final_objects}
    observed = {obj.id: obj for obj in req.observed_objects}
    if set(expected) != set(observed):
        raise ValueError("Final annotations must contain exactly the original object IDs.")
    results = []
    issues = []
    for key, obj in expected.items():
        actual = observed[key].box
        goal = obj.box
        # Max edge difference checks size as well as position; centers alone are insufficient.
        error = max(abs(actual.x - goal.x), abs(actual.y - goal.y),
                    abs(actual.x + actual.width - goal.x - goal.width),
                    abs(actual.y + actual.height - goal.y - goal.height))
        # Protected objects get a tighter tolerance than ordinary placements.
        tolerance = min(req.tolerance, 0.01) if key in plan.locked_ids else req.tolerance
        matched = error <= tolerance + EPS
        results.append({"object_id": key, "label": obj.label, "matched": matched, "edge_error": round(error, 6), "tolerance": tolerance})
        if not contains(req.plan_request.workspace, actual):
            issues.append(f"{obj.label} is outside the workspace.")
        if overlaps(actual, req.plan_request.target, req.plan_request.clearance):
            issues.append(f"{obj.label} intrudes into the target or its clearance.")
    for i, obj in enumerate(req.observed_objects):
        for other in req.observed_objects[:i]:
            if overlaps(obj.box, other.box):
                issues.append(f"{obj.label} overlaps {other.label}.")
    passed = all(row["matched"] for row in results) and not issues
    return {"passed": passed, "objects": results, "issues": issues,
            "message": "Final annotations match the plan and the target is clear." if passed else "Some placements need attention. Review the highlighted results.",
            "source": "manual_final_annotations", "matched_count": sum(row["matched"] for row in results)}
