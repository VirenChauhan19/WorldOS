# WorldOS V0.7 — mobile delivery runbook

**Historical V0.7 guide.** Use [V08_DEPLOYMENT.md](V08_DEPLOYMENT.md) for current production deployment, persistent cookie sessions, backups, and iPhone installation. The native build instructions below remain applicable; V0.7's memory-only browser session limitation has been resolved in V0.8.

## What is implemented

The same React/TypeScript/Vite application now serves desktop, mobile web/PWA, and Capacitor. FastAPI, Meta SAM 3.1, Baseten Muse Spark, deterministic geometry, SQLite templates, evaluation trials, manual annotations, and reviewed verification are preserved. This release makes no new claim about physical inspection accuracy.

- Responsive dark UI, safe-area spacing, readable form fields, 44px mobile controls, horizontal stage navigation and stacked Inspect panels.
- Separate **Take photo** and photo-library actions at reference, inspection, and verification stages. Mobile JPEG/PNG/WebP photos resize proportionally to at most 1800px before upload; native capture corrects orientation. Unsupported HEIC/RAW shows conversion guidance. Cancellation does not start a scan. Permission failures offer a retry/library recovery path.
- Object dropdown, keyboard selection, zoom to 300%, and pan/edit modes. First touch selects an annotation; a second gesture edits it. Planner protection rules remain unchanged.
- PWA manifest, 192/512px and maskable icons, iOS home-screen icon, standalone display, safe-area layout, and explicit update/reload prompt.
- Offline service worker stores only a generic offline page and public icons. It never caches application HTML, API responses, photos, sessions, or inference. API fetches use `no-store`, omit cookies, and reject redirects. Offline actions are not queued and are never reported as successful.
- Capacitor native Camera, App lifecycle, Filesystem, and Share integrations. Native report export uses a temporary cache file and removes it after sharing. If Android kills the app while the camera is open, a recovery notice asks the operator to reopen the saved workspace and retake the image; no automatic scan is fabricated.
- An HTTPS backend selector, memory-only bearer sessions, sign-in/out, expiry handling, and discarded responses after server/session switches. Switching servers clears unsaved UI state and credentials. No provider key belongs in `VITE_` variables.

## Exact local startup

Use Node 24 LTS and Python 3.12. From the existing repository root in PowerShell:

```powershell
npm.cmd ci
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
```

Keep the existing `.env`; do not replace it. Existing Meta and Baseten credentials are unchanged by V0.7.

Development, two terminals:

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

```powershell
npm.cmd run dev
```

Open `http://127.0.0.1:5173`. Local unauthenticated access is restricted to loopback clients. Vite development mode does not register the PWA service worker.

To test the production web build and PWA assets locally:

```powershell
npm.cmd run build
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Open `http://127.0.0.1:8000` on this computer. A phone's `localhost` is the phone, so this address is **not** a phone deployment. Use a real authenticated HTTPS host for mobile testing; do not expose this development server directly.

## Authenticated HTTPS deployment

The repository includes `Dockerfile`, `.dockerignore`, `deploy/compose.yaml`, and `deploy/Caddyfile`. They build the web app, run a non-root API with persistent SQLite storage, and put Caddy TLS in front of the API. The API port is not published. Only the fixed proxy address is trusted for forwarded headers. Public startup requires authentication and exact allowed hosts/origins.

1. Prepare a server with Docker Compose, a domain pointing to it, and inbound ports 80/443. Keep the server's `.env` private and populate the existing backend-only provider variables. Never commit or put credentials into the image/build arguments.
2. Run the following locally with the repository's Python, or on the server with the backend dependencies installed, and type a unique passphrase when prompted. The script writes only its salted PBKDF2 hash to ignored `.env.auth`; it refuses to overwrite an existing file. Transfer this file securely to the server if created locally.

   ```powershell
   .\.venv\Scripts\python.exe scripts/create_login.py
   ```

3. From the repository root on the deployment host, set the **actual** DNS hostname (without scheme/path), then start the supplied stack. PowerShell syntax:

   ```powershell
   $env:WORLDOS_DOMAIN = 'your-actual-worldos-domain.example'
   docker compose -f deploy/compose.yaml up -d --build
   ```

   POSIX shell equivalent: `export WORLDOS_DOMAIN=your-actual-worldos-domain.example` followed by the same Docker command. The `.example` value is a placeholder, not an existing deployment.

4. Open the HTTPS site. Sign in before accessing templates, photos, AI, diagnostics, reports, or API docs. `/api/auth/status` is a deliberately minimal unauthenticated readiness response. CORS allows the deployed web origin and native origins `capacitor://localhost` / `https://localhost`.
5. Confirm an unauthenticated `GET /api/inspect/templates` returns 401, HTTP redirects to HTTPS at the proxy, and HTTPS certificates validate without bypassing warnings. Verify real provider readiness and perform a small explicit inference in the app.

