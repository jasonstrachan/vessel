# CC Playback Warm Restore Blank Surface — Bounded Fix Plan

**Date:** 2026-07-13
**Status:** plan only; no implementation present

## Problem

Starting color-cycle playback can warm a cold layer by restoring its runtime brush. The restore currently renders into the published layer canvas before validating the result. If that render is blank, the visible surface can be replaced even though canonical project data is still recoverable. A later runtime rebase can also threaten populated canonical paint if it accepts a hollow restore candidate.

This plan fixes those two restore-boundary failures without redesigning playback, presentation, state APIs, or persistence.

## Required pre-implementation evidence

Do not begin implementation from the causal hypothesis alone. First reproduce the incident in the production preview with the exact recovered project used for this report.

Record the following in the implementation notes or evidence-only scratch material; do not commit the recovered artwork unless the user explicitly requests it:

1. The local filename or other unambiguous identifier for the recovered project.
2. The affected color-cycle layer IDs and names.
3. The production-preview URL and build commit.
4. Before pressing Play:
   - the official CC diagnostics dump,
   - the document version, pixel version, and content marker reported for each affected layer,
   - the `canvasSample` alpha/RGB counts reported for each affected layer.
5. Immediately after Play produces the blank surface:
   - the same diagnostics and counts,
   - the restore branch used for each affected layer,
   - the returned `materialized` value and runtime hydration state.

Capture the current browser session before reloading with:

```js
copy(JSON.stringify(window.__VESSEL_DUMP_CC_DIAGNOSTICS__?.(), null, 2))
```

If the exact artifact is unavailable or the blank-on-Play interaction cannot be reproduced, stop. Keep this document as a bounded hypothesis and do not claim that the implementation fixes the reported incident.

## Hard scope boundaries

### Production file budget

The implementation may modify no more than these five production files:

1. `src/lib/colorCycle/document/materializeColorCycleLayer.ts`
2. `src/utils/projectIO.ts`
3. `src/lib/colorCycle/document/hydration.ts`
4. `src/hooks/brushEngine/colorCycleRuntimeDocumentState.ts`
5. `src/stores/colorCycleBrushRegistry.ts` — discard a failed registered runtime without deleting its canonical document

All five files have a concrete role in the current execution path. If the fix requires any production file outside this list, stop before editing and revise the plan with the user.

### Test file budget

Tests may modify or add no more than four files:

1. `src/lib/colorCycle/__tests__/materializeColorCycleLayer.test.ts`
2. `src/lib/colorCycle/document/__tests__/hydration.test.ts`
3. `src/hooks/brushEngine/__tests__/colorCycleRuntimeDocumentState.test.ts`
4. `src/utils/__tests__/projectIO.test.ts`

Do not change the shared canvas mock. Any extra canvas behavior required by a test must be provided by a local helper in one of these test files.

### Total change budget

- Maximum: five production files, four test files, and this plan.
- Target: fewer than 500 added production lines and fewer than 350 added test lines.
- No new general-purpose abstraction unless it replaces more code than it adds.
- No unrelated cleanup, renaming, formatting, or architecture work.

Exceeding either the file or line budget is a stop condition, not permission to continue.

### Why five files matches the current execution path

The current code was re-audited against this budget:

1. `materializeRestoredColorCycleSurface(...)` renders directly into the published canvas and owns the transactional surface fix.
2. `projectIO.ts` calls that materializer from all three restore branches and currently returns the brush even when `materialized` is false. It must instead clear the layer brush, preserve retry sources, and return `brush: null` on failure.
3. `hydration.ts` already restores the layer to `cold` when the internal restore result has no brush. It must distinguish retryable materialization failure from irrecoverable source failure, establish validated canonical authority before runtime rebase, and preserve the safe fallback state.
4. `ColorCycleRuntimeDocumentState.rebaseLayerDocument(...)` owns the restore baseline replacement and therefore owns the populated-canonical to empty-candidate rejection.
5. `manager.createBrush(...)` registers runtime resources before materialization completes. `colorCycleBrushRegistry.ts` therefore needs a runtime-only discard operation that retains the canonical document.

