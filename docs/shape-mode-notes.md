# Shape Mode Drag & ROI Notes

Last updated: 2025-11-09

## Overview

Shape mode is used by both the “shape fill” brush preset and the regular brush/eraser tools whenever the shape toggle is enabled. Recent fixes made two notable changes so that all shape-capable tools share the same gesture logic and never clear pixels outside the intended polygon.

## Shared Drag Helper

- `src/utils/shapeMaker.ts` now exports `ensurePolygonFromDrag`. It accepts the current shape point buffer, the drag start/end coordinates, zoom, and brush size.
- The helper first attempts to resample the segment via the existing `appendSegmentWithDynamicResampling` function so a short drag still produces a dense polyline.
- If there are still fewer than three vertices, the helper expands the drag vector into a skinny quad whose half width equals `max(2, brushSize * 0.5)`. This mirrors how Shape Fill used to infer rectangles manually.
- `useDrawingHandlers.coerceDragShapeToPolygon` is now a thin wrapper around the helper, so both the brush toggle and Shape Fill see identical `shapePointsRef` data before preview/finalization. Unit coverage lives in `src/utils/__tests__/shapeMaker.test.ts`.

## ROI-Safe Overlay Capture

- During shape finalization we snapshot the active layer (`shapeBeforeImageRef`) before any overlay rendering occurs. When the overlay canvas is ready to commit, `applyBackdropFromSnapshot` (in `src/hooks/useDrawingHandlers.ts`) repaints the ROI portion of that snapshot underneath the overlay using `destination-over`.
- We then capture the overlay via `captureCanvasToActiveLayer(drawingCanvas, roi)`. Because the overlay already contains the prior pixels plus the new fill, downstream ROI merges (`layersSlice.mergeImageDataRegion`) never punch transparent holes around the polygon padding.
- This applies to regular raster layers; color-cycle layers still finalize through their brush manager path.

## Practical Notes

- ROI padding remains `ROI_PADDING_PX = 2`. With the backdrop step in place we can consider shrinking this in the future without risking clipped edges.
- If you add another tool that builds shapes from drag gestures, import `ensurePolygonFromDrag` instead of re-implementing the fallback logic.
- Tests: `npm test -- shapeMaker` validates the helper, while the ROI behavior relies on existing integration tests plus manual QA (draw over existing artwork and confirm no halo is erased).
