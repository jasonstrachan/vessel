# Plan: Fast Live Preview For CC Shape Dither

## Goal

Reduce drag lag while drawing color-cycle shapes with dithered fills, without changing finalized output quality.

The committed/finalized shape should keep the current full-quality render path. Only the live preview path should become cheaper.

## Problem statement

The current live preview path is too close to finalize quality. During pointer move, the shape preview still does all of the following on the main thread:

- rebuild preview stops / derived gradient stops
- build the dither runtime palette
- parse and sort stops into RGBA samples
- compute polygon ROI bounds and local vertices
- compute gradient axis projection
- allocate a temp canvas and `ImageData`
- run `fillCcGradientDither(...)` over the ROI
- clear and redraw the preview overlay

This work lives mainly in:

- `src/hooks/canvas/handlers/shapes/ShapeToolHandler.ts`
- `src/utils/colorCycle/ccGradientDither.ts`

The result is predictable: RAF throttling limits scheduling frequency, but each frame is still expensive.

## Non-goals

- Do not change finalized shape appearance.
- Do not redesign sampled-flat color logic in this plan.
- Do not introduce workers in phase 1.
- Do not change non-CC shape preview behavior.

## Design principle

Preview quality and finalize quality must be treated as different products.

Live drag should optimize for responsiveness and stable visual guidance.

Mouse-up/finalize should optimize for fidelity.

## Proposed solution

Add an explicit fast preview mode for dithered CC shape previews.

During drag:

- use a cheaper preview algorithm and/or coarser settings
- keep preview visually representative, not exact
- avoid running the full finalize-quality dither path unless strictly needed

During finalize:

- continue using the existing full-quality path

## Scope

Primary files:

- `src/hooks/canvas/handlers/shapes/ShapeToolHandler.ts`
- `src/utils/colorCycle/ccGradientDither.ts`

Possible small supporting additions:

- preview config helpers in `src/hooks/canvas/handlers/shapes/**` or `src/utils/colorCycle/**`
- targeted tests under `src/utils/colorCycle/__tests__/` and shape handler tests if needed

## Phase 1: Fast preview mode

### Summary

When `shouldDitherPreview` is true in the polygon preview path, use preview-only quality clamps before calling `fillCcGradientDither(...)`.

### Preview-only quality rules

These values are intentionally conservative and should be easy to tune:

```ts
const previewPixelSize = Math.max(finalPixelSize, 2);
const previewLevels = Math.min(finalLevels, 4);
const previewAlgorithm = finalAlgorithm === 'sierra-lite'
  ? 'pattern'
  : finalAlgorithm;
const previewPatternStyle = finalPatternStyle ?? 'dots';
```

Notes:

- `pixelSize`:
  - larger cells reduce ROI work immediately
  - this is the highest-leverage knob
- `levels`:
  - clamp live preview band count so preview does not spend time resolving many levels
- `algorithm`:
  - for live drag, prefer ordered/pattern output over error-diffusion output when final algorithm is `sierra-lite`
  - finalize remains unchanged

### Why this is the highest-value fix

This avoids the worst-case cost multiplier:

- full ROI + fine pixel grid + multi-level diffusion

The user still sees:

- the right shape
- the right overall gradient direction
- approximate palette/spread behavior

But drag no longer pays for finalize-quality diffusion every frame.

## Detailed implementation

### Step 1: Isolate preview render settings

Add a small helper in `ShapeToolHandler.ts` or a nearby utility:

```ts
type CcPreviewRenderSettings = {
  pixelSize: number;
  levels: number;
  algorithm: DitherAlgorithm;
  patternStyle: PatternStyle;
  isFastPreview: boolean;
};

const resolveCcShapePreviewRenderSettings = ({
  pixelSize,
  levels,
  algorithm,
  patternStyle,
}: {
  pixelSize: number;
  levels: number;
  algorithm: DitherAlgorithm;
  patternStyle?: PatternStyle;
}): CcPreviewRenderSettings => {
  const clampedPixelSize = Math.max(1, Math.round(pixelSize));
  const clampedLevels = Math.max(1, Math.min(16, Math.round(levels)));

  if (algorithm === 'sierra-lite') {
    return {
      pixelSize: Math.max(clampedPixelSize, 2),
      levels: Math.min(clampedLevels, 4),
      algorithm: 'pattern',
      patternStyle: patternStyle ?? 'dots',
      isFastPreview: true,
    };
  }

  return {
    pixelSize: Math.max(clampedPixelSize, 2),
    levels: Math.min(clampedLevels, 4),
    algorithm,
    patternStyle: patternStyle ?? 'dots',
    isFastPreview: true,
  };
};
```

