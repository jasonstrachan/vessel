# Color Cycle Restore: Single Source of Truth Plan

Status: V1 implementation complete; V2 architecture correction required before this is considered stable

Date: 2026-04-27

## Goal

Fix restored/old color-cycle layers by removing competing authorities. A loaded CC layer must have one document truth, one runtime materialization path, and one presentation resolver.

The target contract:

```text
canonical CC document state -> runtime brush/materialized surface -> compositor presentation
```

`canvas`, `canvasImageData`, animator state, and brush instances are not document truth. They are derived runtime or compatibility surfaces.

## V2 Correction: Separate Legacy Repair From Runtime

The V1 implementation proved the original architecture goal is correct, but it also exposed an unhandled legacy case: old archives can have visible `canvasImageData` and gradient metadata while missing canonical `paintBuffer`.

The V1 response placed compatibility-snapshot recovery inside warm restore and Goblet fallback. That was useful for proving the missing-data path, but it is not the final architecture. It lets runtime/export paths repair document data on demand, which keeps the system fragile.

V2 rule:

```text
project load/import -> legacy CC repair -> canonical CC document state -> runtime materializer -> presentation/export
```

After import repair completes, no runtime, compositor, save, or export path may infer CC document content from `canvas`, `canvasImageData`, or sampled RGBA pixels.

### V2 Hard Boundaries

- Import/repair is the only place allowed to read `canvasImageData` as recovery input.
- `recoverCompatibilitySnapshotPaintBuffer(...)` is a legacy repair helper only.
- `materializeColorCycleLayer(...)` must only consume canonical `ColorCycleLayerDocumentState`.
- `restoreColorCycleBrushes(...)` must not repair missing `paintBuffer`.
- Goblet export must not repair missing `paintBuffer`.
- Save must not repair missing `paintBuffer`.
- Compositors must not repair, sample, or classify CC content.
- If repair cannot produce canonical paint, the layer must be marked repair-failed and remain a static compatibility preview until the user accepts data loss or a separate repair tool handles it.

### V2 Explicit Data Contract

For every loaded brush-mode CC layer, after import/repair:

```ts
type LoadedColorCycleLayerState =
  | {
      status: 'canonical-valid';
      documentState: ColorCycleLayerDocumentState & {
        paintBuffer: ArrayBuffer;
      };
    }
  | {
      status: 'static-preview-only';
      reason: 'missing-paint-buffer' | 'repair-failed' | 'dimension-mismatch';
      canvasImageData?: ImageData;
    };
```

Allowed `static-preview-only` behavior:

- display `canvasImageData` while cold
- block animation for that layer
- block Goblet animated CC export for that layer, or export it as a static raster with an explicit warning
- show a repair warning in diagnostics

Disallowed `static-preview-only` behavior:

- mark the layer `warm` or `active`
- create a fake runtime brush from all-ones paint
- silently export an animated CC layer with invented indices
- overwrite canonical buffers with RGBA-derived data outside import repair

### V2 Implementation Phases

Master checklist:

- [x] V2.1 Legacy repair module added and tested.
- [x] V2.2 Legacy repair runs during project import only.
- [x] V2.3 Runtime materialization no longer performs repair.
- [x] V2.4 Goblet export no longer performs repair.
- [x] V2.5 Save writes repair results, not repair logic.
- [x] V2.6 Temporary V1 repair fallbacks deleted.
- [ ] V2.7 Runtime/presentation boundary cleanup after missing-paint review.
- [ ] V2 final validation: type-check, lint, full tests, and manual old-project restore/export pass.
  - [x] Automated validation: `npm run type-check`, `npm run lint`, `npm test`.
  - [ ] Browser/manual old-project restore/export pass.

#### Phase V2.1: Add Legacy Repair Module

Status: complete

Add:

```text
src/lib/colorCycle/legacyRepair.ts
src/lib/colorCycle/__tests__/legacyRepair.test.ts
```

API:

```ts
type ColorCycleLegacyRepairResult =
  | {
      ok: true;
      repaired: boolean;
      state: ColorCycleLayerDocumentState & { paintBuffer: ArrayBuffer };
      repairNotes: string[];
    }
  | {
      ok: false;
      reason:
        | 'not-color-cycle'
        | 'dimension-mismatch'
        | 'missing-paint-buffer'
        | 'missing-gradient-bindings'
        | 'empty-compatibility-snapshot'
        | 'unsupported-legacy-shape';
      preview?: ImageData;
    };

repairLegacyColorCycleLayer(layer: Layer): ColorCycleLegacyRepairResult;
```

Rules:

- [x] First call `normalizeColorCycleLayerDocumentState(...)`.
- [x] If canonical `paintBuffer` exists and dimensions match, return `ok: true, repaired: false`.
- [x] If `paintBuffer` is missing, repair may use `canvasImageData` only during this function.
- [x] Recovery must derive distinct paint indices from compatibility snapshot RGB via nearest CC palette index.
- [x] Recovery must preserve gradient slot and def-id buffers if present.
- [x] Recovery must not fabricate gradient bindings from RGBA alone.
- [x] Recovery must fail if snapshot dimensions do not match canonical dimensions.
- [x] Recovery must fail if snapshot has no visible alpha.
- [x] The result must not include `canvas`, `colorCycleBrush`, or animator objects.

Tests:

- [x] Existing canonical paint passes through unchanged.
- [x] Missing paint plus black/white dither snapshot recovers distinct indices, e.g. `[1, 0, 255, 0]`.
- [x] Missing paint plus empty snapshot returns `empty-compatibility-snapshot`.
- [x] Missing paint plus missing gradient bindings returns `missing-gradient-bindings`.
- [x] Dimension mismatch returns `dimension-mismatch`.
- [x] No test reads or writes runtime canvas.

Exit criteria:

- [x] All RGBA-to-index recovery code lives in `legacyRepair.ts` or a repair-only helper imported by it.
- [x] `compatibilitySnapshotRecovery.ts` is either moved under legacy repair ownership or renamed to make repair-only ownership explicit.

#### Phase V2.2: Run Repair During Project Import Only

Status: complete

Files:

```text
src/utils/projectIO.ts
src/stores/helpers/projectLifecycle.ts
src/types/index.ts
```

Steps:

- [x] After deserialize/hydrate refs, run `repairLegacyColorCycleLayer(...)` for every brush-mode CC layer before lazy restore decisions.
- [x] If repair succeeds, write the repaired canonical buffers back into `colorCycleData.brushState` / canonical document fields before `restoreColorCycleBrushes(...)`.
- [x] If repair fails, set explicit metadata:

