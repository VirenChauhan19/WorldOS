# Open directly, explore the camera, save on this device

WorldOS now opens its device workspace immediately. It does not check server authentication, wait for a sleeping host, or fetch private records before rendering Home. The existing private workspace is an explicit option. Its passphrase, session expiry, CSRF checks, owner/judge isolation, and backend routes are unchanged. This is not a new account or cross-device sync system.

## Device workspace

- Home and the recorded detection example are public. Live camera recognition uses the bundled local model; the device camera path never calls the cloud recognition APIs.
- Tap a live object to hold the current frame, explore selectable labels, hide/show outlines, resume live recognition, or enter actual dimensions to check fit. A clearly labeled recorded example makes these interactions available before camera permission.
- Save a camera view or remembered area to My Spaces. Photo setups include notes, editable checklists, and an optional second photo for manual comparison. Starter checklists are labeled as generic; they are not presented as AI assessments.
- Photos and setups use IndexedDB under `worldos-device`. Save reports success after the transaction commits. JSON exports include the photographs and can be restored with fresh IDs, preserving existing setups. Imports accept only bounded raster data URLs and validated text/checklist fields.
- Room Studio automatically saves dimensions, furniture, positions, and reserved areas in `worldos.device.room.v1` local storage. Its reference photo and outline use a separate IndexedDB record. Private room work is not written to this device draft. See [the connected room-planning flow](V26_ROOM_PLANNING.md).
- Data belongs to this browser and site origin. It survives reloads and server restarts, but browser-data clearing, private browsing, or storage eviction can remove it. Setups can be exported; there is no automatic cross-device synchronization. The existing service worker remains an offline fallback, not a complete offline app cache.

## Private workspace

The optional private workspace retains server-backed guided missions, cloud AI questions, automatic photo assessment, detailed inspection, and server history. Opening it does not import device photos. Returning to the device workspace clears client session state; it does not delete private server records. Server storage on the configured free hosting remains ephemeral.

## Validation

Frontend regression coverage includes default entry without private requests, optional private access, installation help, validated backups, camera privacy, sample interactions, and the existing authenticated workflows.

`scripts/smoke_device_app.py` checks a production build at 320, 390, and 1440 pixels: sample interaction, labels, fit entry, save/reload, photo backup/restore, new checklist reload, room persistence, and optional login. It also runs the actual bundled local detector on a synthetic camera feed from the public desk image, checks tap-to-hold/resume/save, verifies track shutdown, and asserts zero private API calls in device mode. This is not a physical-phone or recognition-accuracy benchmark. Results and screenshots are written under ignored `artifacts/device-app/`.

Run against a local production frontend; no AI backend is needed:

```powershell
npm run build
.\.venv\Scripts\python.exe -m http.server 5173 --bind 127.0.0.1 --directory dist
# In another terminal; --browser may select an installed test Chromium executable.
.\.venv\Scripts\python.exe scripts/smoke_device_app.py
```

These changes require deployment before they appear on the public site.
