# TODO – Concentric Fill EDT Refactor

1. **Baseline & Instrumentation**
   - Capture current CPU/worker timings with `recordColorCycleFillPerf` under a heavy concentric fill (≥ 600k px) to lock a before snapshot.
   - 2025-11-07: Used `npx tsc scripts/perf/measure-concentric-fill.ts --outDir scripts/perf/dist && node scripts/perf/dist/scripts/perf/measure-concentric-fill.js` (3.15 M px bbox) to diff HEAD vs EDT. Legacy scanline/block ranged 98–134 ms; EDT path landed 100–152 ms (spiky scanline dropped to 101 ms from 113 ms ≈ 1.12× faster, others within ±10%). Raw JSON dumps stored in `/tmp/cc-fill-perf-before.json` and `/tmp/cc-fill-perf-after.json` for reference, summarized below:

     ```text
     label              | before ms | after ms | ratio
     decagon-scanline   |   134.05  |  138.99  | 1.04×
     decagon-block      |   128.86  |  129.68  | 1.01×
     star-scanline      |   109.96  |  114.93  | 1.05×
     star-block         |   115.70  |  117.66  | 1.02×
     concave-scanline   |   111.28  |  151.88  | 1.36×
     concave-block      |   112.02  |  107.48  | 0.96×
     spiky-scanline     |   113.45  |  101.02  | 0.89×
     spiky-block        |    98.18  |  100.00  | 1.02×
   - 2025-11-07 (post coverage-window refactor): `CC_BBOX_W=2048 CC_BBOX_H=1536 node scripts/perf/dist/scripts/perf/measure-concentric-fill.js --fixtures=concave --modes=scanline --label=concave-window` now logs JSON artifacts in `scripts/perf/results/`. Before/after concave timings:
     - `scripts/perf/results/2025-11-07T02-20-43-919Z-concave-profile.json` → 141.34 ms
     - `scripts/perf/results/2025-11-07T02-36-57-700Z-concave-window.json` → 73.24 ms (≈ 1.93× faster due to cropped EDT mask)
     ```
2. **Polygon Mask Rasterization**
   - Extract scanline span builder from `fillConcentricCore` into a reusable helper that emits a dense binary mask (Uint8Array) inside the worker.
3. **Euclidean Distance Transform**
   - Implement a two-pass EDT (Felzenszwalb) over the mask, returning a Float32 distance map plus metadata (max distance reached).
4. **Band/Dither Mapping Pipeline**
   - Replace the per-pixel edge loop with `distance -> normalized -> band/dither` logic that reuses existing jitter/noise hooks so visual output stays identical.
5. **Integration & Tests**
   - Wire the worker/client to use the EDT path, add regression tests under `src/utils/colorCycle/__tests__/` that compare legacy vs. EDT results on fixtures, and document perf deltas in `REFACTORING_SUMMARY.md`.
   - Added concave + self-touching polygon cases in `src/utils/colorCycle/__tests__/concentricFillCore.test.ts` to assert parity with an even-odd mask (<=3–4% pixel mismatch tolerance for boundary ambiguities).

# Color Cycle Shape Undo Debug Plan

## The Problem
When drawing multiple color cycle shapes on a color cycle layer, pressing undo removes ALL shapes instead of just the last one.

## Debug Logging Added

### 1. Undo Stack Monitor (`DrawingCanvas.tsx`)
- Logs when new states are saved to undo stack
- Shows description of each saved state

### 2. Shape Draw Logging (`DrawingCanvas.tsx`)
- Logs when color cycle shape is drawn
- Shows canvas state before/after operations
- Tracks resetColorCycle and fillColorCycleShape calls

### 3. Finalization Logging (`useDrawingHandlers.ts`)
- Logs when CC layer state is saved
- Shows what's being saved and with what description

### 4. ColorCycleBrush Internal (`ColorCycleBrushCanvas2D.ts`)
- Logs startStroke calls
- Shows if paint buffer exists before operations
- Tracks when stroke data is reset

