# Fast recognition on the device

Live camera now has an on-device object detector. Common-object labels can appear before any cloud response. The API continues adding broader recognition and details in the background at the existing bounded rate. API keys remain on the backend.

Open **Open live camera** with **Live** selected. The model prepares as soon as the active workspace opens, before camera permission is requested. The camera's **On device: … ms** badge reports the latest local result's elapsed time. Labels continue when the cloud service fails; the separate AI-details message explains that failure. **Detailed** keeps the original steady-frame workflow.

## Implementation

- Google's EfficientDet-Lite0 int8 model runs in a dedicated worker using pinned MediaPipe Tasks Vision 0.10.21. The model identifies the COCO categories described in the [publisher's documentation](https://developers.google.com/edge/mediapipe/solutions/vision/object_detector). It does not recognize every possible object. Small or obscured objects can be missed; the default confidence threshold is 0.55.
- The 4.6 MB model ships with the project. `predev` and `prebuild` copy the pinned runtime from npm into the public assets and verify the model's SHA-256. The model, runtime and worker come from the app's own origin. Versioned model/runtime files can use the browser's HTTP cache; camera images and API responses are not cached.
- Model loading and graph warmup happen before inference is marked ready. A cold first load still takes time, especially over a slow connection. Unsupported workers, failed model loads and inference timeouts leave the cloud path available.
- Each local inference receives a captured image no larger than 512 pixels on its long side. Only one local frame may be in flight. The 80 ms sampling loop offers a frame after a minimum 120 ms interval when the worker is free; there is no queue. Actual recognition frequency depends on inference time and device performance.
- Fresh positions use the existing image-motion tracker between detections. Local boxes expire after 1.2 seconds without a fresh detection. Local results take precedence over overlapping cloud boxes; delayed cloud results cannot replace a newer local captured view. Labels with stable identities remain selected during refresh.
- Local snapshots contribute to scene memory at most once per second. Both local and cloud outputs remain attached to their own captured image. **Ask** pauses local updates as well as cloud refresh, keeping its question view fixed. Stop, mode changes, recognition off, navigation, session expiry and memory clearing discard stale pending results. Workers are released on workspace deactivation or unmount; an idle worker stays warm while the active camera is stopped.
- Production CSP permits same-origin workers and WebAssembly compilation, without permitting JavaScript `unsafe-eval`. The worker uses CPU inference so GPU support is not required.

## Measured result

The [recorded check](v24-local-model.json) ran the real local model in desktop Chromium at a 390-pixel viewport, using the bundled public desk photo as a synthetic camera. Cloud recognition was deliberately unavailable. It is not a physical-phone or general-accuracy benchmark.

| Measurement | Recorded result |
| --- | --- |
| Model loading and warmup | 587 ms |
| First label after starting the prepared camera | 410 ms |
| Worker inference range | 76–97 ms |
| Median worker inference | 84 ms |
| Median worker round trip | 84 ms |
| Detected class in this photo | Keyboard |
| External-origin requests | 0 |

The first-label timing includes starting the synthetic camera and waiting for the rendered outline. It excludes the model preparation completed before the camera button was clicked. Per-inference timings exclude the wait until the next sampled frame and must not be presented as end-to-end camera latency. This is substantially faster than the earlier single 4.1-second cloud observation, but it offers a smaller recognition vocabulary.

The browser check also verifies removal on a blank scene, fresh recognition when the image returns, selection surviving refresh, stopping inference when the camera stops, and operation under the production CSP. The cloud fallback checks still pass at 320, 390, 768 and 1440 pixels with worker support disabled deliberately. The [memory fallback check](v24-memory-fallback.json) also passes at 390 and 1440 pixels.

Software validation: **374 frontend tests**, **378 backend tests**, two optional live-provider tests skipped, and a passing production build. Final targeted camera checks pass after the interface text adjustments. Physical phone latency and accuracy remain unverified.

```powershell
npm test
npm run build
.venv\Scripts\python.exe -m pytest backend/tests -q
node scripts/verify_local_detector.mjs --playwright-dir <installed-playwright-directory>
```

The verification uses no paid provider inference. The existing dependency audit reports four moderate development-tool advisories in the Capacitor CLI dependency chain; none is attributed to the new vision runtime.
