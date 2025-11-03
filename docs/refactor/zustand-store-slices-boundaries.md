# Proposed Zustand Slice Boundaries

This document outlines the target slice decomposition for `useAppStore`. Each slice lists the state keys/actions it will own, expected dependencies, and integration notes for helpers or external services.

## Status Snapshot (Nov 3, 2025)
- [x] **Autosave & File Backup** — fully extracted (`src/stores/slices/autosaveSlice.ts`) and composed through `createVesselStore`.
- [x] **Palette** — delegated to `src/stores/slices/paletteSlice.ts`; inline palette logic removed from `useAppStore`.
- [~] **Project** — lifecycle/persistence/compositing handled via `src/stores/helpers/projectLifecycle.ts`; history snapshot + undo/redo glue now lives in `src/stores/helpers/historyLifecycle.ts`; project slice definition still pending.
- [ ] **Layers & Composition** — pending.
- [ ] **Canvas Viewport** — pending.
- [ ] **Selection & Paste** — pending.
- [ ] **Tools & Brush** — pending.
- [ ] **Shape Fill** — pending.
- [ ] **Color Adjust & Crop** — pending.
- [ ] **History** — pending.
- [ ] **UI & Keyboard** — pending.

### Upcoming Focus (ordered)
1. **Finish Project slice** — compose a dedicated slice on top of `projectLifecycle` + `historyLifecycle`, wiring selectors and palette helpers.
2. **Extract History slice** — migrate history state/actions now that undo/redo lives in `historyLifecycle`.
3. **Layers & Composition** — split layer CRUD + composition flags, leveraging the project/history helpers.
4. **Canvas Viewport** — separate viewport/canvas transform state to reduce cross-domain churn.
5. Remaining UI-centric slices (Selection, Tools, Shape Fill, Color Adjust/Crop, UI/Keyboard).

## 1. Project Slice [~]
- **Current Status**: Lifecycle, persistence, capture, and compositing flows live in `src/stores/helpers/projectLifecycle.ts`. History snapshot + undo/redo helpers were lifted into `src/stores/helpers/historyLifecycle.ts`, and palette rehydration now funnels through `applyPaletteSnapshot`. Actions are still exposed via `useAppStore`.
- **State (target)**: `project`, `projectFilename`, `projectFileHandle`, `webglExportSettings`, `globalBrushSize`, `brushSpecificSettings` (palette handled separately).
- **Actions (target)**: `setProject`, `updateProject`, `setExportLayout`, `updateWebglExportSettings`, `saveProject`, `loadProject`, `importProject`, `exportProject`, `newProject`, `captureCanvasToActiveLayer`, `captureCanvasToLayer`, `compositeLayersToCanvas`.
- **Dependencies**: Custom brush persistence helper, color-cycle manager (orphan cleanup + runtime updates), palette slice (for foreground/background sync), history helper (once extracted).
- **Next Steps**:
  1. Define a `createProjectSlice` that consumes `projectLifecycle`, `historyLifecycle`, and palette helpers while exposing only project-domain state/actions.
  2. Migrate components/hooks to use project selectors and remove direct project mutations from `useAppStore`.
  3. Document slice boundaries and coordinate history-dependent services (capture/composite) for reuse in tests.

## 2. Palette Slice ✅
- **State**: `palette`, `paletteDirty`.
- **Actions**: `setPaletteColor`, `setActiveColor`, `swapPaletteColors`, `setActivePaletteSlot`, `syncPaletteFromTool`.
- **Dependencies**: Palette defaults from `layoutDefaults`, project slice (for palette persistence), tools slice (for brush color sync).
- **Notes**: Implemented in `src/stores/slices/paletteSlice.ts` and composed through `useAppStore`. No further action required beyond keeping future project/tool slices aligned.

## 3. Layers & Composition Slice [ ]
- **State**: `layers`, `activeLayerId`, `selectedLayerIds`, `referenceLayerId`, `currentLayer`, `layersNeedRecomposition`.
- **Actions**: CRUD operations (`addLayer`, `removeLayer`, `updateLayer`, `setLayers`, `reorderLayers`, `setActiveLayer`, `setReferenceLayer`, `setSelectedLayerIds`, `updateLayerAlignment`), color-cycle lifecycle hooks (`initColorCycleForLayer`, `cleanupColorCycleForLayer`, `getLayerColorCycleBrush`).
- **Dependencies**: Requires injection of color-cycle brush manager, `syncPercentOffsetsFromPixels`, history utilities for layer-structure transactions, and mask manager hooks. Needs read-only access to project dimensions for alignment updates.
- **Notes**: Provide selectors for active layer, layer list, and recomposition flag to avoid cross-slice access.

## 4. Canvas Viewport Slice [ ]
- **State**: `canvas`, `canvasViewport`, `currentCompositeBitmap`, `currentOffscreenCanvas`.
- **Actions**: `setZoom`, `setRotation`, `setGridSize`, `setCanvasOffset`, `setCanvasViewport`, `toggleRulers`, `setDisplayMode`, `setCanvasDimensions`, `setProjectDimensions`, `resizeCanvas`, `setSelection`, `setCursor`, `setCurrentCompositeBitmap`, `setCurrentOffscreenCanvas`.
- **Dependencies**: Relies on project dimensions, selection utilities, `scheduleCompositeBitmapRelease`, composite bitmap manager, and potentially layer slice for recomposition triggers.
- **Notes**: Keep resizing logic (and OffscreenCanvas interaction) here but ensure complex operations use helpers to avoid massive slice files.

