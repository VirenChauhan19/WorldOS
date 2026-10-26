# WorldOS V0.2 AI integration

## Delivery status

**Live Meta inference was validated on October 26, 2026.** The supplied Meta key is stored only in the Git-ignored root `.env`. Both explicit connection probes returned validated HTTP 200 responses. Muse Spark also interpreted a synthetic scene and protected `coffee`; the resulting constraints produced a feasible deterministic plan. SAM returned a red-square detection with normalized box `(0.3, 0.2, 0.4, 0.6)` and actual confidence `0.8904109597206116` on a generated image. Automatic concept discovery on the labeled QA scene returned `book` and `coffee`; SAM correctly remained an empty result for those drawn object stand-ins rather than fabricating detections. These tests establish working live requests and adapters, not accuracy on real desk photographs. The sanitized local record is `artifacts/live-inference-report.json` (ignored by Git).

| Path | Implemented | Blocker |
| --- | --- | --- |
| Muse Spark on Meta Model API | Live connection probe, multimodal concept discovery and structured goal interpretation validated | Real-photo quality and broader goals still need user review |
| SAM 3.1 on Meta Model API (selected provider) | Live connection probe and prompted segmentation with actual normalized boxes/confidence validated | Real-photo detection completeness/quality not yet measured |
| SAM 3.1 on Baseten (requested provider) | Verified general dedicated-deployment transport and explicit blocked status | Your deployment ID **and its actual SAM input/output documentation**; a key alone is insufficient |
| Manual annotations, deterministic rules, planner, verification | Available without provider credentials | None |

Baseten's official documentation says model inputs depend on the deployed model. No public SAM 3.1-specific Baseten model ID or response schema was verified during this implementation. WorldOS therefore does **not** guess a request, invent a hosted model slug, or claim Baseten SAM works. `BasetenDeployment.predict()` is a general server-side transport for a caller-verified JSON payload; the SAM adapter deliberately does not call it until a deployment-specific serializer/parser can be written and tested.

Meta's documented SAM API is provided as a separate, opt-in alternative. It is not silently substituted for Baseten. The default provider remains `baseten` and returns a clear 503 explaining the missing contract.

## Official contract references

Verified against the official documentation on October 26, 2026:

- [Meta Model API overview](https://dev.meta.ai/docs/overview): base URL `https://api.meta.ai/v1`, Bearer authentication with `MODEL_API_KEY`, standard Muse model IDs including `muse-spark-1.3`. WorldOS restricts configuration to documented standard 1.1/1.2/1.3 IDs.
- [Meta Chat Completions](https://dev.meta.ai/docs/protocols/chat-completions): `POST /v1/chat/completions`, `model`, `messages`, `max_completion_tokens`; read `choices[0].message.content`, require a completed `stop` result, and consume actual token usage when returned.
- [Meta image understanding](https://dev.meta.ai/docs/image-understanding): a user message can contain `text` and `image_url` parts; the latter wraps a base64 data URL in `{ "url": ... }`. WorldOS uses inline images rather than fetching arbitrary client URLs.
- [Meta structured output](https://dev.meta.ai/docs/structured-output): `response_format.type = "json_schema"`, with the schema under `json_schema`. Local Pydantic validation also rejects malformed output, unknown object IDs, and unexpected fields.
- [Meta SAM overview](https://dev.meta.ai/docs/sam/overview): model ID **`sam-3.1`** on `POST /v1/responses`; image segmentation supports non-streaming responses.
- [SAM prompting and confidence](https://dev.meta.ai/docs/sam/segmenting): one short noun phrase per request; an `input_text` part and `input_image` part in one user message. `metadata.include_confidence` is the **string** `"true"`; `mask_encoding: "one_bit"` requests compact masks. Zero matches is valid.
- [SAM output grammar](https://dev.meta.ai/docs/sam/reading-segmentation) and [client-library coordinate semantics](https://dev.meta.ai/docs/sam/client-libraries): image records use frame `<0f>` and source-pixel boxes/masks. Bottom/right `x2`/`y2` are inclusive; WorldOS adds one to obtain the rectangle extent before normalizing. A `c` value is used only if present and valid.
- [Baseten: call your model](https://docs.baseten.co/inference/calling-your-model): dedicated deployment endpoint `https://model-{model_id}.api.baseten.co/environments/production/predict`, Bearer auth using `BASETEN_API_KEY`, and model-specific JSON inputs. The model ID comes from the user's dashboard/deployment, not an assumed shared SAM model name.

## Environment configuration

Copy `.env.example` to `.env`, edit it locally, and restart FastAPI. Do not paste credentials into chat, commit `.env`, or put secrets into any `VITE_` variable.

| Environment variable | Purpose |
| --- | --- |
| `MODEL_API_KEY` | Meta Model API key for Muse Spark and optional Meta SAM. Requires access to the selected models and usable billing/credits. |
| `WORLDOS_MUSE_MODEL` | Default `muse-spark-1.3`; supported configured alternatives are standard `muse-spark-1.2` and `muse-spark-1.1`. |
| `WORLDOS_SAM_PROVIDER` | Default `baseten` (contract blocked); choose `meta` explicitly for the verified optional SAM route. |
| `BASETEN_API_KEY` | Dedicated-deployment inference credential. Not used by Meta paths. Does not unblock the missing SAM contract by itself. |
| `BASETEN_SAM_MODEL_ID` | Your actual Baseten model ID. No default or invented ID is provided. |
| `WORLDOS_AI_TIMEOUT_SECONDS` | Per-provider-call wall-clock/read limit; default 45, supported 1–90 seconds. |
| `WORLDOS_RUN_LIVE_AI` | Optional tests only: set `1` to authorize real billable model requests. |
| `WORLDOS_LIVE_IMAGE_PATH` | Optional tests only: absolute path to a real photo you authorize sending to Meta. |
| `WORLDOS_LIVE_SAM_CONCEPT` | Optional SAM live-test noun phrase; default `coffee cup`. |

Example `.env` settings for the optional Meta route (fill the key locally):

```dotenv
MODEL_API_KEY=
WORLDOS_MUSE_MODEL=muse-spark-1.3
WORLDOS_SAM_PROVIDER=meta
WORLDOS_AI_TIMEOUT_SECONDS=45
```

`GET /api/health` exposes configuration status without secrets. `configured_not_live_verified` means a key is present, not that it is valid. No background health probe calls a model or incurs provider charges. The AI Connection Status panel and `/api/ai/diagnostics` distinguish configured credentials from validated inference. Only the explicit `/api/ai/connection-test` action can record live test success in the current server process; injected mock transports never set that flag. Restarting or changing the relevant credential/model/provider resets the record. See [first connection inference](FIRST_INFERENCE.md) for setup and usage.

## Test automatic object segmentation

1. Configure the optional Meta route above and start the app using the README commands. Baseten remains blocked until its SAM deployment contract is provided.
2. Upload a JPEG, PNG, or WebP photograph. Uploading only prepares it locally; it does not invoke AI.
3. Open **AI assistance**. Leave **Object concepts** blank and click **AI Analysis**. Muse Spark receives the photo and returns up to twelve concrete concepts; WorldOS sends a separate SAM request for each concept, with at most three concurrent calls.
4. To test SAM independently of Muse discovery, enter short noun phrases such as `coffee cup, notebook, headphones`. The UI splits these into separate list entries. A generic “find everything” prompt is not assumed. Supplying concepts makes no Muse discovery call.
5. Review the returned boxes and labels. The application shows confidence only when SAM actually supplies it; missing confidence is shown as unavailable. A zero-match result remains empty. Failed requests preserve existing annotations. Replacing existing annotations requires the replacement checkbox.
6. Correct positions, sizes, labels and locks with the existing tools, and add missed objects. Near-identical cross-concept detections are deduplicated; overlapping rectangles are left for correction. More than twelve distinct objects is rejected rather than silently dropping obstacles.
7. Draw the target and, if necessary, the surface boundary. Confirm **I reviewed all AI annotations…**, then generate a plan. Any annotation or goal edit clears the review flag and any applied reasoning constraints. Editing an AI box or label changes its source to `ai_corrected` and clears its confidence, so the original score is not presented as confidence in your correction.

WorldOS consumes the boxes from SAM's segmentation records. It checks record/mask structure but does not decode, render, persist, or use mask pixels for collision geometry. The deterministic planner continues to use conservative rectangular footprints.

## Test Muse Spark reasoning

1. With `MODEL_API_KEY` configured, use either manual or AI annotations and draw a target.
2. Enter a goal such as `Make room for my laptop and leave my drink exactly where it is.` With an uploaded photo, the image, object IDs/labels/boxes, goal, and selected target are sent to Muse Spark. The illustrated sample uses text/object context only.
3. Click **Interpret goal with Muse Spark**. WorldOS requests a structured result with `protected_object_ids`, `summary`, `unsupported_requirements`, and `needs_clarification`.
4. Inspect the summary and protected object names, then click **Apply reviewed constraints**. Nothing is silently applied. Explicit user locks are always preserved. Muse cannot supply placements or bypass the geometric planner.
5. Generate a plan. The backend validates all IDs and adds protected locks before invoking the existing planner. It records `user_reviewed_constraints` as the interpretation source. Verification reuses those exact reviewed constraints and recomputes the deterministic plan, without another model call.
6. Try `Stack the books` or another requirement the current 2D planner cannot represent. The model is instructed to report unsupported requirements; the UI and API block their application. Clarification/unsupported flags are locally enforced, but the model may still misunderstand a goal. Review its interpretation. Use **Use manual rules** to explicitly return to the original deterministic workflow.

Muse Spark's response does not provide a calibrated confidence score for this interpretation. WorldOS never asks it to invent one and returns `confidence: null`.

## API and module boundaries

- `backend/adapters.py`: `SegmentationAdapter.segment(image, concept)` and `ReasoningAdapter.interpret(request)` are async provider protocols. Existing manual behavior and `RuleBasedReasoning.locked_ids` remain local.
- `backend/providers.py`: environment settings, fixed verified provider URLs, authenticated transports, deadlines, sanitized failures, token/timing logs, and capability status. No provider URL or API key comes from browser input.
- `backend/ai_adapters.py`: SAM request/response grammar and Muse structured-output contracts.
- `backend/ai_service.py`: concept discovery, bounded parallel calls, deduplication, and atomic analysis results.
- `POST /api/ai/analyze`: `{ "image_url": "data:image/jpeg;base64,...", "concepts": ["coffee cup"] }`. Empty concepts requests Muse discovery first.
- `POST /api/ai/reason`: `{ "objects": [...], "goal": "...", "target": {...}, "image_url": "data:image/jpeg;base64,..." }`. Image is optional for reasoning, required for segmentation.
- `/api/plan` accepts optional `constraints`. Unsupported/unclear constraints or unknown IDs are rejected. The old request still works with no AI calls.
- `src/AIPanel.tsx`: explicit invocation, replacement acknowledgment, loading states, model status, interpretation review, and manual fallback.

The 120-second route deadline bounds the complete discovery/segmentation operation. The client allows 130 seconds for AI endpoints. Responses have an 8 MB bound, images are validated/canonicalized server-side, and arbitrary client image URLs are not fetched. No automatic billable retries are made. Cancellation/error does not imply no provider charges; a request may have been processed already. If a concept fails, the whole UI result is rejected, preserving the previous annotations; completed sibling calls may still have consumed credits.

Usage events log generated request IDs, operation, provider/model, HTTP status, duration and actual token counts when available. They never log keys, authorization headers, photos, goals, labels, raw request/response bodies, or upstream error details. `http_success` means the transport succeeded; a separate `ai_result` event records validation success or rejection. These logs do not estimate costs or invent token usage for SAM. They are emitted through the backend/Uvicorn logging system; no external telemetry collector is configured.

## Tests and remaining verification

```powershell
.\.venv\Scripts\python.exe -m pytest backend\tests -q
npm test
npm run build
.\.venv\Scripts\python.exe scripts\smoke_test.py
```

Default provider tests use **synthetic mocked responses matching official schemas**, not recordings of successful live calls. The original planner and manual workflow tests remain. Added coverage includes exact auth/URL/request formats, per-concept requests, no-confidence handling, inclusive coordinate conversion, malformed records, protected ID validation, explicit locks, unsupported requirements, zero detections, rate limits, auth/billing failures, timeouts, secret-safe logging, and frontend review/invalidation behavior.

To opt into real, potentially billable calls after configuring `.env`:

```powershell
$env:WORLDOS_RUN_LIVE_AI = '1'
$env:WORLDOS_LIVE_IMAGE_PATH = 'C:\path\to\your-desk.jpg'
$env:WORLDOS_LIVE_SAM_CONCEPT = 'coffee cup'
$env:WORLDOS_SAM_PROVIDER = 'meta'
.\.venv\Scripts\python.exe -m pytest backend\tests\test_ai_live.py -q -rs
Remove-Item Env:\WORLDOS_RUN_LIVE_AI
```

The two live tests check actual response contracts for one SAM concept and one multimodal Muse interpretation. They do not measure general object-detection accuracy, completeness or physical-layout safety. Missing keys or image paths cause explicit skips; they are not reported as live successes.

Remaining limitations: Baseten SAM needs the deployment-specific contract; live Meta validation so far uses synthetic fixtures rather than real desk photographs; prompt discovery can miss obstacles; rectangular annotations can overlap even when pixel masks do not; confidence is the provider's score rather than a guarantee; reasoning is reviewed and only protected-object constraints are executable; final verification remains manual annotation geometry, not independent image recognition. The original planar, no-rotation, lift-and-place planner limitations still apply.


## V0.3 follow-up

Real desk-photograph segmentation and an unchanged-photo negative verification control have now been run. See [V0.3 evidence, workflow, and limitations](V03_VERIFICATION.md). Earlier synthetic-only statements in this guide describe the V0.2 milestone. No independently photographed physical movement pair has been evaluated; reliable verification accuracy remains unmeasured.
