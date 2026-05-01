# Selection Delete Authorization Refactor

Date: 2026-05-01

## Problem

Selection delete is currently authorized implicitly by scattered state:

- selection bounds are global,
- keyboard delete reads the global selection and the current active layer,
- layer ownership is stored as diagnostic provenance rather than enforced intent,
- color-cycle canonical mutation code has local safety guards because the delete request has already reached a destructive path.

This allowed dangerous combinations:

- a selection created on one layer could be applied to another active color-cycle layer,
- a history-restored selection could look like a fresh selection,
- Delete/Backspace could clear every nonzero CC paint pixel even if the selection was not an explicit select-all,
- CC canonical mutation code had to infer whether a delete was legitimate after simulating the mutation.

The current guards are stop-loss protections, not the durable architecture.

## Goal

Create one authorization boundary for selection deletes:

```ts
requestSelectionDelete(source) -> authorizeSelectionDelete(...) -> perform layer-specific delete
```

The authorization boundary must decide whether a delete request is allowed before any raster, sequential, or color-cycle mutation happens.

## Non-Goals

- Do not redesign selection UI.
- Do not change normal raster/sequential delete behavior unless it currently relies on stale layer ownership.
- Do not remove the existing CC low-level guards until the new boundary is covered by tests.
- Do not reconstruct missing CC canonical paint.

## Current Stop-Loss Guards To Preserve Initially

- `selection-delete-skipped-layer-mismatch`: prevents selection ownership mismatch from deleting CC content.
- `color-cycle-keyboard-delete-full-content-blocked`: prevents keyboard delete from clearing all live CC paint from a normal set-bounds selection.
- `color-cycle-selection-clear-skipped-missing-canonical-paint`: prevents selection clear from seeding paint from gradient IDs.
- `initColorCycleForLayer` preserves existing `colorCycleData` instead of rebuilding it from scratch.

These remain until equivalent centralized authorization tests exist.

## Proposed Types

```ts
type SelectionDeleteSource =
  | 'keyboard-delete'
  | 'menu-delete'
  | 'toolbar-delete'
  | 'api-delete';

type SelectionOwnerKind =
  | 'direct-marquee'
  | 'selection-handle'
  | 'mask-selection'
  | 'history-restored'
  | 'select-all'
  | 'programmatic'
  | 'unknown';

type SelectionDeleteAuthorization =
  | {
      ok: true;
      layerId: string;
      layerType: Layer['layerType'];
      bounds: Rectangle;
      source: SelectionDeleteSource;
      selectionOwnerKind: SelectionOwnerKind;
      allowFullContentClear: boolean;
      destructiveIntent: 'normal' | 'explicit-full-clear';
    }
  | {
      ok: false;
      reason:
        | 'missing-selection'
        | 'missing-active-layer'
        | 'selection-layer-mismatch'
        | 'selection-mask-layer-mismatch'
        | 'history-restored-keyboard-delete'
        | 'keyboard-full-content-clear-blocked'
        | 'unknown-delete-source'
        | 'missing-canonical-paint'
        | 'invalid-bounds';
      clearSelection: boolean;
      details: Record<string, unknown>;
    };
```

## Phase 1. Extract Authorization Module

Create `src/stores/helpers/selectionDeleteAuthorization.ts`.

Responsibilities:

- Read only the inputs needed for policy: active layer, selection bounds, selection provenance, delete source, mask metadata, and optional CC paint summary.
- Return an authorization result without mutating store state.
- Emit no store updates.
- Expose small helpers for tests.

Initial policy:

- Reject if no selection or active layer.
- Reject unknown delete sources. Callers must choose one of the closed `SelectionDeleteSource` values so policy cannot be bypassed by arbitrary source strings.
- Reject if selection provenance has `activeLayerId` and it differs from active layer.
- Reject if `selectionMaskLayerId` exists and differs from active layer.
- Reject CC keyboard delete from history-restored selections.
- Reject CC keyboard delete if a normal set-bounds or mask selection would clear all CC paint.
- Allow explicit select-all on the same active layer.
- Allow direct same-layer marquee deletes that leave some CC paint.
- Allow same-layer non-CC deletes only after the same ownership checks pass.

