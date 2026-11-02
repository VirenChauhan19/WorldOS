# WorldOS: see, understand, act

Implemented locally on November 1, 2026 (America/New_York). This work has not redeployed the hosted application.

## Experience

The home page now leads with “Your world. Understood.” A warm paper and forest palette, focused camera action, restrained typography, and three concrete journeys connect the product: understand a view, imagine a room, remember a setup. Layouts adapt from 320-pixel phones to desktop. Keyboard focus and reduced-motion preferences are supported.

The interactive hero uses the bundled licensed desk photograph and the actual [recorded recognition result](v18-live-recognition.json). Image, Objects, and Understanding layers expose the photograph, selectable SAM boxes, and Muse summary. “Recorded scan,” the displayed/total detection count, scores, and photo credit are explicit. Exploring it makes no model request.

Live Space separates **See**, **Ask**, and **Fit**. See shows the recognized inventory. Ask shows the exact captured photograph, accepts a question, and connects the answer to selectable detected objects. Fit compares real dimensions. Answers can lead to dimension entry, Room Studio, or reference setup capture; an action only happens when the user selects it.

## Scene questions

`POST /api/ai/ask` accepts a validated image, a 3–600 character question, and at most 12 detected objects with unique IDs. The image is decoded before inference. Muse returns a typed answer, at most three observations, existing object IDs, one supported next action, and a limitation. Unknown/duplicate references, invalid actions, and malformed observations are rejected. The prompt requires grounding in the image and forbids inferred metric measurements or unsupported fit guarantees. This is a model constraint plus structural validation, not a proof that every generated statement is accurate.

The route inherits application authentication, CSRF, request limits, and AI error handling. No credentials enter the frontend. Existing bounded inference caching keys the image, objects, and question. A question starts only after a user action. Cancellation, camera shutdown, navigation, session expiry, and newer captured images invalidate old requests/answers.

For interactive questions, `WORLDOS_MUSE_PROVIDER=auto` prefers Meta when its existing key is configured, with the existing Baseten provider as a fallback for supported provider errors. Explicit provider selection is respected. Discovery and other reasoning operations retain their previous selection. The first live question revealed a 45-second Baseten timeout before successful Meta fallback; the final run after this routing adjustment completed directly through Meta.

## Verification

- Full frontend suite: **339 passing tests across 33 files**. After the final captured-photo addition, the 15 relevant camera/question tests passed again. TypeScript and the production Vite build pass.
- Full backend suite: **357 passed, 2 optional live tests skipped**. Scene-question tests cover provider routing/fallback, request validation, invalid images before billing, unknown IDs, malformed output, caching, and route error handling. One existing Starlette deprecation warning remains.
- Chromium browser checks at **320, 390, 768, and 1440 CSS pixels** pass without horizontal overflow or page errors. They exercise recorded layers, object selection, camera recognition, question payloads, answer-to-object highlighting, dimension entry, and track release on navigation. These use synthetic camera frames and explicitly marked AI fixtures. The camera regression also covers portrait framing, motion, unchanged-scene request suppression, permission recovery, transient retry, and permanent failure pause.
- Authenticated local HTTP smoke checks pass for cookies/CSRF, owner/judge isolation, uploads, backups, session revocation, and persistence across process restart. TLS termination is simulated in this test.
- Deployment packaging check: the Docker frontend stage explicitly copies the recorded scan JSON imported by the home page. A production build using only that stage's copied source files passes. Docker itself is unavailable locally, so Render still needs to execute the full image build.
- A separate real question over the public desk photograph and previously recorded detections succeeded through **Meta Muse Spark 1.3 in 6.083 seconds**, referenced seven valid object IDs, and suggested measuring before adding a device. [Sanitized provider evidence](v19-scene-question.json). One image is not a performance benchmark or physical accuracy evaluation.

Browser screenshots and reports are in ignored `artifacts/v19/`. Reproduce the UI check with an installed Playwright package:

```powershell
node scripts/smoke_product.mjs --playwright-dir PATH/TO/node_modules/playwright
```

The provider check is deliberately opt-in and uses the existing configured provider allowance:

```powershell
.\.venv\Scripts\python.exe scripts/verify_scene_question.py --run-live
```

## Submission handoff

Use [the judge demo](HACKATHON_DEMO.md). Deploy this checkout through the existing hosting configuration and check the actual presentation phone over HTTPS before submitting. Localhost camera tests do not validate public permissions, device drivers, native AR, or physical dimensions. The recorded home example remains useful if hardware or provider access is unavailable, and is always labelled as recorded.

Muse image reasoning follows the [Meta image-understanding contract](https://dev.meta.ai/docs/image-understanding). Recognition lifecycle and model-chain details are in [the camera reliability notes](V18_CAMERA_RECOGNITION.md).
