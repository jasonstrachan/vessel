osaic Brush (Stroke) — Spec + Implementation Plan (Pressure, Rotation, Dither)

## Summary

Mosaic is a stamp-along-path stroke brush (not Color-Cycle yet). Each stroke locks a palette subset derived from the existing Gradient dropdown (same stop source as CC/manual gradients). The brush paints tile-based marks. By default, tiles are flat (single solid color). Optionally, each tile can be dithered using Sierra-Lite error diffusion to approximate a continuous target color while quantizing to the stroke’s locked palette subset.

Pressure and rotation must behave exactly like existing stamp brushes:
- Pressure scales stamp size smoothly (no per-stamp cache rebuild).
- Rotation rotates each stamp around its center (pixel-crisp; smoothing disabled).

---

## 0) Invariants

1. Palette is locked per-stroke (chosen once at stroke start). It may only change at segment boundaries.
2. Segment timing is based on traveled stroke distance, independent of pressure and rotation.
3. Pressure and rotation never affect palette selection or segment timing.
4. Dithering, if enabled, is constrained within each tile (no error bleed across tile edges).
5. Performance goal: do heavy work only when building the stamp cache (stroke start + segment boundary). Stamping itself must remain lightweight.

---

## 1) BrushSettings (parameters)

### Required
- mosaicTilePx: number  
  Base tile size in pixels.
- mosaicSegmentPx: number  
  Traveled distance in pixels before palette shuffle.
- mosaicPaletteCount: number  
  Number of colors in the stroke’s locked palette subset; also controls stamp width.
- mosaicSeed?: number  
  Optional deterministic seed; if absent, generate a per-stroke seed.

### Dither (new)
- mosaicDitherEnabled: boolean (default false)
- mosaicDitherAlgo: 'sierra-lite' (v1 fixed; no need for multi-algo UI yet)
- mosaicDitherAmount?: number (0..1)  
  Only add if you already have “amount/strength” patterns elsewhere. Otherwise omit for v1.

### Suggested “Mosaic” preset defaults
- size: 60 (typical working range 40–80)
- mosaicTilePx: 8 (target range 6–12)
- mosaicPaletteCount: 6 (target range 4–8)
- mosaicSegmentPx: 160 (target range 120–200)
- mosaicDitherEnabled: false

---

## 2) Derived sizing rules (and pressure interaction)

### 2.1 Per-stroke locked geometry
To keep pressure smooth and avoid cache churn:
- Resolve tilePx and paletteCount once at stroke start from BrushSettings.
- Apply pressure as a per-stamp scale transform when drawing.

### 2.2 Clamps (v1)
- tilePx = clamp(round(mosaicTilePx), 1, 128)
- paletteCount = clamp(round(mosaicPaletteCount), 1, 32)
- segmentLengthPx = clamp(round(mosaicSegmentPx), 1, 5000)

### 2.3 Pressure scaling (per stamp)
Use the existing pressure pipeline used by current brushes:
- scale = resolvePressureScale(pressure, brushSettings)  // existing helper/curve/min/max
- drawW = stampW * scale
- drawH = stampH * scale

Segment timing uses path distance only (not scaled by pressure).

---

## 3) Stamp layout

### 3.1 Footprint dimensions
- cols = paletteCount
- rows = max(1, round(paletteCount * 0.6))  // recommended stroke-ish shape
- stampW = tilePx * cols
- stampH = tilePx * rows

### 3.2 Tile fill mapping (base)
Within a stamp, tiles reference the stroke’s activePalette:
- idx = (col + row * cols) % activePalette.length

(Keep deterministic mapping in v1; optional per-tile jitter can be added later.)

---

## 4) Segment behavior (palette evolution)

### 4.1 Distance tracking
On each pointer update:
- dist = hypot(x - lastX, y - lastY)
- segmentRemainingPx -= dist

### 4.2 Boundary rule
When segmentRemainingPx <= 0:
- Shuffle the existing palette order (v1 behavior).
- Rebuild the stamp cache (because appearance depends on palette order).
- segmentRemainingPx += segmentLengthPx (loop until positive to handle big jumps)

v1 explicitly does shuffle-only (no resample). If you want resample later, add a setting.

---

## 5) Palette derivation from Gradient dropdown

