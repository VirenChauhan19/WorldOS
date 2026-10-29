# Room Studio: furnishing, 3D preview and automatic spatial estimates

Open **Furnish a room** on Home or **Furnish a whole room** in Check my space (`#/room`). The initial example contains a queen bed, desk, table and wardrobe in a clearly labelled 4 × 4.5 m example room. It is not a measurement of the user's surroundings. These changes are local and have not been deployed.

## What now works

- Arrange up to 12 furniture pieces together. The planner checks their dimensions, rotations, room boundaries, heights when supplied, overlap and the requested gap between pieces.
- See recognisable, scaled 3D furniture in a cutaway room. Orbit, zoom, change finishes, edit dimensions, remove/add furniture, and drag or keyboard-move pieces in Floor plan.
- Use the same furniture geometry in native WebXR, anchored to a measured rectangle. Furniture is rendered as solid 3D meshes with depth testing, rather than flat camera labels.
- On devices exposing native plane geometry, automatically estimate stable horizontal surface areas. Confirm the detected outline once to place the whole arrangement. Three marked corners remain available when automatic geometry is unavailable or incomplete.
- On devices exposing labelled native object meshes, display observed width, depth and height estimates automatically. No user object labelling is required. The existing Meta camera recognition remains available in Camera view, with automatic discovery and no supplied concept labels.

## Measurement provenance

There are three distinct sources: **Example room**, **Your dimensions**, and **AR estimate / Detected surface area**. Editing the example preserves its example attribution. “Enter my room size” clears the example measurements before accepting user measurements. Ending AR retains the last measured rectangle for the 3D editor, labelled as a saved estimate. Tracking loss pauses live AR fit feedback.

Optional `plane-detection` and `mesh-detection` features use actual native WebXR geometry; they are not polyfills or invented dimensions. A plane must remain sufficiently stable for at least three frames and 500 ms. Candidates expire when tracking disappears or updates become stale. The selected rectangle stays inside the observed polygon, including concave/notched boundaries, and is inset by 1 cm. This inset only reduces numerical boundary spill; it is not an accuracy guarantee.

Automatic surface dimensions cover the **detected visible area**, which can be smaller than the room. A native floor label is preferred; an unlabelled horizontal plane is called a surface. Detection does not establish that the area is empty. This follows the [WebXR Plane Detection specification](https://immersive-web.github.io/plane-detection/), which exposes tracked polygons, poses and optional semantic labels.

Object estimates use finite bounds of explicitly labelled, upright native meshes, with at most 20,000 vertices processed per frame and three displayed results. Unknown and global meshes do not become named object measurements. These are bounds of observed geometry: hidden or unscanned parts can be absent, and an imperfect native label can be wrong. The implementation uses the [WebXR Mesh Detection interface](https://immersive-web.github.io/real-world-meshing/) and the approach described in [Meta's scene-understanding guide](https://developers.meta.com/vr/documentation/iwsdk/guides/11-scene-understanding/). Some runtimes require their device room-setup scan before exposing this data.

## Fit and appearance

`src/room/layout.ts` uses a bounded deterministic search with both axis-aligned orientations, wall preferences for beds/storage/desks, and open-space preferences for tables. Every result is independently checked. An unsuccessful bounded search says **no complete arrangement was found**; it is not presented as mathematical proof that no arrangement can fit. Individual dimension/height failures and excessive total footprint area are reported separately.

The gap is minimum separation between furniture footprints, not a guaranteed walking path or accessible doorway. Unoccupied floor area is the clipped union calculation's complement, not usable circulation area. The planner assumes a clear rectangular room. Existing objects detected in the camera or native mesh observations are **not reserved as obstacles**. Door/window locations, door and drawer swings, outlets, irregular room shapes and overhead clearances are not reconstructed.

Furniture dimensions are editable examples. The queen bed example uses a 1.65 × 2.15 m outer frame, rather than using mattress dimensions as the total footprint. Actual frame sizes vary; for example, [IKEA's SLATTUM specification](https://www.ikea.com/us/en/p/slattum-upholstered-bed-frame-vissle-dark-gray-70571256/) lists frame and mattress measurements separately. The preview is a dimensioned generic representation with illustrative materials, not a photorealistic image of a specific retail product or a simulation of the room's lighting.

The camera occupies the primary visual area, with stable controls and minimal floating labels, following [Apple's AR interface guidance](https://developer.apple.com/design/human-interface-guidelines/augmented-reality). Shared meshes keep the 3D and AR representations at the same scale.

## Validation

- Production TypeScript/Vite build passed.
- **272 frontend tests across 29 files passed**, including 20 planner tests, 17 RoomStudio interaction/lifecycle tests, 13 furniture-geometry tests and 25 XR tests.
- Isolated Chromium checked 1440, 1024, 768, 390 and 320 CSS pixel widths without horizontal overflow or page errors. Dimension changes, invalid/oversized furniture, adding/removing furniture, keyboard placement and fit updates passed.
- Actual browser WebGL rendered the interactive room. Tests exercised unavailable-WebGL fallback, context loss, context restoration and view/zoom controls.
- A **simulated** WebXR session with synthetic floor and object geometry exercised automatic surface confirmation, object-size display, solid furniture triangle rendering, tracking-loss suspension and retaining the estimate in the 3D editor. Browser QA found and fixed an AR overlay sizing issue that placed bottom controls outside the viewport.
- The Browser plugin connection remained unavailable, so browser QA used isolated headless Chromium. Evidence is in the ignored `artifacts/v16/` directory. No new live model request or private camera upload was made in this work.

No physical phone/headset scan or measurement-accuracy study has been performed. Runtime feature support, secure HTTPS access, device permissions and physical-device validation are still required. Ordinary camera recognition alone does not supply metric scale. Unsupported devices retain the 3D planner and measured-input workflow without being represented as automatic measurement devices.
