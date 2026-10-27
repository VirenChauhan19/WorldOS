# WorldOS V0.6 — Baseten Muse Spark

Baseten Muse Spark Open now handles goal interpretation, image concept discovery, and Inspect explanations through the existing reasoning adapter. Meta SAM 3.1 still handles segmentation. The deterministic planner still owns placement validity, protected objects, bounds, collisions, and movement ordering. The V0.5 guided physical evaluation and all prior workflows are retained.

## Configuration

Root `.env` is ignored by Git and read only by the backend. This task installed the provided Baseten key locally without placing it in any tracked file or report. Existing Meta/SAM entries were preserved. There was no configured Meta key in this checkout; none was invented or substituted.

Safe example configuration (no credential values):

```dotenv
WORLDOS_MUSE_PROVIDER=auto
BASETEN_MUSE_MODEL=meta-models/muse-spark-open-1026
BASETEN_BASE_URL=https://inference.baseten.co/v1
WORLDOS_SAM_PROVIDER=meta
WORLDOS_MUSE_MODEL=muse-spark-1.3
# BASETEN_API_KEY and MODEL_API_KEY belong only in the private backend environment.
```

`auto` prefers Baseten when its key is present, otherwise Meta. Set `WORLDOS_MUSE_PROVIDER=meta` to select the existing Meta reasoning integration explicitly, or `baseten` to prefer Baseten explicitly. The user-supplied pinned model slug is retained and succeeded in actual requests; it is not silently replaced by a different model alias.

Baseten transport/authentication/credit/rate-limit/network failures can fall back **once** to Meta when `MODEL_API_KEY` is configured. The result identifies the actual answering provider/model and the fallback reason. Malformed structured output or unknown object identities fail closed instead of being concealed by another provider. There is no same-provider retry loop. Connection probes never fall back: a Meta answer cannot establish Baseten connectivity.

Requests use the [official OpenAI-compatible Baseten endpoint](https://docs.baseten.co/inference/model-apis/overview). That documentation lists Muse Spark Open as an exception to JSON mode and enforced structured output. WorldOS therefore requests JSON with the schema in the instruction, then strictly validates the returned object and relevant identities locally. It does **not** send unsupported `response_format` options or claim server-enforced schemas. [Baseten's reasoning documentation](https://docs.baseten.co/inference/model-apis/reasoning) lists Muse Spark Open as always reasoning; no unsupported reasoning switch is sent.

The base URL is restricted to the official HTTPS host to prevent forwarding the backend credential to an arbitrary endpoint. Response bodies, images, goals, headers, and credentials are not written to transport logs. Only safe operation/provider/model identifiers, timing, HTTP classification, and nonnegative integer token counts are retained. Upstream error bodies are replaced with sanitized errors. Redirects are not followed.

## Real inference results — October 26, 2026

Three actual Baseten requests succeeded using the configured account and pinned model:

| Check | Result | Inference latency | Reported prompt / completion / total tokens |
| --- | --- | --- | --- |
| Minimal connection probe | Valid complete Chat Completions response | 1,469 ms | 150 / 23 / 173 |
| Goal interpretation | Valid constraints; preserved protected cup; no unsupported requirements | 1,922 ms | 652 / 445 / 1,097 |
| Inspect explanation | Valid advisory explanation using supplied object IDs | 5,453 ms | 622 / 1,414 / 2,036 |

Total reported usage: **3,306 tokens**. These are three observations, not a performance benchmark or a verified credit-balance measurement. The first sandboxed attempt could not reach the network and produced no successful inference; the authorized network-enabled verification then completed. No automatic Meta fallback was permitted in these checks.

The preserved [sanitized live report](baseten-live-results.json) includes actual structured outputs and timestamps. Inputs were an authored text goal and authored inspection facts. **No real workspace photographs, SAM detections, physical corrections, or physical verification outcomes were tested by these requests.** A successful reasoning integration does not establish inspection accuracy. The provided facts in the explanation test are explicitly examples, not a claimed physical observation.

## Run locally and verify

From the repository root in PowerShell:

```powershell
npm.cmd run build
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Open `http://127.0.0.1:8000`. Restart after environment changes. **AI connection** now shows the selected provider/model, last connection probe, last validated successful application inference, latency, and token usage when supplied. Passive diagnostics make no billable requests. A new server process starts with no inference history; it does not pretend that the saved report is a new live call. Explicit probes and application requests update the panel; cached result timestamps remain identifiable.

For a repeat of the three paid reasoning checks, run explicitly:

```powershell
.\.venv\Scripts\python.exe scripts\verify_baseten.py --live --output artifacts\baseten-live.json
```

The script refuses to run without `--live`, disables Meta fallback for the verification, validates goal semantics and explanation identities, and saves only a secret-checked report. It stops after a failed connection probe. It does not perform vision evaluation or read user photographs.

## Software validation

- Backend: **243 passed; 2 optional live/photo tests skipped**.
- Frontend: **76 passed**.
- Production build: passed.
- Both HTTP smoke tests: passed, including guided trial persistence across restart.
- Baseten regressions cover selection, independent Meta SAM routing, strict JSON validation, unknown identities, bounded/disclosed fallback, concurrency metadata isolation, cache scoping, failure classification, latency/usage, secret-safe logs, and passive connection diagnostics.
- Default pytest runs isolate developer credentials, so regular tests cannot inherit the newly configured paid key. Explicitly marked opt-in live tests remain separate.

## Remaining demo blockers

**Update:** The [SAM restoration and real-photo pipeline](SAM_RESTORATION_RESULTS.md) now passes with the newly supplied Meta credential. Baseten settings are preserved, and live multimodal goal interpretation and Inspect explanations have also passed. The initial Baseten results above remain historical evidence.

1. Meta SAM credentials are now restored on this machine. Verify both providers on the final demo machine/network; Baseten credits do not substitute for Meta SAM credentials.
2. Perform the genuine reference → inspection → physical correction → fresh-photo verification trials. Actual physical precision/recall/task success remain unmeasured.
3. Validate image-based concept discovery on those real photographs. Its provider routing and input contract are covered by software tests; this live check covered text only.
4. Meta fallback is implemented, configured, and regression-tested, but was not deliberately exercised with a live provider failure. No public deployment was performed; access protection and persistent storage are still required for a hosted demo.

Use the [physical trial, backup, readiness, and final submission checklist](DEMO_READINESS.md) for the next steps. Keep the distinction between real Baseten reasoning evidence, mocked software tests, and still-pending physical evaluation in the submission.