This keeps preview logic explicit and makes tuning easy.

### Step 2: Apply preview settings only in the live preview branch

In the dithered CC shape preview branch in `ShapeToolHandler.ts`, compute:

- final/fidelity settings from the brush as today
- preview settings from the helper above

Then pass the preview settings to `fillCcGradientDither(...)` instead of the final settings.

Concretely, replace the direct use of:

- `pixelSize`
- `levels`
- `fillAlgorithm`
- `fillPatternStyle`

with preview-resolved values only inside the live preview block.

Do not change finalize code paths.

### Step 3: Preserve sampled-flat routing compatibility

The fast preview mode should still preserve sampled-flat behavior in broad terms:

- sampled stops still flow through
- spread still affects the palette
- the preview still uses the same runtime stop set

But it does not need to use finalize-quality Sierra-Lite during drag.

This means the preview can still call `fillCcGradientDither(...)`, just with a cheaper algorithm and lower levels.

### Step 4: Keep current cached preview canvas behavior

Do not redesign `ditherGradPreviewState` in phase 1.

Keep:

- `ccLastCanvas`
- `ccLastOrigin`
- `ccJobInFlight`
- `ccJobDirty`

That cache behavior already avoids some redundant blits and gives a safe base for the fast preview settings.

## Phase 2: Cache palette and stop preparation

This is the next fix after phase 1, but not part of the first patch.

### Current expensive repeated work

Repeated every preview job:

- `buildForegroundDerivedGradientSpec(...)`
- `deriveForegroundGradientStops(...)`
- `buildCcDitherRuntimePalette(...)`
- `parseCssColorToRgba(...)`
- sorting stops
- rebuilding `sampleGradient(...)`

### Planned fix

Cache a preview-prepared stop bundle keyed by:

- sampled/derived stop hash
- `gradientBands`
- `ditherPaletteSpread`
- `ditherAlgorithm`
- `patternStyle`
- foreground-derived settings if enabled

Cached value:

```ts
type PreparedPreviewGradient = {
  renderStops: StoredStop[];
  sortedStops: Array<{ position: number; rgba: [number, number, number, number] }>;
};
```

## Phase 3: Reuse preview buffers

Also not part of the first patch.

### Planned fix

Keep per-session reusable:

- temp canvas
- matching `ImageData`
- typed arrays sized to the current ROI bucket

Only reallocate when the preview ROI grows beyond the cached buffer size.

## Acceptance criteria

### Functional

- Shape preview remains visible and tracks pointer movement correctly.
- Finalize output is unchanged relative to current behavior.
- Sampled preview still reflects sampled stops.
- Spread still visibly affects preview richness.

### Performance

- Live preview should feel materially smoother on large dithered CC polygons.
- Pointer drag should no longer stall waiting for finalize-quality diffusion.
- Repeated preview jobs should not visibly backlog under normal drawing speed.

### Safety

- No changes to committed render semantics.
- No changes to non-CC shape preview behavior.
- No changes to mouse-up/finalize fidelity path.

## Testing plan

### Manual

Test these scenarios:

1. CC shape with non-sampled gradient, dithering on, low spread.
2. CC shape with non-sampled gradient, dithering on, high spread.
3. CC shape with sampled gradient, dithering on, low spread.
4. CC shape with sampled gradient, dithering on, high spread.
5. Compare live preview during drag vs finalized output on mouse-up.
6. Test small shapes and very large polygons.

### Automated

Add targeted tests where practical for:

- preview settings helper returns coarser settings for live preview
- finalize path does not use preview-only clamps
- sampled-flat routing remains intact when preview algorithm is downgraded

## Risks

### Risk: preview no longer matches finalize closely enough

Mitigation:

- keep sampled stops and palette/spread logic intact
- degrade only diffusion fidelity, not the entire color model
- tune clamps conservatively first

### Risk: ordered preview hides sampled-flat richness

Mitigation:

- treat preview as approximate guidance
- if needed, allow a slightly richer preview mode for high spread only

### Risk: users notice preview-to-final jump

Mitigation:

- keep geometry and gradient direction identical
- only simplify the dither quality
- adjust clamps after manual testing

## Suggested patch order

1. Add `resolveCcShapePreviewRenderSettings(...)`.
2. Apply preview-only settings in the dithered CC polygon preview branch.
3. Verify manual preview behavior.
4. Run:
   - `npm run type-check`
   - `npm run lint`
   - targeted tests
5. Commit phase 1 separately from later caching work.

## Definition of done for phase 1

- Live preview path uses a cheaper preview-only render configuration.
- Mouse-up/finalize path remains unchanged.
- Type-check and lint pass.
- Manual drag feels noticeably smoother for dithered CC shapes.
