# Historical implementation notes

These entries preserve earlier development snapshots. Dates, counts, deployment claims, and provider observations apply to each snapshot. See [the current product implementation](V19_PRODUCT_EXPERIENCE.md) for the latest local status.

**Latest local update: camera and automatic recognition reliability.** Camera lifecycle recovery, bounded automatic retries, whole-scene recognition, selectable object outlines, captured-photo results after movement, and portrait framing are fixed. The final real Muse Spark → SAM check returned 17 detections in 20.3 seconds, displaying 12 across object types. See [changes, validation, and the demo runbook](V18_CAMERA_RECOGNITION.md). **This checkout has not been deployed; the actual demo phone still needs testing.**

**Current local implementation: Room Studio (V1.6).** Furnish a whole room with a queen bed, desk, table and wardrobe together. Edit a scaled 3D layout, check the combined fit, and place the same furniture in native AR. Compatible runtimes can automatically estimate detected surfaces and labelled object geometry; other browsers retain manual measurement and 3D planning. See [Room Studio, automatic measurements, validation and limits](V16_ROOM_STUDIO.md). **272 frontend tests and the production build pass. Physical-device accuracy is not yet validated; changes are local, not deployed.**

**Live Space (V1.5).** “Check my space” opens a live camera with automatic item recognition, native WebXR measurement on compatible devices, and a measured “what fits here?” comparison. Saved-photo inspection remains available. See [the architecture, device support, evidence, and limits](V15_LIVE_AR.md).

Validation: **211 frontend tests, 36 backend security/production tests, and the production build passed.** Fake-camera browser checks covered five screen sizes; simulated XR covered rendering and tracking-loss behavior. Separately, one real automatic recognition chain on a public photograph returned **12 detections in 12.6 seconds** through Meta Muse Spark 1.3 and SAM 3.1. Physical AR accuracy and parking suitability remain unverified. These changes are local and have not been deployed.

## Historical release notes: V1.3 and earlier

The provider-access and deployment reports below describe their respective earlier checks. The V1.5 evidence above is the current implementation record; its single successful live request does not establish sustained provider reliability.

**Choose a photo. Find your items. Check what changed.** The guided wizard automatically requests recognition after a new photo is chosen, saves the photo before inference, and keeps manual correction optional. See [V1.3 recognition findings and deployment blockers](V13_AUTOMATIC_RECOGNITION.md).

**V1.3 is not deployed. SAM access remains unreliable.** One real-photo SAM request succeeded, but production and the subsequent automatic discovery/localization test returned model-access errors. Baseten discovery succeeded. No new paid provider, model substitution, or credential change was made.


**V1.1 reliability work is ready for deployment review; production was not redeployed.** See [real-world readiness, fixes, live AI evidence, and the guided phone test](V11_REAL_WORLD_READINESS.md). Current live verification: Baseten Muse goal interpretation passed; Meta SAM 3.1 returned a model-access error. The complete physical workflow and real iPhone experience remain unverified. Historical results below do not supersede that current limitation.

**V0.8 defaults to Render Free: one $0-compute web service, no disk or paid database.** Follow the [Free Blueprint retry and iPhone installation guide](V08_DEPLOYMENT.md). **SQLite data, uploaded photos, inspections, backups, and login/session state may be lost on restarts, redeployments, or idle spin-down.** Export important work to your device. Authentication, CSRF, Meta SAM 3.1, Baseten Muse Spark, Inspect, and Spatial Studio remain available. External AI calls retain their provider costs. The original Standard + disk option is separate in [deploy/render.paid.yaml](../deploy/render.paid.yaml) for future paid use. No paid service was authorized by this change.

V0.8 validation: **310 backend tests passed (2 optional live tests skipped), 124 frontend tests passed, production build and four HTTP smoke scripts passed.** Separate real provider connectivity checks passed for Meta SAM 3.1 and Baseten Muse Spark through local production-mode authentication; this does not verify a hosted URL or physical accuracy. See [the sanitized live connectivity record](v08-provider-connectivity.json).

