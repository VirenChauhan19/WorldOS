# Live Space: camera, spatial AR, and measured fit

“Check my space” now opens a camera-first view for comparing a desired item with an available rectangular area. The older saved-photo inspection remains available through “Compare with a saved setup.”

## Camera experience

The user starts the camera explicitly. The rear camera is preferred, audio is disabled, and the preview preserves its aspect ratio. Camera permission requires a secure context; permission failures and unavailable cameras have recovery messages. This follows the browser permission model documented by [MDN: getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).

With automatic recognition enabled, `useLiveCamera.ts` checks a small frame sample every 200 ms. After approximately 800 ms without a detected image change, it sends a compressed frame to the existing `analyzeAI(image, [])` endpoint. Automatic requests are spaced at least 12 seconds apart, with one request in flight. A recognition failure pauses further automatic requests until an explicit retry or toggle.

These object boxes describe the last steady frame; they are **not world-tracked objects**. Detected image changes clear the boxes, and stale responses are discarded. The image-change guard can miss subtle motion and is not a substitute for spatial tracking. The desired item picker chooses what the user wants to add, not what the recognition service should label in the existing scene. Camera frames leave the device only for enabled recognition through the configured AI service. The camera stops when leaving, hiding the page, or entering spatial AR.

## Spatial AR and fallback

`xr.ts` uses the browser's native WebXR implementation and WebGL. It checks `isSessionSupported('immersive-ar')`, then requests a user-initiated session with hit testing and a DOM overlay. It prefers a `local-floor` reference space and falls back to `local`. This structure follows [Google's WebXR session and hit-test tutorial](https://developers.google.com/ar/develop/webxr/hello-webxr) and the [MDN WebXR API](https://developer.mozilla.org/en-US/docs/Web/API/WebXR_Device_API).

Three selected ground points define a rectangle: the first two define its width, and the third defines the perpendicular opposite edge. The engine estimates dimensions in metres and renders the available rectangle, proposed item footprint, and margin in the session's reference space as the camera moves. Invalid or non-level selections are rejected. Lost tracking suspends the fit result; a reference-space reset clears the measurement. The implementation does not infer an empty area, scene occupancy, height, or a 3D obstacle map.

Support is determined at runtime, including failure to obtain required session features. An [Apple engineer's June 2024 forum answer](https://developer.apple.com/forums/thread/756850) documented limitations then; it is historical context, not proof of every current iPhone or Safari version's capabilities. When this browser cannot start the required AR session, camera recognition and manually entered tape measurements remain available. Production sends `Permissions-Policy: camera=(self), xr-spatial-tracking=(self), microphone=(), geolocation=()`.

## Fit interpretation

`fit.ts` compares dimensions in metres at 0° and 90°. Requested clearance is reserved on **both horizontal sides** of each axis. It reports:

- **Fits:** footprint and requested side clearance fit the measured rectangle.
- **Too tight:** the footprint fits, but the requested side clearance does not.
- **Does not fit:** neither footprint orientation fits, or entered item height exceeds entered available height.
- **Unknown:** required measurements are missing or invalid.

Height is checked only when both heights are supplied; overhead clearance is not inferred. Example laptop, chair, cabinet, and car sizes are editable and require actual-size review. “What else fits?” lists independent alternatives, not a plan to fit all suggestions simultaneously.

A vehicle result concerns its parked rectangular footprint only. It does not assess obstacles, turning paths, doors, mirrors omitted from dimensions, people, slopes, or measurement error, and it is not driving guidance. Recognition does not establish free space or a reliable scale from camera pixels.

## Validation and operational limits

- Production TypeScript/Vite build passed. All **211 frontend tests across 26 files** passed, including camera lifecycle, XR lifecycle, and the 18 focused fit-engine tests.
- Backend security and production regression: **36 tests passed** with a workspace-local pytest temporary directory. One existing Starlette/httpx deprecation warning remains.
- Chromium browser checks with a fake camera passed at **320, 390, 768, 1024, and 1440 CSS pixels**, with no horizontal overflow or page errors. The checks covered automatic recognition with empty concept inputs, camera release, permission recovery, and fit states. These are software fixtures, not real camera evidence.
- Simulated WebXR exercised **187 WebGL draws**, transparent overlay rendering, three-point measurement, item switching, tracking-loss suspension, and clearing the fit when ending AR. No page errors occurred. The session and poses were simulated; physical tracking was not tested.
- One bounded real automatic analysis of a freshly downloaded **public Unsplash photograph** succeeded on 2026-10-29. With `concepts: []`, Meta Muse Spark 1.3 discovered concepts and Meta SAM 3.1 returned **12 detections in 12.6 seconds**. This verifies one live discovery/localization request chain, not detection accuracy, sustained provider reliability, physical clearance, or a deployed website. No private photograph was used. See the [sanitized live provider record](v15-live-recognition.json).
- Real camera quality, physical measurement accuracy, native WebXR tracking, and the target hackathon device have **not been hardware-validated** in this work.

Detailed local browser evidence and screenshots are in `artifacts/v15/browser-results.json`, `artifacts/v15/simulated-ar-results.json`, and the adjacent PNG files. These local artifacts are ignored by Git; the compact provider evidence linked above is retained in `docs/`.

Use HTTPS on the actual phone, allow camera/AR permissions, and verify browser/device feature support. Automatic recognition also requires a working configured model provider; AR geometry and manual dimension comparison do not depend on model access. No provider success or physical clearance accuracy should be inferred from synthetic tests. This implementation has not been deployed by this work.
