# Camera understanding, saved-space deletion, and AR surfaces

## Camera

- Local labels require two consistent observations before appearing and three before changing class. Spatial matching keeps IDs stable, with small box movements smoothed.
- A missed detection can retain a label for up to 700 ms only while image tracking survives. Lost tracking, camera movement, and stale semantic evidence remove it.
- Remembered background objects do not repopulate live labels. Explicit Find results remain marked as remembered spots; a similar live object is not proof of identity.
- Select a label to hold the photo, inspect its image location, correct/remove the label, or choose **Explain this object**. Corrections apply to this capture and its saved notes; they do not retrain the detector.
- **Ask AI** holds a photo. **Explain this view**, **Check this label**, or a typed question explicitly sends that photo and suggested labels to the configured AI service. No recognized labels are required. Entering the panel does not send a request.
- Answers include observations, uncertainty, and relevant next actions. New photos, corrected label context, cancellation, and navigation invalidate obsolete answers.
- The connected authentication flow carries the chosen photo through the remount in memory, once, for up to ten minutes. It does not persist the photo or credentials in handoff storage.
- Selecting an older captured result retains that original photo instead of relabeling the current camera view.

## My Spaces

Active rooms, archived rooms, legacy room plans, AR designs, and saved setups have visible Delete controls with named confirmation and retry feedback.

Room/setup tombstones prevent stale autosaves from recreating deleted records. A cached room editor is invalidated on deletion, and conflict recovery checks its source in the same IndexedDB transaction as the recovered copy. AR deletion clears the cached editor and pending saves; confirmation refuses to delete a different design saved while the dialog was open.

## AR design

**Edit this layout in AR** transfers the current Room Studio arrangement, dimensions, finishes, and rotations. Replacing an existing AR design requires confirmation and supports undo.

Select a piece, choose a **Supporting surface**, and use **Place on top** to center it on a modeled table, desk, shelf, or custom surface. Footprint, ceiling, self-support, and support-cycle checks apply. **Move to floor** and undo work in the plan, WebXR, and native editor. Each piece moves independently; this is not a physics or structural-load simulation.

Clean cached AR editors reload newer saved designs when reopened. Unsaved edits are preserved when saving fails.

## Verification

- 692 frontend tests across 64 files, 12 backend scene-question tests, and the production TypeScript/Vite build passed.
- Browser flows at 320, 390, and 1440 px: correction, explicit questions with mocked guest authentication, saved setup deletion/cancel, surface/floor placement, undo, and deletion without cached-editor resurrection. No page exceptions or horizontal overflow.
- Simulated Capacitor bridge checks passed at 320, 390, and 844 px for multiple objects, selection, editing, tracking gates, and exit cleanup. These exercise the real JavaScript bridge and controls, not a physical ARKit session.
- One real request to the existing public demo used only the app's public desk example image. Meta `muse-spark-1.3` returned a captured-view description, observations, and uncertainty with `live_request: true` in about 10.3 seconds. No credentials or private photos were recorded in the evidence.
- Evidence is under ignored `artifacts/v32/`. Browser response fixtures are labeled separately from the real provider result.

Recognition remains probabilistic and limited by lighting, viewpoint, model classes, and visible evidence. No new physical iPhone tracking validation or signed-app build was performed in this change; Swift code is unchanged. A successful push does not deploy the public Render site, whose automatic deployment is disabled.
