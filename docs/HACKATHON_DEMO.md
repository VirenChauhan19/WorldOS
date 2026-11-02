# WorldOS judge demo

**One sentence:** WorldOS helps you get your real workspace ready for what you want to do, then remembers the setup you want to return to.

**Submission description:** A camera can identify a desk without helping someone start their work. WorldOS connects that understanding to a complete task. Choose a goal, show the workspace, and protect the items that should stay. Muse Spark and SAM 3.1 turn the captured view into a short plan with object-linked steps, explanations, and visible checks. After making changes, compare actual before/after photos, review what the model can and cannot tell, and explicitly save a preferred setup. Next time, a fresh photo and that reference guide the reset. Progress, revisions, corrections, and routine backups make the workflow usable beyond a one-off camera answer.

## A two-to-three-minute presentation

| Moment | Show | Explain |
| --- | --- | --- |
| The purpose | Home: “Make room. Get going.” Choose Get ready to focus. | “I want to start studying. Help me prepare the desk I already have.” |
| The actual space | Take a well-lit desk photo. Let recognition finish. | “Muse interprets the visible scene; SAM locates items. This photograph stays attached to the instructions.” |
| Personal constraints | Select the monitor as something that stays. Add a practical note. Request the plan. | “The plan works around what matters to me. I can correct a mistaken identity before starting.” |
| A useful action | Show the first instruction and highlighted item. Open Why this helps. Physically perform one appropriate step, then mark it done. | “One action and a reason. This completion mark is my report; the app does not call it visual proof.” |
| Evidence | Take a genuine after photograph from the same angle. Read the review. | “The model compares actual photos. It separates visible changes from things it cannot tell, such as comfort or measured clearance.” |
| A reason to return | Confirm and name the preferred setup. Open Use this routine again. | “Tomorrow starts with today's preferred setup. I can reset toward it, keep my preferences, or adapt the plan.” |

Provider latency varies; allow extra time. One final task plan took 23.3 seconds and a separate recognition took 20.3 seconds. Do not promise instant results or disguise prerecorded responses as live. If editing a submission video, make skipped waiting periods clear.

## Prepare the demonstration

1. Deploy the current checkout or use the local preview. The public Render service has automatic deployment off and has not been updated by this implementation. Use its existing login and provider configuration.
2. Rehearse on the actual phone over HTTPS. The task flow supports a native camera photo or library upload. The separate live-camera view recognizes steady captures automatically.
3. Use a manageable desk with a genuine reason to prepare it. Test one goal, a protected item, a correction, and a useful physical change. Check each suggestion yourself before following it.
4. Capture the after photograph from the same angle. If the review is uncertain or wrong, show that honestly and use a clearer view or human judgment. Do not invent a result for the presentation.
5. Save a routine, reload, and reuse it. Export it from My Spaces; restore the exported routine if free hosting resets its storage. A routine export restores the preferred reference; a task export is an archival record.
6. Keep the explicitly labelled recorded recognition example as a fallback for explaining Muse/SAM integration. It demonstrates recorded object recognition, not a completed physical task.

The existing Fit and Room Studio tools are optional deeper demonstrations. Enter actual measurements for fit decisions; test supported native AR separately on the intended device.

## Submission evidence

- [Current implementation and verification](V20_USEFUL_WORKSPACE.md)
- [Real task-plan record](v20-mission-plan.json): three Muse steps with validated object references and a protected monitor.
- [Real recognition record](v18-live-recognition.json): 17 detections, 12 displayed; one suggested type was not localized.
- [Real scene-question record](v19-scene-question.json): captured-image reasoning with object references.
- [Camera reliability and device limitations](V18_CAMERA_RECOGNITION.md)

Application tests use controlled inputs. Physical task success, real-room recognition accuracy, before/after assessment accuracy, repeat-use demand, and AR accuracy have not been established. Demonstrate what works and what the evidence supports.
