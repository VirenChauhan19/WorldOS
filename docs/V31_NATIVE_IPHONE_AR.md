# Native iPhone and iPad AR studio

The installed iOS app includes a native ARKit and RealityKit path for the interior studio at `#/ar`. The camera and 3D objects render in a native view underneath the studio's transparent web interface. The same collection, selection, dimension, finish, rotation, undo, and design controls remain available over the camera.

This path requires an ARKit world-tracking device and camera access. Capability detection does not request camera permission; the explicit **Start interactive AR** action does. If access has been denied, enable Camera for WorldOS in iOS Settings before trying again. The iOS Simulator can compile the app but cannot validate this camera and tracking workflow.

## Use the native studio

1. Install the signed app on a compatible iPhone or iPad and open **AR studio**.
2. Add pieces from the collection or start with an example design. Dimensions and plan size are editable examples.
3. Choose **Start interactive AR**, allow camera access, and move the phone slowly to find a horizontal surface.
4. Aim at the placement indicator and place the selected piece or whole design. Add and edit independent pieces with the controls over the camera.
5. Leave AR to return to the plan. The editable design saves locally; export its JSON to keep a separate backup.

ARKit supplies camera tracking and surface hits. RealityKit draws the same concept-model geometry used by the studio. World positions belong to the active AR session. They are not saved room anchors, and starting a later session requires placement again. Closing AR, leaving the studio, changing the web page, or backgrounding the native app tears down the camera session and restores the ordinary web view.

The Safari version continues to use Apple's Quick Look for USDZ previews. Quick Look moves an exported design as a group and does not return edits to WorldOS. Browsers with the required WebXR features continue to use the WebXR path. See [the interior studio guide](V30_AR_INTERIOR_STUDIO.md) for the shared editor and browser modes.

## Build and install

Use a Mac with Node.js 24, Xcode 26 or newer, and the Xcode command-line tools selected. Capacitor 8 requires Xcode 26+, and this app's deployment target is iOS 15. [Capacitor environment requirements](https://capacitorjs.com/docs/getting-started/environment-setup)

From the repository root, replace the placeholder below with the actual deployed HTTPS backend origin before building:

```sh
npm ci
export VITE_API_BASE_URL='<your deployed HTTPS backend origin>'
npm run build:mobile
npx cap sync ios
npm run cap:ios
```

In Xcode, select the **App** target, choose your signing team, connect the device, and build/run **App** on that device. The repository contains the app target and the native plugin sources. Capacitor manages the local `CapApp-SPM` package and its Swift package dependencies during `cap sync ios`; do not replace that generated package manually.

The public backend origin is build configuration. Provider keys stay on the backend. Local camera tracking, placement, and scene rendering do not require a backend request.

## Native compile check

[`native-ios.yml`](../.github/workflows/native-ios.yml) runs on pushes and pull requests to `main`, and supports manual dispatch. It uses GitHub's `macos-26` runner, checks for Xcode 26+, installs the locked npm dependencies, builds the native web assets, syncs Capacitor, and compiles the actual **App** target in Release for a generic iOS device with signing disabled. GitHub documents the installed Apple toolchains in its [macOS 26 runner image](https://github.com/actions/runner-images/blob/main/images/macos/macos-26-Readme.md).

The workflow verifies that the resulting bundle contains a native executable, the bundled web entry point, camera permission text, and support for both iPhone and iPad. It uploads the Xcode build log, result bundle, and built app metadata for seven days. Compiler errors are also published as check annotations. The workflow uses `https://example.invalid` only as a compile-check backend origin; its unsigned build is not a distributable release.

The existing Linux release-check workflow remains separate. A passing web build alone does not establish that Swift and RealityKit compile. A passing native compile establishes compilation and linking; device camera behavior, tracking quality, alignment, thermal performance, and touch interactions require an installed physical-device test.

## Physical-device verification

Physical-device AR validation has not been performed in this Windows development environment. Before distributing a build, record the commit, iPhone/iPad model, iOS version, and result of each of these checks:

- Allow and deny the first camera prompt; retry after changing Camera access in Settings.
- Find a floor and tabletop, place several independent objects, then walk around them.
- Add another piece while AR is active; select, move, resize, rotate, recolor, duplicate, and delete pieces.
- Confirm the catalog, selection controls, and exit action remain reachable in portrait and landscape, including safe-area insets.
- Undo and redo edits, exit AR, reopen the studio, and confirm the editable design persists without reusing an old tracking origin.
- Cover the camera or move into poor lighting; confirm placement is unavailable while tracking or a surface hit is unavailable.
- Background the app, lock/unlock the phone, navigate away, and start a fresh session. Confirm the camera stops when leaving and the ordinary interface is restored.
- Open a second AR session after cancelling the permission prompt or exiting immediately; confirm stale callbacks cannot reopen the previous session.

These models and room dimensions are design aids. Native tracking does not establish measured fit, collision-free arrangements, structural support, or physical clearance.
