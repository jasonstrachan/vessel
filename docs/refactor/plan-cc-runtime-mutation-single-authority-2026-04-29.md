# Color Cycle Runtime Mutation Single Authority Plan

Date: 2026-04-29

Status: planned

## Goal

Create one authoritative runtime mutation boundary for Color Cycle layer paint state so no live CC paint buffer can be cleared, replaced, restored, or marked empty except through one audited path.

Target invariant:

```text
Any change to CC runtime paint/speed/flow/phase/def/gid buffers must pass through one mutation boundary with a reason code, before/after summaries, state sync, and render/dirty handling.
```

This is separate from `plan-cc-persistence-single-authority-2026-04-28.md`. That plan owns save/autosave/history/archive authority. This plan owns live runtime buffer mutation authority while the app is open.

## Problem Statement

The current persistence architecture can reject missing canonical archive payloads, but live runtime mutation still has multiple direct writers. A blank CC layer can currently mean:

- real runtime paint deletion,
- snapshot/restore replacement that marked paint empty,
- playback/presentation/compositor blanking,
- expected user clear or erase.

The diagnostic contract should become:

```js
window.__VESSEL_GET_CC_MUTATION_LOG__?.()
```

If live CC paint transitions from non-empty to empty, a persistent `color-cycle-layer-cleared` event must exist with reason, stack, and compact before/after buffer summaries. If no event exists, runtime deletion is no longer the first suspect.

## Non-Goals

- Do not change save/autosave/archive persistence unless the runtime refactor exposes a real save caller bug.
- Do not redesign playback, gradients, dither algorithms, sampled rendering, shape preview, or compositor presentation.
- Do not add scattered logging to call sites as the main fix.
- Do not treat `canvas`, `canvasImageData`, rendered RGBA, or compositor output as canonical runtime paint.
- Do not stack speculative patches. If a change does not enforce the runtime authority invariant, back it out before continuing.

## Known Runtime Writers To Inventory

- `src/hooks/brushEngine/ColorCycleBrushCanvas2D.ts`
  - `clearPaintBuffer()`
  - `applyLayerSnapshot()`
  - `restoreFullState()`
  - `clear()`
  - `startStroke(clearBuffer = true)`
  - any direct `buffers.paint.fill(0)` / `layerStrokes.clear()` paths
- `src/stores/helpers/colorCycleSelection.ts`
  - `mutateColorCycleLayer()`
  - `clearColorCycleRegion()`
  - `writeColorCycleRegion()`
- Direct snapshot callers:
  - shape erase/fill paths
  - transparency lock paths
  - color adjust paths
  - project load/warm restore paths
  - history restore paths

## Runtime Boundary Design

Add a single internal mutation boundary in the CC brush runtime first. Do not start by creating a broad app-level service.

Candidate internal shape:

```ts
type ColorCycleRuntimeMutationReason =
  | 'brush-stroke-write'
  | 'selection-region-clear'
  | 'shape-erase'
  | 'transparency-lock-erase'
  | 'manual-clear-layer'
  | 'non-cc-brush-cleanup'
  | 'snapshot-apply'
  | 'history-restore'
  | 'project-load-restore'
  | 'runtime-reset';

type ColorCycleRuntimeMutationSource =
  | 'stroke'
  | 'region'
  | 'clear'
  | 'snapshot'
  | 'restore'
  | 'history'
  | 'project-load'
  | 'reset';

private mutateLayerStrokeState(params: {
  layerId: string;
  reason: ColorCycleRuntimeMutationReason;
  source: ColorCycleRuntimeMutationSource;
  expectedDestructive?: boolean;
  mutate: (state: LayerStrokeState) => void;
  after?: {
    hasContent?: boolean;
    strokeCounter?: number;
  };
}): boolean
```

The boundary owns:

- resolving or creating `LayerStrokeState`,
- before summary,
- mutation execution,
- after summary,
- populated-to-empty detection,
- persistent `color-cycle-layer-cleared` logging,
- expected/unexpected destructive tagging,
- dirty layer marking,
- animator buffer sync,
- snapshot sync,
- animation stop when no content remains.

## Implementation Checklist

### Phase 1: Inventory Runtime Mutation Writers

Status: completed

- [x] Create this runtime-specific plan in `docs/refactor`.
- [x] Build an inventory table of every runtime writer and direct buffer clear.
- [x] Classify each writer as stroke write, region mutation, snapshot apply, restore, reset, teardown, or presentation-only.
- [x] Mark whether each writer is expected-destructive, unexpected-destructive, or non-destructive.
- [x] Identify which writers currently bypass `color-cycle-layer-cleared`.

Inventory:

