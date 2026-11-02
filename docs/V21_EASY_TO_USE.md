# A simpler way to get started

The main flow is now **Photo → Steps → Check**. A new user can start with a photo and the default Focus goal, with no required typing. Create and Tidy up are alternatives on the photo screen. Home has one main starting action rather than repeating all three goal choices.

The interface shows one useful action at a time:

- After selecting a photo, **Use this photo** is the primary action. Retake and replacement controls sit under Change photo.
- Custom goals and written preferences are optional disclosures. Detected items remain easy to select when something should stay in place.
- The guide shows a compact captured photo, one instruction, a visible success check, and **Done, next step**. The explanation and full step list expand only when needed. Tap the photo to enlarge it without misaligning object outlines.
- Completing the last step opens the photo check. Returning to an already completed task also opens this stage. The app never starts comparison inference until the user supplies a new photo.
- **Save this setup** explicitly chooses the after photo as a preferred reference. It replaces a redundant checkbox; naming is optional and a useful default is supplied. It does not claim the AI has certified completion.
- My Spaces uses “saved setup” consistently, offers a direct start when empty, and keeps the older photo-comparison tools in their own expandable section.

Actions remain reversible: users can open the full list to undo a step, correct a plan, revisit the guide, or retake a result photo. New instructions receive keyboard focus, navigation cancels stale requests, and saved progress remains server-backed. Task protections, inference limits, account isolation, and backend validation are unchanged from [V20](V20_USEFUL_WORKSPACE.md).

## Verification

- 348 frontend tests pass across 34 files. Focused task tests cover starting without typing, changing the default goal, protection, next-step navigation/focus, undo, automatic check handoff, explicit saving, cancellation, and recovery.
- TypeScript and production Vite build pass.
- Headless Chromium checks use the actual task HTTP endpoints and isolated SQLite with clearly identified synthetic inference. Widths 320, 390, 768, and 1440 at a height of 844 pixels pass. The tests check that the camera action is visible on entry, optional text fields are closed, the next-step button is visible when the guide opens, and the full list stays collapsed.
- Browser coverage also includes enlarged photos, portrait overlay alignment, progress after reload, the automatic final-step handoff, setup reuse, and backup export/delete/restore. No horizontal overflow or page errors were observed.
- The backend is unchanged; its prior 370-pass suite and 2 skipped optional live tests remain the current backend validation. This interface change makes no new physical-camera or model-accuracy claim.

Screenshots and reports are in ignored `artifacts/v21/`. Run `scripts/mission_fixture_server.py` and `scripts/smoke_missions.mjs` as described in V20. These are software behavior checks; a usability session with new users and testing on the actual phone remain useful next checks. The public Render deployment remains separate from the local implementation.
