# WorldOS

**Make room. Get going.**

The new **AR interior studio** lets you build and edit a scene from a collection of 26 furniture and everyday models, then preview it in your space on a supported device. Open **AR studio** in the navigation or from Home. Read [the interior studio guide](docs/V30_AR_INTERIOR_STUDIO.md) for the editing workflow, platform capabilities, and validation limits.

The reliability pass fixes workspace navigation, private-room persistence, setup conflicts, interrupted saves, and session recovery. Public AI demos now open without an owner passphrase, with a separate workspace and bounded usage for each visitor. Read [public demo access](docs/PUBLIC_DEMO.md), [the reliability audit](docs/RELIABILITY_AUDIT.md), [the workspace upgrade](docs/WORKSPACE_UPGRADE.md), and [the real-phone study guide](docs/PHONE_USABILITY_STUDY.md). Physical-device and participant testing still need to be performed.

Get your space ready to study, work, or create. WorldOS turns a photo and a goal into a short, practical sequence, then helps you check the result and remember the setup that worked for you.

Built for the Meta AI Hackathon with **Muse Spark and SAM 3.1**.

- **Start with a purpose:** focus, make room to create, reset, or write your own goal.
- **Use your actual space:** recognize visible items, choose what stays, and get steps linked to the captured photograph.
- **Learn as you go:** one instruction at a time, an explanation, and a concrete check. Progress survives reloads; a fresh photo helps adapt the remaining work.
- **Check and reuse:** compare before/after photos, review uncertainty, and save a named setup to guide the next reset. Export and restore routines when needed.
- **Go deeper:** live camera questions, measured fit, Room Studio, and the advanced geometry editor remain available.

Open **http://127.0.0.1:5173** and choose **Get my space ready** to pick a goal and photo. The app opens immediately without a login and keeps this draft on your device; continuing to guided steps connects to the private workspace. **Open live camera**, the recorded example, local checklists, and saved room layouts remain available from the device app. Read [device storage and interactive camera behavior](docs/V25_DEVICE_WORKSPACE.md).

Home offers camera, room, and setup actions with navigation available throughout the device app. Camera controls stay beside the preview, room planning guides the next step, and setup changes save automatically. Read [the consumer experience and checks](docs/V27_CONSUMER_EXPERIENCE.md). Read [the submission presentation update](docs/V29_SUBMISSION_PRESENTATION.md) for the current forest-and-lime workspace, interactive home preview, responsive navigation, and screen treatments. The [previous visual design](docs/V28_VISUAL_DESIGN.md) remains documented for reference.

In the private workspace, the guided flow is **Photo → Steps → Check**. Start without typing, follow one visible instruction at a time, and save a preferred setup with one explicit action. Optional goals, notes, explanations, and the full step list stay available when needed.

Read the [simplified experience](docs/V21_EASY_TO_USE.md), [judge demo](docs/HACKATHON_DEMO.md), [current implementation and evidence](docs/V20_USEFUL_WORKSPACE.md), [scene-question notes](docs/V19_PRODUCT_EXPERIENCE.md), and [camera reliability notes](docs/V18_CAMERA_RECOGNITION.md).

## Live camera mode

Choose **Open live camera** on Home for fast on-device labels over the camera preview. Common-object recognition runs locally in the device workspace. The optional private workspace adds API details in the background. The real local-model browser check measured 76–97 ms per inference after preparation. First camera labels took 410 ms in that controlled test; physical-phone performance remains unverified. Tap labels for details or use **Expand** for the camera workspace. **Detailed** in the private workspace retains the steady SAM scan. See [local recognition and evidence](docs/V24_LOCAL_RECOGNITION.md) and the [cloud camera path](docs/V22_CONTINUOUS_CAMERA.md). This is 2D image augmentation, not headset-grade 3D anchoring.

**Memory** remembers seen areas and items while you look around. Name an area, search for an item, and return toward its last-seen photo to recover remembered spots locally. **Help me with this area** starts a guided task from that photo. Memory lasts for this page session and has bounded capacity; this is visual view recognition, not a 3D room map. See [memory behavior and evidence](docs/V23_SCENE_MEMORY.md).

## Plan the room in front of you

