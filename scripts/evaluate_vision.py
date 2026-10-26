"""Explicit, potentially billable real-photo benchmark. Never loads credentials in frontend."""
import argparse
import asyncio
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from time import perf_counter

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dotenv import load_dotenv
from backend.ai_service import AIService
from backend.evaluation import evaluate_detections
from backend.imaging import prepare_image
from backend.models import AIAnalysisRequest, SceneObject
from backend.providers import AISettings, ProviderError, ProviderHTTP


async def evaluate(args):
    manifest_path = Path(args.manifest).resolve()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
    # Validate the entire manifest before making any billable requests.
    cases = []
    for entry in manifest["cases"]:
        path = (manifest_path.parent / entry["image"]).resolve()
        raw = path.read_bytes()
        image = prepare_image(raw)
        reference_path = (manifest_path.parent / entry["reference"]).resolve() if entry.get("reference") else None
        reference_data = json.loads(reference_path.read_text(encoding="utf-8-sig")) if reference_path else None
        refs = None
        if reference_data is not None:
            # The UI's Download plan JSON includes the reviewed planning inventory.
            refs = [SceneObject.model_validate(o) for o in reference_data.get("objects", reference_data.get("request", {}).get("objects", []))]
            if not refs:
                raise ValueError("Reference file must contain a nonempty objects or request.objects list.")
        cases.append((entry, image, hashlib.sha256(raw).hexdigest(), refs))
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
    service = AIService(ProviderHTTP(AISettings.from_env()))
    report = {"recorded_at": datetime.now(timezone.utc).isoformat(), "fixture_type": "real photographs, declared by manifest author",
              "reference_warning": "References must be independently reviewed. Metrics cover declared concepts only, not complete-scene accuracy.", "cases": []}
    for entry, image, digest, refs in cases:
        started = perf_counter()
        row = {"name": entry["name"], "source": entry.get("source"), "image_sha256": digest,
               "width": image["width"], "height": image["height"], "concepts": entry["concepts"],
               "reference_provenance": entry.get("reference_provenance"), "metrics": None}
        try:
            result = await service.analyze(AIAnalysisRequest(image_url=image["image_url"], concepts=entry["concepts"]))
            objects = [SceneObject.model_validate(o) for o in result["objects"]]
            row.update(status="success", objects=[o.model_dump() for o in objects], concept_latency_ms=result["concept_latency_ms"], warnings=result["warnings"])
            if refs is not None:
                row["metrics"] = evaluate_detections(objects, refs, reference_complete=entry.get("reference_complete", False))
        except ProviderError as error:
            row.update(status="provider_error", error_code=error.code, provider_http_status=error.http_status)
        row["latency_ms"] = round((perf_counter()-started)*1000)
        report["cases"].append(row)
        Path(args.output).parent.mkdir(parents=True, exist_ok=True)
        Path(args.output).write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(json.dumps({"case": row["name"], "status": row["status"], "latency_ms": row["latency_ms"], "detections": len(row.get("objects", [])), "metrics": row["metrics"]}))
    return 1 if any(c["status"] != "success" for c in report["cases"]) else 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--output", default="artifacts/vision-evaluation.json")
    parser.add_argument("--live", action="store_true", required=True, help="Explicitly authorize provider calls for this run.")
    arguments = parser.parse_args()
    try:
        sys.exit(asyncio.run(evaluate(arguments)))
    except (ValueError, OSError, KeyError):
        print("Invalid benchmark configuration or unreadable input. Check manifest, references, and backend settings.", file=sys.stderr)
        sys.exit(2)
