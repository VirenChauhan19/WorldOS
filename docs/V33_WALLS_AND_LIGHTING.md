# Walls, ceilings, and lighting

The AR interior studio now has 36 editable concept pieces. **Lighting** contains floor/table lamps, a pendant, a ceiling light, and a wall sconce. **Wall & window** contains framed/landscape artwork, a mirror, clock, floating shelf, curtains, and a TV. The same geometry feeds thumbnails, the 3D studio, WebXR, native RealityKit, and USDZ previews.

## Designing the room

- New wall pieces start centered on the back wall with an editable mounting height. Choose another wall to center there and face into the room. Along-wall position and height remain editable; the perpendicular coordinate and facing follow the chosen wall.
- Ceiling fixtures attach at the plan's ceiling. Changing ceiling height or fixture height updates their elevation. Oversized or invalid mounts are rejected.
- Light appearance supports on/off, 2700/4000/6500 K, and brightness. These change the illustrated fixture/diffuser appearance; they are not a photometric simulation of room illumination.
- Wall/floor color palettes affect the 3D studio. They do not paint real surfaces or add a room shell to the furniture-only USDZ export.
- Undo, duplicate, JSON export/restore, and local saving preserve model details, mounting, light settings, and room colors. Existing version-1 designs without these optional fields still load.
- The floor plan names all four walls and distinguishes ceiling pieces with dashed outlines.

## Interactive AR

The native editor and WebXR can target floor/tabletop, wall, or ceiling surfaces. A **Place against** selector can override the suggested target. While aiming, the inspector collapses so object controls cannot cover the center reticle; **Edit piece** returns to editing.

Wall hits set the object's back against the observed plane and face its front into the room. Ceiling hits require an upward view and a horizontal surface above the camera. The hit positions account for fixture depth/height rather than placing the entire model inside the surface.

Session rotations retain arbitrary observed wall angles separately from the editable plan's quarter turns. Resizing wall depth preserves back contact, and resizing a hanging fixture preserves ceiling contact. Observed positions and surface bindings remain session-only. Undo and duplicate retain the relevant session state; exiting AR discards it. A changed tracking origin invalidates it.

Surface changes revoke stale placement poses. Native state echoes the surface and placement revision to prevent delayed callbacks from placing on an earlier surface. Existing horizontal placement and room-measurement paths remain available. Native first-object placement is enabled as soon as a valid surface is tracked.

## Verification and release

- 756 frontend tests passed across 65 files, including mesh bounds, native/USDZ export for every catalog entry, mounting, persistence, surface classification, stale events, observed-angle editing, and UI workflows.
- Production TypeScript/Vite build passed.
- The unsigned iPhone/iPad Release build and compiled bundle verification passed on macOS for feature commit `d6ade3d`: [native iOS compile](https://github.com/VirenChauhan19/WorldOS/actions/runs/41703790931).
- Browser QA used a real WebGL scene with 14 pieces at 320, 390, and 1440 px. It verified walls/ceilings, lighting controls, palette, undo, export, and reload without page exceptions or horizontal overflow.
- Production browser regressions passed for workspace upgrade/offline recovery and public demo at 320/390/1440 px, all nine workspace-recovery scenarios, and all seven navigation/save-reliability scenarios. Harness selectors now distinguish room cards from their Delete controls and active save status from home summaries. The offline check verifies blocked requests and saved-room recovery before separately testing the connectivity banner, accommodating Chromium's service-worker reload emulation issue.
- Native browser QA uses a simulated Capacitor bridge, not a physical ARKit session. Evidence and scripts are under ignored `artifacts/v33/`.
- The Swift renderer changed. The updated installed iPhone app needs to be rebuilt; the existing macOS CI workflow checks unsigned iOS compilation after push. A physical-device check remains necessary for tracking quality. Apple's Quick Look still previews exported models/layouts and does not gain these native editing controls.
- Render automatic deployment remains disabled, so pushing source does not update the public site.

ARKit references: [raycast alignment](https://developer.apple.com/documentation/arkit/arraycastquery/targetalignment-swift.enum), [raycast results](https://developer.apple.com/documentation/arkit/arraycastresult). WebXR uses the [hit-test transform's Y axis](https://immersive-web.github.io/hit-test/#hit-test-result) as its surface normal.
