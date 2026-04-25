# Bug Debug Levels

Use these levels to decide how much evidence we need before changing code.
The levels are about debugging depth, not blame or severity.

## Core Rule

Start at the lowest level that can produce reliable evidence. Escalate only
when the current level does not identify the first bad transition.

## Level 0: Obvious Code Correction

Use when the cause is clear from the code or compiler output.

Examples:

- Typo.
- Broken import.
- Wrong prop name.
- Incorrect constant.
- Simple CSS/layout mistake.
- Missing dependency in a small effect.

Expected workflow:

- Patch directly.
- Run the narrow relevant check.
- Avoid adding diagnostics.

Exit criteria:

- The fix is obvious, small, and verified.

## Level 1: Describe, Trace, Fix

Use when the bug is reproducible from a normal description and likely lives in
a known code path.

Examples:

- UI state not persisting.
- Wrong default value.
- A button or control does the wrong thing.
- Save/load loses a known field.
- Straightforward rendering mismatch.

Expected workflow:

- Describe the observed behavior and expected behavior.
- Trace the relevant execution path in code.
- Reproduce with a targeted manual check or test where useful.
- Make a focused fix.
- Add or update regression coverage where reasonable.

Exit criteria:

- Root cause is identified.
- The fix is small and explainable.
- Test or manual validation confirms the path.

## Level 2: Overlay And Targeted Runtime Logging

Use when the code path looks plausible but the runtime order, state, or payload
is unclear.

Examples:

- "It works until I do X."
- State changes happen in the wrong order.
- Preview and finalized output diverge.
- Hydration/save/load fields exist but are normalized away.
- Animation starts only after another action.
- Bugs involving Zustand, canvas state, async scheduling, or color-cycle state.

Expected workflow:

- Add dev-only overlay readouts where screenshots or video need to capture the
  evidence.
- Add narrow logging at named checkpoints.
- Prefer one-shot or per-action probes over noisy per-frame logs.
- Use short stable labels such as `stroke:start`, `shape:finalize`,
  `cc:hydrate`, and `export:serialize`.
- Keep instrumentation on the suspected execution path.

Exit criteria:

- The first bad transition is known.
- Logs or overlay output identify the wrong phase, state, or payload.
- Temporary diagnostics are removed, reduced, or explicitly kept if still useful.

## Level 3: Browser Forensics And Crash Evidence

Use when Level 2 still does not isolate the bug, or when the app hangs, crashes,
locks up, or fails only in the browser/runtime environment.

Examples:

- Hangs.
- Crashes.
- Infinite loops.
- Browser tab lockups.
- Production-only failures.
- Exported files differ from app behavior.
- The failing state disappears before it can be inspected normally.

Expected workflow:

- Use browser DevTools.
- Capture stack traces.
- Use Sources breakpoints where a specific transition is suspected.
- Use the Performance profiler for frame, scheduler, or loop bugs.
- Capture crash text dumps or runtime breadcrumbs when the page becomes
  unresponsive.
- Inspect exported artifacts directly when the bug is in generated output.

Exit criteria:

- The exact stuck function, loop, task, stack, or artifact mismatch is known.
- The evidence is durable enough to guide a code change.
- Any heavy diagnostics are removed or kept behind an explicit dev gate.

## Level 4: Reproduction Harness, Artifact Diff, Or Bisect

Use when the main app is too noisy, prior patches have not explained the bug, or
the problem keeps recurring.

Examples:

- Repeated regressions.
- Export/runtime mismatches that cannot be explained from the app path alone.
- Bugs where local patches change behavior but do not explain the cause.
- Architecture-level confusion.
- Any case where we are guessing instead of proving the failing transition.

Expected workflow:

- Stop stacking speculative patches.
- Revert ineffective attempts that do not improve the code.
- Build a minimal reproduction or isolated harness.
- Compare working and failing state snapshots or artifacts.
- Bisect when history is the fastest way to isolate the regression.
- Return to the main app only once the mechanism is proven.

Exit criteria:

- The failing mechanism is isolated outside the noisy path, or the regression
  range is known.
- The production fix follows from the reproduced mechanism.
- Regression coverage is added at the right boundary.

## Escalation Checklist

Before escalating, answer:

- What was the last known good phase?
- What is the first observed bad phase?
- Which state, payload, stack, artifact, or visual output proves it?
- Did the previous diagnostic attempt actually reduce uncertainty?

If the answer is no, narrow the probe before adding more diagnostics.