No public server was deployed in this run: this machine has no Docker installation, and no domain, deployment host, or operator passphrase was supplied. Validate the Compose/Caddy stack on the actual server before the demo. Never run `docker compose config` with real env files in a shared terminal/log: it can expand secrets. Use `config --quiet` if checking configuration.

Authentication is intentionally for a single trusted demo operator/workspace, not a multi-tenant account system. Run one API worker/container: sessions and login throttling are in memory and reset on restart. Sessions expire after eight hours; reloading/closing the app also requires sign-in. Anyone with the passphrase can access the same workspace data. SQLite/backups are not encrypted by this application; protect the server and backups. Restore and test backups before deployment, following [DEMO_READINESS.md](DEMO_READINESS.md). Stop the API before copying the named volume or use SQLite's backup API; do not copy only a live `.sqlite3` file while ignoring WAL files. Existing local `data/` is not automatically migrated to the Docker volume.

## Install on an iPhone or Android phone

1. Deploy the authenticated HTTPS site above; verify it works from the phone's network.
2. On iPhone, open the site in Safari, choose **Share → Add to Home Screen**, enable **Open as Web App** when shown, and add it. Launch WorldOS from the home-screen icon and sign in. [Apple's installation guide](https://support.apple.com/guide/iphone/iphea86e5236/ios).
3. On Android Chrome, use WorldOS **Install** when offered, or the browser's **Install app / Add to Home screen** action.
4. The installed PWA opens without the normal browser address bar. Operating-system status/home indicators remain as platform behavior; safe-area padding is included. It does not require an App Store release.
5. Test **Take reference photo** and **Upload reference photo** separately. Mobile browsers control whether a capture input opens a camera or offers a chooser. Allow camera access only when capturing. Inspect, review, plan, photograph the real correction, and verify. AI and saved data always require the backend connection.
6. Disable connectivity and reload: expect the explicit offline screen, never a completed inspection. Reconnect and retry. Unsaved annotations are in memory and can be lost on reload; save templates and export evidence before updating.

The manifest/icon/worker prerequisites and fallback behavior have automated coverage; installation and camera behavior on actual iOS/Android devices have not yet been verified.

## Android native build on Windows

The `android/` Gradle project exists with app id `app.worldos.inspect`, version 0.7.0, target/compile SDK 36, minimum SDK 24, icons, disabled cleartext traffic, and disabled application backup. Capture uses the system camera and photo picker with `saveToGallery: false`. The official Camera plugin requires no broad storage/camera permissions for that configuration; older devices use the system document picker fallback. [Camera permission contract](https://capacitorjs.com/docs/apis/camera).

Install Android Studio 2025.2.1 or newer, SDK Platform 36/build tools, and its bundled compatible JDK. Configure SDK location in Android Studio and make Java available to Gradle (`JAVA_HOME` can point to Android Studio's `jbr`). [Official environment requirements](https://capacitorjs.com/docs/getting-started/environment-setup).

Then, from the root:

```powershell
$env:VITE_API_BASE_URL = 'https://your-actual-worldos-domain.example'
npm.cmd run cap:sync
npm.cmd run cap:android
```

`cap:sync` first builds with the required HTTPS backend origin and then synchronizes both platforms. Open the Android project, wait for Gradle sync, choose an emulator/device, and run. Command-line debug build after configuring the SDK:

```powershell
Set-Location android
.\gradlew.bat assembleDebug
```

Expected output: `android/app/build/outputs/apk/debug/app-debug.apk`. For Play distribution, configure your own signing key securely and build a signed release AAB in Android Studio. Keystores are Git-ignored. This run attempted Gradle, which stopped because Java/`JAVA_HOME` is missing; the Android SDK and Android Studio are also absent. **No APK or AAB exists from this work.**

Never substitute `http://localhost:8000`, a LAN HTTP URL, or a provider key for the backend URL. Production/mobile build guards reject insecure, loopback, credential-bearing, or path-bearing backend origins. Current synchronized web assets were used for infrastructure checks without a deployed URL; native runtime therefore requires **Connection → backend address** before requests. Rebuild with the real deployment URL before distributing. Capacitor's internal `https://localhost` WebView origin is not an API endpoint.

## iOS native build and App Store readiness

The `ios/` Xcode project was generated with Swift Package Manager, camera/photo purpose strings, WorldOS icons, and a Filesystem required-reason privacy manifest included as a build resource. No broad ATS exception or HTTP backend bypass was added. [Filesystem privacy manifest requirements](https://capacitorjs.com/docs/apis/filesystem).

Use a Mac with Xcode 26+ and command-line tools, or a suitable hosted macOS build service with secure signing. Install Node 24, run `npm ci`, set `VITE_API_BASE_URL` to the deployed HTTPS origin, then run `npm run cap:sync` and `npm run cap:ios`. Select your Apple development team, verify that `app.worldos.inspect` is an available identifier for your team (change it consistently if needed), and run on a real iPhone. [Capacitor's iOS requirements](https://capacitorjs.com/docs/getting-started/environment-setup).

App Store distribution still needs an Apple Developer account, registered app identifier, signing/provisioning, an actual archived/validated iOS build, a working authenticated public backend, device/TestFlight validation, App Store Connect metadata/screenshots/support and privacy-policy URLs, reviewer access, and accurate privacy declarations describing stored photos and Meta/Baseten processing. Review current SDK/upload requirements at submission time. The included privacy manifest is not a substitute for the app's privacy policy or App Store data disclosures. [Apple submission requirements](https://developer.apple.com/app-store/submitting/) and [privacy details](https://developer.apple.com/app-store/app-privacy-details/).

**No IPA, Xcode archive, signing configuration, TestFlight upload, or App Store submission was generated.**

## Validation and remaining device checks

Executed in this checkout:

| Check | Actual result |
|---|---|
| Backend suite | 283 passed; 2 optional live-provider tests skipped |
| Frontend suite | 117 passed across 16 files |
| TypeScript + Vite production build | Passed |
| Original planner HTTP smoke | Passed; synthetic images/no live provider calls |
| Inspect HTTP + database restart persistence | Passed; mocked provider and isolated SQLite |
| Mobile HTTP smoke | Passed; real HTTP auth/login/logout, native CORS, JPEG upload, private-file isolation, PWA MIME types/icon dimensions |
| Android/iOS Capacitor sync | Passed, four plugins on each platform |
| iOS project and permission/privacy plists | Parsed/checked; not compiled |
| Mobile release URL gate | Missing URL refused as intended |
| npm audit | Zero known vulnerabilities after patching UUID in Xcode tooling |
| Browser visual check | 390×844 Inspect overview/template controls reviewed; no physical device emulation claim |
| Native compilation | Blocked: Java/Android SDK absent; iOS requires macOS/Xcode |
| Container deployment | Not run: Docker/host/domain unavailable |
| Physical camera/PWA installation | Not run on real devices |

The browser file-upload tool required extension file-URL access; subsequent native UI inspection was stopped by the Computer Use URL verification guard. No successful browser upload is claimed from that attempt. Automated upload control, photo resize, cancellation/error, and authenticated HTTP image tests passed. The temporary viewport override could not be reset after Computer Use stopped; close the QA tab if it remains open. No browser permissions were changed.

Software tests exercise backend access control, safe authentication errors, token expiry/revocation, remote HTTP rejection, native CORS, no caching of API data, discarded requests after a server switch, offline behavior, camera/photo preparation, repeat selection, native share-file cleanup, touch selection versus dragging, and PWA worker behavior. The test runner here uses Node 25.9, which is outside Vitest's declared supported LTS range; all tests passed, but use Node 24 for reproducible builds. Backend tests emit an existing Starlette/httpx deprecation warning and a non-failing local pytest cache warning.

Reproduce:

```powershell
.\.venv\Scripts\python.exe -m pytest backend/tests -q
npm.cmd test
npm.cmd run build
.\.venv\Scripts\python.exe scripts/smoke_test.py
.\.venv\Scripts\python.exe scripts/smoke_inspect.py
.\.venv\Scripts\python.exe scripts/smoke_mobile.py
npm.cmd audit
```

Before recording the final demo:

- [ ] Deploy HTTPS + passphrase; check certificate, unauthenticated 401, login/logout and backend/provider readiness from both phones.
- [ ] Back up SQLite and photos, then verify a restored template and inspection. Keep credentials and signing keys outside source control and the frontend.
- [ ] Install on real iPhone Safari and Android Chrome. Test portrait/landscape, notch/home indicator, onscreen keyboard, small-object selection, zoom, pan, and scrolling.
- [ ] Test camera grant/denial/cancellation, photo-library selection, rotated photos, large photos, unsupported format messages, app backgrounding/restart, and native report sharing.
- [ ] Test loss/recovery of Wi-Fi, login expiry, provider timeout/rate limit, and PWA updates without claiming any offline AI work.
- [ ] Create a reviewed reference, physically displace an object, capture an inspection, review identity/alignment, follow a valid correction, and capture verification. Use the existing evaluation trial workflow to keep automatic and assisted outcomes separate. Do not record software fixtures as physical evidence.
- [ ] Record the actual end-to-end phone demo and export its evidence report; retain the desktop/manual workflows as recovery options. Follow [the submission checklist](DEMO_READINESS.md) for demo evidence and the hackathon package.

V0.7 made no new paid provider calls or physical movements. Earlier live-provider evidence remains in [SAM_RESTORATION_RESULTS.md](SAM_RESTORATION_RESULTS.md); actual before/after physical accuracy remains unmeasured.
