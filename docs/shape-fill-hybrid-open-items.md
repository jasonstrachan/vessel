# Shape Fill Hybrid Pipeline – Remaining Work

_last updated: 2025-10-07_

This checklist tracks the outstanding work required to ship the generalized hybrid (CPU + GPU) shape-fill pipeline beyond the current contour-only experiments. Items are grouped by subsystem; knock out every subsection before advertising the feature in the app.

## 1. Core GPU Pipeline
- [x] **Field generation on GPU.** Replace the worker’s Earcut/Clipper CPU path with the planned WebGPU compute stages (SDF field, gradient textures, marching squares). Implement the tile-aware `FieldGenerator`, `SeedGenerator`, `PathIntegrator`, and `PixelRasterizer` passes end-to-end.
- [x] **Preview/final parity buffers.** Ensure preview render targets reuse the same GPU intermediates when the final pass executes. No recomputation on commit; just redraw into the full-resolution texture. *(Completed 2025-10-07 – scheduler now reuses cached preview field buffers for final jobs; added coverage in `ShapeFillScheduler` tests.)*
- [x] **Pixel-art hardening pass.** Port the planned post-fragment hardening curve (step/sigmoid) so pixel mode uses identical shader code for preview and final output. *(Completed 2025-10-07 – PixelRasterizer shader now blends sigmoid and step hardening for preview/final parity.)*
- [x] **Tiled execution & bounds handling.** Hook up the tile manager so large strokes process in 1024×1024 tiles with 64px overlap (per rebuild plan). Verify stitched output keeps edge seams hidden. *(Completed 2025-10-07 – tile descriptors now track neighbor adjacency for 1024×1024 tiling, and the isoline extractor clamps segment emission to interior clip bounds to eliminate overlap seams.)*
- [x] **WebGPU feature gating.** Harden capability detection (adapter/device errors, lost events) and surface a deterministic fallback when WebGPU is unavailable. *(Completed 2025-10-07 – `WebGPUDeviceManager` now tracks support status, emits loss events, and the scheduler/logging paths fall back to CPU renders with explicit reasons when WebGPU cannot be used.)*

## 2. Worker & Data Transport
- [x] **Module worker bundling.** Confirm the module worker builds in the production bundle (Vite/Next config) with proper asset hashing.
- [x] **Binary payload hygiene.** Use transferable ArrayBuffers instead of cloning typed arrays when posting mesh data back to the main thread.
- [x] **Clipper/Earcut removal.** The legacy `hybridShapeFillWorker.ts` path has been retired; contour polygons now route directly through the scheduler/StrokePipeline helpers and we dropped the Clipper/Earcut dependencies.
- [x] **Structured mesh layout.** Codified the WebGPU quad mesh as `pos2uv2` (16-byte stride, CCW winding, `float32x2` position + UV) via `STROKE_MESH_LAYOUTS`, and the rasterizer now validates the layout before drawing.

## 3. Renderer & Controller
- [x] **Uniform packing cleanup.** Audit `HybridShapeFillRenderer` uniform blocks (currently hard-coded 64-float array) and document offsets. Prevent mismatches when adding new fill variants.
- [x] **Resource lifetime management.** Ensure textures/buffers created per stroke are destroyed or returned to pools. Tie destruction to controller disposal and tab visibility events.
- [x] **View transform & DPI support.** Pipe canvas scale/devicePixelRatio through the controller so both preview and final targets match the viewport transformation.
- [x] **Readback strategy.** Confirm the `copyTextureToBuffer` readback path is only used when absolutely required (e.g., migrating GPU output into 2D canvas). Avoid costly mapAsync for every preview frame.

## 4. Scheduler & Caching
- [x] **Shared mesh cache.** Implement the mesh cache described in the roadmap: key on hash(paths + geom params + scale bucket), maintain 64–128 MB LRU, and invalidate on path/spacing changes.
- [x] **Job prioritization.** Double-check `ShapeFillScheduler` abort/cancel flows so preview jobs are canceled immediately when newer input arrives, even when GPU work is mid-flight.
- [x] **Telemetry hooks.** Emit perf counters (triCount, uploaded bytes, build ms, tiles drawn) to `performanceMonitor` so we can track regressions and tune cache sizes.

## 5. UI & Feature Toggle
- [x] **Brush library entry.** Add a “Shape Fill GPU” (or rename existing brush) that explicitly routes through the hybrid pipeline and exposes GPU-only options (hardening, spacing gizmo). *(Completed 2025-10-07 – brush preset renamed, GPU-only sliders (hardening/threshold/feather) added to Brush Controls.)*
- [ ] **Settings surface.** Expose a feature toggle in `AlignmentPanel` / `BrushSettingsPanel` so users can opt in/out and see fallback status. Include WebGPU capability diagnostics.
- [x] **Preview canvas wiring.** Connected the view-target registry to `DrawingCanvas` overlay/composite canvases and refresh it on resize/zoom so GPU preview/final passes can reuse the registered surfaces. *(Updated 2025-10-07).* 
- [x] **Undo/redo integration.** Hybrid GPU strokes now record `StrokeJob` metadata in history; undo/redo replays cached mesh output instead of storing raster snapshots. *(Updated 2025-10-07).* 

## 6. Testing & Validation
- [ ] **Unit coverage.** Add focused tests for worker message handling, controller cache keys, mesh cache eviction, and renderer uniform packing.
- [ ] **E2E sanity via Playwright.** Record at least two browser tests (contour + flow) to confirm preview clear/loadOp `'clear'` behavior, alpha premultiplication, and large-mesh draw success.
- [ ] **Cross-browser smoke tests.** Validate on Chromium (WebGPU enabled), Firefox nightly (WebGPU flag), and Safari TP where available. Document fallback expectations.
- [ ] **Performance baselines.** Capture GPU timings for representative strokes (small, medium, 8k canvas) before turning the feature on by default.

## 7. Cleanup & Documentation
- [x] **Docs refresh.** Update `docs/shape-fill-rebuild-plan.md` once the above items are complete, and add a “Using Shape Fill GPU” guide. *(Completed 2025-10-07 – rebuild plan now documents tiling/parity work and `docs/using-shape-fill-gpu.md` covers workflow setup.)*
- [x] **Remove legacy code paths.** When parity is achieved, delete or quarantine the CPU-only contour/delaunay implementations to avoid maintenance drift. *(Completed 2025-10-07 – removed contour/delaunay CPU fallbacks and dropped `delaunator` dependency.)*
- [ ] **Developer toggles.** Expose a `__DEV__` shortcut (e.g., hash flag) for forcing CPU/GPU to aid debugging and demos.

Keep this file up to date as tasks finish. All items must be closed before marketing the pipeline as generally available in the app.
