# WorldOS V0.4: reliability and hackathon runbook

V0.4 extends the existing app without replacing its annotation, planning, manual verification, or adaptive loop. Demo Mode is an opt-in presentation layer over that same state. It makes no inference requests when opened and never marks a step completed merely because the presenter navigates past it.

## Current evidence

The checked-in [physical trial report](evaluation-v04/results.json) records **10 specified scenarios, 0 captured pairs, 0 evaluated pairs, and 0 user-corrected pairs**. Object matching, movement completion, protected preservation, and goal verification are all **unmeasured**. Every empty metric has numerator 0, denominator 0, and value `null`; no percentage is claimed. No physical before/after movement photos or credentials were available in this checkout. V0.3's historical single-photo observations and unchanged-image control remain documented separately; they are not V0.4 physical trial results.

Automated tests use synthetic images and mocked provider transports. Their passing counts are software regressions, not real-world accuracy. The evaluator trusts the capture author's physical-photo and independent-reference declarations; SHA-256 binding prevents accidental input substitution but does not attest provider authenticity or verify that a photograph depicts physical execution.

## Start the application

From the repository root in Windows PowerShell, use Python 3.12+ and supported Node 22.13+ or 24+:

```powershell
# First-time setup only
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
npm.cmd ci

# Build and run the single-origin production app
npm.cmd run build
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Open http://127.0.0.1:8000. Configure the backend-only, Git-ignored `.env` as explained in [First inference](FIRST_INFERENCE.md). Reuse existing credentials; do not overwrite `.env`:

```dotenv
MODEL_API_KEY=your_meta_key
WORLDOS_SAM_PROVIDER=meta
WORLDOS_MUSE_MODEL=muse-spark-1.3
WORLDOS_AI_TIMEOUT_SECONDS=45
```

No credential belongs in a `VITE_` variable or a browser field. The Baseten path still requires its deployment-specific verified contract. Manual mode remains available without credentials.

## Exact steps for a hackathon recording

1. **Prepare and rehearse.** Fix a camera above a flat, uncluttered desk. Use two or three distinct, easy-to-recognize objects, such as a notebook, headphones, and a protected cup. Keep orientation, framing, zoom, and lighting fixed. Leave generous free destinations and include every obstacle in the workspace. Capture a real before-photo. Start the production app, then explicitly test SAM and Muse under **AI Connection Status**. A green connection test establishes connectivity, not task accuracy. Start screen recording with your preferred recorder; include a camera view or a clearly identified cutaway of actual object movements.
2. **Introduce WorldOS (15 seconds).** Click **Demo Mode → Begin walkthrough**. Say: “WorldOS turns a photo and a goal into movements, checks the real result, and adapts when something changes.” The sample is visibly labelled as an illustration with manual boxes; upload your photograph for the actual demonstration.
3. **Scan (15 seconds).** Under Scan, click **Upload photo** and select the actual before-photo. Upload only validates and prepares the photo; it does not imply model inference. Advance to **Understand**.
4. **Understand (30–45 seconds).** Enter exact noun phrases under **SAM object concepts**, then click **AI Analysis**. Show the real returned boxes, confidence, and **Inspect SAM outputs** in the demo evidence card. Correct labels/boxes, add missed obstacles, and confirm the reviewed inventory. Draw the surface and target, lock the cup, and enter an explicit goal using exact labels. Click **Interpret goal with Muse Spark**, show its actual summary, review the protected IDs, and **Apply reviewed constraints**. If the model asks for clarification, resolve it before proceeding. Edits label earlier inference as historical.
5. **Plan (15 seconds).** Click **Generate spatial plan**. Explain the reported lock set and number of movements. Export the initial plan with the download icon now; save it with the before-photo. If the planner reports impossible/search-limit, explain its reason and adjust the target or usable space. Do not present an unavailable plan as ready.
6. **Guide (20–30 seconds).** Click demo **Guide**. Use **Next movement** to focus each numbered instruction and animated marker. Physically lift and place each object in order. State that animation illustrates instructions; it does not track physical actions. Show the actual execution in your camera view.
7. **Verify (30–45 seconds).** Take a separate after-photo without shifting the camera. Click demo **Verify**, upload it through **Final photo**, and show the actual before/after comparison. Inspect the scene and check framing and complete-inventory confirmations. Click **Automatic Verify**. Show completed/incomplete steps, protected preservation, uncertainty, and matching evidence. “Cached genuine inference” means the backend reused an identical recent request; it is not a new provider call.
8. **Adapt if necessary (30 seconds).** For an incomplete or uncertain scene, select distinct detections for each identity, click **Apply identity choices for review**, locate missing objects manually, and correct/add obstacles. Confirm every final position and scene coverage. Click **Replan from Current State**. Show the reasons and updated ordered arrows. This deterministic replan makes no model calls. If a protected object moved, restore it first; the app blocks replanning at a displaced protected anchor. Follow the revision and verify a fresh after-photo.
9. **Close with evidence (15 seconds).** The demo displays **Task verified** only when the actual verification result passes. Show its matched count and evidence source. If manual corrections were needed, say “User-reviewed annotation evidence”; do not describe that result as autonomous AI verification. Download the final JSON before refreshing. Keep the original photos, initial plan, final export, and recording together. Session state clears on refresh.

A successful recording must show an actual feasible plan, physical movements, and passing supported or explicitly reviewed evidence. If the model misses an identity, demonstrate the honest review/replanning loop. Do not replace a failed result with a fabricated success screen. Offline fallback: play a previously captured genuine screen recording, visibly identify it as recorded with its date, and show the saved photos/report. V0.4 does not bundle an AI success recording or import recorded sessions into the UI.

## Reproducible physical evaluation

Create your own ignored capture directory:

```powershell
.\.venv\Scripts\python.exe scripts\evaluate_movements.py --init artifacts\physical-v04
```

This writes a ten-scenario manifest with `captured: false`; it generates no images, annotations, or results. The repository's [manifest](evaluation-v04/manifest.json) is also a template.

| Scenario | Capture procedure |
| --- | --- |
| single_move | Complete one movement; preserve a protected anchor. |
| multiple_moves | Complete two or more ordered movements. |
| unchanged_control | Photograph again without performing the plan. A copied image file is rejected. |
| partial_completion | Perform only part of the movement sequence. |
| protected_moved | Move a protected object as a negative control. |
| duplicate_objects | Move one of two same-label objects; independently track the physical identities. |
| occluded_object | Partially occlude an original object after movement. |
| new_obstacle | Add a new obstacle in the target after planned movements. |
| lighting_change | Execute the plan, change lighting, and retain camera framing. |
| camera_shift | Execute movements and shift the camera while retaining aspect ratio; leave framing confirmation false. |

For each case, create its named directory containing:

- `before.jpg`, `after.jpg`: separately captured, actual photographs. PNG/WebP paths can also be used. Each pair must be distinct; duplicate pairs cannot count as additional scenarios. Retain original files without compositing or synthetic object relocation. Camera-shift cases still need matching aspect ratios.
- `plan.json`: **Export plan** immediately after generating the initial plan. The evaluator accepts this export or a raw `PlanRequest`. A revised-plan export is rejected. Planner output is recomputed and hashed, so a changed planner requires rerunning inference.
- `truth.json`: copy [truth.template.json](evaluation-v04/truth.template.json), then independently review it. Use stable original IDs for every actual after-photo object, and additional IDs for new obstacles. Never use the SAM output as independent ground truth. For indistinguishable duplicates, use a separate physical tracking log or execution video to establish true identity; do not silently guess. References need not be non-overlapping rectangles if real occlusion occurs, but every original identity must be located. If that cannot be established independently, keep the scenario pending.
- Optional `reviewed.json`: the separately user-corrected `ReviewedStateRequest`, with `original_request`, `plan_request`, `observed_objects`, `reviewed_ids`, `framing_confirmed`, and `inventory_confirmed`. Both requests must equal the initial request. Copy these fields from the final export after individually confirming the observations. Do not substitute this file for the automated recording.

Set `physical_photo_pair`, `independent_reference`, and `inventory_complete` to true only after checking those facts. Fill `reviewed_by`, `captured_at`, and capture notes. Enter `objects` with independently observed normalized boxes, one for every original ID and all additional obstacles. Enter a strict boolean for each planned object's ID in `completed_movements`, every locked ID in `protected_preserved`, and the trial's `goal_achieved`. Use the same strict verification contract: planned destinations within 2.5% maximum edge error; protected anchors within 1%; target/clearance empty, workspace respected, no overlaps or unexpected movements, all identities located, and consistent camera framing. Do not grade only whether the target appears empty. Set the manifest's `captured` to true only when all files and grading are complete. Set its `reviewed` path when that separate result exists.

All captured input files are validated before the first provider request. The before-photo informs appearance matching; ground-truth after boxes and grading are used only for scoring and are never supplied to the model.

```powershell
# Validate all captured cases without inference or scoring
.\.venv\Scripts\python.exe scripts\evaluate_movements.py --manifest artifacts\physical-v04\manifest.json --validate

