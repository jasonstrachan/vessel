# TODO List

## Current Task
- [x] Fix flood fill color picker UI - show only main color picker

## Completed
- [x] Fixed flood fill color picker UI - show only main color picker
- [x] Removed duplicate color picker components from FillControls
- [x] Simplified FillControls to show only fill-specific settings
- [x] Enhanced BrushCursor visibility during shape drawing mode
- [x] Fixed shape mode hue shift consistency issue
- [x] Fixed saveCustomBrushAsPreset to "bake" hue shift and saturation adjustments into saved brush ImageData

## Review

### Fix Summary
Fixed the flood fill UI to show only one color picker (the main one) instead of multiple confusing duplicate color pickers.

### Problem
When flood fill tool was selected, users saw **4 separate color picker interfaces**:
- Main ColorPickerPanel (always visible in right panel)
- AdvancedColorPicker in FillControls (duplicate)
- ColorSwatches in FillControls (duplicate)  
- Small ColorPicker with hex input in FillControls (duplicate)

### Changes Made
**Simplified FillControls component** (`/src/components/toolbar/FillControls.tsx`):
- Removed duplicate AdvancedColorPicker component
- Removed duplicate ColorSwatches component
- Removed duplicate small ColorPicker with hex input
- Kept only fill-specific controls: Threshold slider and Connected Pixels toggle
- Removed unused imports (ColorPicker, AdvancedColorPicker, ColorSwatches, Input)
- Simplified component structure with single container div

### Technical Details
- **Main color picker remains available**: The ColorPickerPanel in the right sidebar is always visible and serves as the single color selection interface
- **Clean separation of concerns**: FillControls now only handles fill-specific settings, not color selection
- **Consistent user experience**: Users have one clear place to select colors regardless of tool
- **Reduced code complexity**: Eliminated duplicate code and unnecessary imports

### Testing
- Build completes successfully with no compilation errors
- All existing functionality preserved
- Flood fill tool should now show only the main color picker interface
- Fill-specific controls (threshold and contiguous) remain fully functional