**Owner and judge access:** optional, expiring judge logins use a separate demo workspace (ephemeral on Free), with no access to owner data, backups, or connection probes. Judges can complete the existing scan, review, correction, and verification workflow. See the [judge setup and revocation instructions](V08_DEPLOYMENT.md#optional-controlled-judgedemo-access). Judge access is disabled by default.

**Mobile app infrastructure is implemented:** responsive Inspect and Spatial Studio, camera/library controls, touch selection and zoom, an installable PWA with an honest offline screen, generated Capacitor Android/iOS projects, and authenticated HTTPS backend deployment configuration. API credentials remain backend-only. Start with the [V0.7 installation, deployment, native builds, test results, and device checklist](V07_MOBILE.md).

V0.7 validation: **283 backend tests passed (2 optional live tests skipped), 117 frontend tests passed, production build and three HTTP smoke scripts passed.** Native projects were generated and synchronized; **no APK/AAB/IPA was compiled**, and physical-device camera/install validation remains required. Docker deployment was configured but not run. The earlier release notes below retain their historical results.

**Baseten Muse Spark is integrated and live-tested for connection, goal interpretation, and Inspect explanations.** Meta SAM 3.1 remains the detector; the geometric planner and existing workflows are preserved. See the [V0.6 integration, actual request results, configuration, and remaining blockers](V06_BASETEN.md). Baseten credentials stay in the ignored backend `.env`. Physical inspection accuracy is still unmeasured.


**WorldOS Inspect adds persistent visual workspace standards, camera alignment, conservative inspection, and geometric restoration.** Open the app to create a reference template, inspect a new photo, review uncertainty, generate correction arrows, and verify another photo. Templates and inspection history persist in local SQLite. The existing desk workflow remains available under **Spatial Studio**.

Start with the [V0.5 startup, first-template, inspection, demo, and evaluation guide](V05_INSPECT.md). [Current Inspect physical evaluation report](inspect-evaluation/results.json): **0 captured photo pairs / 10 defined scenarios; real-world inspection performance is unmeasured.** No V0.5 live provider inspection has been performed in this checkout.

**Demo preparation:** the in-app **Evaluate real photographs** workflow now freezes independent labels before inference, saves inspection/corrected captures and failed attempts, retains original and human-assisted decisions, and exports trial evidence and metrics. Follow the [guided physical trials, demo readiness checklist, backup procedure, and final submission steps](DEMO_READINESS.md). Software validation: **243 backend tests passed (2 optional live tests skipped), 76 frontend tests passed, production build and both HTTP smoke tests passed**. These are not physical accuracy measurements.

Earlier desk releases and their historical observations are documented below.

**V0.4 adds Demo Mode, stronger conservative identity matching, blocker-first movement ordering, fixed-space conflict explanations, bounded inference caching/request sharing, and a ten-scenario physical evaluation workflow.** Start with the [V0.4 demo recording runbook and evaluation protocol](V04_DEMO_AND_EVALUATION.md). [Current physical evaluation report](evaluation-v04/results.json): **0 captured / 10 specified scenarios; real-world movement accuracy remains unmeasured.** Existing single-photo V0.3 observations below are historical evidence, not physical movement trials.

For the first real provider request, follow [First AI connection inference](FIRST_INFERENCE.md): exact credential locations, backend environment setup, the **AI Connection Status** panel, and **Test AI Connection**.

A working spatial planning MVP for the Meta Global AI Developer Hackathon 2026, Indie Developer Track. Upload a photo of a flat surface, annotate objects, specify the area to clear, and receive collision-aware movement instructions. Photograph the result, verify detected or manually reviewed placements, and adapt the plan to the current scene.

**V0.2 adds opt-in, reviewed AI assistance.** Muse Spark reasoning and the selected Meta Model API SAM 3.1 path are implemented against official contracts and validated with real provider requests on synthetic fixtures. V0.3 has now exercised real desk photos; detection gaps and an unchanged-photo verification control are documented in the V0.3 guide. Reliable physical before/after accuracy remains unmeasured. The requested Baseten SAM path is explicitly blocked pending your deployment-specific request/response contract. Manual mode works without keys. See [AI integration setup, exact environment variables, verified sources, test instructions and limitations](AI_INTEGRATION.md).

**V0.3 adds automatic after-photo verification, conservative identity review, protected-object checks, and adaptive replanning.** Follow [V0.3 workflow, reproducible photo benchmark, actual results, and limitations](V03_VERIFICATION.md). The deterministic planner remains unchanged.

The included desk is an original illustration with manual annotations; it uses the same real planner as uploads. Upload alone never sends a photo to a model provider.
