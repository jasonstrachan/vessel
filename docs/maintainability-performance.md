# Tinybrush Maintainability and Performance Guide

This document captures prioritized, actionable recommendations to make Tinybrush easier to maintain and faster in practice. It’s organized so you can apply improvements incrementally.

## High‑Impact Performance
- Reuse floating‑paste canvas: In `src/components/canvas/DrawingCanvas.tsx`, don’t create a canvas per frame for floating paste. Keep a single `pasteCanvas` in a ref, resize as needed.
- Reduce full recompositions: Drive `compositeLayersToCanvas` only when a compact layer change hash changes (id, visible, opacity, imageData version). Avoid recomposing on every color‑cycle frame; overlay animated CC layers atop a cached composite when possible.
- Offload palette/gradient work: Use `src/lib/performance/GradientWorkerManager.ts` + `src/workers/gradientWorker.ts` for gradient generation and palette shifting everywhere (avoid synchronous paths).
- OffscreenCanvas/ImageBitmap: Integrate `src/lib/performance/OffscreenRenderer.ts` and `src/lib/performance/ImageBitmapTransfer.ts` in render/composite paths when supported to reduce main‑thread blocking.
- Throttle pointer work with RAF: Keep pointer handlers minimal; subscribe only to needed store slices. Ensure no excessive store reads per move.
- Strip dev logging in prod: Gate logs via `src/utils/debug.ts` and remove raw `console.*` in hot paths. Ensure they’re dead‑code‑eliminated in production.

## State Management (Zustand)
- Split the monolithic store: Break `src/stores/useAppStore.ts` into slices (project, canvas, tools, layers, ui, history, autosave, customBrushes). Compose with Zustand’s slice pattern for readability and testability.
- Add `subscribeWithSelector`: Wrap the store with `subscribeWithSelector` to reduce re‑renders and enable fine‑grained selectors. Export typed selectors (e.g., `useActiveLayer`, `useCanvasTransform`).
- Use shallow + narrow selectors: In components like `DrawingCanvas`, select only what’s needed (e.g., `tools.currentTool`, `tools.brushSettings.brushShape`) with shallow equality to avoid re-renders.
- Avoid `getState()` in UI: Prefer selectors/hooks. Use refs for imperative needs; reserve `getState()` for store/util layers.
- Enforce layer invariants: Create typed guards/helpers to preserve color‑cycle invariants (layerType ↔ colorCycleData). Replace ad hoc console errors/debuggers with consistent checks.

## Rendering Pipeline
- Checkerboard background: Use a memoized pattern canvas or CSS background on the wrapper instead of filling the checkerboard each frame.
- IndexBuffer efficiency: Reuse a single `ImageData` buffer for `putImageData`; avoid per‑frame `createImageData` where possible.
- Consolidate color‑cycle path: Ensure a single color‑cycle renderer/animator path is used; avoid mixed setTimeout + RAF scheduling. Respect target FPS and event backpressure.
- Avoid object churn: Cache `Path2D` and other objects during shape tools; invalidate only on state changes.

## Type Safety & Code Quality
- Replace `any`/casts in hot paths: Define a shared `ColorCycleData` interface and `ColorCycleBrushImplementation` and use across store/components/hooks.
- Expand type coverage: Introduce `tsconfig.worker.json` and `tsconfig.jest.json` so workers and tests are type‑checked without impacting app builds.
- Lint rules: Enforce no raw `console.*` in `src/` (allow `debugLog`), ban `useAppStore.getState()` in components, prefer named imports, and ensure consistent path aliases.

## Next.js & Build
- Production logging strip: Wrap debug usage with `process.env.NODE_ENV !== 'production'` or a static flag so SWC eliminates it in prod.
- Bundle analysis: Add `@next/bundle-analyzer` to inspect bundle; use tree‑shaken imports (lucide icons, `@heroui/*`) to prevent pulling unused code.
- Static export compatibility: Keep test/demo pages out of production export or guard them as dev‑only. Validate `basePath`/`assetPrefix` under `/tinybrush`.

## Testing
- Store invariants tests: Validate that color‑cycle layers retain `layerType` and `colorCycleData` across add/update/remove/undo/redo.
- Performance micro‑tests: Add tests/benches for IndexBuffer serialization and worker round‑trip latency to catch regressions.
- UI tests: Layer list interactions (visibility, reorder), brush switching size restoration (custom ↔ regular), selection lifecycle.

## Quick Wins Checklist
- [ ] Replace raw `console.*` with `debugLog` and gate via env.
- [ ] Reuse floating‑paste canvas and checkerboard pattern canvas refs.
- [ ] Wire `subscribeWithSelector` and migrate key components to minimal selectors.
- [ ] Split `useAppStore.ts` into slices without behavior changes.
- [ ] Route all gradient/palette computations through the worker manager where safe.

## Suggested Adoption Plan (Incremental)
1) Logging and selectors (low risk)
   - Centralize logging via `debugLog`, add lint rule to prevent raw console usage.
   - Add `subscribeWithSelector`; convert `DrawingCanvas` and `MinimalLayerList` to narrow, shallow selectors.

2) Canvas reuse and composite dirtiness (medium)
   - Add refs for floating‑paste and checkerboard pattern canvases.
   - Introduce a concise `layersHash` that includes an imageData version counter and only recomposite on changes.

3) Workerization and offscreen integration (medium)
   - Ensure gradient/palette updates use `GradientWorkerManager` where synchronous code remains.
   - Integrate `OffscreenRenderer`/`ImageBitmapTransfer` when supported.

4) Store slices and invariants (higher‑touch)
   - Extract slices; add typed invariants with tests for color‑cycle layers and undo/redo flows.

5) Build & bundle hygiene (ongoing)
   - Add bundle analyzer, trim imports, and keep static export guards intact.

---

References
- `src/components/canvas/DrawingCanvas.tsx`
- `src/stores/useAppStore.ts` and `src/stores/colorCycleBrushManager.ts`
- `src/lib/performance/*`, `src/workers/gradientWorker.ts`
- `src/utils/debug.ts`

