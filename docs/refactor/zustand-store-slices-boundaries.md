This document tracks the planned decomposition of `useAppStore`. Every slice entry documents the target state/actions, helper dependencies, current progress, and concrete next steps so refactors can proceed incrementally without breaking existing workflows.

## Status Snapshot (Nov 3, 2025)
- [x] **Autosave & File Backup** — fully extracted (`src/stores/slices/autosaveSlice.ts`), wired through `createVesselStore`, and covered by regression tests in `useAppStore.autosave.test.ts`.
- [x] **Palette** — implemented in `src/stores/slices/paletteSlice.ts`; all palette mutations now flow through `applyPaletteSnapshot` helpers.
- [x] **Project** — slice + lifecycle helpers (`projectSlice`, `projectLifecycle`) now own persistence, capture, and import/export flows end to end (see new regression tests in `src/stores/__tests__/projectLifecycle.integration.test.ts`).
- [x] **Layers & Composition** — CRUD operations, composition, and capture flows now live entirely in `layersSlice`; selectors/tests cover alignment and ROI capture paths.
- [x] **Canvas Viewport** — state/actions now live in `src/stores/slices/canvasSlice.ts`; zoom/pan/display toggles are isolated from tool updates.
- [x] **Selection & Paste** — slice extracted to `src/stores/slices/selectionSlice.ts`; floating paste + marquee helpers covered by new ROI tests.
- [ ] **Tools & Brush** — core brush/eraser/preset actions now live in `src/stores/slices/toolsSlice.ts` with typed selectors + tests; remaining work: finish selector adoption + follow-up tests (see §6).
- [x] **Shape Fill** — orchestrator + persistence extracted to `src/stores/slices/shapeFillSlice.ts`, now composed via `createVesselStore` with the history hooks preserved.
- [x] **Color Adjust & Crop** — color-adjust (`colorAdjustSlice`) and crop (`cropSlice`) both compose into `useAppStore`, so the main store no longer carries any of that logic. Crop history helpers now run entirely inside the slice, which keeps `setCurrentTool` pure.
- [x] **History** — `historySlice` owns undo/redo stacks and integrates with the new helper services.
- [x] **UI & Keyboard** — `createUiSlice` now owns keyboard scope, panel/modal visibility, notifications, and theme state; selectors feed `useComprehensiveKeyboard`/DrawingCanvas without touching the monolith.

### Immediate Focus (ordered)
1. [ ] **Tools & Brush slice hardening** — finish moving the remaining shape-fill/canvas overlays into the slice, adopt the new `toolsSelectors` across components, and audit lingering direct store subscriptions.
2. [ ] **Crop flow QA** — add regression cases around `cropSlice.commitCrop` (history captures + CC rebuild) and thread ROI batching into the selection helpers so we can measure perf before landing workerized rebuilds.
3. [ ] **Gesture/keyboard cleanup** — continue purging direct `useAppStore.getState()` calls (focus next on `useDrawingHandlers` and tool state machines) so future slices can encapsulate state safely.
4. [ ] **UI-centric slices** — once Tools & Brush land, finish the remaining UI refinements (panel refs, modal toggles) now that crop/color-adjust are isolated.

---

## 1. Project Slice  [✅]
- **Current Status**: `src/stores/slices/projectSlice.ts` composes into `useAppStore` through `createVesselStore`. Lifecycle helpers (`projectLifecycle`, `layerStructureHistory`, `cropHistory`) now own persistence, capture, and brush hydration logic. `captureCanvasToActiveLayer` is injected into the lifecycle so save/export flows no longer reach into `useAppStore`, and the new regression suite (`src/stores/__tests__/projectLifecycle.integration.test.ts`) locks down save, import, and export behaviors.
- **State (target)**: `project`, `projectFilename`, `projectFileHandle`, `webglExportSettings`, `globalBrushSize` (until Tools slice absorbs it), `brushSpecificSettings`, and project-level async flags (`isSaving`, `isExporting`).
- **Actions (target)**: `setProject`, `updateProject`, `setProjectDimensions`, `saveProject`, `loadProject`, `importProject`, `exportProject`, `newProject`, `captureCanvasToActiveLayer`, `captureCanvasToLayer`, `compositeLayersToCanvas`, plus helper-facing setters for capture ROI + export metadata.
- **Dependencies**: `createCustomBrushPersistence`, `projectLifecycle`, `historyLifecycle` (for undo snapshots), `colorCycleBrushManager` (orphan cleanup), palette slice (foreground/background sync), file IO helpers in `utils/projectIO.ts`.
- **Remaining Gaps**:
  - `loadProject` still shells out to the file picker; when we add a mockable IO service, add coverage for that path plus color-cycle hydration edge cases.
  - A few legacy consumers still grab project data directly; continue migrating them to `projectSelectors` to minimize rerenders.
