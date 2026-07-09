# CC Gradient Spread Controls Plan

## Goal

Split the current overloaded spread behavior into two mode-specific controls so low values feel subtle in both modes without pretending the render paths are the same.

The current `Dither Palette Spread` slider is doing too much:

- With dithering on and `Colors = 1`, the user is really controlling the contrast between two animated inks.
- With dithering off, there is no two-ink pair; the user wants to control how much contrast/range from the sampled gradient is preserved.

These need separate product contracts and separate implementation paths.

## Product Decision

Use one control position in the CC Gradient UI, but make the label and behavior mode-specific.

- Dithering on: `Ink Spread`
- Dithering off: `Range Contrast`

Do not show both controls at the same time in the first pass.

## Control Contracts

### Dithering on: Ink Spread

Applies when `brushSettings.ditherEnabled === true`.

Purpose:

- Control the distance/contrast between the two output inks used by flat dither mode.

Expected behavior:

- `0`: two very similar inks; minimal dot contrast.
- `100`: far-apart inks; high dot contrast and strong animated color separation.

Primary target case:

- CC Gradient
- sampled source
- dithering on
- `Colors = 1`
- selected pattern writes two animated inks

This is not a sampled range control. It should not reduce source sampling fidelity.

### Dithering off: Range Contrast

Applies when `brushSettings.ditherEnabled !== true`.

Purpose:

- Control how much of the sampled gradient's full color range is used when rendering a non-dithered CC gradient.

Expected behavior:

- `0`: sampled stops compress toward a representative/center sampled color; the whole gradient has very little contrast.
- `100`: sampled stops preserve the full sampled range.

Primary target case:

- CC Gradient
- sampled source
- dithering off
- shape or stroke produces a continuous/non-dithered sampled gradient

This is not an ink-pair control. It should not call into flat two-ink pair selection.

## Current Code Seams

### Dithered flat two-ink path

Likely implementation seams:

- `src/utils/colorCycle/ccFlatModePatterns.ts`
  - `resolveFlatPairHalfSpread(...)`
  - `resolveFlatInkSetForBand(...)`
  - `resolveFlatInkSetForPosition(...)`
- `src/utils/colorCycle/ccGradientDither.ts`
  - `resolveSampledFlatPositionMix(...)`
  - `buildFlatTargetContrastPair(...)`
  - `resolveCcSampledFlatPatternPayload(...)`
- `src/utils/colorCycle/ccDitherRenderPalette.ts`
  - `buildCcFlatSierraContrastRenderPalette(...)`

Observed issue to fix:

- The low end is not low enough. The current minimum flat pair span is still visibly separated, and sampled fallback contrast starts too strong.

### Non-dither sampled range path

Likely implementation seams:

- `src/hooks/canvas/utils/colorCycleMarkSession.ts`
  - `resolveMarkSessionRuntimeStops(...)`
- `src/hooks/brushEngine/ccGradientRuntime.ts`
  - sampled session runtime palette creation
- `src/hooks/canvas/handlers/shapes/ShapeToolHandlerRuntime.ts`
  - `prepareCcShapePreviewGradient(...)`
- `src/hooks/brushEngine/colorCycleShapeFillLinearRuntime.ts`
  - continuous/non-dither fill authoring path
- `src/hooks/brushEngine/colorCycleFillController.ts`
  - dither-off fill option dispatch

Observed issue to fix:

- With dithering off, spread does not currently behave like sampled range contrast. Low values do not necessarily reduce the overall contrast across sampled stops.

## Implementation Plan

### Phase 1 - Confirm active behavior

- Reproduce both paths in the running app before changing code:
  - Dither on, `Colors = 1`, sampled source, low/high current spread.
  - Dither off, sampled source, low/high current spread.
- Add lightweight debug logging or in-app-visible instrumentation only if the path is ambiguous.
- Record which functions are hit for preview and finalize in both paths.

Definition of done:

- We can point to the exact preview and finalize path for each mode.

### Phase 2 - UI contract split

- In `src/components/toolbar/BrushControls.tsx`, keep the control in the existing spread location.
- Render the label as:
  - `Ink Spread` when dither is enabled.
  - `Range Contrast` when dither is off.
