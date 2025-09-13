# Color‑Cycle Playback Refactor Plan

Purpose: speed up color‑cycling playback (brush CC + recolor) and reduce UI jank. This document captures bottlenecks, ranked solutions, code targets, and rollout.

## Overview

Current playback is CPU‑bound: each frame maps an 8‑bit index buffer to RGBA on the main thread and blits via `putImageData`. At large resolutions or with multiple layers, this O(pixels × layers × fps) work saturates the main thread and causes jank.

Two main codepaths:
- Brush color cycle: `IndexBuffer` + `ColorCycleAnimator` writing directly to a canvas.
- Recolor & Animate: `RecolorEngine` builds an indexed layer and `RecolorAnimationController` re-renders frames each tick.

There is a partial performance layer (OffscreenCanvas/worker utilities), but per‑frame palette application and compositing remain on the main thread.

## Bottlenecks (observed)

- Per‑frame full‑image loops in JS that compute `paletteIndex -> RGBA` (main thread):
  - Brush CC: `src/lib/ColorCycleAnimator.ts` inner loops write `Uint32Array(pixels.buffer)` then `putImageData`.
  - Recolor: `src/lib/colorCycle/RecolorEngine.ts:468` creates a new `ImageData` each frame and fills via a `Uint32Array` view.
- `putImageData` calls on large canvases every frame; costly and synchronous.
- Multiple animation loops/sources (brush CC animators + recolor controller) can trigger redundant composites/redraws.
- Frequent DOM events per layer per frame (`colorCycleFrameUpdate`) and occasional logging inside hot paths.
- Recolor does a second pass to copy alpha from the original image after coloring.

## Ranked Optimizations (by expected impact)

1) GPU palette lookup and composition (WebGL/WebGPU)
- Upload index buffer as an 8‑bit texture and palette as a 1D texture; animate by offsetting a uniform or rotating the palette texture. Composite layers on the GPU.
- Removes main‑thread per‑pixel work and avoids `putImageData`.
- New component: `WebGLColorCycleRenderer`, used by both brush CC and recolor.

2) OffscreenCanvas + Worker frames (if GPU is deferred)
- Do per‑frame palette application in a Worker over an OffscreenCanvas; return `ImageBitmap` for fast `drawImage` on main thread.
- Extend `src/lib/performance/OffscreenRenderer.ts` and `GradientWorkerManager` to accept index + palette (or LUT) and output an `ImageBitmap` per frame.

3) Single global scheduler for all CC playback
- Unify playback so only one RAF tick coordinates all CC layers, avoiding redundant redraws. Today brush CC uses per‑layer animator callbacks while recolor uses `RecolorAnimationController`.

4) Dynamic resolution (LOD) during playback
- Animate at 0.5–0.75 scale and scale up with nearest‑neighbor; render full‑res on pause or at a lower cadence.
- Wire this to recolor’s `currentLOD` flag.

5) Cap concurrent recolor layers
- Hard‑limit simultaneous recolor playback to 1–2 layers (configurable); queue the rest. Surfaces clearly in UI.

## High‑Value Engine Tweaks (low‑risk, measurable)

- Fuse alpha into main write (recolor)
  - Compose original alpha while writing the 32‑bit pixel, eliminating a second full‑frame alpha pass.
  - DONE: Fused alpha in the CPU recolor path; removed the follow‑up alpha copy.
    - Implementation: replace `A` per‑pixel during the main write using the original image’s alpha.
    - Code: `src/lib/colorCycle/RecolorEngine.ts:516` (fused alpha in `mapIndicesToColors`)
    - Code: `src/lib/colorCycle/RecolorEngine.ts:283` (palette flow callsite passes original alpha)
    - Code: `src/lib/colorCycle/RecolorEngine.ts:300` (phase‑map flow fuses alpha in the write loop)
    - Expected: saves one full image pass per frame (~5–15% on large layers), no visual change.

- Precompute per‑frame palette remap (brush CC)
  - Build a 256‑entry `remap32` for the current offset; pixel loop becomes a single table lookup instead of modulo per pixel.

- Reuse `ImageData`/buffers per layer
  - Maintain a persistent `ImageData` per recolor layer; avoid `new ImageData` every frame and reuse backing buffers.
  - DONE: Added per-layer frame buffer cache and switched CPU paths to reuse it.
    - Code: `src/lib/colorCycle/RecolorEngine.ts: added frameBuffers map and getFrameBuffer()`
    - Code: `src/lib/colorCycle/RecolorEngine.ts` CPU palette and phase branches now fill the reused buffer instead of allocating.
    - Expected: removes an allocation per frame; reduces GC and jank.

