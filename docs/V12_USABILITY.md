# WorldOS V1.2 — photo-first usability

Code release prepared on October 27, 2026. **Not deployed.** Render's existing
service was inspected before pushing: Free, Auto-Deploy Off, last successful
deployment `1d41e3bcfa211fc048f30002e61612505b4bfa2d` (V1.0). No service restart,
environment change, key change, paid resource, or live AI request was initiated.

## What was confusing

The existing experience put five destinations, template terminology, annotation
editors, alignment values, provider configuration, and model diagnostics close to
the ordinary photo workflow. Users had to understand which workspace to choose,
what evidence was missing, and when to move from analysis to review to planning.
The live Settings view exposed troubleshooting information that a first-time
user should not need. In-memory work could be resumed after session expiration,
but closing the page discarded unfinished photos and reviews.

## The new experience

Home asks **“Is everything in the right place?”** and explains **“Take a photo of
your setup. WorldOS helps you spot anything that's moved or missing.”** Its main
action is **Check my space**; **See how it works** opens a short accessible dialog.
Recent spaces appear only when they exist. The three main destinations are Home,
My Spaces, and Settings. The wizard hides the bottom navigation while keeping
Back and Save and close available when an operation is not running.

1. **Save your setup.** Arrange your things, take a setup photo or choose from
   photos. Choose **Find my items** to explicitly request AI analysis. Check the
   detected items, name the space, and choose **Save this setup**. If automatic
   checking is unavailable, **Mark my items** offers simple two-corner marking.
2. **Check your space.** Take another photo from the same spot. A reference
   thumbnail reminds you of the angle. Line up the fixed background and confirm
   that the whole setup is visible, then choose **Check for changes**. Manual
   review is available if automatic checking fails or is unavailable.
3. **See what changed.** Read the plain-language result and inspect highlighted
   items. Review uncertain identities and account for the whole photo before
   continuing. Missing items, uncertainty, and extra items never silently pass.
4. **Put things back.** Follow the validated movement instruction. An arrow is
   drawn only for a ready correction plan. Blocked plans explain the next review
   or photo action without inventing a movement.
5. **Check again.** After physically moving the items, take a fresh photo. Reused
   reference/previous photos are rejected by the backend. A positive manual
   result says **“Your review says everything is in place”** and explicitly states
   that it is not an independent AI check. Saved results remain in My Spaces.

Uploads alone do not request AI. Errors preserve the photo and restore controls.
Pending operations have truthful waiting text, no invented progress percentage,
and a submission lock. Late responses cannot navigate the user back from Home or
overwrite a different draft. Correction directions come from the validated
planner coordinates, not invented relationships to nearby objects.

## Advanced tools and preservation

Settings → Advanced retains Spatial Studio, the detailed inspection workspace,
full history, annotation editing, technical alignment, physical trials, reports,
backups, connection configuration, and AI diagnostics. Existing routes and record
links remain resolvable. Advanced tools retain their established styling. Meta
SAM 3.1, Baseten Muse Spark, comparison/review rules, and the planner are retained.
Sample/provider-test responses are visibly labeled, separate from live evidence.

Private drafts use authenticated server-side SQLite with revision conflicts and
a 20-draft limit. Photos and session tokens are not put in browser local/session
storage. Draft lists extract metadata inside SQLite rather than loading every
photo into Python. Autosaves pause during active mutations and are flushed before
starting work, respecting Free's single-write guard. **Saved** appears only after
a successful response. A failed save offers Retry; keep the tab open until saved.

The UI uses large touch targets, safe-area padding, transform/opacity transitions,
lazy screens, visible focus, keyboard-compatible marking, focus-managed dialogs,
and system/in-app reduced motion. No animation dependency was added. The offline
page is plain and honest; the service worker caches only public offline assets
and icons, and activates without the old update/reload warning.

## First-time scenario checks

| Scenario | Actual check and outcome |
| --- | --- |
| A: save a desk setup | Phone-width browser: selected a labeled synthetic photo, marked phone/notebook/mug/mouse, named and saved the setup. Automated tests also cover explicit automatic detection and no inference on upload. |
| B: moved phone | Browser: marked the four observed positions in the synthetic moved image. Actual backend comparison identified only the phone as misplaced. This validates software behavior with manual inputs, not detector accuracy. |
| C: unavailable SAM | Browser: unavailable configuration gave one manual next action. An injected delayed HTTP 504 preserved the photo, disabled duplicate submission while pending, restored controls, and allowed manual marking. Automated tests cover a provider model-access failure. |
| D: fix and verify | Browser: existing planner produced one leftward phone correction. A separately marked corrected fixture produced a positive human-assisted result, explicitly not automatic verification. Backend tests reject reused images, incomplete inventory, uncertain identity, missing/extra objects, and unconfirmed alignment. |
| E: close and return | Saved an unfinished manual review, reloaded the containing page to discard React memory, reopened My Spaces, and continued directly with the marked phone preserved. HTTP smoke also verifies draft persistence across a local server restart. |

