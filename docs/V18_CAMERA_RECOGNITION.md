# Camera and automatic recognition reliability

Implemented locally on November 1, 2026 (America/New_York). The hosted Render application has not been redeployed by this work.

## What changed

- Camera startup handles unsupported preferred constraints, denied permissions, and playback failure. Tracks and requests are released on stop, navigation, session expiry, and page hiding. Late callbacks cannot overwrite a restarted session.
- A steady view automatically triggers Muse Spark concept discovery followed by Meta SAM 3.1 localization. Live discovery understands a whole room, including furniture; saved-workspace inspection retains its narrower scope.
- Camera captures use JPEG quality 0.82 at up to 1280 pixels. Changed views can scan after 800 ms of stability, with a 1.5-second minimum request gap and one request in flight. An unchanged successful view does not continually trigger more inference.
- Temporary failures retry at most twice, after 3 and 8 seconds or a longer server Retry-After. Credential, model-access, credit, and malformed-output failures pause. Moving the camera cannot bypass this backoff.
- A slow result stays attached to its captured photograph. It never places old boxes over a different live view. Stopping the camera or disabling recognition clears the retained photo; it is not saved to browser storage.
- The live view shows the scene summary, selectable object inventory, matching outlines, empty results, and suggested types that SAM could not locate. Portrait and landscape previews preserve the same geometry as their outlines.
- Crowded live previews show up to 12 objects, first retaining the strongest representative of each detected type, then filling remaining slots by score. The total and incomplete inventory are explicit. Planning still rejects inventories larger than 12.
- Same-response SAM instances remain distinct. Near-identical cross-prompt detections retain the stronger evidence. Shared provider concurrency and nested cache admission prevent concurrent scans from exhausting their own request budget.
- AR retry starts AR again; it no longer starts an unrelated camera mode. Room Studio exposes camera errors and retry state beside its preview.

## Verification

- Final full frontend regression: 335 tests passed across 32 files. Production TypeScript/Vite build passed.
- Full backend regression: 345 passed, 2 optional live tests skipped. One existing Starlette deprecation warning remains.
- Local HTTP smoke checks passed for uploads, planning, verification, authentication, CSRF, owner/judge isolation, backups, and persistence across process restart. These simulate inbound TLS and do not establish public deployment behavior.
- Chromium checks at 320, 390, 768, and 1440 CSS pixels passed with no horizontal overflow or page errors. A portrait camera fixture was included. Checks cover selected outlines, unchanged-scene request suppression, retained captured results after motion, permission recovery, transient retry, permanent failure pause, and track release. They use a canvas camera and explicitly mocked AI, not hardware.
- Source and built asset credential scan passed.
- Two real automatic recognition chains succeeded using the existing configured providers and the bundled licensed public photograph. The final 1280-pixel run used Muse Spark Open on Baseten and Meta SAM 3.1, made 11 provider requests, returned 17 detections, and displayed 12 across object types in **20.3 seconds**. No concepts or boxes were supplied by a human. One suggested type, power adapter, was not localized. See [the final live evidence](v18-live-recognition.json). An earlier 960-pixel run took 26.3 seconds. These are integration observations on one public image, not an accuracy benchmark.

## Run and demonstrate

From the repository root, start the backend and frontend in separate terminals:

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
npm.cmd run dev
```

Open `http://127.0.0.1:5173/#/live`, sign in with the existing WorldOS login when prompted, select **Open camera & recognize**, and allow the camera. Aim at a well-lit scene and pause briefly. Review the scene summary and tap an item. Moving to a different view removes live outlines and retains the previous captured result until the next result arrives. Recognition needs the existing backend credentials and network access.

To reproduce the bounded public-photo provider check (uses the configured provider allowance):

```powershell
.\.venv\Scripts\python.exe scripts/verify_live_recognition.py --run-live
```

For the browser fixture checks, install Playwright in your test environment or pass its existing package directory:

```powershell
node scripts/smoke_live_camera.mjs --playwright-dir PATH/TO/node_modules/playwright
```

Screenshots and the browser report are saved under ignored `artifacts/v18/`.

## Remaining submission checks

Deploy this tested checkout to the existing hosting service and repeat a real scan on the actual demo phone over HTTPS. Public `/healthz` was reachable during this work, but it does not verify deployed camera/AI behavior. The demo device was not supplied, and physical camera/AR testing remains outstanding. Single-image recognition does not establish physical dimensions, obstacle-free placement, or comprehensive inventory. Use tracked AR or entered measurements for fit comparisons.

The implementation follows [browser camera lifecycle requirements](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia) and Meta's documented [Muse-to-SAM discovery/localization workflow](https://dev.meta.ai/docs/sam/segmenting). Model inference is asynchronous; it is not a video-rate detector.