### 5.1 Stops source
Use the exact same gradient stops source as CC/manual gradients (the Gradient dropdown).

### 5.2 Sampling palette subset
Build N colors from the gradient at stroke start:
- For i = 0..N-1:
  - t = (i + 0.5) / N
  - color = evalGradientAt(stops, t) using your existing interpolation
- activePalette = [color0..colorN-1]
- Shuffle activePalette once at stroke start.

Fallback:
- If stops are missing/invalid, use a safe default gradient (e.g., black→white).

---

## 6) Per-stroke runtime state (no code in doc)

Maintain a Mosaic stroke state object for the active stroke, containing:

Palette:
- activePalette: array of colors (strings)

Segment tracking:
- segmentLengthPx
- segmentRemainingPx

Movement tracking:
- lastX, lastY

RNG:
- seed
- rng instance

Locked geometry + cache:
- tilePx
- paletteCount
- rows
- stampCanvas (or equivalent cached bitmap)
- stampW, stampH

Dither:
- ditherEnabled (resolved at stroke start)
- ditherAmount (optional if implemented)

Notes:
- This state is runtime-only unless you need deterministic replay/export.
- Stamp cache rebuild occurs only at stroke start and segment boundaries.

---

## 7) Rendering approach (fast + crisp)

### 7.1 Core idea: cache a stamp bitmap
To keep stamping fast, build a stamp bitmap (canvas/ImageData) and reuse it for drawImage stamping. Rebuild only:
- at stroke start
- at segment boundaries

### 7.2 Flat mode (default)
Build a stamp bitmap by filling a tile grid:
- Canvas size: stampW × stampH
- For each tile cell:
  - choose color from activePalette via deterministic index
  - fill the tile rect
- Disable image smoothing while building the cache.

### 7.3 Dithered mode (Sierra-Lite) — contained within tiles
When dither is enabled, each tile is rendered as a dithered patch.

#### 7.3.1 Define a target color per tile (required)
Dithering needs a continuous target. v1 target definition:
- tileIndex = col + row * cols
- tileCount = cols * rows
- tTile = (tileIndex + 0.5) / tileCount
- targetColor = evalGradientAt(stops, tTile)

This makes different tiles aim at different parts of the gradient, while quantizing to the locked palette subset.

#### 7.3.2 Quantization palette
Quantize to the stroke’s locked activePalette:
- Decode activePalette to RGB once per cache rebuild.
- Use nearest-color matching in RGB space (Euclidean distance) for v1.

#### 7.3.3 Sierra-Lite diffusion rule (tile-local)
For each tile region independently:
- Reset error buffers at the start of the tile (no cross-tile bleeding).
- Scan pixels within the tile (left-to-right, top-to-bottom):
  - desired = targetRGB + accumulatedError
  - picked = nearestPaletteColor(desired)
  - write picked
  - error = desired - picked
  - diffuse error using Sierra-Lite weights, but only to neighbors that remain inside this tile.

### 7.4 Performance safety (v1 explicit behavior)
v1 must be unambiguous:

- Define DITHER_MAX_PIXELS (default 256×256).
- If dither is enabled AND stampW*stampH > DITHER_MAX_PIXELS:
  - v1 fallback: build the stamp in Flat mode (no dithering) for this rebuild.

No automatic geometry changes (do not silently reduce rows/paletteCount) in v1.

### 7.5 Crispness requirement
- Always disable image smoothing for Mosaic:
  - while building the cache bitmap
  - while stamping (drawImage)
This preserves pixel-crisp tiles.

---

## 8) Pressure + rotation stamping

For each stamp placement point along the path:
- Compute scale from the existing pressure pipeline.
- Compute drawW/drawH from cached stampW/stampH multiplied by scale.
- Apply rotation around the stamp center using the incoming rotation value.
- Draw the cached stamp bitmap with smoothing disabled.

Pixel alignment:
- Round the stamp center coordinates before transforms to reduce shimmer.

---

## 9) Engine integration (stroke lifecycle)

### 9.1 Brush registration
- Add a Mosaic brush kind/type in the brush registry.
- Add UI controls for:
  - mosaicTilePx
  - mosaicPaletteCount
  - mosaicSegmentPx
  - mosaicDitherEnabled
  - (optional) mosaicSeed / mosaicDitherAmount if desired

