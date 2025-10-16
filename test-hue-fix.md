# Custom Brush Editor Fixes

## Issue 1: Hue Adjustment Double Application
**Problem:** The hue adjustment was being applied twice when saving a custom brush.
**Solution:** Removed duplicate adjustment from `saveBrushEdit` - the canvas already has adjusted pixels from preview.

## Issue 2: Brush Stamping on Canvas During Edit
**Problem:** When editing a custom brush for the second time, it would stamp the brush onto the main canvas.
**Root Cause:** `startBrushEdit` was incorrectly drawing the brush onto the main canvas with `putImageData`.
**Solution:** 
- Removed the `putImageData` call from `startBrushEdit`
- Changed to create empty ImageData instead of capturing canvas state
- Removed canvas restoration from `cancelBrushEdit`
- The brush editor now works entirely in its own modal canvas

## Test Steps
1. Open the app at http://localhost:3001
2. Create or edit a custom brush
3. Test hue/saturation adjustments save correctly
4. Edit the same brush multiple times - verify no stamping on canvas
5. Cancel edits - verify canvas remains unchanged

## Files Modified
- `/src/stores/useAppStore.ts`:
  - Removed duplicate HSL adjustment in `saveBrushEdit`
  - Fixed `startBrushEdit` to not stamp brush on canvas
  - Fixed `cancelBrushEdit` to not modify main canvas