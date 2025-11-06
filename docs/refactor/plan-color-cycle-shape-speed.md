## Color Cycle Shape Rendering Acceleration Plan

Date: November 6, 2025

Goal: eliminate multi-second stalls when rendering Color Cycle Shape fills by moving heavy work off the main thread, reducing per-pixel JS overhead, and ensuring the GPU fast path is always available.

### Context
- `fillColorCycleShape` and `fillColorCycleShapeLinear` (src/hooks/brushEngine/ColorCycleBrushCanvas2D.ts:1060-2140) still run the per-pixel scanline algorithm for almost every fill.
- The GPU helper (`ColorCycleAnimator.gpuFillShape`, src/lib/ColorCycleAnimator.ts:298-337) is bypassed for linear fills and for concentric fills whenever polygon vertex counts exceed `GPU_MAX_VERTS`.
- Even with dithering disabled, the CPU path spends most time in repeated `animator.setIndex` calls and numeric math, causing visible freezes on 2k×2k projects.

### Refactor 1 — Expand GPU Path (Highest Impact)
**Objective:** Ensure both shape modes hit the GPU fast path, even when dithering or complex polygons are involved.

1. Shader support
   - Add a linear-gradient variant to `WebGLColorCycleRenderer` (src/lib/colorCycle/rendering/WebGLColorCycleRenderer.ts) that projects vertices along a direction vector.
   - Introduce dithering parameters (strength, pixel size) and implement blue-noise jitter in the fragment shader so GPU renders match CPU dithering without per-pixel loops.
2. Animator API
- Extend `ColorCycleAnimator.gpuFillShape` into a more general API that accepts `{ mode: 'concentric' | 'linear', direction?, dither }` and exposes `getGLFillMaxVerts()` (already present) plus the new uniforms.
3. Brush integration
   - In `fillShape`/`fillShapeLinear`, always attempt GPU first. Before calling, run polygon simplification via `simplifyToVertexLimit` with an aggressive tolerance curve (start 0.2, grow to 8) so final vertex counts stay under 128.
   - Remove the `!this.ditherEnabled` guard.
4. Instrumentation & validation
   - Update `enableCCPerfProbe` to log fill durations and whether GPU or CPU handled it. Add snapshot tests in `ColorCycleFeatureParityTest` ensuring GPU output is within ±1 palette index of CPU reference.
5. Risks & mitigations
   - Shader differences may alter band boundaries: capture golden images (assets/perf/color-cycle-shape/*.png) before rollout. If WebGL context budget is exceeded, automatically fall back and log once.

### Refactor 2 — Direct Index Buffer Span Writer
**Objective:** When CPU fallback is necessary, avoid per-pixel method dispatch and redundant math.

1. Animator plumbing
   - Add `beginDirectFill()` that returns `{ data: Uint8Array, width: number }` and locks the active buffer, and `endDirectFill()` that toggles `_glIndexDirty` once and unlocks.
2. LUT-driven spans
   - Precompute a 256-entry LUT mapping normalized distances → palette indices per invocation (`computeBandIndexLUT(bands, baseOffset)`). Reuse it for all pixels within the fill.
3. Span writes
   - Replace every `animator.setIndex(x, y, colorIndex)` inside fill loops with direct assignments (`data[rowOffset + x] = lut[normIndex]`). Use `data.fill(...)` when bands collapse to constant values.
4. Error diffusion
   - When dithering is on, keep the existing Sierra-lite math but store errors in typed arrays sized to the bbox width, not the full canvas, to cut allocation cost.
5. Validation
   - Add benchmarks under `tests/perf/colorCycleFillSpan.test.ts` (Jest) that compare baseline vs. refactor time for 1024² polygons. Ensure undo/redo still receives the same serialized buffers.

### Refactor 3 — Worker Offload for CPU Fills
**Objective:** Keep the main thread responsive when GPU is unavailable.

1. Worker setup
   - Create `src/workers/colorCycleFill.worker.ts` that imports shared helpers (`applyDitheringWithFillResolution`, `simplifyToVertexLimit`) and exposes `fillConcentric`/`fillLinear` handlers.
2. Messaging
   - In brush methods, if `navigator.hardwareConcurrency <= 8` or `gpuFill` fails twice, post the fill job to the worker with `vertices`, `mode`, `gradient`, `dither`, and `bbox`. Transfer the resulting `ArrayBuffer` back and blit with `data.set` plus `dirtyLayers.add`.
   - Support cancellation if the user changes tools before the worker responds.
3. UI feedback
   - Use `FeedbackStrip` to show "Filling shape…" after 150 ms delay, hide once the worker completes.
4. Validation
   - Add integration coverage in `src/pages/TestRunner.tsx` to simulate worker latency and confirm pointer events stay under 8 ms.

### Sequencing & Definition of Done
1. Land Refactor 1 (GPU path parity) behind `featureFlags.useCanvas2DColorCycle === false`. Verify performance on desktop + fallback on devices without WebGL.
2. Layer Refactor 2 to shrink CPU cost and serve as a safety net for GPU-less environments.
3. Introduce Refactor 3 for the remaining worst-case devices; guard with a feature flag until stability is proven.

Done = All fills under 200 ms on a 2048×2048 canvas with 64-vertex shapes on standard hardware; no frame drops during fill interactions; regression tests updated to exercise both GPU and CPU/worker paths.