### 9.2 Stroke start
1. Resolve and clamp tilePx, paletteCount, segmentLengthPx, ditherEnabled.
2. Resolve seed:
   - use mosaicSeed if provided, else generate per-stroke seed.
3. Fetch gradient stops (same source as CC/manual).
4. Sample activePalette from stops and shuffle once.
5. Build stamp cache:
   - If ditherEnabled AND stamp area <= DITHER_MAX_PIXELS: build dithered cache.
   - Else: build flat cache.
6. Initialize:
   - segmentRemainingPx = segmentLengthPx
   - lastX/lastY = start point

### 9.3 Stroke continue
1. Compute dist from last point; decrement segmentRemainingPx.
2. While segmentRemainingPx <= 0:
   - shuffle activePalette
   - rebuild stamp cache using the same dither/flat decision rules
   - segmentRemainingPx += segmentLengthPx
3. Place stamps along the path using the existing spacing walker:
   - recommended spacingPx = max(1, floor(tilePx * 0.75))
4. For each stamp:
   - draw cached stamp with pressure scale + rotation
5. Update lastX/lastY

### 9.4 Stroke end
- Release references to cached stamp bitmap to avoid memory leaks.

---

## 10) Determinism (optional)

If deterministic replay/export is required:
- Store per-stroke:
  - seed
  - tilePx, paletteCount, rows
  - segmentLengthPx
  - ditherEnabled
  - gradient identity (or store sampled palette)
- Ensure the shuffle sequence is fully determined by seed and segment boundary counts.

If strokes are directly rasterized into the layer bitmap during drawing, determinism is less critical.

---

## 11) Tests

Functional:
- Dither OFF: tiles are solid; palette changes only at segment boundaries.
- Dither ON: tile-local dithering visible; no error bleed across tile edges.
- Segment timing: shuffles occur at consistent traveled distances, independent of pressure.
- Gradient change mid-stroke does not affect the ongoing stroke; affects next stroke.

Performance:
- Cache rebuild only at stroke start + segment boundaries (no per-stamp rebuild).
- When stamp area exceeds DITHER_MAX_PIXELS, dither mode falls back to Flat (verify).

Input feel:
- Pressure smoothly scales stamp size.
- Rotation rotates stamps without blurring.

---

## 12) Implementation order (v1)

1. Ensure doc filename policy is consistent (this doc is docs/brushes/mos.md; remove stale rename notes unless you are actually renaming files).
2. Add BrushSettings fields and UI controls (including mosaicDitherEnabled).
3. Implement palette sampling from gradient stops and per-stroke shuffle.
4. Implement flat stamp cache builder.
5. Implement tile-local Sierra-Lite dithering:
   - nearest palette color matcher
   - tile-local error buffers (no cross-tile diffusion)
   - per-tile target color from evalGradientAt(stops, tTile)
6. Add DITHER_MAX_PIXELS cap and v1 fallback-to-flat rule.
7. Integrate into stroke lifecycle and stamping path with existing pressure + rotation.
8. Add tests + profiling and tune DITHER_MAX_PIXELS if needed.



## Brush library placement and naming (v1)

- Location in brush library: under **Soft Round** (same group/section).
- Display name: **mosiac** (intentional spelling, as implemented in the library).
- Internal kind/key:
  - Use a stable key like `mosaic` (recommended) while displaying `mosiac`, OR
  - Use `mosiac` everywhere (only if you are certain there will be no later correction).
- Preset id/name:
  - Preset name shown in UI: `mosiac`
  - Preset default settings: as defined in §1 (size/tile/palette/segment + dither toggle)

## Engine/registry wiring (where this shows up)

1. Register the new brush entry in the brush library list **adjacent to Soft Round** entries:
   - Group: Soft Round
   - Label: `mosiac`
   - Kind: `BrushKind.Mosaic` (or `BrushKind.Mosiac` if you insist on matching the label)
2. Ensure the brush picker selects it like any other stroke brush (not CC).
3. Ensure BrushSettings defaults apply when switching to `mosiac` from Soft Round:
   - populate mosaicTilePx / mosaicPaletteCount / mosaicSegmentPx
   - mosaicDitherEnabled default false