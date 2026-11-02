# Device app visual design

The device workspace uses a shared paper, charcoal, and rust palette. `src/design-system.css` supplies its navigation, typography, controls, forms, camera inspector, and room-planning treatments. Rules are scoped to `.device-app`; optional private workspace tools retain their existing shell.

`src/ui/DeviceChrome.tsx` renders the wordmark and navigation. Desktop navigation sits in the masthead; phone navigation stays at the bottom. Active states use a rust rule, and Lucide icons share a 1.65 stroke weight. The favicon and installed app icons use a simple W monogram with the same charcoal and rust palette; `public/icons/icon.svg` is their vector source. Focus outlines and reduced-motion support remain available.

Home uses two columns on desktop and a single column on phones: main actions, recent work, and an interactive recorded example. Ruled rows replace decorative feature cards. Labels describe tasks directly. Camera and room tools use the same text hierarchy and small control radii; the 3D room shell and selection colors match the interface.

Saved work remains in browser storage. My Spaces waits for its initial storage reads before showing an empty state, while retaining existing rows during refreshes.

Validation uses the production build, 421 passing frontend tests, and isolated Chromium checks at 320, 390, and 1440 pixels. Browser checks exercise the recorded camera, room examples, measured furniture suggestions, persistent navigation, and saving across navigation and reload. Physical phone cameras and native AR are outside this visual review. The public deployment has not been updated.
