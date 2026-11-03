# AR interior studio

The interior studio opens at `#/ar` from the **AR studio** navigation tab, Home, or Room planner. It creates a separate design on the device; opening it from Room planner does not import that room's photo or furniture. The existing photo designer remains available through **Photo room planner**.

## Build and edit a design

The collection contains 26 editable concept models across seating, tables, storage, decor, and everyday objects. A design holds up to 24 independent objects, including multiple copies of a model. On narrow screens, **Add pieces** opens the searchable collection in a dialog. A blank design also offers living-room and workspace starters.

Select a piece to rename it, change its width, depth and height, choose a finish or custom color, rotate it in 90-degree steps, duplicate it, or remove it. Position fields and 10 cm controls are available alongside **Height off floor**, so a laptop or lamp can sit above the design floor. **Floor plan** supports pointer dragging and arrow-key movement. A complete drag is one undo step. **3D studio** uses the same dimensions, rotation and elevation as the plan and AR exports.

The initial 5 × 4 m plan is an example. Enter your dimensions under **Plan size & design files**. Models are generic representations with editable example sizes. The studio does not infer a measured room or verify collisions, physical clearances, or structural support.

## Place it in your space

| Mode | Available interaction |
| --- | --- |
| Native WebXR with immersive AR, hit testing, and DOM overlay | Aim at a tracked floor or tabletop, place an individual piece or the full design, then select, move, resize, rotate, recolor, remove, or add objects while AR remains open. |
| Safari exposing AR Quick Look | Export the whole design or the selected piece as a local USDZ, then open **View in my room**. The whole design moves as one group. Return to the studio to edit individual pieces. |
| Browser without either AR path | Use the 3D studio, editable floor plan, collection, and design files. |

WebXR placement uses native surface hits and a live reticle. It does not require the existing room scanner's measured rectangle. Placement pauses when tracking is missing or stale; a tracking-origin reset clears the live placements and asks you to place again. Leaving the studio, hiding the page, or exiting AR ends the session.

Moving one piece in WebXR updates its editable plan position. When necessary, the plan expands or its origin shifts so the requested position can be represented without moving other objects in physical space. Session coordinates and the tracking origin are never saved for reuse after a reload or new AR session. They are not persistent room anchors.

Quick Look receives configured dimensions, finishes, rotations, and elevation. A selected-piece preview is placed at floor level without changing that piece's saved elevation. Apple's viewer does not send placement changes, room dimensions, or tracking poses back to WorldOS. It cannot provide independent editing of several pieces inside one exported design.

## Saving and verification

The current design autosaves in browser storage. **Export design** creates a JSON backup; **Restore design** validates the file before applying it. Undo and redo remain available during the current visit. **New design** asks before replacing the current design. Clearing browser storage removes its local copy, so use an export to keep a separate backup.

Focused tests cover collection filtering, independent instances, dimensions and finishes, floor-plan dragging and keyboard moves, undo/redo, local restoration, session cleanup, tracking resets, and Quick Look preview selection. Placement tests check changes of origin, floor elevation, scene limits, and preservation of other objects' physical positions. Shared catalog, geometry and USDZ checks exercise all model types. Navigation tests verify direct links and inactive-screen lifecycle.

The production build and 571 frontend tests pass. Production Chromium checks at 320, 390, 768, and 1440 pixels cover collection selection, multi-object editing, floor-plan dragging and keyboard controls, export/restore, and reload. The real WebGL preview and USDZ exporter run in these checks; the AR-link capability is emulated to exercise whole-design and selected-piece exports.

A simulated WebXR browser check also runs the real placement engine and WebGL draw path at 320 and 390 pixels, exercising independent placement, object edits, undo/redo, tracking-loss gating, and session exit. The overlay remains transparent and its primary controls fit both viewports.

XR interaction tests use simulated sessions. They do not establish real camera tracking quality, physical placement accuracy, or iPhone Quick Look behavior. Physical-phone AR validation has not been performed. The studio's furniture models and room dimensions remain a design aid rather than evidence that the arrangement fits a real space.

Primary implementation: [`src/ar/`](../src/ar/), [`src/live/xr.ts`](../src/live/xr.ts), [`src/room/RoomPreview.tsx`](../src/room/RoomPreview.tsx), and [`src/room/quickLook.ts`](../src/room/quickLook.ts). The existing [photo room designer](V27_PHOTO_ROOM_DESIGNER.md) and [Quick Look background](V17_IPHONE_AR_PREVIEW.md) are documented separately.
