# Goblet Fit Modes

This page summarizes how the Goblet viewer resolves viewport sizing and layer-level fit behavior. Source references point to the compiled runtime in `public/goblet` so you can cross-check the exact logic.

## Viewport Modes

The viewer normalizes every `metadata.viewport.mode` token to one of four modes before sizing the canvas.

- **fill** – Expands the backing canvas to the current window size on every resize. Horizontal and vertical scale values are computed independently from the window-to-design ratio, so the document will stretch to eliminate letterboxing. Overrides multiply into those base scales (`public/goblet/goblet.js:2242-2256`, `public/goblet/goblet.js:2305-2309`).
- **fit** – Preserves aspect ratio by using the smaller of the width/height scale ratios, letterboxing as needed. The resolved uniform scale feeds both the viewport mapping and optional overrides, and offsets center the artwork inside the canvas (`public/goblet/goblet.js:2259-2271`, `public/goblet/goblet.js:834-842`).
- **cover** – Preserves aspect ratio by using the larger of the width/height scale ratios, filling the viewport without gutters while allowing edge cropping. This mode remains available in the viewer runtime, but Embed export uses fixed composition coordinates plus cover-style scaling to avoid per-layer layout drift.
- **fixed** – Keeps the canvas at the design-time pixel dimensions until callers supply an explicit scale override. No automatic window-based scaling occurs (`public/goblet/goblet.js:2274-2292`).

## Embed Presets

The export modal now splits embed behavior into two viewer-side presets while keeping the underlying composition in fixed document coordinates.

- **embed-fill** – Uses `max(viewportWidth / designWidth, viewportHeight / designHeight)`, preserving proportions and filling the host container with composition-level cropping.
- **embed-fit** – Uses `min(viewportWidth / designWidth, viewportHeight / designHeight)`, preserving proportions and keeping the whole composition visible inside the host container.

Both presets avoid the old per-layer relayout bug because only the final composition is scaled in the viewer.

## Layer Fit Modes

Layer alignment settings flow through `computeLayerTransform` in `public/goblet/alignFitResolver.js`, which collapses all exported tokens into the modes below. Destination rectangles are finalized by `computeLayerDestination`, and raster draws happen in `applyLayerToContext` (`public/goblet/goblet.js:1997-2168`).

Older exports that still declare `fit: 'uniform'` are normalized to `contain` during load. New layers default to `contain` via `createDefaultLayerAlignment` (`src/utils/layoutDefaults.ts:46-53`), keeping artwork fully visible without manual tweaking.

- **contain** – Computes the classic contain scale using full document dimensions, allowing both up- and down-scaling (`public/goblet/alignFitResolver.js:90-120`).
- **cover** – Chooses the larger of the width/height ratios so the viewport is fully covered, potentially clipping the document (`public/goblet/alignFitResolver.js:115-124`).
- **fill** – Scales width and height independently to exactly occupy the viewport, distorting aspect ratio when the viewport shape changes (`public/goblet/alignFitResolver.js:121-131`).
- **tile** – Leaves the sample region at native document scale and repeats it as a pattern across the destination rectangle. Phase offsets (from alignment or layout) shift the repeat origin, and the renderer disables smoothing for crisp repeats (`public/goblet/alignFitResolver.js:126-137`, `public/goblet/goblet.js:2088-2138`, `public/goblet/goblet.js:2573-2617`).
- **none** – Applies no scaling; the document stays at authoring resolution apart from any explicit transforms upstream (`public/goblet/alignFitResolver.js:132-138`).

These behaviors are consistent for both exported Goblet builds and runtime viewers that reuse the same resolver bundle. Update `scripts/build-align-fit.mjs` outputs if you change the resolver in TypeScript.
