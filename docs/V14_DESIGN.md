# V1.4 spatial interface design

The design brings WorldOS's photo-based spatial guidance back to the foreground. Its visual centerpiece is a real desk photograph with anchored outlines and movement cues. Navigation and task controls remain quiet so the scene and next action are easy to understand.

## Research and decisions

- **Give the scene room.** Apple's augmented reality guidance recommends devoting most of the display to the physical environment, limiting text within it, and keeping persistent controls readable. WorldOS applies this to its photographed scene: outlines communicate locations, and instructions stay in stable screen space. [Apple Human Interface Guidelines: Augmented reality](https://developer.apple.com/design/human-interface-guidelines/augmented-reality)
- **Establish one visual priority.** Scale, contrast, and proximity should make the current task apparent. A restrained palette and clearer typography keep the photograph, current instruction, and primary action prominent without making every surface compete. [Nielsen Norman Group: Visual hierarchy](https://www.nngroup.com/articles/visual-hierarchy-ux-definition/)
- **Reveal complexity when needed.** The guided capture, review, correction, and verification sequence stays intact. Manual corrections, detailed evidence, and alignment controls remain available through labeled secondary controls. [Nielsen Norman Group: Progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/)
- **Use consistent components and states.** Meta's guidance favors consistent buttons, selectors, and panels across an experience. The app retains its React implementation and Lucide icon library; Meta's Unity and Spatial SDK component runtime is not a web dependency. [Meta Horizon OS: Components](https://developers.meta.com/vr/design/components/), [Meta Horizon OS: Panel implementation](https://developers.meta.com/vr/design/panels_implementation/)

## What the spatial view means

The overlays are **photo guidance**, not live camera tracking, depth sensing, or a claim of calibrated AR. Object outlines reflect the available analysis or reviewed annotations. Movement arrows identify suggested destinations; they do not establish a safe physical travel path. The original photograph is retained rather than synthesized into an after-image. Sample previews are labeled as examples and are not evidence of a live model request.

## Image attribution

The desk photograph is by **Jakub Żerdzicki**, originally published on **Unsplash**, photo ID **ElFBCgOfoIM**. [Original photograph](https://unsplash.com/photos/ElFBCgOfoIM), [Unsplash license](https://unsplash.com/license). The existing repository photograph was converted to a local 110 KB WebP asset; no remote image request is needed. Preview annotations are illustrative. User-uploaded photos and their analysis remain separate from this preview.

## Validation

Validation completed on 2026-10-29:

- Production TypeScript/Vite build passed.
- All 165 frontend tests across 22 files passed. The added PhotoStage checks cover preserving the original photo when hiding overlays, keyboard marking, stale partial-mark reset, accessible review/protection descriptions, and movement focus.
- Headless Chromium checked 1440, 1024, 768, 390, and 320 CSS pixel widths; no horizontal overflow occurred.
- Browser interaction checks exercised Objects/Guidance switching, hide/show outlines, help-dialog dismissal, setup capture, automatic recognition fixtures, saved setup creation, changed-photo review, correction guidance, and a fresh-photo verification. The final reviewed result retained its human-review attribution. No browser JavaScript errors were recorded.
- Desktop and phone screenshots were inspected. This caught and corrected crowded movement labels, inherited low-contrast heading/step styles, and excessive preview chrome. Screenshots and local QA output are in `artifacts/v14/`.
- The Browser plugin could not establish an operational session, so visual testing used an isolated headless Chromium instance with the existing synthetic QA backend on port 8765. No live model requests were made.

Synthetic browser fixtures exercise software behavior only; they do not measure model accuracy, physical movement safety, live AR tracking, or a real iPhone camera experience. These changes are local and have not been deployed.
