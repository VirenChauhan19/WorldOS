# Photo room designer

The primary flow is now **photo → automatic estimate → wish list → editable design**. Manual dimensions and floor-corner controls remain optional. Capturing or choosing a photo immediately calls the connected vision provider, using the existing backend authentication and request limits. The UI discloses that the captured photo goes to the AI service; live object labels still run locally in device mode.

The survey returns an approximate rectangular floor, a perspective outline, plausible width/depth ranges, visible features, estimated furniture and door reservations, and ideas for the room. It can decline an unreadable photo and request a wider view without inventing dimensions. Device storage retains the canonical photo and analysis in IndexedDB and the arrangement in the existing room draft.

The user describes furniture, mood, or changes and chooses Balanced, More open space, or Focus & daylight. The provider returns a complete furniture list, preferred coordinates, reasons and tradeoffs. The local bounded geometry solver uses those coordinates as preferences, independently checks bounds, heights, reservations and gaps, and reports unplaced items without silently shrinking them. Sofas, shelves, plants and generic labelled custom pieces join the existing furniture models. Observed windows and doors appear on the 3D cutaway walls at estimated positions, with illustrative feature sizes. Existing pieces and their current checked coordinates are included in subsequent requests. All four quarter-turn orientations are supported in the photo, 3D, floor-plan, AR and USDZ paths. Designs can be undone, moved, rotated, resized, and inspected in 3D, floor plan, or the photo overlay.

Photo estimates do **not** establish metric scale, unseen geometry, a traversable walking route, or purchase-ready fit. The photo view renders stylized 3D furniture directly over the original image, with per-pixel depth between furniture surfaces, a before/after slider, selectable pins, optional clearance guides, and a downloadable concept PNG. The export includes the estimate disclaimer. The projection follows the floor homography and uses an inferred visible wall-to-ceiling anchor when consistent; camera intrinsics and metric scale are not calibrated. Furniture can be distorted when inferred floor geometry is inaccurate, and occlusion by real objects is not reconstructed. The separate 3D view remains useful for inspecting every piece. Confidence labels are qualitative; ranges are model estimates, not calibrated statistical intervals. When the solver or user changes a proposed location, the explanation is marked as the original design intent. A new photo clears the previous room coordinate system and furnishings. Cancellation, navigation, reset, and later requests invalidate older responses.

## Endpoints

- `POST /api/ai/room/survey`: inline room image. Returns validated survey data plus the canonical image used by the model, so overlays use the same orientation and image dimensions.
- `POST /api/ai/room/design`: inline image, goal, priority, room, reserved zones, visible features, current furniture, and gap. Returns furniture and preferred placements for the client solver.

Both endpoints use the configured Muse-compatible vision provider, validated structured output, bounded request sizes, the existing timeout/cache, and existing owner/judge access. No credentials are shipped to the browser. If authentication is needed, the room-specific connection action preserves the device draft and room route through sign-in.

## Demo sequence

1. Choose a wide room photo with the floor and wall junctions visible, or select **Try sample photo**. The credited Curtis Adams / Pexels sample uses live analysis, not a prerecorded response. Type the wish list while the automatic estimate runs.
2. Enter: **A cozy sofa, a reading corner, and a desk near the window. Keep the room feeling open.**
3. Choose **More open space → Design my room**. Furniture appears in the photo. Inspect the reasons beside it; switch to **3D room** to orbit.
4. Use **Compare** and drag the slider, then **Save concept**. Show the floor plan and its reserved areas.
5. Ask for a change, such as **Replace the sofa with a compact chair and add a bookshelf**. Show the updated arrangement and Undo design.

Use a real photo and rehearse against the configured provider before presenting. A single successful inference is not evidence of dimension accuracy.

## Validation

`backend/tests/test_room_design.py` covers actual-image forwarding, caching, malformed geometry, invalid ranges, unreadable photos, prompt context, output identities, and endpoint errors with synthetic provider responses. Frontend tests cover preferred placements, obstacle avoidance, impossible furniture, model bounds, automatic capture, persistence, cancellation, failure recovery, and undo.

`scripts/smoke_photo_room.py` serves the production build and checks the complete upload-to-design flow, photo comparison, reservations, reload and responsive layouts at 320, 390 and 1440 pixels. It uses an explicitly synthetic photo and mocked AI output; screenshots and its report go to ignored `artifacts/photo-room/`. It does not validate a physical room or provider accuracy.

Live provider checks were also run on two actual photographs: a window/radiator room by Christian Lue (Unsplash) and a window/pendant room with a floor vent by Curtis Adams (Pexels). The final survey/design calls took 66.92/44.14 seconds and 41.23/30.99 seconds respectively. Both returned three-piece designs that independently passed the local layout solver with no modeled collisions. A 32.01-second follow-up added a bookshelf while preserving all three existing pieces' dimensions, coordinates and rotations; all four pieces passed the solver. These are integration observations, not a room-measurement accuracy or latency benchmark. No ground-truth physical dimensions are known.

Reproducible tools:

- `scripts/check_real_room.py --photo <path> --output <json>` calls the configured real provider explicitly. `--refine-recording <json>` checks a follow-up bookshelf request.
- `node scripts/check_room_recording.mjs <json>` independently validates provider preferences with the client solver and records checked positions. Requires Node 22.18+ for native TypeScript stripping.
- `scripts/smoke_photo_room.py --recording <json>` replays those recorded live results in the production UI. This is browser integration testing, not a new live inference. It checks upload, drawing pixels, comparison slider, PNG download, reservations, three views, persistence, no extra inference after reload, console errors and horizontal overflow at 320, 390 and 1440 pixels.

Browser QA requires Python Playwright plus Chromium. On this workspace append `--browser "C:\Program Files\Google\Chrome\Application\chrome.exe"` to the browser script.

Evidence is in ignored `artifacts/real-room/{sample-calibrated,second-calibrated,second-refined}.json` and `artifacts/real-room-ui-*/`. Credits for the bundled photo are in `public/room-sample-credit.txt`.

Validation: 444 frontend tests and 396 backend tests passed (2 optional backend live tests skipped), along with the production build. Relevant rendering tests were repeated after final surface-overlap fixes. Real-photo browser replays passed at all three viewport widths. Physical-phone AR and real metric accuracy remain unverified. Changes are local; they have not been deployed to Render.
