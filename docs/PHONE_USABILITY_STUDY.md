# Real-phone usability study

Status: ready to run; no participant or physical-device results have been collected by the implementation agent.

Recruit five to eight people who study, work, or create in small spaces. Include actual iPhones and Android phones, including an older device. Obtain their agreement before observing or recording. Use their own task and space; do not request identifying information in the notes.

## First visit

1. Ask: “Get this space ready for something you want to do.” Let the participant choose their activity. Do not explain the interface.
2. Observe whether they find Get my space ready, take a usable photo, understand the goal, and continue through any connection step.
3. Time the first useful instruction. Record corrections, wrong object identities, impractical instructions, and any help you provide.
4. Have them follow the steps, capture an after photo, and save a setup they would actually reuse. Ask whether the result was useful and what they would normally have done instead.
5. Open the room planner with a real photo, enter a wish list during analysis, leave the screen, and return. Save an alternative, change the plan, and restore the alternative. Note whether they understand the photo estimate versus a measured fit.

## Return visit

1. Ask the participant to find their saved setup and use Reset this space with a fresh photo. Do not coach navigation.
2. Record whether the suggestions focus on visible changes, preserve stated constraints, and help the participant finish.
3. With a successfully installed app, disconnect the phone from the network and reopen it. Confirm saved photos, checklists and room projects are accessible. Reconnect to resume AI work.

## Reliability checks

Exercise denied camera access and choosing a photo instead, portrait/landscape rotation, leaving and returning to the app, a large/HEIC photo, a slow connection, and a backend timeout. Verify no duplicate inference is submitted when reconnecting. On a measured real room, compare entered tape measurements with AI estimates and record error without treating model ranges as calibrated confidence intervals. Check native AR separately on supported hardware.

## Recording and reporting

Settings → Try a usability session enables optional local milestone recording. It records event names and timestamps only, without photos, prompts or network telemetry. Pause recording after the attempt. Export the local event log with the assistance category and observational notes. The export labels its scope and contains no invented success score. A browser profile holds one continuing observation log; use a fresh test profile for a separate participant, or keep the timestamp boundaries explicit in analysis.

Report the denominator and unassisted completions, assisted completions, incomplete attempts, time to first useful step, corrections, and return-visit reuse. Keep failed attempts in the report. Small-study results are descriptive, not accuracy or market benchmarks. Fix repeated obstacles and retest those paths before broadening the feature set.
