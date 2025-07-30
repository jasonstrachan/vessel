# Floating-Point Precision Test Plan

## Enhanced Logging Added

I've added comprehensive logging to track pixel-level transformations through the entire pipeline:

### 1. **Core Transform Function (`adjustHueAndSaturation`)**
- Logs input parameters with 6-decimal precision
- Tracks sample pixel RGB before/after transformation  
- Logs HSL values before/after with precision analysis
- Detects boundary conditions (hue near 0°/360°, saturation extremes)
- Logs hue wrapping operations
- Tracks saturation clamping

### 2. **Preview System (`MiniCanvas`)**
- Logs final pixel data just before drawing
- Shows first pixel RGBA values
- Includes applied transform values

### 3. **Final Rendering (`scaledBrushCache`)**
- Logs final pixel data just before canvas drawing
- Shows first pixel RGBA values  
- Includes cache key for debugging
- Shows applied transform values

## Test Cases to Run

### **Boundary Condition Tests**

1. **Hue Near 0°/360° Boundary**
   - Use a red custom brush (hue ≈ 0°)
   - Apply small positive hue shifts (+1°, +5°, +10°)
   - Apply small negative hue shifts (-1°, -5°, -10°)
   - Watch for wrapping issues in logs

2. **Hue Wrapping Tests**
   - Apply +350° shift (should wrap to -10°)
   - Apply -350° shift (should wrap to +10°)
   - Apply +370° shift (should wrap to +10°)

3. **Saturation Boundary Tests**
   - Use a grayscale brush (saturation ≈ 0%)
   - Apply saturation increases (50%, 100%, 200%)
   - Use a highly saturated brush
   - Apply saturation decreases to near 0%

### **Cumulative Error Tests**

4. **Multiple Transform Applications**
   - Apply +30° hue shift, then another +30°
   - Compare to single +60° shift
   - Look for accumulation differences

5. **Precision Edge Cases**
   - Use hue shift values like 15.333333°
   - Use saturation values like 66.666667%
   - Check if rounding introduces errors

## What to Look For in Logs

### **Inconsistency Patterns**
- Different RGB values for same HSL inputs between preview/cache
- Boundary warnings appearing only in one system
- Different floating-point precision in final results

### **Accumulation Signs**
- HSL delta values not matching expected transform amounts
- RGB differences larger than ±1 (accounting for rounding)
- Boundary warnings accumulating over multiple transforms

### **Precision Issues**
- Hue wrapping occurring at unexpected values
- Saturation clamping when input is within 0-100% range
- Minor RGB differences (±1-2) that indicate floating-point drift

## How to Test

1. **Load a custom brush** with known colors
2. **Set specific hue/saturation values** targeting boundary conditions
3. **Compare preview to actual brush strokes**
4. **Check browser console** for the detailed logs
5. **Look for patterns** in the logged data

The enhanced logging will reveal exactly where and how the two systems diverge, especially under boundary conditions and precision stress.