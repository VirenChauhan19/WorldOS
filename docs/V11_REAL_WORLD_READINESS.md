# WorldOS V1.1 — real-world and demo readiness

V1.1 is a code release for review and deployment approval. Production was not
restarted or redeployed during this work; the audited deployment remains
`1d41e3b` (V1.0) at https://worldos-inspect.onrender.com/.

## Actual live result — October 27, 2026

The complete automatic physical workflow is **not verified**. A real public desk
photograph was uploaded successfully, but the deployed Meta SAM 3.1 analysis
returned HTTP 502 with the app's sanitized model-access error: the requested
model is unavailable to the configured credential. The analysis requested two
concepts, smartphone and mouse: two concurrent SAM requests, with no automatic
retry. Application wall time was 1,038 ms; provider token usage was unavailable.
No detection results were invented or substituted.

Baseten Muse Spark goal interpretation **did succeed** on that real photograph
with explicitly manual, agent-reviewed phone/mouse annotations. The selected
Baseten model itself answered; no fallback was used. Provider latency was
8,522 ms (8,749 ms including the application request); usage was 2,882 prompt +
666 completion = **3,548 tokens**. The deterministic planner produced one phone
movement while preserving the mouse. An independent geometry check validated
destination bounds, clearance, collisions, object protection, movement order,
and the unchanged-annotation negative control. This is not physical completion.

Total controlled provider requests: **three**. No further SAM requests were made
after the model-access failure. Current-image inspection, missing/misplaced/
unexpected accuracy, correction execution, and verification from a fresh
corrected photograph could not be validated. There was no physical sequence of
phone, mouse, notebook, and mug photographs. Physical trials performed: **zero**.

The [sanitized live evidence](v11-live-results.json) records the photo attribution,
hash, latency, usage, actual error, manual-input provenance, and geometric result.
Existing historical SAM successes in earlier documents do not override this
current production failure.

## Reliability fixes

- Ordinary Inspect and Spatial Studio verification reject the previous/reference
  photograph before inference. Guided trials also reject reuse across JPEG
  normalization. This catches exact reuse, not all possible edits: different
  bytes alone never certify a fresh capture or physical success.
- Expired sessions lock the existing in-memory draft behind sign-in. The hidden
  tree is inert and excluded from accessibility navigation; protected requests
  stop until login. No photo/token is added to browser storage. Same-role login
  resumes the draft without automatic retries. Explicit sign-out, changing
  backend, or discarding the draft before switching owner/judge access clears it.
  Reload still discards unsaved state; saved evidence can be reopened if the
  ephemeral backend still has it.
- Initial connection allows 75 seconds for a Free-service cold start, with
  truthful waiting text and an explicit retry on timeout.
- Supported browsers can decode HEIC/HEIF and convert to bounded JPEG before
  upload. Other browsers get an actionable JPEG/Safari fallback. Portrait
  dimensions are preserved, oversized photos are reduced to a maximum edge of
  1,800 pixels, preparation is bounded by a timeout, and canvas memory is released.
  RAW remains unsupported. Camera and library remain separate controls.
- Duplicate inspection camera controls were removed. The verification stage now
  asks for a verification photograph and explains the fresh-photo requirement.
- Normal provider HTTP failures now appear in readiness diagnostics with safe
  messages, HTTP status, time, and latency. Earlier success cannot hide a newer
  failure. Keys and upstream error bodies are not exposed.
- SAM responses carry explicit live/test provenance. Inspect, Demo Mode, and
  trial summaries distinguish live, test, cached/shared, and unknown-provenance
  records. Historical records lacking provenance are not called genuine/live.
- Deterministic restoration instructions state image-relative direction and
  point to the outlined reference position while preserving exact coordinates.
  Uncertain identities, missing objects, obstacles, and invalid geometry still
  withhold correction plans. Detection confidence is not identity certainty.
- The upload disclosure now correctly says images reach the WorldOS backend;
  only explicit AI actions contact model providers.

## First physical inspection

1. In Inspect, choose **Guide my first inspection**. Use a second camera to
   photograph the phone being tested. Fix the camera and lighting; arrange a
   phone, mouse, notebook, and mug with non-overlapping footprints. Mark the
   desired phone position on the surface.
2. Create a reference with concepts `smartphone, mouse, notebook, mug`. Request
   SAM detection explicitly. Review all identities/boxes and add missed objects
   manually. Save the reviewed template. If SAM access is still blocked, record
   that limitation; manual annotations are human assistance, not automatic vision.
3. Choose **Record this physical test**. The guide presets the phone-moved trial
   name and misplaced-object scenario. Enter the operator and reference capture
   time; explicitly confirm this is your real workspace.
4. Move only the phone, capture a separate inspection photo, and align stationary
   background features. Before viewing AI output, draw independent truth boxes,
   mark only the phone misplaced, record notes/capture time, and freeze evidence.
   Run Inspect. Record failures as failures; do not repeatedly spend credits.
5. Review uncertain identities and all obstacles. Request a correction plan only
   after review. Check the arrow and instruction against the marked reference
   position; physically move the phone back if appropriate.
6. Capture a fresh corrected photograph. Record whether the movement instruction
   was correct (Yes, No, or Not assessed), independently label actual positions,
   freeze this new photo, and verify. Do not reuse or digitally edit an earlier
   photo. An uncertain result is not success.
