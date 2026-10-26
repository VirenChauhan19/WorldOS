# WorldOS V0.3: visual verification and adaptive replanning

V0.3 reuses the verified Meta SAM adapter and deterministic planner. No new credentials or provider contracts are introduced. Muse Spark still supplies reviewed goal constraints; it does not decide whether geometric placements are valid. The existing manual workflow remains available without inference.

## Run locally (Windows PowerShell)

The existing virtual environment, npm dependencies, and backend `.env` can be reused. Do not overwrite `.env`.

```powershell
Set-Location C:\Users\Administrator\Desktop\Github_AI201\WorldOS
npm run build
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Open **http://127.0.0.1:8000**. For development, run the backend with `--reload`, run `npm run dev` in another terminal, and open port 5173.

Backend variables remain:

```dotenv
MODEL_API_KEY=your_meta_key
WORLDOS_SAM_PROVIDER=meta
WORLDOS_MUSE_MODEL=muse-spark-1.3
WORLDOS_AI_TIMEOUT_SECONDS=45
```

The key belongs only in the Git-ignored backend `.env`. Never use a `VITE_` credential. See [credential setup](FIRST_INFERENCE.md). Baseten remains blocked without a verified deployment contract.

## Test the full loop with your own desk

1. Fix the camera above a flat desk. Use distinct labels and avoid occlusion. Keep camera position, crop, zoom, lighting, and object orientation consistent.
2. Upload the before-photo. Run **AI Analysis** with noun phrases for the objects, or annotate manually. Correct all boxes, labels, missed obstacles, and overlapping footprints. Mark objects that must remain stationary. Confirm the AI inventory if used.
3. Draw the usable **Surface** and the **Target** to clear. Describe the goal. Optionally use **Interpret goal with Muse Spark**, review its protected identities, and apply the constraints. Generate and export the original plan.
4. Perform some or all movements. Take and upload the after-photo under **I've made the moves**. The upload itself makes no provider request.
5. Check the framing and inventory confirmations after inspecting the image. Click **Automatic Verify**. Each explicit click makes one SAM call per distinct current label, up to three concurrently. It does not rediscover concepts with Muse or automatically retry failures.
6. Inspect completed/incomplete steps, missing or uncertain identities, protected-object violations, additional detections, and provider confidence. The after-overlay shows observed boxes and dashed **PLANNED** footprints. Green indicates a matching placement, coral an incomplete placement, and amber uncertainty. **Before / After / Side by side** remains available.
7. For uncertainty, choose a unique detection for each original identity and click **Apply identity choices for review**. An unlocated identity retains its original box only as an editing placeholder. Locate it manually with the drag/resize handles or coordinates. Add missed obstacles with **Obstacle** above the after-photo. Review unmatched detections before excluding false positives. Confirm every current position and scene coverage. No further model call is needed: use **Verify placements**.
8. Click **Replan from Current State** after all annotations and framing/coverage checks are confirmed. It uses current reviewed footprints, original target/goal/constraints, and original protected anchors. Inspect reasons and original/revised instructions. Updated arrows begin at the latest observed positions.
9. If a protected object moved, replanning is blocked until it is restored. If the new layout is impossible or the bounded search is exhausted, no valid solution is claimed. Correct overlaps or missing observations before retrying. Another after-photo starts another verification cycle.
10. Export results before refreshing. Session state is in memory. Export includes the original/current requests, plan comparison, latest visual evidence and its stale flag, and reviewed observations.

Manual fallback: locate and confirm every final box, then **Verify placements**. Initial/manual verification retains the existing API. Reviewed AI/revised scenes use the extended reviewed API and require explicit camera/coverage checks. Confidence is cleared when a user edits a detection. Editing positions or confirmations invalidates previous success and displays the scan as historical.

## Matching and decision rules

- Exact case/whitespace-normalized labels establish candidate sets. Nearness to expected positions ranks suggestions, but never resolves duplicate identities automatically.
- Repeated original labels, multiple same-label detections, missing detections, absent/provider confidence below 0.75, or width/height ratios outside 0.6–1.6 require review. These thresholds are conservative heuristics, not calibrated accuracy or identity probabilities.
- When a before-image is available, Pillow compares coarse crop RGB histograms. A histogram intersection below 0.45 adds uncertainty. Lighting/backgrounds affect this heuristic; it is not a learned appearance embedding.
- Entirely outside-surface detections are excluded and their IDs recorded. Boundary-crossing detections are retained for review. The API cannot discover unprompted new object classes, so users must check the full inventory.
- Placements compare maximum box-edge error: default 2.5% of image axes; protected objects at most 1%. Protected anchors remain tied to the original request across revisions. Added protected obstacles retain their current-plan anchors.
- Success requires supported or individually reviewed identities, consistent framing confirmation, complete inventory confirmation, matching final footprints, no collisions, no target intrusion/clearance conflict, no out-of-workspace objects, and no unexpected movement. Uncertainty is never verification success.
- Replanning makes **zero inference requests**. The existing deterministic planner handles all collision and placement checks. It supports up to 12 axis-aligned objects, no rotation, no temporary staging, and lift-and-place instructions.

## Reproduce real-photo testing

Two publicly licensed actual desk photographs are used:

- [Zesan H., desk equipment](https://unsplash.com/photos/a-desk-with-a-keyboard-mouse-and-a-laptop-tcfJJ4yzBrE), October 27, 2021.
- [Jakub Żerdzicki, office equipment from above](https://unsplash.com/photos/a-desk-with-a-laptop-keyboard-mouse-and-a-cell-phone-ElFBCgOfoIM), June 3, 2024.

Both are offered under the [Unsplash License](https://unsplash.com/license). Downloaded photos and detailed inference reports remain in ignored `artifacts/real-desk/`. Reference boxes and the manifest are in `docs/vision-fixtures/`; photos are not bundled into the application.

```powershell
# Download/cache photos; no inference, no API key used.
.\.venv\Scripts\python.exe scripts\download_desk_photos.py

