# CC Gradient Dither Parity

Date: 2026-03-26
Status: Active

## Problem

Color-cycle gradient shape fills diverged between preview and finalized output.

Observed failures:
- Preview looked correct, finalized output could degrade into noisy or flat dithering.
- Multi-color finalized fills could look like random noise.
- After the noise fix, finalized fills could collapse into flat dithering because explicit quantized levels were ignored.
- Recoloring def-bound CC shapes could lose the dithered runtime palette.
- Long-lived projects could keep finalizing into noise even after the codepath was fixed, because persisted def-slot state remained stale.
- `sierra-lite` could reintroduce visible banding even when other dither algorithms stayed smooth.

## Root Causes

1. Render-stop generation for ordered multi-stop dither palettes was wrong.
   - The non-triad ordered branch in `ccDitherRenderPalette` sampled `segmentStart -> segmentEnd`.
   - That collapsed intended pair centers and produced the wrong finalized palette layout.

2. Pointer-up preview pixels were being blitted into the real layer before finalize.
   - This polluted committed output with preview cache pixels.

3. Shape preview and finalize were using different dither contracts.
   - Preview used quantized levels.
   - Finalize used the pair-band path.
   - That mismatch caused preview/finalize disagreement.

4. The brush engine ignored explicit `ditherLevels` unless `ditherPairBandCount > 0`.
   - This forced finalized fills into `levels = 1` flat mode even when the caller supplied real quantization levels.

5. Def-bound gradient recolors were updating slot palettes without rebuilding the matching def runtime stops.
   - Existing def-bound CC content could lose its dithered runtime palette after color edits.

6. Persisted def-slot bindings could survive a broken build with a stale slot palette attached to an otherwise correct gradient def hash.
   - Preview used the live mark session and looked correct.
   - Finalize reused the persisted def binding and rendered with the stale slot palette, so long-lived projects/origins stayed noisy while a clean origin behaved normally.

7. The CC `sierra-lite` multi-level diffusion branch was not conserving error correctly.
   - The branch used the adjusted fractional value to choose the next level.
   - But it diffused the outgoing error from the pre-adjustment fraction instead of the adjusted value.
   - That collapsed smooth ramps into repeating row bands that did not appear with the other error-diffusion algorithms.

## Fixes

- `src/utils/colorCycle/ccDitherRenderPalette.ts`
  - Ordered multi-stop non-triad render stops now sample `segmentStart -> center` and emit center-aligned stops.

- `src/hooks/canvas/handlers/pointerHandlers.ts`
  - Removed the pointer-up CC preview cache blit into the committed layer.

- `src/hooks/canvas/handlers/colorCycle/colorCycleShapeFill.ts`
  - Shape finalize now passes preview-parity quantized dither options to the brush engine.

- `src/hooks/brushEngine/ColorCycleBrushCanvas2D.ts`
  - Explicit `ditherLevels` now override the fallback flat-mode branch even when `ditherPairBandCount` is zero.

- `src/hooks/brushEngine/ccGradientController.ts`
  - Recolor edits for def-bound CC slots rebuild dither runtime stops and update matching def-store hashes.

- `src/utils/colorCycleGradientDefs.ts`
  - Reusing an existing gradient def hash now heals the bound slot palette if the stored palette is stale, instead of leaving corrupted persisted runtime state in place.

- `src/utils/colorCycle/ccGradientDither.ts`
  - The `sierra-lite` multi-level branch now diffuses error from the adjusted fractional value, which restores smooth ramps instead of repeating row bands.

- `src/components/panels/AnimationControlsPanel.tsx`
  - Play/Pause now uses `toggleGlobalColorCyclePlayback()` so the button updates store state and kicks the registered CC runtime handlers.

## Regression Coverage

- `src/utils/colorCycle/__tests__/ccDitherRenderPalette.test.ts`
  - Center-aligned ordered render-stop coverage.

- `src/utils/colorCycle/__tests__/ccGradientDither.test.ts`
  - Quantized levels, pair-band behavior, and flat-mode guards.

- `src/hooks/canvas/handlers/__tests__/pointerHandlers.main.test.ts`
  - Prevents preview-cache commit on pointer-up.

- `src/hooks/canvas/handlers/colorCycle/__tests__/colorCycleShapeFill.transparencyLock.test.ts`
  - Locks shape-finalize dither options to preview-parity quantized levels.
  - Verifies linear shape finalize repairs stale def-bound slot palettes before rendering.

- `src/hooks/brushEngine/__tests__/ColorCycleBrushCanvas2D.test.ts`
  - Verifies explicit `ditherLevels` reach `fillCcGradientDither()` without pair-band mode.

- `src/utils/__tests__/colorCycleGradientDefs.test.ts`
  - Verifies def reuse heals stale slot palettes for long-lived persisted CC state.

- `src/utils/colorCycle/__tests__/ccGradientDither.test.ts`
  - Verifies `sierra-lite` multi-level fills do not collapse into a repeating-row band pattern.

- `src/hooks/brushEngine/__tests__/ccGradientController.test.ts`
  - Verifies recolor edits rebuild def-bound runtime dither stops.

- `src/components/panels/__tests__/AnimationControlsPanel.test.tsx`
  - Verifies the Play/Pause button routes through the global runtime-aware playback toggle.
