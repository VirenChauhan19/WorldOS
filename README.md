# WorldOS V1.2

**Save your setup. Check what changed. Put things back.** The new default experience is a focused photo wizard with Home, My Spaces, and Settings. Spatial Studio, detailed annotation, diagnostics, and physical evaluation tools remain under **Settings → Advanced**. See the [V1.2 usability redesign, test evidence, and deployment notes](docs/V12_USABILITY.md).

**V1.2 is ready for deployment review, not deployed.** Validation: 326 backend tests passed (2 optional live tests skipped), 156 frontend tests passed, production web/mobile asset builds and all four HTTP smoke scripts passed. The complete manual workflow was exercised with labeled synthetic fixtures in a phone-width browser. This does not validate physical accuracy, live automatic inspection, or a real iPhone. The previously observed SAM model-access blocker remains unresolved; no new live AI calls were made for V1.2.

**V1.1 reliability work is ready for deployment review; production was not redeployed.** See [real-world readiness, fixes, live AI evidence, and the guided phone test](docs/V11_REAL_WORLD_READINESS.md). Current live verification: Baseten Muse goal interpretation passed; Meta SAM 3.1 returned a model-access error. The complete physical workflow and real iPhone experience remain unverified. Historical results below do not supersede that current limitation.

**V0.8 defaults to Render Free: one $0-compute web service, no disk or paid database.** Follow the [Free Blueprint retry and iPhone installation guide](docs/V08_DEPLOYMENT.md). **SQLite data, uploaded photos, inspections, backups, and login/session state may be lost on restarts, redeployments, or idle spin-down.** Export important work to your device. Authentication, CSRF, Meta SAM 3.1, Baseten Muse Spark, Inspect, and Spatial Studio remain available. External AI calls retain their provider costs. The original Standard + disk option is separate in [deploy/render.paid.yaml](deploy/render.paid.yaml) for future paid use. No paid service was authorized by this change.

V0.8 validation: **310 backend tests passed (2 optional live tests skipped), 124 frontend tests passed, production build and four HTTP smoke scripts passed.** Separate real provider connectivity checks passed for Meta SAM 3.1 and Baseten Muse Spark through local production-mode authentication; this does not verify a hosted URL or physical accuracy. See [the sanitized live connectivity record](docs/v08-provider-connectivity.json).

