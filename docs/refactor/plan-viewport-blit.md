# Plan: Viewport-Cropped Canvas Rendering

## Context
- **Date**: 2025-10-31
- **Reported issue**: Panning and zooming become laggy after loading large pixel-dense files.
- **Current behaviour**: `drawBase` always redraws the full project surface (checkerboard + composite canvas) every frame, even when the viewport shows only a small portion (`src/components/canvas/DrawingCanvas.tsx:500-555`).
- **Related infra**: `compositeLayersToCanvas` builds the project-sized composite (`src/stores/useAppStore.ts:6240-6354`). Pointer handlers trigger a redraw on every RAF during pan (`src/hooks/canvas/handlers/pointerHandlers.ts:1975-1994`).

## Options Recap
1. **Offscreen/ImageBitmap pipeline**  
   - Reuse `OffscreenRenderer` and `ImageBitmapTransfer` to render the composite off-main-thread and hand trimmed `ImageBitmap`s back.  
   - Est. effort: ~2–3 engineering days (feature detection, async pipeline, lifetime management) plus cross-browser QA.
2. **Viewport-cropped blit (chosen)**  
   - Compute the visible world rectangle from `offsetX`, `offsetY`, `zoom`, then call `ctx.drawImage` with matching `sourceRect`/`destRect`.  
   - Cache the checkerboard background as a pattern instead of repainting tiles each frame.  
   - Limits per-frame work to the viewport and keeps the render path synchronous.

## Goals
1. Eliminate full-project redraw during pan/zoom; clamp work to viewport dimensions.
2. Maintain parity for overlays (selection, floating paste, brush cursor) and color-cycle layers.
3. Set up instrumentation to compare frame times before/after implementation.

## Scope
- Affected modules: `src/components/canvas/DrawingCanvas.tsx`, potentially `src/utils/performanceMonitor.ts` for metrics.
- Optional helper utilities under `src/utils/` if rect/clip math cannot stay local.
- No changes to store APIs or undo/redo semantics.

## Detailed Work Plan (Option 2)

### 1. Feature Flag & Baseline
- Add a `useMemo` selector or local flag to enable the cropped render path for staged rollout.  
- Record current pan/zoom FPS using `performanceMonitor` hooks for regression comparison.

### 2. Viewport Rect Calculation
- Derive visible bounds in world space:  
  ```
  visibleWidth = viewport.width / zoom
  visibleHeight = viewport.height / zoom
  minX = clamp(-offsetX / zoom, 0, project.width)
  minY = clamp(-offsetY / zoom, 0, project.height)
  ```
- Store these values in a local object to reuse across draw steps (checkerboard, composite, overlays).  
- Ensure edge cases (negative offsets, zoom < 1, zoom > MAX) clamp correctly.

### 3. Checkerboard Pattern Cache
- Create a memoized `CanvasPattern` using a small 2× tile canvas (10×10 or existing size).  
- Replace the current double loop (`fillRect` per tile) with a single `fillRect` over the visible area using the cached pattern.  
- Invalidate/recreate pattern only when checker size changes (currently fixed).

### 4. Cropped Composite Draw
- Replace `ctx.drawImage(compositeCanvas, 0, 0)` with:
  ```
  ctx.drawImage(
    compositeCanvas,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    destX,
    destY,
    destWidth,
    destHeight
  );
  ```
- Ensure `sourceWidth/Height` clamp to project bounds and fall back to full draw if zoomed so far out that viewport exceeds project edges.
- Maintain image smoothing configuration before the draw.

### 5. Temporary Drawing Canvas & Overlays
- Update overlay draws (temporary stroke, floating paste, selection) to respect the clipped region:
  - Either: keep existing `ctx.translate(offsetX)` / `ctx.scale(zoom)` path (preferred) because the base transform still positions elements correctly inside the cropped destination.
  - Confirm that any `clearRect` or `strokeRect` calls still cover the full world area; if required, wrap them in clip paths tied to the visible rect to avoid overdraw.

### 6. Integration with Pointer Loop
- No change needed to pointer handlers; confirm RAF redraws still call `draw` with the new cropped logic.
- During panning, verify there is no flash when offset crosses project edge (test large negative offsets and maximum zoom).

### 7. Instrumentation & Metrics
- Use `performanceMonitor.mark('pan-start')` / `measure('pan-frame')` (or add equivalent) to capture frame budget before and after.
- Instrumentation implemented via `viewPerformanceTracker` (`window.vesselViewPerf` in dev) to log pan/zoom frame durations; run `vesselViewPerf.getSummary('pan')` / `'zoom'` after an interaction to capture metrics.
- Latest local readings (4000×4000 fixture, Chromium 129 @ 144 Hz): pan avg ≈ 0.04 ms (max spike 3.50 ms); zoom avg ≈ 0.01 ms (max 0.10 ms). Capture updated numbers alongside future changes.

### 8. Testing
- Add manual QA checklist:
  - Large project (≥4096²) at multiple zoom levels.
  - Panning with floating paste active.
  - Zooming while selection marquee is visible.
  - Color-cycle animation running during pan.
- Optional automated test: extend `tests/` or `src/testing/PerformanceEnhancementsTest.tsx` with viewport render assertions (non-zero pixels only within visible area).

### 9. Rollout & Cleanup
- Enable feature flag by default after verification.  
- Update `docs/maintainability-performance.md` checklist (mark checkerboard optimization as complete).  
- Capture follow-up task for Option 1 (Offscreen/ImageBitmap) once new baseline is confirmed.

## Risks & Mitigations
- **Edge clipping artifacts**: clamp source rectangles and add +1 pixel padding to avoid gaps from rounding.  
- **Checkerboard alignment drift**: base pattern origin on integer-aligned world coordinates to keep seams stable across zooms.  
- **High zoom-in (>800%)**: ensure dest sizes do not overflow float precision; fallback to full blit if rounding creates distortions.

## Validation Checklist
- [ ] `npm run lint` / `npm run type-check` pass.  
- [ ] Manual pan/zoom smoke test on large document at 25%, 100%, 400% zoom.  
- [ ] Floating paste, crop tool, and selection visuals intact.  
- [ ] Performance metrics captured and noted in PR.

## Follow-Up (Post Option 2)
- Plan implementation of Option 1 (Offscreen/ImageBitmap pipeline) using this document as the baseline.  
- Consider unifying viewport rect helper with future LOD/downsampling work.
