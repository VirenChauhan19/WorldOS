# WorldOS V0.6 — restored Meta SAM and live photo pipeline

## Result, October 26, 2026

**Meta SAM 3.1 live detection succeeded. Baseten Muse Spark remains the preferred reasoning provider and passed live multimodal goal interpretation and Inspect explanation.** The final integration run generated and checked a collision-aware plan and reopened saved Inspect evidence successfully. This was a real-photo inference-to-planning check, **not a physically executed correction or before/after accuracy evaluation**.

Only `MODEL_API_KEY` and `WORLDOS_SAM_PROVIDER=meta` were set in the existing root `.env`; all other lines, including Baseten settings, were preserved. The credential was entered through hidden stdin, not placed in a shell argument. `.env` is ignored and untracked. A fresh HTTP backend process confirmed both credentials load from root `.env` and Baseten is preferred. No unrelated data or existing database was replaced.

The configured contract matches Meta's current official documentation:

- Endpoint: `https://api.meta.ai/v1/responses`; model: `sam-3.1`; one noun phrase and one image per request. [SAM overview](https://dev.meta.ai/docs/sam/overview)
- Confidence is requested with string metadata `include_confidence: "true"`; readers still accept absent confidence. [Prompting and confidence](https://dev.meta.ai/docs/sam/segmenting)
- Pixel boxes use inclusive endpoints. WorldOS checks source dimensions and bounds, then normalizes `(x1 / w, y1 / h, (x2-x1+1) / w, (y2-y1+1) / h)`. [Segmentation output](https://dev.meta.ai/docs/sam/reading-segmentation)

## Genuine input and review provenance

The input was [Jakub Żerdzicki's actual overhead desk photograph](https://unsplash.com/photos/a-desk-with-a-laptop-keyboard-mouse-and-a-cell-phone-ElFBCgOfoIM), published June 3, 2024 and available under the Unsplash License. It was already referenced in this repository's evaluation manifest and downloaded unchanged to `artifacts/real-desk/jakub-desk.jpg` (1600 × 1067). Original-file SHA-256: `d8bde0e5c754d490389110474ac304974024425f551d4a6535d86522416b777f`.

SAM returned **three detections across two requested concepts**, all with validated normalized bounds and provider-supplied confidence:

| Detection | Normalized x, y, width, height (rounded here) | Provider confidence | Review |
| --- | --- | ---: | --- |
| Smartphone | 0.437500, 0.649485, 0.068750, 0.209934 | 0.953216 | Retained unchanged |
| Partial mouse at right edge | 0.980625, 0.543580, 0.019375, 0.086223 | 0.843902 | Outside the declared workspace; not called a false positive |
| Central mouse | 0.554375, 0.740394, 0.083125, 0.173383 | 0.968750 | Retained unchanged and protected |

The agent visually reviewed the photo and these boxes. The lower desk workspace was restricted to `(0.43, 0.64, 0.44, 0.35)` to exclude the laptop, keyboards, monitor supports, tablet, and edge mouse. The selected goal was to clear the phone's target region while keeping the central mouse stationary. This scope selection and protection choice are **agent assistance**, not independent human ground truth or a fully automatic inventory. No boxes were edited. Confidence is a provider output, not a measured accuracy percentage.

## Actual timings and usage

The initial detection run used two concurrent SAM requests. Later Inspect calls used the actual aligned image path, not mocked responses or injected cached results. These are individual observations, not a latency benchmark.

| Operation | Observed latency | Reported tokens |
| --- | ---: | ---: |
| Initial SAM smartphone request, including adapter work | 1,474 ms | Not retained by the original evaluator |
| Initial SAM mouse request, including adapter work | 1,917 ms | Not retained by the original evaluator |
| Initial two-concept scan wall time | 2,115 ms | — |
| Final Baseten goal interpretation, with real photo | 7,718 ms | 2,919 prompt + 548 completion = **3,467** |
| Final Inspect SAM requests | 1,812 ms / 2,516 ms | Provider reported 0 input/output/total tokens |
| Final Inspect inference wall time | 2,682 ms | — |
| Final Baseten Inspect explanation | 5,047 ms | 1,241 prompt + 1,388 completion = **2,629** |

The final run used **6,096 Baseten tokens**. Across this investigation, including the earlier run and explicit explanation retries, there were **six SAM requests and six Baseten requests**, with **18,091 Baseten tokens reported**. SAM is billed per image, so its zero token counters do not imply free requests. No credit balance or dollar cost was measured. [Meta billing model](https://dev.meta.ai/docs/pricing-rate-limits)

## What passed, and the failure that was fixed

- Baseten returned valid structured constraints protecting the actual central mouse identity. There was no provider fallback.
- The deterministic planner produced **one smartphone movement**: top-left destination `(0.6455, 0.6450)`, unchanged footprint and orientation. Validation walked the movement order and checked workspace containment, target clearance, collision clearance, final scene consistency, and protected-object preservation. The instruction was to lift and place the phone; no travel-path, reach, height, or stability validation is claimed.
- A geometric check of the proposed final boxes passed. The unchanged original annotations correctly failed completion. **Neither check is a fresh photographed physical verification.**
- Inspect used live Meta SAM on the same unmodified photograph. It classified both in-scope reference objects as correctly placed, but retained `needs_review` and `passed=false` because inventory was not human-confirmed. Its correction plan remained blocked. No human confirmation was invented to obtain a green result.
- A live Baseten explanation described those actual findings and the review requirement. Images, detections, decisions, explanation, and blocked automatic plan were saved in the isolated `artifacts/live-pipeline-20261026-final/worldos-live.sqlite3` database and reopened successfully. No physical evaluation trial was created.
- The first explanation failed strict validation. An explicit explanation-only retry reproduced the failure: Baseten added a JSON-schema `$defs` field to its answer. The prompt now inlines nested schema references and explicitly requests a data instance with only the allowed root fields. **Validation remains strict**; unknown fields, schema echoes, and invented identities are still rejected. Both a targeted live retry and the subsequent complete run passed after this fix. All earlier failures remain in the evidence.

Automatic Inspect decisions and agent review are recorded separately. There was **no independently human-assisted final verification** and **zero physically completed trials**. Real-world precision, recall, false-alarm rates, movement verification accuracy, and task success rates remain unmeasured.

## Evidence and reproducibility

The [sanitized evidence report](sam-restoration-live-results.json) retains actual detections, constraints, movements, Inspect decisions, the successful explanation, timestamps, usage, and earlier failed attempts. Full local artifacts include:

- `artifacts/real-desk/sam-restoration-detections.json` and `sam-restoration-review.json`.
- `artifacts/live-pipeline-20261026/`: first run, failed retry, successful post-fix retry, and isolated database.
- `artifacts/live-pipeline-20261026-final/`: final complete run, isolated database, and fresh-backend HTTP configuration check.

To repeat on the same available real photo, from the repository root in PowerShell:

```powershell
# Only downloads/caches the public photos; no inference.
.\.venv\Scripts\python.exe scripts\download_desk_photos.py

# Two paid Meta requests. Use a new result filename for each attempt.
.\.venv\Scripts\python.exe scripts\evaluate_vision.py --manifest artifacts\real-desk\sam-restoration-manifest.json --output artifacts\real-desk\sam-repeat.json --live

# Visually review the NEW detections first. Update the review file with their
# actual IDs, scope, protection choices, actor, and notes. Do not copy IDs blindly.
# This makes new paid Baseten and Inspect SAM requests; use a NEW output folder.
.\.venv\Scripts\python.exe scripts\verify_photo_pipeline.py --image artifacts\real-desk\jakub-desk.jpg --detections artifacts\real-desk\sam-repeat.json --review artifacts\real-desk\sam-restoration-review.json --output-dir artifacts\live-pipeline-repeat-1 --live
```

For a fresh clone without ignored artifacts, first download the photo, create a one-case evaluator manifest using its local path and concepts `smartphone` / `mouse` (no ground-truth reference), and create the review JSON using the `review` structure in the evidence report **after** visually checking the new detections. The runner verifies the photograph's hash, actual selected identities, and excluded-object scope before any provider call. It refuses to overwrite a previous report.

Start the normal application:

```powershell
npm.cmd run build
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Open `http://127.0.0.1:8000`. Connection history is process-local: a fresh server correctly shows configured/unverified until a live call occurs in that process. The saved report is historical evidence, not a fabricated current connection indicator. Only explicitly requesting inference spends credits.

## Final validation and demo blockers

- **269 backend tests passed; 2 optional live pytest tests skipped.** Live calls above were performed separately with explicit opt-in.
- **80 frontend tests passed.** Production build passed.
- Both HTTP smoke suites passed, preserving manual annotation, planning, manual/reviewed verification, Inspect CRUD, alignment gates, review, and SQLite restart persistence. Those smoke provider responses are explicitly mocked.
- A fresh actual-config HTTP process loaded Meta and Baseten correctly, served the production application, and returned safe diagnostics without extra provider calls.

Remaining: capture your own reference photo, physically displaced inspection photo, and fresh corrected photo after following the plan. Independently label them and record the trial using [the guided evaluation checklist](DEMO_READINESS.md). Test camera alignment, missed objects, duplicates, and recovery on the demonstration workspace. Automatic unexpected-class discovery and live Meta reasoning fallback were not exercised here. Hosted access protection/persistent deployment and venue-network rehearsal remain separate checks. The current planner validates 2D lift/place footprints, not full physical safety.
