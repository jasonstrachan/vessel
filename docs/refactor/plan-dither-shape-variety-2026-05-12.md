# Dither Shape Variety Plan

Date: 2026-05-12

Status: Revised 2026-07-30. Regular Dither Shape variety is derived only from
visible brush settings. Polygon geometry no longer changes tone or phase, so
translated shapes with the same settings and pressure remain identical.

## Goal

Make `Dither Shape` respond to the same kind of visible variety control that `CC Gradient` gets from the `Variety` / `ditherPatternDiversity` slider, without changing CC Gradient behavior.

## Current Findings

- `Dither Shape` is a `PIXEL_DITHER` brush with shape mode enabled.
- Finalize draws the shape, then runs `applyStrokeDither(...)` over the committed shape region.
- The selected foreground color is already used to build the regular dither palette.
- The geometric dither mask is mostly independent of hue, so different colors can still produce the same visible pattern structure.
- CC Gradient has more visible variety because its dither path receives `ditherPatternDiversity`, `flatSeed`, gradient/sample stops, and spread data, then uses those inputs to vary mix and pattern behavior.

## Design

Use `ditherPatternDiversity` as the shared `Variety` control for regular `Dither Shape`.

Expected semantics:

- `0`: stable neutral near-checker with sparse classic Sierra vertical stacks.
- `100`: stronger color/tone/pattern variation, closer to current CC Gradient variety.
- Same color + same shape seed remains deterministic.
- Different selected colors at high variety can produce visibly different dither texture/mix.
- Preview and final commit match.

Keep `ditherPaletteSpread` as the color-distance/spread control.

## Implementation Steps

1. Trace the regular dither preview and finalize path.
   - Confirm shape preview and final commit both route through `applyStrokeDither`.
   - Confirm the path carries foreground color, `ditherPaletteSpread`, `ditherPatternDiversity`, algorithm, pattern style, fill resolution, and stable shape geometry.

2. Add a small regular-dither variety helper.
   - Suggested location: `src/hooks/brushEngine/` or `src/utils/ditherAlgorithms.ts`.
   - Inputs:
     - foreground color
     - resolved dither palette
     - `ditherPaletteSpread`
     - `ditherPatternDiversity`
     - algorithm / pattern style
     - stable seed derived from shape points or bounds
   - Outputs:
     - deterministic phase offset and/or threshold bias
     - tone/mix adjustment suitable for regular dither algorithms

3. Wire the helper into `strokeDitherRegion`.
   - Apply only to regular dither brush paths.
   - Do not alter CC Gradient, color-cycle stamp dither, rectangle gradient, polygon gradient, or shape-fill behavior.
   - Pass the resolved variety data into `applyDithering(...)` / `applyDitheringWithFillResolution(...)`.

4. Make preview and finalize use the same seed.
   - Prefer a stable shape seed from points/bounds.
   - Avoid per-frame random values so dragging does not flicker.
   - Ensure the committed output matches the preview output.

5. Add focused tests.
   - Same color + same seed produces deterministic output.
   - Different selected colors at high `ditherPatternDiversity` produce different output.
   - `ditherPatternDiversity: 0` reduces/neutralizes the variation.
   - Shape finalize forwards the relevant variety settings through `settingsOverride`.
   - Existing CC Gradient dither tests remain unchanged.

6. Validate manually.
   - Draw `Dither Shape` fills with several foreground colors.
   - Compare low and high `Variety`.
   - Confirm no preview flicker during drag.
   - Confirm CC Gradient behavior is unchanged.

## Definition of Done

- `Dither Shape` has visible, deterministic variety controlled by `ditherPatternDiversity`.
- Selected color affects the dither texture/mix, not just the final ink palette.
- Preview and finalize match.
- Targeted tests cover deterministic variety behavior.
- CC Gradient dither tests still pass.