The full-content CC check must happen before mutation. Add a pure helper that reads canonical CC paint plus the proposed bounds/mask and returns:

```ts
interface ColorCycleSelectionPaintSummary {
  paintWidth: number;
  paintHeight: number;
  totalNonZeroPaint: number;
  selectedNonZeroPaint: number;
  wouldClearAllPaint: boolean;
}
```

Use that summary in authorization. Do not rely on `mutateColorCycleLayer` to simulate and then reject a destructive mutation.

Implementation steps:

1. Add `SelectionDeleteSource`, `SelectionOwnerKind`, `SelectionDeleteRequest`, `SelectionDeleteAuthorization`, and `ColorCycleSelectionPaintSummary` types in `src/stores/helpers/selectionDeleteAuthorization.ts`.
2. Add `normalizeSelectionDeleteSource(source: string): SelectionDeleteSource | null`; return `null` for unknown strings.
3. Add `resolveSelectionDeleteBounds(start, end): Rectangle | null`; normalize and reject zero/negative/non-finite bounds.
4. Add `summarizeColorCycleSelectionPaint(...)`:
   - accept canonical paint buffer, paint width/height, selection bounds, optional selection mask, and optional mask bounds,
   - count all nonzero paint pixels,
   - count selected nonzero paint pixels inside the bounded/masked region,
   - return `wouldClearAllPaint` only when total nonzero paint is greater than zero and selected nonzero paint equals total nonzero paint.
5. Add `authorizeSelectionDelete(request)`:
   - validate source, active layer, project, bounds, provenance ownership, and mask ownership first,
   - for CC layers, validate canonical paint availability before destructive authorization,
   - for CC keyboard deletes, block history-restored selections and normal full-content clears,
   - return the accepted payload needed by `deleteSelectedPixels` without reading the store directly.
6. Unit test the helper in isolation before wiring it into the store.

## Phase 2. Add Explicit Selection Provenance

Extend `SelectionActionProvenance`:

```ts
interface SelectionActionProvenance {
  action: 'set-bounds' | 'select-all' | 'delete-selected';
  source: string;
  ownerKind: SelectionOwnerKind;
  restoredFromHistory?: boolean;
  t: number;
  activeLayerId?: string | null;
  maskLayerId?: string | null;
  bounds?: Rectangle | null;
}
```

Set provenance at source:

- marquee start/preview/final -> `direct-marquee`
- selection handles -> `selection-handle`
- history delta apply -> `history-restored`, `restoredFromHistory: true`
- select all -> `select-all`
- mask/freehand/magic-wand selections -> `mask-selection`, with `maskLayerId`
- direct API setSelectionBounds with no source -> `unknown`

History restore must not derive fresh ownership from the current active layer. Current selection history stores only `start/end`; extend the selection snapshot/delta path or add a dedicated restore method so replayed selection bounds are marked `history-restored` and retain any known original owner metadata. If original owner metadata is unavailable, restore with `ownerKind: 'history-restored'`, `restoredFromHistory: true`, and `activeLayerId: null`.

Implementation steps:

1. Extend `SelectionActionProvenance` in `src/stores/slices/selectionSlice.ts` with `ownerKind`, `restoredFromHistory`, and `maskLayerId`.
2. Replace source-string inference with explicit provenance assignment at each creation path:
   - `setSelectionBounds(..., 'selection-marquee-start' | 'selection-marquee-preview' | 'selection-marquee-final')` -> `direct-marquee`,
   - `setSelectionBounds(..., 'selection-handle')` -> `selection-handle`,
   - `selectAllActiveLayerPixels(...)` -> `select-all`,
   - `appendSelectionMask(...)` and freehand/magic-wand mask commits -> `mask-selection`,
   - legacy/unclassified calls -> `unknown`.
