# Shape Fill System Rebuild Blueprint (2025-10-03)

## Target Outcomes
1. **Fast finalization at any canvas size** – completion of a stroke should feel instant on low-end hardware even on 8k canvases.
2. **Pixel-art friendly mode** – optional hard-edged output that stays crisp without demanding mathematically exact binary coverage.
3. **Preview/final visual parity** – real-time feedback should look nearly identical to the committed stroke, with only minor differences from resolution scaling or post-processing.

## High-level Architecture

### Core Concepts
- **Vector-first representation**: store shape outlines and fill parameters in a scene graph, never raster data. Rasterization happens in dedicated passes.
- **Deterministic field generation**: signed-distance fields (SDFs) or vector flow fields derive from hashed seeds so preview and bake share the same data.
- **Dual pipeline**: a *preview pipeline* renders at an adaptive resolution for interactivity, while a *commit pipeline* reuses the exact cached intermediates to rasterize at full resolution with no re-computation.

### Technology Stack
- **WebGPU primary target.** Commit to WebGPU for compute shaders, storage buffers, and bind group ergonomics. Maintain a note that WebGL2 is unsupported for this build, which simplifies shader authoring and avoids ping-pong FBO hacks.
- **Web Workers** orchestrate high-level scheduling without touching rendering logic; they simply prepare shape metadata and dispatch commands to the GPU pipeline.
- **Typed arrays + SharedArrayBuffer** underpin all data interchange between UI and worker.

### Data Flow
1. **Input capture** (main thread): user defines polygon/brush stroke; if pixel mode, quantize vertices to integer coordinates up front.
2. **Shape package** (`StrokeJob`) dispatched to a worker-managed queue with:
   - Vertex list, brush parameters, deterministic `seed`.
   - Desired output resolution(s) (preview, final).
   - Optional `pendingGizmo` flag when the ShapeAdjustHelper is active.
3. **Field stage**:
   - WebGPU compute pipeline generates an SDF over the polygon’s tight bounding box plus margin, outputting `distance`, `gradient`, and a `sign` bitmask texture.
   - Results stay resident in GPU buffers/texture attachments.
4. **Seed stage**:
   - GPU Poisson-disk or blue-noise sampler operates on the sign mask, returning seed points in SSBOs.
5. **Path integration** (Flow/Ink Ribbons): compute shader integrates along the gradient field, writing polyline vertices into mapped SSBOs.
6. **Adjustment window** (optional): while `pendingGizmo` is true, radial mouse movement from the centroid emits `StrokeJobUpdate` messages that tweak spacing, density, orientation, etc.; the GPU reuses cached SDF/seed buffers and recomputes only the affected passes for live preview.
7. **Raster stage**:
   - Preview: render to a lower-res framebuffer (e.g., 0.5x) using the same vertex buffers, then upscale in UI.
   - Final: draw the stored buffers to the full-resolution target—no recomputation.
8. **Pixel-art pass** (optional):
   - Fragment shader applies a configurable hardening curve (step or steep sigmoid) to clamp coverage near 0/1.
   - Geometry is snapped to pixel centers during vertex processing.
9. **Compose**: final framebuffer blits into the main canvas texture, while vector data remains for future edits.

## Key Modules
- `StrokeScheduler`: batches pending stroke jobs, prioritizes previews, and cancels outdated work.
- `FieldGenerator`: WebGPU compute pipeline that builds SDF + gradients (single authoritative implementation).
- `SeedGenerator`: WebGPU blue-noise/Poisson sampler; caches seeds per `seed` hash.
- `PathIntegrator`: compute pipeline producing polyline vertex buffers for flow-like fills.
- `PixelRasterizer`: render pipeline that draws line strips with pixel snapping or hardening.
- `PreviewBridge`: handles downsampled framebuffer display and ensures identical parameters between preview/final.
- `ShapeAdjustHelper`: interactive gizmo that guides users through shape creation and post-shape parameter tweaking via radial gestures.

## Meeting the Goals

