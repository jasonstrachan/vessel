# Shape Fill Contour CPU Plan

_created: 2025-10-07_

Goal: move contour isoline/spacing/join computation back to the CPU while keeping the WebGPU pixel rasterizer for the final render pass.

## Task List
- [x] Extract the signed-distance, marching-squares, and segment-connection helpers from `useBrushEngineSimplified.ts` into `src/lib/shapeFill/cpu/` modules with reusable typings.
- [x] Introduce a CPU contour mesh builder that outputs `pos2uv2` vertex data and NDC transforms that mirror the former GPU quad expander.
- [x] Extend the contour rendering path so jobs can supply CPU geometry and bypass the GPU isoline + quad compute passes, feeding the GPU pixel rasterizer directly.
- [x] Update `drawContourFill` and preview overlays to consume the new CPU helpers, ensuring preview fidelity and inking behaviour remain unchanged.
- [ ] Gate or retire the contour-specific GPU compute stages and add a dev toggle for forcing old/new paths while we stabilize.
- [ ] Add focused unit tests for the CPU builders and update existing integration tests to cover the new flow.

Keep this list updated; tick items as they ship.
