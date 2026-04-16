# Plan: CC Hue/Saturation Regression

## Problem

Hue and saturation controls no longer affect color-cycle layers.

The current evidence points to a regression in the active color-cycle brush path rather than the UI:

- `BrushSettingsPanel` still updates `brushSettings.hueShift` and `brushSettings.saturationAdjust`.
- The active color-cycle draw path no longer threads those fields through its narrowed `brushSettings` type.
- The current color-cycle gradient resolution uses the dedicated foreground-derived controls (`colorCycleFgHueShift` / `colorCycleFgSaturationShift`) instead.
- The old engine path did apply the general hue/saturation settings to brush stamping.

## Likely Root Cause

During the brush-engine/color-cycle refactor, the general brush color-adjust controls were dropped from the active color-cycle path. The sliders still update store state, but the runtime that renders or stamps color-cycle content no longer consumes those values.

## Plan

1. Confirm intended behavior.
   Determine whether the general hue/saturation sliders are supposed to affect color-cycle custom-brush stamping, or whether they should be excluded from color-cycle workflows.

2. Restore the missing settings flow.
   Re-thread `hueShift`, `lightnessAdjust`, and `saturationAdjust` into the active color-cycle runtime so the current engine can consume them.

3. Apply the adjustment at the correct stage.
   For custom-brush color-cycle strokes, apply the color transform to the source stamp before it is committed into color-cycle buffers. Do not try to patch it only at playback/compositing time.

4. Preserve foreground-derived gradient behavior.
   Define how the general hue/saturation sliders interact with `colorCycleFgHueShift` and `colorCycleFgSaturationShift` so color shifts are not accidentally applied twice.

5. Add regression coverage.
   Add tests for:
   - custom brush + color-cycle layer + hue shift changes output
   - custom brush + color-cycle layer + saturation change affects output
   - non-color-cycle custom brush behavior remains unchanged
   - foreground-derived color-cycle mode does not double-apply hue/saturation

6. Verify end to end.
   Run:
   - `npm run type-check`
   - `npm run lint`
   - targeted tests for the color-cycle/custom-brush path
   - manual sanity check on a real color-cycle layer in dev

## Relevant Files

- `src/components/panels/BrushSettingsPanel.tsx`
- `src/hooks/brushEngine/colorCycleDrawController.ts`
- `src/hooks/canvas/utils/colorCycleHelpers.ts`
- `src/hooks/useBrushEngine.ts.backup`

