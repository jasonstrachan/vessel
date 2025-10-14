# Undo/Redo State Inventory

This inventory enumerates the state managed by `src/stores/useAppStore.ts` and records how each slice should participate in the redesigned history system.

| Key Path | Type | Undo Participation | Restoration Requirements | Notes |
| --- | --- | --- | --- | --- |
| `project` | `Project \| null` | **Yes** | Preserve `layers`, dimensions, metadata, timestamps. Rehydrate `customBrushes` references. | Snapshot root document. Normalize via `normalizeProject` on restore. |
| `webglExportSettings` | `WebGLExportSettings` | Optional | Restore export toggles if user expects undo to revert export prefs. | Consider excluding from document undo by default. |
| `layersNeedRecomposition` | `boolean` | Derived | Recompute after apply. | Not persisted; set `true` when bitmap deltas applied. |
| `globalBrushSize` | `number` | Optional | Restore slider position if tool setting undo expected. | Might live in view/tool history. |
| `defaultBrushesSize`, `customBrushesSize` | `number` | Optional | Restore if undo should revert global brush adjustments. | Tie into tool-setting deltas. |
| `defaultBrushSizes` | `Record<string, number>` | Optional | Restore per-brush overrides. | Rarely mutated. |
| `brushSpecificSettings` | `Record<string, Partial<BrushSettings>>` | Optional | Restore saved presets for undo of preset edits. | Mutation occurs in brush editor flows. |
| `history` | `HistoryState` | N/A | Owned by new HistoryManager. | Replace with manager façade. |
| `canvas` | `CanvasState` | **Yes (view delta)** | Restore zoom, rotation, grid, offsets, selection metadata, cursor when view undo triggered. | Distinguish between document and view history. |
| `canvasViewport` | `{left, top, width, height}` | Derived | Recompute from layout. | Likely excluded. |
| `selectionStart`, `selectionEnd` | `{x,y}\|null` | **Yes** | Restore marquee coordinates; re-run selection visual update. | Pair with `canvas.selection`. |
| `crop` | `CropState` | **Yes** | Restore status (`idle|dragging|commitInFlight`) and marquee. | Needed for cancelling/redoing crop actions. |
| `floatingPaste` | `FloatingPasteState \| null` | **Yes** | Recreate floating paste canvas and position; ensure source layer ID valid. | Undo must revive in-progress floating paste. |
| `shapeFill` | `ShapeFillState` | **Yes (session)** | Restore active fill ID, params, `session`, order, flags. | Required for shape session undo/redo. |
| `shape` | `ShapeState` | **Yes (session)** | Restore drawing status, points, preview path. | Manage transactional undo boundaries. |
| `polygonGradient` | `PolygonGradientState` | **Yes** | Restore in-progress polygon gradient data. | Coupled with gradient worker jobs. |
| `rectangleBrush` | Local state | Optional | If rectangle brush enables live preview, include for session undo. |
| `tools` | `ToolState` | **Yes** | Restore current tool, brush/eraser/fill settings, shape mode flags. | Needed for undoing tool switches tied to actions. |
| `currentBrushPreset`, `currentBrushComponent` | Derived | Restore when relevant; ensure references valid. |
| `customBrushes` (within `project` and accessors) | Already part of `project` | — | Manage via project deltas. |
| `brushEditor` | `BrushEditorState` | Optional | Undo/redo inside editor may be separate. | Typically modal/local; consider local history. |
| `currentOffscreenCanvas` | `HTMLCanvasElement \| null` | Runtime | Recompute by recompositing layers. | Not serialized. |
| `autosave` | `AutosaveState` | Runtime | Update `hasUnsavedChanges` based on history commits. | Not undoable. |
| `layers` (via `project.layers` and store helpers) | See `project` | — | Deltas cover layer bitmap + structure. |
| `colorCycleBrushManager` state | External singleton | **Yes** | Rehydrate via dedicated adapters from Color Cycle deltas. | Not in store directly but must be updated. |
| `notifications` | `Notification[]` | Optional | Typically UI only; probably exclude. |
| `ui.panels`, `ui.modals`, `ui.theme`, `keyboardScope` | `UIState` | Optional | Consider view history or ignore for document undo. |
| `memoryCleanup`, `performanceMonitor`, etc. | Services | Runtime | No undo. |
| `panes`, `timeline`, `layerPanel`, etc. | Derived | No undo. |

## Action Taxonomy (Initial Draft)

| Action ID | Description | Typical Deltas | Notes |
| --- | --- | --- | --- |
| `brush-stroke` | Raster brush on bitmap layer | Tile bitmap delta, tool state snapshot, view nudge | Coalesce while pointer down. |
| `cc-stroke` | Color Cycle brush stroke | Command delta (seed, params, stroke path) + fallback tile patch | Needs runtime rehydration. |
| `eraser-stroke` | Eraser usage | Tile bitmap delta, tool state | Shares infrastructure with brush. |
| `fill` | Flood fill / shape fill commit | Tile bitmap delta, selection delta | Ensure color-cycle compatibility. |
| `layer-structure` | Add/remove/reorder layers | Layer list delta, active layer change | Record metadata + order. |
| `layer-bitmap` | Non-stroke bitmap change (paste, filter, crop) | Tile bitmap delta, percent-offset sync | |
| `project-transform` | Canvas resize, background change | Project metadata delta, view-state correction | |
| `shape-session` | Shape drawing updates during drag | Session delta capturing live points & params | Undo mid-session resumes interaction. |
| `shape-commit` | Shape finalized into pixels | Tile bitmap delta, selection update | Transaction boundary. |
| `selection-change` | Selection create/move/delete | Selection bounds delta, `canvas.selection` clone | Distinguish from view actions. |
| `view-state` | Zoom, rotation, pan adjustments | View delta | Optional inclusion in document history. |
| `floating-paste` | Paste placement commit/cancel | Bitmap delta + floating state | |
| `crop` | Crop commit/cancel | Project size delta, layer bitmap deltas, color cycle rebuild commands | |
| `settings-change` | Brush or tool setting adjustments | Tool state delta | maybe toggled via preference. |

## Transaction & Session Considerations

- **Shapes**: use `shape-session-start`, repeated `shape-session-update`, and `shape-session-end`/`-commit` events so undo during a drag rehydrates `ShapeFillState.session` and `ShapeState`.
- **Floating Paste**: treat the floating canvas as transactional; undo should resurrect active paste rather than flattening the pixels.
- **Color Cycle**: per-stroke action stores deterministic command payloads; include fallback region patches when determinism fails (e.g., GPU differences).
- **View vs Document**: default history excludes pure view changes; allow opt-in or separate view-history stack.
- **Crash Recovery**: only persist entry headers + blob references; blob payloads stored via the blob service described in the main architecture doc.

This document should be updated when additional store slices are introduced. Each new mutator must be annotated with its expected history action and deltas.