# Explicit billable SAM inference, local recordings, and scored report
.\.venv\Scripts\python.exe scripts\evaluate_movements.py --manifest artifacts\physical-v04\manifest.json --live --output artifacts\physical-v04\report.json --require-complete

# Reproduce the scoring from those same hash-bound actual recordings; no network calls
.\.venv\Scripts\python.exe scripts\evaluate_movements.py --manifest artifacts\physical-v04\manifest.json --recorded --output artifacts\physical-v04\replayed-report.json --require-complete
```

Each `inference.json` stores the actual validated SAM verification response or sanitized provider failure, timestamp, and SHA-256 of both original photo files, the request, and deterministic plan. Reports do not contain credentials or photo data URLs. Raw photos, references, and detailed recordings stay under ignored `artifacts/`. The report identifies live, recorded, and validation-only runs. Recorded mode does not re-infer identities under changed matching code; rerun `--live` to benchmark a changed matcher. `--require-complete` exits nonzero unless at least ten pairs were evaluated, no scenarios remain pending, and no provider failures occurred. Uncertainty remains a valid abstention rather than a pipeline failure. Partial reports remain useful but cannot establish completion of the ten-scenario benchmark.

## Metric definitions and denominators

Reports separate `automated_metrics` from `user_corrected_metrics`. Automated means system identity/placement decisions after explicit human framing and inventory confirmations; it does not mean unsupervised end-to-end autonomy. Reviewed metrics include only cases with a separately submitted reviewed result, and `user_corrected_pairs` exposes that subset. Provider errors remain in the automated opportunity denominators and count as abstentions. Pending scenarios are reported, excluded from accuracy denominators, and prevent `--require-complete` from passing.

Every fraction contains `numerator`, `denominator`, and `value`; a zero denominator produces `null`.

| Metric | Numerator / denominator |
| --- | --- |
| Object matching, all identities | Supported/reviewed assignments whose after-box agrees with the independently tracked identity at IoU ≥ 0.5 / all original identities in evaluated pairs. This is identity-box agreement, not segmentation-mask accuracy. |
| Object matching, decided precision | Correct identity-box assignments / all supported/reviewed assignments. |
| Matching coverage | Supported/reviewed assignments / all original identities. |
| Completed movement classification, all | Correct completed/incomplete decisions / all planned movements. Abstentions receive no correctness credit. |
| Protected preservation classification, all | Correct preserved/moved decisions / all protected-object opportunities. |
| Overall goal classification, all | Correct passed/failed decisions / all evaluated pairs. `needs_review` and provider errors abstain. |
| Accuracy among decided | Correct boolean classifications / non-abstaining decisions for that category. |
| Decision coverage | Non-abstaining decisions / all opportunities for that category. |
| False success over actual negatives | Positive predictions when truth is false / all actual negative opportunities. Reported for movements, protection, and goals. |
| False success over positive decisions | Positive predictions when truth is false / all positive predictions for that category. |

An unresolved identity can never count as a completed movement or accepted goal. Protected “positive” means preserved. Goal `failed` is a negative decision; `needs_review` is an abstention. Alongside aggregate counts, every case reports its identity decisions and per-movement/protected/goal truth and prediction. Inspect these rows, the negative controls, sample size, and reviewer provenance before making any reliability claim.

## Matching, planning, and performance changes

Matching ranks label overlap, original footprint agreement, crop-color histogram agreement when both images exist, distance to the planned position, provider confidence, and relative geometry to unique stationary anchors. Punctuation/case/whitespace normalize labels. Non-exact related labels, repeated labels or multiple candidates, shared detection assignments, provider confidence missing/below 0.75, footprint agreement below 0.60, width/height ratios outside 0.6–1.6, appearance below 0.45, combined evidence below 0.72, candidate margin below 0.12, or stationary-context disagreement above 0.35 require review. The UI exposes scores and candidate evidence. These are conservative uncalibrated heuristics, not identity probabilities. A close planned destination never resolves duplicates automatically.

Planning first attempts a bounded search moving only target blockers, reserving most of its existing state/check budget for ordered helper moves when another object occupies a needed destination. Every destination still checks the current occupied scene. A fixed-obstacle edge-contact check can prove an object has no placement around protected footprints and the target, and explains the conflict. Existing target, area, and fit impossibility explanations remain. Bounded search exhaustion is still `search_limit`, never proof of impossibility. Locks, clearance, reviewed constraints, and original protective anchors are retained. The plan remains deterministic and moves each object at most once.

Validated SAM analysis and Muse reasoning responses use a process-local 120-second, 16-entry LRU cache per backend configuration/credential identity. Canonical normalized image content, concepts, and full reasoning context identify requests. Identical concurrent requests share work; at most eight distinct requests may be pending per service. Failures, malformed output, and timeouts are not cached. Empty but valid detections can be cached and still require missing-object review. Cache-hit/shared metadata and the original inference timestamp are returned. The frontend also shares identical in-flight AI actions. Disconnecting one cancelled consumer does not cancel another consumer; when all service waiters cancel, shared work is cancelled. A provider may still charge for work it already received. Each operation retains a two-minute limit and provider deadlines. There are no automatic billable retries. Cache contents are memory-only, process-local, and cleared by restart; multiple server workers have separate caches. This MVP has no authenticated tenant separation.

Loading overlays show elapsed time and recovery guidance. The old manual workflow remains available after errors. AI result state, confidence, reviews, and verification are invalidated appropriately after edits; applying an identity choice explicitly marks it user-corrected and clears provider confidence. Demo animation respects reduced-motion preferences. UI before/after comparisons show uploaded photos, never a synthesized successful after-image.

## Checks and remaining limits

```powershell
.\.venv\Scripts\python.exe -m pytest backend\tests -q
npm.cmd test
npm.cmd run build
.\.venv\Scripts\python.exe scripts\smoke_test.py
```

The HTTP smoke test launches and stops its own temporary server. It checks V0.4 static assets/schema, upload, planning, manual/reviewed verification, adaptive replanning, protected-anchor blocking, and recoverable errors without provider calls.

Validation on October 26, 2026: **172 backend tests passed, 2 optional live tests skipped; 54 frontend tests passed; production build passed; expanded real-HTTP smoke test passed.** The original 146 backend and 37 frontend regressions remain covered. Browser QA checked the rendered introduction, six-stage navigation, sample disclosure, generated two-movement sample plan, and actual-plan guidance. Tests ran on Python 3.12.10 and the machine's Node 25.9.0; npm warns that Vitest 5's supported Node ranges exclude 25, so use Node 24 for the demo. A pre-existing Starlette/httpx test-client deprecation warning remains. Neither warning prevented the checks from passing. No physical execution accuracy is inferred from these tests.

Real-world accuracy remains unmeasured until physical captures and independent truth are supplied. No new live provider calls were made for this V0.4 implementation. Model output cannot prove complete inventory, identity, physical stability, or actual execution. Camera registration, perspective correction, rotation, temporary staging, depth, travel-path safety, and global optimality remain unsupported. The planner covers up to twelve axis-aligned footprints and explicitly uses lift-and-place instructions. Demo Mode keeps the existing app layout and genuine evidence; it does not add unattended actions or an offline AI simulator.