- **Next Steps**:
  1. Backfill focused tests around `loadProject` once the IO helpers are injectable.
  2. Finish migrating remaining project consumers (legacy keyboard/drawing handlers) to selectors so future slices can hide their internals cleanly.

## 2. Palette Slice  [✅]
- **State**: `palette`, `paletteDirty`, `activeSlot` (foreground/background), plus derived helpers for brush sync.
- **Actions**: `setPaletteColor`, `setActiveColor`, `swapPaletteColors`, `setActivePaletteSlot`, `syncPaletteFromTool`, `applyPaletteSnapshot` (helper).
- **Dependencies**: `layoutDefaults` for initial palette, palette persistence inside the project slice, tools slice for color synchronization.
- **Notes**: All palette-related UI now pulls from selectors; keep palette tests up to date when expanding tool or selection slices since they rely on palette events for color picker flows.

## 3. Layers & Composition Slice  [✅]
- **Current Status**: `src/stores/slices/layersSlice.ts` now owns the full layer lifecycle: CRUD, selection, alignment, color-cycle initialization, plus the composition/capture path (`compositeLayersToCanvas`, `captureCanvasToActiveLayer`, `captureCanvasToLayer`). ROI normalization helpers moved from `projectLifecycle`, `MinimalLayerList`/`AlignmentPanel` consume the exported selectors exclusively, and `layersSlice.integration.test.ts` covers alignment auto-sync + ROI capture regressions.
- **State**: `layers`, `activeLayerId`, `selectedLayerIds`, `referenceLayerId`, `layersNeedRecomposition`, `layerAlignmentPreview`, `pendingAlignmentOps`.
- **Actions**: CRUD + selection helpers, alignment updates, CC lifecycle hooks, recomposition toggles, and layer composition/capture services.
- **Remaining Gaps**:
  - Monitor ROI capture performance for huge selections (consider buffer pooling once Selection/Paste slice lands).
- **Next Steps**:
  1. Expose the new capture helpers to the Selection/Paste slice so floating paste commits reuse the ROI path.
  2. Add perf probes if recomposition latency spikes during future refactors.


## 4. Canvas Viewport Slice  [✅]
- **Current Status**: `src/stores/slices/canvasSlice.ts` now owns the `canvas` state and viewport metadata. Zoom/pan, ruler visibility, display mode, cursor updates, and resize helpers are isolated from the rest of the store, so tool updates no longer force canvas subscribers to rerender.
- **State**: `canvas`, `canvasViewport`.
- **Actions**: `setZoom`, `setRotation`, `setGridSize`, `setCanvasOffset`, `setCanvasViewport`, `toggleRulers`, `setDisplayMode`, `setCanvasDimensions`, `resizeCanvas`, `setSelection`, `setCursor`.
- **Next Steps**:
  1. Thread canvas selectors through `useDrawingHandlers`/overlay components so viewport refs stay lean.
  2. Consider memoized selectors for `viewTransformRef` consumers once tools/brush slice lands.

## 5. Selection & Paste Slice  [✅]
- **Current Status**: `src/stores/slices/selectionSlice.ts` encapsulates selection bounds, marquee helpers, deletion flows, and floating paste state. ROI utilities moved to `src/stores/helpers/selectionRoi.ts` with coverage in `src/stores/helpers/__tests__/selectionRoi.test.ts`, and floating paste helpers stay wired through the slice so they reuse the layer slice’s ROI capture.
- **State**: `selectionStart`, `selectionEnd`, floating paste payload.
- **Actions**: `setSelectionBounds`, `clearSelection`, `selectAllActiveLayerPixels`, `deleteSelectedPixels`, `setFloatingPaste`, `updateFloatingPastePosition`, `updateFloatingPasteRect`, `commitFloatingPaste`, `cancelFloatingPaste`.
- **Next Steps**:
  1. Add integration tests for marquee delete plus paste commit/cancel using the slice API.
  2. Finish migrating crop/history helpers to the slice-level actions so we no longer poke selection state directly inside `useAppStore`.

