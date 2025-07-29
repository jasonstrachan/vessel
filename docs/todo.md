# TODO List

## Current Task
- [x] Fix shape mode hue shift consistency issue

## Completed
- [x] Fixed shape mode hue shift consistency issue
- [x] Enhanced BrushCursor visibility during shape drawing mode
- [x] Fixed saveCustomBrushAsPreset to "bake" hue shift and saturation adjustments into saved brush ImageData
- [x] Added import for adjustHueAndSaturation function in useAppStore.ts
- [x] Reset hue shift and saturation to defaults after saving since transformations are now permanent

## Review

### Fix Summary
Fixed two critical issues with shape mode:

1. **Shape Mode Hue Shift Consistency**: Shape fills now correctly apply hue shift and saturation adjustments, matching the appearance of normal brush strokes
2. **Brush Cursor Visibility**: Enhanced brush outline visibility during shape drawing mode

### Changes Made

#### Shape Mode Hue Shift Fix (`src/utils/shapeUtils.ts`)
1. **Added hue/saturation parameters** to `renderShape()` and `renderShapePreview()` functions
2. **Imported `adjustHueAndSaturation`** from image processing utilities  
3. **Applied transformations** to custom brush ImageData before creating patterns
4. **Updated both shape rendering calls** in `DrawingCanvas.tsx` to pass hue/saturation values

#### Enhanced BrushCursor Visibility (`src/components/canvas/BrushCursor.tsx`)
1. **Increased z-index** from 100 to 1000 to ensure cursor is always on top
2. **Enhanced visibility** with white stroke (`#ffffff`) and thicker 2px width
3. **Updated cursor visibility logic** to properly handle shape mode

### Technical Details
- **Root Cause**: Shape mode bypassed the `scaledBrushCache` system that applies hue transformations, using raw brush ImageData directly
- **Solution**: Modified `renderShape()` to apply the same `adjustHueAndSaturation()` transformation used by normal brush strokes
- **Consistency**: Both normal painting and shape fills now use identical transformation pipeline
- **Performance**: Transformations only applied when hue shift ≠ 0 or saturation ≠ 100

### Testing
- Build completes successfully with no compilation errors
- All existing functionality preserved  
- Shape fills should now match normal brush appearance with hue shift applied
- Brush outline clearly visible during shape drawing mode