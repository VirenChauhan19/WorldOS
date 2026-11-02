# Camera to measured furniture suggestions

Historical V26 workflow. The primary flow is now the [automatic photo room designer](V27_PHOTO_ROOM_DESIGNER.md); manual entry remains optional.

Room Studio now connects a live camera or photo to a measured area, reserved floor rectangles, furniture suggestions, and the same editable placement plan. Device mode opens with an empty furniture selection; the private workspace retains its existing example arrangement.

## Using the flow

1. Open **Room Studio → Look at my space**. Device recognition labels common visible objects. Capture the area, or choose a room photo if the camera is unavailable.
2. Enter the width and length of the rectangular floor area you want to furnish. Enter height if it should constrain tall furniture.
3. In **Photo plan**, tap the back-left, back-right, front-right, and front-left corners of that same rectangle. Width runs from corner 1 to 2, and length from 2 to 3. Numeric corner controls provide a keyboard alternative. They start with an adjustable guide, which must be aligned to the measured area.
4. Reserve rectangles for existing furniture, door swings, or access paths. Detected object names can create a reservation, but its actual floor dimensions must be entered. Move reservations in Floor plan or edit their positions numerically. Object reservations include the configured furniture gap; access reservations already represent the full area to keep clear.
5. Review the measurements, outline, and reservations. **What can go here?** lists catalogue examples with a valid placement in the remaining modeled area. An incomplete photo outline or invalid geometry blocks these suggestions.
6. Add a suggestion. Already placed furniture keeps its position; remaining options update. The same placements appear in Photo plan, Floor plan, and the 3D room. They can be moved, rotated, resized, or removed. Conflicts and malformed reservations show an explicit reason.
7. Device dimensions, furniture, reservations, and review state save in the room draft. The reference photo and its outline save separately in IndexedDB. Reloading restores both. A fresh arrangement clears both, including prior reservations.

## What is measured and what is inferred

Ordinary browser camera recognition provides suggested object labels and image coordinates. It does not derive metric dimensions, hidden obstacles, doors, or a complete room map. Photo plan uses a planar perspective transform of the user's outlined and measured rectangle; its overlays show furniture footprints, rather than synthesizing furnished room photographs.

Devices with the existing WebXR measurement support can supply an observed floor rectangle. A new AR measurement clears reservations and the photo reference tied to the previous coordinate system. Users can then review the new area and define its reservations. Safari Quick Look retains its furniture preview; its viewer does not return room dimensions to this app.

Suggestions use generic editable dimensions, respect reserved geometry and the configured gap, compare height only when supplied, and consider 0°/90° orientations. Each is an alternative for the current arrangement. A rejected example means it exceeds dimensions, fails clearance, or no placement was found by the bounded candidate search. Unmarked obstacles and physical access remain outside the model. Real-phone camera, AR tracking, and physical fit still need device testing.

## Validation

- 401 frontend tests pass, including geometry and UI tests for reserved areas, valid photo transforms, measurement/review gates, adding furniture without moving prior pieces, persistence, and reset. The production build passes.
- `scripts/smoke_room_planning.py` verifies a production build in isolated Chromium at 320, 390, and 1440 pixels. It uses a synthetic camera feed and entered dimensions to cover capture and track shutdown, outline selection, access reservations, height filtering, stable prior placements, photo overlays, 3D, invalid input, reload/reset, camera denial, and upload fallback. Device planning makes no private API calls.
- `scripts/smoke_device_app.py` covers the broader device workspace and the actual bundled local detector on a synthetic camera feed. These checks are software integration evidence, not physical-device or recognition-accuracy benchmarks.

Test results and screenshots are in ignored `artifacts/room-planning/` and `artifacts/device-app/`. Run the room check against a locally served production `dist/`:

```powershell
.\.venv\Scripts\python.exe scripts/smoke_room_planning.py --url http://127.0.0.1:5173
```

Pass `--browser <installed-test-chromium-executable>` when the default Playwright browser is unavailable. The update is local until deployed.
