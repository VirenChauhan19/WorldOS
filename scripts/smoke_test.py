"""Exercise the built frontend and API over real HTTP, with an owned temporary server."""
import io
import os
import socket
import subprocess
import sys
import time
from pathlib import Path

import httpx
from PIL import Image
from smoke_process import stop_server

ROOT = Path(__file__).resolve().parents[1]
if not (ROOT / "dist" / "index.html").exists():
    raise SystemExit("Run npm run build first.")

with socket.socket() as sock:
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]

environment = {**os.environ, "MODEL_API_KEY": "", "BASETEN_API_KEY": "", "WORLDOS_SAM_PROVIDER": "baseten"}
environment.update(WORLDOS_DEPLOYMENT='local', WORLDOS_AUTH_PASSWORD_HASH='', WORLDOS_ALLOWED_HOSTS='localhost,127.0.0.1', WORLDOS_CORS_ORIGINS='http://localhost:5173')
environment.update(WORLDOS_JUDGE_PASSWORD_HASH='', WORLDOS_JUDGE_ACCESS_EXPIRES_AT='')
process = subprocess.Popen([sys.executable, "-m", "uvicorn", "backend.main:app", "--host", "127.0.0.1", "--port", str(port)], cwd=ROOT, env=environment, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    with httpx.Client(base_url=f"http://127.0.0.1:{port}", timeout=10, trust_env=False) as client:
        for attempt in range(100):
            if process.poll() is not None:
                raise RuntimeError("Temporary API server failed to start.")
            try:
                if client.get("/api/health").status_code == 200:
                    break
            except httpx.ConnectError:
                pass
            time.sleep(.1)
        else:
            raise RuntimeError("Temporary API server did not become ready.")
        page = client.get("/")
        assert page.status_code == 200 and "WorldOS" in page.text
        assert client.get("/sample-desk.svg").status_code == 200
        schema = client.get("/openapi.json")
        assert schema.status_code == 200 and schema.json()["info"]["version"] == "1.1.0"
        status = client.get("/api/health").json()
        assert status["ai"]["sam"]["status"] == "blocked_deployment_contract"
        diagnostics = client.get("/api/ai/diagnostics")
        assert diagnostics.status_code == 200 and diagnostics.headers["cache-control"] == "no-store"
        assert not diagnostics.json()["credentials"]["meta_api_key_configured"]
        assert diagnostics.json()["integrations"]["muse"]["last_test"]["status"] == "not_tested"
        assert diagnostics.json()["integrations"]["muse"]["readiness"]["status"] == "blocked"
        environment_status = diagnostics.json()["environment"]
        assert environment_status["variables"]["MODEL_API_KEY"]["state"] == "empty"
        assert environment_status["variables"]["MODEL_API_KEY"]["source"] == "process_environment"
        assert not environment_status["restart_required"]
        tested = client.post("/api/ai/connection-test", json={"integration": "muse"})
        assert tested.status_code == 200
        assert tested.json()["integrations"]["muse"]["last_test"]["status"] == "missing_credentials"
        assert not tested.json()["integrations"]["muse"]["last_test"]["ever_live_request_succeeded"]
        blocked = client.post("/api/ai/analyze", json={"image_url": "not-an-image", "concepts": ["book"]})
        assert blocked.status_code == 503 and "contract" in blocked.json()["detail"]
        data = io.BytesIO()
        Image.new("RGB", (1000, 700), "#75856a").save(data, "PNG")
        analyzed = client.post("/api/analyze", files={"image": ("scene.png", data.getvalue(), "image/png")})
        assert analyzed.status_code == 200, analyzed.text
        assert analyzed.json()["annotation_source"] == "manual"
        assert analyzed.json()["objects"] == []
        request = {"goal": "Make room without moving coffee", "target": {"x": .3, "y": .3, "width": .4, "height": .4},
                   "objects": [{"id": "book", "label": "Book", "box": {"x": .4, "y": .4, "width": .15, "height": .2}},
                               {"id": "coffee", "label": "Coffee", "box": {"x": .8, "y": .1, "width": .1, "height": .1}, "locked": True}]}
        planned = client.post("/api/plan", json=request)
        assert planned.status_code == 200, planned.text
        assert planned.json()["status"] == "ready"
        assert len(planned.json()["movements"]) == 1
        verified = client.post("/api/verify", json={"plan_request": request, "observed_objects": planned.json()["final_objects"]})
        assert verified.status_code == 200 and verified.json()["passed"], verified.text
        unchanged = client.post("/api/verify", json={"plan_request": request, "observed_objects": request["objects"]})
        assert unchanged.status_code == 200 and not unchanged.json()["passed"]
        reviewed_body = {"original_request": request, "plan_request": request,
                         "observed_objects": planned.json()["final_objects"], "reviewed_ids": ["book", "coffee"],
                         "framing_confirmed": True, "inventory_confirmed": True}
        reviewed = client.post("/api/verify/reviewed", json=reviewed_body)
        assert reviewed.status_code == 200 and reviewed.json()["passed"]
        assert reviewed.json()["source"] == "reviewed_final_annotations"
        revised = client.post("/api/replan", json=reviewed_body)
        assert revised.status_code == 200 and revised.json()["status"] == "already_clear"
        reviewed_body["observed_objects"][1]["box"]["x"] = .75
        displaced = client.post("/api/replan", json=reviewed_body)
        assert displaced.status_code == 200 and displaced.json()["status"] == "blocked"
        assert displaced.json()["revised_plan"] is None
        request["objects"][0]["locked"] = True
        impossible = client.post("/api/plan", json=request)
        assert impossible.json()["status"] == "impossible"
        invalid = client.post("/api/analyze", files={"image": ("bad.png", b"not image bytes", "image/png")})
        assert invalid.status_code == 415
        print("PASS: V1.1 production frontend/assets, OpenAPI version, real PNG upload, manual and reviewed verification, adaptive replanning, protected-anchor blocking, locked conflict, invalid image, honest AI configuration, connection diagnostics, missing-key test, and Baseten blocker. No external model calls.")
finally:
    stop_server(process)
