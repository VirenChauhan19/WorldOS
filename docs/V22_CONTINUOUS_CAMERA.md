# Continuous camera labels

The subsequent [on-device recognition path](V24_LOCAL_RECOGNITION.md) now supplies fast common-object labels before cloud inference completes. This document describes the original cloud path, which remains available for background detail and as a fallback.

Open **Open live camera** from Home, leave **Live** selected, then **Open camera & recognize**. The camera stays live while AI refreshes. Tap an outline for a short visible detail. **Expand** fills the workspace with the camera; **Controls** restores the panel. **Detailed** retains the existing steady-frame Muse + SAM workflow. Opening **Ask** holds the captured view and pauses recognition requests so automatic refresh cannot cancel a question.

## How it works

- The preview requests a 30 fps camera stream; actual frame rate depends on the device.
- Every 80 ms, a 128 x 96 grayscale thumbnail feeds a bounded local patch tracker. Textured features are matched in both directions and must agree on translation. Unchanged regions retain their labels. Unreliable matches, scene cuts, frame gaps, boxes leaving the image and detections older than 8 seconds remove live outlines. Rotation, zoom, depth and occlusion recovery are not modeled.
- `POST /api/ai/live` sends one JPEG (768 pixels on its long side) through the existing server-side Muse configuration. It returns at most six labels, approximate boxes, a short scene summary and visible details. It makes no SAM calls. Meta uses documented minimal reasoning with a 1,200 token output limit. Explicit provider settings remain respected.
- One request runs at a time per camera. A fresh frame is sampled when capacity becomes available, with a minimum 3.5-second gap between starts. No frame backlog is queued. Local tracking continues while the request runs. Bounded thumbnail history advances a delayed response through the actual observed motion before displaying it.
- The server admits at most two live observations at once, with a 12-second deadline and no provider fallback. Existing authentication, body bounds and rate limits apply. Temporary errors use the existing backoff; credential/contract failures pause recognition. Disconnection can leave a provider call running until its deadline; cancellation cannot undo already billed work.
- Camera stop, navigation, session expiry and backgrounding cancel client requests, clear the frame history and release camera tracks. Automatic recognition off leaves a local preview. Images and keys are not stored in browser storage by this feature. The API key remains on the backend.

This is a 2D camera augmentation, not Vision Pro tracking or a physical placement engine. Approximate model locations and local image tracking can be wrong. For measured, world-anchored footprints, the existing supported WebXR flow is separate. There is no claim of per-frame cloud reasoning or sub-second recognition.

The subsequent [scene memory feature](V23_SCENE_MEMORY.md) retains captured views across camera motion and restores last-known spots when a view is recognized. Its dashed remembered outlines are separate from the short-lived live detections described here.

## Evidence

One real-provider check on the bundled public desk photograph returned six objects in **4,050 ms** total (4,047 ms provider time). [Recorded response](v22-live-observation.json). An earlier attempt without minimal reasoning failed validation after 7.4 seconds; the corrected request completed successfully. This is a single observation, not an accuracy or latency benchmark. A physical phone camera rehearsal remains outstanding.

Software checks pass: 356 frontend tests, 376 backend tests (2 optional live tests skipped), and the production build. Coverage includes continuous scheduling, no overlapping requests, cancellation, mode changes, question-view pinning, image translation, stale-response replay, occlusions and expiry. The [Chromium check](v22-camera-browser.json) passes at 320, 390, 768 and 1440 pixels using a synthetic moving camera and mocked AI, covering labels, details, responsive layouts, expanded mode, toolbar clearance, refresh and stop. Run:

```powershell
npm test
npm run build
.venv\Scripts\python.exe -m pytest backend/tests -q
node scripts/smoke_continuous_camera.mjs --playwright-dir <installed-playwright-directory>
# Optional: one potentially billed call using the public test image
.venv\Scripts\python.exe scripts/verify_live_observation.py --run-live
```

Provider references: [Meta image grounding](https://dev.meta.ai/docs/image-understanding#localize-objects-with-perception-grounding), [Chat Completions parameters](https://dev.meta.ai/docs/protocols/chat-completions). These establish the API inputs and reasoning controls; they do not guarantee this application's latency or tracking accuracy.
