# WorldOS V0.5 — Inspect

WorldOS Inspect compares a photographed workspace against a reviewed reference, explains differences, and calculates ordered movements back to the reference. The previous desk planner, Demo Mode, automatic verification, and adaptive replanning remain available under **Spatial Studio**. Switching product views preserves both in-memory sessions.

For the current guided capture/label/evaluate workflow, API-failure recovery, database backup, readiness checklist, and exact submission sequence, use the [demo preparation guide](DEMO_READINESS.md). The file-based benchmark below remains available as a separate workflow.

## Exact startup commands

Run from the repository root in Windows PowerShell. Use Python 3.12+ and Node 24 (or supported Node 22.13+). The commands use `npm.cmd` to avoid PowerShell script-policy issues.

```powershell
Set-Location C:\Users\chauh\OneDrive\Documents\GitHub\WorldOS

# First-time setup only; reuse an existing virtual environment.
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
npm.cmd ci

# Only if no backend .env exists; never overwrite existing credentials.
if (-not (Test-Path .env)) { Copy-Item .env.example .env }

# Production frontend served by FastAPI
npm.cmd run build
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Open http://127.0.0.1:8000. The API documentation is at http://127.0.0.1:8000/docs. For development, run the backend with `--reload`, then `npm.cmd run dev` in another terminal and open http://127.0.0.1:5173.

Configure backend `.env` using [First inference](FIRST_INFERENCE.md):

```dotenv
MODEL_API_KEY=your_meta_key
WORLDOS_SAM_PROVIDER=meta
WORLDOS_MUSE_MODEL=muse-spark-1.3
WORLDOS_AI_TIMEOUT_SECONDS=45
# Optional stable absolute directory; default is repository data/
# WORLDOS_DATA_DIR=C:/WorldOSData
```

Keys remain backend-only. Never use a `VITE_` credential. Inspect reuses the existing documented Meta adapters and credential diagnostics. Baseten still needs its deployment-specific verified SAM contract. A connection probe verifies connectivity, not real workspace accuracy. Upload, alignment, review, and correction planning make no model calls; explicit Meta analysis/inspection/explanation actions can consume credits.

## Create the first template

1. Fix the camera above a flat working surface. Arrange the workspace correctly. Use distinct objects with visible footprints and leave space between them. Take a genuine reference photograph.
2. Open **WorldOS Inspect → New template**. Enter the workspace name, location, and purpose. Click **Upload reference photo**.
3. Enter comma-separated short noun phrases under **Object concepts**, then click **Identify with Meta AI**. Leaving concepts blank asks Muse Spark to discover concepts before SAM segmentation. Re-running replaces the reference boxes. Manual drawing is also supported and is clearly labelled.
4. Review every returned label, box, and actual SAM confidence. Draw missed objects, remove false detections, and refine boxes by dragging/resizing or numeric coordinates. Define the usable surface with **Draw boundary**. Boxes must fit the boundary without overlap and with the template's 0.5% default clearance.
5. Set **Required** for objects that must be present. Optional objects may be unseen/absent, but if present they must still be correctly identified and positioned. Mark **Protected** objects that WorldOS must never instruct the user to move. Set placement tolerance per object (0.5–10% maximum box-edge error). Protection caps the effective tolerance at 1%.
6. Confirm **I reviewed every identity…**, then **Save workspace template**. Restart the app to check that the workspace and its image remain in the library. Existing templates support **Edit template** and a two-step **Delete template and history** action. Editing creates a new template revision; deletion also deletes its stored inspections and photos.

The template reference can represent a packing station, tool bench, repeatable task layout, or desk. This version models one flat surface and up to twelve axis-aligned object footprints. A wide warehouse photograph with stacked inventory and strong perspective is outside the validated geometry model; use a near-overhead view of a bounded work area.

## Run a complete inspection and correction

1. Select the saved workspace. Under **Scan Workspace**, upload a separate inspection photo.
2. Use the transparent reference overlay to align stationary surface features. Adjust horizontal/vertical translation, scale, and rotation. **Suggest alignment** uses static-background ORB features and a RANSAC similarity fit; weak or spatially concentrated matches are rejected. A suggestion never checks the confirmation for you. **Check coverage** previews workspace coverage without inference.
3. Check surface edges/corners across the entire image, then confirm alignment. Position comparison is blocked unless alignment is explicitly confirmed and at least 98% of the reference workspace is covered. Large aspect-ratio/framing changes produce warnings. If perspective or object depth prevents agreement, retake the photo; similarity alignment is not perspective registration.
4. Keep **Discover unexpected object types** enabled for broad inventory discovery, or supply extra noun phrases and inspect the inventory yourself. Every reference label is always included. SAM cannot discover unprompted classes on its own. Inspect all visible obstacles and use the inventory checkbox when appropriate.
5. Click **Inspect workspace**. The app aligns the actual photograph into the reference frame, then performs concept discovery (if selected) and SAM analysis. No synthesized after-image is used. The result shows comparison photos, object boxes, severity, actual provider confidence when supplied, issue counts, and timings. Correct, misplaced, protected-moved, suspected-missing, uncertain, and unexpected observations remain distinct.
6. For uncertainty, choose a distinct observed identity for each reference object and explicitly confirm it. If the object is visible but undetected, draw/refine its current box and assign it. Choose **I checked: this object is absent** only after physically checking; confirm that identity as absent. This changes *suspected missing* to *confirmed missing* through human review, never through detector failure. Confirm false positives individually before ignoring them. Check the complete current inventory, then **Apply reviewed inspection**. Provider confidence is cleared for user-edited/assigned observations. The initial automatic result remains immutable and separate in reports.
7. Click **Explain with Muse Spark** for an advisory explanation of the computed facts. Muse cannot change inspection statuses, invent identities/confidence, validate movements, or override protection. The deterministic facts remain visible if the explanation fails.
8. Click **Generate correction plan**. Valid plans show ordered lift-and-place arrows back to reference positions. Click each movement to focus its animated marker. A plan is withheld for unresolved identities, missing required objects, unexpected obstacles, displaced protected objects, overlapping annotations, impossible sizes/bounds, blocked destinations, or staging cycles. No partial executable plan is shown after a dependency failure. Remove unexpected objects safely and rescan; locate missing required objects; restore protected objects under human supervision.
9. Physically perform issued moves in order. Click **Verify with another photo**, upload a new photograph, align it, and inspect again. Verification stays pinned to the prior inspection's template revision even if the template was edited in the meantime. The summary reports progress; it never assumes a movement happened. Editing current observations removes displayed success until review is applied.
10. **Export report** before sharing evidence. It includes automatic and reviewed decisions, review actions, alignment metadata, hashes, timings, explanation, and correction plan. Image data URLs and credentials are omitted from the report. Photos remain in the local database. Recent inspections can be reopened from the workspace library after restarting.

If a provider times out or rejects malformed output, no successful scan is fabricated. The uploaded photo remains available for retry. The existing manual desk workflow is still available in Spatial Studio. V0.5 Inspect requires a successful SAM scan before its review stage; it does not simulate an offline AI inspection.

## Storage and API

The local database is `data/worldos.sqlite3` by default, or `WORLDOS_DATA_DIR/worldos.sqlite3`. The folder is Git-ignored. SQLite stores reference images, annotations/settings, template metadata, immutable per-inspection reference snapshots, current/aligned photos, raw validated model evidence, and separate human review. Back up the database while the server is stopped. Deleting a template cascades to its inspection records, except that references used by saved evaluation trials are protected from deletion. This is a single-user local app without authentication or encryption at rest; keep the server bound to loopback.

Schema migrations run automatically in a transaction: version 1 creates templates; version 2 adds inspections and their index; version 3 adds evaluation trials and frozen captures. Templates used by evaluation trials cannot be deleted, preserving their evidence. Revisions prevent silent overwrites by concurrent edits. A newer unknown database schema is rejected. Connections close after each operation. Inspect responses use `Cache-Control: no-store`; no environment settings or credentials are serialized into templates/reports.

| Endpoint | Purpose |
| --- | --- |
| `GET/POST /api/inspect/templates` | List/create reviewed templates |
| `GET/PUT/DELETE /api/inspect/templates/{id}` | Read/edit/delete template and history |
| `GET /api/inspect/templates/{id}/history` | Recent persisted inspections |
| `POST /api/inspect/alignment` | Manual coverage preview or conservative automatic suggestion; no provider call |
| `POST /api/inspect/scans` | Explicit aligned model inspection; optional prior inspection for verification |
| `GET /api/inspect/scans/{id}` | Reopen saved evidence |
| `POST /api/inspect/scans/{id}/review` | Apply explicit human assignments/absence/box/false-positive corrections |
| `POST /api/inspect/scans/{id}/explain` | Explicit cached Muse advisory explanation |
| `POST /api/inspect/scans/{id}/corrections` | Deterministic exact-destination restoration |
| `GET /api/inspect/scans/{id}/report` | Export evidence without embedded photos |
| `GET/POST /api/inspect/evaluation/trials` | List/create guided physical trials |
| `GET /api/inspect/evaluation/trials/{id}` | Resume a trial with its frozen reference/captures and saved results |
| `POST /api/inspect/evaluation/trials/{id}/captures` | Freeze independent truth and a physical inspection/corrected photograph before inference |
| `GET /api/inspect/evaluation/trials/{id}/export` | Export complete trial evidence **including photographs** |
| `GET /api/inspect/evaluation/report` | Aggregate automatic and assisted metrics with exact denominators |

Existing endpoints retain their contracts. Inspect extends the existing planner module with exact-destination restoration because clearing an empty target is different from restoring a fixed reference. Both paths use the same bounds, overlap, clearance, and lift-and-place model. Exact-target dependencies are ordered deterministically; reference sizes are not imposed as fictitious resizing operations. Rotation, staging, and physical travel-path safety remain unsupported.

## Reproducible physical evaluation

The checked-in [ten-scenario manifest](inspect-evaluation/manifest.json) specifies correct workspace, missing object, misplaced object, unexpected object, multiple misplaced objects, duplicates, protected movement, different camera angle, partial occlusion, and failed detection. [Current results](inspect-evaluation/results.json) record **0 physical pairs, 0 human-assisted trials, and 0 latency samples**. Metrics are unmeasured (`0/0`, value `null`). No V0.5 live provider request using a real photograph has been performed in this checkout; credentials and physical photo pairs were unavailable.

Create a private dataset:

```powershell
.\.venv\Scripts\python.exe scripts\evaluate_inspections.py --init artifacts\inspect-physical
```

For every case, create the named folder with:

- `reference.jpg` and `current.jpg`: separate actual photographs. Copied files and repeated pairs are rejected. Retain originals; never synthesize object relocation. For duplicate objects, independently track physical identities with an execution log or video.
- `template.json`: the reviewed template's API JSON, or a `TemplateInput` body. The runner uses the actual reference image file and independently reviewed reference boxes. Fetch the selected template from `/api/inspect/templates/{id}` and save it locally. IDs are available in the inspection export. No model-generated after boxes may be used as independent truth.
- `truth.json`: fill [truth.template.json](inspect-evaluation/truth.template.json). Include all visible current objects with independent normalized boxes **in the aligned reference frame**, retaining reference IDs and adding unique IDs for unexpected objects. Enter issues as `{"object_id":"book","kind":"missing"}` etc.; supported kinds are `missing`, `misplaced`, `protected_moved`, and `unexpected`. Every required identity must be observed or explicitly graded missing. Supply a reviewer, capture time, and notes, and assert the physical/independent/complete flags only when true. `workspace_correct` means all required objects are present, all present objects are correctly placed, protection/bounds are respected, no unexpected objects/footprint overlaps remain, and framing is valid. Perspective-mismatched scenes should not be graded correct under a similarity alignment.
- Optional `reviewed.json`: an explicit `InspectionReview` payload from the same trial's report `review` field. It records independent user actions and is scored separately. Keep original automated results untouched.

Update the manifest's `captured`, alignment parameters/confirmation, inventory confirmation, discovery/extra concepts, and optional `reviewed` path. The default template deliberately leaves alignment and inventory unconfirmed. A different-camera-angle trial can intentionally leave alignment unconfirmed: it then records an alignment abstention rather than running an invalid position comparison. Validate all references before any inference; the runner does this automatically.

```powershell
# Actual, potentially billable inference; records outputs and input hashes
.\.venv\Scripts\python.exe scripts\evaluate_inspections.py --manifest artifacts\inspect-physical\manifest.json --live --output artifacts\inspect-physical\results.json --require-complete