## 6. Tools & Brush Slice  [🚧]
- **Current Status**: `createToolsSlice` now owns brushes, eraser, presets, custom brush lifecycle, polygon/recolor state, the brush editor, *and* `setCurrentTool`. `useAppStore` composes the slice alongside Shape Fill / Color Adjust / Crop, so tool consumers rely on `toolsSelectors` for narrow subscriptions. Regression coverage in `src/stores/__tests__/toolsSlice.test.ts` exercises palette/pressure syncing, color-cycle preset hydration, recolor sampling, brush-editor regressions, and the crop reset logic tied to tool switching.
- **State (current)**: `tools`, `pressureSettings`, `globalBrushSize`, `brushPresets`, `currentBrushPreset`, `activeBrushComponents`, `temporaryCustomBrush`, `polygonGradientState`, `recolorSampling`, `brushEditor`, `brushSpecificSettings`.
- **Actions (current)**: `setCurrentTool`, `setBrushSettings`, `setEraserSettings`, `setFillSettings`, `setShapeMode`, `_saveCurrentBrushSettings`, `setBrushPreset`, `getBrushPresets`, `getBrushPresetById`, `removeBrushPreset`, `setTemporaryCustomBrush`, polygon helpers, recolor helpers, `startBrushEdit` / `saveBrushEdit` / `cancelBrushEdit`, brush editor adjustments, `updateCurrentBrushTip`, `refreshCurrentBrushTipFromSource`, `saveBrushSettings`, `loadBrushSettings`, `clearBrushSettings`.
- **Dependencies**: palette slice (`applyPaletteSnapshot`), project/custom brush persistence, selection slice (shape fill cancel), Shape Fill / Color Adjust / Crop slices, image-processing helpers, brush caches.
- **Remaining Gaps**:
  1. ✅ `setCurrentTool` now lives inside the slice; next cleanup is to audit custom-brush hydration/autosave flows so they talk to project helpers through explicit interfaces.
  2. ✅ Project slice now exposes `getCustomBrushById` / `listCustomBrushes`, so new tool logic can stay decoupled; keep migrating callers as they change.
  3. ✅ Gesture + keyboard hooks now rely on `toolsSelectors` via selector refs, so React 19 warnings remain suppressed; keep auditing any new hooks for direct store access.
- **Next Steps**:
  1. Profile the cloned helper results (`listCustomBrushes`, `getCustomBrushById`) as we add more consumers; memoize via `selectCustomBrushHelpers` if we observe perf regressions.
  2. Continue growing `toolsSlice.test.ts` when new tool behaviors land (e.g., future custom-brush hydration cases) so regressions stay covered.



## 7. Shape Fill Slice  [✅]
- **Current Status**: `src/stores/slices/shapeFillSlice.ts` now owns orchestrator wiring, persisted parameters, and history integration. `createVesselStore` instantiates a per-store `ShapeFillOrchestrator`, so `shapeFill.session` updates flow through the slice listener instead of bespoke store mutations.
- **State**: `shapeFill.activeFillId`, `availableFillIds`, `paramsByFill`, live `session`, `parameterOrder`, `lastFinalize`, `showOutline`, `sampleUnderShape`, `useBackgroundColor`.
- **Actions**: `setShapeFillActiveFill`, `setShapeFillParameterOrder`, `setShapeFillParamValue`, `setShapeFillShowOutline`, `setShapeFillSampleUnderShape`, `setShapeFillUseBackground`, `beginShapeFillSession`, `updateShapeFillCursor`, `commitShapeFillParameter`, `finalizeShapeFillSession`, `cancelShapeFillSession`.
- **Dependencies**: `ShapeFillOrchestrator`, `shapeFill/strategies`, `historySlice` (for session deltas), persistence helpers (localStorage), `toolsSlice` (`setCurrentTool` cancels sessions when switching away).
- **Next Steps**:
  1. Add focused tests for orchestrator persistence (param ordering, last finalize snapshot) using the new slice entry points.
  2. Introduce `shapeFillSelectors` so DrawingCanvas + handlers can subscribe narrowly once lingering direct store usages are audited.

## 8. Color Adjust & Crop Slice  [✅]
- **Current Status**: `src/stores/slices/colorAdjustSlice.ts` and the new `src/stores/slices/cropSlice.ts` now own their respective domains. `setCurrentTool` lives in `toolsSlice`, so leaving the crop tool simply calls `resetCrop`, and color-adjust starts/cancels via slice actions. The crop slice centralizes ROI normalization, history capture, color-cycle rebuilds, and selection resets.
- **State**: `colorAdjust` session data (active flag, params, selection bounds, target layer) plus `crop` (`status`, `marquee`, `activeHandle`, `commitInFlight`).
- **Actions**: `startColorAdjustSession`, `updateColorAdjustParams`, `previewColorAdjust`, `applyColorAdjust`, `cancelColorAdjust`, `resetColorAdjustParams`, `setCropState`, `resetCrop`, `cancelCrop`, `commitCrop`.
- **Dependencies**: `selectionRoi` helpers, `applyColorAdjustments`, `historySlice` (layer history commits), `layersSlice` (`updateLayer`), crop helpers (`applyCroppedLayers`, `selectionSnapshotFromCropState`), `colorCycleBrushManager`, `RecolorManager`, and `syncCCRuntimes`.
- **Next Steps**:
  1. Add targeted Jest coverage for `commitCrop` (history snapshots + CC rebuild) once we have deterministic canvas mocks for crop tests.
  2. Measure crop commit latency on large projects; if needed, introduce ROI batching metrics or workerized rebuild paths before enabling auto-crop flows.