| Path | Classification | Destructive policy | Runtime boundary status |
| --- | --- | --- | --- |
| `ColorCycleBrushCanvas2D.clearPaintBuffer()` | clear | expected-destructive when called intentionally | routed through `mutateLayerStrokeState(...)` |
| `ColorCycleBrushCanvas2D.startStroke(clearBuffer = true)` | stroke/reset | expected-destructive when a caller explicitly requests a clear buffer | routed through `mutateLayerStrokeState(...)` |
| `ColorCycleBrushCanvas2D.applyLayerSnapshot()` | snapshot apply | destructive only when populated runtime state is replaced by an empty snapshot | audited at snapshot boundary with reason/source |
| `ColorCycleBrushCanvas2D.restoreFullState()` non-history pre-clear | project-load restore | expected-destructive replacement before applying validated snapshots | routed through `mutateLayerStrokeState(...)` |
| `ColorCycleBrushCanvas2D.restoreFullState()` history mode | history restore | should not use the normal pre-clear path | preserved via existing `asHistory` guard and reason tagging |
| `ColorCycleBrushCanvas2D.clear()` | reset | expected-destructive runtime reset | routed through reset helper with per-layer audit |
| `ColorCycleBrushCanvas2D.cleanup()` / `dispose()` | teardown | lifecycle disposal, not a live layer clear | excluded from `color-cycle-layer-cleared` audit |
| `colorCycleSelection.mutateColorCycleLayer()` | region mutation | destructive only if copied paint becomes empty | uses shared scalar-buffer summary helper and existing persistent event |
| Shape erase / transparency-lock / color-adjust snapshot callers | snapshot apply callers | depends on resulting snapshot | covered by `applyLayerSnapshot()` populated-to-empty detection |
| Presentation/compositor draw paths | presentation-only | non-destructive | excluded from runtime mutation authority |

Exit criteria:

- [x] Every direct runtime buffer mutation path has a reason classification.
- [x] The inventory separates actual paint deletion from presentation/compositor paths.

### Phase 2: Extract Shared Buffer Summary And Audit Helpers

Status: completed

- [x] Move compact scalar-buffer summary logic out of `colorCycleSelection.ts` into a reusable runtime/audit helper.
- [x] Add summaries for paint, gradient id, gradient def id, speed, flow, and phase.
- [x] Add a helper that compares before/after runtime snapshots and detects populated-to-empty transitions.
- [x] Keep persistent storage reserved for destructive/error events, not normal stroke writes.

Exit criteria:

- [x] `colorCycleSelection.ts` and `ColorCycleBrushCanvas2D.ts` can use the same summary/audit helpers.
- [x] Existing `color-cycle-layer-cleared` test coverage still passes.

### Phase 3: Add The Internal Runtime Mutation Boundary

Status: completed

- [x] Add `ColorCycleRuntimeMutationReason` and `ColorCycleRuntimeMutationSource` types.
- [x] Add `mutateLayerStrokeState(...)` inside `ColorCycleBrushCanvas2D`.
- [x] Ensure the boundary captures before/after summaries without large raw buffer persistence.
- [x] Ensure the boundary records populated-to-empty transitions with stack and reason.
- [x] Ensure expected destructive clears still persist, but are tagged as expected.
- [x] Ensure non-destructive writes do not create noisy persistent audit entries.

Exit criteria:

- [x] The boundary can perform a destructive clear and a snapshot replacement in tests.
- [x] Persistent mutation log entries are created only when policy says they should be.

### Phase 4: Route `clearPaintBuffer()` Through The Boundary

Status: completed

- [x] Replace direct `fill(0)` calls in `clearPaintBuffer()` with the mutation boundary.
- [x] Preserve the history-restore guard.
- [x] Preserve animator upload/render behavior.
- [x] Preserve stop-animation-when-no-content behavior.
- [x] Add regression coverage for populated-to-empty logging.

Exit criteria:

- [x] `clearPaintBuffer()` cannot empty paint outside the boundary.
- [x] Existing clear-last-layer playback behavior still passes.

### Phase 5: Route `applyLayerSnapshot()` Through The Boundary

Status: completed

- [x] Audit paint/gid/def/speed/flow/phase replacement at the snapshot boundary.
- [x] Preserve partial-size copy behavior.
- [x] Preserve animator-index fallback behavior.
- [x] Preserve canonical snapshot synchronization.
- [x] Record populated-to-empty when an empty snapshot replaces populated runtime data.
- [x] Do not record noisy logs for normal populated snapshot applies.

Exit criteria:

- [x] `applyLayerSnapshot(empty)` logs a populated-to-empty transition.
- [x] `applyLayerSnapshot(populated)` does not persist noisy audit entries.
- [x] Existing project-load/history snapshot tests still pass.