### 1. Fast Finalization
- All heavy computation (SDF, seeding, integration) stays on the GPU. Finalization is just a render pass that reuses cached buffers, independent of canvas size.
- Bounding-box tiling allows arbitrarily large canvases by processing tiles sequentially while keeping data on the GPU.

**Tile Manager Sketch**
- Tile size: default 1024×1024 texels with 64px overlap to avoid seams when composing flows/ribbons.
- Cache: LRU over at most four active tiles (≈64 MB @ float textures). When a stroke spans more tiles, evict the least recently used tile after its data has been resolved.
- Streaming: scheduler enqueues tiles in breadth-first order around the brush centroid so visible regions render first.
- Stitching: overlapping border is blended during raster stage; integration shaders sample from neighboring tile data held in a small uniform array.

### 2. Pixel-art Lines
- `pixelMode` flag:
  - Snaps vertices to integer coordinates before uploading to GPU.
  - Prefers integer pixel widths so coverage lines up with the grid.
  - Uses a fragment shader with a configurable hardening curve to keep edges visually binary without strict 0/1 enforcement.

### 3. Accurate Preview vs Finalization
- Preview and final share buffers; only render target resolution differs. Deterministic seeds ensure no stochastic divergence.
- If a lower-res preview is necessary, compute both coarse and full SDFs up front on the GPU; finalization simply renders the full-res texture.
- Adopt “commit-on-ready” so the UI shows preview only after the first GPU pass completes, eliminating heuristic gaps.

## Shape Adjust Helper Concept

1. **Creation step**: when a shape is closed or stamped, spawn a translucent overlay anchored at the shape centroid. The initial release commits base geometry but flags the stroke as pending.
2. **Radial adjustment**: dragging outward from the centroid reveals parameter bands; default mapping:
   - Band 1 (inner): contour/flow spacing.
   - Band 2 (middle): density or max step count.
   - Band 3 (outer): orientation/angle; hold `Shift` to reassign to noise strength.
   Each band uses discrete notches; updates stream to the GPU pipeline so preview reflects changes instantly.
3. **Commit gesture**: clicking (or Enter) locks parameters. The helper packages the final values into the existing `StrokeJob`, promoting cached preview buffers to the final render pass.

Implementation hook: the helper devotes a single worker message type (`StrokeJobUpdate`) that tweaks only the affected uniforms/SSBOs; shaders reuse everything else to keep interaction snappy.

## Implementation Roadmap
1. [x] **Prototype FieldGenerator in WebGPU** with bounding-box tiles and deterministic seeds; profile versus current CPU implementation. *(Instrumented 2025-10-04 – CPU vs GPU timings now logged via `debugLog` in Flow fills.)*
2. [x] **Build unified stroke scheduler** that feeds preview/final outputs from the same cached data. *(Completed 2025-10-04 – unified GPU cache, stale preview cancellation, job updates channel.)*
3. [x] **Implement PixelRasterizer shader** with snappable grid alignment and hardening curve for pixel mode. *(Completed 2025-10-04 – WebGPU render pipeline online; Canvas2D path retired.)*
4. [x] **Wire ShapeAdjustHelper UX**, ensuring parameter changes stream to the GPU without reallocating base buffers. *(Completed 2025-10-04 – ShapeAdjustHelper overlay + scheduler job updates merge dynamic params.)*
5. [ ] **Complete GPU migration**: wrap every shape-fill brush around the scheduler and delete all CPU fallbacks so the project runs exclusively on the GPU pipeline.

### Step 1 Details – FieldGenerator Prototype
- **Bounding-box tiling**: `prepareStrokeGeometry` collapses each stroke to a padded bounding box, partitions it into 1024² tiles with 64px overlap, and emits the GPU buffers needed for `FieldGenerator` to dispatch compute workloads without touching untouched canvas regions.
- **Deterministic job ids**: `computeFlowGpuJobId` hashes quantized vertices, seed, field resolution, and pixel-mode flag into a stable identifier so preview and final passes reuse the same GPU cache entries instead of regenerating SDFs.
- **Profiling hooks**: Flow fills now emit paired CPU/GPU timings to `debugLog` (`cpu-sdf-generation`, `GPU flow stroke completed`) recording SDF generation cost, GPU tile count, and queue diagnostics—making side-by-side comparisons with the legacy CPU pipeline trivial.
- **Validation checklist**: capture a representative flow stroke, inspect console output for matching job ids, ensure CPU generation time scales with bounding-box area (not whole-canvas size), and confirm GPU runs reuse cached resources when toggling preview/final.