- Decide whether this reuses the existing `ditherPaletteSpread` setting internally for the first pass or introduces a new persisted setting such as `ccGradientRangeContrast`.

Recommendation:

- Use two persisted settings if implementation stays clean:
  - `ditherPaletteSpread` for dithered ink spread.
  - `ccGradientRangeContrast` for non-dither sampled range.
- If a narrower first slice is needed, reuse the numeric value temporarily but keep the code paths and labels separate.

Definition of done:

- The UI no longer implies one slider is doing the same thing in both modes.

### Phase 3 - Dithered Ink Spread fix

- Lower the minimum pair distance in flat mode.
- Replace the current linear-ish low-end mapping with an eased curve:
  - low slider values should remain close for longer,
  - upper slider values should widen more aggressively.
- Reduce sampled fallback contrast at low spread in `buildFlatTargetContrastPair(...)`.
- Keep source sampling full fidelity when `Colors = 1`.
- Do not add noise, jitter, or renderer-side contrast tricks.

Definition of done:

- `Ink Spread = 0` writes two close animated inks with low visible dot contrast.
- `Ink Spread = 100` writes widely separated inks.
- The selected pattern still controls spatial distribution only.

### Phase 4 - Non-dither Range Contrast fix

- Add a non-dither sampled stop transform that compresses sampled stops toward a representative sampled color.
- Apply it only when:
  - CC Gradient source is sampled,
  - dithering is off,
  - the path is rendering/authoring a sampled gradient.
- Keep this out of flat dither pair selection.
- Use the same transform for preview and finalize within the non-dither path.

Suggested transform:

```text
representative = center/average sampled color
amount = rangeContrast / 100
outputStop = mix(representative, originalStop, eased(amount))
```

Definition of done:

- `Range Contrast = 0` produces a very low-contrast sampled gradient.
- `Range Contrast = 100` preserves the full sampled range.
- Manual/foreground gradients are unchanged unless explicitly included later.

### Phase 5 - Tests

Add separate test coverage for the two contracts.

Dithered tests:

- `resolveFlatInkSetForBand(..., spread=0)` returns a close pair.
- `resolveFlatInkSetForBand(..., spread=100)` returns a wide pair.
- sampled flat fallback contrast is lower at `spread=0` than at `spread=100`.
- `Colors = 1` still routes through two-ink flat pattern output.

Non-dither tests:

- sampled stops compress toward the representative color at `Range Contrast = 0`.
- sampled stops are preserved at `Range Contrast = 100`.
- preview and finalize use equivalent transformed stops.
- dither-on paths do not call the non-dither range transform.

UI tests:

- Dithering on shows `Ink Spread`.
- Dithering off shows `Range Contrast`.
- The hidden mode's control label is not present.

### Phase 6 - Verification

Run focused tests first:

- `npm test -- --runInBand src/utils/colorCycle/__tests__/ccGradientDither.test.ts`
- `npm test -- --runInBand src/utils/colorCycle/__tests__/ccDitherRenderPalette.test.ts`
- related `BrushControls` tests for the label split

Then run broader checks if code paths touched are shared:

- `npm run type-check`
- `npm run lint`
- `npm test`

Manual verification:

- Dither on, sampled source, `Colors = 1`, low/high `Ink Spread`.
- Dither off, sampled source, low/high `Range Contrast`.
- Confirm preview and finalized mark match closely enough to trust the control.

## Non-goals

- Do not rewrite sampled session lifecycle.
- Do not collapse sampled source capture when `Colors = 1`.
- Do not add jitter/noise to fake contrast changes.
- Do not change Goblet/export behavior unless verification proves the authored data contract requires it.
- Do not make manual/foreground gradients use Range Contrast in the first pass unless product scope expands.

## Open Questions

- Should `Range Contrast` be persisted as a new setting, or should it initially reuse the current spread value with a mode-specific label?
- Should `Range Contrast` apply to all dither-off CC gradients, or only sampled-source gradients?
- What should the default `Range Contrast` be for existing users: `100` to preserve current behavior, or the existing spread value?

Recommendation:

- Persist `Range Contrast` separately and default it to `100` for backward visual compatibility.
