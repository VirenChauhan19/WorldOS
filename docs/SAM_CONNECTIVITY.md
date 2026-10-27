# Meta SAM connectivity and the first physical Inspect trial

**Update:** The newly supplied Meta key restored live SAM detection, and the complete real-photo inference-to-planning check now passes. See [restoration results, actual timings, and preserved failed attempts](SAM_RESTORATION_RESULTS.md). The diagnosis below describes the earlier missing-key state; physical movement evaluation remains pending.

## Earlier finding — October 26, 2026, before restoration

The current root `.env` contains an **empty `MODEL_API_KEY`**. The inherited backend process and Windows user/machine environments did not supply that variable either. `WORLDOS_SAM_PROVIDER=meta` is selected correctly. The configured Baseten Muse Spark key, model, and endpoint are present. No credential was changed or replaced during this investigation; `.env` remains Git-ignored and untracked.

The backend loads the repository's absolute `.env` path once at startup. Process environment values take precedence, **including empty values**. In this checkout the empty Meta key comes from root `.env`, not a process override or an incorrect working directory. Changes to `.env` require a backend restart.

[Earlier SAM tests](V03_VERIFICATION.md#actual-observations-on-october-26-2026) document successful calls on public desk photographs and an unchanged-photo negative control. They do not contain a recoverable credential or a completed physical movement trial. Because `.env` is untracked, its contents cannot establish when or why the earlier credential stopped being available. No substitute key was invented, and the Baseten key was not used for SAM.

The [previous Baseten live report](V06_BASETEN.md#real-inference-results--october-26-2026) records successful minimal inference, goal interpretation, and Inspect explanation calls using authored text/facts. Those results are preserved; no additional paid request was necessary for this diagnosis. Real photograph concept discovery and physical inspection remain unverified in the current configuration.

## Readiness checks

Open **AI connection → AI Connection Status** in Inspect, or read `GET /api/ai/diagnostics`. Reading diagnostics makes no provider request. Each integration shows its selected provider/model, required backend variable, configuration source, readiness, historical connection result, and validated inference latency when available.

- **Blocked:** missing credentials or an unsupported SAM deployment contract. The UI disables the selected model's connection button until configuration is resolved.
- **Awaiting a live connection check:** configured, but not live-verified in this server process. An injected test response never establishes live readiness.
- **Checking:** an explicit connection probe is running.
- **Verified in this server process:** a validated live response was received. This is evidence of connectivity, not ongoing availability, detection accuracy, or completed physical work.
- **Needs a new connection check:** a newer connection failure takes precedence over an older successful inference. Historical success remains visible. A later validated live inference can recover readiness.

Configuration diagnostics show only known variable names and `set` / `empty` / `absent`, never their values. An empty inherited process value that masks a configured `.env` value gets a specific warning. Root `.env` edits trigger a restart notice. Parse errors and repeated AI setting assignments are counted without echoing their contents. Diagnostics do not reload or rewrite credentials.

SAM now records successful application/probe inference metadata only after envelope and detection-output validation. Empty valid detections establish a completed request, not detection coverage. Probe images remain explicitly generated test images.

## Unblock SAM without replacing other keys

1. Find the original backend environment file or deployment configuration containing your valid Meta credential. If it is outside this repository, provide its **path or configuration name**, not the key in chat. Otherwise obtain a Meta Model API credential with SAM access through your account.
2. Locally fill only the currently empty **`MODEL_API_KEY`** assignment in root `.env`. Preserve `BASETEN_API_KEY` and all existing provider settings. `WORLDOS_SAM_PROVIDER` should remain `meta`. Baseten reasoning stays selected automatically when its key is configured.
3. If diagnostics specifically report an empty process override, remove that stale override from the backend's launch configuration. A `.env` edit alone cannot defeat process precedence. Never print environment variables to troubleshoot credentials.
4. Restart from this repository in PowerShell:

   ```powershell
   npm.cmd run build
   .\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
   ```

5. Open `http://127.0.0.1:8000`. In **AI connection**, refresh diagnostics. SAM should be configured and awaiting a check. Select **SAM 3.1**, then **Test AI Connection**. This makes one paid request using a generated red square. A valid zero-detection response proves the contract only.
6. Select **Baseten Muse Spark** and explicitly test it on the demo machine/network if a fresh live readiness check is needed. Authentication, credit, access, timeout, and rate-limit failures are reported separately. No probe retries automatically.

## Photographs and labels needed from you

Use one flat, well-lit workspace, a fixed camera, three to five distinct objects, an unobstructed destination, and one protected object that stays put. Keep camera position, zoom, orientation, and lighting consistent. Avoid stacking and duplicate-looking objects for the first trial.

1. **Reference:** a genuine photograph of the desired final arrangement. Supply each object's label/identity, which are required or optional, which are protected, and the usable workspace boundary.
2. **Inspection:** a separate new photograph after you physically move one non-protected object to a free location. Tell us exactly what you moved and whether anything was removed, added, or hidden. Keep the protected object stationary. Label visible objects and actual issues independently before requesting inference.
3. **Corrected:** take this only **after** WorldOS generates a valid correction and you physically follow it. Use a fresh photograph; do not reuse the reference. Label the actual resulting layout, including any remaining problems.

Original files or local paths are sufficient. Public stock photos, generated/edited images, reused frames, and test fixtures cannot establish this physical trial. If the camera moved, use the reference overlay/alignment review or retake the image before comparing positions.

## Record the real loop

1. In **WorldOS Inspect**, create a template from the reference. Run SAM, inspect its actual detections, correct annotations, mark protected/required objects and boundaries, then save. Corrections stay distinct from the reference inference.
2. Select the saved template → **Evaluate real photographs**. Create a `misplaced object` trial and enter operator/capture metadata.
3. Upload the inspection image, align and review framing, draw independent ground-truth boxes and issue labels, and freeze the capture **before** inference. Click **Inspect workspace**. If inference fails, retain the attempt and retry explicitly after resolving the cause.
4. Review actual issues and identity uncertainty. Click **Explain with Muse Spark** if desired. Save manual assignments, missing-detection boxes, exclusions, and inventory confirmation with **Apply reviewed inspection**. These are human-assisted results; the raw automatic result remains separate.
5. Click **Generate correction plan**. If the plan is blocked, retain its explanation and resolve the physical obstruction under supervision. Do not claim that an impossible plan executed. Otherwise perform the shown moves yourself.
6. Upload the fresh corrected photograph → independent labels → freeze → **Verify correction photo**. Record uncertainty or failure honestly; apply any manual review separately. WorldOS's inventory confirmation makes a reviewed completion human-assisted even if no boxes changed.
7. **Export trial with photographs** and **Show evaluation report → Download metrics and denominators**. Keep the original files, actual detections, provider/cache metadata, timings, failures, review history, plans, and final outcome. Reopen the saved trial after restart to confirm persistence.

Use the [full physical evaluation and submission checklist](DEMO_READINESS.md) for all ten scenarios, database backup, recovery rehearsal, and deployment checks.

## Earlier validation checkpoint

- Backend: **256 passed; 2 optional live/photo tests skipped**.
- Frontend: **80 passed**. The first run was prevented by a sandbox parent-directory read restriction; the authorized rerun passed.
- Production build: passed.
- Both HTTP smoke tests: passed, including SQLite restart persistence and reference/inspection/correction/verification software paths with explicit mocked provider responses and synthetic fixtures.
- Additional HTTP check with the actual root configuration: Meta SAM correctly blocked on an empty key; Baseten configured but untested in that new process; no external requests. Local sanitized evidence: `artifacts/provider-readiness.json`.

At this earlier checkpoint, genuine physical trials and new live SAM requests were both zero. The credential blocker has since been resolved and real-photo inference latency measured; see [current restoration evidence](SAM_RESTORATION_RESULTS.md). Physical precision, recall, false alarms, and task success remain unmeasured until a genuine reference/inspection/fresh-corrected photograph sequence is captured.