- Prefer ImageBitmap blits over `putImageData`
  - Where OffscreenCanvas is available, render offscreen and transfer via `drawImage(ImageBitmap)`.

- Coalesce events and remove logs from hot paths
  - Dispatch one `colorCycleFrameUpdate` per frame (with changed layer ids), not per layer; gate logs under a debug flag.

## Architectural Improvements

- Shared index format and renderer
  - Converge brush CC’s `IndexBuffer` flow and recolor’s quantized indices to one renderer API (GPU/worker backend).

- Single compositor
  - Maintain a compositor that blends per‑layer ImageBitmaps (or GPU FBOs) in z‑order. Stop per‑layer clears and repeated canvas state churn.

- Worker ownership of LUT
  - Move gradient LUT build/shift to worker; send a compact 256×4 palette per frame as transferable.

## Concrete Code Targets

Brush CC
- Precompute offset remap
  - `src/lib/ColorCycleAnimator.ts`: create a 256‑entry `remap32` when `animOffset` changes and use `pixels32[i] = index ? remap32[index - 1] : 0`.
- Optional: Offscreen path
  - Swap `putImageData` with OffscreenCanvas + ImageBitmap draw; keep a fast path for small canvases.

Recolor
- Fuse alpha into main write and reuse buffers
  - `src/lib/colorCycle/RecolorEngine.ts:468` (`mapIndicesToColors`): reuse a per‑layer `ImageData` buffer and OR in original alpha when writing `pixels32[i]`.
  - Remove the follow‑up alpha copy pass (currently in `renderFrame` after `mapIndicesToColors`).
- Coalesce frame events
  - `src/lib/colorCycle/RecolorAnimationController.ts`: emit a single frame event after updating all layers.
- Optional Offscreen path
  - Use `OffscreenRenderer.renderImageData` to produce `ImageBitmap` and draw; or move coloring fully into OffscreenCanvas.

Shared/Compositor
- Unified scheduler
  - Centralize RAF in recolor controller (or a new compositor) and subscribe brush CC to it; avoid stacked RAFs.
- Limit simultaneous CC layers
  - Enforce the max concurrently animating recolor layers (see `integration/AppIntegration.ts`).

## Quick Wins (1–2 hours)

- Remove per‑frame logs and reduce event dispatch count to one per frame.
- Default FPS: 24 for large canvases (> ~2M px), 30 for small; adapt dynamically from frame‑time history.
- Ensure `CanvasRenderingContext2D` is created with `{ desynchronized: true }` for blit‑only paths.

## Validation & Metrics

- Add simple timing around pixel loops and blits:
  - Brush CC: `ColorCycleAnimator.renderFrame` loop and `putImageData` timing.
  - Recolor: `RecolorEngine.renderFrame` and `mapIndicesToColors` timing.
- Track average frame time (ms), FPS, and dropped frames via `RecolorAnimationController.stats`; surface in UI.
- Test scenarios:
  - 1920×1080 canvas, 1 and 2 recolor layers.
  - Brush CC stroke playback while pan/zooming.

## Rollout Plan

Phase 1 (fast)
- Coalesce frame events; remove logs in hot paths.
- Precompute offset remap in `ColorCycleAnimator`.
- Reuse `ImageData` and fuse alpha in `RecolorEngine`.
- Add adaptive FPS (24/30) based on canvas size and frame time.

Phase 2 (incremental)
- OffscreenCanvas + worker path for recolor coloring; draw via ImageBitmap.
- Unify scheduler so only one RAF triggers redraws; throttle to one redraw per animation tick.
- Enforce max concurrent recolor layers (default: 1–2).

Phase 3 (strategic)
- Introduce `WebGLColorCycleRenderer` with index texture + 1D palette texture.
- Route both brush CC and recolor through the GPU renderer and a single compositor.

## Risks & Tradeoffs

- WebGL/WebGPU: increases complexity and surface area for compatibility; requires fallbacks.
- Offscreen/Workers: transfer overhead if not using transferable buffers or ImageBitmap properly.
- Adaptive FPS/LOD: visual smoothness vs. performance; must be communicated in UI.

## Definition of Done

- Typical 1080p recolor playback at 24–30 FPS on mid‑range hardware without main‑thread long tasks > 50 ms.
- Pan/zoom interactions remain responsive (< 16 ms handlers) during playback.
- Single redraw per frame; no duplicate animation loops or per‑layer event storms.
- GPU path (when enabled) significantly reduces main‑thread time vs. CPU path.
