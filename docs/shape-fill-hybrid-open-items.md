# Shape Fill Hybrid Pipeline – Remaining Work

_last updated: 2025-10-07_

This checklist tracks the outstanding work required to ship the generalized hybrid (CPU + GPU) shape-fill pipeline beyond the current contour-only experiments. Items are grouped by subsystem; knock out every subsection before advertising the feature in the app.

## 1. Core GPU Pipeline
- **Field generation on GPU.** Replace the worker’s Earcut/Clipper CPU path with the planned WebGPU compute stages (SDF field, gradient textures, marching squares). Implement the tile-aware `FieldGenerator`, `SeedGenerator`, `PathIntegrator`, and `PixelRasterizer` passes end-to-end.
- **Preview/final parity buffers.** Ensure preview render targets reuse the same GPU intermediates when the final pass executes. No recomputation on commit; just redraw into the full-resolution texture.
- **Pixel-art hardening pass.** Port the planned post-fragment hardening curve (step/sigmoid) so pixel mode uses identical shader code for preview and final output.
- **Tiled execution & bounds handling.** Hook up the tile manager so large strokes process in 1024×1024 tiles with 64px overlap (per rebuild plan). Verify stitched output keeps edge seams hidden.
- **WebGPU feature gating.** Harden capability detection (adapter/device errors, lost events) and surface a deterministic fallback when WebGPU is unavailable.

## 2. Worker & Data Transport
- **Module worker bundling.** Confirm the module worker builds in the production bundle (Vite/Next config) with proper asset hashing.
- **Binary payload hygiene.** Use transferable ArrayBuffers instead of cloning typed arrays when posting mesh data back to the main thread.
- **Clipper/Earcut removal.** Once GPU path is stable, delete the temporary CPU triangulation code from `hybridShapeFillWorker.ts` and slim dependencies accordingly.
- **Structured mesh layout.** Finalize a single mesh layout (pos2 / pos2uv2) and document it. Align worker output with renderer expectations (stride, index type, winding order).

## 3. Renderer & Controller
- **Uniform packing cleanup.** Audit `HybridShapeFillRenderer` uniform blocks (currently hard-coded 64-float array) and document offsets. Prevent mismatches when adding new fill variants.
- **Resource lifetime management.** Ensure textures/buffers created per stroke are destroyed or returned to pools. Tie destruction to controller disposal and tab visibility events.
- **View transform & DPI support.** Pipe canvas scale/devicePixelRatio through the controller so both preview and final targets match the viewport transformation.
- **Readback strategy.** Confirm the `copyTextureToBuffer` readback path is only used when absolutely required (e.g., migrating GPU output into 2D canvas). Avoid costly mapAsync for every preview frame.

## 4. Scheduler & Caching
- **Shared mesh cache.** Implement the mesh cache described in the roadmap: key on hash(paths + geom params + scale bucket), maintain 64–128 MB LRU, and invalidate on path/spacing changes.
- **Job prioritization.** Double-check `ShapeFillScheduler` abort/cancel flows so preview jobs are canceled immediately when newer input arrives, even when GPU work is mid-flight.
- **Telemetry hooks.** Emit perf counters (triCount, uploaded bytes, build ms, tiles drawn) to `performanceMonitor` so we can track regressions and tune cache sizes.

## 5. UI & Feature Toggle
- **Brush library entry.** Add a “Shape Fill GPU” (or rename existing brush) that explicitly routes through the hybrid pipeline and exposes GPU-only options (hardening, spacing gizmo).
- **Settings surface.** Expose a feature toggle in `AlignmentPanel` / `BrushSettingsPanel` so users can opt in/out and see fallback status. Include WebGPU capability diagnostics.
- **Preview canvas wiring.** Connect the controller’s `attachCanvases` to the actual overlay/final canvases in `DrawingCanvas`. Make sure resize/SSR boundaries behave.
- **Undo/redo integration.** Persist hybrid strokes as vector jobs in the store, not raster blobs, so undo/redo simply replays the cached mesh/image data.

## 6. Testing & Validation
- **Unit coverage.** Add focused tests for worker message handling, controller cache keys, mesh cache eviction, and renderer uniform packing.
- **E2E sanity via Playwright.** Record at least two browser tests (contour + flow) to confirm preview clear/loadOp `'clear'` behavior, alpha premultiplication, and large-mesh draw success.
- **Cross-browser smoke tests.** Validate on Chromium (WebGPU enabled), Firefox nightly (WebGPU flag), and Safari TP where available. Document fallback expectations.
- **Performance baselines.** Capture GPU timings for representative strokes (small, medium, 8k canvas) before turning the feature on by default.

## 7. Cleanup & Documentation
- **Docs refresh.** Update `docs/shape-fill-rebuild-plan.md` once the above items are complete, and add a “Using Shape Fill GPU” guide.
- **Remove legacy code paths.** When parity is achieved, delete or quarantine the CPU-only contour/delaunay implementations to avoid maintenance drift.
- **Developer toggles.** Expose a `__DEV__` shortcut (e.g., hash flag) for forcing CPU/GPU to aid debugging and demos.

Keep this file up to date as tasks finish. All items must be closed before marketing the pipeline as generally available in the app.