3. Ensure `appendSelectionBounds` and `appendSelectionMask` update provenance when they create or merge selection state; merged selections should preserve same-layer ownership only when all merged inputs belong to the same active layer.
4. Extend `SelectionSnapshot` in `src/history/selectionState.ts` or create a companion metadata snapshot that can carry provenance through history deltas.
5. Update `createSelectionDelta` / `SelectionBoundsDelta.apply` so history replay calls a restore-specific method or passes explicit history provenance instead of calling `setSelectionBounds` as a fresh active-layer selection.
6. Add focused tests proving:
   - direct marquee records `direct-marquee` and active layer id,
   - handle edits record `selection-handle` and active layer id,
   - select-all records `select-all` and active layer id,
   - mask selection records `mask-selection` and mask layer id,
   - history replay records `history-restored` and does not overwrite ownership with the current active layer.

## Phase 3. Route Delete Through Authorization

Refactor `deleteSelectedPixels`:

1. Build `SelectionDeleteRequest`.
2. Call `authorizeSelectionDelete`.
3. If rejected:
   - log one structured audit event,
   - clear selection only when the authorization result says `clearSelection: true`,
   - return without touching layer buffers.
4. If accepted:
   - call the existing layer-specific mutation branch.

Move the current CC policy checks from low-level mutation into this authorization layer once tests prove parity.

Initial cleanup behavior:

- `selection-layer-mismatch`: `clearSelection: true`
- `selection-mask-layer-mismatch`: `clearSelection: true`
- `history-restored-keyboard-delete`: `clearSelection: false`
- `keyboard-full-content-clear-blocked`: `clearSelection: false`
- `unknown-delete-source`: `clearSelection: false`
- `missing-canonical-paint`: `clearSelection: false`
- `invalid-bounds`: `clearSelection: true`
- `missing-selection` / `missing-active-layer`: `clearSelection: false`

Implementation steps:

1. In `deleteSelectedPixels`, build a `SelectionDeleteRequest` immediately after reading store state and before cloning images, capturing CC brush state, building sequential masks, or touching any layer buffer.
2. Include in the request:
   - raw source string,
   - active layer and active layer id,
   - project,
   - selection start/end,
   - selection mask and mask bounds,
   - `selectionMaskLayerId`,
   - `selectionLastAction`,
   - canonical CC paint snapshot data when the active layer is CC.
3. Call `authorizeSelectionDelete(request)`.
4. On rejection:
   - emit `selection-delete-authorization-blocked` once,
   - include the authorization `reason`, `clearSelection`, active layer summary, selection provenance, mask metadata, and CC paint summary when present,
   - call `clearSelection()` only when `clearSelection` is true,
   - return before any raster, sequential, erase-mask, CC brush, or history mutation.
5. On success:
   - use the authorized `bounds`, `source`, `layerId`, `layerType`, and `allowFullContentClear` values for the existing branch code,
   - keep the existing raster, sequential, and CC mutation implementations initially,
   - preserve existing history commits and recomposition invalidation behavior.
6. Keep existing stop-loss guards during the first wiring pass:
   - `selection-delete-skipped-layer-mismatch`,
   - `color-cycle-keyboard-delete-full-content-blocked`,
   - `color-cycle-selection-clear-skipped-missing-canonical-paint`.
7. After helper tests and store integration tests pass, remove duplicate ownership/full-clear policy from `deleteSelectedPixels` and leave only request building, authorization, and branch dispatch there.

## Phase 4. Audit Events

Keep the new trace events:

- `selection-bounds-set`
- `keyboard-delete-keydown`
- `selection-delete-skipped-layer-mismatch`
- `color-cycle-keyboard-delete-full-content-blocked`
- `color-cycle-selection-clear-skipped-missing-canonical-paint`

Add one canonical authorization event:

- `selection-delete-authorization-blocked`

Fields:

- timestamp,
- source,
- active layer id/name/type,
- selection owner layer id,
- selection owner kind,
- restoredFromHistory,
- selection bounds,
- mask bounds,
- mask layer id,
- reason,
- CC paint summary when relevant.

Implementation steps:

1. Add a small `logSelectionDeleteAuthorizationBlocked(...)` helper near the authorization module or in the selection slice if it needs store-only logging dependencies.
2. Preserve existing event names while migrating so old diagnostic searches still work during the refactor.
3. Add the new canonical event on every rejected authorization result.
4. For CC layers, include `before: summarizeColorCycleLayer(activeLayer)` and matching `after` summary with no mutation.
5. For non-CC layers in development, use `debugWarn` only for local developer visibility; do not add noisy production console output.
6. Once duplicate low-level policy is removed, keep low-level CC logs only for invariant failures that should be impossible after authorization.

