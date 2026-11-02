# An easier app to start and return to

The device experience now centers on three useful actions: explore the camera, plan a room, or save a setup. The private workspace remains available from Settings for optional cloud features.

## What changed

- Home is an app dashboard with clear actions, recent saved work, and an interactive recorded camera example. It avoids leading with model names and workspace administration.
- Home, Camera, Room, My Spaces, and Settings stay available through a persistent navigation bar. The default device app no longer opens with a private-workspace banner.
- The live camera puts hold/resume, labels, and save beside its preview. Selection actions stay close, while the full inventory, recognition details, and privacy settings are available when expanded. Empty and unavailable-recognition states explain what the user can still do. The Home example link opens the recorded sample without requesting camera access.
- Room planning has three visible stages and a next-action card. Measurements precede furniture suggestions, the starting controls collapse once an area is measured, and size/finish/spacing controls remain optional. A 3D example room is available before measuring; exploring it does not overwrite the user's plan. Suggestions retain measured geometry and reserved-area constraints.
- My Spaces includes a recognizable saved-room card and saved photo/checklist setups. It refreshes when pending saves complete.
- Setup changes autosave after a brief pause and flush on internal navigation. The first save updates its address without replacing the focused editor. Reads wait for pending writes to avoid showing stale saved content. Photos that finish opening after navigation are still stored. Export uses the same normalized record shape as autosave. Missing records open a recovery screen rather than a starter setup with an invalid address.

## Validation

The production build and **414 frontend tests** pass. New coverage includes Home actions, camera example routing and dock actions, autosave/focus/navigation, normalized exports, late photo preparation, and missing-record recovery. Existing geometry, camera lifecycle, authentication, and private-workspace regressions remain covered.

`scripts/smoke_consumer_experience.py` runs against a production frontend at 320, 390, and 1440 pixels. It checks persistent navigation, reachable camera controls, the room example without saved-data changes, measured suggestions, collapsed customization, room cards, autosave through navigation/reload, and reopening the camera example. It asserts zero private API calls in the device journey. Reports and screenshots are under ignored `artifacts/consumer-experience/`.

`scripts/smoke_room_planning.py` checks capture, outlining, reservations, suggestions, photo/3D previews, invalid input, reload/reset, camera-denied fallback, and preservation of older device data during storage upgrades. `scripts/smoke_device_app.py` checks photo/checklist backup and restore plus the actual local detector on a synthetic camera stream. These are desktop Chromium checks at mobile viewport sizes; physical-phone camera and AR behavior still require device testing.

The service worker still provides an offline fallback. The frontend is not fully cached for offline startup, and cloud tools require the private backend. Saved device data belongs to this browser and origin; clearing site data can remove it. Deployment is required for these changes to appear on the public site.
