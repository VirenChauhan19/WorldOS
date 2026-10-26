# First Meta AI connection inference

The new connection panel checks backend configuration without making inference calls. Only **Test AI Connection** explicitly sends a provider request. A configured key never means a model is connected.

## Get credentials

**Meta (Muse Spark and optional Meta SAM):** sign in at the [Meta Model API dashboard](https://dev.meta.ai/), open **API keys**, choose **Create API key**, give it a name, and copy it immediately. Store it as `MODEL_API_KEY` in the repository's backend `.env`. Use an account/team with access to the requested models and usable credits/billing. The [official authentication guide](https://dev.meta.ai/docs/authentication) and [quickstart](https://dev.meta.ai/docs/quickstart) document this workflow. A Muse Code subscription/sign-in is not used by WorldOS as an API credential.

**Baseten (only if you intend to use your own SAM deployment):** sign in at [Organization settings → API keys](https://app.baseten.co/settings/api_keys), choose **Create API key**, and create a personal development key or an inference-only team key with access to your model/environment. Store it as `BASETEN_API_KEY`. Get the actual model ID from the deployment dashboard and put it in `BASETEN_SAM_MODEL_ID`. See [Baseten API key instructions](https://docs.baseten.co/organization/api-keys) and [deployment invocation](https://docs.baseten.co/inference/calling-your-model).

Baseten SAM still requires that deployment's verified request/response schema. WorldOS does not guess it and will not send a Baseten SAM inference probe. A Meta test cannot verify Baseten credentials. The optional Meta SAM route is the currently implemented path for a real SAM inference test.

## Configure locally

From the repository root in PowerShell:

```powershell
# Only copy if you do not already have .env; preserve existing credentials.
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

Edit `.env` locally, fill the key, and select the optional Meta SAM route:

```dotenv
MODEL_API_KEY=your_actual_meta_model_api_key
WORLDOS_MUSE_MODEL=muse-spark-1.3
WORLDOS_SAM_PROVIDER=meta
WORLDOS_AI_TIMEOUT_SECONDS=45
```

`BASETEN_API_KEY` and `BASETEN_SAM_MODEL_ID` are unnecessary for Meta. If selecting `WORLDOS_SAM_PROVIDER=baseten`, its connection probe remains blocked pending the SAM contract. Keys must never use a `VITE_` prefix or appear in browser code. `.env` is ignored by Git.

Restart the backend after editing `.env`; Python dotenv loads it at server startup. Existing process environment values take precedence over `.env`, so remove or update stale values if the configuration does not match expectations.

Terminal 1:

```powershell
Set-Location C:\Users\Administrator\Desktop\Github_AI201\WorldOS
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

Terminal 2:

```powershell
Set-Location C:\Users\Administrator\Desktop\Github_AI201\WorldOS
npm run dev
```

## Perform the first real test

1. Open **http://127.0.0.1:5173** and look under **AI assistance → AI Connection Status**.
2. Verify the selected SAM provider and configuration states. `Configured, unverified` means a key exists, not that it is valid. Each model starts with `Real request successfully tested: No`.
3. Select **Muse Spark** in **Test model**, then click **Test AI Connection**. This sends one short text-only Chat Completions request with a 256-token completion ceiling and minimal reasoning. No scene, goal, or photo is sent.
4. A validated real response changes that model's last test to **Real inference succeeded**, records a timestamp, and changes its historical success indicator to **Yes**. The other model stays unverified.
5. Select **SAM 3.1 · selected provider** and click again. With provider `meta`, the backend creates a 64×64 image containing a red square and sends one `sam-3.1` Responses request with the noun phrase `red square`, using the existing segmentation adapter. An empty match set is a legitimate inference response; the probe checks completion/format rather than detection accuracy.
6. After those probes, use an uploaded photo with **AI Analysis**, then **Interpret goal with Muse Spark** to validate the actual application workflow. A text-only Muse probe does not establish multimodal/structured reasoning quality. These subsequent actions can incur additional usage.

Each probe may consume credits. There are no automatic inference probes, retries, or fallback provider substitutions. The UI refresh button only reads local diagnostic state. Without configured credentials, clicking the test action records a missing-credential outcome and makes no provider request.

## Diagnose failures

| Status | Meaning and next step |
| --- | --- |
| Missing credentials | Set the backend variable and restart the server. No request was sent. |
| Invalid or revoked credentials | Provider HTTP 401. Copy the complete current key from the provider dashboard. |
| Insufficient credits / billing issue | HTTP 402. Check credits, balance and billing configuration; this category does not determine which billing condition caused it. |
| Model unavailable or access denied | HTTP 403, or 404 with documented `model_not_found`. Check selected model, team permissions and access. |
| Timed out | Local deadline/read timeout or HTTP 408/504. Retry explicitly when ready. The provider may already have incurred usage. |
| Malformed or incomplete response | Invalid JSON/schema or unfinished output. No success is recorded even if HTTP was 200. |
| Rate limited | HTTP 429. Wait and retry explicitly. |
| Network error / provider error | Server cannot reach provider or the provider returned another error. No raw provider message is exposed. |
| Deployment contract required | Baseten SAM payload/schema remains unverified. No request was sent. |
| Mock response validated; no live success | An injected test transport validated a fixture; this is deliberately not counted as a live connection. |

The classifier uses documented stable status/error codes rather than exposing upstream error text. [Meta error reference](https://dev.meta.ai/docs/error-handling).

## Diagnostic API

```powershell
# Passive: server-side checks only, no provider inference.
Invoke-RestMethod http://127.0.0.1:8000/api/ai/diagnostics

# Explicit inference test: one selected integration, potentially billable.
Invoke-RestMethod -Method Post `
  -Uri http://127.0.0.1:8000/api/ai/connection-test `
  -ContentType 'application/json' `
  -Body '{"integration":"muse"}'
```

Use `"sam"` for the other integration. Credentials cannot be passed in these request bodies. Diagnostic responses contain configuration booleans, model/provider, per-model last-attempt status, and success history; they never include keys, key prefixes, credential fingerprints, raw model replies, or uploaded scenes. Both responses use `Cache-Control: no-store`.

A completed diagnostics POST returns HTTP 200 with an explicit `last_test.status`; HTTP 200 alone does **not** mean inference succeeded. Bad request bodies are rejected; overlapping tests for the same model return HTTP 409. Failures never disable manual annotation/planning.

History is in memory, scoped to one running server process and the current model/provider/credentials. Restarting clears it; changing a relevant key/model/provider invalidates the corresponding record. A later failed attempt is shown separately from the timestamp of an earlier real success. History records explicit connection tests only; it is not a durable account-health or production-monitoring service. There are no durable keys or response files in the registry.

## Automated validation

```powershell
.\.venv\Scripts\python.exe -m pytest backend\tests -q
npm test
npm run build
.\.venv\Scripts\python.exe scripts\smoke_test.py
```

Automated tests use synthetic, injected responses. They cover request contracts, passive diagnostics, failure categories, secrets, registry resets, model selection, and UI success/failure reporting. Mocked responses do not mark an integration live. Two pre-existing optional live tests remain opt-in; they do not update the running server's connection-test history.
