# WorldOS Inspect V0.5 — demonstration and submission readiness

This is the operational checklist for the existing product, not a claim that the real-world benchmark has passed. **0 genuine physical Inspect trials have been captured here**. Earlier V0.3 records describe successful SAM calls on public desk photos and an unchanged-photo negative control, not a physically corrected workspace. V0.6 Meta SAM connectivity is now restored: real public-photo detection, Baseten multimodal goal interpretation, deterministic planning, live Inspect scanning, and explanations passed. See [actual restoration results and failure recovery](SAM_RESTORATION_RESULTS.md). These public-photo integration checks are separate from the user-operated physical evaluation below. Test photos and mocked responses used by automated tests and isolated browser QA remain software fixtures only.

## What changed for the demonstration

- **Evaluate real photographs** adds a guided trial to the existing Inspect workflow: choose a reviewed reference, label a new inspection photograph, inspect, correct physically, label a new corrected photograph, and verify.
- Ten scenario choices, operator/capture metadata, independent truth boxes and issue labels, and explicit physical-photograph declarations are persisted in SQLite schema 3.
- Labels, photo bytes, alignment, and the reference revision are frozen before inference. Evaluation truth is not passed to SAM/Muse. Mistaken labels require a new trial; there is no post-result truth editing.
- Attempts, sanitized failures, timings, provider/cache metadata, validated model output, detected issues, review history, correction plans, explanations, and corrected-photo outcomes remain in the trial. New template analyses retain original reference inference separately from corrected reference annotations; older/manual templates explicitly have no reference inference record.
- Model outputs and human-assisted results are scored separately. Even inventory-only confirmation is human assistance. Geometry, protection, uncertainty gates, and Spatial Studio remain unchanged.
- Completed-capture retries return saved results without another model call. Simultaneous attempts are rejected. An interrupted attempt can be retried explicitly after its 150-second lease; the interrupted attempt is retained.
- A textured-JPEG regression fixes input drift caused by re-encoding a photo after labeling. Error banners scroll into view; a failed scan does not clear the saved capture.

## Start the application

Run from the repository root in PowerShell. Use the existing Python virtual environment; if setting up a clean machine, create one first. Use a supported Node version (Node 24 is recommended for this repo; Node 25 produced an engine-range warning during earlier setup).

```powershell
Set-Location C:\Users\chauh\OneDrive\Documents\GitHub\WorldOS
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
npm.cmd ci
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

Edit `.env` locally: provide `MODEL_API_KEY`, retain **`WORLDOS_SAM_PROVIDER=meta`** from the updated example, and retain the documented Muse model setting. If reusing an older `.env`, change its Baseten selection explicitly; Baseten is blocked without its verified deployment contract. Do not put keys in browser inputs, `VITE_` variables, source control, screenshots, or exported reports. Restart the backend after changing settings.

```powershell
npm.cmd run build
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Open `http://127.0.0.1:8000`. Use **AI connection → Test AI Connection** for SAM and Muse explicitly. Probes may consume credits; a successful probe does not establish performance on physical photographs. Then use an actual reference photograph with **Identify with Meta AI**, and run an actual inspection and **Explain with Muse Spark**.

## Guided physical trial: exact operator steps

