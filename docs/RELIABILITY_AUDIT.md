# Journey reliability audit

This pass tested transitions, interrupted saves, authentication, and recovery beyond the earlier normal-path room checks. The regression suite first reproduced broken private navigation, missing room persistence in the private workspace, setup overwrites between tabs, and misleading failed-save status. The fixes below are implemented and verified locally.

| Failure | Fixed behavior | Regression evidence |
|---|---|---|
| Reloading a private page switches to device mode | The workspace is part of the URL and survives reload | Browser: private reload |
| Browser Back restores a page in the wrong workspace | Back/Forward restore workspace mode along with the page | Browser: private history |
| Room work opened from the private home lacks project persistence | Both entry paths use the same saved room editor | Browser: private room, rename and reload |
| A stale setup tab overwrites newer notes | Atomic IndexedDB revision checks preserve stale edits in a separate recovered setup | Browser: two setup tabs; component regression |
| Failed setup saves continue displaying “Saving” | Explicit unsaved status, export of current edits, and retry | Browser: injected storage-full failure, export, retry |
| A failed capture save prevents all later attempts | Retry saves the current capture again after storage recovers | Component regression |
| Existing cookie sessions require another sign-in after losing their in-memory CSRF token | Refresh the session and retry once only when the server confirms rejection before execution | Frontend and backend CSRF regressions; real HTTP security check |
| A rejected queued design loses its accepted survey identity | Keep the original survey available for reconnection | Room regression with rejected dependent submission |
| A successful server task is hidden when saving its device shortcut fails | Open the accepted task and explain the failed device shortcut | Mission regression |
| Missing saved tasks show a misleading new-photo form | Show reload, My Spaces, and new-task recovery actions | Mission regression |
| Research notes disappear after reload and multiple participants share one recording | Save notes and assistance; export the previous session before starting a new recording | Component and browser regressions |

Setup edits also flush when the page becomes hidden. IndexedDB synchronous failures close the database connection, and pending writes complete before same-tab deletion.

## Validation

- 484 frontend tests pass across 55 files.
- 403 backend tests pass; two optional live-provider tests are skipped.
- TypeScript and the production build pass.
- Normal room/photo workflows pass at 320, 390, and 1440 pixels.
- All eight existing recovery browser scenarios pass.
- Seven new browser scenarios pass, including long saved names at 320 pixels and runtime-error checks.
- The isolated real HTTP production check passes authentication, CSRF, owner/judge isolation, backup integrity, restart persistence, and logout revocation.
- Read-only navigation on the public URL recorded in this repository, `https://worldos-inspect.onrender.com/`, loaded Home, Prepare, camera example, Room, My Spaces, and Settings at three widths without runtime errors or horizontal overflow. API mutations were blocked during this public audit.

Browser fixtures are synthetic. These checks do not establish live AI usefulness, calibrated room dimensions, physical-phone behavior, or comparative hackathon performance. The public site served the earlier build during the audit; local results do not imply deployment.

## Repeat the checks

Run `npm test -- --configLoader native --maxWorkers=4`, `python -m pytest backend/tests -q`, and `npm run build -- --configLoader native`. Then run `scripts/smoke_workspace_upgrade.py`, `scripts/smoke_workspace_recovery.py`, and `scripts/smoke_journey_reliability.py` in that order. Browser scripts accept `--browser` for an installed Chromium executable. `scripts/smoke_production.py` starts and stops only its own temporary server. All are included in release CI.

The next product-quality evidence should come from measured rooms and people completing real tasks, including bad lighting, clutter, slow connections, and camera permissions. Test counts alone cannot establish that the generated advice is useful.
