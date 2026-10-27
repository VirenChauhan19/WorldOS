# WorldOS V0.8 — Free Render deployment

Root [render.yaml](../render.yaml) provisions **one Free Docker web service without a disk, database, worker, or paid storage replacement**. The original Standard service and 5 GB disk remain separately in [deploy/render.paid.yaml](../deploy/render.paid.yaml) for future paid use. No Render resources or paid services were deployed or authorized during this change.

**Temporary storage: SQLite data, uploaded photos, templates, inspections, evaluation evidence, local backups, and login/session state may be lost on restart, redeployment, or idle spin-down.** Export important work to your device. Render documents filesystem loss on these events. The app warns before/after login and in startup logs. Signing in after a reset cannot recover the old workspace. [Free limitations](https://render.com/docs/free).

Authentication, secure cookies, CSRF, owner/judge isolation, Meta SAM 3.1, Baseten Muse Spark, Inspect, Spatial Studio, and PWA/native support remain available. Free hosting does **not** make external Meta/Baseten inference free; those APIs retain their billing/credits. Validation here makes no real provider calls.

## Exactly how to retry

1. Open [Render Dashboard](https://dashboard.render.com/) in your **Hobby** workspace. Connect GitHub to **VirenChauhan19/WorldOS** if needed.
2. If the attempt stopped at payment without creating resources, leave that stale form and select **New → Blueprint → Connect** beside WorldOS. Choose **branch `main`**, **Blueprint Path `render.yaml`**. Do not select `deploy/render.paid.yaml` or reuse a cached Standard/disk preview.
3. If a Blueprint exists, verify its repository, branch, and path under **Settings**, then click **Manual Sync** on its page. Review refreshed changes. A service's **Manual Deploy** alone does not apply Blueprint plan changes. If an old paid service/disk was provisioned, read the existing-resources note below first.
4. The preview must show **one web service (`worldos-inspect`), Free, $0/month compute, no disk or database**. If it shows Standard, a disk, workspace upgrade, or charges, stop and recheck branch/path/latest commit. Do not authorize that preview.
5. Enter runtime secrets directly in Render. For an existing service check **Environment**; `sync: false` values are retained and may not be prompted for again:

   | Variable | Private source |
   |---|---|
   | `WORLDOS_AUTH_PASSWORD_HASH` | PBKDF2 value from ignored `.env.auth`, without quotes; not the plaintext passphrase |
   | `MODEL_API_KEY` | Existing Meta key |
   | `BASETEN_API_KEY` | Existing Baseten key |

   If needed, create the owner login locally with `.\.venv\Scripts\python.exe scripts/create_login.py`. Hidden prompts write ignored `.env.auth` and refuse to overwrite it. Keep secrets out of Git, chat, screenshots, build arguments, and all `VITE_` variables. The login hash is mandatory. Empty AI keys in the service environment leave manual operation available. Do not set `VITE_API_BASE_URL` for this same-origin website.
6. Click **Deploy Blueprint** after verifying the free preview. Wait for Docker build and `/healthz` success. Open the actual HTTPS URL assigned by Render and sign in. If syncing finishes without a build, use the Free service's **Manual Deploy → Deploy latest commit**.
7. Set Blueprint **Settings → Auto Sync → No** if you want later infrastructure changes to remain manual. The file's `autoDeployTrigger: "off"` disables service code autodeploys; Blueprint Auto Sync is separate. [Setup and sync](https://render.com/docs/infrastructure-as-code).

**Keep hosting at $0:** use Hobby without paid resources/add-ons and stay within included bandwidth/build allowances. Without a payment method, exhausted allowances cause suspension or disabled builds. With a card on file, overages can still be billed on Free; YAML cannot cap all account billing. Check **Billing → Monthly Included Usage** and the build spend limit. Do not add payment information to retry the old paid preview. If a Free-only preview still asks for a card, ask Render support about account verification instead of approving paid resources. [Quotas and billing](https://render.com/docs/free).

**Existing paid resources:** removing a disk from YAML does not delete an existing disk. A disk-backed service cannot simply become a disk-free Free service. This change deletes no resources/data. Check the resource list, back up existing data, and create a new Free service if necessary. Existing paid resources can keep charging until explicitly removed. Never manage one service with both Blueprints. [Deletion rules](https://render.com/docs/infrastructure-as-code#deleting-resources), [disk restrictions](https://render.com/docs/disks).

## Runtime and resource budget

| Setting | Free default |
|---|---|
| Runtime | Node 24 builds static Vite assets; Python 3.12 serves frontend/API |
| Start | `python -m backend.launch_render` |
| Listener | `0.0.0.0:$PORT`, one worker, Uvicorn concurrency ceiling 8 |
| Health | `/healthz`: SQLite/session/writable storage checks, no model calls |
| Storage | `WORLDOS_STORAGE_MODE=ephemeral`, `WORLDOS_DATA_DIR=/tmp/worldos` |
| Images | 6 MiB uploads, 6 million source pixels, canonical max 1800 × 1800 |
| Requests | 12 MiB bodies; 8 KiB sign-in; 30-second body reception deadline |
| Mutations | One active upload/write/AI request; 429 on excess, no queue |
| CPU pools | OpenCV, OpenBLAS, OpenMP limited to one thread |
| Backups | Scheduled backups off; authenticated manual creation/download remains |

Render Free currently supplies **512 MB RAM and 0.1 CPU**, sleeps after 15 idle minutes, and shares 750 instance-hours per workspace/month. Waking can take about a minute; separate/native clients may need **Retry connection**. [Compute limits](https://render.com/docs/compute-plans), [Free lifecycle](https://render.com/docs/free).

There are no local SAM/Muse weights, PyTorch/GPU workers, or Node runtime server. Existing remote APIs perform inference. Local CPU work includes normalization, OpenCV alignment, password hashing, and bounded planning. Browser/native normalization usually reduces camera images below the server limit; direct API clients must resize larger photos.

**Assessment: suitable for light sequential demonstrations with limited headroom, not a production capacity guarantee.** A fresh Windows Python 3.12 probe measured **66.3 MiB startup peak / 326.2 MiB peak RSS** across three 6 MP RGBA PNG uploads, secure login/CSRF, SQLite templates, automatic/manual alignment, backups/downloads, and deletion. Iterations took about 2–4 seconds locally. This does not emulate Render Linux/cgroups or 0.1 CPU. Large libraries, concurrent reads, and provider payloads can raise memory. Monitor Render logs for memory exits/slow requests and reduce photo size/load if needed. No automatic paid upgrade is configured.

## Disposable state and backups

All these files are ephemeral:

```text
/tmp/worldos/worldos.sqlite3              owner templates/photos/inspections/trials
/tmp/worldos/auth.sqlite3                 session fingerprints, roles, expiry
/tmp/worldos/judge-demo/worldos.sqlite3   isolated judge workspace
/tmp/worldos/backups/                     manual local snapshots
```

Render environment secrets remain separate. Lost session records invalidate cookies/native tokens; sign in again using the configured passphrase. Data loss never disables authentication. Cookies retain `Secure`, `HttpOnly`, `SameSite=Strict`, host-only scope, CSRF/Origin checks, expiry/revocation, and rate limits. Reloads can retain login while the database exists.

Owners can POST `/api/admin/backups` with the session CSRF header, then immediately download GET `/api/admin/backups/latest`. Snapshots include owner photos/evidence and exclude credentials/sessions. Judge data is separate. A snapshot left on `/tmp` is **not durable**. Free has no SSH/dashboard shell; the paid SSH restore procedure does not apply. Restore a downloaded snapshot locally into a new directory:

```powershell
.\.venv\Scripts\python.exe scripts/backup_workspace.py --data-dir .\artifacts\restored-worldos --restore .\artifacts\worldos-backup.sqlite3
$env:WORLDOS_DATA_DIR = (Resolve-Path .\artifacts\restored-worldos).Path
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

The original disk-backed workflow is preserved in [V08_PAID_DEPLOYMENT.md](V08_PAID_DEPLOYMENT.md).

## Verify after deployment

```powershell
.\.venv\Scripts\python.exe scripts/verify_deployment.py --url https://YOUR-ACTUAL-HOST.onrender.com
```

The verifier privately prompts for the passphrase, checks HTTPS, private routes, cookies, CSRF, PWA, uploads, backups/logout, and removes its synthetic QA template. Results go to ignored `artifacts/public-deployment-verification.json`. **Do not use `--check-restart` on Free:** it expects persistent sessions/photos and is for the disk-backed option. Omit `--live-ai` to avoid potentially billed provider calls. No public service was verified here.

For iPhone: open the HTTPS URL in Safari, sign in, then **Share → Add to Home Screen → Open as Web App**. Test photo capture/library, cancellation, offline recovery, and Inspect. Installation does not preserve backend storage. Native/device instructions remain in [V07_MOBILE.md](V07_MOBILE.md).

Judge access stays disabled unless `WORLDOS_JUDGE_PASSWORD_HASH` and `WORLDOS_JUDGE_ACCESS_EXPIRES_AT` are set. Generate a different passphrase with `scripts/create_login.py --access judge --expires-at <your ISO timestamp with timezone>` and enter ignored `.env.judge` values in Render. Judges share an isolated demo workspace, cannot access owner data/backups/provider probes, and have sessions capped at two hours and the deadline. Free resets erase judge evidence too.

## Validation

Run from the repository root:

```powershell
.\.venv\Scripts\python.exe -m pytest backend/tests -q
npm.cmd test -- --maxWorkers=2
npm.cmd run build
.\.venv\Scripts\python.exe -m pip check
.\.venv\Scripts\python.exe -m compileall -q backend scripts
.\.venv\Scripts\python.exe scripts/smoke_test.py
.\.venv\Scripts\python.exe scripts/smoke_inspect.py
.\.venv\Scripts\python.exe scripts/smoke_mobile.py
.\.venv\Scripts\python.exe scripts/smoke_production.py
.\.venv\Scripts\python.exe -m pip install -r scripts/requirements-validation.txt
Invoke-WebRequest -UseBasicParsing https://render.com/schema/render.yaml.json -OutFile artifacts/render-schema-free.json
.\.venv\Scripts\python.exe scripts/validate_render.py --schema artifacts/render-schema-free.json
.\.venv\Scripts\python.exe scripts/check_free_resources.py
```

Executed: **315 backend tests passed, 2 opt-in live tests skipped; 125 frontend tests passed; TypeScript/Vite build, Python dependency/compile checks, both official Blueprint schema checks, and all four local HTTP smoke scripts passed.** The resource probe stayed below 512 MiB. Tests use synthetic data/mocked providers. Existing Starlette/httpx deprecation and local pytest-cache permission warnings did not fail tests.

**Docker build and Linux resource enforcement were not run because Docker is unavailable here.** Render's build/health check is still required. The Dockerfile was inspected and runtime imports checked locally. Regressions cover disk-free creation, paid mount enforcement, auth configuration, privilege dropping, resource limits, and session loss. Account-specific Render API validation, public HTTPS, real AI calls, and physical iPhone behavior were not executed. No paid services were created or authorized.