# Explicitly sends images to Meta and may consume credits.
.\.venv\Scripts\python.exe scripts\evaluate_vision.py `
  --manifest docs\vision-fixtures\manifest.json `
  --output artifacts\real-desk\detection-report.json --live

# Keep the backend running. This uses the SAME unchanged desk photo as before/after.
# It must reject completion of an unperformed phone movement.
.\.venv\Scripts\python.exe scripts\test_visual_live.py --live
```

The evaluator records file SHA-256, source, dimensions, concepts, actual boxes/confidence, per-concept SAM latency, total latency, errors, and scoped IoU comparisons. It validates input before inference, does not retry providers, and never writes credentials or image data URLs to reports. A missing reference yields `metrics: null`. Missing objects remain missing. Precision/false-positive counts require `reference_complete: true`; incomplete reference inventories must not make legitimate additional detections into false positives.

For your own benchmark, create a manifest with `cases` entries containing `name`, `image` (relative file), `concepts`, `reference` (relative JSON), `source`, `reference_provenance`, and `reference_complete`. Reference JSON can contain `objects` or the UI export's `request.objects`. Review every relevant instance before declaring completeness, include built-in/partially visible objects or explicitly define the scope, and use matching labels. Do not use SAM output as independent ground truth. Hold out photographs and keep low-light, occlusion, duplicate-object, new-obstacle, camera-shift, partial-move, and protected-move trials separate.

## Actual observations on October 26, 2026

Real provider calls, without mocked transports:

| Photo | Prompt count | Returned detections | Total inference time | Matched scoped reference boxes at IoU ≥ 0.5 |
| --- | ---: | ---: | ---: | ---: |
| Zesan desk | 5 | 4 | 3,180 ms | 3 / 5 |
| Jakub desk | 4 | 6 | 3,333 ms | 4 / 5 |

References were approximate boxes entered by the agent after visually inspecting the photos **before inference**, not independent human labels. These ratios are exploratory reference coverage (60% and 80%), **not a reliable detection-accuracy estimate**. Inventories are scoped and incomplete; precision is deliberately unreported. Photos, prompts, confidence values, normalized boxes, latency and comparison provenance are recorded in `artifacts/real-desk/detection-report.json`.

Observed limitations include a trackpad returned under `laptop`, an undetected earbud case, and the external trackpad missing from the reference matches. Some unmatched detections on the second image correspond to additional visible instances, including a built-in trackpad; an incomplete annotation inventory cannot classify all of them as mistakes. Cross-concept deduplication retains one label for near-identical footprints, so users must check labels as well as boxes.

The live negative control used the same unmodified Jakub photo twice, with a restricted clear desk surface containing the phone and protected mouse. `/api/ai/verify` returned **failed**, phone step **incomplete**, mouse position **completed**, in **1,873 ms**. Reviewed detections then produced a collision-free revised phone movement while retaining the mouse lock and original target. That replan made no provider calls. Evidence is in `artifacts/real-desk/verification-report.json`.

No independently photographed physical before/after movement pair was available. Verification accuracy, false-success rate, robustness to camera motion, and reliable real-world identity tracking remain **unmeasured**. This negative control proves one rejection case, not general reliability.

## New API contracts

Interactive schemas are at **http://127.0.0.1:8000/docs**.

| Endpoint | Request | Behavior |
| --- | --- | --- |
| `POST /api/ai/verify` | `plan_request`, optional `original_request`, `image_url`, optional `before_image_url`, `framing_confirmed`, `inventory_confirmed`, optional `tolerance` | Explicit SAM inference; conservative identity/placement assessment; raw detections, matching evidence, steps, issues, latency |
| `POST /api/verify/reviewed` | `original_request`, `plan_request`, `observed_objects`, `reviewed_ids`, framing/inventory booleans, optional tolerance | No inference; validate all identities/obstacles and original protected anchors |
| `POST /api/replan` | Same reviewed-state payload | No inference; reject unreviewed/missing state, block displaced protected objects, return original/previous/revised plans, updated request and reasons |

Provider timeout/rate-limit/authentication/malformed-response handling reuses the existing safe transport. A whole AI operation has a two-minute deadline. A failed scan applies no partial detections, clears prior success, and leaves manual editing available. The UI never scans automatically after upload or on a timer.

## Automated validation

```powershell
.\.venv\Scripts\python.exe -m pytest backend\tests -q
npm test
npm run build
.\.venv\Scripts\python.exe scripts\smoke_test.py
```

The default suite uses deterministic fixtures/mocked providers and does not incur inference usage. Live scripts require `--live`; existing optional live pytest tests retain their explicit opt-in.

Validation on October 26, 2026: 146 backend tests passed (2 optional live tests skipped), 37 frontend tests passed, production build passed, and the real-HTTP production/manual-workflow smoke test passed. A pre-existing Starlette/httpx test-client deprecation warning remains. Separately, the real SAM calls and real-photo negative control described above succeeded.