**Owner and judge access:** optional, expiring judge logins use a separate demo workspace (ephemeral on Free), with no access to owner data, backups, or connection probes. Judges can complete the existing scan, review, correction, and verification workflow. See the [judge setup and revocation instructions](docs/V08_DEPLOYMENT.md#optional-controlled-judgedemo-access). Judge access is disabled by default.

**Mobile app infrastructure is implemented:** responsive Inspect and Spatial Studio, camera/library controls, touch selection and zoom, an installable PWA with an honest offline screen, generated Capacitor Android/iOS projects, and authenticated HTTPS backend deployment configuration. API credentials remain backend-only. Start with the [V0.7 installation, deployment, native builds, test results, and device checklist](docs/V07_MOBILE.md).

V0.7 validation: **283 backend tests passed (2 optional live tests skipped), 117 frontend tests passed, production build and three HTTP smoke scripts passed.** Native projects were generated and synchronized; **no APK/AAB/IPA was compiled**, and physical-device camera/install validation remains required. Docker deployment was configured but not run. The earlier release notes below retain their historical results.

**Baseten Muse Spark is integrated and live-tested for connection, goal interpretation, and Inspect explanations.** Meta SAM 3.1 remains the detector; the geometric planner and existing workflows are preserved. See the [V0.6 integration, actual request results, configuration, and remaining blockers](docs/V06_BASETEN.md). Baseten credentials stay in the ignored backend `.env`. Physical inspection accuracy is still unmeasured.


**WorldOS Inspect adds persistent visual workspace standards, camera alignment, conservative inspection, and geometric restoration.** Open the app to create a reference template, inspect a new photo, review uncertainty, generate correction arrows, and verify another photo. Templates and inspection history persist in local SQLite. The existing desk workflow remains available under **Spatial Studio**.

Start with the [V0.5 startup, first-template, inspection, demo, and evaluation guide](docs/V05_INSPECT.md). [Current Inspect physical evaluation report](docs/inspect-evaluation/results.json): **0 captured photo pairs / 10 defined scenarios; real-world inspection performance is unmeasured.** No V0.5 live provider inspection has been performed in this checkout.

**Demo preparation:** the in-app **Evaluate real photographs** workflow now freezes independent labels before inference, saves inspection/corrected captures and failed attempts, retains original and human-assisted decisions, and exports trial evidence and metrics. Follow the [guided physical trials, demo readiness checklist, backup procedure, and final submission steps](docs/DEMO_READINESS.md). Software validation: **243 backend tests passed (2 optional live tests skipped), 76 frontend tests passed, production build and both HTTP smoke tests passed**. These are not physical accuracy measurements.

Earlier desk releases and their historical observations are documented below.

**V0.4 adds Demo Mode, stronger conservative identity matching, blocker-first movement ordering, fixed-space conflict explanations, bounded inference caching/request sharing, and a ten-scenario physical evaluation workflow.** Start with the [V0.4 demo recording runbook and evaluation protocol](docs/V04_DEMO_AND_EVALUATION.md). [Current physical evaluation report](docs/evaluation-v04/results.json): **0 captured / 10 specified scenarios; real-world movement accuracy remains unmeasured.** Existing single-photo V0.3 observations below are historical evidence, not physical movement trials.

For the first real provider request, follow [First AI connection inference](docs/FIRST_INFERENCE.md): exact credential locations, backend environment setup, the **AI Connection Status** panel, and **Test AI Connection**.

A working spatial planning MVP for the Meta Global AI Developer Hackathon 2026, Indie Developer Track. Upload a photo of a flat surface, annotate objects, specify the area to clear, and receive collision-aware movement instructions. Photograph the result, verify detected or manually reviewed placements, and adapt the plan to the current scene.

**V0.2 adds opt-in, reviewed AI assistance.** Muse Spark reasoning and the selected Meta Model API SAM 3.1 path are implemented against official contracts and validated with real provider requests on synthetic fixtures. V0.3 has now exercised real desk photos; detection gaps and an unchanged-photo verification control are documented in the V0.3 guide. Reliable physical before/after accuracy remains unmeasured. The requested Baseten SAM path is explicitly blocked pending your deployment-specific request/response contract. Manual mode works without keys. See [AI integration setup, exact environment variables, verified sources, test instructions and limitations](docs/AI_INTEGRATION.md).

**V0.3 adds automatic after-photo verification, conservative identity review, protected-object checks, and adaptive replanning.** Follow [V0.3 workflow, reproducible photo benchmark, actual results, and limitations](docs/V03_VERIFICATION.md). The deterministic planner remains unchanged.

The included desk is an original illustration with manual annotations; it uses the same real planner as uploads. Upload alone never sends a photo to a model provider.

## Run on Windows PowerShell

Requirements: Python 3.12+ and Node.js 22.13+ or 24+ (tested with Python 3.12 and Node 24). Run commands from the repository root. Activating the virtual environment is optional; all examples invoke its Python directly so PowerShell execution-policy changes are unnecessary.

First-time setup:

```powershell
Set-Location C:\Users\Administrator\Desktop\Github_AI201\WorldOS
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
npm ci
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

Start the backend in terminal 1:

```powershell
Set-Location C:\Users\Administrator\Desktop\Github_AI201\WorldOS
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

Start the frontend in terminal 2:

```powershell
Set-Location C:\Users\Administrator\Desktop\Github_AI201\WorldOS
npm run dev
```

Open **http://127.0.0.1:5173**. API docs: **http://127.0.0.1:8000/docs**. Vite proxies `/api` to FastAPI, so no frontend API keys or custom base URL are needed. Stop each server with Ctrl+C. If a port is occupied, stop the existing process using that port before relaunching; Vite deliberately does not silently switch ports.

Optional single-server local build (build first, then start FastAPI; no Vite server needed):

```powershell
npm run build
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Open **http://127.0.0.1:8000**. FastAPI serves `dist/` when it exists at startup. Local loopback mode may run without a login; public deployment requires authentication and HTTPS. SQLite persists saved templates and inspections. See the V0.8 runbook for production setup.

## Test the complete workflow

1. **Explore the sample.** The included illustration has six manual object boxes, a laptop-sized target, and three locks. Click **Generate spatial plan**. The API calculates placements for the notebook and headphones, shows numbered arrows, and preserves coffee, plant, and keyboard. Export the full request and result using the download icon. The original image is never presented as a synthesized after-photo.
2. **Use a real scene.** Click **Understand**, then **Upload photo**, or drop a JPEG, PNG, or WebP onto the scene. Uploads are limited to 12 MB and 24 megapixels. The API decodes the image, corrects EXIF orientation, and resizes large images to at most 1800 pixels on the long side. A new photo clears all previous annotations.
3. **Annotate the surface.** Choose **Object**, then drag tight, non-overlapping boxes around every relevant obstacle. Select a box to change its label, drag it, resize its bottom-right handle, edit its percentages, or delete it. Up to 12 objects are supported. Use lock icons to protect objects. Locks constrain the planner; you can still edit their annotations. If the whole image is not usable desk space, choose **Surface** and draw a rectangular workspace enclosing every object and the target.
4. **Specify the goal.** Choose **Target** and drag a region to clear. Enter, for example, `Make room for my laptop without moving my coffee.` Label-based protection supports `without moving`, `do not move`, `don't move`, `keep`, `leave`, and `avoid moving`. Use exact object labels and review the locks reported in the plan. The target rectangle, rather than free-text object dimensions, specifies the required free space. For broader goal interpretation, use **Interpret goal with Muse Spark** and explicitly apply its reviewed protected-object constraints. Unsupported requirements must be resolved or explicitly handled in manual mode.
5. **Follow the plan.** Click **Generate spatial plan** and follow the numbered lift-and-place instructions in order. Destinations and percentages are measured from the top-left of the entire image. The plan preserves orientation and dimensions. Existing unmodeled obstacles can invalidate a plan, so annotate everything on the usable surface.
6. **Verify.** Click **I’ve made the moves**, upload a genuine final photo with the same aspect ratio, framing, and camera angle. The app initializes editable boxes at their **original** positions, never the expected destinations. Drag or numerically edit each final box to match what you observe, including locked objects. Confirm every checkbox, then click **Verify placements**. Changing a box clears its confirmation and previous results. A changed photo also resets observations and confirmations.
7. **Compare and export.** Switch between **Before**, **After**, and **Side by side**. Verification reports per-object matches, target intrusion, collisions, and workspace violations. Export the JSON report, including the original request, plan, final annotations, and verification. Manual verification checks annotation geometry. Alternatively, use **Automatic Verify** for SAM analysis, review uncertain identities and the scene inventory, then **Replan from Current State**. See the V0.3 guide for the complete adaptive loop and real-photo limitations.

Failure cases to try:

- Lock the notebook while it overlaps the target: the planner reports a proven locked-object conflict. The goal can also infer a lock even when the UI lock is off; edit the goal to remove that constraint.
- Draw a target covering almost the whole surface: the planner can prove an area or rectangle-fit conflict.
- Overlap object annotations or put the target outside the surface: the API returns a readable validation error.
- Leave the original positions in final annotations: verification reports the moved objects as mismatches and flags target intrusion.
- Move a locked final object by more than 1% of the image: verification fails that object.
- Stop FastAPI: the UI reports an offline engine and failed requests remain recoverable.

## Automated checks

```powershell
.\.venv\Scripts\python.exe -m pytest backend\tests -q
npm test
npm run build
```

Backend coverage includes deterministic plans, sequential collision freedom, randomized layouts, locked-object and goal constraints, bounds validation, proven impossibility, search limits, final-position verification, exact IDs, duplicate IDs, upload decoding, file limits, EXIF orientation, downsampling, and API integration. Frontend tests exercise normalized drawing, dragging, resizing, viewport-independent coordinates, plan submission, label/lock edits, error recovery, upload resets, final-photo aspect ratios, individual verification confirmations, and invalidating stale results. UI tests isolate the API client; backend integration tests exercise the real endpoints. The TypeScript build checks the complete frontend.

After building, test the production frontend and all endpoints over real HTTP:

```powershell
.\.venv\Scripts\python.exe scripts\smoke_test.py
```

This launches its own temporary Uvicorn process on a free loopback port, uploads a real PNG, plans and verifies a scene, checks failure cases and the static app, then stops that process.

For reproducible upload/comparison QA without taking photos, run `.\.venv\Scripts\python.exe scripts\create_test_scene.py`. It creates clearly labeled, programmatically drawn `artifacts/qa/before.png` and `after.png` plus `reference.json`. Upload the before fixture, annotate the two rectangles using the percentages in the reference, draw the listed target, and generate a plan. Upload the after fixture and annotate its actual rectangles to exercise successful verification. These are synthetic test fixtures, not evidence of physical execution or AI vision.

## API

| Endpoint | Input | Behavior |
| --- | --- | --- |
| `GET /api/health` | — | Engine and adapter status |
| `POST /api/analyze` | Multipart `image` | Validate, orient, resize; return normalized display image and empty manual annotation list |
| `POST /api/ai/analyze` | Inline image + optional concepts | Explicit, configured SAM analysis; optional Muse concept discovery |
| `POST /api/ai/verify` | Current/original request, before/after inline images, framing/inventory checks | SAM detection, conservative identity matching, placement assessment |
| `POST /api/verify/reviewed` | Reviewed current identities and obstacles | Check original protected anchors and current placements without inference |
| `POST /api/replan` | Reviewed current scene + original/current requests | Preserve goal/locks and generate revised deterministic movements |
| `POST /api/ai/reason` | Objects, goal, target, optional inline image | Muse Spark structured constraints for review |
| `POST /api/plan` | `PlanRequest` | Validate scene, apply locks, search for sequentially feasible placements |
| `POST /api/verify` | `{plan_request, observed_objects, tolerance?}` | Recompute the deterministic plan and compare observed geometry |

Example planning payload:

```json
{
  "goal": "Make room without moving coffee",
  "workspace": {"x": 0, "y": 0, "width": 1, "height": 1},
  "target": {"x": 0.3, "y": 0.3, "width": 0.4, "height": 0.4},
  "clearance": 0.008,
  "objects": [
    {"id": "book", "label": "Book", "box": {"x": 0.4, "y": 0.4, "width": 0.15, "height": 0.2}, "locked": false},
    {"id": "coffee", "label": "Coffee", "box": {"x": 0.8, "y": 0.1, "width": 0.1, "height": 0.1}, "locked": true}
  ]
}
```

All coordinates use `[0, 1]`, relative to the oriented image. Width and height must be positive; boxes must fit inside the image and workspace. IDs must be unique and stable across verification. Boxes cannot overlap in the initial scene.

Plan statuses:

- `ready`: a sequentially collision-free layout and numbered movements were found.
- `already_clear`: no movement is needed.
- `impossible`: a specific conflict is proven: protected target obstruction, insufficient area, or an object that cannot fit on any side of the target.
- `search_limit`: the bounded search found no solution. This does **not** establish mathematical impossibility.

## Planning and verification model

The planner uses axis-aligned rectangles, workspace boundaries, object/target edge alignments, and a coarse grid to enumerate candidates. Deterministic distance ordering and bounded backtracking consider target blockers first and can relocate other unlocked objects to open space. Every destination is checked against **current** occupied positions, the target, and the workspace. It moves each object at most once and may not find layouts that need temporary staging or rotation. Search is capped at 2,500 states / 180,000 candidate checks. It seeks a valid plan, not a globally shortest or minimum-movement plan.

Clearance is 0.8% of each image axis by default. Coordinates measure image space, not metric physical distances. Use a near-overhead photo of one flat surface. Perspective, object depth, load bearing, reachability, lift trajectories, and stability are not modeled. Instructions explicitly use lift-and-place rather than claiming collision-free sliding paths.

Verification compares maximum left/top/right/bottom edge error, with a 2.5% tolerance by default (1% maximum for locked objects), and checks target clearance, object collisions, and workspace bounds. The API requires the exact original object IDs and recomputes the plan rather than trusting client-submitted expected positions. Same aspect ratio is checked for final uploads, but camera registration is manual. Manual success means reviewed annotations match. Automatic success requires supported identities and camera/inventory confirmation, and remains dependent on model detections. V0.3 does not automatically register camera motion. Original protected anchors survive replanning; moved protected objects block revision.

## Structure and future integration

```text
src/App.tsx              Workflow and application state
src/Canvas.tsx           Normalized SVG annotations, drag/resize, arrows
src/geometry.ts          Coordinate utilities and unit tests
src/api.ts               Upload, plan, and verify API client
src/styles.css           Responsive dark interface and Tailwind import
public/sample-desk.svg   Original, clearly labeled sample illustration
backend/main.py         FastAPI routes, Pillow image processing, local static serving
backend/models.py       Pydantic request/response contracts
backend/planner.py      Geometry, bounded search, verification
backend/adapters.py     Manual/rule implementations and async provider interfaces
backend/ai_adapters.py  Verified Meta SAM and Muse request/response adapters
backend/providers.py    Credentials, deadlines, safe logs, provider status
backend/ai_service.py   Concept discovery and segmentation orchestration
backend/visual_verification.py  Identity matching, evidence review, adaptive replanning
backend/evaluation.py   Scoped reference-box comparison
scripts/evaluate_vision.py  Explicit real-photo detection benchmark
backend/tests/          Planner and API tests
```

V0.2 implements the async provider interfaces in `backend/ai_adapters.py`, authenticated transport and usage logging in `backend/providers.py`, orchestration in `backend/ai_service.py`, and explicit review controls in `src/AIPanel.tsx`. `backend/planner.py` remains unchanged. Reviewed constraints are resolved into protected locks outside the planner. See [the integration guide](docs/AI_INTEGRATION.md) for the verified API contracts and the Baseten blocker.

Environment variables load from root `.env`; see `.env.example`. No credentials are required for manual mode. AI credentials belong exclusively on the backend. Never use the `VITE_` prefix for secrets because Vite embeds those values into browser bundles. Images are processed in memory and returned to the browser; no uploads or annotations are persisted. Refreshing clears the current session. Export a report before refreshing if you need a record. Explicit AI actions send the photo and/or goal to the configured provider. No external telemetry is configured; sanitized usage events are written to backend logs.

The project uses [Vite](https://vite.dev/guide/) and FastAPI’s [multipart upload handling](https://fastapi.tiangolo.com/tutorial/request-files/). Python dependencies have compatible version ranges; `package-lock.json` locks frontend dependency resolution.
