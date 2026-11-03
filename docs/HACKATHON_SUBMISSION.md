# WorldOS submission pack

Prepared November 3, 2026 from feature/test commit `6b021e0`. These are reusable draft answers, not a verified copy of the private submission form. Adapt to its actual fields and limits. No hackathon submission has been sent.

**Event and timing**

Meta's public event page lists the submission deadline as **November 4, 2026, 9:00 PM Eastern Time**. Suggested theme: **Build for Your World**. Use the participant track under which you were accepted; Indie is described for individual builders and students. The public page does not establish the private submission form's word limits or required video duration. Check the participant portal for those details. [Official event page](https://dev.meta.ai/events/global-hackathon), [organizer page](https://cerebralvalley.ai/e/meta-ai-developer-hackathon).

**Project name**

WorldOS

**Tagline**

See your space. Design what comes next.

**One-sentence pitch**

WorldOS is a phone-first AI interior design assistant that turns a room photo and your goals into an editable concept you can explore in 3D and supported AR.

**Short description**

Photograph your room, describe what you want, and explore an editable design. WorldOS combines Meta-powered scene understanding with room planning, a 36-piece furniture and decor catalog, and supported AR placement. Refine dimensions, colors, wall decor, and lighting appearance, then save your design for later.

**Full project description**

Designing a room involves decisions that are difficult to make from inspiration pictures alone: what belongs in the space, where it should go, what should stay, and how the pieces work together. WorldOS brings that process onto your phone.

Start with a photograph of your room and describe your goal, such as adding a reading corner or making space for a desk. Meta Muse Spark interprets the visible room and proposes a design with placement explanations. Explore the concept over the original photograph, in a floor plan, or in a 3D studio, then adjust it yourself. Photo-derived dimensions remain clearly labeled as estimates.

The AR interior studio includes 36 editable concept pieces covering furniture, lamps, ceiling fixtures, wall art, mirrors, shelves, curtains, and TVs. On supported interactive AR devices, place pieces independently against floors, tabletops, walls, or ceilings. Edit their size, finish, and height, and use undo or duplication as you explore. Saved designs can be reopened, exported, restored, or deleted.

WorldOS also helps people understand the space they are looking at. Capture a view, correct a mistaken label, and ask questions grounded in that photograph. Meta SAM 3.1 supports detailed object localization, while Muse Spark provides scene explanations and design reasoning.

The result is a connected workflow from understanding a real space to exploring and keeping an editable design. Geometric checks operate on the modeled room, AR tracking depends on device support, and users retain control over the final choices.

**Problem and intended users**

People furnishing or reorganizing a room often have to translate inspiration images into their own dimensions, existing furniture, and everyday needs. WorldOS is designed for people planning bedrooms, living rooms, workspaces, and small shared spaces who want to experiment before physically rearranging furniture or making purchases.

**Inspiration**

The idea behind WorldOS is to connect understanding a real space with making a useful change to it. A photograph should become the starting point for an editable plan, clear explanations, and a design the person can revisit. The current prototype focuses on room design while retaining guided workspace setup and camera questions.

**How Meta technology is used**

- **Muse Spark:** interprets room photographs, proposes layouts and placement explanations, answers captured-scene questions, and supports goal interpretation and guided tasks. The integration supports Meta Muse Spark 1.3 and Muse Spark Open through Baseten, depending on configuration. Recorded real-provider evidence exists for both paths; name the provider actually used in the demo.
- **SAM 3.1:** localizes prompted object concepts in detailed cloud recognition and inspection. WorldOS uses the returned object boxes to connect visible items to review and planning workflows. It does not use those masks as reconstructed 3D collision geometry.
- **Local camera labels:** the fast camera overlay uses EfficientDet-Lite0 through MediaPipe with temporal stabilization. Attribute that component separately from Meta.
- **Geometry and AR:** application code validates modeled boundaries, overlaps, gaps, and reserved areas in Room Studio. ARKit/RealityKit or WebXR supplies tracking and rendering. These checks are distinct from model reasoning and do not certify physical fit.

**What makes it useful**

WorldOS connects the user's original photograph, design intent, editable layout, and supported AR exploration. A user can inspect why a piece was proposed, change the concept, and retain the result. The same project can be understood through a photo, a floor plan, and a 3D view, making the design easier to evaluate and revise.

**How it was built / technologies**

React, TypeScript, Vite, Python, FastAPI, Meta Model API, Muse Spark, SAM 3.1, Baseten Muse Spark Open integration, MediaPipe, IndexedDB, SQLite, Capacitor, Swift, ARKit, RealityKit, WebXR, and USDZ export. API credentials remain on the backend. Structured AI responses are validated before application, and queued room jobs can reconnect after reload without resubmitting inference.

**Challenges**

The difficult parts were connecting probabilistic visual understanding to an editable design, keeping camera labels stable as observations changed, preserving room projects through interrupted requests, and supporting different AR platforms. The implementation combines structured-output validation, user corrections, temporal label stabilization, persisted job identities, and explicit platform capabilities. Native wall and ceiling placement also required keeping model orientation and mounting offsets consistent while pieces are resized.

**Accomplishments and evidence**

- A connected photo-to-room-concept workflow with explained proposals, photo/floor-plan/3D views, and saved projects.
- A 36-piece editable catalog and interactive AR targets for horizontal surfaces, walls, and ceilings on supported devices.
- 756 frontend tests passed for the feature build; production browser checks cover 320, 390, and 1440 px, editing, persistence, export/restore, recovery, and offline reopening.
- Both [release checks](https://github.com/VirenChauhan19/WorldOS/actions/runs/41705254447) and [unsigned iPhone/iPad compilation](https://github.com/VirenChauhan19/WorldOS/actions/runs/41705254418) passed for `6b021e0`.
- Real Muse/SAM integration observations are documented in [the live release check](LIVE_RELEASE_CHECK.md), [camera update](V32_CAMERA_AND_DESIGN.md), and the existing [judge-demo evidence](HACKATHON_DEMO.md). Software tests and isolated provider observations do not establish broad recognition accuracy or physical AR quality.

**What was learned**

Useful spatial AI needs a clear connection between what the model observed, what it inferred, and what the user can edit. Reliability also depends on the surrounding product: recovering interrupted work, correcting labels, saving designs, and explaining which measurements are estimated. Separating model suggestions, geometric checks, and device tracking makes these boundaries easier to inspect and improve.

**Next steps — roadmap, not current features**

Conversational editing of the active AR scene; bringing Room Studio's access constraints into interactive AR; richer material and lighting rendering; budgets and sourced product links; guided room capture; and restoration of physical AR alignment across sessions. Physical-phone testing and deployment of the demonstrated build are immediate release tasks.

**Links to supply**

- Repository: https://github.com/VirenChauhan19/WorldOS
- Candidate public demo: https://worldos-inspect.onrender.com/ — confirm the deployed build and complete the judge journey before using this as the final demo link. Render automatic deployment is disabled in the repository configuration.
- Demo video: add the URL after recording and checking playback in a signed-out browser.
- Native app access: add only if a signed, installed, tested build is actually available to judges. A successful unsigned CI build is not a downloadable iPhone release.
- Team/contributor names and contact fields: enter the actual participants; no identities or contribution claims are supplied by this draft.

**Recommended demo outline — 2 minutes 30 seconds**

This duration is a production suggestion, not a confirmed event requirement. Adapt it to the submission form. Use a genuine room photo and footage of the build being submitted. Label edited waiting periods and recorded inference.

| Time | Show | Suggested narration |
| --- | --- | --- |
| 0:00–0:15 | Your room and WorldOS on the phone | "I want to improve this room, but choosing pieces and imagining where they belong is difficult. WorldOS helps me turn the room I have into a design I can explore." |
| 0:15–0:45 | Upload the photo, enter a goal, show the returned design | "I photograph the room and describe what I want. Meta Muse Spark proposes a layout and explains the placement choices. The photo-based dimensions are estimates that I can replace with measurements." |
| 0:45–1:10 | Select a piece; switch between photo, floor plan, and 3D | "The concept is editable. I can inspect a piece, change its dimensions and finish, and compare the arrangement from different views." |
| 1:10–1:45 | Add a wall sconce, artwork, and pendant; demonstrate mounting and undo | "The studio includes 36 furniture and decor pieces, including wall and ceiling items. I can adjust mounting height, try fixture warmth, and undo changes." Use real interactive AR footage here only after testing the device; otherwise show and identify the 3D studio. |
| 1:45–2:05 | A captured-scene question or detailed recognition result | "Muse Spark also answers questions about a captured view. SAM 3.1 supports detailed object localization, and I can correct the system when a label is wrong." Only name SAM over an actual SAM-backed result; fast local labels are a separate component. |
| 2:05–2:20 | Save, leave, and reopen the design | "The design stays available in My Spaces. I can revisit it, export a backup, or remove it when I no longer need it." |
| 2:20–2:30 | Finished concept beside original room, plus project name | "WorldOS connects understanding your space with designing what comes next, using Meta models and an editable room-and-AR workflow." |

**Screenshots to capture**

1. A room photograph and its editable concept, labeled as a concept preview.
2. The 3D studio containing furniture, wall decor, and ceiling fixtures.
3. A selected wall piece with mounting/height controls visible.
4. A captured-view AI answer with observations and uncertainty.
5. My Spaces with the saved design.
6. Optional: actual interactive AR on the tested phone. Do not substitute simulated-camera QA imagery for real-device evidence.

**Final preparation**

- Confirm the portal's required fields, limits, track, attachments, and accepted-participant details.
- Deploy the intended web build and test the full judge journey through a fresh visitor session. Check provider availability and demo quota; repository CI success alone does not establish live availability.
- Rehearse camera and AR on the actual presentation device. Quick Look previews exported models and does not provide the app's interactive editing controls. Physical AR poses currently last only for the active session.
- Keep the current lighting claim precise: controls preview fixture appearance. Photo room sizes are estimates. Room Studio's modeled clearance checks do not currently accompany every edit in the separate AR studio.
- Include the tested demo URL, repository link, video, screenshots, and draft answers wherever the actual form requests them. Use only publishable room photos and remove credentials or personal details from footage.
- Open submitted links while signed out, submit through the official participant portal, and retain its confirmation receipt.
