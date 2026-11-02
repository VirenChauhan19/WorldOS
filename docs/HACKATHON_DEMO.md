# WorldOS judge demo

**One sentence:** WorldOS turns the things in front of your camera into context you can ask about and act on.

**Submission description:** WorldOS brings AI into everyday spaces. Muse Spark interprets a captured scene and discovers visible object types; SAM 3.1 locates them. A user can select an object, ask a practical question about the image, and follow a suggested next step into dimension checking, room planning, or saving a reference setup. The interface keeps answers attached to their source photograph and separates image recognition from physical measurement.

## A 90-second presentation

| Time | Show | Say |
| --- | --- | --- |
| 0–12 s | Home: “Your world. Understood.” | “Our spaces are full of decisions: where something belongs, what could work better, and whether there is room for an idea. WorldOS starts with what is in front of you.” |
| 12–28 s | Select Phone or Laptop in the recorded scan. Toggle Understanding. | “This is recorded output from a real Muse Spark and SAM run. Muse describes the scene; SAM locates the objects. Every selection stays connected to the photograph.” |
| 28–55 s | Choose Check my space, open the camera, and hold a well-lit desk steady. | “Now this is the live camera. A steady view triggers recognition automatically. It keeps the completed photograph if I move, so old outlines do not float over a different scene.” |
| 55–75 s | Open Ask and select “How can I make room?” Tap an object referenced in the response. | “I can ask about my actual space. The answer refers back to detected objects I can select. It uses the captured image you see here.” |
| 75–90 s | Use the suggested next action, or open Fit and enter previously measured dimensions. | “Understanding becomes a next step. Fit uses measurements, Room Studio explores layouts, and a reference setup helps me return things to how they were.” |

Provider latency varies. Rehearse on the presentation network and allow extra time for live recognition. The final recorded chain took 20.3 seconds and one question took 6.1 seconds; these are observations, not guarantees. If a result takes longer, explain the Muse-to-SAM chain while it runs. Keep any edited waiting periods clear in a submitted recording.

## Prepare the actual demonstration

1. Run or deploy the current checkout. The public hosted version has not been updated by this implementation. Use the existing login and confirm the configured providers work.
2. On the actual presentation phone, use HTTPS, allow camera access, and scan a well-lit desk with a few distinct objects. Recognition runs on steady snapshots; keep the camera still while the first result returns.
3. Rehearse one question and object selection. Record provider errors as errors, and use the labelled recorded example if the connection fails.
4. Measure the clear area and an actual item before the Fit demonstration. The preset examples are not verified dimensions of the camera's detected objects. Supported AR is optional and requires its own device rehearsal.
5. End or navigate away from the camera and confirm the device's camera indicator turns off. Export saved work you need to keep before using the ephemeral free hosting option.

## Evidence to include with the submission

- [Current implementation, architecture, and validation](V19_PRODUCT_EXPERIENCE.md)
- [Real recognition record](v18-live-recognition.json): 17 detections, 12 displayed across types; one suggested type was not localized.
- [Real scene-question record](v19-scene-question.json): Muse Spark answer with detected-object references and a measurement handoff.
- [Camera reliability and device limitations](V18_CAMERA_RECOGNITION.md)

The software tests use controlled inputs. Recognition accuracy across real rooms, physical fit, and device AR accuracy have not been established. Present the working integration and its visible evidence; keep physical-measurement claims tied to the measurements actually demonstrated.
