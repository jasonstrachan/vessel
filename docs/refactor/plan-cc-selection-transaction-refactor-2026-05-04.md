# CC Selection Transaction Refactor

Date: 2026-05-04

## Problem

Color-cycle selection editing is currently split across store actions, helper modules, runtime brush state, history, and diagnostics:

- `deleteSelectedPixels` has an authorization boundary.
- `extractSelectionToFloatingPaste` has separate safety checks.
- `commitFloatingPaste` and `cancelFloatingPaste` own different parts of restore/writeback behavior.
- CC runtime mutation happens through `clearColorCycleRegion`, `writeColorCycleRegion`, `applyLayerSnapshot`, and `updateLayer`.
- History captures before/after state from the caller instead of from one transaction boundary.
- Diagnostic events describe symptoms after mutation rather than one preflight decision.

This makes it too easy to patch one destructive path while another path still has different rules. The latest failure class is not just "delete"; selection extract can legitimately clear the source layer when creating a floating paste, but that same behavior is unsafe when selection ownership, canonical payload, or commit/cancel state is wrong.

## Goal

Create one color-cycle selection transaction boundary for destructive selection operations:

```ts
preflight -> capture before -> mutate/extract/write -> create/commit/cancel floating paste -> history -> audit
```

The transaction must clearly distinguish:

- partial delete,
- explicit full delete,
- full-object move,
- stale selection/layer mismatch,
- missing canonical CC payload,
- paste commit,
- paste cancel/restore.

## Non-Goals

- Do not rewrite the whole selection system.
- Do not redesign the selection UI.
- Do not block legitimate marquee movement of an entire bounded CC object.
- Do not remove low-level CC mutation guards until the transaction layer has equivalent tests.
- Do not reconstruct missing canonical paint from gradient ids or rendered bitmap pixels.
- Do not change normal raster/sequential behavior except where shared selection ownership rules require it.

## Invariants

- A CC destructive operation must have a named operation and a preflight result before buffers are changed.
- Selection ownership must match the target layer unless the operation explicitly supports cross-layer paste.
- Missing canonical CC buffers must block CC source mutation.
- Runtime brush state, `layer.colorCycleData`, floating paste payload, history, and diagnostics must be derived from the same captured canonical CC transaction state.
- Full-object move is valid. It may clear the source while the floating paste is active, but the paste payload must retain CC paint, gradient ids, gradient def ids, speed, flow, phase, and transfer metadata.
- Full delete is valid only through explicit delete/select-all intent, not through stale selection state.
- `updateLayer(... colorCycleData ...)` must not be the first place that decides whether a wipe is legitimate.
- Every transaction gets a stable `transactionId` so preflight, capture, mutation, history, and audit events can be correlated.
- No source clear may occur until preflight passes, canonical payload capture succeeds, before-state capture succeeds, and any required floating paste payload is constructed.
- No floating paste may be discarded until destination write succeeds and the history payload is created.
- Low-level CC helpers should keep structural assertions permanently: canonical payload present, layer/selection identity sane, and scalar buffer dimensions aligned. These are not policy gates, but they should still refuse impossible destructive states.

## Proposed Module

Create:

```txt
src/stores/helpers/colorCycleSelectionTransaction.ts
```

One public module is the boundary, but it should not become one procedural god helper. Keep the internals small:

```ts
preflightCcSelectionTransaction(...)
captureCcSelectionBefore(...)
applyCcSelectionMutation(...)
buildCcSelectionHistoryPayload(...)
emitCcSelectionTransactionEvent(...)
```

Initial type shape:

```ts
type CcSelectionOperation =
  | 'delete-selected'
  | 'extract-selection-transform'
  | 'commit-floating-paste'
  | 'cancel-floating-paste';

type CcSelectionAllowedKind =
  | 'partial-clear'
  | 'explicit-full-delete'
  | 'full-object-move'
  | 'paste-commit'
  | 'paste-cancel-restore';

type CcSelectionBlockedKind =
  | 'selection-layer-mismatch'
  | 'selection-mask-layer-mismatch'
  | 'history-restored-unsafe'
  | 'missing-canonical-payload'
  | 'scalar-buffer-size-mismatch'
  | 'missing-gradient-definition'
  | 'unsupported-cross-layer-target'
  | 'invalid-selection';

type CcSelectionPreflight =
  | {
      ok: true;
      transactionId: string;
      kind: CcSelectionAllowedKind;
      operation: CcSelectionOperation;
      bounds: Rectangle;
      requiresPayload: boolean;
    }
  | {
      ok: false;
      transactionId: string;
      kind: CcSelectionBlockedKind;
      operation: CcSelectionOperation;
      clearSelection: boolean;
      details: Record<string, unknown>;
    };
```