### Step 2 Details – Unified Stroke Scheduler
- **Reusable GPU cache**: `ShapeFillScheduler` stores `FieldGeneratorResult`s keyed by the deterministic job id; preview and final passes request the same cache slot, avoiding redundant SDF/seed work whenever geometry is unchanged.
- **Stale preview eviction**: enqueuing a new preview with the same job id aborts queued/active preview passes so downstream pipelines only observe the freshest geometry before caching.
- **Job update channel**: `dispatchJobUpdate` records in-flight `StrokeJobUpdate`s (brush patches + param overrides) and emits an `updated` event so GPU workers can patch uniforms/SSBOs without resubmitting geometry.
- **Singleton runtime**: `getShapeFillScheduler` exposes a single scheduler instance shared across brushes, ensuring Flow, Ink Ribbons, etc., reuse GPU resources and instrumentation rather than instantiating their own queues.
- **Validation checklist**: queue a preview stroke, verify `cache-hit` logs when submitting the final pass, stream a `StrokeJobUpdate` (e.g., ShapeAdjustHelper tweak) and confirm the job stays in `pendingGizmo` mode until commit, then check cache invalidation clears resources when the stroke id changes.

### Step 3 Details – PixelRasterizer Shader
- **Pipeline layout**: the WebGPU render pipeline consumes line-strip vertex buffers emitted by `PathIntegrator`, backed by a `PixelRasterizerUniforms` uniform buffer (model matrix, preview/final resolution, hardening curve parameters, and booleans for `pixelMode` and multisample toggles).
- **Vertex stage (WGSL)**: snaps incoming XY positions to integer coordinates when `pixelMode` is true by flooring, adding a `0.5` center offset, and applying tile-local transforms. Preview and final passes share the same shader; a `previewScale` uniform handles downscaled render targets without rebuilding buffers.
- **Fragment stage**: evaluates coverage using the supplied thickness, then applies a configurable hardening function. Default curve is a 3-step smoothstep ladder (`smoothstep(0.0, thresholdLow, coverage)` → `smoothstep(thresholdLow, thresholdHigh, coverage)` → final clamp), with an optional power curve for softer fills.
- **Blend state**: premultiplied alpha blending with `alphaToCoverageEnabled` during pixel mode to stabilize diagonals. Non-pixel mode disables alpha-to-coverage but keeps premultiplied math so composition with existing canvas textures remains correct.
- **Resource reuse**: both preview and final passes bind the same vertex/index buffers and uniform storage. Only the color attachment view differs, allowing the scheduler to submit preview frames immediately and defer the full-resolution pass until interaction settles.
- **Fallbacks removed**: the prior Canvas2D raster path is now disabled for GPU-enabled fills. When WebGPU is unavailable, the scheduler explicitly marks the job unsupported so legacy CPU fills can render instead of mixing pipelines.
- **Validation hooks**: `StrokeScheduler` now records per-pass GPU timestamps. The doc checklist for QA: compare preview vs final render output hashes across resolutions, verify pixel-mode snapping by overlaying a 1px grid, and assert that multisample toggles do not alter hard-edge mode.
- **Implementation status (2025-10-04)**: `SeedGenerator`, `PathIntegrator`, and `PixelRasterizer` WebGPU modules land with a `StrokePipeline` orchestrator that renders Flow fills end-to-end, falling back to CPU when WebGPU is unavailable.

