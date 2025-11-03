This document tracks the planned decomposition of `useAppStore`. Every slice entry documents the target state/actions, helper dependencies, current progress, and concrete next steps so refactors can proceed incrementally without breaking existing workflows.

## Status Snapshot (Nov 3, 2025)
- [x] **Autosave & File Backup** — fully extracted (`src/stores/slices/autosaveSlice.ts`), wired through `createVesselStore`, and covered by regression tests in `useAppStore.autosave.test.ts`.
- [x] **Palette** — implemented in `src/stores/slices/paletteSlice.ts`; all palette mutations now flow through `applyPaletteSnapshot` helpers.
- [~] **Project** — slice + lifecycle helpers (`projectSlice`, `projectLifecycle`) own persistence and capture routines, but history glue + a few legacy setters remain in `useAppStore`.
- [x] **Layers & Composition** — CRUD operations, composition, and capture flows now live entirely in `layersSlice`; selectors/tests cover alignment and ROI capture paths.
- [ ] **Canvas Viewport** — pending extraction.
- [ ] **Selection & Paste** — pending extraction; selectors now drive UI/keyboard hooks, but core state still resides in `useAppStore`.
- [ ] **Tools & Brush** — pending extraction; still bundled with legacy brush editor logic.
- [ ] **Shape Fill** — pending extraction.
- [ ] **Color Adjust & Crop** — pending extraction.
- [x] **History** — `historySlice` owns undo/redo stacks and integrates with the new helper services.
- [~] **UI & Keyboard** — selector-based readers are in place (`useStoreSelectorRef`), but slice still sits inside the monolith.

### Immediate Focus (ordered)
1. **Project slice finish** — move the remaining capture/save setters, annotate dependencies, and extend import/export regression tests so downstream slices depend on a stable project API.
2. **Selection & Paste groundwork** — with `selectionPasteHelpers` in place, finish migrating drawing/pointer handlers to selector refs, then extract the slice with ROI batching + regression tests.
3. **Canvas viewport slice** — isolate zoom/pan/ruler state so canvas hooks aren’t blocked on unrelated tool updates.
4. **Keyboard & drawing handler cleanup** — continue replacing `useAppStore.getState()` in gesture/key handlers to prevent regressions once slices hide their internal state.
5. **UI-centric slices** — once Selection & Paste lands, proceed with Tools & Brush, Shape Fill, Color Adjust/Crop, then complete the UI slice.

---

## 1. Project Slice  [~]
- **Current Status**: `src/stores/slices/projectSlice.ts` composes into `useAppStore` through `createVesselStore`. Lifecycle helpers (`projectLifecycle`, `layerStructureHistory`, `cropHistory`) now own persistence, capture, and brush hydration logic. `setProjectDimensions`, `resizeProjectCanvas`, and custom brush persistence all flow through the slice.
- **State (target)**: `project`, `projectFilename`, `projectFileHandle`, `webglExportSettings`, `globalBrushSize` (until Tools slice absorbs it), `brushSpecificSettings`, and project-level async flags (`isSaving`, `isExporting`).
- **Actions (target)**: `setProject`, `updateProject`, `setProjectDimensions`, `saveProject`, `loadProject`, `importProject`, `exportProject`, `newProject`, `captureCanvasToActiveLayer`, `captureCanvasToLayer`, `compositeLayersToCanvas`, plus helper-facing setters for capture ROI + export metadata.
- **Dependencies**: `createCustomBrushPersistence`, `projectLifecycle`, `historyLifecycle` (for undo snapshots), `colorCycleBrushManager` (orphan cleanup), palette slice (foreground/background sync), file IO helpers in `utils/projectIO.ts`.
- **Remaining Gaps**:
  - History glue (`applyLoadedProject`, undo bridge) still calls into `useAppStore` directly.
  - Capture helpers for history snapshots live in `useAppStore` and need to move into `projectLifecycle`.
  - Selectors exist in `src/stores/selectors/projectSelectors.ts`, but not all consumers have migrated.
- **Next Steps**:
  1. Migrate `captureCanvasToActiveLayer`/`captureCanvasToLayer` to the helper module so the slice is the single writer.
  2. Update `useAppStore` to delegate remaining `project.*` setters to slice actions only.
  3. Expand Jest coverage (`projectSelectors.test.ts`) to include import/export happy path + regression for custom-brush hydration.

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

