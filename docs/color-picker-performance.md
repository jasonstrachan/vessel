# Color Picker Performance Notes

## Background

The color picker uses a saturation/value (SV) canvas and a hue strip. During drag,
it previously updated the global palette on every pointer move and rebuilt the
SV canvas with per-pixel loops. This caused noticeable lag.

## Fixes Applied

- **SV canvas rendering**: switched to per-grid-cell fills (14×14) instead of
  per-pixel iteration. This reduces work from ~45k pixels to 196 rects per hue update.
- **Drag throttling**: pointer-move updates are now throttled to once per animation
  frame, and flushed on pointer up.
- **Palette updates**: the color picker panel now batches palette updates during drag
  (rAF throttle or debounce when dithering is active), and commits on pointer up.

## Where to look

- `src/components/ui/ColorPicker.tsx`
  - SV rendering logic and rAF throttling.
- `src/components/panels/ColorPickerPanel.tsx`
  - Throttled palette updates during drag and commit handling.

## Notes

If lag returns, add dev-only profiling around:

- `applyHsvUpdate` in `ColorPicker`
- `setActiveColor`/`applyPaletteSnapshot` in the palette store