Open **Room planner**, capture or choose a room photo, and let AI estimate its floor outline, approximate size, visible features, and occupied/access areas. Describe what you want—such as a sofa, a reading corner, and a desk near the window—then choose **Design my room**. The designer proposes furniture and placement reasons; the deterministic solver checks the modeled boundaries, overlaps, gaps, and reserved areas before showing stylized furniture directly on the original photo, in 3D, and in the floor plan. Slide between before/after, select furniture, or download the concept image. Try Balanced, More open space, or Focus & daylight, then refine your request or undo the design. No measurements or corner marking are required in the photo flow. These are approximate visual estimates with plausible ranges, not measured dimensions or a verified physical fit. Room AI uses the configured backend vision provider and existing authentication. See [photo room designer](docs/V27_PHOTO_ROOM_DESIGNER.md).

## Design a space in AR

Open **AR studio** (`#/ar`) to arrange up to 24 independent objects. Search the collection, try a living-room or workspace starter, and edit each piece's dimensions, finish, position, height above the floor, and rotation in 90-degree steps. Drag pieces in **Floor plan**, use the arrow keys for 10 cm moves, or inspect the scene in **3D studio**. Changes save locally; undo, redo, and JSON export/restore are available. The starting plan and model sizes are editable examples.

Browsers with the required native WebXR features offer **Start interactive AR**: place the whole design or individual pieces on tracked horizontal surfaces, then keep adding and editing in the AR view. On compatible iPhone/iPad Safari, **View in my room** opens a local USDZ in Apple Quick Look. Choose the whole design or one selected piece; the exported design moves as one group in Apple's viewer. Quick Look edits do not return to the website. WebXR world positions last for that AR session, while the editable layout persists. Physical-phone AR behavior and placement accuracy remain unverified. See [implementation and checks](docs/V30_AR_INTERIOR_STUDIO.md).

## Validation and status

**571 frontend tests pass** for the interior studio update, and the production build passes. The previous backend run passed 403 tests, with 2 optional live tests skipped; backend code is unchanged. Interior-studio browser checks at 320, 390, 768, and 1440 pixels cover multiple objects, floor-plan dragging, editing, export/restore, reload, and actual USDZ generation. Physical-phone AR testing remains outstanding. The room designer also passed production browser checks at 320, 390, and 1440 pixels, live-provider analysis/design on two real room photographs, and a follow-up bookshelf request that preserved the existing arrangement. Browser photo checks replay the recorded provider results; metric accuracy is unverified. The production build passes. Chromium checks cover 320, 390, 768, and 1440 pixel layouts, persisted progress, reusable routines, export/restore, portrait overlays, and the camera/question flow. Camera memory checks cover looking away and returning, finding an earlier item, and clearing memory at 390 and 1440 pixels. Most browser checks use synthetic model output. The separate local-detector check runs the real bundled model on a synthetic camera feed with cloud inference blocked; it is not a physical-phone or general-accuracy benchmark.

Separate real-provider checks on one public desk photo returned **17 detections in 20.3 seconds** (12 displayed), a scene answer in **6.1 seconds**, and a three-step task plan in **23.3 seconds**. These are individual integration observations, not benchmarks. See [recognition](docs/v18-live-recognition.json), [question](docs/v19-scene-question.json), and [task-plan evidence](docs/v20-mission-plan.json).

Validation above describes the tested source build; the hosting service and release CI track deployment separately. Actual phone camera/AR behavior and physical before/after task assessment still need rehearsal. Photo-based room dimensions are estimates; real-room accuracy and physical clearance remain unverified. The private workspace on free hosting uses ephemeral storage; export routines from its My Spaces view and restore those backups after a reset. Device setups and room drafts are saved in your browser, independently of the server. [Deployment instructions](docs/V08_DEPLOYMENT.md) and [historical releases](docs/RELEASE_HISTORY.md) remain available.

## Run on Windows PowerShell

Requirements: Python 3.12+ and Node.js 22.13+ or 24+ (tested with Python 3.12 and Node 24). Run commands from the repository root. Activating the virtual environment is optional; all examples invoke its Python directly so PowerShell execution-policy changes are unnecessary.

First-time setup:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
npm ci
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

Start the backend in terminal 1:

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

Start the frontend in terminal 2:

```powershell
npm run dev
```

Open **http://127.0.0.1:5173**. API docs: **http://127.0.0.1:8000/docs**. Vite proxies `/api` to FastAPI, so no frontend API keys or custom base URL are needed. Stop each server with Ctrl+C. If a port is occupied, stop the existing process using that port before relaunching; Vite deliberately does not silently switch ports.