No store or playback edit should be necessary: `createLayersSlice.ts` already derives deferred-restore success from the restored brush, `ensureColorCycleLayerRuntime(...)` already returns `false` when the manager has no brush, and playback warmup already blocks when that boolean is false. The store may clear the legacy `deferredRuntimeRestore` flag after failure; retry eligibility must come from the retained resident canonical document's runtime-source policy, not that flag.

## Contracts that must not change

- `ensureColorCycleLayerRuntime(...)` remains `Promise<boolean>`.
- `restoreColorCycleBrushes(...)` remains compatible with existing callers.
- No Zustand slice or `AppState` interface propagation.
- No persisted project or color-cycle schema changes.
- No new fields on `colorCycleData`.
- No compositor, canvas presentation resolver, toolbar, modal, or component changes.
- No playback participant or playback orchestration changes.
- No derived-surface provenance registry or `WeakMap` system.
- No Goblet/export changes unless the same confirmed restore path exists there; if it does, stop and re-scope explicitly.

## Required invariants

1. A restore candidate never renders directly into the published canvas.
2. A blank or throwing candidate leaves the previous canvas byte-for-byte unchanged.
3. Brush existence is not treated as restore success when materialization failed.
4. Failed materialization leaves the layer cold and does not publish the failed brush.
5. A failed runtime may be discarded without deleting the canonical document.
6. A restore-time runtime rebase cannot replace populated canonical paint with an empty candidate.
7. Intentional clear, erase, selection, and history transactions must still be able to produce an empty document.
8. Existing boolean callers continue to observe `true` only for usable runtime restoration and `false` for failed restoration.

## Canonical content classification

Blank validation and the rebase guard must use validated `ColorCycleLayerDocumentState`, not `layer.colorCycleData.hasContent`, canvas pixels, compatibility snapshots, or brush existence.

For this restore boundary:

- A canonical document is populated when its correctly sized paint buffer contains at least one non-zero byte.
- A canonical document is empty only when its correctly sized paint buffer exists, every paint byte is zero, and its `hasContent` marker does not contradict that result.
- A false or absent `hasContent` marker does not override non-zero canonical paint bytes. A true marker paired with an all-zero paint buffer is contradictory and must fail closed.
- A missing, malformed, or contradictory canonical state is not empty. Preserve the published surface and prior document, and emit a diagnostic reason.
- The expected-content classification must be captured from the validated restore source before runtime creation or rebase can replace it, then passed explicitly to materialization.
- `colorCycleData.hasContent` may be synchronized after a successful commit, but it must never decide whether blank output is valid.

## Implementation phases

### Phase A — Transactional surface materialization

In `materializeColorCycleLayer.ts`:

- Render the restored brush into a same-sized scratch canvas.
- Capture and validate the scratch pixels.
- Commit valid pixels to the published canvas with one `putImageData` operation.
- On blank output or exception, return failure and leave the published canvas untouched.
- Accept an explicit expected-content classification derived from validated canonical document state.
- A canonically empty layer may validly materialize a blank canvas; a populated or invalid/inconclusive canonical state may not.
- Do not infer canonical emptiness from `colorCycleData.hasContent` or from the existing published canvas.

Do not add presentation provenance or compositor-time pixel checks.

### Phase B — Honor materialization failure through existing seams

In `projectIO.ts` and `hydration.ts`:

- Preserve the materialization boolean instead of dropping it.
- Represent failed materialization through the existing internal brush/null result with the distinct internal reason `materialization-failed`; do not return or publish the failed brush as restored.
- Clear `colorCycleData.colorCycleBrush` when materialization fails.
- Keep the layer cold when no usable restored brush exists.
- Preserve the existing canvas or compatibility snapshot.
- On `materialization-failed`, retain the canonical document in retryable resident state and retain any source needed for a later retry. Do not mark the layer `static-preview-only` and do not attach a repair-failed status.
- Keep the existing irrecoverable `missing-paint-buffer` and primary-payload failure behavior separate; those paths may remain `static-preview-only`.
- A second restore attempt must be able to succeed from the retained manager document even if `deferredRuntimeRestore` was cleared by the store.