Browser checks used Chrome, a 390 × 844 CSS-pixel iframe (375 px usable content
with desktop scrollbars), and a desktop viewport. Tested primary screens,
Advanced access, previous-check dialogs, Escape/focus return, browser Back,
reduced-motion setting, keyboard marking, resized overlays, and no horizontal
overflow on the inspected phone layouts. Final desktop console had no errors.
Replacing local build files during testing temporarily invalidated a lazy chunk;
the existing error boundary offered reload, and a fresh load recovered. An open
tab can likewise need reload after a deployment; save work first.

The extension's native file-upload capability was unavailable without changing
its file-URL permission. No permission was changed. An explicitly labeled,
loopback-only QA helper supplied synthetic File objects through the normal upload
and preparation handlers. It is not included in production assets. **Actual
iPhone camera/library dialogs, Safari, HEIC hardware decoding, touch performance,
PWA installation, and physical before/after accuracy were not tested here.** No
human usability participants or 60 FPS measurements are claimed. Local evidence
is in the ignored `artifacts/v12/` directory.

## Validation

- Backend: **326 passed, 2 skipped**; skipped tests require explicit billable live
  AI opt-in. One pre-existing Starlette/httpx deprecation warning remains.
- Frontend: **156 passed / 21 files**, also passed on **Node 24.22.1**, matching
  the Docker major version. The system Node 25 produced a Vitest engine warning;
  the supported Node 24 run passed. Clean `npm ci` succeeded.
- Production web build and mobile asset build passed. No native IPA/APK compiled.
- All four HTTP scripts passed: `smoke_test.py`, `smoke_mobile.py`,
  `smoke_production.py`, `smoke_inspect.py`. Coverage includes auth, cookies, CSRF,
  owner/judge isolation, uploads, safe errors, private files, backups, manual scan
  provenance, revision conflict, and draft persistence across restart.
- `pip check`, npm audits (production and all dependencies), secret scan of source
  and built assets, and `git diff --check` passed. npm reported zero advisories.
- Both Render Blueprints validate against the downloaded official schema. The
  default remains one Free service, `/tmp/worldos`, no disk/database, one active
  write; the separate paid option is preserved without being deployed.
- Local sequential 6 MP upload, alignment, two-photo draft save/list/resume,
  SQLite backup/download test peaked at **321.1 MiB** (startup 66.7 MiB), below
  512 MiB. This is Windows process RSS, not a Render Linux/cgroup or CPU-load
  benchmark. Large histories, concurrent reads, and provider payloads can increase
  memory. No local model weights or animation dependencies were added.
- Docker was unavailable locally; a container build/runtime was not performed.

## Blockers and deployment

The previous live SAM model-access failure is unresolved. V1.2 makes the fallback
usable but does not repair provider entitlement. Prior Muse success and SAM
failure are recorded in [V1.1 live evidence](v11-live-results.json); they were not
retested for this release. Automatic reference detection, full live inspection,
and physical fresh-photo verification remain blocked/unverified. Manual workflow
software passed synthetic checks; complete automatic real-world success is not
established. Test real photographs and the installed iPhone app before presenting
the product as independently verified AI inspection.

**Ready for deployment review, with those limitations.** Before any explicitly
approved deployment, inspect and safely export existing production records and
photos. Stop if important data cannot be backed up. Free hosting loses local
SQLite, photos, drafts, and login/session state on restart, redeploy, or spin-down;
see [Render's official limitations](https://render.com/docs/free). No paid storage
replacement was introduced. Provider inference costs remain separate.

SQLite migration 3 → 4 is additive and tested to preserve templates and scans.
It adds `wizard_drafts`. Old V1.1 code rejects schema 4: retain a pre-upgrade
database backup if rollback is needed on a persistent/local installation. After
deployment approval, use the existing Render service's Manual Deploy menu to
deploy the reviewed commit, retaining all environment values and Free compute.
Verify login, the wizard, private owner/judge data, and a controlled real photo
workflow after deployment. Production has deliberately not been redeployed here.
