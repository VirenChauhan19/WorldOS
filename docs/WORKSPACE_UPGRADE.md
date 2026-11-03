# Guided spaces and reusable room projects

The default home now starts with **Get my space ready**. Select a goal, capture a photo locally, and continue to the existing private guided task. The capture survives navigation and the connection/sign-in step. My Spaces offers the last guided task and **Reset this space** on photo setups. Reset captures today’s view and uses the saved photo as the preferred reference; the existing planner compares the two and suggests relevant changes. Saving a preferred setup in the private task also saves a device copy when browser storage is available.

Reset attempts are saved against their source setup and resume with the current photo and notes after reload. **Start a new reset with a fresh photo** begins a separate attempt explicitly. The private handoff now reviews the selected photo and goal without presenting the goal picker again.

## Room projects and alternatives

Rooms are independent named projects in IndexedDB. The first visit migrates the previous single room draft and its photo without removing the originals. Room edits autosave, and My Spaces lists all projects. Duplicate creates an independent room. Saved alternatives capture the layout and its matching photo; restore first preserves the current arrangement. Each room holds twelve alternatives. At that limit, an alternative can open as a new room without overwriting the current room. Room JSON exports include their alternatives and can be restored from My Spaces under new identities. Imports validate photo data and geometry and never reconnect to exported server job IDs.

Writes compare revisions inside one IndexedDB transaction. If an older tab attempts to overwrite newer work, its edits become a separate **Recovered** room while the newer original remains intact. Room changes flush when the app becomes hidden. Save failures show **Changes not saved**, with export and retry available. Rooms can be archived and restored from My Spaces; alternatives can be removed and their most recent removal undone in the current editor session.

## Resumable room AI

The existing synchronous endpoints remain compatible. The application uses:

- `POST /api/ai/room/jobs`: client UUID and a validated survey, design, or queued design request (`survey_job_id`, goal, style, gap).
- `GET /api/ai/room/jobs/{id}`: workspace-scoped status and completed result.
- `POST /api/ai/room/jobs/{id}/cancel`: cancel an active action and reject its late result.

The job is independent of the browser’s HTTP connection. The project saves its job ID before sending inference, so navigating away, closing the tab, or reloading can reconnect to the result. Polling never submits inference. Authentication interruptions retain accepted jobs; polling limits use Retry-After before checking the same job. Identical submissions with the same ID are idempotent; reusing an ID with different input is rejected. Two room jobs may run per workspace. SQLite retains at most forty job records; starting a new request cleans up completed records older than seven days. Jobs have a six-minute outer expiry, while individual inference retains its existing two-minute cap. Authentication and owner/judge separation are inherited from the existing workspace store.

Queued/running/completed/failed/cancelled states describe actual server state. A disconnected client can reconnect to the current request; a failed stage can be explicitly retried without repeating the successful survey. A backend restart can interrupt running inference; it is reported as cancelled or expired and requires an explicit retry. This is not a durable distributed worker queue. Persisting the hosting data directory remains necessary to preserve server results across redeployments.

People can enter their wish list while the survey runs and choose **Design when room is ready**. Once accepted, this submits a dependent server job that waits for the survey and designs with the saved goal, priority, and gap even with the browser closed. A failed design retains its successful survey for an explicit design-only retry. Provider inference time itself has not been benchmarked or claimed to improve.

## Previews and offline use

Photo concepts use smoother rounded geometry, fuller foliage, shelf details, light direction based on visible windows, subtle material texture, and layered contact shadows. Selecting an item reveals its original design intent beside the photo. Dimensions and perspective remain approximate; no calibrated scale, reconstructed real-world occlusion, or verified physical fit is claimed.

Production builds generate a content-versioned service worker with an allowlist of public app assets, including lazy screens. After a successful first online installation, saved device photos, checklists, and room projects can open offline, including after a reload. API responses, authentication data, private server photos and inference results are not placed in the asset cache. The previous app build remains cached for open tabs. Cloud AI and initial model/runtime downloads require a connection. The UI announces offline state, and Settings offers an explicit browser storage-persistence request. Export remains the way to keep a separate backup.

## Validation

The implementation passes 484 frontend tests, 403 backend tests (two optional live tests skipped), and the production build. The normal browser flows pass at all three viewport sizes below, and all eight recovery scenarios pass. New regression coverage includes capture persistence, private-task reloads, independent projects, backup validation, protected restores, polling without duplicate inference, workspace separation, cancellation, and explicit retries after a failed design.

`scripts/smoke_workspace_upgrade.py --browser "C:\Program Files\Google\Chrome\Application\chrome.exe"` runs in a fresh headless profile against a loopback fixture server. It does not inspect existing browser windows, profiles or cookies. It checks capture handoff, queued design, reload recovery, independent rooms, alternatives, comparison, protected restore, export/import and offline cold start at 320, 390 and 1440 pixels. Fixtures are synthetic; these checks do not establish model accuracy or physical-phone behavior. Screenshots and a JSON report are written under `artifacts/workspace-upgrade/`.

On Windows where esbuild cannot inspect parent directories, the equivalent validation commands are `npm.cmd test -- --configLoader native` and `npm.cmd run build -- --configLoader native`. Backend tests can use a fresh `--basetemp artifacts/<test-directory>` to stay within the workspace.

After the upgrade browser check generates its synthetic fixture, `scripts/smoke_workspace_recovery.py --browser "C:\Program Files\Google\Chrome\Application\chrome.exe"` checks authentication/rate-limit recovery, two-tab conflicts, reset drafts, queued priority, archive/restore, removal undo, storage-full export/retry, and offline readiness. `.github/workflows/checks.yml` runs the suites, build, browser checks, and Docker image build for pushes and pull requests. The local frontend run uses `--maxWorkers=4` to avoid oversubscribing this workstation.

Settings now asks the controlling service worker to verify every required app asset before reporting offline readiness and shows estimated device storage usage. The existing persistent hosting configurations are `deploy/compose.yaml` and the explicitly paid `deploy/render.paid.yaml`. The default free `render.yaml` still uses ephemeral server storage; no hosting change or deployment was performed.

See [the physical-device study](PHONE_USABILITY_STUDY.md) for the remaining hands-on validation.
