# Remembering a live space

The subsequent [local detector](V24_LOCAL_RECOGNITION.md) also contributes captured observations to this memory, at most once per second, while displaying fresh common-object labels more frequently.

Open **Open live camera**, choose **Live**, then **Open camera & recognize**. Look around slowly. **Memory** collects recognized views and item observations. Give an area a name, search for an item, and point the camera back toward its last-seen photo. Matching a known view restores dashed **Remembered spot** outlines locally, without waiting for another AI response.

An item can have moved. A remembered outline shows a last-known spot, not a new detection. If a newer scan omits an item, its earlier photo and coordinates remain searchable. Its remembered spot can appear beside fresh detections when its original photo matches the camera. Same-named items in different areas remain separate.

**Help me with this area** starts the existing guided-task workflow using the selected captured photo. Choose **Tidy up**, **Get ready to work**, or write a goal. The camera stops when the task opens. The task can receive updated photos as the user works.

## Local memory and limits

- The local view matcher runs every 400 ms on the camera's 128 x 96 grayscale thumbnail. It extracts up to 100 corner descriptors, requires mutual descriptor matches and geometrically consistent matches spread across the image, and rejects ambiguous matches between saved views. A bounded similarity transform supports moderate translation, scale and rotation changes.
- The existing local image tracker advances recovered boxes between matching passes. Unreliable boxes disappear. Only the selected item's older reference needs additional matching when it differs from the latest view.
- AI observations retain their exact captured image, even when the response arrives after the camera has moved. The memory stores at most 12 views and 72 item observations. Known views continue to update when capacity is reached. Clear memory to scan another space.
- Names, photos and descriptors stay in page memory. Stopping or backgrounding the camera retains this memory; clearing it, reloading, unmounting the camera workspace, or session expiry discards it. An outstanding request cannot repopulate explicitly cleared memory with its old response. Nothing is added to browser storage by this feature.
- Cloud requests and API keys use the existing [continuous camera path](V22_CONTINUOUS_CAMERA.md). This change adds no extra model calls for remembering or finding an item. Creating a guided task is an explicit separate action.

This is visual recall of captured views, not a persistent 3D map. The implementation has no object depth, room coordinates, inter-area navigation directions, or native ARKit/ARCore world anchors. It can fail on featureless or repetitive surfaces, blur, major viewpoint changes and changing lighting. Memory does not establish that an item remains present. Physical phone testing and native world tracking remain outstanding.

## Verification

The frontend suite passes 368 tests; the production build passes. Memory coverage includes A → B → A recovery beyond the short image-tracking expiry, translated views, unrelated-view rejection, stable item IDs, same-name separation, finding an omitted item using its older photo, bounded storage, stop/session-expiry behavior, cancellation during clear, mixed fresh/remembered overlays and the guided-task handoff. The final targeted checks also pass after the last state-handling adjustment.

The [browser results](v23-memory-browser.json) use a synthetic camera and mocked AI at 390 and 1440 pixel viewport sizes. They verify local recovery after looking away for more than eight seconds with new AI results blocked, search, area naming, recovery of an item omitted by a newer scan, retention after stopping, explicit clearing and absence of horizontal overflow. Recall took 391 ms and 392 ms respectively in the recorded run. These are controlled desktop-browser observations, not a physical-phone or recognition benchmark.

```powershell
npm test
npm run build
node scripts/smoke_scene_memory.mjs --playwright-dir <installed-playwright-directory>
```

The backend is unchanged by the memory feature. The prior continuous-camera validation remains 376 backend tests passing, with two optional live-provider tests skipped.