```ts
colorCycleData.runtimeHydrationState = 'cold';
colorCycleData.deferredRuntimeRestore = false;
colorCycleData.repairStatus = {
  ok: false,
  reason,
};
```

- [x] Failed repair layers may keep `canvasImageData` for static preview.
- [x] Failed repair layers must not be passed to active/warm runtime restore.
- [x] Project import must collect repair notes/warnings for diagnostics.

Tests:

- [x] Deserializing an old missing-paint layer repairs it before `restoreColorCycleBrushes(...)`.
- [x] Selecting a repaired layer does not run any RGB recovery.
- [x] Selecting a repair-failed layer does not mark it `active`.
- [x] Repair notes survive through project import diagnostics.

Exit criteria:

- [x] After project import, every brush-mode CC layer is either canonical-valid or repair-failed.
- [x] Lazy restore only receives canonical-valid CC layers.

#### Phase V2.3: Remove Runtime Repair From Materialization

Status: complete

Files:

```text
src/utils/projectIO.ts
src/lib/colorCycle/materializeColorCycleLayer.ts
src/stores/layers/createLayersSlice.ts
```

Steps:

- [x] Remove compatibility-snapshot recovery from `restoreColorCycleLayerRuntimeForMaterialization(...)`.
- [x] `snapshots-prepared` must never report `recoveredPaintFromCompatibilitySnapshot` during layer selection.
- [x] If `ColorCycleLayerDocumentState.paintBuffer` is missing, materializer returns `{ ok: false, reason: 'missing-paint-buffer' }`.
- [x] `ensureColorCycleLayerRuntime(...)` must preserve repair-failed static preview and return `false`.
- [x] Active layer selection must not downgrade or invent canonical state.

Tests:

- [x] Materializer fails missing paint without reading `canvasImageData`.
- [x] `ensureColorCycleLayerRuntime(...)` returns `false` for repair-failed layers.
- [x] Selecting a canonical-valid repaired layer materializes from repaired canonical buffers.
- [x] Debug log for selection contains no `recoveredPaintFromCompatibilitySnapshot`.

Exit criteria:

- [x] Runtime restore is a pure document-state-to-brush bridge.
- [x] Layer selection cannot mutate canonical CC data.

#### Phase V2.4: Remove Export Repair Fallback

Status: complete

Files:

```text
src/utils/export/goblet/gobletColorCycleSerializer.ts
src/utils/export/__tests__/webglExporter.helpers.test.ts
```

Steps:

- [x] Remove `extractBrushStateFromCompatibilitySnapshotAlpha(...)` or any equivalent export-time RGBA recovery.
- [x] Goblet brush-mode export reads only live brush state or canonical `ColorCycleLayerDocumentState`.
- [x] If a CC layer is repair-failed/static-preview-only, export must either:
  - [x] emit a static raster layer with a warning, or
  - [x] omit animated CC data with a warning.
- [x] Do not silently invent animated CC indices during export.

Tests:

- [x] Canonical-valid repaired layer exports brush indices.
- [x] Repair-failed layer does not export animated CC brush data.
- [x] Export warning identifies the layer id and repair failure reason.

Exit criteria:

- [x] Goblet export has no dependency on `canvasImageData` for animated CC data.

#### Phase V2.5: Save Repair Results, Not Repair Logic

Status: complete

Files:

```text
src/utils/projectIO.ts
src/lib/colorCycle/documentState.ts
src/utils/__tests__/projectIO.test.ts
```

Steps:

- [x] Saving a repaired layer writes canonical `paintBuffer`, gradient buffers, speed/flow/phase buffers, and palettes.
- [x] Reopening the saved file must not need legacy repair again.
- [x] Saving a repair-failed layer keeps static preview and repair metadata, but does not create fake canonical paint.
- [x] Compatibility `canvasImageData` is regenerated after canonical serialization for valid layers.

Tests:

- [x] Old missing-paint file -> import repair -> save -> reopen gives `repaired: false` because canonical paint now exists.
- [x] Repair-failed file -> save -> reopen remains repair-failed with same reason.
- [x] Saved canonical layer has no dual authority from stale runtime canvas.

Exit criteria:

- [x] Legacy recovery is one-way and disappears after a successful save/reopen.

#### Phase V2.6: Delete Temporary V1 Fallbacks

Status: complete

Remove or rewrite:

- [x] Runtime restore compatibility recovery in `src/utils/projectIO.ts`.
- [x] Goblet compatibility recovery in `src/utils/export/goblet/gobletColorCycleSerializer.ts`.
- [x] Any debug field named `recoveredPaintFromCompatibilitySnapshot` outside import repair logs.
- [x] Any tests that approve repair during selection or export fallback.

Add grep gate:

```bash
rg "recoveredPaintFromCompatibilitySnapshot|extractBrushStateFromCompatibilitySnapshot|recoverCompatibilitySnapshotPaintBuffer" src
```

Allowed matches after cleanup:

- `src/lib/colorCycle/legacyRepair.ts`
- `src/lib/colorCycle/__tests__/legacyRepair.test.ts`
- import/project-load diagnostics only

Exit criteria:

- [x] The grep gate has only allowed matches.
- [x] Manual selection logs no repair activity.
- [x] Manual Goblet export logs no repair activity.

#### Phase V2.7: Runtime/Presentation Boundary Cleanup After Missing-Paint Review

Status: pending

Why this exists:

The post-V2.5 review and live logs showed one remaining architectural hazard: a restored layer could be visible through a compatibility snapshot, but runtime restore could still promote it to `warm` or `active` even when the prepared CC snapshot had `paintBuffer: null`. That does not repair data; it only lets runtime pretend a static legacy preview is playable.

Boundary rule:

```text
static compatibility visibility does not imply playable CC runtime
```

Required cleanup:

- [x] Keep the missing-`paintBuffer` runtime guard narrow and explicit: runtime restore must return no brush and must not promote the layer when canonical paint is absent.
- [x] Ensure `ensureColorCycleLayerRuntime(...)` and deferred restore handoff preserve `cold` state when restore returns no brush.
- [x] Persist repair failure metadata for missing canonical paint so save/reopen does not retry ambiguous runtime repair.
- [x] Audit every remaining `canvasImageData` read and classify it as either import-repair input or presentation-only static preview.
- [ ] Remove or isolate temporary debug instrumentation once this path is manually validated.
- [x] Add or keep a fixture for the exact old-file state: visible compatibility snapshot, archive refs hydrated, missing `paintBuffer`, and no active playback promotion.
- [x] Make diagnostics distinguish:
  - `canonical-valid`
  - `repaired-on-import`
  - `static-preview-only`
  - `repair-failed`

