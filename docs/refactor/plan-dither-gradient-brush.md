# Plan: Core Dither Gradient for Shape Tool Polygon Fill

## Goal
- Add a core **Shape Tool polygon fill** mode that renders a foreground→background gradient using **ordered dithering**.
- Preview should be in the same ballpark as final (exact match not required).

## Scope
- New ordered-dither gradient helper (single source of truth).
- New polygon-fill implementation for `BrushShape.DITHER_GRADIENT` (or a new enum value) in the Shape Tool fill path.
- Register preset so it appears in BrushLibrary / Shape Tool options.
- Minimal preview wiring that calls the same helper at lower res.
- Small unit test for the helper.

## Constraints / Guardrails
- Prefer **pure ordered dithering** (Bayer tile) → no RNG/seed needed for v1.
- Avoid palette quantization in v1: use threshold-based ordered dithering.
- Keep allocations low: cache tiles; temp canvas bounded to polygon bounds; reuse `canvasPool`.
- Use palette **foreground/background** explicitly; do not infer from `brushSettings.color`.

## Gradient Definition (Polygon)
- Start point `S`: first polygon vertex (or pointer-down captured at shape start).
- End point `E`: farthest vertex from `S` (`argmax ||V - S||`).
- Direction `dir = normalize(E - S)`, length `L = ||E - S||`.
- Optional later refinement (“true opposing ends”): compute min/max projections along `dir`.

## Keep It Simple Now, Expandable Later
To avoid rewrites when adding features later, the helper should be designed as a small pipeline:

1) **Coverage ramp** (0..1 value per pixel) driven by `{S, dir, L}`  
2) **Dither stage** converts coverage to either:
   - an **ink index** (palette entry), or
   - final RGBA pixels
3) **Mask stage** clips to polygon
4) **Post-alpha stage** (optional later) for lost-edge / erosion

Even in v1, design inputs to support:
- `pixelSize` (preview can use larger pixels; final smaller)
- `palette: RGBA[]` (v1 uses 2 entries; later supports more)
- transparent BG (no-bg-fill) by allowing `bgRGBA.a = 0`

## Pitfalls to Avoid
- A finalize step that re-renders/overwrites the dithered fill (finalize should be a no-op for this brush).
- Reintroducing “numColors vs palette mismatch” (common cause of collapsing to flat).
- Parsing issues: keep colors as `[r,g,b,a]` internally (don’t rely on CSS strings).
- Preview drift due to different coordinate spaces (compute axis in the same vertex space for preview and final).

---

## Implementation Steps

### 1) Helper: ordered dither gradient renderer
Add `src/utils/orderedDitherGradient.ts`:

#### 1.1 Axis
- `computeGradientAxisFromPolygon(vertices)`
  - returns `{ start: S, end: E, dir, length }`

#### 1.2 Renderer (v1)
- `renderOrderedDitherGradientToImageData(params)`
  - Inputs:
    - `width`, `height`
    - `axis` in **bounds-local coordinates**
    - `paletteRGBA: Array<[r,g,b,a]>` (v1: length 2 => FG/BG)
    - `tile` (cached Bayer matrix, e.g. 8×8 normalized thresholds)
    - `pixelSize` (>=1): chunking for performance / “bigger pixels”
    - `noBgFill` behavior via `paletteRGBA[0/1].a` (BG alpha can be 0)
  - Output:
    - `ImageData` with pixels selected by ordered threshold vs ramp.
    - Alpha initially 255 (or BG alpha), polygon mask happens next.

#### 1.3 Cache
- `getBayerTile(size=8)` returns cached threshold table.

### 2) Integrate into Shape Tool polygon fill path
In the Shape Tool codepath that currently fills polygons (your `drawPolygonGradient` / polygon finalize path):

- Detect `BrushShape.DITHER_GRADIENT` and route to:
  - `fillPolygonWithOrderedDitherGradient(ctx, vertices, isPreview)`

Implementation outline:
1. Compute polygon bounds `(minX, minY, maxX, maxY)`.
2. Acquire temp canvas via `canvasPool.acquire(w, h)` where `w/h` are bounds size (+ small padding).
3. Compute axis:
   - `S = vertices[0]`
   - `E = farthest vertex from S`
   - convert to bounds-local by subtracting `(minX, minY)`
4. Render gradient into temp `ImageData` using helper and `putImageData` into temp.
5. Mask to polygon:
   - `tempCtx.globalCompositeOperation = 'destination-in'`
   - draw polygon path filled white
   - optional: force binary alpha (255/0) after mask for crisp edges
6. Blit to destination:
   - `ctx.imageSmoothingEnabled = false`
   - `ctx.drawImage(tempCanvas, minX, minY)`
7. Release temp canvas.

### 3) Finalize behavior
- Ensure polygon finalize does **not** run any generic `[shape-dither-finalize]` post-pass for this brush.
- For `BrushShape.DITHER_GRADIENT`, finalize should:
  - do nothing extra (already drawn), or
  - only handle history/commit bookkeeping.

### 4) Preview wiring
- Preview uses the same function but can simplify:
  - set `pixelSize` larger (e.g. 3–6) for speed
  - downsample bounds (optional)
  - still compute `S/E` the same way
- Final uses `pixelSize` from settings (often 1–3).

### 5) Preset
Add a preset in `src/presets/brushPresets.ts`:
- `brushShape: DITHER_GRADIENT`
- explicitly uses palette FG/BG
- defaults:
  - `fillResolution` / `pixelSize` (e.g. 3)
  - `tileSize` (8)
  - opacity/blend mode

### 6) Unit test
Add `src/utils/__tests__/orderedDitherGradient.test.ts`:
- Determinism: same inputs → same output (Bayer tile, no RNG).
- Not flat: output contains >1 unique RGB when FG != BG.
- Gradient sanity: sample along the axis and assert FG ratio changes across slices.

---

## Future Expansion Checklist (No Rewrite If Helper Is Structured)
- **More patterns (ordered):** swap tile source (Bayer variants / blue-noise tile).
- **More colors / bands:** accept `paletteRGBA.length > 2` and dither between adjacent bins using the same threshold tile.
- **Pressure-res / progressive preview:** preview uses larger `pixelSize`, refine as user edits/adds points.
- **Lost edges:** post-mask alpha erosion step (operate on alpha only).
- **No BG fill:** set BG alpha to 0 (transparent “off ink”) and ensure finalize does not repaint.

---

## Validation
- Manual:
  - convex/concave polygons
  - different fg/bg pairs
  - large bounds performance
  - confirm no secondary finalize overwrites occur
- Automated:
  - run unit test + lint/type-check
