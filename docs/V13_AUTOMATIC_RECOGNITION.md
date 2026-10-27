# WorldOS V1.3 — automatic recognition

## Actual readiness

The workflow implementation is improved; reliable production automatic recognition is **still blocked**. No production deployment, credential change, plan change, or new paid service was performed. The Render dashboard showed the existing Free service, automatic deploys Off, and deployed commit `635793c863f500ffd7ed45f3c56f0ba05821eb83`.

## What changed

- Choosing a new setup photo immediately starts recognition. The photograph is saved before inference, and the interface says **Finding your items...** while the actual request is running. No box editor opens automatically.
- Choosing a current or verification photo immediately recognizes and displays items. The user confirms the camera view before comparing positions. Recognition alone cannot produce a passing inspection or correction arrow.
- The exact photo/transform recognition is cached on the server for 120 seconds. A subsequent comparison reuses validated results within that window. Expiry/restart can require a new inference; no result supplied by the browser becomes automatic evidence.
- A failed or empty detection preserves the photo and says **We couldn't identify your items automatically.** Retry is explicit. Manual correction is optional and remains labeled as human assistance.
- Reopening a draft does not automatically repeat inference. Aligned previews and detection outlines are restored together. Upload/scan locks prevent duplicate submissions and late results cannot redirect navigation.
- SAM starts with one concept before starting the remaining bounded batch. Failure stops queued requests; in-flight work is drained. Current-photo recognition checks one reference concept before paying for unexpected-item discovery.
- Auth, CSRF, owner/judge storage isolation, image limits, reduced motion, existing planners, conservative verification, Spatial Studio and Muse integration remain. The new recognition endpoint has the same AI rate/concurrency limits as scans.

## SAM diagnosis, using official contracts

