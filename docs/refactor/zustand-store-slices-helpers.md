# useAppStore Helper Inventory

This note catalogs the key helper functions and shared utilities embedded in `src/stores/useAppStore.ts`. Each row calls out dependencies we must preserve or inject when the monolithic store is split into slices.

## Progress Log (Nov 3, 2025)
- Autosave slice no longer depends on inline helpers; state/actions moved to `src/stores/slices/autosaveSlice.ts`.
- Palette slice composed; palette mutation helpers (`setPaletteColor`, swaps, sync) now live in `src/stores/slices/paletteSlice.ts`.
- Project lifecycle, persistence flows, and canvas compositing now centralized in `src/stores/helpers/projectLifecycle.ts` and consumed by `useAppStore`.
- History snapshot/undo glue promoted to `src/stores/helpers/historyLifecycle.ts`; palette rehydration during legacy restores now uses `applyPaletteSnapshot` from `src/stores/helpers/paletteState.ts`.
- Remaining helpers below still live in the monolith and will need destinations as their owning slices emerge.

| Helper | Responsibility | Depends On | Primary Consumers / Notes |
| --- | --- | --- | --- |
| `entryRequiresComposite` | Flag whether a history entry requires recomposition | `NON_COMPOSITE_DELTA_TAGS`, history deltas | Relocated to `src/stores/helpers/historyLifecycle.ts`; consumed by undo/redo flows |
| `syncPercentOffsetsFromPixels` | Recompute layer alignment percent offsets | `computePercentOffsetFromPixels`, `computeLayerPercentOffset`, project | Layer updates, crop operations |
| `recordCropHistory` | Build history deltas for crop operations | `historyManager`, `mapCanvasActionToHistoryId`, `cloneLayerImageData`, `createBitmapTileDelta`, `captureColorCycleBrushState` | Crop commit flow; must stay close to history slice |
| `cloneGradientStops` / `gradientsEqual` / `findStoredColorCycleGradient` | Manage gradient presets and dedupe writes | Brush preset persistence | Brush/tools slice |
| `applyPressureUpdate` / `applyPressureToTools` | Normalize brush pressure settings across tools | `clampPressurePercent`, tool state | Tools slice actions |
| `getSerializableBrushSettings` | Strip volatile fields before persistence | Brush settings shape | Brush-specific persistence |
| `isShapeCapableTool`, `isColorCycleBrushShape` | Tool/brush classification helpers | `BrushShape` enum | Tool mode switching, color cycle logic |
| `cancelScheduledColorAdjustPreview` / `scheduleColorAdjustPreview` | Debounced color adjust preview management | `window`, `RecolorManager`, current state via getter | Color adjust slice; relies on global timeout IDs |
| `clampSelectionBounds`, `copyRegionIntoTarget` | Selection ROI utility | Canvas/layer dimensions | Selection slice, floating paste |
| `cloneImageDataForHistory`, `cloneLayerForHistory`, `createHistorySnapshotFromState` | Serialize layer snapshots for undo/redo | `cloneLayerImageData`, history state | Lives in `src/stores/helpers/historyLifecycle.ts`; future history slice imports from there |
| `applyPaletteSnapshot`, `updateToolsWithPalette` | Align store palette/project/tools state from persisted data | `paletteState` helpers, project palette | Added in `src/stores/helpers/paletteState.ts`; used by project lifecycle + legacy history restores |
| `isSerializedColorCycleBrushState` | Type guard for color-cycle restoration | Serialized payload shape | Project import/export |
| `resolveActiveKeyboardScope` | Determine active keyboard scope | Keyboard scope stack | UI slice keybinding logic |
| Shape fill helpers (`cloneVec2`, `cloneShapeSession`, `cloneDefaultShapeFillParams`, `sanitizePersistedParams`, `loadPersistedShapeFillState`, `persistShapeFillState`, `createInitialShapeFillState`, `pickFillParamsForPersist`) | Manage shape fill orchestrator persistence and cloning | `window.localStorage`, `ShapeFillOrchestrator`, strategy list | Shape fill slice |
| `scheduleCompositeBitmapRelease` | Delay-dispose `ImageBitmap` resources | `window`, `compositeBitmapManager` | Composite bitmap management in canvas slice |
| `shapeFillOrchestratorInstance` (and attached listener) | Bridge external orchestrator events into store updates | `ShapeFillOrchestrator`, `cloneShapeSession` | Shape fill slice |
| Global subscriptions (`setLayerIdGetter`, `configureMaskManager`, `useAppStore.subscribe`, debug wrappers) | Expose store accessors to external systems | `colorCycleBrushManager`, `MaskManager`, `historyManager`, global window | Need dedicated adapter layer after slice split |

### Observations
- Many helpers share `get()` or `set()` closures; when extracting slices, inject these helpers via factories (e.g., pass `get`, `set`, or slice selectors).
- IO-oriented helpers (`applyLoadedProject`, `hydrateCustomBrushesFromStorage`, `persistCustomBrushes`) touch multiple concerns (project, layers, brushes, palette). They likely belong in a project/service module instead of any single slice.
- History helpers depend on global `historyManager`. Consider wrapping that manager in the history slice so other slices import through the slice API instead of touching globals.
- Debounced/async helpers that access `window` (`scheduleCompositeBitmapRelease`, color adjust previews, brush hydration) need safe guards for SSR and should live in a service layer injected into slices.

### Immediate Next Work
- Extract the crop/history bridge (`recordCropHistory`, selection deltas) into a dedicated helper so the project/history slices stay lean.
- Wire `historyLifecycle` into an actual `createHistorySlice` and migrate `history` state/actions out of `useAppStore`.
- Continue replacing ad-hoc palette mutations (e.g., project load/new project) with `applyPaletteSnapshot` to keep palette + project/tool state in sync.

This inventory should make it easier to decide which utilities migrate into shared modules versus slice-local helpers during the refactor.
