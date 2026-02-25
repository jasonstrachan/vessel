# Plan: Lostedge Downsample Mask Optimisation

Goal: Remove UI lag from the Lostedge slider by reducing per-pixel work while preserving the Sierra Lite patterned edge breakup.

Scope: Lostedge mask generation in `src/utils/ditherAlgorithms.ts` and its use in `useBrushEngineSimplified`.

Phases
1) Downsample → Upsample (main thread)
 - Add tunable `lostEdgeTileSize` (clamp 2–8) in `src/utils/ditherAlgorithms.ts`.
 - Convert coverage to coarse grid (w/tileSize, h/tileSize); build lost-edge mask on that grid.
 - Run Sierra Lite dithering on coarse mask; upsample keep mask with nearest-neighbor; apply to alpha as today.
 - Keep intensity-driven band math but in coarse coordinates (scale bands by tileSize).
 - Extend `src/utils/__tests__/ditherAlgorithms.test.ts` to assert interiors stay opaque and edges erode in coarse mode.

2) Cap & Ease (guardrails)
 - Clamp `edgeBand` to ~32 px; ease-in mapping (e.g., intensity^0.75).
 - Early bailout when stroke bounds are smaller than ~1.25× edgeBand.
 - Sync fade zone logic with the cap; update tests for cap/skip behavior.

3) Worker Offload (async path)
 - Add/extend worker (new `lostEdgeWorker` or reuse gradient worker) to compute keep mask from coverage + settings.
 - Define typed message/response; use transferable buffers.
 - In `useBrushEngineSimplified`, post coverage when lostEdge>0, debounce per-stroke, fallback to sync path on failure.

4) Wiring & Safety
 - Centralize constants (tile size default, edgeBand cap) in a dither constants module.
 - Keep slider 0–100 but map through new cap/curve; optional tooltip update in `BrushControls` for UX clarity.
 - Reuse buffers; avoid per-stroke allocations for coarse/upsampled masks.

5) Validation
 - Run `npm test -- --runTestsByPath src/utils/__tests__/ditherAlgorithms.test.ts`.
 - Manual strokes at Lostedge 0, mid, 100; confirm no UI hitching.
 - If worker added, verify main-thread fallback works when worker is unavailable.

6) Rollout
 - Leave cap/tile size configurable for quick tuning.
 - Document behavior near the slider and in code comments for future adjustability.
