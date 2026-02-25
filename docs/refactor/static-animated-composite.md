# Static/Animated Composite Split

## Goal

Reduce the amount of work performed on every `colorCycleFrameUpdate` by caching two artifacts:

1. **Static stack** – background + non–color-cycle layers rendered once, stored as both a canvas and an `ImageBitmap`.
2. **Animated overlay** – only the brush/recolor color-cycle canvases rendered per animation tick on a lightweight surface.

`DrawingCanvas` now blits the cached bitmap followed by the overlay canvas, so color-cycle playback no longer forces a full `layers × pixels` recomposition.

## Store API changes

- `renderStaticComposite(targetCanvas, opts)` draws the static stack, bumps `staticCompositeVersion`, and refreshes `currentCompositeBitmap` via `createImageBitmap`.
- `renderColorCycleOverlay(targetCanvas)` clears and redraws active color-cycle canvases (brush + recolor) and returns `boolean` indicating whether anything was painted.
- `staticCompositeVersion` tracks the most recent successful rebuild so components can memoize.

Both helpers live in `layersSlice` and share utilities for drawing raster layers vs. animated layers. They respect the existing `setLayersNeedRecomposition` flag and reuse the `colorCycleBrushManager` to advance brush animations when necessary.

## What invalidates the static cache?

The following areas already call `setLayersNeedRecomposition(true)`, which now signals “rebuild static stack”:

| Category | Modules / Files |
| --- | --- |
| History + Undo/Redo | `history/deltas/bitmapDelta.ts`, `history/helpers/historyLifecycle.ts`, `history/runtimeRehydration.ts`, `history/deltas/projectTransformDelta.ts` |
| Project lifecycle / IO | `stores/helpers/projectLifecycle.ts`, `history/applyLegacySnapshot.ts`, `utils/crashRecovery.ts` |
| Selection / clipboard | `stores/slices/selectionSlice.ts`, `stores/helpers/selectionPaste.ts` |
| Crop + resize | `stores/slices/cropSlice.ts`, `utils/crop/ccRebuild.ts` |
| Color adjust | `stores/slices/colorAdjustSlice.ts` |
| Brush engine + stroke processors | `hooks/useBrushEngineSimplified.ts`, `hooks/canvas/handlers/shapes/ShapeToolHandler.ts` |
| Tooling glue | `hooks/useDrawingHandlers.ts`, `hooks/canvas/handlers/pointerHandlers.ts` |

Anything that mutates raster pixel data, layer order, visibility, opacity, blend mode, or the project background should continue setting this flag. The compositor effect in `DrawingCanvas.tsx` listens to `layersNeedRecomposition` + hash changes and calls `rebuildStaticComposite()`.

## Drawing pipeline updates

- `DrawingCanvas` keeps two refs: `compositeCanvasRef` (static) and `colorCycleOverlayCanvasRef` (animated).
- `rebuildStaticComposite()` ensures the static canvas exists, invokes the store helper, syncs `currentOffscreenCanvas`, and immediately refreshes the overlay so paused CC layers stay visible.
- `refreshColorCycleOverlay()` is triggered on every `colorCycleFrameUpdate` event; no more full recomposition inside that handler.
- The main draw function now draws the cached bitmap/canvas first, then overlays `colorCycleOverlayCanvasRef` before the live drawing buffer.

## Testing

`src/stores/__tests__/layersSlice.compositeSplit.test.ts` covers the separation by asserting that raster pixels land in the static canvas while color-cycle pixels appear only in the overlay canvas.

## Follow-ups

- Export/utility callers that still need the old “full composite” can continue using `compositeLayersToCanvas`. Everything UI-facing should prefer the new helpers to avoid redundant work.
- If future features need visibility into cache churn, subscribe to `staticCompositeVersion` rather than re-rendering immediately.
