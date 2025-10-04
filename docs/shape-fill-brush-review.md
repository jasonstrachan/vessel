# Shape Fill Brush Review (2025-10-03)

## TL;DR
- Shape-fill brushes spend most of their time building and probing a full-canvas signed distance field on the main thread.
- Flow and Ink Ribbons repeatedly call the `isPointInPolygonSDF` O(n) test inside dense integration loops, multiplying work by orders of magnitude.
- Preview render paths deliberately reduce quality (spacing, max steps, randomness) while the baked pass runs the heavy configuration, so the visuals diverge sharply.
- Pixel mode only snaps coordinates; Canvas still anti-aliases line edges, so we need a binary rasterization stage to get true on/off pixels.

## Systemic Issues
- **Full-canvas SDF sweep (`src/hooks/useBrushEngineSimplified.ts:1028`):** Every fill that needs gradients calls `createSignedDistanceField`, which iterates `(canvasSize + 600px padding)^2 / resolution` cells. On a 2048² canvas at the default resolution 2, that is ~1.7M samples. Each sample calls `isPointInPolygonSDF` and `distanceToPolygonSDF`, both O(vertex count), so complexity explodes with large shapes.
- **Random peak per SDF build (`src/hooks/useBrushEngineSimplified.ts:1070`):** The random offset for `peakX/peakY` means two invocations with the same vertices can produce different height fields. Preview vs bake often call the builder separately, so contour spacing, flow paths, and ribbon normals vary.
- **Main-thread work:** All of the above runs synchronously. Large fills stall the UI while we rasterize the SDF and trace the lines.

### Quick mitigations
- Limit the SDF domain to the polygon bounding box plus a small margin instead of the entire canvas (same pixels, far fewer cells).
- Push `createSignedDistanceField` into a worker and make it incremental (build coarse → refine if the user commits the stroke).
- Add a deterministic seed to the SDF builder so preview and baked runs share the same field. Cache by `(vertices, seed)`.

## Brush-specific Findings

### Contour / Lines / Lines2 (`src/brushes/shapes/fills/contour.ts`, `lines.ts`, `lines2.ts`)
- **Spacing differences:** Preview mode doubles `spacing` (`contour.ts` uses `spacingOverride` and falls back to `spacingBase * 2`), so preview renders fewer isolines than the baked pass.
- **Max-distance scan (`contour.ts:47-68`):** We walk the entire `fieldData.field` to find `maxDistance`. That is another `rows * cols` iteration and can be avoided by returning the maximum from the SDF builder.
- **Label stamping inside loop (`contour.ts:94-130`):** Measuring text during contour drawing triggers additional layout in the Canvas API; consider deferring labels to a separate pass after strokes.

### Flow (`src/brushes/shapes/fills/flow.ts`)
- **Repeated point-in-polygon checks (`flow.ts:181-207` & `223`):** Each seed traces forward/backward, checking membership twice per integration step. With 40k seeds and 120 steps you easily exceed 10M polygon tests.
  - Replace the polygon test with a signed distance lookup from the SDF we already built (`field.field`). A simple helper that bilinearly samples the field and checks sign removes the O(vertex) loop.
  - Precompute a Boolean occupancy grid aligned with the SDF resolution to reject seeds without the expensive test.
- **Dense seed raster scan (`flow.ts:216-241`):** We iterate across the padded bounding box on a grid. Small spacing values (<10) create tens of thousands of seeds, many discarded. Consider Poisson disk sampling inside the polygon using a grid index, or march along contour distance bands instead.
- **Preview divergence (`flow.ts:145-148`):** Preview spacing ×1.5 and steps ×0.6 give substantially shorter ribbons than the baked version. Instead, run the same algorithm on a lower-res SDF (e.g., resolution ×2) so geometry matches while cost drops.