Rechecked [Meta's SAM request specification](https://dev.meta.ai/docs/sam/segmenting), [output grammar](https://dev.meta.ai/docs/sam/reading-segmentation), [model catalog endpoint](https://dev.meta.ai/docs/api-reference/models/list-models), and [error handling](https://dev.meta.ai/docs/error-handling).

The existing identifier `sam-3.1`, `POST https://api.meta.ai/v1/responses`, Bearer authentication, one concept per request, inline image, non-streaming mode, and string-valued confidence/mask metadata match the documentation. No speculative endpoint/model change was made. Meta documents HTTP 404 `model_not_found` for unknown or inaccessible models; invalid credentials normally produce HTTP 401. This evidence does **not** justify declaring the key invalid or claiming a confirmed entitlement change.

The local credential's read-only catalog returned HTTP 200 and included `sam-3.1`. The authenticated Meta dashboard also listed SAM, and its status page said operational. The key management screen exposed rename/delete actions, with no model-entitlement repair control. Catalog visibility is not proof that every inference will be accepted.

Four controlled inference calls were made, without retries:

| Actual test | Outcome |
| --- | --- |
| Existing local credential, full real desk photo, explicit smartphone concept | SAM returned a correctly placed phone box; 1,891 ms provider latency, confidence 0.9532. This verifies prompted localization once, not automatic whole-scene understanding. |
| Deployed V1.2, same photo and concept | Application HTTP 502 with sanitized model-access error, 526 ms. Production remains blocked. |
| Local automatic discovery on a real crop containing phone and mouse | Baseten Muse Spark Open completed validated concept discovery; 4,703 ms, 609 input + 529 output = 1,138 tokens. No human concepts or boxes were supplied. |
| SAM localization following that discovery | HTTP 404 `model_not_found`, 447 ms. The new early-failure behavior prevented the rest of the batch. No partial detection was claimed. |

The local success followed by local failure means this cannot safely be reduced to a production-key mismatch. The remaining cause is an unresolved provider/account access inconsistency. The application cannot repair Meta's model registry or grant model entitlement. See the [sanitized evidence](v13-recognition-results.json); it contains no credentials or photographs. The photograph is credited there. There is no paired physical before/after set or fresh corrected photo, so moved/missing-object accuracy and physical verification remain unvalidated.

### Required owner/provider action

1. Open the [Meta Model API dashboard](https://dev.meta.ai/platform). Select the account/team/project that issued the existing Render `MODEL_API_KEY`; inspect its model access and key status without sharing the key.
2. Open [Meta Contact Support](https://dev.meta.ai/support/). Ask Meta to investigate **inconsistent `sam-3.1` access on `/v1/responses`: a successful segmentation at 2026-10-27 23:29:53 UTC, production model-access rejection around 23:30 UTC, and local HTTP 404 around 23:33:33 UTC despite catalog visibility**. Supply account/team/project identifiers privately if support requests them; never include the secret key or user photos in a public ticket.
3. Ask support to confirm or restore SAM entitlement for the team/key used by Render and explain the inconsistent routing/access results. Do not subscribe or add paid infrastructure merely to troubleshoot this error.
4. After access is confirmed, run one explicit real-photo recognition check and then a physical moved-phone/fresh-correction trial. A successful catalog or connection check alone is insufficient.

`python scripts/check_sam_access.py` performs only a read-only catalog check. Optional `--image PATH --concept smartphone` explicitly makes **one** real request using the existing environment. Output is sanitized. Nothing runs automatically or changes credentials.

## Fallback evaluation

[Baseten's supported Model APIs](https://docs.baseten.co/inference/model-apis/overview) provide hosted language/multimodal models, not a verified shared SAM localization contract. Muse discovery is retained for concepts, never treated as a source of accurate boxes. A dedicated detector would need an actual deployment and input/output contract; no paid deployment was created.

Also evaluated the official [YOLOX Nano and Tiny ONNX models](https://github.com/Megvii-BaseDetection/YOLOX/blob/main/demo/ONNXRuntime/README.md) using the existing OpenCV CPU runtime. Both produced real image-grounded positions, but the real desk/crop tests exposed unacceptable identification errors: Nano labeled the phone as a mouse; both labeled the cropped mouse as a phone; Tiny missed the phone in the full scene. These are observed failures on one photograph, not a general benchmark. Neither fallback was integrated or shipped. Downloaded evaluation weights remain in ignored artifacts; no runtime dependency or hosting charge was added.

## Validation and limits

- Backend: **331 passed, 2 optional live tests skipped**. One existing Starlette/httpx deprecation warning.
- Frontend: **160 passed across 21 files** on Node 24. The initial unconstrained run timed out loading Settings under concurrent test load; both subsequent complete runs with two workers passed, without weakening assertions.
- Production web and mobile asset builds passed. All four HTTP smoke scripts passed, including cookie authentication, CSRF, owner/judge isolation, private-file protection, storage persistence, planning and verification with explicitly mocked provider responses.
- Both Render Blueprints validated against the official schema. The local sequential 6 MP upload/draft/alignment/backup probe peaked at **326.4 MiB**, below 512 MiB. This is a Windows measurement, not a Render Linux cgroup or 0.1 CPU benchmark. No detector weights or additional runtime dependencies are shipped.
- Source/build secret scan passed; no environment files tracked. npm audit reported zero vulnerabilities; pip dependency checks and `git diff --check` passed.
- Chrome at 390×844: upload event through a local QA fixture control, automatic previews, no default box editor, alignment gate, comparison, validated correction, fresh-photo step, refresh recovery and correctly attributed human-reviewed completion were exercised. Failure preserved the photo and exposed Retry with optional marking. No horizontal overflow was observed. Unit tests cover duplicate actions, slow requests, saved-photo-before-inference ordering and session failure before spending.

The same failed-photo Retry recovered its labeled preview at 1280×900; no manual editor or horizontal overflow appeared. A phone correction screenshot was captured in ignored artifacts. Other screenshot attempts intermittently timed out in the Chrome connector; DOM checks still completed.

Automated/browser fixtures are synthetic and are never presented as live model results. The fixture control exercises the actual file-input change handler but does not verify the OS photo picker or camera hardware. Responsive Chrome is not physical iPhone/Safari testing. Render Free remains configured for remote inference, one instance, no paid disk/database, and ephemeral `/tmp/worldos` storage; photos, SQLite records and sessions can still be lost on restart.

The code is ready for deployment review with this explicit provider blocker. It is **not ready to demonstrate reliable automatic end-to-end inspection** until SAM access and paired physical photos are validated. Deploying V1.3 alone does not fix provider entitlement/routing. Production must remain on its approved V1.2 commit until the owner authorizes another deployment.
