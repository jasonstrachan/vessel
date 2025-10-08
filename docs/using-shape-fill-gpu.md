# Using Shape Fill GPU

*Draft 2025-10-07*

> WebGPU shape-fill rendering now ships with tile-based field generation, preview/final cache reuse, and a pixel-art hardening curve. Use this guide to enable the GPU path, understand its workflow, and get reliable results while we polish the last open items.

## Prerequisites
- Chromium-based browser with WebGPU enabled (`chrome://flags/#enable-unsafe-webgpu`).
- Hardware capable of WebGPU (Metal 3+/D3D12/Vulkan).
- `Shape Fill GPU` feature toggle enabled in the app (Settings → Rendering → Shape Fill).

## Workflow
1. **Select Shape Fill GPU brush** in the library. Pixel mode is on by default; disable it for analog-style falloff.
2. **Draw your shape or flow stroke**. Preview tiles stream from the GPU cache in breadth-first order around the centroid.
3. **Adjust parameters** via ShapeAdjustHelper (radial gizmo). Parameter changes reuse cached SDF/seed buffers—no recompute.
4. **Use the GPU controls** in Brush Controls: tune *Hardening*, *Threshold*, and *Feather* to mix between anti-aliased and hard-edged coverage while staying GPU-native.
5. **Commit** by releasing the mouse/stylus or pressing Enter. Final pass reuses cached buffers at full resolution; no extra GPU work.
6. **Undo / redo** replays cached vector jobs. Hybrid strokes remain vector definitions in `useAppStore` history.

## Tips
- Pixel mode: use the hardening slider to balance anti-aliasing and crisp edges.
- Large canvases: tiles process in 1024×1024 chunks with 64px overlap. Watch the overlay for streaming order.
- Diagnostics: enable `debugLog` to view tile dispatch, cache hits, and GPU timings.

## Fallbacks
If WebGPU is unavailable, the scheduler aborts the job and logs a warning. The UI disables Shape Fill GPU automatically.

## Known Gaps (2025-10-07)
- Preview canvas wiring into main React tree remains pending.
- Feature toggle surface is still WIP; use dev settings for now.
- Cross-browser testing limited to Chrome Canary.
