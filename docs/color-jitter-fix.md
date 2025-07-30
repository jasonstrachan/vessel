# Custom Brush Color Jitter Fix

## Problem
Custom brushes were not applying color jitter when "Use Swatch Color" was turned off. The issue was in the `drawCustomBrushStamp` function's catch block fallback logic.

## Root Causes
1. **Missing Dependency**: The `useCallback` hook was missing `tools` in its dependency array, causing stale closure values
2. **Broken Fallback Logic**: The catch block only applied modifications when `isColorizable && color` was true, ignoring jitter for non-colorizable brushes

## Solution
### 1. Fixed useCallback Dependencies
```typescript
}, [tools]); // Added tools dependency
```

### 2. Fixed Catch Block Logic
Separated jitter application from color tinting:
```typescript
// Apply hue/saturation jitter ALWAYS (not just when colorizable)
if (jitteredHueShift !== 0 || jitteredSaturationAdjust !== 100) {
  processedImageData = adjustHueAndSaturation(processedImageData, jitteredHueShift, jitteredSaturationAdjust);
}

// Apply color tint SEPARATELY if needed
if (isColorizable && color) {
  // Color tinting logic
}
```

## Result
✅ Custom brushes now support full color jitter functionality regardless of "Use Swatch Color" setting
✅ Per-stamp jitter randomization works correctly  
✅ Maintains performance through intelligent caching
✅ Consistent behavior across all brush types

## Files Modified
- `src/hooks/useBrushEngine.ts`: Fixed dependency array and catch block logic
- Added import for `adjustHueAndSaturation` from `../utils/imageProcessing`