### Step 4 Details – ShapeAdjustHelper UX
- **Radial gizmo bands**: the helper renders three concentric rings (spacing, density, orientation) around the stroke centroid and streams adjustments back through `dispatchJobUpdate` so GPU buffers update in place.
- **Selector coordination**: the helper stores `gpuJobId` in `PolygonGradientState`, ensuring preview strokes tagged with `pendingGizmo` reuse cached SDF/seed data while the user tweaks parameters.
- **Keyboard modifiers**: holding `Shift` repurposes the outer band to control noise strength; the update payload includes `seedJitter` so the GPU path matches brush panel state.
- **Scheduler merge**: `ShapeFillScheduler` now merges `StrokeJobUpdate` patches into queued jobs (brush settings, seeds, dynamic params, `pendingGizmo`) before or during execution, so adjustments reuse the cached field and avoid resource churn.
- **Cache reuse validation**: automated tests confirm that preview re-queues served from the GPU cache still honor merged updates (spacing, `pendingGizmo`), meaning helper tweaks reuse the existing SDF/seed buffers instead of respinning FieldGenerator.
- **Validation checklist**: draw a shape, invoke the helper, confirm overlay rings respect zoom, verify `StrokeJobUpdate` logs show `pendingGizmo:1` during drag, and ensure committing the helper clears the flag and reuses cached data for the final render.

### Step 5 Details – Complete GPU Migration
- **Brush parity**: Flow, Ink Ribbons, Contour, Lines, Delaunay, etc. must execute entirely through `ShapeFillScheduler` + WebGPU pipelines; remove calls into CPU SDF builders and `isPointInPolygonSDF` loops once GPU parity is confirmed.
- **Fail-safe policy**: if WebGPU is unavailable, Surface a clear “GPU required” notice rather than falling back to Canvas2D—no shadow paths.
- **Verification checklist**: migrate each brush, compare output hashes against baseline GPU renders, update presets/tests, then delete the corresponding CPU modules (`flow.ts` CPU integrator, `inkRibbons.ts` legacy loops, etc.) and strip feature flags/toggles that re-enable them.
- **Status 2025-10-04**: Flow and Ink Ribbons fills now run exclusively through the `StrokePipeline` GPU stages (seed → path integration → pixel rasterization). Canvas2D fallbacks have been removed; environments without WebGPU emit a scheduler warning instead of rendering.

### Shape Fill GPU Brush
- Add a new brush entry in the library named **Shape Fill GPU** that routes shape strokes to the WebGPU pipeline.
- Initial GPU fill adapters:
  1. **Contour/Lines hybrid** – validates SDF extraction and deterministic preview/final parity with minimal shader complexity.
  2. **Flow** – exercises gradient sampling, tile stitching, and ShapeAdjustHelper spacing/density bands.
  3. **Ink Ribbons (pared-down noise)** – reuses Flow infrastructure, confirming the helper’s angle/noise controls.
- After the trio is stable, port Delaunay and Cross Hatch; keep legacy CPU fills alongside for A/B comparison until parity is confirmed.

## Open Questions
- WebGPU vs WebGL2: pick whichever is available in your target environment (personal build). WebGPU simplifies compute passes; WebGL2 requires fragment-shader-based compute but is more widely supported.
- Memory pressure for 8k canvases: decide on tile sizes and cache eviction policies to keep GPU memory manageable.
- Seed reproducibility: expose a seed override for deterministic replays or keep it internal.

## Recommendation
Because this tool is for personal use, commit fully to the GPU pipeline. Eliminating the CPU fallback reduces complexity, keeps the codebase smaller, and focuses engineering effort on performant shaders, solid scheduling, and the interactive ShapeAdjustHelper workflow.

. 1. Lines / Contour variants – build or adapt a
  GPU pass that extracts isolines (likely marching
  squares in a compute shader) and feeds them through
  StrokePipeline or a similar renderer so we can retire
  the CPU contour code.
  2. Delaunator fill – replace the existing Poisson
  sampling + triangulation loop with GPU equivalents
  (seed generation, triangle assembly, raster) and hook
  them into the scheduler.
  3. Hatch – offload the line generation/drawing to
  the GPU, probably reusing the same seed/line-render
  stages we built for Flow once we parameterize them
  for hatch angles.

  Let me know which of those you’d like to tackle first
  and I’ll start laying down the GPU scaffolding for
  it.