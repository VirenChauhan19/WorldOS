# WorldOS V0.8 — secure deployment and iPhone installation

## Current status

Deployment preparation is implemented. **There is no verified live WorldOS URL.** No Render connector or API credential is available, and opening the Render dashboard in Chrome reached its sign-in page. No hosting resources were provisioned and no hosting charge was incurred. Render sign-in, a paid service/disk, an owner passphrase, and deployment remain manual actions below.

The existing React/Vite frontend, FastAPI backend, SQLite templates/evaluations, Meta SAM 3.1, Baseten Muse Spark, deterministic planner, and native-app integrations are preserved. Local `.env` provider keys were not changed.

## Selected host and configuration

Use one **Render Docker web service** with the **Standard** compute plan and a **5 GB persistent disk** mounted at `/var/data`. This keeps the browser and API on the same HTTPS origin and preserves SQLite without adding another database service. The larger compute option gives image processing more room than an entry-level instance; review current specifications and billing before creating it. [Render pricing](https://render.com/pricing).

Render supplies an `onrender.com` hostname, managed TLS, and HTTP-to-HTTPS redirection. A custom domain is optional. Its service port is behind managed ingress. [Web service networking and HTTPS](https://render.com/docs/web-services).

The disk is a paid feature. Only files under its mount survive restarts/redeploys; a disk-backed service runs as one instance and has a brief interruption during deployment. These constraints fit the current single-workspace SQLite architecture. [Persistent disk behavior](https://render.com/docs/disks).

Repository configuration:

| Setting | Configured value |
|---|---|
| Blueprint | `render.yaml`, validated against Render's current official JSON schema |
| Runtime | Docker; Node 24 builds Vite, Python 3.12 runs FastAPI |
| Dockerfile/context | `./Dockerfile`, repository root |
| Start command | `python -m backend.launch_render` |
| Listener | `0.0.0.0:$PORT`, one worker, at most 32 active connections |
| Health check | `/healthz` |
| Data directory | `/var/data/worldos` |
| Automatic deploys | Off; use manual deployment when ready |
| Secrets | Prompted by Render, never present in the Blueprint or build arguments |

The entry point requires Render's assigned hostname and public authentication, checks the mounted disk, prepares only the application subdirectory, then drops to uid/gid 10001 before serving traffic. Hosts and CORS origins come from environment configuration, never the incoming Host header. Optional `WORLDOS_PUBLIC_URL` adds a verified custom HTTPS origin. Render's proxy trust policy is confined to this entry point; **do not use it on a directly exposed VM**. The existing Caddy Compose deployment still builds Docker's `app` stage and trusts only its fixed proxy IP.

`/healthz` verifies workspace DB access, the session DB, and storage writability. It returns only `{"status":"ok"}` or a generic 503. It performs no AI calls and exposes no keys or workspace metadata. Migrations run at application startup, when the persistent disk is mounted—not during the image build.

## Exact account setup and deployment actions

1. Sign up for or sign in to [Render](https://dashboard.render.com/). Connect GitHub and grant access to **VirenChauhan19/WorldOS**. Review the paid service/disk pricing and billing requirements. This step has not been performed by the agent.
2. Review, commit, and push the local WorldOS changes to the branch you will deploy. Many features from earlier turns were already uncommitted; preserve those changes and include their required application files. Render cannot deploy uncommitted local work. Keep `.env`, `.env.auth`, `data/`, `artifacts/`, signing keys, and local dependencies excluded from Git. Confirm before pushing:

   ```powershell
   git status --short
   git diff --check
   git check-ignore .env .env.auth
   git ls-files .env .env.auth
   ```

   The last command should print nothing. Include `backend/`, `src/`, `public/`, `scripts/`, package files, Vite/TypeScript configuration, `Dockerfile`, `.dockerignore`, `render.yaml`, and deployment docs in the reviewed commit. No automatic commit/push was performed here.
3. Create your operator login locally from the repository root:

   ```powershell
   .\.venv\Scripts\python.exe scripts/create_login.py
   ```

   Enter a unique 14–1024-character passphrase at the hidden prompts. The script writes its PBKDF2 hash to ignored `.env.auth` and refuses to overwrite an existing file. It does not modify provider keys. This step is still required; no real operator passphrase was invented or created for you.
4. In Render, choose **New → Blueprint**, select the repository and branch, and use root `render.yaml`. Review the one-service/one-disk configuration. When prompted, enter these secrets directly into Render's environment fields:

   | Environment name | Source |
   |---|---|
   | `WORLDOS_AUTH_PASSWORD_HASH` | Value from local `.env.auth`, without surrounding quotes; not the plaintext passphrase |
   | `MODEL_API_KEY` | Existing Meta key from your private `.env` |
   | `BASETEN_API_KEY` | Existing Baseten key from your private `.env` |

   Do not paste secrets into Git, frontend configuration, chat, build commands, screenshots, or logs. The Blueprint supplies the model names and other non-secret configuration. Do not set `VITE_API_BASE_URL`: the hosted PWA uses `/api` on its own HTTPS origin.
5. Approve creation after reviewing the billable plan and disk. Wait for Render's build and health check to succeed. Copy the **actual URL assigned by Render** from the service dashboard. Do not assume the service name alone determines the final URL.
6. Open that HTTPS URL. Sign in with the passphrase from step 3. The public shell, install assets, minimal health endpoint and login are available before sign-in; workspace data, uploads, inference, backups, private pages and API docs are protected.
7. Run the public verifier below, then perform the physical iPhone checks. A successful image build alone is not successful deployment verification.

The source contains no model secrets. Docker ignores local secret/data directories and does not declare credential-bearing build arguments. Provider credentials are runtime environment variables only. Do not use commands that dump all environment values into logs.

## Public HTTPS verification

After deployment, run this on the local computer, substituting the **actual** Render URL:

```powershell
.\.venv\Scripts\python.exe scripts/verify_deployment.py --url https://YOUR-ACTUAL-HOST.onrender.com --live-ai --check-restart
```

The verifier prompts for the workspace passphrase without echoing it. It checks public DNS addresses and normal TLS certificate validation, PWA assets, private-route protection, secure cookies, CSRF rejection, upload/error recovery, backups, and logout. It creates only a clearly named **SYNTHETIC DEPLOYMENT QA** template and removes that template afterward. It does not create physical evaluation results or modify your existing templates.

With `--check-restart`, keep the verifier process open. When prompted, restart the service in Render, wait until healthy, then press Enter in the local terminal. The verifier checks that the **same session and template/photo** survived. With `--live-ai`, it makes two real, potentially billed provider connection checks using synthetic fixtures. Omit that flag for a software-only check. The result is saved to ignored `artifacts/public-deployment-verification.json`; failures are not reported as a successful deployment.

Afterward, test the URL on iPhone cellular data as well as Wi-Fi. That confirms reachability outside your computer/network. The public verifier has been prepared but **has not run against a hosted WorldOS URL** because no service exists in this session.

## iPhone installation and photo test

1. Open the verified **HTTPS WorldOS URL** in Safari on your iPhone. Sign in and confirm your template library loads. Leave **Connection → backend address** blank for the website's own backend.
2. Tap Safari's **Share** control, then **Add to Home Screen**. Enable **Open as Web App** when offered, then tap **Add**. [Apple's instructions](https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios).
3. Launch WorldOS from the home-screen icon. Sign in there if requested; Safari and the installed app may use separate storage contexts. Browser cookies persist for up to eight hours, including reloads, unless you sign out, change the server passphrase, or clear website data.
4. Choose **New template → Take reference photo**. Capture a real workspace and confirm the preview's orientation. Separately test **Upload reference photo** from the library. JPEG/PNG/WebP are supported; large photos resize before upload. If Safari supplies HEIC/RAW, use camera capture or export a JPEG as the error message explains.
5. Cancel a picker and confirm no scan starts. Deny camera access once, confirm the recovery message, then use the library or restore permission yourself. Test portrait/landscape and the onscreen keyboard.
6. Save a reviewed reference, take an inspection photo, review matches/alignment, generate a valid correction, physically move the object, and photograph verification. Keep automatic and manually corrected outcomes separate using the existing evaluation workflow.
7. Reload while signed in and check the saved template. Disable connectivity and reload: expect the explicit offline page. Reconnect and retry; no AI task is queued or completed offline. Export unsaved work before accepting an app update.

PWA manifest, icons, Apple metadata, secure-context service-worker registration, and public asset MIME types are implemented/tested. API calls and private data are never cached by the worker. **Actual Safari camera capture and Add to Home Screen installation still require your iPhone; they have not been physically verified in this session.**

## Security and session behavior

- Same-origin browsers use a host-only `__Host-worldos_session` cookie with `Secure`, `HttpOnly`, `SameSite=Strict`, path `/`, and an eight-hour maximum age. Only session fingerprints and expiry/credential identifiers are stored in `auth.sqlite3`; neither plaintext passphrases nor raw tokens are stored there.
- Browser mutations require both the correct Origin and a session-bound CSRF header. The CSRF value lives in memory. Native/separate-origin clients retain memory-only bearer tokens and never receive the website's cookies or CSRF value.
- Sessions survive reloads and backend restarts, but logout revokes the stored session and changing the password hash invalidates previous sessions. Failed offline logout is explicitly reported; the UI does not falsely claim the cookie has been revoked.
- Login is limited to five attempts per address per 15 minutes, with an overall throttle. Production API calls are limited to 120 general requests and 20 inference-related requests per session per minute. At most two writing/upload requests run concurrently. Excess requests return 429 and are not queued.
- Request bodies are bounded to 32 MiB, sign-in bodies to 8 KiB, and body reception to 30 seconds, including chunked uploads. The existing decoded-image/upload limits also apply. Authentication runs before private body parsing or inference.
- HSTS, CSP, anti-framing, no-referrer, MIME protection, no-store private responses, and camera-only permission policy are configured in the API. Production access logging is disabled; provider diagnostics retain sanitized status/timing only.

The owner has a private workspace. Optional judges share a separate demo workspace and have no access to owner templates, inspections, photos, reports, backups, API docs, or connection probes. This is not a multi-tenant account system: all judges can see and edit each other's demo data. Use one service instance/worker. Role selection is validated by the server; sending a role header or another workspace's ID cannot change it.

## Optional controlled judge/demo access

Judge access is **disabled by default**. Keep your owner passphrase private. To enable a time-limited demonstration:

1. Generate a different judge passphrase locally. Choose your actual access deadline; this example allows access until midnight Eastern time after November 4:

   ```powershell
   .\.venv\Scripts\python.exe scripts/create_login.py --access judge --expires-at 2026-11-05T05:00:00Z
   ```

   Hidden prompts write the hash and expiry to ignored `.env.judge`. The helper refuses to overwrite an existing file and never changes owner or provider credentials. A judge passphrase matching the owner's is rejected at sign-in.
2. In the Render service, open **Environment**, add `WORLDOS_JUDGE_PASSWORD_HASH` and `WORLDOS_JUDGE_ACCESS_EXPIRES_AT` using the values from `.env.judge` without their surrounding quotes, and save/redeploy. They are intentionally absent from the default Blueprint so judge access is opt-in. Both are backend variables, never `VITE_` variables.
3. Open a separate browser profile or private window. Select **Judge demo workspace** at sign-in and use the demo passphrase. Create a reference in this separate workspace, scan, review uncertain matches, generate corrections, and verify. Owner references are not automatically copied to judges.
4. Judge sessions last at most two hours and never outlive the configured expiry. The expiry is checked on every private request. Removing or changing the judge hash and restarting revokes existing judge sessions without invalidating owner sessions. Closing access does not delete demo photographs.
5. All judges share a limit of ten AI-related requests per minute, including after signing in again, and 120 other API requests per minute. Shared concurrency limits also apply. This throttle resets on server restart and is not a spending cap. Share access only with the invited demo audience and use a short window.

Demo templates, embedded photos, trials, and inspections persist in `WORLDOS_DATA_DIR/judge-demo/worldos.sqlite3`. The session database migrates from v1 to v2 while preserving owner sessions. Regressions verify isolation, forged-role rejection, credential rotation, expiry, actual process restart, and the full inspection/review/correction/verification flow using explicitly synthetic inputs and mocked inference.

## Persistence, backups, and restoration

The disk contains:

```text
/var/data/worldos/worldos.sqlite3   templates, embedded photos, inspections, trial evidence
/var/data/worldos/auth.sqlite3      hashed session identifiers and expiry
/var/data/worldos/backups/          workspace snapshots and latest.json metadata
/var/data/worldos/judge-demo/worldos.sqlite3   separate shared judge demo data
```

The app takes an integrity-checked SQLite online backup of the **owner workspace** at public startup and every 24 hours, retaining seven snapshots. Each snapshot is published atomically and never replaces an existing file. Metadata includes its timestamp and SHA-256. Login sessions and provider credentials are excluded from workspace backups. Provider credentials remain in Render's environment settings. Judge data persists separately; when it contains evidence you want to retain, run the same backup CLI with `--data-dir /var/data/worldos/judge-demo` and a new output filename, then copy that snapshot off the service disk. The owner backup download does not include judge data.

An authenticated **owner** may request `POST /api/admin/backups` and download `GET /api/admin/backups/latest`; judges receive 403. Cookie callers must send their CSRF header for the POST. The public verifier tests these endpoints. Maintain a copy outside the service disk: retained backups on the same disk do not protect against deleting that disk/service. Render's disk snapshots are additional protection, not a substitute for tested SQLite backups. [Render's database recovery guidance](https://render.com/docs/disks#restoring-a-custom-database).

For a local workspace backup:

```powershell
.\.venv\Scripts\python.exe scripts/backup_workspace.py --data-dir .\data --output .\artifacts\worldos-backup.sqlite3
```

The output path must be new. To test restoration without overwriting anything:

```powershell
.\.venv\Scripts\python.exe scripts/backup_workspace.py --data-dir .\artifacts\restored-worldos --restore .\artifacts\worldos-backup.sqlite3
$env:WORLDOS_DATA_DIR = (Resolve-Path .\artifacts\restored-worldos).Path
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

For Render recovery/import, securely upload a workspace snapshot through your authorized Render SSH/SFTP connection. In the service shell, restore it into a **new** directory:

```sh
python scripts/backup_workspace.py --data-dir /var/data/worldos-restored --restore /path/to/uploaded-snapshot.sqlite3
```

Then change the service's `WORLDOS_DATA_DIR` to `/var/data/worldos-restored` and restart. Startup validates that the selected directory is directly under the mounted disk, sets the known database ownership, and runs migrations. Keep the previous directory until you verify the restored templates/photos and evidence. Never replace the active database in place. Sessions are not restored from a workspace backup, so sign in again. Existing local data is not automatically copied to Render; use this procedure if you have local references to transfer.

Monitor disk capacity in Render. Backup failure emits a generic operational error; it never deletes workspace data or silently claims a successful backup. Download and inspect `latest.json` through your server's authorized shell if auditing scheduled backup freshness. Do not expose the disk as a static directory.

## Executed validation

| Check | Actual result |
|---|---|
| Backend regression suite | **310 passed**, 2 optional live tests skipped |
| Frontend regression suite | **124 passed**, 16 test files |
| TypeScript/Vite production build | Passed |
| Planner HTTP smoke | Passed |
| Inspect HTTP + SQLite restart smoke | Passed; mocked inference/synthetic fixtures |
| Mobile HTTP smoke | Passed, including process cleanup |
| Production-mode HTTP smoke | Passed; simulated TLS termination, real local HTTP and process restart |
| Cookie persistence / CSRF / expiry / revocation | Passed |
| Owner/judge isolation, expiry, rotation, migration, shared throttling | Passed; synthetic regression and HTTP checks |
| Upload rejection / chunked limits / throttling / recovery | Passed |
| Workspace backup, embedded-photo restoration, retention | Passed |
| Render Blueprint official schema | Validated successfully |
| Known credential scan across 161 source/build/config files | No matches; `.env`, `.env.auth`, `.env.judge` ignored and untracked |
| Actual public HTTPS deployment | **Not performed** |
| Docker image build on this Windows machine | **Not performed: Docker unavailable** |
| Physical iPhone installation/camera | **Not performed** |

Separate opt-in live requests through production-mode authentication succeeded on 2026-10-27 UTC (2026-10-26 local). Inbound HTTPS was simulated by the ASGI test transport; outbound model requests were real:

| Provider | Model | Result | Recorded latency | Reported usage |
|---|---|---|---|---|
| Meta | `sam-3.1` | Successful validated live connection inference | 1,062 ms | Token fields returned as 0; no cost inference made |
| Baseten | `meta-models/muse-spark-open-1026` | Successful validated live connection inference | 1,157 ms | 150 prompt + 29 completion = 179 tokens |

These used synthetic connectivity fixtures, **not physical workspace trials**. They do not prove Render network access or iPhone operation. See [sanitized evidence](v08-provider-connectivity.json). The public deployment must repeat these checks after its secrets are configured.

Reproduce software validation from the repository root:

```powershell
.\.venv\Scripts\python.exe -m pytest backend/tests -q
npm.cmd test
npm.cmd run build
.\.venv\Scripts\python.exe scripts/smoke_test.py
.\.venv\Scripts\python.exe scripts/smoke_inspect.py
.\.venv\Scripts\python.exe scripts/smoke_mobile.py
.\.venv\Scripts\python.exe scripts/smoke_production.py
```

Optional real-provider check, which consumes API credits:

```powershell
.\.venv\Scripts\python.exe scripts/verify_production_ai.py --run-live
```

Use Node 24 LTS for deployment/reproducible builds. This computer runs Node 25.9, outside Vitest's declared supported LTS range; all frontend checks passed. Backend tests retain the existing Starlette/httpx deprecation warning and non-failing local pytest cache-permission warning.

## Deployment files and changes

The existing Docker/Render/PWA preparation was reviewed and retained; this iteration completes controlled judge access and adds its regressions.

| Area | Files |
|---|---|
| Deployment packaging, retained and validated | `Dockerfile`, `.dockerignore`, `render.yaml`, `deploy/compose.yaml` |
| Access and persistence changes | `backend/security.py`, `backend/session_store.py`, `backend/request_limits.py`, `backend/main.py`, `backend/launch_render.py`, `backend/inspect_routes.py`, `backend/inspect_store.py` |
| Owner/judge interface | New `src/access.ts`; updated `src/MobileShell.tsx`, `src/ConnectionStatus.tsx`, `src/mobile.css` |
| Credential provisioning | `scripts/create_login.py`, `.env.example`; actual `.env` credentials unchanged |
| Regression coverage | New `backend/tests/test_judge_access.py`; updated `backend/tests/conftest.py`, `src/MobileShell.test.tsx`, `src/ConnectionStatus.test.tsx` |
| HTTP and live-provider checks | `scripts/smoke_test.py`, `scripts/smoke_inspect.py`, `scripts/smoke_mobile.py`, `scripts/smoke_production.py`, `scripts/verify_production_ai.py` |
| Runbook and sanitized evidence | `README.md`, `docs/V08_DEPLOYMENT.md`, `docs/v08-provider-connectivity.json` |

PWA assets and `src/backend.ts`, previously implemented for mobile/cookie sessions, remain in use. `scripts/verify_deployment.py`, `scripts/backup_workspace.py`, `backend/production.py` and `backend/backups.py` supply the existing public verification, readiness, backup and restore paths.

## Final demo readiness checklist

- [ ] Review and push the application/deployment files; keep provider keys, auth files, photos and local databases out of Git.
- [ ] Sign in to Render, connect the repository, approve the selected paid service/disk, and supply the three required server-side secrets.
- [ ] Obtain the actual assigned HTTPS URL and pass `scripts/verify_deployment.py --url https://YOUR-ACTUAL-DOMAIN --live-ai --check-restart`. Keep its sanitized report. It creates temporary synthetic QA assets, not physical evaluation data.
- [ ] If inviting judges, configure their separate hash and expiry, then verify the empty/separate demo library in a private browser window. Visiting `/api/admin/backups/latest` with the judge session must return 403. Confirm a judge cannot open an owner template ID. Share only the demo passphrase.
- [ ] Download an owner workspace backup, store a private copy off Render, and test restore into a fresh directory. Back up judge evidence separately if retaining it.
- [ ] On the actual iPhone, test Safari capture, library import, cancellation, permission recovery, orientation, touch editing, standalone installation, reload/session persistence, and offline recovery on Wi-Fi and cellular.
- [ ] Capture genuine reference, changed-workspace, and corrected photographs. Keep the camera framing stable, review uncertain identities/alignment, perform the physical movement yourself, and record both automated and human-assisted results in the existing evaluation workflow.
- [ ] Record the final demonstration with no secrets visible. Show the provider results, actual photos, correction plan, physical change, and verification result. Use clearly labeled recorded evidence if live access fails; do not present a replay as live inference.

No public deployment, Docker runtime build, physical iPhone installation, or real-world movement accuracy claim is made by these software checks.
