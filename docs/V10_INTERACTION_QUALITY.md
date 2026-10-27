# WorldOS V1.0 — Phase 10 interaction work

This increment adds interaction polish to the existing authenticated Inspect and
Spatial Studio workflows. It does not claim completion of unspecified V1.0 phases
or physical validation of model accuracy.

## Behavior

- Home, Inspect, History, Spatial Studio, and Settings have shareable hash routes,
  browser Back/Forward support, active navigation, a skip link, and focus transfer.
  Visited screens stay mounted so navigating away does not discard a draft or
  interrupt an in-flight request. Heavy screens load on first use.
- Brief opacity/transform entrances and consistent press/focus feedback never
  gate navigation. Device reduced-motion preferences always win; Settings can
  additionally reduce motion for WorldOS alone.
- Native modal dialogs contain keyboard focus, support Escape, prevent background
  scrolling, and return focus to their trigger.
- Photo dimensions reserve canvas space, decoding is asynchronous, and previews
  fade in. Reference/inspection blending uses the actual saved/aligned photos.
  Alignment opacity is adjustable independently of the alignment geometry.
- Annotation dragging previews within the canvas and commits on release. Pointer
  cancellation discards the preview. First-touch selection, pan/zoom controls,
  keyboard object selection, and numeric coordinates remain available.
- Detection boxes fade in at their reported positions. Correction arrows use the
  validated plan coordinates; the old endlessly moving dot has been removed.
- Request feedback shows actual waiting time, with no invented percentage or
  premature success. The timer is isolated from photo/overlay rendering. Inspect
  progress and errors stay visible while scrolling. Mutating actions and photo
  controls reject duplicate submissions; failures restore the controls.
- Mobile navigation accounts for bottom safe areas. Touch targets, input sizes,
  contained photo scrolling, and the two-row phone zoom toolbar support small
  screens. No animation dependency was added.

Authentication, CSRF, provider selection, SAM 3.1, Baseten Muse Spark, evaluation,
inspection review, and Spatial Studio's planning/verification remain intact. The
earlier PWA update-banner fix is retained. `render.yaml` still selects one Free
service without a disk or database. `deploy/render.paid.yaml` remains separate.
SQLite, photos, and login/session state can disappear on Free instance restarts,
redeploys, or sleep. Saving a template no longer promises restart durability.

## Validation — October 27, 2026

- `npm test`: **141 passed**, 18 test files. Includes navigation/draft retention,
  Back/Forward, deep links, reduced-motion preference, dialog focus, pointer
  cancellation, honest progress announcements, duplicate photo submission, auth
  expiration, and the existing inference/review/verification regressions.
- `python -m pytest backend/tests -q`: **315 passed, 2 opt-in live tests skipped**.
- Production web build and native web-assets build: passed. Native assets were
  built with the public HTTPS backend origin; the final build is same-origin web.
- `smoke_test.py`, `smoke_inspect.py`, `smoke_mobile.py`, `smoke_production.py`:
  passed, including real local HTTP uploads, auth/cookie/CSRF, owner/judge
  separation, mock-provider inference, correction/verification, and restart tests.
- Both Render Blueprints passed the stored official schema and free-resource
  assertions. `pip check` and `git diff --check` passed.
- Free-resource smoke: **314.4 MiB peak RSS**, 66.6 MiB startup, on Windows Python
  3.12.10, below the configured 512 MiB budget. This is a sequential synthetic
  workload, not a Linux cgroup or Render CPU benchmark. No additional server
  processes, hosted storage, or paid services were introduced.
- Docker is unavailable in this workstation; a local container build was not
  performed. Render's own build is the deployment check.

## Rendered browser checks

Used the actual production build in desktop Chrome at **1440 × 900** and an
iPhone-sized **390 × 844** viewport, with an isolated backend and synthetic photos.
Checked all five destinations, draft retention with browser Back/Forward, history
opening a saved inspection, comparison slider endpoints, zoom containment,
keyboard dialog closure/focus restoration, app reduced-motion mode, deterministic
Studio planning, a 20-second mock explanation, navigation during that request,
successful completion, and a recoverable injected HTTP 504 error. Browser console
had no application errors. The mobile document had no horizontal overflow;
zoom expanded only the photo scroller. Screenshots are local ignored artifacts in
`artifacts/phase10/`.

Browser upload automation was blocked by the Chrome extension's file-URL access
setting. The picker action opened, but automated file selection could not finish.
Upload and cancellation/error paths were covered by component/HTTP tests; actual
iPhone camera capture, Safari, installed iOS PWA, touch momentum, and VoiceOver
still require a device acceptance pass. The app preference was tested in the
browser; the OS reduced-motion CSS branch was inspected, not toggled on a device.

Five-second requestAnimationFrame/PerformanceObserver samples were collected from
the local-only QA profiler during navigation:

| Viewport | Frame intervals | p95 / maximum | Long tasks | Recorded layout shift |
| --- | ---: | ---: | ---: | ---: |
| 1440 × 900 | 220 | 15.9 / 1008.4 ms | 0 | 0.1862 |
| 390 × 844 | 13 | 1017.1 / 1017.1 ms | 0 | 0 |

These samples contain major scheduling gaps and span intentional route/content
changes and lazy loading. They are not a controlled foreground device benchmark
or an isolated measurement of unexpected layout movement. Foreground native
browser access could not be completed. **60 FPS is not established.** Do not turn
these measurements into an iPhone performance claim.

## Reproduce safely

Build first, then run `python scripts/serve_interaction_qa.py` and open
`http://127.0.0.1:8765`. The standalone harness binds loopback, overrides provider
credentials to empty, uses mocked provider transport, and stores synthetic data
under ignored `artifacts/interaction-qa/`. It is not included in the Docker image
or production bundle. Its expandable profiler measures the next five seconds.
For slow/error QA, create `artifacts/interaction-qa/mode.json` with
`{"delay_seconds":20}` or `{"delay_seconds":2,"error":true}`; reset to `{}` when done.
This harness must never be used as a production server or model-accuracy evidence.
