# CC Non-Dither Stroke Authoring Baseline

## Scope

Burn down only the non-dither color-cycle stroke authoring path.

Do not change:

- dither stroke authoring or `applyStampDitherStamp`
- shape fill paths
- gradient definition or slot binding storage
- playback, compositor, animator rendering, or export playback
- custom stamp authoring unless it shares this exact broken progression path

Primary implementation file:

- `src/hooks/brushEngine/ColorCycleBrushCanvas2D.ts`

Secondary diagnostic entry path, if needed:

- `src/hooks/brushEngine/colorCycleDrawController.ts`

## Baseline Rule

Non-dither stroke authoring must be deterministic and integer-only:

- stroke begin resets authored local state
- zero-distance stamps do not advance phase
- each visible authored stamp advances phase by exactly one integer step
- each stamp paints one integer color-cycle palette index
- non-dither stroke color choice does not use the `gradientBands` band mapper

Canonical rule:

```ts
if (dist > 0) {
  strokeData.strokePhaseUnits = (strokeData.strokePhaseUnits + 1) % 255;
}
const colorIndex = 1 + strokeData.strokePhaseUnits;
```

## Diagnostics To Keep Temporarily

- `[cc-stroke-begin]`
- `[cc-stroke-end]`
- `[cc-nodither-decision]`
- `[cc-nodither-zero-dist]`
- `[cc-zero-dist-phase-check]`
- `[cc-nodither-postpaint]`

Use diagnostics only to verify the baseline. Do not layer new behavior while they are in place.

## Acceptance Criteria

- New non-dither stroke starts at `stampCounter: 0`, `phase: 0`, `lastPoint: null`.
- First non-dither stamp paints index `1`.
- A duplicate quantized stamp does not advance phase.
- A visible authored stamp advances exactly one integer palette index.
- Expected index equals the actual paint buffer index at the stamp center.
- No float index is written into the paint path.
- No non-dither cross-stroke authored phase carry.

## Rebuild Order After Baseline

Only after the baseline is stable:

1. Optional distance progression, integerized by accumulating distance and converting to whole steps.
2. Optional velocity coupling only when the velocity toggle is enabled.

Do not combine both rebuilds in one change.