Tests:

- [x] Deferred restore with hydrated gradient buffers but missing `paintBuffer` returns no runtime brush.
- [x] Store handoff keeps that layer `cold` instead of forcing `active` or `warm`.
- [x] Save/reopen preserves repair-failed metadata and static preview without inventing canonical paint.
- [x] Goblet/export does not emit animated CC data for this layer state.
- [x] Old lazy archive layer with visible compatibility snapshot and missing `paintBuffer` hydrates refs during import repair, writes canonical paint, and restores runtime from that canonical state.

Exit criteria:

- [x] No runtime, compositor, save, or export path treats `canvasImageData` as document authority.
- [x] A visible static legacy preview cannot be mistaken for playable CC runtime.
- [ ] Manual playback test confirms repaired canonical layers cycle, while unrecoverable static-preview-only layers stay visibly static with explicit diagnostics.

CanvasImageData audit classification:

- Import repair input:
  - `src/lib/colorCycle/legacyRepair.ts`
  - `src/utils/projectIO.ts` import repair gate around `applyLegacyColorCycleImportRepair(...)`
- Cold/static presentation:
  - `src/components/canvas/resolveColorCyclePresentation.ts`
  - compositor debug summaries in `src/components/canvas/drawingCanvasCompositeStack.ts`
  - deferred restore static-preview preservation in `src/stores/layers/createLayersSlice.ts`
- Compatibility snapshot persistence:
  - `src/utils/projectIO.ts` save/deserialize/archive hydration paths
  - `src/stores/helpers/projectLifecycle.ts` pre-save snapshot capture
  - `src/utils/backgroundStorage.ts`
- History, selection, and undo surface preservation:
  - `src/history/deltas/layerStructureDelta.ts`
  - `src/history/runtimeRehydration.ts`
  - `src/stores/helpers/historyLifecycle.ts`
  - `src/stores/helpers/colorCycleSelection.ts`
  - `src/hooks/canvas/handlers/colorCycle/colorCycleHistory.ts`
- Presentation fallback after a real runtime brush exists:
  - `src/lib/colorCycle/materializeColorCycleLayer.ts`

Audit result: no remaining export path reconstructs animated CC paint from `canvasImageData`; Goblet repair-failed/static-preview-only layers now export without animated brush data.

## Current Architecture Problem

The current code has several places that can become the effective source of truth depending on timing:

- `layer.colorCycleData.brushState` carries the current layer paint snapshot.
- `layer.colorCycleData.gradientIdBuffer` and `gradientDefIdBuffer` live separately from the paint snapshot.
- `layer.colorCycleData.canvasImageData` is a persisted compatibility snapshot.
- `layer.colorCycleData.canvas` is both a render target and a value stored in Zustand layer state.
- `colorCycleBrushManager` owns brush instances and can replace the stored canvas via `refreshLayerCCSurface`.
- The compositor draws `layer.colorCycleData.canvas` directly.

That means a layer can have valid persisted CC data while the canvas being drawn is empty, stale, or not yet materialized.

## Evidence From Current Code

### Load makes most heavy CC layers cold

`src/stores/helpers/projectLifecycle.ts` loads projects through:

```ts
restoreColorCycleBrushes(loadedProject.layers, {
  lazy: true,
  activeLayerId: loadedProject.layers[0]?.id ?? null,
});
```

`src/utils/projectIO.ts` then marks non-active heavy CC layers as `cold` and skips runtime brush restore.

This is a valid performance policy, but it means a cold layer can only display a static compatibility surface until explicitly warmed.

### Deserialize creates a canvas before runtime exists

`src/utils/projectIO.ts` creates `colorCycleData.canvas` during deserialize and puts `canvasImageData` into it when available. This canvas can then be drawn before any canonical buffers are materialized into a brush.

### Presentation bypasses restore authority

`src/components/canvas/drawingCanvasCompositeStack.ts`, `src/components/canvas/useDrawingCanvasLayerRendering.ts`, and `src/components/canvas/useDrawingCanvasCompositeBuffers.ts` draw `layer.colorCycleData.canvas` directly.

They do not ask a single CC presentation resolver whether the layer is cold, warm, active, needs hydration, or has a valid materialized surface.

### Runtime surface can overwrite layer state

Both `src/hooks/brushEngine/colorCycleSurface.ts` and `src/hooks/canvas/handlers/colorCycle/colorCycleSurface.ts` have `refreshLayerCCSurface(...)` helpers that compare `brush.getCanvas()` with `layer.colorCycleData.canvas` and update the layer with the brush canvas.

This makes a renderer-owned surface part of layer state, which is the opposite of the documented rule that renderer/animator state is not authoritative.

### Restore does not own final presentation

`restoreColorCycleBrushes()` restores brush state and applies layer snapshots, but visible presentation is later delegated to playback sync, segment refresh, compositor draw, or `renderDirectToCanvas` calls in various features.

There is no one required postcondition like:

```text
after warm restore, this layer has a valid runtime brush and a valid materialized surface rendered from canonical CC state
```

## Source Of Truth Decision

The only document truth for brush-mode CC content should be:

- paint/index buffer
- gradient slot buffer
- gradient def-id buffer
- speed buffer
- flow buffer
- phase buffer
- gradient defs / slot palettes / def store
- per-layer playback metadata such as base speed and flow mode
- dither/stamp settings needed to continue authoring

These buffers and metadata should be represented as one canonical layer document state in memory, even if archive serialization stores them in separate binary refs.

Everything else is derived:

- `canvasImageData`: compatibility preview/snapshot only
- `canvas`: runtime/materialized surface only
- `colorCycleBrush`: runtime only
- animator/index internals: runtime only
- brush manager registry: runtime cache only

## Target Architecture

This is the final architecture. Do not land it as one broad patch. The first patch should only introduce the presentation/materialization seam needed to fix restored-layer display without changing save/export semantics.

### 1. Introduce a CC document-state boundary

Add a small boundary module, for example:

```text
src/lib/colorCycle/documentState.ts
```

Responsibilities:

- normalize legacy `brushState`, `state.paintRef`, top-level gradient buffers, and old snapshots into one `ColorCycleLayerDocumentState`
- be the only code allowed to interpret persisted CC layer data
- expose buffer presence/content helpers
- serialize from the canonical document state
- reject accidental runtime surface inputs as canonical truth

This should be pure and testable.