Preflight decides whether the operation can proceed and what class of operation it is. Payload capture happens immediately after successful preflight, only for operations that require it.

## Internal Responsibilities

### `preflightCcSelectionTransaction`

- Pure dry-run decision.
- No store writes.
- No buffer mutation.
- No payload copying except small summaries needed for classification.
- Classifies:
  - partial clear,
  - explicit full delete,
  - full-object move,
  - paste commit,
  - paste cancel/restore,
  - blocked stale/missing/unsupported states.

### `captureCcSelectionBefore`

- Captures canonical runtime/store state after preflight and before mutation.
- Verifies scalar buffer dimensions match.
- Builds any required floating paste payload.
- Fails without mutating source or destination.

### `applyCcSelectionMutation`

- Performs the source clear, destination write, or restore only after preflight and capture succeed.
- Leaves floating paste active when commit fails.
- Leaves source unchanged when extract capture fails.

### `buildCcSelectionHistoryPayload`

- Produces the before/after history payload from the transaction state.
- Callers should not independently capture CC history state once migrated.

### `emitCcSelectionTransactionEvent`

- Emits transaction-correlated diagnostic events.
- Each event includes `transactionId`, operation, result kind, layer/source/target ids, bounds, and compact buffer summaries where relevant.

## Existing Code To Move Behind Boundary

- `src/stores/slices/selectionSlice.ts`
  - `deleteSelectedPixels`
  - `extractSelectionToFloatingPaste`
  - selection provenance validation
  - CC-specific clear/extract audit logging
- `src/stores/helpers/colorCycleSelection.ts`
  - `clearColorCycleRegion`
  - `writeColorCycleRegion`
  - CC scalar buffer mutation helpers
- `src/stores/helpers/selectionCapture.ts`
  - CC payload capture from runtime snapshot
  - scalar region copy helpers
- `src/stores/helpers/selectionPaste.ts`
  - CC paste commit/writeback path
  - same-layer move history context
- `src/history/helpers/colorCycle.ts`
  - before/after CC state capture used by selection history

## Phase 1. Pure Transaction Preflight

- [x] Add `colorCycleSelectionTransaction.ts` with pure preflight helpers.
- [x] Accept current selection state, target layer, project, operation, provenance, mask metadata, and canonical runtime snapshot.
- [x] Return a typed decision without mutating the store.
- [x] Reuse `selectionDeleteAuthorization.ts` where it already models delete policy.
- [x] Add explicit `full-object-move` as an allowed result for `extract-selection-transform`.
- [x] Keep `keyboard-full-content-clear-blocked` behavior for non-explicit keyboard delete.
- [x] Separate allowed result kinds from blocked result kinds.
- [x] Include `transactionId` in every result.
- [x] Return `requiresPayload` instead of a captured payload from preflight.
- [x] Add tests for:
  - [x] stale layer mismatch blocks before mutation,
  - [x] mask layer mismatch blocks before mutation,
  - [x] missing canonical payload blocks before mutation,
  - [x] scalar buffer dimension mismatch blocks before mutation,
  - [x] gradient def id exists but the referenced gradient def is missing and is blocked or classified explicitly,
  - [x] partial extract is allowed,
  - [x] full-object marquee extract is allowed and classified as `full-object-move`,
  - [x] non-explicit keyboard full delete is blocked,
  - [x] explicit select-all delete is allowed.

## Phase 2. Transaction Shell For Delete

- [x] Add an executor shell, such as `runCcSelectionTransaction(...)`, but route only `delete-selected` through it first.
- [x] Keep existing low-level guards in place.
- [x] Keep existing delete behavior and event aliases unless tests prove a replacement is equivalent.
- [x] Confirm `deleteSelectedPixels` no longer owns CC-specific policy inline once migrated.
- [x] Add tests proving delete behavior is unchanged:
  - [x] explicit same-layer select-all delete works,
  - [x] non-explicit full-content keyboard delete blocks,
  - [x] stale owner delete blocks,
  - [x] missing canonical payload blocks,
  - [x] partial delete updates all scalar buffers.

## Phase 3. Extract And Full-Object Move

- [x] Route `extractSelectionToFloatingPaste` through transaction preflight.
- [x] Move CC payload capture into the transaction helper.
- [x] Guarantee floating paste contains:
  - `colorCycleIndices`,
  - `colorCycleGradientIds`,
  - `colorCycleGradientDefIds`,
  - `colorCycleSlotPalettes`,
  - `colorCycleGradientDefs`,
  - `colorCycleSpeed`,
  - `colorCycleFlow`,
  - `colorCyclePhase`.
