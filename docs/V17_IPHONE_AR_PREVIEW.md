# Camera-first room furnishing on iPhone Safari

Room Studio no longer starts with example room dimensions or requires a room-size form to prepare a layout. It immediately arranges the selected furniture in a suggested footprint. The footprint is explicitly not a measurement of the user's room. Unmeasured manual moves and rotations expand this footprint; no artificial room boundary is imposed. An empty or incomplete layout does not render a made-up room.

## iPhone Safari

Safari's `rel="ar"` capability enables **View in my room**. The app exports the complete furniture arrangement locally as a USDZ file and opens Apple's AR Quick Look viewer. The scene includes the configured furniture sizes, materials and placements, in metres, centered horizontally with its base at floor level. It contains no virtual walls or floor. Content scaling is disabled using Apple's URL fragment option.

The viewer handles surface placement. The website receives no room dimensions, tracking poses or collision results from Quick Look. Returning from the viewer does not mark the room measured or produce a positive fit verdict. Accurate automatic room reconstruction on supported iPhones requires native APIs such as RoomPlan; this change does not implement native RoomPlan or claim Safari LiDAR access.

The arrangement is a single AR object. Individual pieces can be edited in the website, then the updated arrangement reopened in AR. Furniture dimensions are editable presets, not dimensions automatically inferred from photographed furniture. In Apple's viewer the user may need to select the AR tab.

The USDZ package is built without a server request or a new runtime dependency. Exports wait 120 ms after edits settle to avoid rebuilding during every drag event. URLs remain alive during the viewer handoff and are released when replaced or the component unmounts. Export failures can be retried without changing furniture.

## Browsers with native WebXR

Room Studio uses automatic scan mode instead of requiring three corner taps. Stable labelled floor planes are preferred. Native hit-test samples can also accumulate a conservative rectangle of observed floor coverage. Samples are bounded and must be spatially diverse, horizontal, plausibly below the camera, and supported by tracking. Missing, stale, tilted, emulated or reset tracking invalidates the candidate. Known non-floor semantic surfaces are excluded.

Furniture appears automatically only when the stable candidate's exact dimensions can accommodate every selected piece. Smaller candidates keep scanning; users can also explicitly use a partial area. Surface dimensions remain estimates of observed coverage. This does not recover the entire room, ceiling, doors, hidden geometry, or obstacle-free walking space. Recognition of visible objects remains separate from metric room measurement.

## Validation

- Frontend tests cover package integrity, geometry, automatic packing, capability detection, URL lifecycle and retry, scan lifecycle and precision, no invented room dimensions, invalid inputs, collisions, and camera startup versus recognition retries.
- Independent OpenUSD validation opened three exported fixtures (12 mixed pieces, extreme aspect ratios/minimum dimensions, maximum dimensions). All 30 installed OpenUSD validators returned no findings, including root-package and USDZ-package checks. Python ZIP CRC checks also passed. OpenUSD 26.11 does not include the older ARKit-specific `ComplianceChecker` option.
- Isolated Chromium checks rendered the real WebGL preview and generated the real USDZ with Quick Look capability simulated. Widths 320, 390, 430, 768, 1024 and 1440 px had no overflow or page errors. The four-piece scene was approximately 271 KB. Dimension edits rebuilt the asset; optional room measurements enabled the measured fit check; reset cleared measurement state.
- Physical iPhone Quick Look rendering/tracking and real WebXR device accuracy remain unverified. Simulated capability checks and valid USDZ files are not physical-device verification.

## Primary references

- [WebKit: viewing AR assets in Safari](https://webkit.org/blog/8421/viewing-augmented-reality-assets-in-safari-for-ios/) — feature detection, `rel="ar"`, image-child requirement and MIME type.
- [Apple: advances in AR Quick Look](https://developer.apple.com/videos/play/wwdc2019/612/) — local blob URLs, content scale options and scene placement.
- [OpenUSD: USDZ specification](https://openusd.org/release/spec_usdz.html) — stored ZIP entries, first USD layer and 64-byte alignment.
- [Apple: creating USD files](https://developer.apple.com/documentation/usd/creating-usd-files-for-apple-devices) — USD geometry/material requirements and validation.
- [Apple: RoomPlan](https://developer.apple.com/augmented-reality/roomplan/) — native Swift room reconstruction using camera and LiDAR on supported devices.
