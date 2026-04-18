# 2026-04-18 CC Shape Preview/Finalize Parity

## Context

Investigated the case where CC shape preview dithering does not match the finalized fill, especially around flat `sierra-lite` behavior.

## What We Found

At the time of investigation, preview and finalize were using different `preserveSourceStops` contracts:

- Preview in `src/hooks/canvas/handlers/shapes/ShapeToolHandler.ts`
  - `preserveSourceStops === true` only for `sampled`
  - flat `sierra-lite` check:
    - `pairBandCount <= 0`
    - algorithm `sierra-lite`

- Finalize in `src/hooks/canvas/handlers/colorCycle/colorCycleShapeFill.ts`
  - `preserveSourceStops === true` for non-`sampled`
  - same flat `sierra-lite` branch conditions

This looked like the most likely preview/final stop-contract mismatch.

## Attempted Fixes

### 1. Sampled-path parity experiment

Commit:
- `bf9a90a51` `fix: align preview sampled flat sierra solver`

Change:
- Removed the preview-only disable of `preferSampledFlatSolver` in `src/utils/colorCycle/ccGradientDither.ts`
- Added regression coverage in `src/utils/colorCycle/__tests__/ccGradientDither.test.ts`

Result:
- Technically valid and tested
- But it changed sampled behavior, which was broader than the intended manual/FG parity fix

Follow-up:
- Reverted in `f4b3e9491`

### 2. Manual/FG preview stop-preservation parity experiment

Commit:
- `c807ab76d` `fix: preserve flat cc preview stops for manual gradients`

Change:
- Made preview preserve source stops for `manual` and `fg`
- Kept `sampled` on the old path
- Added source-specific unit tests in `ShapeToolHandler.test.ts`

Result:
- User reported preview and finalized output were further apart than before
- This indicates that simply matching preview to finalize's current `preserveSourceStops` rule was the wrong product behavior, or the visible mismatch is not caused primarily by this flag

Follow-up:
- Reverted in `1d18eabbd`

## Current Conclusion

Do not make another blind parity patch.

The next step should be direct diagnosis from the actual stop sets used by preview vs finalize for the failing case:

- flat `sierra-lite`
- `gradientBands = 1`
- `manual` source
- `fg` source
- test separately from `sampled`

## Recommended Next Diagnostic Step

Capture and compare these exact values for the same shape/session:

### Preview side

- `effectiveStops`
- preview `renderStops` from `prepareCcShapePreviewGradient(...)`
- preview source (`manual` / `fg` / `sampled`)

### Finalize side

- `session.frozenStopsStored`
- finalize `renderPalette.renderStops`
- finalize source

### Goal

Determine which of these is actually diverging:

- source stop selection
- runtime palette expansion
- preview ROI/scaled rendering path
- finalize brush/runtime render path

## Important Guardrail

Keep `sampled` isolated until intentionally changing sampled product behavior.

The failed experiments above show that sampled-path fixes and manual/FG parity fixes should not be mixed in the same patch.

## Recommended Direction

The working assumption after the failed preview-side patch is:

- `manual` and `fg` finalized output should likely move toward the current preview behavior
- `sampled` stays unchanged for now

Reasoning:

- Making preview preserve manual/FG source stops made preview/final divergence worse
- That suggests the current preview look is probably closer to intended behavior than finalize for this path
- So the next likely fix belongs on the finalize side, but only after confirming the actual preview vs finalize stop sets

### Practical next move

Add temporary diagnostics for one failing case and compare:

#### Preview

- `effectiveStops`
- preview `renderStops`
- `previewSource`

#### Finalize

- `session.frozenStopsStored`
- finalize `renderPalette.renderStops`
- `session.source`

### Scope for that diagnosis

Only inspect:

- `gradientBands = 1`
- `sierra-lite`
- `manual`
- `fg`

Do not include `sampled` in that patch.

### Decision rule

- If preview/finalize stop sets differ:
  - fix finalize to use the preview-equivalent stop contract for `manual` / `fg`
- If preview/finalize stop sets already match:
  - the bug is downstream of stop prep
  - likely candidates:
    - preview ROI scale/upscale path
    - finalize brush fill path
    - post-fill commit/render binding
