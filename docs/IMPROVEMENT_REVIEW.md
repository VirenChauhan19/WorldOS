# WorldOS improvement review — November 2, 2026

**Resolution:** the four reproduced defects below have been fixed locally. Accepted job identities survive authentication and polling limits; stale-tab writes preserve a separate recovered room; reset drafts reopen with their current photo and notes; and design priority is persisted. Recovery identities are saved before inference starts.

The follow-up also adds server-side queued design, archive/restore for rooms, alternative removal with undo, explicit save failures with export/retry, verified offline readiness, a shorter guided handoff, and repository release checks. Application tests and the production build are passing. Deployment, physical-device/user research, and the remaining performance/visual-quality proposals still require separate work. Docker image validation is configured in CI; Docker is not installed in the local environment.

**Fix validation:** 471 frontend tests and 403 backend tests pass, with two optional live tests skipped. The production build, normal browser flows at 320/390/1440 pixels, and all eight recovery scenarios pass. The recovery checks cover accepted-job authentication and rate limits, queued priority, two-tab conflicts, reset drafts, photo backup/restore, saved-work controls, and storage-full export/retry. Browser results use synthetic fixtures, not live AI or physical phones.

The findings and reproduction descriptions below document the version that was audited, before those fixes.

The next pass should protect saved work and make the main task flow easier to finish. The new features pass their normal-path checks, but adversarial review reproduced four issues that those checks do not cover.

This review inspected the current source, deployment configuration, previous validation evidence, and mobile screenshots. Additional browser checks used a fresh isolated Chromium profile, the local production build, synthetic photos, and a loopback fixture server. No personal browser profile, live AI provider, deployment, or physical phone was used. Application behavior was not changed during this review.

## Fix first

### 1. P1 — Accepted AI requests lose their recovery ID after temporary access errors

**Reproduced:** seed a saved, accepted design job, then make its status request return HTTP 401 or 429. The backend fixture still holds the job, but the saved project loses `roomJob`. The next retry can submit another design instead of reconnecting to the original result.