Do not introduce a new public readiness result type.

### Phase C — Guard only the restore rebase boundary

In `colorCycleRuntimeDocumentState.ts`:

- Before a restore-time baseline replacement, compare the current validated canonical paint bytes with the candidate paint bytes.
- Reject only a populated-canonical to empty-candidate rebase.
- Treat a missing, malformed, or contradictory candidate as rejection rather than as empty authority.
- Preserve both document and pixel version anchors when the accepted restore requests version preservation.
- Keep normal authoritative editing transactions unchanged.

This must not become a global prohibition on populated-to-empty documents.

### Phase D — Discard failed runtime without discarding authority

The restore factory calls `manager.createBrush(...)`, which registers runtime resources before materialization completes. Add a narrowly named registry operation in `colorCycleBrushRegistry.ts` that removes those runtime resources while retaining the same document identity and canonical snapshot. Invoke it only for failed restore/materialization cleanup. After cleanup, `manager.hasBrush(layerId)` must be false while `manager.getDocument(layerId)` remains retryable.

## Required tests

1. A blank candidate preserves an already painted published canvas byte-for-byte.
2. A throwing candidate preserves the published canvas.
3. A visible candidate commits only after validation.
4. A canonically empty layer may commit a blank candidate.
5. A stale `colorCycleData.hasContent` value cannot override populated or empty canonical paint bytes.
6. A malformed or contradictory canonical state fails closed without changing the published surface.
7. Hydration does not publish warm or active state when materialization fails.
8. Failed hydration removes the runtime brush while retaining the same canonical document identity, paint, resident retry policy, and any safe fallback surface.
9. A first materialization failure followed by a successful second attempt restores from the retained manager document even when `deferredRuntimeRestore` is false.
10. An irrecoverable missing-paint failure remains distinct and becomes static-preview-only.
11. A populated canonical document rejects an empty restore rebase without changing document or pixel versions.
12. A valid populated candidate rebases while preserving both requested version anchors.
13. Save and reopen after warm restore preserves canonical paint.

Avoid broad snapshots and unrelated caller tests. Test the owning contracts directly.

## Verification gate

Run in this order:

1. The four focused test files.
2. `npm run type-check`.
3. Scoped lint for touched files.
4. `git diff --check` for touched files.
5. `mise exec node@22.22.0 -- npm run preview:prod:restart` for a fresh production preview build and server.
6. Load the exact artifact recorded in the pre-implementation evidence, reproduce the same pre-Play baseline, press Play, and verify every previously visible affected CC layer remains visible.
7. Confirm the post-Play document/pixel anchors and content marker remain consistent with the recorded baseline, the `canvasSample` remains non-blank, no failed brush remains registered, and hydration reaches the requested state only after successful materialization.
8. Pause, save, reopen the saved project, and verify the affected canonical documents still report content and the same layers remain visibly non-blank.
9. Capture the final official CC diagnostics dump and record the before/after measurements with the implementation result.

Do not claim the runtime bug fixed from unit tests or build success alone.

## Stop conditions

Stop and ask before proceeding if any of these occur:

- More than five production files are required.
- A public state, playback, or persistence contract appears to require changing.
- The fix needs compositor or presentation-resolver changes.
- The canonical guard cannot distinguish restore rebases from intentional edits.
- The exact production-preview reproduction still blanks a layer after the bounded fix.
- The exact recovered project or pre-fix reproduction evidence is unavailable.
- A retryable materialization failure becomes `static-preview-only` or loses manager document identity.
- Canonical emptiness cannot be determined from validated paint bytes without relying on layer metadata or presentation pixels.
- A proposed patch compensates downstream instead of fixing restore/materialization ownership.

If the bounded implementation fails, revert it completely before considering a broader design.

## Non-goals

- Explaining why the first runtime render is blank when a later retry succeeds.
- Redesigning color-cycle playback readiness.
- Adding generalized surface provenance.
- Refactoring canvas orchestration or store composition.
- Changing archive formats or promoting preview pixels into canonical paint.
- Fixing nearby color-cycle issues not exercised by this incident.
