# TODO List

## Current Task
- [x] Fix custom brush saving to preserve hue shift and saturation adjustments

## Completed
- [x] Fixed saveCustomBrushAsPreset to "bake" hue shift and saturation adjustments into saved brush ImageData
- [x] Added import for adjustHueAndSaturation function in useAppStore.ts
- [x] Reset hue shift and saturation to defaults after saving since transformations are now permanent

## Review

### Fix Summary
The issue was that when saving a temporary custom brush, only the original ImageData was saved, not the hue-shifted/saturation-adjusted version that was being displayed. 

### Changes Made
1. **Modified `saveCustomBrushAsPreset` in `src/stores/useAppStore.ts`**:
   - Added logic to check if current brush has hue shift (≠ 0) or saturation adjustments (≠ 100)
   - If transformations are active, applies `adjustHueAndSaturation()` to the brush's ImageData before saving
   - Creates a `transformedBrush` with the modified ImageData
   - Resets `hueShift` to 0 and `saturationAdjust` to 100 after saving since changes are now baked in

2. **Added proper ES6 import**:
   - Imported `adjustHueAndSaturation` from `../utils/imageProcessing` to avoid linting errors

### Technical Details
- The fix "bakes" temporary visual transformations into the permanent brush data
- This ensures saved custom brushes look exactly like what the user sees during editing
- After saving, the hue/saturation sliders reset to neutral since the brush now contains the transformed colors
- The transformation is applied using the same `adjustHueAndSaturation` function used for real-time display

### Testing
- Build completes successfully with no errors
- All existing functionality preserved
- Custom brushes should now save with their visual appearance intact