## Phase 5. Tests

Add targeted tests for authorization:

- same-layer raster marquee delete still works,
- same-layer sequential delete still works,
- same-layer CC partial marquee keyboard delete works,
- same-layer CC explicit select-all delete works,
- cross-layer marquee selection cannot delete CC,
- cross-layer select-all cannot delete any active layer,
- cross-layer mask selection cannot delete any active layer,
- history-restored selection cannot keyboard-delete CC,
- history-restored selection remains `history-restored` even if the active layer at replay time matches the target layer,
- keyboard delete cannot clear all CC paint from normal set-bounds selection,
- keyboard delete cannot clear all CC paint from normal mask selection,
- missing CC canonical paint blocks delete,
- non-keyboard explicit destructive source behavior is documented and tested.

Implementation steps:

1. Add pure authorization tests in `src/stores/helpers/__tests__/selectionDeleteAuthorization.test.ts`.
2. Add or update store integration tests in `src/stores/__tests__/selectionFramebufferDelete.test.ts` for raster, sequential, and CC delete behavior.
3. Replace the old masked cross-layer characterization in `src/stores/__tests__/selectionClipping.test.ts`; cross-layer mask ownership should now block deletes instead of allowing them.
4. Add history replay coverage in the history integration tests:
   - create selection on one layer,
   - switch active layer,
   - replay history selection delta,
   - verify provenance is `history-restored`,
   - verify CC keyboard delete is blocked.
5. Add a test where same-layer explicit select-all can clear all CC paint, proving the full-clear block only applies to normal keyboard selections.
6. Add a test where a normal same-layer CC marquee delete clears only part of canonical paint and updates CC history as before.
7. Run targeted tests after each phase that changes behavior, then run full `npm run type-check`, `npm run lint`, and `npm test` before considering the refactor complete.

## Phase 6. Remove Scattered Policy

After authorization tests pass:

- keep low-level CC canonical paint guard as a final invariant,
- remove duplicate full-content-clear policy from `colorCycleSelection.ts`,
- keep mutation logging there only for impossible/invariant failures,
- ensure `deleteSelectedPixels` is the only selection delete entrypoint.
- update or replace old characterization tests that allowed masked deletes across layers; cross-layer selection ownership is no longer valid delete authority.

Implementation steps:

1. Remove the local layer-mismatch policy block from `deleteSelectedPixels` after authorization owns that decision.
2. Remove `isKeyboardSetBoundsFullContentClear` from `src/stores/helpers/colorCycleSelection.ts` after the pre-mutation authorization tests cover full-clear blocking.
3. Keep the missing canonical paint guard in `colorCycleSelection.ts` as a final invariant, but change its log wording if needed so it no longer reads as normal user-intent policy.
4. Search for all calls to `deleteSelectedPixels`, `clearColorCycleRegion`, and selection deletion helpers to confirm there is no second destructive selection-delete entrypoint.
5. Search for remaining references to old policy events and decide whether each is:
   - preserved compatibility logging,
   - migrated to `selection-delete-authorization-blocked`,
   - or removed as duplicate policy.
6. Re-run the targeted authorization, selection delete, history, and CC helper tests after cleanup.

## Definition Of Done

- One authorization module owns selection delete policy.
- CC mutation helpers no longer infer user intent from audit details.
- A selection created on one layer cannot delete another layer.
- A mask selection created on one layer cannot delete another layer.
- A history-restored selection cannot keyboard-delete CC canonical content.
- History replay cannot accidentally mint fresh same-layer selection ownership.
- Intentional same-layer deletes still work.
- Existing diagnostics still produce a timestamped chain from selection creation to keydown to authorization to mutation/block.
- Tests cover raster, sequential, and color-cycle behavior.
- `npm run type-check`, `npm run lint`, and targeted tests pass.

## Follow-Up

- `src/hooks/canvas/handlers/selectionHandlers.ts` remains above the orchestration hard budget at 746 LOC. This refactor only threads selection provenance source strings through existing calls; split the handler in a separate focused refactor rather than mixing extraction into the authorization change.
