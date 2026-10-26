"""Create clearly labeled, reproducible image fixtures for manual end-to-end QA.

Run from the repository root: .venv/Scripts/python.exe scripts/create_test_scene.py
The after fixture is rendered from a real deterministic plan, not an AI image.
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.models import PlanRequest
from backend.planner import generate_plan

ROOT = Path(__file__).resolve().parents[1]
request = PlanRequest.model_validate({
    "goal": "Make room without moving coffee",
    "target": {"x": .3, "y": .3, "width": .4, "height": .4},
    "objects": [
        {"id": "book", "label": "Book", "box": {"x": .4, "y": .4, "width": .15, "height": .2}},
        {"id": "coffee", "label": "Coffee", "box": {"x": .8, "y": .1, "width": .1, "height": .1}, "locked": True},
    ],
})
plan = generate_plan(request)
out = ROOT / "artifacts" / "qa"
out.mkdir(parents=True, exist_ok=True)
for name, objects in [("before", request.objects), ("after", plan.final_objects)]:
    image = Image.new("RGB", (1000, 700), "#a99f8d")
    draw = ImageDraw.Draw(image)
    draw.text((25, 20), f"WorldOS / {name.upper()} / QA fixture (programmatically drawn)", fill="#333d2a")
    for item in objects:
        box = item.box
        bounds = (round(box.x * 1000), round(box.y * 700), round((box.x + box.width) * 1000), round((box.y + box.height) * 700))
        draw.rectangle(bounds, fill="#607653" if item.id == "book" else "#513d2e", outline="#25311e", width=2)
        draw.text((bounds[0] + 10, bounds[1] + 10), item.label, fill="#eef0df")
    image.save(out / f"{name}.png")
(out / "reference.json").write_text(json.dumps({"request": request.model_dump(), "plan": plan.model_dump()}, indent=2), encoding="utf-8")
print(f"Created QA images and reference at {out}")
