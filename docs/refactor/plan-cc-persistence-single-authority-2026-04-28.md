# Color Cycle Persistence Single Authority Plan

Date: 2026-04-28

Status: planned

## Goal

Remove the architecture that allowed a color-cycle layer to save as metadata-only while the live runtime still held the real painted data.

The target contract:

```text
live CC runtime or cold archive snapshot -> ColorCyclePersistenceSnapshot -> ColorCycleLayerDocumentState -> save/autosave/history
validated ColorCycleLayerDocumentState -> runtime hydration
```

There should be one service that decides what the canonical color-cycle document state is. Save, autosave, history, import repair, and runtime hydration must not each assemble CC persistence state from their own mix of layer fields.

Directionality matters:

- Project save, autosave, and history use the snapshot service at write boundaries.
- Import repair may produce validated `ColorCycleLayerDocumentState` or explicit repair-failed/static-preview metadata.
- Runtime hydration consumes only validated document state. It does not call capture/source-resolution APIs and does not invent canonical state from scattered layer fields.

## Triggering Incident

The C2/C3 archive comparison showed a real data-loss path:

- C2 contained canonical CC runtime binaries for the affected layers:
  - `paint.bin`
  - `speed.bin`
  - `flow.bin`
  - `phase.bin`
  - `gradient-id.bin`
  - `gradient-def-id.bin`
- C3 contained only gradient bindings and preview-ish data for those same CC layers:
  - `gradient-id.bin`
  - `gradient-def-id.bin`
  - `canvas-image.txt`
- C3 `project.json` no longer had canonical fields such as:
  - `paintRef`
  - `speedRef`
  - `flowRef`
  - `phaseRef`
  - `hasContent`
  - `strokeCounter`
  - `paintSlot`

This was not zip corruption. The app wrote a project model that had already lost canonical animated CC paint state.

## Root Cause

Color-cycle layer state currently has too many possible authorities:

1. `colorCycleData.colorCycleBrush`
   - live runtime brush
   - owns current paint/speed/flow/phase buffers while active or warm

2. `colorCycleData.brushState`
   - persisted/restored snapshot
   - can become stale, metadata-only, or deliberately lightweight after lazy loading

3. top-level `colorCycleData` fields
   - gradient refs, slot metadata, canvas preview data, legacy compatibility fields

4. deferred archive runtime refs
   - cold/lazy restore path for large imported layers

5. manager-owned brush instances
   - `colorCycleBrushManager` can hold the actual runtime even when a layer object is partial

The save path was allowed to build canonical archive state from partial layer fields. When `brushState` was stale or metadata-only, save could omit the runtime-owned `paint/speed/flow/phase` buffers and make that loss permanent.

The immediate guard added on 2026-04-28 captures the live runtime state during save. That protects the save boundary, but the architecture still needs consolidation so future flows cannot reintroduce this drift.

## Non-Goals

- Do not redesign CC playback, dither algorithms, sampled-gradient rendering, or shape preview behavior.
- Do not auto-heal existing damaged archives like C3 unless a separate recovery task is opened.
- Do not remove lazy/cold restore. Large archive performance still matters.
- Do not treat `canvasImageData` or rendered pixels as canonical CC paint, except inside explicit legacy import repair.

## Desired Architecture

### New Boundary Module

Add a dedicated module:

```text
src/lib/colorCycle/persistence/
  captureColorCyclePersistenceSnapshot.ts
  resolveColorCyclePersistenceSource.ts
  emitColorCycleDocumentState.ts
  colorCyclePersistenceTypes.ts
  colorCyclePersistenceValidation.ts
  __tests__/
```

Primary API:

```ts
type ColorCyclePersistenceSnapshot =
  | {
      ok: true;
      source: 'live-runtime' | 'deferred-archive' | 'persisted-brush-state';
      mode: ColorCyclePersistenceMode;
      layerId: string;
      documentState: ColorCycleLayerDocumentState & {
        paintBuffer: ArrayBuffer;
      };
      brushState: PersistedColorCycleBrushState;
      diagnostics: ColorCyclePersistenceDiagnostic[];
    }
  | {
      ok: false;
      layerId: string;
      mode: ColorCyclePersistenceMode;
      reason:
        | 'missing-color-cycle-data'
        | 'missing-canonical-paint'
        | 'runtime-capture-failed'
        | 'dimension-mismatch'
        | 'missing-motion-buffers'
        | 'layer-id-mismatch'
        | 'missing-archive-ref'
        | 'invalid-schema-version'
        | 'invalid-deferred-archive'
        | 'metadata-only-state';
      previewImageData?: ImageData;
      diagnostics: ColorCyclePersistenceDiagnostic[];
    };

type ColorCyclePersistenceMode =
  | 'canonical-save'
  | 'autosave'
  | 'history'
  | 'import-repair'
  | 'diagnostic';

function captureColorCyclePersistenceSnapshot(
  layer: Layer,
  context: {
    projectWidth: number;
    projectHeight: number;
    requirePaint: boolean;
    mode: ColorCyclePersistenceMode;
    runtimeBrushManager?: ColorCycleRuntimeBrushManager;
    archiveManifest?: ColorCycleArchiveManifest;
    archiveBlobResolver?: ColorCycleArchiveBlobResolver;
    layerRuntimeCache?: ColorCycleLayerRuntimeCache;
    diagnostics?: ColorCyclePersistenceDiagnosticSink;
  }
): ColorCyclePersistenceSnapshot;
```

`captureColorCyclePersistenceSnapshot(...)` may stay the public API, but it must not become a god-function. Internally split the responsibilities:

- `resolveColorCyclePersistenceSource(...)`
  - chooses live runtime, deferred archive, or canonical persisted brush state from explicit injected dependencies.
- `validateColorCyclePersistenceSnapshot(...)`
  - enforces canonical buffer/schema/layer/dimension rules and returns typed damage.
- `emitColorCycleDocumentState(...)`
  - writes the document-state shape and binary refs from an already validated source.

The snapshot boundary must receive dependencies through the context object. It must not secretly import the Zustand store, runtime managers, archive globals, or diagnostics sinks. Hidden imports would reintroduce multiple authorities and make the source-priority logic hard to test.

### Source Priority

The snapshot service is the only place allowed to choose source priority:

1. live runtime brush
   - ask `getFullState()` or `serialize()`
   - validate that the matching layer snapshot contains paint data

2. deferred archive runtime
   - use cold refs without forcing full runtime hydration
   - validate that referenced archive paths exist in the binary manifest

3. persisted `brushState`
   - accepted only if it is explicitly marked canonical and contains a compatible same-layer paint snapshot
   - must include schema/version/dimension/layer compatibility metadata

4. legacy/metadata fallback
   - never silently accepted as canonical paint
   - returns `ok: false` unless import repair has already converted it to canonical state
   - only `mode: 'import-repair'` may emit static-preview repair output

Required persisted brush-state canonical markers:

- `canonicalPaint: true`
- compatible `schemaVersion`
- matching `layerId`
- matching `dimensions`
- coherent `capturedAtStrokeCounter` or equivalent stroke counter metadata

### Hard Rules

- Save may not write a brush-mode CC layer as canonical animated CC if `paintBuffer` is missing.
- A brush-mode CC layer is canonical only if it has paint, speed, flow, phase, dimensions, layer-id compatibility, and schema-version compatibility.
- `gradient-id`, `gradient-def-id`, `strokeCounter`, `paintSlot`, and `hasContent` are required whenever they are part of the current document-state schema or needed to restore non-default runtime behavior.
- Save may write a repair-failed/static-preview layer only with explicit repair metadata.
- Save, autosave, and history must use the same snapshot service at write boundaries.
- Runtime hydration must consume validated document state rather than infer state from scattered fields.
- `canvas`, `canvasImageData`, rendered RGBA, and compositor output are not canonical CC paint.
- `brushState` is not automatically authoritative just because it exists.
- A `brushState` with paint-looking buffers is not canonical unless it has explicit canonical markers.
- A live runtime is authoritative over stale layer snapshot data.
- A deferred archive snapshot is authoritative over lightweight metadata-only layer data.
- Static-preview fallback can never return `ok: true` for animated CC. It is repair metadata only.