1. Choose a flat, well-lit workspace with 3–5 distinct, safely movable objects and one protected anchor. Fix the camera and mark its position. Leave space between object footprints and within the boundary. Keep the original photographs in a private folder outside source control.
2. Arrange the correct workspace. Capture a real **reference** photo. Create a template, run SAM explicitly, review labels/boxes/required/protected settings, and save it. See [the first-template instructions](V05_INSPECT.md#create-the-first-template). Do not run model inference on the evaluation photos before labeling them.
3. Select the template and click **Evaluate real photographs**. Enter a descriptive trial name, one of the ten scenarios, your operator name, and the reference capture time. Confirm the physical-reference declaration only if true. Click **Start physical trial**. This pins the reference revision.
4. Set up the scenario physically. Take a separate **inspection** photograph, then use **Upload inspection photo** below the evaluation panel. On supported phones, the file control can offer the rear camera. On desktop, select the photo file.
5. Align stationary background features with the transparent overlay. Check coverage and confirm alignment only if the photographs agree over the whole workspace. Return to the evaluation panel and click **Prepare independent labels for this alignment**. This makes no model call.
6. Label independently. For each reference identity, choose its actual state, select its identity button, and draw its observed box on the aligned photo. Use numeric box editing when needed. Identical labels have distinct reference IDs; identify them physically, not from the model's guessed match. Physically missing required objects need a **Physically missing** label and no box. Optional absent objects use **Optional and absent**. Draw and label every unexpected object. Boxes use aligned-reference coordinates, not raw camera coordinates.
7. Enter the ground-truth reviewer, actual capture time, and notes about movement, occlusion, lighting, or camera changes. Confirm that the complete truth was checked without this photo's AI output and that this is a new physical photograph. **Freeze photograph and ground truth**. Exact reused photographs are rejected. Declarations/hashes are provenance aids, not proof of authenticity; edited or recaptured copies must not be counted as independent trials.
8. Click **Inspect workspace** below. The initial result has no human inventory confirmation. Record the raw identity decisions and issues. Use **Explain with Muse Spark** explicitly if desired; an explanation failure does not remove the deterministic result.
9. Review uncertainty through the existing controls: match identities, draw missed objects, confirm actual absence, exclude false detections, and check inventory. Click **Apply reviewed inspection**. These changes are saved separately from the automatic result, including inventory-only confirmation. Ground-truth labels are not applied as corrections for you.
10. Click **Generate correction plan**. Perform valid moves physically in order. For missing/unexpected/protected cases, follow the explicit blocking explanation and use supervised physical restoration before verification. Never claim a blocked plan executed an action. No plan validates the lifting path, stacked objects, rotation, or hand safety.
11. Click **Verify with another photo**, or **2. Corrected photograph** in the evaluation panel. Take a genuinely new **corrected** photo. Repeat alignment, independent labeling, freezing, and **Verify correction photo**. Corrected truth may still contain issues; do not label a failed correction as successful. For a correct-workspace control, take a separate final photo without moving anything.
12. Save any human verification review. Click **Export trial with photographs**, then **Show evaluation report → Download metrics and denominators**. Trial exports contain photos and all recorded evidence; inspect them before sharing. A trial stores one inspection and one corrected capture. Start a new trial for further physical attempts, rather than replacing a failed outcome.

Resume after restart: select the template → **Evaluate real photographs → Resume saved trials**. A completed saved result is explicitly identified as stored inference and opening it makes no provider request. To revisit a stage, use **1. Inspection photograph** or **2. Corrected photograph**. **Leave evaluation** returns to ordinary Inspect.

For an intentional camera-angle failure, freeze the independently labeled capture with unconfirmed alignment and click **Record alignment abstention**. The failure is recorded, no model request is made, and no position comparison is treated as valid. Use a retaken, aligned corrected photo to recover. If the image does not reveal an object's position, do not invent a ground-truth box; improve the view or explicitly report that sample as unscorable outside the scored set.

## Physical tests still required

| Scenario | Physical setup | What to observe |
| --- | --- | --- |
| Correct workspace | Keep the correct layout; take distinct reference, inspection, and final photos | False alarms, complete detections, inventory review, final verification |
| Missing object | Remove one required object | SAM miss stays suspected, physical absence requires human confirmation; replace it for verification |
| Misplaced object | Move one object to an empty area without rotating it | Identity, misplaced issue, valid arrow, physically restored final state |
| Unexpected object | Add a different object type | Discovery/extra concepts, unexpected issue, safe removal and verification |
| Multiple misplaced | Move two or more objects with feasible destinations | Ordered corrections, destination occupancy, no collision or protected move |
| Duplicate objects | Use two similar objects with the same label | Conservative uncertainty, explicit one-to-one human identity review |
| Protected moved | Move the anchor deliberately under supervision | Protected issue, blocked automated plan, supervised restoration |
| Different camera angle | Translate/rotate camera; also try a perspective change | Overlay/registration, abstention for invalid alignment, retake recovery |
| Partial occlusion | Partially cover an object while keeping its identity physically known | Uncertainty, no false confirmed absence, review and a clearer final image |
| Failed detection | Use a genuine difficult capture where an object is visible but SAM misses it | Save the actual miss, draw it manually, keep raw and assisted outcomes separate |

Do not fabricate the last scenario with a software mock. API downtime is a separate recovery test, not evidence that SAM missed an object. If no genuine detection failure occurs, report that scenario as still unobserved. Include failed plans, false alarms, and unsuccessful final photographs in the dataset. At least one complete trial per scenario establishes coverage, not a statistically reliable accuracy claim. Repeat with independent captures before making broader claims.

Also physically rehearse a destination-blocking arrangement, a two-object swap that requires staging, and a perspective mismatch. The correct outcome may be a refusal. Do not adjust tolerances after seeing benchmark results to make them pass; use a separate tuning set and fresh evaluation captures.

## Metrics and evidence rules

The guided report is generated from the local database at `GET /api/inspect/evaluation/report`. It does not import the old CLI benchmark or test fixtures. The older [file-based evaluator](V05_INSPECT.md#reproducible-physical-evaluation) remains supported as a separate dataset/workflow.

- **Detection coverage:** label-compatible detections with IoU ≥ 0.5 / independently labeled visible objects.
- **Identity precision:** correct decided matches / all decided matches. Also report correct matches / present reference objects and decision coverage. Duplicate-label uncertainty is an abstention.
- **Issue precision:** true positive `(identity, issue kind)` decisions / all decided positive issues, `TP/(TP+FP)`.
- **Issue recall:** those true positives / all independently labeled issues, `TP/(TP+FN)`. Suspected missing and uncertain findings are abstentions; they do not become true positives or false alarms, and can lower recall.
- **False alarms:** total false positive decided issues and `FP / attempted photographs` in the given stage/cohort. This is a count per photo, not a percentage and not a true-negative rate.
- **Task success:** corrected photo is independently labeled correct **and** the system declares it passed. Report successes / all started trials, and successes / trials with a corrected attempt. An unattempted corrected stage cannot count as success. A false acceptance on an incorrect final scene is not a success.
- **Automatic:** original inference decisions after reviewed reference/manual alignment setup, with no per-scan inventory confirmation or identity/box edits. WorldOS deliberately withholds completion until inventory is checked, so fully automatic task success is normally zero. Do not present that safety gate as a measured detector failure.
- **Human assisted:** saved post-inference review, including inventory-only confirmation. Assisted issue metrics use only reviewed captures; task denominators still include all started trials. Cohorts may differ, so do not claim a controlled improvement from their difference alone.
- **Latency:** actual successful-scan inference wall time, including concept discovery and cache retrieval. Every sample retains cache metadata. Failed scan attempts retain pipeline duration separately; scan-attempt counts include local alignment abstentions and configuration failures, not just external requests.
- **Manual effort:** each saved assignment, manual observation edit, false-positive exclusion, and inventory confirmation is counted. Repeated review submissions are separate actions; absence confirmation belongs to its identity assignment.
- A started capture remains in opportunity denominators while a retry is in progress. Its lack of a result is an abstention. Reports are snapshots and update after completion. A trial with frozen labels but no attempted scan is pending, not scored.
- Empty denominators are `0/0, value=null` (**unmeasured**). Nonempty partial data is **preliminary**. Covering all ten scenarios changes coverage status only; it does not certify real-world reliability. Automatic and assisted metrics are also split between initial and corrected photographs in the download.

No physical evaluation precision, recall, false alarms, or task success can be reported from this checkout yet. Individual real public-photo inference latencies are recorded in the restoration report; they are not a physical-trial latency benchmark. The passing test totals below are software verification only.

## Failure recovery rehearsal

| Failure | Recovery without inventing success |
| --- | --- |
| Missing/invalid key, quota, access denial | Read the saved error; fix backend configuration/access and restart; reopen the trial and retry explicitly |
| Timeout/network interruption | Keep the frozen capture; **Reload trials** first, since the server may have completed; return a saved result if present, otherwise explicitly retry |
| Interrupted server with running attempt | Restart, reopen trial, wait until 150 seconds after attempt start, then explicitly retry; interruption remains in the record |
| Muse discovery fails but SAM is usable | Explicitly disable discovery and provide additional noun phrases; retain the failure and document narrowed discovery; review inventory |
| Muse explanation fails | Continue with deterministic findings/planner; retry explanation only when desired |
| Missing/uncertain/duplicate detections | Review identities and boxes; no green completion or supposedly valid arrows until the review passes |
| Bad alignment | Retake the photo; label it as a new stage/trial, or retain a deliberate alignment abstention |
| Provider outage during the presentation | Open a previously saved **genuine** trial and say “recorded inference from [time]”; or show recorded video. Never show mock fixtures as live evidence |

There is no same-provider retry loop. V0.6 reasoning may fall back once from Baseten to Meta when the Meta key is configured; results disclose the provider and failure reason. Inspect cannot create a new live AI inspection offline; manual Spatial Studio and saved Inspect evidence remain available.

## Demo readiness checklist

Keep this checklist with the final release, and check items only after performing them.

- [x] Backend tests: 269 passed; 2 optional live tests skipped.
- [x] Frontend tests: 80 passed.
- [x] Production build and both HTTP smoke tests pass, including SQLite restart persistence and guided trials. HTTP provider responses are mocked; browser recovery uses an isolated synthetic workspace.
- [ ] Backend Meta credentials are installed on the actual demo machine; `WORLDOS_SAM_PROVIDER=meta`; no key in frontend bundles, git, recording, or exports.
- [ ] SAM and Muse connection probes pass with the actual account, credits, model access, and venue network.
- [ ] Real SAM reference/inspection and Muse explanation succeed on the chosen physical workspace; all ten scenarios are honestly recorded or explicitly listed as pending.
- [ ] One complete reference → inspection → corrections → corrected photo → reviewed verification loop works without developer intervention.
- [ ] Genuine fallback trial is saved and reopens after restart; recorded footage is clearly labeled and kept locally.
- [ ] Originals, aligned images, independent labels, trial JSON exports, aggregate report, and reviewer notes are retained; no synthetic QA database is included.
- [ ] SQLite backup is made after closing the backend; a separate restored copy reopens photos/history and the trial report.
- [ ] Exact release revision, Python/Node versions, dependency lockfile, startup commands, and test logs are recorded.
- [ ] Presentation uses a clean browser profile. During QA, an existing SCREENMATE extension overlay covered the upper-right navigation; rehearse without overlays/notifications.
- [ ] On the deployment target: production build, `/api/health`, upload, both models, save/restart/reopen, and report download are tested over the final URL. Persistent storage survives a redeploy; proxy timeouts accommodate the 120-second scan limit and uploads.
- [ ] If judges need a hosted link, add/test access protection and HTTPS at the hosting layer, a persistent private data directory, and spending/rate limits. The current application is a single-user local app with unauthenticated APIs; do not expose its raw server publicly with private photos or an unrestricted paid key. A local screen-shared demonstration is a separate deployment option.
- [ ] Official submission portal requirements, Indie Developer eligibility, deadline **and timezone**, video duration, repository visibility, Meta integration evidence, and required links are confirmed against the current rules. November 4 is the date supplied for this project, not a deadline independently verified in this guide.

## Backup and release checks

After the real trials, stop the backend (Ctrl+C). These commands assume default `data/`; use your actual `WORLDOS_DATA_DIR` if configured.

```powershell
$submissionStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$submissionDir = Join-Path 'artifacts' ('submission-' + $submissionStamp)
New-Item -ItemType Directory -Path $submissionDir
Copy-Item -LiteralPath .\data\worldos.sqlite3 -Destination (Join-Path $submissionDir 'worldos.sqlite3')
Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $submissionDir 'worldos.sqlite3')
```

Test that copy in a separate terminal without overwriting the original:

```powershell
# Substitute the actual directory created above. This environment setting is process-local.
$env:WORLDOS_DATA_DIR = (Resolve-Path .\artifacts\submission-YYYYMMDD-HHMMSS).Path
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8001
```

Open port 8001, resume the saved trial, and check both photos/results and report without new inference. Stop this server and close that terminal. Keep the backup private: it includes photographs and reviewer/operator names. A trial JSON export is portable evidence, but is not a database restore/import format.

From the repository root, run the release checks:

```powershell
New-Item -ItemType Directory -Force -Path artifacts
.\.venv\Scripts\python.exe -m pytest backend\tests -q --basetemp=artifacts\pytest-submission
npm.cmd test -- --reporter=dot
npm.cmd run build
.\.venv\Scripts\python.exe scripts\smoke_test.py
.\.venv\Scripts\python.exe scripts\smoke_inspect.py
git diff --check
git status --short
```

The two smoke tests create isolated synthetic fixtures. Never copy their databases or browser-QA artifacts into the physical evaluation set. Existing optional paid live tests remain opt-in. One upstream Starlette/httpx deprecation warning remains; Node 25 is outside the declared Vitest engine range, so rehearse on the supported runtime.

## Final hackathon submission sequence

1. Complete the checklist and physical test table. Export the real trial/report with explicit denominators, failures, and assistance. If data is insufficient, write “real-world performance unmeasured/preliminary” rather than reporting software test success as accuracy.
2. Choose the simplest genuinely successful physical trial: distinct objects, one displaced movable object, a stable protected anchor, an open destination, and fixed camera. Keep challenging trials in the evidence report.
3. Record the demonstration within the portal's allowed length: explain the workspace standard; show the real reference and SAM annotations; physically displace an object; upload/align/inspect; show genuine SAM results and Muse explanation; review if needed; show the validated arrow; physically move the object; upload a fresh final photo; show verification and disclose assistance. End with the trial's saved evidence and measured limitations.
4. Record an honest recovery example or retain footage: uncertainty requiring review, a protected-object refusal, or reopening timestamped genuine inference after a provider failure. Label every recorded sequence; do not substitute mock output for a live call.
5. Back up and restore-test SQLite. Retain original video, source photos, labels, and exported evidence privately. Prepare only consented/redacted assets for publication.
6. Run all release checks above. Review the existing uncommitted diff, stage only intended source/tests/docs and safe example configuration, create the release commit, and record its SHA (`git rev-parse HEAD`). Do not stage `.env`, `data/`, or `artifacts/`. Use that exact revision on the demo/deployment machine.
7. Prepare the submission package: short problem/usefulness description; honest Meta SAM/Muse roles; reference-to-verification video; repository link and startup guide; tested deployment link if required; test totals; actual evaluation denominators; remaining geometry/identity/deployment limits. Do not describe Muse as performing the geometric validation or WorldOS as physically moving objects.
8. Open every link as a judge would, confirm permissions/playback, verify the exact official deadline/timezone and required fields, and submit through the portal. Save the submission receipt. No submission or public deployment has been performed by this implementation task.