## 5. Selection & Paste Slice [ ]
- **State**: `selectionStart`, `selectionEnd`, `floatingPaste`.
- **Actions**: `setSelectionBounds`, `clearSelection`, `selectAllActiveLayerPixels`, `deleteSelectedPixels`, `setFloatingPaste`, `updateFloatingPastePosition`, `updateFloatingPasteRect`, `commitFloatingPaste`, `cancelFloatingPaste`.
- **Dependencies**: Uses layers slice (active layer data), `clampSelectionBounds`, `copyRegionIntoTarget`, `normalizeCaptureROI`, history hooks, and project dimensions. Needs `mergeImageDataRegion` for ROI updates.
- **Notes**: Provide derived selectors for active selection rect and floating paste state to keep canvas components lean.

## 6. Tools & Brush Slice [ ]
- **State**: `tools`, `brushPresets`, `currentBrushPreset`, `activeBrushComponents`, `temporaryCustomBrush`, `brushEditor`, `shapeState`, `rectangleBrushState`, `polygonGradientState`, `recolorSampling`, `colorCyclePlayback`.
- **Actions**: Tool switching, settings setters (`setCurrentTool`, `setBrushSettings`, `setEraserSettings`, etc.), custom brush management (`addCustomBrush`, `updateCustomBrush`, `removeCustomBrush`, `setDefaultCustomBrush`, `saveCustomBrushAsPreset`), brush editor operations, shape tool updates, recolor sampling toggles, color-cycle controls (`playColorCycle`, `pauseColorCycle`, etc.).
- **Dependencies**: Connects to project slice for palette colors, layers slice for layer-specific operations, color-cycle brush manager, gradient helpers, pressure helpers, `scheduleColorAdjustPreview`, hydration/persistence utilities. Needs injection of `ShapeFillOrchestrator` hooks.
- **Notes**: Consider sub-slices (tools core vs. custom brush vs. brush editor) inside this module to keep files manageable.

## 7. Shape Fill Slice [ ]
- **State**: `shapeFill`.
- **Actions**: `setShapeFillActiveFill`, parameter setters, session lifecycle (`beginShapeFillSession`, `updateShapeFillCursor`, `commitShapeFillParameter`, `finalizeShapeFillSession`, `cancelShapeFillSession`).
- **Dependencies**: `ShapeFillOrchestrator`, `pickFillParamsForPersist`, persistence helpers, layers slice for applying results, history manager for commit operations.
- **Notes**: Could be merged into Tools slice if we keep strong separation via internal files, but dedicated slice improves clarity around orchestrator link.

## 8. Color Adjust & Crop Slice [ ]
- **State**: `colorAdjust`, `crop`.
- **Actions**: Color adjust session controls, crop state updates (`setCropState`, `resetCrop`, `commitCrop`, `cancelCrop`).
- **Dependencies**: Uses `recordCropHistory`, `applyColorAdjustments`, `scheduleColorAdjustPreview`, layer slice for ROI operations, history manager.
- **Notes**: Crop action touches layers + project dimensions; exposing service functions from layers/project slices will ease integration.

## 9. History Slice [ ]
- **State**: `history`.
- **Actions**: `undo`, `redo`, `canUndo`, `canRedo`, `clearHistory`.
- **Dependencies**: `historyLifecycle` (wraps `historyManager`, composite detection, and pending queues), palette/project helpers for rehydration, selection/layer/project slices to restore state.
- **Notes**: Provide `withColorCycleSuspended` (or coordinate with Tools slice) so history actions can pause color-cycle animation.

## 10. Autosave & File Backup Slice ✅
- **State**: `autosave`.
- **Actions**: `setAutosaveEnabled`, `setFileBackupEnabled`, `setFileBackupMode`, `setFileBackupFile`, `setFileBackupDirectory`, `clearDirtyState`, `updateFileBackupTime`, `setAutosaveInterval`, `setHistorySize`.
- **Dependencies**: `historyManager` (for size), external `autosaveService`, file-system handles coming from browser APIs.
- **Notes**: Keep pure state here; actual autosave timers live in service modules that subscribe to selectors. Implemented in `src/stores/slices/autosaveSlice.ts` and composed via `createVesselStore` (Nov 3, 2025).

## 11. UI & Keyboard Slice [ ]
- **State**: `ui`.
- **Actions**: `togglePanel`, `toggleModal`, `setTheme`, notifications (`addNotification`, `removeNotification`), keyboard scope stack management (`pushKeyboardScope`, `popKeyboardScope`).
- **Dependencies**: `resolveActiveKeyboardScope` helper, maybe Tools slice for UI-specific defaults.
- **Notes**: This slice should expose selectors for modal/panel status to reduce redundant store reads.

## Cross-Slice Coordination
- **Services/Adapters**: Create lightweight adapter modules (`projectService`, `customBrushService`, `historyService`, `colorCycleService`) that compose multiple slice actions with external dependencies. This keeps slices small and allows reuse in tests.
- **Selector Helpers**: Introduce `createAppSelector` that wires `subscribeWithSelector` + shallow equality. Each slice should export canonical selectors (e.g., `selectActiveLayer`, `selectCanvasTransform`, `selectAutosaveSettings`).
- **Middleware**: All slices should be composed via a shared store factory that applies `subscribeWithSelector`, `immer` (if reintroduced), and devtools gating only in development.

These boundaries keep related state/actions together, clarify dependencies, and make subsequent refactors (drawing handlers, export pipeline) easier to stage.