### 2. Introduce a CC runtime materializer

Add one runtime seam, for example:

```text
src/lib/colorCycle/materializeColorCycleLayer.ts
```

Responsibilities:

- build or update `ColorCycleBrushCanvas2D` from canonical document state
- bind canonical buffers into the brush/animator
- render one materialized surface from canonical state
- return an explicit result:

```ts
type CcRuntimeMaterialization =
  | { state: 'cold'; snapshotCanvas?: HTMLCanvasElement }
  | { state: 'warm'; brush: ColorCycleBrushCanvas2D; surface: HTMLCanvasElement }
  | { state: 'active'; brush: ColorCycleBrushCanvas2D; surface: HTMLCanvasElement };
```

The materializer owns the bridge from document data to runtime canvas. Compositors and stores should not reproduce that logic.

The materializer must not infer document content from the current canvas. It may render to a canvas, return a canvas, or replace a runtime canvas, but it cannot treat existing pixels as source data.

### 3. Introduce a presentation resolver

Add one display resolver, for example:

```text
src/components/canvas/resolveColorCyclePresentation.ts
```

Responsibilities:

- decide what a CC layer may draw right now
- distinguish static compatibility snapshot from animated runtime surface
- block direct compositor access to raw `colorCycleData.canvas`
- make active-layer presentation rules explicit

The compositor should draw the resolver result, not `layer.colorCycleData.canvas` directly.

### 4. Make hydration states enforce promises

The current `cold | warm | active` flags should become behavioral contracts:

- `cold`: document state is loaded; no live brush required; may show static compatibility snapshot only
- `warm`: live brush exists and a surface has been materialized from canonical buffers
- `active`: warm plus selected/interactive presentation is ready synchronously

Selecting a cold CC layer should not first publish `activeLayerId` and then eventually make the layer drawable. It should use one explicit warm-up action:

```ts
ensureColorCycleLayerRuntime(layerId, { target: 'active' })
```

That action should return only after active presentation is ready, or surface a structured failure.

### 5. Remove direct runtime surface ownership from layer state

Long term, `LayerColorCycleData` should not store mutable renderer-owned canvases as normal layer data.

Do not remove it immediately. First formally deprecate it:

```ts
/**
 * Deprecated runtime compatibility surface.
 * Not document truth.
 * Do not read directly from compositor/save/export paths.
 */
canvas?: HTMLCanvasElement;
```

Interim rule:

- only the materializer can write/update the runtime surface reference
- all direct `colorCycleData.canvas` reads in compositor paths must go through the presentation resolver
- `canvasImageData` cannot overwrite canonical buffers or decide animation authority

### 6. Save from canonical state only

Before save, flush dirty live runtime into canonical CC document state through one function:

```ts
flushColorCycleRuntimeToDocumentState(layerId)
```

Then serialize from canonical state.

Save should not choose between live canvas pixels, stale `canvasImageData`, or brush snapshots as competing truths. Canvas pixels are only a compatibility snapshot derived after canonical state is already correct.

## Detailed Build Plan

Build this in small patches. Each patch must leave the app shippable, keep the orchestration files under their size budgets, and add targeted tests before moving on.

### Patch Boundaries

The work should land as separate commits in this order:

1. `test: lock cc restore presentation repro`
   - no production behavior changes
   - adds the failing unit/integration coverage or fixture helpers
2. `fix: route cc presentation through resolver`
   - compositor-only behavior change
   - no save/export changes
3. `refactor: extract cc runtime materialization`
   - moves restore logic behind one seam
   - preserves existing restore output
4. `fix: ensure cold cc layers warm before active presentation`
   - store/action behavior change
   - selection/playback paths call the materializer
5. `refactor: add cc document state boundary`
   - pure normalization helpers
   - materializer consumes normalized document state
6. `refactor: centralize cc runtime surface ownership`
   - duplicate surface refresh helpers collapse into one owner
   - compositor remains resolver-only
7. `fix: serialize cc from canonical document state`
   - save/autosave/export behavior change
   - compatibility snapshots derived last

Do not combine patch 2 and patch 7. Presentation bugs must be fixed without changing persistence first, so any remaining save/export bug is visible instead of hidden by broad rewrites.

### Dependency Map

```text
Phase 0 repro lock
  -> Phase 1 presentation resolver
    -> Phase 2 materializer boundary
      -> Phase 3 explicit ensure action
        -> Phase 4 document state boundary
          -> Phase 5 surface ownership cleanup
            -> Phase 6 canonical save/export
              -> Phase 7 end-to-end validation
```

Hard dependencies:

- Phase 1 must land before any further compositor edits.
- Phase 2 must land before any store action claims `warm` or `active` means materialized.
- Phase 4 must land before Phase 6 so save/export can read the same state shape as restore.
- Phase 5 can start after Phase 2, but should not remove compatibility wrappers until Phase 3 call sites are stable.

### Build Ticket Checklist

Use this as the working checklist when implementing.

- [x] Ticket A: Create a failing restored-CC presentation test or fixture.
- [x] Ticket B: Add `resolveColorCyclePresentation(...)` and resolver unit tests.
- [x] Ticket C: Route `drawingCanvasCompositeStack.ts` through the resolver.
- [x] Ticket D: Route `useDrawingCanvasLayerRendering.ts` through the resolver.
- [x] Ticket E: Route `useDrawingCanvasCompositeBuffers.ts` through the resolver.
- [x] Ticket F: Extract `materializeColorCycleLayer(...)` from warm restore logic.
- [x] Ticket G: Make `restoreColorCycleBrushes()` delegate per-layer warm/active restore to the materializer.
- [x] Ticket H: Add `ensureColorCycleLayerRuntime(...)` and wire cold-layer selection.
- [x] Ticket I: Add `documentState.ts` normalization helpers and tests.
- [x] Ticket J: Move materializer inputs to `ColorCycleLayerDocumentState`.
- [x] Ticket K: Deprecate direct `LayerColorCycleData.canvas` ownership and consolidate refresh helpers.
- [x] Ticket L: Flush runtime to canonical document state before save/autosave/crash recovery.
- [x] Ticket M: Route Goblet export through canonical CC buffers.
- [ ] Ticket N: Run full automated and browser validation.

### File Ownership Plan

Expected new files:

- `src/components/canvas/resolveColorCyclePresentation.ts`
- `src/components/canvas/__tests__/resolveColorCyclePresentation.test.ts`
- `src/lib/colorCycle/materializeColorCycleLayer.ts`
- `src/lib/colorCycle/__tests__/materializeColorCycleLayer.test.ts`
- `src/lib/colorCycle/documentState.ts`
- `src/lib/colorCycle/__tests__/documentState.test.ts`

