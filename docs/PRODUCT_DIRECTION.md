# Product direction: help someone finish a real-world task

Status: the core goal ? observe ? guide ? check ? remember workflow is now implemented. See [implementation and verification](V20_USEFUL_WORKSPACE.md). Audience, repeated-use value, and market differentiation remain hypotheses to validate with real users. The camera, scene questions, room planner, and saved-setup tools remain available.

## The problem with the current experience

WorldOS demonstrates capabilities before establishing a reason to use them. Recognizing a keyboard, describing a desk, and opening a furniture editor each work as individual features. The user still has to decide what problem to solve, select tools, interpret the answer, and determine whether the task is finished.

The next experience should begin with a desired outcome. The first meaningful result should be an understandable action involving the user's actual environment. Advanced controls should appear when they help complete that action.

## Recommended first audience and job

Start with students and people who work or create in small, shared spaces.

Job: “Help me get this space ready for what I am about to do, using what I already have.”

Examples include getting a desk ready to study, clearing a surface for drawing, or returning a shared workstation to its saved setup. These are hypotheses to validate with real users. They are more focused than promising to understand or fix every situation a camera can see.

## The experience and its intent

1. **Choose the outcome.** Offer a few recognizable tasks and a plain-language goal. Ask only for constraints that materially change the plan, such as what must stay in place.
2. **Show the space.** Use the camera or a photo. Explain what a useful capture looks like. Keep a stable reference image for the task while the camera moves.
3. **Review the plan.** Present a short sequence with the reason for each step, linked to visible objects. Let the user correct mistaken identities and reject impractical suggestions before starting. Geometry-based placement needs a reviewed surface, target area, and complete obstacle inventory.
4. **Guide one action at a time.** Highlight the relevant object and show one clear instruction. “Why this step?” reveals teaching detail; “That will not work” revises the plan. Preserve completed actions and constraints when revising.
5. **Check the result.** Capture an after photo. Distinguish a user's completion check from a model's image assessment and from a dimension check. Show uncertainty and ask for a clearer view when comparison is insufficient.
6. **Save a routine.** With an explicit save action, retain a named reference such as “Study setup.” The next visit starts with the difference from that reference and a short reset, rather than a new setup process.

The core loop is **goal → observe → guide → check → remember**. The user's interaction should be easy to learn even when the implementation has several reasoning, geometry, and state-management stages.

## What makes the demonstration meaningful

Show a crowded desk, choose “Get ready to study,” preserve the user's requested items, guide an actual change, then show the before/after result and the saved routine. Explain mistakes and uncertainty as they occur. The memorable moment is the completed task and the next-day reset, rather than an increasing object counter.

Do not invent productivity scores, physical dimensions, time saved, completion evidence, or accuracy statistics. One photograph does not establish reachability, load-bearing capacity, depth, or clearance. Use measurements for fit decisions and retain human review where the visual evidence is insufficient.

## Reuse and product focus

- Reuse the existing camera lifecycle, Muse reasoning, SAM object references, deterministic geometry planner, and saved-photo inspection.
- Connect them through one persistent task session with a stable before image, constraints, plan revision, progress, and after evidence.
- Keep Room Studio and the detailed editor as secondary tools reached from relevant tasks. Avoid putting every capability in the first screen.
- Introduce a short interactive tutorial using a clearly labelled example, then offer the same workflow on the user's space.
- Scope saved sessions to the authenticated workspace; provide export because the existing free hosting has temporary storage.

## Competition and differentiation hypothesis

Google already demonstrates camera-based help for organization and practical questions in [Gemini Live](https://blog.google/products-and-platforms/products/gemini/gemini-live-camera-how-to/). [IKEA Kreativ](https://www.ikea.com/us/en/customer-service/knowledge/articles/982f84a7-5941-45a8-a34a-1727c57dcc7f.html) already lets users explore furniture in their own spaces. Camera chat or furniture visualization alone is therefore a weak reason to switch.

WorldOS should test whether a focused workflow with object-linked steps, explicit progress, comparison evidence, and reusable personal setups is useful enough to bring people back. This is a product hypothesis, not a claim that those features are unique in the market.

## What to learn before broadening

Observe a few intended users attempting the complete task without coaching. Record whether they can explain the benefit, reach a useful first action, finish the task, recover from an incorrect suggestion, and choose to reuse the saved routine. Count failed and assisted attempts as well as successful ones. Ask what they would have used instead and whether WorldOS reduced effort. Broaden to teaching other practical tasks only after one complete workflow proves useful.
