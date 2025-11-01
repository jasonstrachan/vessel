# Layered Overlay Fix Plan

Goal: ensure in-progress strokes respect layer occlusion without tanking frame time.

## Step 1 – Trace Existing Pipeline
- Read `src/hooks/useDrawingHandlers.ts` to confirm when `drawingCanvasRef` populates, how bounding boxes are tracked, and what data we can reuse (ROI, stroke flags).
- Map `drawBase` in `src/components/canvas/DrawingCanvas.tsx` to understand cached composite usage, overlay draw order, and special cases (eraser, color-cycle pause guards).
- Verify how `compositeLayersToCanvas` currently sorts and renders layers, including color-cycle paths, to identify reusable logic for split buffers.

## Step 2 – Define Split Composite Strategy
- Decide on two cached canvases/bitmaps: one for layers up to and including the active layer (`underComposite`), one for layers strictly above (`overComposite`).
- Establish cache invalidation rules: when layers mutate, when the active layer changes, when blend/visibility toggles, and when color-cycle animation is active.
- Document the memory/perf budget (canvas reuse, lazy init, ROI-aware clears) before coding.

## Step 3 – Implement Split Compositor Helper
- Extract a helper (module or internal function) that iterates sorted layers once, drawing into `underCtx` or `overCtx` based on layer order relative to the active layer.
- Ensure color-cycle layers render through their managed canvases in the correct bucket, preserving animation updates.
- Add guards to reuse canvases sized to the project; clear via `ctx.clearRect` or `globalCompositeOperation = 'copy'` to avoid allocations.

## Step 4 – Integrate With Drawing Canvas
- Extend the recomposition effect in `DrawingCanvas` to refresh both composites whenever the invalidation set triggers; store refs alongside the existing `compositeCanvasRef`.
- Update `drawBase` overlay path: draw `underComposite`, then the live `drawingCanvasRef`, then `overComposite`, all clipped to `visibleRect`.
- Preserve current fast paths (pure cache, active-layer-on-top) by short-circuiting when `overComposite` is empty or overlay disabled.

## Step 5 – Handle Edge Cases and Sampling
- Confirm eraser and selection flows still skip composite redraw when necessary (e.g., eraser preview covering entire layer).
- Ensure sampling utilities that read from `compositeCanvasRef` still return expected colors; decide whether they should include the overlay or stay as-is.
- Verify color-cycle playback, blend modes, and floating paste rendering still behave with the new layering order.

## Step 6 – Validation & Follow-Up
- Add or update tests around any new helper (unit for layer splitting, integration if feasible).
- Manually test drawing on lower layers, animating color-cycle layers, and high-resolution canvases for perf regressions.
- Run `npm run lint`, `npm run type-check`, and targeted tests before handing off; note any remaining risks or ideas for ROI-based redraw optimizations.