# Reproduce scoring from the same actual recorded outputs without provider calls
.\.venv\Scripts\python.exe scripts\evaluate_inspections.py --manifest artifacts\inspect-physical\manifest.json --recorded --output artifacts\inspect-physical\replayed.json --require-complete
```

Input hashes bind reference/current files, template, and request. Recordings omit photo data URLs and never contain credentials. Capture declarations and recordings are trusted author-supplied evidence, not cryptographic provider attestations. Recorded mode scores the original matching decisions; rerun live when changing the matcher. `--require-complete` fails for fewer than ten captured trials, pending cases, or provider failures. Alignment-review abstentions remain valid trial outcomes. Failures remain in opportunity denominators. Pending cases are listed and excluded from accuracy denominators.

Each fraction has an explicit numerator, denominator, and value; zero denominators yield `null`. Automatic and human-assisted metrics are separate:

| Metric | Definition |
| --- | --- |
| Object detection coverage | Label-matched, one-to-one detected boxes at IoU ≥ 0.5 / independently annotated visible current objects. Required objects truly absent are excluded from this visible-object denominator. |
| Identity agreement | Correct supported/reviewed identity boxes at IoU ≥ 0.5 / present reference identities; also report precision among decided identities and decision coverage. |
| Issue precision | Correct positive issue classifications / all positive issue classifications. Suspected missing/uncertain findings are abstentions, not confirmed missing alarms. |
| Issue recall | Correct positive issue classifications / all independent true issues. Abstentions can reduce recall. Unexpected instances are matched one-to-one to truth boxes. |
| False alarms | Count of incorrect positive issues, plus false alarms per evaluated trial. |
| Verification correctness | Correct passed/incorrect decisions / all trials; also decision coverage. `needs_review` and errors abstain. |
| Verification success | Accepted correct workspaces / independently correct workspaces; false acceptance uses incorrect workspaces as denominator. |
| Human review | Trials requiring review / all evaluated trials; separate assisted-trial and explicit review-action counts (identity/absence confirmation, box edits, false-positive exclusions). Multiple actions on one object count separately. |
| Inference latency | Actual wall time for discovery plus SAM analysis in each recorded successful scan, mean and sample count. Cache retrieval is included; cache metadata remains in raw evidence. Pipeline latency additionally includes alignment/comparison. These are not latency measurements for replay execution. |

## Engineering validation and demo preparation

```powershell
.\.venv\Scripts\python.exe -m pytest backend\tests -q
npm.cmd test
npm.cmd run build
.\.venv\Scripts\python.exe scripts\smoke_test.py
.\.venv\Scripts\python.exe scripts\smoke_inspect.py
```

`smoke_test.py` exercises the original workflow over HTTP. `smoke_inspect.py` uses actual HTTP and SQLite with **synthetic images and a mocked provider transport**, exercises scan/review/correction/verification, restarts its server, checks photo/history persistence, then deletes its isolated test template. It never sets a production mock mode. Neither smoke test establishes live provider accuracy. Registration tests use labelled synthetic texture. Optional paid live pytest tests remain opt-in.

Validation on October 26, 2026: **219 backend tests passed, 2 optional live tests skipped; 74 frontend tests passed; production build passed; both HTTP smoke scripts passed.** Persistence, migration, matching, registration, inspection, review, correction refusal, and photo-verification regressions are included. Browser QA checked onboarding, template creation controls, access to Spatial Studio, preservation of an Inspect draft across product switches, guided trial reopening, and missing-credential failure recovery. Tests used Python 3.12.10 and the machine's Node 25.9.0; use Node 24 for the demo because Vitest's supported Node ranges exclude 25. The existing Starlette/httpx test-client deprecation warning remains and did not prevent validation.

Inference reuse preserves V0.4's bounded process-local cache and identical-request sharing. Inspect adds cached concept discovery and explanation; geometric review/planning make no inference calls. Timeouts, provider failures, malformed output, and unknown Muse identities leave successful evidence unchanged. Edited observations invalidate success and correction/export actions until review is applied. Multiple workers have separate caches; this local MVP has no tenant isolation.

For a compelling recording: use one fixed overhead packing/tool station with three distinct objects, a marked empty destination, and a protected object. Capture a reviewed correct reference. Move one object, inspect it, show the exact issue and Muse explanation, generate/follow a valid arrow, then verify a fresh photograph. Include a brief detector-miss or duplicate review example if it occurs. State when a conclusion is human confirmed. Show persistence by reopening the saved workspace, and export the report. If inference fails, show recovery honestly; use a clearly labelled genuine prior screen recording as fallback. Do not present software fixtures as physical execution or live AI success.

Use a clean browser profile for recording. An existing extension panel covered the top-right product controls during browser QA; keyboard navigation confirmed the underlying view switch worked. Keep unrelated overlays out of the recorded presentation.

Before the November 4 submission, prioritize: (1) collect and independently label all ten physical scenarios, including negative controls; (2) rehearse the full live loop on the final camera/lighting setup and retain genuine fallback footage; (3) tune thresholds only after inspecting held-out errors, reporting decision coverage alongside accuracy; (4) pin the proven dependency/runtime versions for the demo machine and back up the SQLite database; (5) test more tool/packing-station surfaces and perspective/occlusion failures before claiming warehouse-wide capability. Larger inventories, perspective/depth handling, richer appearance embeddings, and controlled temporary staging belong to subsequent work.