## 4. Canvas Viewport Slice  [ ]
- **State (target)**: `canvasTransform` (scale, offset), `viewTransformRef`, `showRulers`, `gridSnap`, `zoomHistory`, `panVelocity`, `devicePixelRatioOverride`.
- **Actions (target)**: `setCanvasTransform`, `setZoom`, `setPan`, `resetView`, `toggleRulers`, `setGridSnap`, `setDevicePixelRatioOverride`, plus helpers consumed by `useSimplePan` and `DrawingCanvas`.
- **Dependencies**: `zoomUtils`, `useSimplePan`, `canvasPool`, `autosaveService` (for boundary checks), `gridSnap` utilities.
- **Status / Next Steps**:
  1. Inventory components/hooks reading `canvas` state (`DrawingCanvas.tsx`, `useSimplePan.ts`, `useCanvasInteraction.ts`).
  2. Define selectors for derived transforms so `DrawingCanvas` can stop memoizing entire store slices.
  3. Extract slice and update hooks to consume selectors + actions, then add viewport regression tests (zoom reset, ruler toggles).

## 5. Selection & Paste Slice  [ ]
- **State (target)**: `selectionStart`, `selectionEnd`, `selectionMode`, `selectionMask`, `floatingPaste`, `floatingPasteTransform`, `selectionClipboard`, `selectionNeedsRepaint`, `isDraggingFloatingPaste`.
- **Actions (target)**: `setSelectionRange`, `clearSelection`, `deleteSelectedPixels`, `setFloatingPaste`, `updateFloatingPasteRect`, `commitFloatingPaste`, `cancelFloatingPaste`, `setSelectionMode`, `syncSelectionMask`, clipboard helpers for history integration, drag-state setters.
- **Dependencies**: `pasteSelectors`, `DrawingCanvas`, `FloatingPasteOverlay`, `useDrawingHandlers`, pointer handlers, history slice (for undo), layer slice (for ROI operations), `pendingColorCycleSaves` (when selection touches CC layers).
- **Current Status**: UI components (FloatingPasteOverlay, BrushControls, GradientEditor, DrawingCanvas) now pull selection/paste data via selectors. Both high-frequency hooks—`useComprehensiveKeyboard` and `useDrawingHandlers`—use `useStoreSelectorRef`, and floating paste commit/cancel flows run through `selectionPasteHelpers`, which call the layer slice’s ROI-aware capture helpers.
- **Next Steps**:
  1. Introduce narrower selection/paste selectors (range, drag state, clipboard metadata) so `useDrawingHandlers` and Canvas utilities only subscribe to the fields they mutate.
  2. Extract the slice and wire `setFloatingPaste`, `setSelectionRange`, delete/confirm actions, and ROI batching to the helper module (including a shared buffer pool when Selection/Paste batching lands).
  3. Add regression tests covering marquee delete, paste confirm/cancel, keyboard shortcuts (Delete, Enter, Escape), and monitor ROI capture timings for large selections (perf probe hook).

## 6. Tools & Brush Slice  [ ]
- **State (target)**: `tools` (current tool, brush settings, eraser settings), `globalBrushSize`, `pressureSettings`, `polygonGradientState`, `shapeToolState`, custom brush editor state.
- **Actions (target)**: `setCurrentTool`, `setBrushSettings`, `setEraserSettings`, `setGlobalBrushSize`, `setCustomBrushSizePercent`, `setPolygonGradientState`, `setShapeToolState`, custom brush CRUD (`addCustomBrush`, `updateCustomBrush`, `removeCustomBrush`, `setDefaultCustomBrush`, `saveCustomBrushAsPreset`).
- **Dependencies**: `createCustomBrushPersistence`, `BrushRegistry`, `brushThumbnailGenerator`, `pressureOptimizer`, `useBrushEngineSimplified`, `BrushLibrary` selectors.
- **Status / Next Steps**:
  1. Finish selector migration for tool consumers (`BrushControls`, `BrushLibrary`, `CustomBrushPanel`, keyboard hook).
  2. Split out polygon gradient state so `useDrawingHandlers` can subscribe narrowly.
  3. Extract the slice and add coverage for brush size syncing (global size ↔ eraser, custom percent conversions).