### Phase 6: Route `restoreFullState()` Clear-Before-Restore Through The Boundary

Status: completed

- [x] Replace direct clear-before-restore buffer zeroing with the boundary.
- [x] Preserve `mode: 'history'` semantics and assertions.
- [x] Tag project-load/warm-restore replacements distinctly from history restores.
- [x] Ensure restore that immediately reapplies populated snapshots is represented clearly in diagnostics.

Exit criteria:

- [x] Non-history restore cannot silently clear populated runtime paint.
- [x] History restore does not accidentally use a normal destructive clear path.

### Phase 7: Reconcile External Callers And Reason Codes

Status: completed

- [x] Route selection region clear through the same audit helper or runtime boundary reason policy.
- [x] Route shape erase and transparency-lock erase snapshot paths through `applyLayerSnapshot()` populated-to-empty detection.
- [x] Route color adjust snapshot writes through `applyLayerSnapshot()` populated-to-empty detection.
- [x] Keep the public API stable for now; narrower methods remain a follow-up once call-site semantics are named.

Potential public runtime API after internals are stable:

```ts
clearLayerRuntimePaint(layerId, reason)
applyValidatedLayerSnapshot(layerId, snapshot, reason)
restoreLayerRuntimeState(layerId, snapshot, reason)
writeLayerRuntimeRegion(layerId, patch, reason)
```

Exit criteria:

- [x] New callers do not need to know how to zero raw runtime buffers.
- [x] No remaining direct populated-to-empty buffer clear bypasses the boundary.

### Phase 8: Tighten Diagnostics Contract

Status: completed

- [x] Update `docs/notes/cc-layer-disappearing-diagnostics-2026-04-29.md` to state the stronger post-refactor contract.
- [x] Confirm `window.__VESSEL_GET_CC_MUTATION_LOG__?.()` returns persistent entries for covered live populated-to-empty transitions in tests.
- [x] Confirm blank visual with no runtime clear event points investigation to playback/presentation/compositor in the diagnostics note.

Exit criteria:

- [x] The diagnostics note matches the implemented invariant.
- [x] Runtime clear log is authoritative for covered live data deletion paths.

### Phase 9: Automated Verification

Status: completed

- [x] Add/adjust `ColorCycleBrushCanvas2D` regression tests for `clearPaintBuffer()`.
- [x] Add/adjust `ColorCycleBrushCanvas2D` regression tests for `applyLayerSnapshot(empty)`.
- [x] Add/adjust restore tests for non-history and history restore paths.
- [x] Keep `colorCycleSelection` region-clear logging coverage.
- [x] Keep `ccMutationAudit` persistence-scope coverage.
- [x] Run targeted tests:

```bash
npm test -- --runTestsByPath \
  src/hooks/brushEngine/__tests__/ColorCycleBrushCanvas2D.regression.test.ts \
  src/stores/helpers/__tests__/colorCycleSelection.test.ts \
  src/utils/colorCycle/__tests__/ccMutationAudit.test.ts
```

- [x] Run required repo checks:

```bash
npm run type-check
npm run lint
npm test
```

Exit criteria:

- [x] Targeted tests pass.
- [x] Required repo checks pass.

### Phase 10: Runtime Validation

Status: completed

- [x] Create a populated CC runtime layer in regression coverage.
- [x] Trigger runtime clear through `clearPaintBuffer()`.
- [x] Trigger populated-to-empty replacement through `applyLayerSnapshot()`.
- [x] Trigger project-load restore pre-clear through `restoreFullState()`.
- [x] Inspect persisted mutation log via:

```js
window.__VESSEL_GET_CC_MUTATION_LOG__?.()
```

- [x] If there is a clear event, verify reason, stack, before/after summaries, and expected flag.
- [x] If there is no clear event, inspect playback/presentation/compositor with runtime deletion deprioritized.

Exit criteria:

- [x] A real runtime clear has a persistent event.
- [x] A blank visual with no clear event keeps non-empty runtime buffers and moves to presentation investigation.

Validation note:

- This pass validated the runtime mutation contract directly in regression tests rather than through browser drawing. Browser repro remains useful if a new visual blanking report appears, but the runtime deletion invariant is covered by direct brush-runtime tests.

## Success Criteria

- [x] There is one internal runtime mutation boundary for CC stroke buffers.
- [x] No direct populated-to-empty buffer clear remains outside it.
- [x] The mutation log is authoritative for live runtime deletion.
- [x] Persistence snapshot authority remains separate and unchanged.
- [x] Blank visual with no runtime clear event can be treated as playback/presentation/compositor evidence, not data loss.