- [x] Keep source clearing inside the transaction after payload capture succeeds.
- [x] Ensure failed extract leaves runtime brush, store layer, and selection state unchanged except for intentional stale-selection cleanup.
- [x] Add tests for source clear plus floating payload parity.
- [x] Add tests for:
  - [x] payload capture succeeds but source clear fails: no history pushed and floating paste is not created,
  - [x] scalar buffer dimensions mismatch blocks before mutation,
  - [x] full-object marquee move creates floating paste with complete CC payload,
  - [x] cross-layer paste from CC source to non-CC layer is blocked or explicitly downgraded.

## Phase 4. Commit And Cancel

- [x] Route same-layer CC paste commit through the transaction helper.
- [x] Route cross-layer CC paste commit through the same helper with explicit target/source semantics.
- [x] Route cancel restore through the helper, using the transaction's captured before-state.
- [x] Ensure commit/cancel writes all scalar buffers, not just paint and gradient id.
- [x] Ensure erase/soft-edge masks are handled deliberately, not as side effects.
- [x] Add tests for:
  - [x] move then commit restores CC content at the destination,
  - [x] move then cancel restores source exactly,
  - [x] commit after full-object move does not leave the source permanently empty unless destination write succeeds,
  - [x] failed commit keeps the floating paste active and does not discard payload.
  - [x] destination write fails during commit: source remains recoverable and floating paste remains active,
  - [x] cancel after partial move restores only original affected bounds.

## Phase 5. History Boundary

- [x] Make the transaction produce the history before/after payload.
- [x] Stop each caller from independently deciding which CC state to capture.
- [x] Preserve `selectionBefore` and source bounds for undo/redo.
- [x] Add tests for:
  - [x] undo full-object move,
  - [x] redo full-object move,
  - [x] undo failed/blocked operation is a no-op,
  - [x] history-restored selection cannot become fresh destructive intent accidentally.
  - [x] undo after commit restores both source and destination CC buffers.

## Phase 6. Diagnostics, Save Boundaries, And Cleanup

- [x] Replace scattered CC selection audit events with transaction-level events:
  - `cc-selection-transaction-preflight-blocked`,
  - `cc-selection-transaction-source-cleared`,
  - `cc-selection-transaction-paste-committed`,
  - `cc-selection-transaction-restored`,
  - `cc-selection-transaction-failed`.
- [x] Keep existing event names temporarily as aliases if they are useful for current console probes.
- [x] Remove duplicated selection ownership checks from `selectionSlice.ts` after tests cover the helper.
- [x] Update `docs/notes/cc-layer-disappearing-diagnostics-2026-04-29.md` with the new event names and interpretation rules.
- [x] Add a targeted save/autosave check for active floating paste state so a temporarily empty source cannot persist as final truth.
- [x] Add a targeted Goblet/export check after move/commit/cancel flows.

## Definition Of Done

- [x] `selectionSlice.ts` no longer owns CC transaction policy inline.
- [x] Delete, extract, commit, and cancel use one CC selection transaction helper.
- [x] Full-object CC marquee move works.
- [x] Stale selection state cannot clear a CC layer.
- [x] Missing canonical payload blocks source mutation.
- [x] Floating paste payload preserves all CC scalar buffers and gradient transfer metadata.
- [x] Undo/redo of CC selection move is covered.
- [x] Runtime, store, history, save/autosave, and Goblet export keep canonical CC data intact after move/delete/cancel flows.
- [x] Autosave during active floating paste cannot persist an empty source as final truth.
- [x] Focused tests pass:
  - `npm test -- --runTestsByPath src/stores/__tests__/selectionFramebufferDelete.test.ts`
  - transaction helper tests added in `src/stores/helpers/__tests__/`
- [x] Broader verification passes:
  - `npm run type-check`
  - `npm run lint`
  - `npm test`

## Verification Result

- 2026-05-04: `npm run type-check` passed.
- 2026-05-04: `npm run lint` passed.
- 2026-05-04: `npm test` passed: 378 suites, 2340 tests.

## Execution Notes

- Keep each phase reviewable and commit separately.
- The first implementation PR should be only: pure CC selection preflight helper, tests, and `deleteSelectedPixels` routing. Do not migrate extract/commit/cancel in the first PR.
- Do not remove existing stop-loss guards until the new transaction tests prove equivalent or stricter behavior.
- Keep low-level structural guards permanently where they protect against impossible buffer/layer states.
- If a new transaction branch is needed, add the dry-run classification first, then mutate only after the test proves the classification.
- If a patch fails to fix the observed wipe path, revert that patch before trying another approach.