Optional single-server local build (build first, then start FastAPI; no Vite server needed):

```powershell
npm run build
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Open **http://127.0.0.1:8000**. FastAPI serves `dist/` when it exists at startup. The device app opens without a login. Private server access may run without a login on loopback; public API deployment requires authentication and HTTPS. SQLite persists saved templates and inspections. See the V0.8 runbook for production setup.

## Advanced Spatial Studio workflow

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
| `POST /api/ai/ask` | Captured image, question, detected objects | Grounded scene answer, existing object references, and a suggested next action |
| `GET /api/missions` | ? | List scoped resumable tasks and reusable routines |
| `POST /api/missions` | Client UUID, goal, constraints, image, optional routine | Save a task capture before inference |
| `POST /api/missions/{id}/observe` | Revision, optional new image | Recognize the current capture; preserve history when adapting |
| `POST /api/missions/{id}/plan` | Revision, protected IDs, feedback | Structured Muse steps with validated object references |
| `POST /api/missions/{id}/progress` | Revision, step ID, boolean | Save user-reported progress |
| `POST /api/missions/{id}/check` | Revision, fresh after image | Compare actual photos against current steps |
| `POST /api/missions/{id}/routine` | Revision, name, explicit confirmation | Save the user's preferred setup |
| `POST /api/missions/routines/import` | Validated routine export fields | Restore a reference with a new ID; no inference |
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

## Structure

```text
src/WorldOS.tsx          Product navigation and screen lifecycle
src/screens/ProductHome.tsx  Product home and saved-space entry points
src/showcase/            Interactive recorded scan and product styling
src/missions/           Persistent guided tasks, photo reviews, and reusable routines
src/live/               Camera lifecycle, recognition, scene questions, and measured fit
src/room/               Combined furniture planning and supported native AR
src/ar/                 Editable interior scenes, object collection, and AR placement
src/App.tsx              Advanced Spatial Studio workflow and application state
src/Canvas.tsx           Normalized SVG annotations, drag/resize, arrows
src/geometry.ts          Coordinate utilities and unit tests
src/api.ts               Upload, plan, and verify API client
src/styles.css           Responsive dark interface and Tailwind import
public/sample-desk.svg   Original, clearly labeled sample illustration
backend/main.py         FastAPI routes, Pillow image processing, local static serving
backend/missions.py     Goal planning, task persistence, photo assessment, routine restore
backend/mission_models.py  Strict task, step, and review contracts
backend/models.py       Pydantic request/response contracts
backend/planner.py      Geometry, bounded search, verification
backend/adapters.py     Manual/rule implementations and async provider interfaces
backend/ai_adapters.py  Verified Meta SAM and Muse request/response adapters
backend/providers.py    Credentials, deadlines, safe logs, provider status
backend/ai_service.py   Concept discovery, segmentation, and scene-question orchestration
backend/visual_verification.py  Identity matching, evidence review, adaptive replanning
backend/evaluation.py   Scoped reference-box comparison
scripts/evaluate_vision.py  Explicit real-photo detection benchmark
backend/tests/          Planner and API tests
```

V0.2 implements the async provider interfaces in `backend/ai_adapters.py`, authenticated transport and usage logging in `backend/providers.py`, orchestration in `backend/ai_service.py`, and explicit review controls in `src/AIPanel.tsx`. `backend/planner.py` remains unchanged. Reviewed constraints are resolved into protected locks outside the planner. See [the integration guide](docs/AI_INTEGRATION.md) for the verified API contracts and the Baseten blocker.

Environment variables load from root `.env`; see `.env.example`. No credentials are required for manual mode. AI credentials belong exclusively on the backend. Never use the `VITE_` prefix for secrets because Vite embeds those values into browser bundles. Device photo setups persist in browser storage after Save; Room Studio saves its device draft automatically. Private missions and inspections use server storage. Unsaved Advanced Spatial Studio annotations remain in memory; export a report before refreshing that editor if you need a record. Explicit AI actions send the photo and/or goal to the configured provider. No external telemetry is configured; sanitized usage events are written to backend logs.

The project uses [Vite](https://vite.dev/guide/) and FastAPI’s [multipart upload handling](https://fastapi.tiangolo.com/tutorial/request-files/). Python dependencies have compatible version ranges; `package-lock.json` locks frontend dependency resolution.