### Damage Classification

Typed damage is part of the contract so diagnostics and health reports do not have to infer failure shape from strings:

```ts
type ColorCycleDamageKind =
  | 'missing-paint-buffer'
  | 'missing-motion-buffers'
  | 'metadata-only'
  | 'dimension-mismatch'
  | 'layer-id-mismatch'
  | 'missing-archive-ref'
  | 'invalid-schema-version';
```

Each failed snapshot should include one primary `ColorCycleDamageKind` plus diagnostics with the source inspected and the missing/invalid fields.

### History Storage Contract

History has different storage pressure than project save and must not accidentally duplicate large binary buffers on every action unless that is the chosen policy.

History may store:

- full canonical CC buffers
- validated refs to immutable persisted buffers
- runtime-only canonical snapshots before a save, if they satisfy the same validation contract
- explicit repair-failed/static-preview metadata

History may not store:

- metadata-only animated CC state
- `canvasImageData` as animated paint
- gradient buffers without paint/speed/flow/phase
- stale `brushState` data that lacks canonical markers

The history phase must decide whether history uses full buffers, immutable refs, or deltas for each case and must include memory-risk notes in the implementation checklist.

## Implementation Phases

### Phase 1: Inventory Current CC Persistence Writers

Status: not started

Map every path that captures or serializes CC state:

- `src/utils/projectIO.ts`
  - `serializeLayer`
  - `normalizeColorCycleLayerDocumentState`
  - deferred archive copy path
  - load/import repair/hydration helpers
- `src/stores/helpers/historyLifecycle.ts`
  - `cloneLayerForHistory`
  - `captureColorCycleBrushState`
- `src/history/helpers/colorCycle.ts`
  - runtime snapshot helpers
- `src/stores/layers/createLayersSlice.ts`
  - init, warm restore, active-layer runtime lookup
- autosave/file backup paths
  - confirm whether they call project save or maintain separate capture logic

Exit criteria:

- [ ] A short inventory table exists in this doc or a companion note.
- [ ] Every writer is marked as `canonical`, `runtime`, `preview`, or `legacy`.
- [ ] Any path that can currently write metadata-only CC as canonical state is identified.

### Phase 2: Introduce `ColorCyclePersistenceSnapshot`

Status: not started

Create the boundary module and move source-priority logic into it.

Steps:

- [ ] Define `ColorCyclePersistenceSnapshot` and diagnostics types.
- [ ] Define the explicit context/dependency object; do not use hidden store or manager imports.
- [ ] Split internals into source resolution, validation, and document-state emission helpers.
- [ ] Add runtime capture adapter for `colorCycleBrush.getFullState()` / `serialize()`.
- [ ] Add deferred archive adapter.
- [ ] Add persisted brush-state adapter.
- [ ] Add validation for same-layer snapshot, dimensions, required buffers, and metadata.
- [ ] Add damage classification for missing paint, missing motion buffers, metadata-only state, dimension mismatch, layer mismatch, missing archive refs, and invalid schemas.
- [ ] Make metadata-only state return a typed failure instead of silently passing.
- [ ] Ensure static-preview repair output is available only in `mode: 'import-repair'` and never returns healthy animated CC.

Tests:

- [ ] live runtime with paint/speed/flow/phase returns `ok: true`, `source: 'live-runtime'`
- [ ] live runtime capture failure falls back only to valid deferred/archive state
- [ ] metadata-only `brushState` returns `ok: false`, `reason: 'metadata-only-state'`
- [ ] paint-looking `brushState` without canonical markers returns `ok: false`
- [ ] deferred archive refs can be accepted without warming the runtime
- [ ] dimension mismatch fails
- [ ] missing speed/flow/phase fails as missing motion buffers
- [ ] stale same-layer snapshot loses to live runtime

Exit criteria:

- [ ] Snapshot source priority is unit-tested outside `projectIO.ts`.
- [ ] No project save code directly chooses between live runtime, brushState, and deferred archive.

### Phase 3: Rewire Project Save Through The Snapshot Service

Status: not started

Replace ad hoc CC assembly in `serializeLayer`.

Steps:

- [ ] `serializeLayer` calls `captureColorCyclePersistenceSnapshot(...)` for brush-mode CC layers.
- [ ] `buildColorCycleStateSource(...)` receives a validated snapshot, not raw `brushState`.
- [ ] `normalizeColorCycleLayerDocumentState(...)` is not used as a hidden source resolver.
- [ ] Save emits explicit diagnostics when a CC layer cannot provide canonical paint.
- [ ] Save refuses to silently downgrade an animated CC layer to gradient-only metadata.

Tests:

- [ ] regression for C3-style state: live runtime has paint, layer metadata has only gradients, save writes `paint/speed/flow/phase`
- [ ] cold/deferred layer saves by copying archive refs without hydration
- [ ] metadata-only CC layer saves as repair-failed/static-preview, not animated canonical CC
- [ ] no duplicate canonical buffer authorities are emitted

Exit criteria:

- [ ] `serializeLayer` no longer contains source-priority branching for CC runtime state.
- [ ] C3-style loss is impossible at the save boundary.

### Phase 4: Rewire Autosave

Status: not started

Autosave is a save boundary. It should match manual save semantics before history-specific storage decisions are made.

Steps:

- [ ] Confirm autosave/file backup uses the same project save path or explicitly route its CC capture through the snapshot service.
- [ ] Confirm IndexedDB/crash-recovery autosave does not maintain an older CC capture path.
- [ ] Autosave emits the same explicit diagnostics as manual save when canonical paint is missing.
- [ ] Autosave refuses to silently downgrade animated CC to gradient-only metadata.

Tests:

- [ ] autosave of active CC runtime writes the same canonical refs as manual save
- [ ] autosave of cold/deferred CC layer preserves validated archive refs
- [ ] autosave of metadata-only CC emits repair-failed/static-preview metadata, not healthy animated CC

Exit criteria:

- [ ] Manual save and autosave no longer disagree about CC authority.

### Phase 5: Rewire History

Status: not started

History currently has its own CC capture behavior. That can preserve stale or partial state independently of project save, and it has separate memory/storage semantics.

Steps:

- [ ] Decide and document whether history stores full canonical buffers, immutable refs, deltas, or runtime-only snapshots for each CC case.
- [ ] Replace `cloneLayerForHistory` CC brush capture with the snapshot service.
- [ ] Make history snapshots store either a validated canonical CC snapshot/ref or explicit static-preview/repair-failed metadata.
- [ ] Prevent history from storing metadata-only animated CC, `canvasImageData` as animated paint, or gradient-only buffers as paint.
- [ ] Remove duplicate runtime-capture helpers where possible.

Tests:

- [ ] undo/redo after CC stroke keeps paint/speed/flow/phase
- [ ] history snapshot for non-active CC layers reuses previous validated canonical snapshot or immutable refs instead of metadata-only state
- [ ] saving immediately after undo/redo does not downgrade CC buffers
- [ ] history storage choice has a focused memory-risk regression or documented measurement path

Exit criteria:

- [ ] History authority is aligned with save/autosave, with explicit storage rules.

### Phase 6: Rewire Runtime Hydration Around Validated Document State

Status: not started