7. Export the trial with photographs before closing or redeploying. The on-screen
   and exported summary records automatic phone detection, automatic discrepancy
   identification, manual annotation/identity review, operator-assessed instruction
   correctness, fresh-photo verification, failed attempts, and measured reference
   plus scan processing time. Missing evidence stays **Not measured**. Capture,
   review, and advisory explanation time are outside that processing timer.

Manual annotation *used* is observable; whether it was strictly *required* is not
inferred counterfactually. Physical truth that contradicts a positive verification
prevents the summary from claiming physical success. This small trial is not a
benchmark of broad real-world accuracy.

## Browser and mobile checks

The live V1.0 Home, Inspect, History, Spatial Studio, and Settings were opened.
Reference creation controls, history navigation, and deterministic sample planning
were exercised without representing sample results as live vision. Public HTTPS
verification passed login, secure cookies, session restore, CSRF enforcement,
actual JPEG upload, invalid-upload recovery, private API denial, backup integrity,
and logout revocation. Its temporary test template was removed.

V1.1 was rendered from the production build against an isolated loopback QA
server with blank real provider keys and explicitly synthetic fixtures. The
browser extension's viewport override did not reliably resize the tab, so
`scripts/serve_interaction_qa.py` now offers `/qa/phone`: a real 390 × 844 CSS-pixel
iframe viewport. In desktop Chrome its scrollbar leaves 375 pixels of content.
All five pages had document width = scroll width = 375: no horizontal overflow.

Checked Back navigation/draft retention, reduced motion, modal Escape closure,
guided trial defaults and physical-confirmation guard, saved-history opening,
comparison slider endpoints, and zoom containment. At 125% zoom the photograph
and overlay were both 487.5 pixels wide; only the photo scroller expanded, with
the document still 375 pixels wide. Verification showed exactly one camera button
and one library control; camera input retained `capture="environment"`.
An isolated 20-second request followed by HTTP 504 displayed the failure,
restored the retry control, and preserved page navigation. No new success was
shown for that failed request. Browser error logs were empty in both QA tabs.

These are Chrome responsive checks, **not physical iPhone or Safari testing**.
Photo-picker automation remains unavailable in this browser extension. Actual
iPhone camera permissions, library/HEIC decoding, installed-PWA lifecycle,
touch momentum, and hardware memory behavior still require an iPhone pass.
Automated tests cover EXIF orientation, proportional phone-image reduction,
HEIC conversion/failure handling, auth expiry, and role isolation. No 60 FPS or
real-device performance claim is made. Screenshots are ignored local artifacts
under `artifacts/v11/`.

## Tests and deployment constraints

- Backend: **321 passed, 2 opt-in live tests skipped**. The controlled production
  calls above are separately recorded live evidence.
- Frontend: **148 passed** across 20 files.
- Production web build and native web-assets build: passed. No IPA/APK or native
  device installation was performed. The final dist is the same-origin web build.
- All four HTTP smoke scripts passed, including owner/judge separation,
  CSRF/cookies, upload recovery, inspection/review/planning, photo-reuse rejection,
  backup integrity, and simulated deployment restart behavior in local processes.
- Both Render Blueprints validate against the stored official schema. The default
  remains one Free Docker service, no disk/managed database, ephemeral `/tmp`, and
  runtime-only secrets. The separate paid option is unchanged and unused.
- Free-resource probe: **313.7 MiB peak RSS**, 66.3 MiB startup on Windows Python
  3.12.10 during sequential synthetic 6-MP upload/alignment/backup operations.
  This is below 512 MiB locally, not a Linux cgroup, concurrent load, or 0.1-CPU
  performance measurement. No local Docker engine was available.
- `pip check` passed; npm audit (production and all dependencies) reported zero
  advisories. Secret scanning covers tracked/new source and built assets against
  configured local secret values, private-key headers, and token-shaped literals.
  No credentials were found in that scope; this is not an absolute proof.

Render Free specifications and sleep behavior: [Render compute plans](https://render.com/docs/compute-plans)
and [Free hosting](https://render.com/docs/free). HEIC browser support rationale:
[WebKit Safari 17 release](https://webkit.org/blog/14445/webkit-features-in-safari-17-0/).

## Remaining release and demo gates

- Resolve Meta SAM 3.1 model access for the deployed `MODEL_API_KEY` in the provider
  account. No credential was changed or printed. A new controlled SAM request is
  needed after that external issue is resolved.
- Complete the actual four-object before/moved/corrected capture sequence. Until
  then, full automatic inspection/correction/verification is **not established**.
- Run physical iPhone Safari and installed-PWA acceptance checks.
- Judge isolation is implemented and tested, but production judge access remains
  disabled unless separately configured. Follow the [judge-access setup](V08_DEPLOYMENT.md#optional-controlled-judgedemo-access)
  with a separate passphrase and expiry; never give judges the owner password.
  Render environment changes can restart the service and require deployment
  approval and a data-preservation check. Judges share a separate demo workspace,
  not owner records; Free storage is ephemeral for both roles.
- Obtain explicit approval before restarting/redeploying production. Preserve
  or export any new owner data/photos immediately before deployment. The app's
  existing ephemeral-storage warning remains in place.
  The existing Render service was confirmed Free with Auto-Deploy Off before
  pushing this code; its live deployment remained `1d41e3b`.

The code is suitable for a reviewed deployment, while the complete live hackathon
demonstration remains blocked by SAM access and unperformed physical/device tests.