## 7. Shape Fill Slice  [ ]
- **State (target)**: `shapeFill` session data (`activeFill`, `pendingPayload`, `shapeFillSession`), `polygonGradientState` (if not kept in Tools slice), `shapeFillCursor`.
- **Actions (target)**: `beginShapeFillSession`, `updateShapeFillCursor`, `commitShapeFillParameter`, `finalizeShapeFillSession`, `cancelShapeFillSession`, `setPolygonGradientState` (if owned here).
- **Dependencies**: `ShapeFillOrchestrator`, `BrushEngine`, `layersSlice` (for applying fill results), `historySlice` (capture), `GradientEditor` (UI sync).
- **Next Steps**: After Tools slice extraction, evaluate whether polygon gradients belong here or remain with Tools. Regardless, isolate orchestrator hooks so they receive only the data they require.

## 8. Color Adjust & Crop Slice  [ ]
- **State (target)**: `colorAdjust` (active mode, parameters, preview state), `crop` (crop state, selection, pending ROI), `colorAdjustHistoryCursor`.
- **Actions (target)**: `setColorAdjustState`, `applyColorAdjustments`, `scheduleColorAdjustPreview`, `setCropState`, `resetCrop`, `commitCrop`, `cancelCrop`, `recordCropHistoryBaseline`.
- **Dependencies**: `cropHistory` helper (already extracted), `applyColorAdjustments`, `historySlice`, `layersSlice` (for ROI operations), `projectSlice` (for dimensions), `CanvasSnapshot` utilities.
- **Next Steps**: Once selection/tools hooks stop hitting the monolith, extract this slice so crop + color adjust flows can rely on the same helper patterns as project/layers.

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

## 11. UI & Keyboard Slice  [~]
- **Current Status**: Keyboard scope + palette swaps now use selector-based helpers. `useComprehensiveKeyboard` relies on `useStoreSelectorRef` to access scope, tools, palette, and selection without `useAppStore.getState()` calls. However, UI panels/modals remain in the monolith.
- **State (target)**: `ui.keyboardScope` (active + stack), `ui.modals`, `ui.panels`, `notifications`, `floatingPasteUI`, `transient tool overlays`.
- **Actions (target)**: `pushKeyboardScope`, `popKeyboardScope`, `setKeyboardScope`, `togglePanel`, `toggleModal`, `addNotification`, `removeNotification`, `setFloatingPaste`, `setUiTheme`.
- **Dependencies**: Selection slice (for floating paste), Tools slice (for brush editor dialogs), `KeyboardScope` helpers, `ModalPortal` components.
- **Next Steps**:
  1. Finish migrating keyboard + drawing handlers to selector refs (in-flight).
  2. Extract keyboard scope management + modal toggles into the slice and update UI components to consume selectors.
  3. Add lint-friendly hooks to prevent future `useAppStore.getState()` regressions in event listeners.

##  12. Cross-Slice Coordination & Tooling
- **Selectors**: Canonical selectors now live under `src/stores/selectors/` (project, layers, modal, paste, state). Continue adding slice-specific selectors as domains move so components avoid ad-hoc `useAppStore` picks.
- **Selector refs**: `src/hooks/useStoreSelectorRef.ts` provides a shared pattern for event handlers that need the latest store data without triggering re-subscription churn (now used by both `useComprehensiveKeyboard` and `useDrawingHandlers`).
- **Helper modules**: `projectLifecycle`, `layerStructureHistory`, `cropHistory`, `customBrushPersistence`, and `historyLifecycle` should remain the single place where cross-slice side effects live. When introducing a new slice, ensure external services talk to helpers, not directly to the store.
- **Testing**: Each slice extraction should add focused Jest coverage (e.g., `projectSelectors.test.ts`, `layersSlice.integration.test.ts`). When selectors move, update nearby tests/fixtures to use the new entry points.
- **Dev ergonomics**: `createVesselStore` composes `subscribeWithSelector` + devtools gating. Keep new slices pure and serializable, inject services at slice construction time, and document any non-serializable fields directly in the slice file.
- **ROI perf watch**: Floating paste now calls the layer slice’s ROI-aware capture helpers. When Selection/Paste batching lands, sample capture durations for large regions (via dev logging or perf hooks) and consider pooled ImageData buffers if recomposition spikes.