Runtime restore should consume canonical persisted state; it should not repair, capture, source-resolve, or invent document state.

Steps:

- [ ] Ensure load/import repair produces either canonical-valid state or repair-failed/static-preview metadata.
- [ ] Runtime hydration accepts only validated `ColorCycleLayerDocumentState` or explicit repair-failed/static-preview metadata.
- [ ] Warm restore of cold layers uses validated deferred archive document state without calling the capture service.
- [ ] Active-layer selection cannot turn metadata-only state into canonical state.

Tests:

- [ ] selecting a cold valid CC layer warms from deferred archive and keeps canonical buffers
- [ ] selecting repair-failed/static-preview layer does not create a fake animated brush
- [ ] warm restore followed by save emits the same canonical refs

Exit criteria:

- [ ] Runtime hydration is a consumer of canonical state, not a repair/source-resolution authority.

### Phase 7: Delete Deprecated Authority Paths

Status: not started

Once save/autosave/history use the snapshot boundary and runtime hydration consumes validated document state, remove old escape hatches.

Candidates:

- direct save-time capture from raw `colorCycleData.brushState`
- direct save-time use of top-level `gradientIdBuffer` / `gradientDefIdBuffer` as if enough for canonical animated CC
- duplicate weak-map saved brush state fallbacks that bypass snapshot validation
- history-only `captureColorCycleBrushState` helpers if they duplicate the new boundary
- runtime-side compatibility repair outside import repair
- any hydration path that calls source-resolution/capture code

Exit criteria:

- [ ] Search for `brushState` writes and confirm each is import repair, validated snapshot emission, or runtime cache only.
- [ ] Search for `gradientIdBuffer` / `gradientDefIdBuffer` save usage and confirm it cannot create canonical animated CC without paint.
- [ ] All deprecated paths are removed or documented as legacy import-only.

### Phase 8: Diagnostics And User-Facing Safety

Status: not started

The app should warn before data is permanently downgraded.

Steps:

- [ ] Add save health diagnostics for each CC layer:
  - source used: live runtime, deferred archive, persisted brush state
  - canonical paint present/missing
  - static-preview-only status
- [ ] Add a dev-only assertion/log when save sees metadata-only CC state while live runtime exists.
- [ ] Keep stable layer id token in layer UI for debugging duplicate names.
- [ ] Consider a non-blocking warning in save/load health report for repair-failed CC layers.

Exit criteria:

- [ ] A future C3-style archive can be diagnosed from a health report without guessing layer names.

## Validation Matrix

Required automated validation:

- [ ] `npm run type-check`
- [ ] `npm run lint`
- [ ] targeted projectIO persistence tests
- [ ] targeted history lifecycle tests
- [ ] targeted runtime hydration tests
- [ ] full `npm test` or documented known unrelated failures

Required manual validation:

- [ ] Create multiple CC layers, draw older strokes/shapes, save, reload, confirm all animate.
- [ ] Save while active CC layer has live runtime and stale metadata.
- [ ] Save immediately after switching away from CC layer.
- [ ] Save cold/lazy restored project before warming all CC layers.
- [ ] Undo/redo CC strokes, save, reload.
- [ ] Open C2-like healthy archive and verify all canonical buffers survive a resave.
- [ ] Open C3-like damaged archive and verify it is reported as missing canonical paint instead of silently pretending to be healthy.

## Completion Criteria

This architecture work is complete only when:

- [ ] There is exactly one snapshot service responsible for CC persistence authority.
- [ ] Project save, autosave, and history use the snapshot service; runtime hydration consumes validated document state only.
- [ ] Metadata-only CC state cannot be serialized as a healthy animated CC layer.
- [ ] Live runtime data cannot be lost because a stale `brushState` snapshot exists.
- [ ] Cold/deferred archive data can be saved without warming every layer.
- [ ] Legacy repair remains import-only.
- [ ] Tests cover the C3-style failure and the cold/deferred save path.