Expected edited files:

- `src/utils/projectIO.ts`
  - delegate warm restore to materializer
  - hydrate lazy refs before materialization
  - serialize from document state in the final persistence phase
- `src/stores/helpers/projectLifecycle.ts`
  - keep lazy load policy
  - call explicit runtime ensure only when active presentation is required
- `src/stores/slices/colorCycleSlice.ts`
  - likely home for `ensureColorCycleLayerRuntime(...)`
  - keep action imperative and testable
- `src/components/canvas/drawingCanvasCompositeStack.ts`
  - remove direct CC canvas reads
  - draw only resolver output
- `src/components/canvas/useDrawingCanvasLayerRendering.ts`
  - remove direct recolor/CC canvas draw bypass where it conflicts with resolver authority
- `src/components/canvas/useDrawingCanvasCompositeBuffers.ts`
  - route under/over buffer CC drawing through resolver
- `src/hooks/brushEngine/colorCycleSurface.ts`
  - reduce to compatibility wrapper or materializer-owned helper
- `src/hooks/canvas/handlers/colorCycle/colorCycleSurface.ts`
  - remove duplicate ownership or delegate to shared helper
- `src/stores/slices/colorAdjustSlice.ts`
  - update surface refresh call sites after helper consolidation
- Goblet export files found by `rg "Goblet|goblet|export" src`
  - update only after canonical save path is covered

Do not expand these orchestration shells with new logic:

- `src/hooks/useDrawingHandlers.ts`
- `src/components/canvas/DrawingCanvas.tsx`
- `src/hooks/canvas/useCanvasEventHandlers.ts`

### Failure Handling Rules

- If a patch does not fix its target behavior, revert that patch before trying the next approach.
- If Phase 1 cannot fix presentation without materialization, keep the resolver patch but mark the failing case as `none` or `compatibility-snapshot`; do not add ad hoc compositor hydration.
- If materialization fails for sparse/off-center CC content, inspect canonical buffers and dimensions. Do not add alpha-sampling as an authority check.
- If save/reopen still drops data after Phase 6, inspect flush order and canonical buffer serialization before changing Goblet or compositor code.
- Temporary diagnostics must be gated before any synchronous canvas readback or breadcrumb persistence, especially on RAF and pointer-frame paths.

### Validation Matrix

| Scenario | Expected result | Covered by |
| --- | --- | --- |
| Cold restored heavy CC layer with `canvasImageData` | Static compatibility snapshot can draw, but layer remains cold | Phase 1 tests |
| Cold restored heavy CC layer without `canvasImageData` | Canonical buffers remain intact; selection can warm it | Phase 2/3 tests |
| Warm restored CC layer with stale empty canvas | Materializer renders from canonical buffers | Phase 2 tests |
| Active restored CC layer | Runtime brush and surface exist before active presentation is used | Phase 3 tests |
| Sparse/off-center CC content | Not treated as empty by pixel probe | Phase 1/2 tests |
| Save after restore | Canonical buffers serialized before compatibility snapshot | Phase 6 tests |
| Autosave/crash recovery | Same flush/serialize path as manual save | Phase 6 tests |
| Goblet export | Receives canonical brush-mode buffers and matches app playback | Phase 6/7 tests |

### Phase 0: Baseline And Repro Lock

Status: completed

Implementation note 2026-04-27:

- Added a restored cold-layer compositor test that draws from `canvasImageData` and rejects stale runtime `canvas` authority.
- Added resolver unit coverage for cold snapshots, cold runtime-canvas rejection, warm/active runtime surfaces, hidden/non-CC/missing layers, legacy no-hydration layers, and sparse off-center content.
- Stabilized existing sequential compositor tests by explicitly setting the sequential frame cursor when playback/capture mode expects runtime-cursor frames.

Purpose: prove the current failure mode and protect against fixing the wrong path.

Steps:

1. [x] Capture the exact restored-layer scenario that fails:
   - old/heavy CC layer loaded through `src/stores/helpers/projectLifecycle.ts`
   - non-active layer deferred by `restoreColorCycleBrushes(..., { lazy: true })`
   - later selected or composited while its runtime is still `cold`
2. [x] Record which surface is visible at each step:
   - canonical buffers present or missing
   - `canvasImageData` present or missing
   - `colorCycleData.canvas` present, empty, stale, or populated
   - `colorCycleData.colorCycleBrush` present or missing
   - `runtimeHydrationState` value
3. [x] Add or identify a test fixture that can represent the failure without relying on visual guessing.
4. [x] Confirm whether the immediate bug is:
   - cold restore never materializes from canonical buffers
   - compositor draws stale `colorCycleData.canvas`
   - selecting a cold layer publishes active state before active runtime is ready
   - save/export reads a stale compatibility surface

Files to inspect first:

- `src/stores/helpers/projectLifecycle.ts`
- `src/utils/projectIO.ts`
- `src/components/canvas/drawingCanvasCompositeStack.ts`
- `src/components/canvas/useDrawingCanvasLayerRendering.ts`
- `src/components/canvas/useDrawingCanvasCompositeBuffers.ts`
- `src/hooks/brushEngine/colorCycleSurface.ts`
- `src/hooks/canvas/handlers/colorCycle/colorCycleSurface.ts`

Exit criteria:

- [x] The failing path is described in the doc or test name.
- [x] There is at least one automated test target for the first behavior patch.
- [x] No runtime code has changed yet except narrowly scoped diagnostics, if needed.

### Phase 1: Presentation Resolver First

Status: completed

Implementation note 2026-04-27:

- Added `src/components/canvas/resolveColorCyclePresentation.ts`.
- Routed `drawingCanvasCompositeStack.ts`, `useDrawingCanvasLayerRendering.ts`, and `useDrawingCanvasCompositeBuffers.ts` through the resolver.
- Cold CC layers can now draw only a static compatibility snapshot; warm/active or legacy no-hydration layers draw structurally valid runtime surfaces.
- `useSplitOverlay` is not an input to the resolver.
- No save/export behavior was changed in this phase.

Purpose: stop compositor paths from choosing their own CC authority.

Add:

```text
src/components/canvas/resolveColorCyclePresentation.ts
src/components/canvas/__tests__/resolveColorCyclePresentation.test.ts
```

Resolver contract:

```ts
type ColorCyclePresentationSource =
  | { kind: 'runtime-surface'; canvas: HTMLCanvasElement; reason: 'active' | 'warm' }
  | { kind: 'compatibility-snapshot'; imageData: ImageData; reason: 'cold' }
  | { kind: 'none'; reason: 'missing-layer' | 'hidden' | 'not-color-cycle' | 'missing-source' };

type ResolveColorCyclePresentationInput = {
  layer: Layer | null | undefined;
  activeLayerId: string | null;
  projectWidth: number;
  projectHeight: number;
};
```

Rules:

- Hidden, missing, or non-CC layers return `none`.
- `warm` and `active` layers may draw a runtime surface only when a structurally valid canvas exists.
- `cold` layers may draw `canvasImageData` as a static compatibility snapshot, but this never upgrades document truth.
- Empty-pixel probes must not decide authority. Sparse/off-center CC content is valid.
- The resolver may expose debug metadata, but draw callers must only need the resolved source.
- `useSplitOverlay` must not be an input. Overlay availability is implementation detail, not semantic authority.

Route these direct reads through the resolver:

- `src/components/canvas/drawingCanvasCompositeStack.ts`
- `src/components/canvas/useDrawingCanvasLayerRendering.ts`
- `src/components/canvas/useDrawingCanvasCompositeBuffers.ts`

Keep draw behavior equivalent except for the intended authority fix:

- If resolver returns `runtime-surface`, draw the canvas.
- If resolver returns `compatibility-snapshot`, draw via a transfer canvas or helper.
- If resolver returns `none`, skip with an explicit debug reason.

Tests:

- [x] `cold` + `canvasImageData` returns `compatibility-snapshot`.
- [x] `cold` + only runtime canvas does not silently become authoritative.
- [x] `warm` + valid canvas returns `runtime-surface`.
- [x] `active` + valid canvas returns `runtime-surface`.
- [x] hidden/non-CC/missing layers return `none`.
- [x] sparse content is not rejected by sampling.

Exit criteria:

- [x] All visible compositor CC reads go through `resolveColorCyclePresentation(...)`.
- [x] The old direct `layer.colorCycleData.canvas` draw path is gone from compositor code.
- [x] No save/export logic changes in this phase.

### Phase 2: Runtime Materializer Boundary

Status: V1 materializer seam introduced; V2 must move legacy recovery out of this phase

Implementation note 2026-04-27:

- Manual testing showed selected restored CC layers could briefly draw their cold compatibility snapshot, then disappear after deferred warm-up published a blank runtime surface.
- Added a narrow restore postcondition guard in `restoreColorCycleBrushes(...)`: after brush-state restore, render the brush into the layer canvas; if the restored runtime render is blank but a visible compatibility snapshot exists, keep that snapshot on the runtime canvas instead of publishing blank pixels.
- Added coverage to the deferred brush snapshot copy-safe fixture so warm restore keeps `canvasImageData` and leaves visible pixels in the runtime canvas.
- Added a store handoff guard for deferred restore activation: if the restored layer loses `canvasImageData` or publishes a blank canvas, carry the cold snapshot forward and copy it into the restored canvas before publishing the layer.
- Added store integration coverage for selected deferred CC activation preserving the snapshot through the restore handoff.
- Added `src/lib/colorCycle/materializeColorCycleLayer.ts` with `materializeColorCycleLayer(...)` and `materializeRestoredColorCycleSurface(...)`.
- `restoreColorCycleBrushes(...)` now delegates non-deferred warm/active restore through `materializeColorCycleLayer(...)`; the legacy brush-state/WebGL/fallback restore body has been moved out of the batch loop into `restoreColorCycleLayerRuntimeForMaterialization(...)`.
- Added direct materializer tests for hydration, structured failure, and blank-runtime snapshot preservation.
- Added explicit coverage that a stale empty runtime canvas materializes from persisted canonical buffers instead of staying blank.
- Added a legacy recovery path for archives whose brush snapshot has gradient metadata but no `paintBuffer`: when a visible compatibility snapshot exists, restore derives paint indices by matching snapshot RGB back to the nearest CC palette index, preserving dither patterns instead of flattening every visible pixel to one index.
- Added the same compatibility-snapshot index recovery to Goblet serialization so old missing-paint CC layers can export pixels even when no live brush has been warmed yet.
- Kept the guard that gradient IDs alone do not invent paint; V1 recovery requires a visible compatibility snapshot and derives indices from snapshot colors.
- Verified deferred archive runtime refs hydrate before warm/active materialization via the archive-backed warm-restore test.
- Follow-up cleanup may still split `restoreColorCycleLayerRuntimeForMaterialization(...)` further, but `restoreColorCycleBrushes(...)` no longer owns the warm-restore details inline.

Purpose: create one bridge from canonical CC data to a brush/runtime surface.

Add:

```text
src/lib/colorCycle/materializeColorCycleLayer.ts
src/lib/colorCycle/__tests__/materializeColorCycleLayer.test.ts
```

Initial API:

```ts
type EnsureColorCycleLayerRuntimeTarget = 'warm' | 'active';

type MaterializeColorCycleLayerResult =
  | { ok: true; state: 'warm' | 'active'; brush: ColorCycleBrushCanvas2D; surface: HTMLCanvasElement }
  | { ok: false; state: 'failed'; reason: string };
```

Responsibilities:

- [x] Hydrate lazy archive refs for the layer when needed.
- [x] Build or reuse `ColorCycleBrushCanvas2D`.
- [x] Apply persisted brush snapshots and buffer state using the existing restore logic.
- [x] Render one surface from restored runtime state.
- [x] Preserve the cold compatibility snapshot through deferred restore handoff when runtime output is blank.
- [x] Set `runtimeHydrationState` through the materializer.
- [x] Return structured failure instead of leaving the layer half-active.

Implementation notes:

- Start by extracting the warm restore body from `restoreColorCycleBrushes()` rather than rewriting it.
- Keep `restoreColorCycleBrushes()` as a batch orchestrator that delegates per-layer materialization.
- Do not infer content from `canvas` pixels.
- V1 exception only: `canvasImageData` currently supplies legacy RGB recovery when old archives have visible compatibility pixels but are missing canonical `paintBuffer`. V2 must move this out of runtime materialization and into import repair only.
- Preserve existing lazy heavy-layer behavior for non-active layers.

Files likely touched:

- `src/utils/projectIO.ts`
- `src/lib/colorCycle/materializeColorCycleLayer.ts`
- `src/hooks/brushEngine/ColorCycleBrushMigration.ts`
- `src/hooks/brushEngine/ColorCycleBrushCanvas2D.ts`

Tests:

- [x] Materializer hydrates, marks target state, and returns the restored runtime surface.
- [x] A deferred restored layer with a blank runtime render keeps visible snapshot pixels instead of disappearing.
- [x] Selected deferred CC activation carries the cold snapshot forward when the restore handoff returns a blank runtime canvas.
- [x] A layer with stale empty canvas materializes from buffers, not from the empty canvas.
- [x] A legacy brush snapshot missing `paintBuffer` recovers distinct paint indices from visible compatibility snapshot colors.
- [x] Goblet export can serialize a legacy missing-paint CC layer from compatibility snapshot colors.
- [x] Missing `paintBuffer` is not reconstructed from gradient IDs alone.
- [x] A deferred archive runtime hydrates refs before materialization.
- [x] Failed materialization returns `failed` for non-CC layers.

Exit criteria:

- [x] There is one per-layer materialization function.
- [x] `restoreColorCycleBrushes()` no longer owns all warm-restore details inline.
- [x] Presentation resolver can trust `warm`/`active` to mean a runtime surface was materialized or protected by compatibility-snapshot fallback.

### Phase 3: Explicit Runtime Ensure Action

Status: completed

Implementation note 2026-04-27:

- Added `ensureColorCycleLayerRuntime(layerId, { target })` to the layers store.
- The existing deferred restore scheduler now returns a promise and deduplicates in-flight restores per layer.
- Cold active-layer selection now requests an `active` restore instead of accidentally starting a `warm` restore through early brush lookup.
- `getLayerColorCycleBrush(...)` still schedules restore for cold layers, but now uses `active` when the requested layer is selected and `warm` otherwise.
- Active-layer brush initialization now treats `cold` / `deferredRuntimeRestore` as an in-flight restore state and does not create a fresh brush or log a false initialization failure while restore is pending.
- Added store integration coverage for the explicit ensure action and selected cold-layer activation target.
- Added initializer coverage for the cold restored active-layer guard.
- Added failed warm-up coverage: explicit ensure returns `false`, keeps the layer `cold`, and emits the `layer-activation` deferred-restore-failed warning.
- Audited project load, playback sync, and color-adjust refresh call sites. Project import still warms the first selected CC layer through `restoreColorCycleBrushes(..., { activeLayerId })`; playback sync uses manager runtime state and does not manually hydrate cold layers; color-adjust refreshes still go through store/manager helpers rather than compositor-owned canvas reads.

Purpose: make `cold -> active` a synchronous state contract from the UI/store point of view.

Add or expose:

```ts
ensureColorCycleLayerRuntime(layerId, { target: 'warm' | 'active' })
```

Likely location:

- store action in `src/stores/slices/colorCycleSlice.ts`, or
- helper under `src/stores/helpers/` if it needs access to project load internals.

Rules:

- [x] Selection of a cold CC layer must call the ensure action before the app relies on active CC presentation.
- [x] The action must not publish `runtimeHydrationState: 'active'` until the materializer returns an active runtime surface.
- [x] If warm-up fails, keep previous visible state and surface a structured warning.
- [x] Existing play/autoplay and hidden animating-layer exceptions must remain intact.

Call-site audit:

- [x] Layer selection code.
- [x] Project load post-processing in `src/stores/helpers/projectLifecycle.ts`.
- [x] Any playback sync path that starts animation for a restored layer.
- [x] Color adjust and tools that call `refreshLayerCCSurface(...)`.

Tests:

- [x] Selecting a cold restored CC layer produces active runtime before active presentation is expected.
- [x] Failed warm-up does not leave the layer marked `active`.
- [x] Active-layer restore during project load still warms the first selected CC layer.

Exit criteria:

- [x] `cold`, `warm`, and `active` are enforceable states, not labels.
- [x] No component manually hydrates cold CC runtime.

### Phase 4: Canonical Document-State Boundary

Status: V1 materializer consumes document state; V2 import repair boundary remains

Implementation note 2026-04-27:

- Added `src/lib/colorCycle/documentState.ts`.
- Added `src/lib/colorCycle/__tests__/documentState.test.ts`.
- The boundary normalizes current `brushState` snapshots, legacy top-level buffers, and legacy `state.*Ref` buffers into `ColorCycleLayerDocumentState`.
- Runtime canvas and `canvasImageData` are deliberately excluded from canonical state.
- Dimension validation rejects buffer-size mismatches with explicit reasons.
- `materializeColorCycleLayer(...)` now normalizes `ColorCycleLayerDocumentState` after runtime refs hydrate, passes that state to the restore callback, and fails before restore when canonical dimensions are invalid.

Purpose: make persisted CC data interpretation pure and testable.

Add:

```text
src/lib/colorCycle/documentState.ts
src/lib/colorCycle/__tests__/documentState.test.ts
```

Initial API:

```ts
type ColorCycleLayerDocumentState = {
  width: number;
  height: number;
  paintBuffer?: ArrayBuffer;
  gradientIdBuffer?: ArrayBuffer;
  gradientDefIdBuffer?: ArrayBuffer;
  speedBuffer?: ArrayBuffer;
  flowBuffer?: ArrayBuffer;
  phaseBuffer?: ArrayBuffer;
  slotPalettes?: LayerColorCycleData['slotPalettes'];
  gradientDefs?: LayerColorCycleData['gradientDefs'];
  gradientDefStore?: LayerColorCycleData['gradientDefStore'];
  activeGradientId?: string;
  paintSlot?: number;
  hasContent: boolean;
};
```

Responsibilities:

- [x] Normalize current `brushState`, `state.paintRef`, top-level buffers, and legacy snapshots into one in-memory shape.
- [x] Provide helpers such as `hasCanonicalColorCyclePaint(...)`, `hasGradientBindingBuffers(...)`, and `validateColorCycleDocumentStateDimensions(...)`.
- [x] Keep runtime-only values out: `canvas`, `colorCycleBrush`, animator internals, and manager instances.
- [x] Be usable by restore, save, history, and export without importing React/store modules.

Migration order:

1. [x] Add read-only normalization helpers.
2. [x] Use them inside the materializer.
3. [x] Use them inside save serialization.
4. [x] Use them inside Goblet export only after save behavior is covered.

Tests:

- [x] Current brushState snapshot normalizes.
- [x] Legacy top-level buffers normalize.
- [x] Missing optional buffers stay missing without being fabricated.
- [x] Dimension mismatch is rejected with a clear reason.
- [x] Runtime canvas cannot become canonical state.

Exit criteria:

- [x] All new restore/materialization code consumes `ColorCycleLayerDocumentState`.
- [x] Existing archive formats are preserved.