### 5. Brush Engine (`useBrushEngineSimplified.ts`)
- Logs resetColorCycle calls
- Logs fillColorCycleShape process
- Shows when startStroke is called multiple times

## Test Sequence

1. Open browser console and clear it
2. Create or select a Color Cycle layer
3. Enable Shape Mode
4. Draw Shape 1 (polygon)
5. **OBSERVE CONSOLE**: Should see:
   - COLOR CYCLE SHAPE DRAW
   - resetColorCycle logs
   - fillColorCycleShape logs
   - FINALIZE logs
   - NEW UNDO STATE SAVED

6. Draw Shape 2 (another polygon)
7. **OBSERVE CONSOLE**: Same sequence as above

8. Press Ctrl+Z once
9. **OBSERVE**:
   - What does "UNDO TRIGGERED" show?
   - Do both shapes disappear or just one?

## Key Questions to Answer

1. **Are shapes being saved separately?**
   - Check if each shape creates its own undo entry
   - Look for "NEW UNDO STATE SAVED" after each shape

2. **Is resetColorCycle clearing previous data?**
   - Look for "Previous paint buffer exists?" logs
   - Check if startStroke is being called multiple times

3. **Is the paint buffer being preserved?**
   - Look for "NOT clearing paint buffer" logs
   - Check if the buffer exists between operations

## Hypothesis

The issue might be that:
1. `resetColorCycle()` calls `startStroke()` which might reset the paint buffer
2. `fillColorCycleShape()` also calls `startStroke()` again
3. Multiple `startStroke()` calls might be clearing accumulated data

## Next Steps

After running the test:
1. Analyze console output to identify where data is lost
2. Check if saves are happening correctly
3. Verify undo restoration process
4. Fix the root cause based on findings

# Shape Mode Polygon + ROI Notes

## Goal
Keep basic brush/eraser shape mode in sync with the dedicated Shape Fill tool so users can drag out a polygon (instead of click-to-add vertices) without blowing away neighboring pixels when we commit the overlay back into the active layer.

## Drag-to-Polygon Helper
- Added `ensurePolygonFromDrag` in `src/utils/shapeMaker.ts`. It resamples sparse pointer data using the existing `appendSegmentWithDynamicResampling` helper and, if we still have <3 points, expands the start/end line into a skinny quad using the active brush size.
- `useDrawingHandlers.coerceDragShapeToPolygon` now calls the helper so pixel/soft brushes get a filled polygon even when the device only emitted a mousedown + mouseup.
- Shape Tool handler reads from the same `shapePointsRef`, so Shape Fill automatically benefits.
- Tests live in `src/utils/__tests__/shapeMaker.test.ts` to cover both the helper and the resampling utility.

## ROI-Safe Finalization
- When shape mode finishes on a raster layer we previously cleared the overlay canvas before copying it into the layer framebuffer. With small ROIs this produced transparent fringes at the padding boundary.
- We now snapshot the layer before drawing (`shapeBeforeImageRef`) and, right before calling `captureCanvasToActiveLayer`, repaint the ROI slice underneath the overlay via `applyBackdropFromSnapshot` (new helper in `useDrawingHandlers`). The overlay is composited with `destination-over`, so existing pixels survive unless the new draw replaces them.
- ROI/capture path: `captureRegionFromPoints` → `captureCanvasToActiveLayer` → `layersSlice.mergeImageDataRegion`. Because we seed the overlay with the original pixels, the merged region only differs where the user actually painted.

## Open Questions / Follow-ups
- Verify Shape Fill’s preview overlay also uses the new helper (currently only the commit path does; we may want to reuse the helper in `ShapeToolHandler` previews if we see drift).
- Consider reducing `ROI_PADDING_PX` for pixel brushes now that we no longer wipe surrounding pixels, but keep it at `2` until QA confirms no halo clipping.
