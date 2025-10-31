# Spike Plan: Offscreen/ImageBitmap Composite Pipeline

## Context
- **Date**: 2025-10-31
- **Primary Goal**: Reduce pan/zoom frame cost further by moving composite generation off the main thread and transferring pre-cropped buffers via `ImageBitmap`.
- **Current Baseline**: Viewport-cropped blit (Option 2) is active; pan averages ≈ 0.04 ms per frame on 4k fixture (`plan-viewport-blit.md`).

## Problem Statement
Even with viewport clipping, the main thread still:
- Runs layer compositing synchronously inside `compositeLayersToCanvas` (`src/stores/useAppStore.ts:6239`), recreating temporary canvases and `putImageData` calls per layer.
- Copies large project regions into the display canvas for each redraw (`ctx.drawImage` of the composite texture).

We want to offload compositing and large surface preparation to background canvases/workers, transferring only lightweight `ImageBitmap` handles to the main render loop.

## Objectives
1. Prototype an off-main-thread compositing path that renders layers into an `OffscreenCanvas`.
2. Transfer resulting frames as `ImageBitmap` instances for `DrawingCanvas` to draw with minimal overhead.
3. Support feature detection (fallback to existing path if OffscreenCanvas or ImageBitmap is unavailable).
4. Measure impact on pan/zoom performance and color-cycle playback.

## Scope
- Files likely touched:
  - `src/stores/useAppStore.ts` — extract compositing into a new service, cache ImageBitmaps.
  - `src/utils/performanceMonitor.ts` / new helpers — track compositor timings.
  - `src/components/canvas/DrawingCanvas.tsx` — accept ImageBitmap outputs, adjust draw path.
  - `src/lib/performance/OffscreenRenderer.ts`, `src/lib/performance/ImageBitmapTransfer.ts` — reuse or extend.
- Out of scope: rewriting color-cycle renderer or brush engine logic; Option 2 remains default fallback.

## Spike Tasks

1. **Capability Detection & Guardrail**
   - Add util `supportsOffscreenComposite()` that checks `OffscreenCanvas`, `createImageBitmap`, and `transferControlToOffscreen`.
   - Expose dev console warning when running fallback path (for measurement clarity).

2. **Compositor Service Prototype**
   - Create `src/lib/performance/CompositeWorkerManager.ts` (or similar) that:
     - Accepts layer descriptors (imageData, opacity, blend mode, color-cycle hooks).
     - Uses `OffscreenRenderer` to draw onto offscreen surface.
     - Returns an `ImageBitmap` trimmed to project extent.
     - Debounces composite rebuilds on rapid layer changes.
   - Support both worker-backed and main thread offscreen modes (for easier spike).

3. **Main Thread Integration**
   - Update store to request composites through the new manager and cache the resulting `ImageBitmap` alongside the previous `HTMLCanvasElement`.
   - Ensure lifecycle cleanup (`bitmap.close()`) when replacing frames to avoid leaks.

4. **DrawingCanvas Adaptation**
   - Extend `drawBase` to branch:
     - If `currentCompositeBitmap` available, draw subset using viewport rect.
     - Otherwise fallback to `compositeCanvasRef`.
   - Ensure overlays (drawing canvas, selection, floating paste) still render in correct order.

5. **Performance Instrumentation**
   - Log compositor timings via `viewPerformanceTracker` or new monitor.
   - Capture frame timings before/after integration on high-resolution projects.

6. **Failure Modes & Fallbacks**
   - Define fallback triggers (e.g., worker throw, `createImageBitmap` rejection).
   - Make fallback path resilient (clear cached bitmap, rebuild via current sync path).

7. **Testing Strategy**
   - Manual QA:
     - Verify behavior on browsers that support OffscreenCanvas (Chrome, Edge).
     - Confirm fallback works on Safari/Firefox (if OffscreenCanvas not supported).
     - Exercise color-cycle playback, pan/zoom, undo/redo.
   - Automated:
     - Add lightweight jest test stubs for capability detection.
     - Optionally integrate `PerformanceEnhancementsTest.ts` to compare fps metrics.

## Risks & Mitigations
- **Worker serialization overhead**: passing large `ImageData` can be expensive. Mitigate via transferable buffers or reuse offscreen canvas without copying.
- **Browser support variability**: Safari lacks full OffscreenCanvas; ensure fallback path covers this.
- **Bitmap lifecycle leaks**: must close bitmaps promptly; add stress test to ensure no unbounded growth.
- **Concurrency issues**: Compositor updates could race with main thread draws; design manager API with message IDs or version tokens.

## Success Criteria
- Spike demonstrates working offscreen path with measurable main thread savings (>10% reduction in pan frame time under load).
- No regressions in rendering correctness (parity with fallback path).
- Clear path to production implementation (list of TODOs, identified blockers).

## Deliverables
- Prototype branch / PR (behind feature flag) with instrumentation and documentation.
- Findings doc summarizing performance impact and gaps.
- Updated roadmap entry referencing Option 1 readiness.
