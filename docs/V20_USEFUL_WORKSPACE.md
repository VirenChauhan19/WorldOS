# WorldOS: get your space ready

Implemented November 2, 2026. The product now starts with a practical goal: prepare a workspace for study, work, making something, or the next session. Local implementation and verification are complete. A public Render deployment is still required; pushing a commit does not deploy the service while automatic deployment is off.

## The complete workflow

1. **Choose a goal.** Home leads with “Make room. Get going.” Choose focus, create, reset, or write a goal and constraints.
2. **Show your space.** Take a photograph or choose one. The app saves the starting capture before recognition. Existing Muse discovery and SAM segmentation find visible items.
3. **Choose what stays.** Select protected items, correct mistaken labels in a note, and request a short plan. If segmentation is unavailable, planning can use the photo and written constraints without fabricated object IDs.
4. **Take the steps.** Each step has a clear instruction, highlighted items in the captured photograph, an explanation, and a visible success check. Progress is explicitly marked by the user and survives reloads. Adapting after starting requires a fresh photograph and retains earlier reported actions.
5. **Check the result.** Capture an after photograph. Muse compares the actual before/after images against the current steps, returning visible evidence, needs-attention items, or uncertainty. User completion checks do not influence this assessment.
6. **Remember your setup.** Explicitly confirm and name a preferred photograph. Reusing that routine compares today's capture with the saved reference to plan a reset. Protected-item preferences carry over by label and are shown for review against the new detections.

Home and My Spaces list resumable tasks and reusable routines. Tasks and routines can be exported with their photographs and removed individually. A routine export can be restored in My Spaces after a hosting reset. Task exports preserve the record but are not currently importable as active tasks.

Live camera recognition, scene questions, measured fit, Room Studio, and advanced geometry tools remain accessible. The new task flow offers an understandable first job instead of making someone choose a technical tool first.

## State and evidence

- SQLite migration 5 adds task and routine tables without removing previous templates, inspections, or drafts. Tasks use optimistic revisions; conflicting or stale inference responses cannot overwrite newer progress.
- Capture and after images are persisted before the corresponding inference. Provider failure leaves the current photograph recoverable. New captures and revised plans invalidate stale reviews.
- Owner and judge data use the existing separate stores. Routes inherit authentication, CSRF, image validation, request/concurrency limits, and the AI quota. The list endpoint reads metadata without returning or loading every photograph.
- Each plan has 1–6 typed steps. Unknown or duplicate object IDs, movements of selected protected IDs, incomplete review coverage, and malformed provider output are rejected. Natural-language correctness remains model-dependent; structural checks do not prove that every suggestion is appropriate.
- Reviews use a labelled contact sheet of both actual images. Noncomparable images force every step to uncertain. Identical photos are rejected before starting a review request. This gate does not prove a genuine physical change.
- Routine saving requires an explicit user confirmation of the preferred setup. It does not require or imply an AI completion certificate. Imported references are decoded and validated, assigned fresh IDs, and scoped to the authenticated workspace.
- Photos do not establish metric dimensions, clearance, ergonomics, cable state, or physical safety. Human checks and the existing measurement tools remain necessary where those facts matter.

## Validation

- **345 frontend tests pass** across 34 files. The 10 task/home tests also passed after the final input-state changes.
- **370 backend tests pass; 2 optional live tests skipped.** Task coverage includes create retry, persistence, revisions, protection, invalid object/review IDs, photo-only fallback, failed-inference recovery, routine reuse and backup restore, strict confirmation, owner/judge isolation, CSRF, and inference limits.
- TypeScript and production Vite build pass. Secret scan covers source and built assets.
- Headless Chromium exercises the real task HTTP endpoints and isolated SQLite at **320, 390, 768, and 1440 pixels**, with synthetic model output explicitly identified. Capture → protect → plan → progress → reload → review → routine → reuse passes with no overflow or page errors. Additional checks cover portrait overlay alignment, keyboard skip navigation, and exporting/deleting/restoring a routine.
- The existing camera → question → referenced-object selection → dimensions flow passes at all four widths, including releasing camera tracks when leaving. It uses a synthetic camera and controlled AI responses.
- A separate **real Meta Muse Spark 1.3 plan** from the public desk photo and recorded SAM detections returned three steps in **23.275 seconds**, preserving the selected monitor. The first exploratory result prompted tighter instructions against unnecessary rearrangements and surface-edge placements. [Final integration record](v20-mission-plan.json). These are individual integration observations, not an accuracy benchmark or latency guarantee.

Real physical task execution, before/after assessment accuracy, and the actual presentation phone still require rehearsal. The browser fixtures establish application behavior, not those physical claims.

## Reproduce

Start the regular frontend (`npm run dev`). In a separate terminal, start the local-only fixture server, which uses isolated data and synthetic inference:

```powershell
.\.venv\Scripts\python.exe scripts/mission_fixture_server.py
node scripts/smoke_missions.mjs --playwright-dir PATH/TO/node_modules/playwright
```

The browser script sets its backend address only inside its isolated contexts. It does not change the user's connection settings. Screenshots, the backup fixture, and results are written to ignored `artifacts/v20/`; successful runs remove their own test tasks and routines.

To run one potentially billed plan using the existing configured provider:

```powershell
.\.venv\Scripts\python.exe scripts/verify_mission.py --run-live
```

The fixture server must never be used for production. The normal app uses the real configured providers and existing login. The free Render configuration has ephemeral storage; export routines to retain a restorable copy. No paid infrastructure was introduced.
