# Rendering Pipeline Differences: Preview vs Final

## 🚨 CRITICAL DIFFERENCE FOUND

After analyzing both rendering pipelines, I found a **fundamental difference** in how hue/saturation parameters are handled between preview and final rendering.

## The Issue

### Preview Rendering (MiniCanvas.tsx:441-442)
```typescript
// Apply same 0.1 precision rounding as cache system for consistency
const roundedHueShift = Math.round(hueShift * 10) / 10;
const roundedSaturation = Math.round(saturation * 10) / 10;
```

### Final Rendering (scaledBrushCache.ts:140-141)  
```typescript
// Apply hue/saturation transformations first if specified
let processedImageData = customBrush.imageData;
const finalHueShift = hueShift || 0;        // ❌ NO ROUNDING!
const finalSaturation = saturation || 100;  // ❌ NO ROUNDING!
```

## Root Cause Analysis

**The preview applies 0.1 precision rounding to hue/saturation values, but the final rendering does NOT.**

This means:
- **Preview**: `hueShift: 15.37` → `15.4` (rounded)
- **Final**: `hueShift: 15.37` → `15.37` (exact)

This small precision difference can result in slightly different HSL calculations, leading to different RGB output values.

## Pipeline Comparison

| Aspect | Preview (MiniCanvas) | Final (scaledBrushCache) |
|--------|---------------------|-------------------------|
| **Hue/Saturation Input** | ✅ Rounded to 0.1 precision | ❌ Uses exact floating point values |
| **Color Transform** | ✅ `adjustHueAndSaturation()` | ✅ `adjustHueAndSaturation()` |
| **Canvas Creation** | ✅ Temporary canvas | ✅ Cached canvas |
| **Image Data Application** | ✅ `putImageData()` | ✅ `putImageData()` |
| **Final Drawing** | ✅ `drawImage()` | ✅ `drawImage()` |
| **Context Options** | ✅ `willReadFrequently: true` | ✅ `willReadFrequently: true` |

## Why This Matters

Even tiny precision differences in hue values can cause different HSL→RGB conversions:

```javascript
// Example with red (255, 0, 0)
hslToRgb(15.4, 100, 50)  // Preview result
hslToRgb(15.37, 100, 50) // Final result
// Could produce slightly different RGB values
```

## The Fix

**Standardize both to use the same precision rounding:**

Either:
1. **Remove rounding from preview** (use exact values in both)
2. **Add rounding to final rendering** (apply 0.1 precision in both)

Option 2 is better since the cache system was designed with 0.1 precision in mind.

## Additional Differences Found

### Canvas Context Creation
Both use identical context options: `{ willReadFrequently: true }`

### Rendering Method  
Both use the same Canvas 2D pipeline:
1. `adjustHueAndSaturation()` on ImageData
2. `putImageData()` to canvas
3. `drawImage()` to final destination

### Memory Management
- **Preview**: Creates temporary canvases (garbage collected)
- **Final**: Uses canvas pooling (reused for performance)

## Recommendation

**Apply the same 0.1 precision rounding in scaledBrushCache.ts that's used in MiniCanvas.tsx.**

This will ensure both systems use identical hue/saturation values for color transformations.