**Cause:** [`RoomStudio.tsx:210`](../src/room/RoomStudio.tsx#L210) treats authentication and rate-limit errors as terminal job failures, regardless of whether the error came from submission or polling. [`jobs.ts`](../src/room/jobs.ts) has no status-polling backoff using `Retry-After`.

**Improve:** distinguish a rejected submission from a temporary inability to read an accepted job. Preserve accepted job IDs through reauthentication and rate limits, reconnect within the same workspace, and back off polling. Persist the request identity before dispatching inference instead of relying on the room's 400 ms autosave.

**Acceptance:** expire authentication and inject a rate limit during each stage; sign in or wait, recover the result, and verify exactly one inference submission.

### 2. P1 — Two tabs can silently overwrite each other's saved work

**Reproduced:** open the same room in two tabs. Save a new wish list in tab A, then rename the room in tab B. The stored wish list reverts to tab B's older copy. Both tabs can report that their changes are saved.

**Cause:** [`roomProjects.ts:14`](../src/device/roomProjects.ts#L14) serializes writes only inside one JavaScript instance. Each write replaces the complete project. [`RoomWorkspace.tsx`](../src/room/RoomWorkspace.tsx) has no stored revision check or cross-tab conflict handling.

**Improve:** check a revision inside the IndexedDB write transaction; retain a conflict copy or ask which change to keep when the stored revision differs. Notify other tabs of committed updates. A notification alone is insufficient to prevent a racing overwrite.

**Acceptance:** conflicting wish-list edits, layout edits, renames, and restores must either merge safely or expose a recoverable conflict without discarding either version.

### 3. P2 — Reset drafts do not reopen where the user left off

**Reproduced:** start Reset this space, choose today's photo, edit the notes, confirm that the capture is stored, and reload. The reset screen removes today's photo and restores the setup's original notes. The stored capture still exists, but this route does not load it.

**Cause:** [`PrepareSpace.tsx:21`](../src/device/PrepareSpace.tsx#L21) always creates a new capture when the URL contains `reset`. [`taskCapture.ts`](../src/device/taskCapture.ts) has no source-setup identity to match an unfinished reset.

**Improve:** associate an unfinished reset with its source setup and resume it after navigation/reload. Provide an explicit new-reset action that deliberately requests a fresh photo.

**Acceptance:** reload and leave/return preserve the current photo, notes, and reference; starting a new reset clears only the new attempt.

### 4. P2 — Queued designs forget the selected priority

**Reproduced:** select More open space while the room survey runs, queue the design, and reload. The eventual design request sends `style: balanced` instead of `style: open`.

**Cause:** [`RoomStudio.tsx:81`](../src/room/RoomStudio.tsx#L81) initializes the style to Balanced. The persisted draft includes the queued flag and goal, but not the style.

**Improve:** persist the style and the queued request settings together; include them in duplication, alternatives, and backups where relevant.

**Acceptance:** all three priorities survive reload and produce the intended request, including when the survey finishes while the tab is closed.

## Next product and reliability work

| Priority | Improvement | Why it matters / completion check |
|---|---|---|
| P2 | Shorten the guided start flow | After choosing a goal and photo, the private flow presents another “Show your space” form and “Use this photo” button. Make this a concise review/consent step or continue directly after the already-explicit confirmation. Keep the selected goal and photo visible through sign-in. |
| P2 | Manage rooms and alternatives | Setups have remove controls, but room projects and saved alternatives do not. Add archive/delete, recovery or undo, and a clear way to discard a pending capture. Reaching twelve alternatives should not require creating extra rooms just to manage history. |
| P2 | Make storage failures unmistakable | My Spaces suppresses project-list failures in `DeviceSpaces.tsx:27`. Report failure with retry instead of suggesting that work is missing. Give failed autosaves a distinct unsaved state, with export available. |
| P2 | Reduce photo storage and loading costs | Alternatives embed their reference photo, full projects are cloned on every save, and room listing reads every complete record. Store immutable photos once, use thumbnail/metadata lists, and test many rooms with twelve alternatives and constrained storage. This is a code-based performance risk, not a measured phone benchmark. |
| P2 | Finish queued work while the app is closed | The survey can run on the server, but the queued design starts from a React effect after the client receives the survey. Move the explicitly requested survey-to-design chain server-side so returning later can reveal the finished design. |
| P2 | Prepare server persistence for real use | `render.yaml` still selects ephemeral `/tmp/worldos` storage. Server restarts can lose private tasks, results, and sessions. Use persistent storage and tested backup/restore before promising durable private saves; add durable job execution if restart recovery is required. |
| P2 | Improve mobile save/offline readiness | Flush dirty state when the page becomes hidden, preserve pending jobs before sending, and show whether offline preparation actually completed. `beforeunload` is unreliable on mobile; it should not be the principal protection against losing the last edit. [MDN lifecycle guidance](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event). |
| P2 | Validate usefulness and physical fit | Existing real-provider observations cover two photographs without ground-truth room measurements. Test measured rooms, clutter, awkward angles, different lighting, and real task completion. Use those results to prioritize optional scale calibration, better furniture assets, and correct occlusion. Current concepts remain approximate. |
| P2 | Add repeatable release checks | Add repository CI for frontend/backend tests, production build, and browser regressions. Cover expired authentication, polling limits, multi-tab conflicts, storage failures, queued settings, mobile backgrounding, and offline upgrades. Normal-path test counts alone did not detect this review's findings. |
| P3 | Improve comparisons and research tools | Highlight what changed between alternatives and use consistent viewpoints. Usability sessions need an explicit new-session action and persisted observational notes; the current recording spans one continuing log, while notes are component state. |

Physical-phone checks should include iPhone Safari and installed mode, Android Chrome, an older device, camera denial, rotation, app backgrounding, HEIC input, screen-reader navigation, and enlarged text. Use the existing [study guide](PHONE_USABILITY_STUDY.md). This review does not claim those checks have passed.

## Evidence and checks that held up

- The earlier release build passed 460 frontend tests, 400 backend tests with two optional live tests skipped, and normal-path browser checks at 320, 390, and 1440 pixels. Those suites were not rerun during this review because application code was unchanged.
- This review reproduced the four issues above through five adversarial scenarios: authentication loss and rate limiting were separate cases.
- A suspected large-photo backup problem did **not** reproduce. A 2400 × 2000 image was normalized to 1800 × 1500 before saving, exported, and restored under a new room ID.
- The review harness, JSON observations, and screenshots are in ignored `artifacts/workspace-audit/`; `review.py` runs only against a fresh local fixture server. Findings are software behavior evidence, not model-quality or physical-device results.

Recommended order: fix the four reproduced issues, add their regressions to the release checks, then improve the guided handoff and saved-work management before the physical-device study.