### Phase 5: Surface Ownership Cleanup

Status: deprecation and shared refresh owner added; persistence/export cleanup remains

Implementation note 2026-04-27:

- Added the deprecation comment to `LayerColorCycleData.canvas`.
- Added `resolveColorCycleRuntimeSurface(...)` under the materializer boundary.
- Both `refreshLayerCCSurface(...)` wrappers now delegate to the shared runtime-surface helper.
- Audited remaining direct `colorCycleData.canvas` reads: compositor reads are routed through `resolveColorCyclePresentation(...)`; materializer/projectIO still retain legacy runtime/save compatibility reads for later Phase 6 cleanup.

Purpose: stop mutable runtime canvases from being treated as layer state truth.

Steps:

1. [x] Add a deprecation comment to `LayerColorCycleData.canvas` in the relevant type definition.
2. [x] Replace duplicate `refreshLayerCCSurface(...)` implementations with one materializer-owned helper or a thin compatibility wrapper.
3. [x] Audit direct reads and writes of `colorCycleData.canvas`.
4. [x] For each remaining read, classify it as:
   - presentation resolver
   - materializer internals
   - legacy compatibility path to remove later
5. [x] For each remaining write, classify it as:
   - materializer-owned runtime surface update
   - existing authoring path that must be routed through the materializer later

Files likely touched:

- `src/types.ts` or the local layer type file
- `src/hooks/brushEngine/colorCycleSurface.ts`
- `src/hooks/canvas/handlers/colorCycle/colorCycleSurface.ts`
- `src/stores/slices/colorAdjustSlice.ts`

Tests:

- [x] Existing color-adjust paths still refresh visible CC output.
- [x] No compositor test imports or reaches into `colorCycleData.canvas`.

Exit criteria:

- [x] Direct runtime-surface ownership is formally deprecated.
- [x] Duplicate refresh helpers are gone or reduced to wrappers with the same underlying implementation.

### Phase 6: Save And Export From Canonical State

Status: V1 save and Goblet export use canonical document state; V2 must remove export-time legacy repair fallback

Implementation note 2026-04-27:

- `serializeLayer(...)` now normalizes `ColorCycleLayerDocumentState` before deriving compatibility snapshots.
- Canonical buffers are applied to the serialized CC state source before `canvasImageData` is resolved.
- Live brush state still flushes through the existing `getFullState()` path and overrides with fresh runtime buffers when present.
- Manual save, autosave, and file backup all call `serializeProject(...)`, so they share this canonical-first save path.
- Goblet brush-mode fallback now serializes from `ColorCycleLayerDocumentState` when no live brush is available, including paint/index, gradient slot, gradient def-id, speed, flow, and phase buffers.

Purpose: ensure persistence/export cannot cement stale runtime pixels.

Add:

```ts
flushColorCycleRuntimeToDocumentState(layerId)
serializeColorCycleDocumentState(...)
deriveCompatibilityCanvasImageData(...)
```

Rules:

- [x] Save first flushes dirty runtime into canonical document state.
- [x] Serialization reads canonical buffers and metadata.
- [x] `canvasImageData` is derived last as a compatibility preview only.
- [x] Save does not choose between `canvas`, `canvasImageData`, and brush snapshots as competing truths.
- [x] Goblet export receives the same canonical brush-mode buffers as app restore.

Files likely touched:

- `src/utils/projectIO.ts`
- Goblet export path files identified by `rg "Goblet|goblet|export" src`
- persistence tests under `tests/` or `src/**/__tests__/`

Tests:

- [x] Save/reopen round trip preserves canonical buffers when runtime canvas is empty.
- [x] Autosave and crash recovery use the same flush path.
- [x] Goblet export receives paint, gradient slot, gradient def-id, speed, flow, and phase buffers.
- [x] `canvasImageData` is regenerated after canonical serialization, not used as source.

Exit criteria:

- [x] Save/export behavior is canonical-state-first.
- [x] Compatibility snapshots cannot overwrite canonical buffers.

### Phase 7: End-To-End Validation

Status: automated validation complete; browser/manual validation remains

Implementation note 2026-04-27:

- `npm run type-check` passed.
- `npm run lint` passed.
- Focused restore/presentation/materializer/save/Goblet test set passed: 9 suites, 185 tests.
- Full `npm test` passed: 361 suites, 2079 tests.

Automated checks:

```bash
[x] npm run type-check
[x] npm run lint
[x] npm test
```

Manual/browser checks:

1. [ ] Load the known old/heavy CC project.
2. [ ] Confirm non-active heavy CC layers can remain `cold` without data loss.
3. [ ] Select a cold CC layer.
4. [ ] Confirm it becomes `active` only after materialized runtime exists.
5. [ ] Toggle playback and verify animation uses restored buffers.
6. [ ] Save, reload, and verify the same layer still animates.
7. [ ] Export through Goblet and verify playback matches the app runtime.

Definition of done:

- The failing restored layer displays from canonical buffers.
- Selecting cold layers no longer produces a blank/stale active presentation.
- Compositors have one CC presentation resolver.
- Restore, save, and export agree on the same canonical state.
- No direct pixel-probe heuristic decides whether CC content exists.

## Regression Tests Required

- Old/heavy CC layer loads cold with canonical buffers intact and no brush.
- Selecting that layer warms it and produces a runtime brush plus non-empty materialized surface before active presentation.
- A cold layer with no `canvasImageData` still retains canonical buffers and does not become permanently blank after selection.
- A stale empty `canvasImageData` cannot override non-empty canonical buffers.
- A warmed restored layer whose runtime canvas was previously empty renders from canonical buffers instead of preserving the empty canvas.
- Compositor tests assert CC drawing goes through the presentation resolver.
- Save/reopen round trip serializes from canonical state, not from runtime canvas pixels.
- Goblet export still receives the same canonical brush-mode buffers.

## Non-Goals For This Fix

- Do not redesign gradient authoring or sampled preview.
- Do not reconstruct paint from gradient buffers.
- Do not add a display fallback that hides failed runtime materialization.
- Do not use pixel sampling as authority for sparse/off-center content.
- Do not change Goblet semantics except to preserve the same canonical buffers.

## Architectural Definition Of Done

- There is exactly one in-memory canonical CC document state for a layer.
- All restore paths normalize into that state.
- All runtime brushes are rebuilt from that state.
- All compositors draw through one presentation resolver.
- Save/export derive from that state, never from renderer-owned canvases.
- `canvasImageData` is explicitly compatibility data, not truth.
