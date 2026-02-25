# Shape/Brush Finalize Inventory

## Brush / Eraser (`useDrawingHandlers.finalizeDrawing`)

- **Overlay Source**: `drawingCanvasRef` (shared raster overlay).
- **ROI capture**: Bounding box tracked via `strokeBoundingBoxRef` + eraser ROI when FF.ERASER_V2.
- **History**: `commitLayerHistory` invoked per stroke with coalescing metadata, before/after ImageData snapshots, tool tags.
- **Color Cycle**: routes through `colorCycleBrushManager` and CC canvases before history.
- **Undo**: always pushes structured delta via history helpers.
- **Problem**: only paths that enter `finalizeDrawing` get ROI+history metadata; Shape Fill/polygon flows bypass it.

## Shape Fill (`DrawingCanvas.finalizeActiveShape`)

- **Overlay Source**: Renders fill strategy output directly into `drawingHandlers.drawingCanvasRef`.
- **Persistence**: Manually composites onto temp canvas, calls `captureCanvasToActiveLayer`, then `cancelShapeFillSession`.
- **History**: relies on `drawingHandlers.finalizeDrawing(false)` when overlay is reused, but ROI/history context (label, coalescing) is calculated independently. No `shapeFillHistoryContext` tie-in when initiated from App Router.
- **Issue**: When eraser fires before this manual composite, overlay replays and overwrites erased pixels.

## ShapeToolHandler (`finalizeShapeFillResult`)

- **Overlay Source**: Also writes to `drawingHandlers.drawingCanvasRef`, but handles color/ROI via `shapeFillHistoryContext` + custom ImageData clones.
- **History**: Direct `commitLayerHistory` call with handcrafted ROI and coalescing key; bypasses stroke session metadata entirely.
- **Issue**: Eraser ROI + stroke context never see these entries; undo/redo semantics diverge from brush pipeline.

## Polygon / Rectangle Gradients

- Maintain their own overlay canvases & temp canvases, then call `drawingHandlers.finalizeDrawing` in some cases but still duplicate capture logic elsewhere.
- Similar risk: operations that never run through the central finalize helper leave eraser/history unaware of pending changes.

## Takeaway

We have three parallel finalize paths writing to layers:
1. `useDrawingHandlers.finalizeDrawing` (canonical for brush/eraser).
2. `DrawingCanvas.finalizeActiveShape` (Shape Fill from App Router).
3. `ShapeToolHandler.finalizeShapeFillResult` (legacy/aux routes).

Only path (1) reliably captures ROI + history + stroke metadata. Refactor target is to funnel (2) and (3) through the same helper, so eraser and other tools always operate on committed state.