### Ink Ribbons (`src/brushes/shapes/fills/inkRibbons.ts`)
- **Seed generation O(N²) (`inkRibbons.ts:260-276`):** For every candidate we walk all accepted seeds to enforce minimum distance. This becomes a bottleneck once seed counts exceed a few hundred. Use a spatial hash / grid (cell size ≈ spacing) to check only nearby seeds.
- **Inside test inside integrator (`inkRibbons.ts:380-383`):** Same issue as Flow—use the SDF sign instead of the polygon test each iteration.
- **Preview divergence (`inkRibbons.ts:314-316`):** Preview multiplies spacing by 1.35 and cuts steps to 65%. The stroke density and curvature differ drastically when baked. Again, prefer keeping parameters identical and only lower the SDF resolution / seed budget temporarily.
- **Noise + trig per step (`inkRibbons.ts:403-411`):** We allocate cos/sin per integration step. Cache `noiseScale` inverses and reuse trig values by precomputing lookup tables or using incremental rotation updates to avoid repeated `Math.cos/Math.sin` in hot loops.

### Delaunay Fill (`src/brushes/shapes/fills/delaunator.ts`)
- **Point-in-polygon inside Poisson sampling (`delaunator.ts:103-193`):** Both `addSeedPoint` and `generatePoissonPoints` repeatedly invoke `isPointInPolygonSDF`. Introduce a rotated-space bounding grid keyed by cell to avoid the O(n * seeds) membership checks.
- **`isFarEnough` linear search (`delaunator.ts:111-119`):** Minimum-distance enforcement is another N² loop. Reuse the same spatial grid suggested above.
- **Preview flag unused:** `isPreview` only affects caller decisions; you can hook it to reduce the number of Poisson layers while keeping triangle topology consistent.

### Cross Hatch (`src/brushes/shapes/fills/hatch.ts`)
- Workload is lighter, but we still iterate up to 2k lines (`hatch.ts:110-149`). Guard rail helps, yet preview could short-circuit earlier or reuse cached line sets keyed by vertices + rotation.
- Explore offloading the hatch line generation/drawing to the GPU, reusing the Flow seed + line-render stages once we parameterize them for hatch angles.

## Why Preview vs Baked Differ
- Preview toggles alter spacing, max steps, and noise amplitude (`flow.ts:145-148`, `inkRibbons.ts:314-316`). The baked pass restores full density, so the mark-making changes character.
- SDF randomness (`useBrushEngineSimplified.ts:1070-1099`) shifts gradient flows headlessly, so even if parameters match, the vector field differs between runs.
- Canvas state: Preview frequently renders on low-res temporary canvases; baked strokes land on the high-res scene buffer. Anti-aliasing differences become obvious when `lineWidth < 1` and colors include alpha.

## Pixel On/Off Output Strategy
1. Keep `pixelMode` snapping but clamp `lineWidth` to 1 and remove fractional widths in pixel brushes to avoid sub-pixel coverage.
2. Render fills to a small `ImageData` buffer: draw normally with `imageSmoothingEnabled = false`, read the pixels, then threshold each alpha to 0 or 255. Finally blit back with `putImageData`. This guarantees binary coverage regardless of Canvas anti-aliasing.
3. Alternatively, precompute path coverage directly into a Uint8Array mask by rasterizing edges with Bresenham-style integer stepping—ideal for the line-based fills.
4. Expose a `shapeFillPixelHardness` flag that switches brush color to opaque/transparent and uses `ctx.globalCompositeOperation = 'copy'` so intermediate alphas do not accumulate.

## Suggested Roadmap
1. **SDF Refactor:** Crop to polygon bounds + margin, add deterministic seed, expose max-distance in the return payload, and move to an off-main-thread worker.
2. **Flow & Ink Ribbons:** Replace point-in-polygon checks with signed-distance sampling and migrate seed rejection to spatial hashing. Profile again before adding new features.
3. **Preview Unification:** Use the same algorithm/data path for preview, just with throttled resolution. Store preview SDFs in a cache keyed by vertex hash + resolution to reuse for baking.
4. **Binary Pixel Mode:** Implement the image-data threshold pipeline for the pixel brushes and gate it behind `shapeFillPixelMode`.
5. **Metrics:** Add lightweight profiling (e.g., `performance.now()` buckets) around the fill stages to capture real timings in dev builds. That will help quantify progress.