## 9. History Slice  [✅]
- **Current Status**: `src/stores/slices/historySlice.ts` owns undo/redo stacks, history size, and integrates with `historyLifecycle` for snapshot creation. All store consumers call `canUndo/canRedo/undo/redo` through the slice.
- **State**: `history.undoStack`, `history.redoStack`, `history.maxSize`, `history.isRestoring`.
- **Actions**: `undo`, `redo`, `canUndo`, `canRedo`, `clearHistory`, `setHistorySize`, `setHistoryMaxSize`, helper hooks for pending color-cycle saves.
- **Next Steps**: Expand regression tests around history size changes and capture-time coordination with the layers slice once recomposition helpers move.

## 10. Autosave & File Backup Slice  [✅]
- **Current Status**: `src/stores/slices/autosaveSlice.ts` manages autosave flags, file handles, backup state, and exposes setters used by `autosaveService`.
- **State**: `autosave.isEnabled`, `autosave.interval`, `autosave.lastRun`, `autosave.fileBackup` (mode, handles, timestamps), `autosave.pendingDirtyFiles`.
- **Actions**: `setAutosaveEnabled`, `setAutosaveInterval`, `setFileBackupEnabled`, `setFileBackupMode`, `setFileBackupFile`, `setFileBackupDirectory`, `updateFileBackupTime`, `clearDirtyState`.
- **Next Steps**: None short-term beyond keeping `stateSelectors` updated when UI moves to selectors; add integration tests once selection/paste slice touches autosave flags.

## 11. UI & Keyboard Slice  [✅]
- **Current Status**: `createUiSlice` (`src/stores/slices/uiSlice.ts`) now owns UI state/actions: keyboard scope stack, panel/modal visibility, notifications, and theme. `useComprehensiveKeyboard`, DrawingCanvas, and other consumers rely on selectors/selector refs, so no component reaches into the monolith for UI state.
- **State**: `ui.keyboardScope` (active + stack), `ui.modals`, `ui.panels`, `ui.theme`, `ui.notifications`.
- **Actions**: `pushKeyboardScope`, `popKeyboardScope`, `togglePanel`, `toggleModal`, `setTheme`, `addNotification`, `removeNotification` (with unique IDs).
- **Dependencies**: Selection slice (for floating paste UI), Tools slice (brush editor dialogs), `KeyboardScope` helpers, `ModalPortal` components.
- **Next Steps**:
  1. Layer on lint-friendly hooks (or unit tests) around keyboard scope usage so future handlers stay selector-based.
  2. When new UI elements appear, add selectors instead of ad-hoc store access to keep the slice narrow.

##  12. Cross-Slice Coordination & Tooling
- **Selectors**: Canonical selectors now live under `src/stores/selectors/` (project, layers, modal, paste, state). Continue adding slice-specific selectors as domains move so components avoid ad-hoc `useAppStore` picks.
- **Selector refs**: `src/hooks/useStoreSelectorRef.ts` provides a shared pattern for event handlers that need the latest store data without triggering re-subscription churn (now used by both `useComprehensiveKeyboard` and `useDrawingHandlers`).
- **Helper modules**: `projectLifecycle`, `layerStructureHistory`, `cropHistory`, `customBrushPersistence`, and `historyLifecycle` should remain the single place where cross-slice side effects live. When introducing a new slice, ensure external services talk to helpers, not directly to the store.
- **Testing**: Each slice extraction should add focused Jest coverage (e.g., `projectSelectors.test.ts`, `layersSlice.integration.test.ts`). When selectors move, update nearby tests/fixtures to use the new entry points.
- **Dev ergonomics**: `createVesselStore` composes `subscribeWithSelector` + devtools gating. Keep new slices pure and serializable, inject services at slice construction time, and document any non-serializable fields directly in the slice file.
- **ROI perf watch**: Floating paste now calls the layer slice’s ROI-aware capture helpers. When Selection/Paste batching lands, sample capture durations for large regions (via dev logging or perf hooks) and consider pooled ImageData buffers if recomposition spikes.
