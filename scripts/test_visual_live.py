"""Explicit live negative control: unchanged desk photo must not complete a phone movement."""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import httpx
from backend.imaging import prepare_image


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", default="artifacts/real-desk/jakub-desk.jpg")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--output", default="artifacts/real-desk/verification-report.json")
    parser.add_argument("--live", action="store_true", required=True)
    args = parser.parse_args()
    reference = json.loads((Path(__file__).resolve().parents[1] / "docs/vision-fixtures/jakub-reference.json").read_text())
    objects = [o for o in reference["objects"] if o["id"] in {"phone", "mouse"}]
    objects[1]["locked"] = True
    request = {"objects": objects, "goal": "Clear the phone region without moving mouse", "target": {"x": .435, "y": .645, "width": .08, "height": .22},
               "workspace": {"x": .43, "y": .64, "width": .44, "height": .35}, "clearance": .008}
    image = prepare_image(Path(args.image).read_bytes())
    with httpx.Client(base_url=args.base_url, timeout=135) as client:
        plan = client.post("/api/plan", json=request)
        plan.raise_for_status()
        if plan.json()["status"] != "ready":
            raise ValueError("Negative control requires a feasible movement plan.")
        response = client.post("/api/ai/verify", json={"plan_request": request, "original_request": request, "image_url": image["image_url"], "before_image_url": image["image_url"], "framing_confirmed": True, "inventory_confirmed": True})
        response.raise_for_status()
    result = response.json()
    report = {"control": "Same unmodified real photograph before/after; phone has NOT been moved. Scoped workspace excludes other desk objects.", "plan_request": request, "plan": plan.json(), "verification": result}
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    Path(args.output).write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({"passed": result["passed"], "status": result["status"], "steps": result["steps"], "latency_ms": result["latency_ms"], "issues": result["issues"]}))
    # Uncertainty is acceptable; declaring completed work is not.
    if result["passed"]:
        sys.exit("Negative control failed: unfinished movement was incorrectly accepted.")
