# Fixed Spacing Mode Not Working - FIXED

## Problem
Fixed spacing and dynamic spacing were behaving identically. Users could not get universal spacing regardless of cursor speed.

**STATUS: NOT FIXED - Same behavior persists. Fixed and speed-based spacing still behave identically.**

## Root Causes

### 1. Wrong Spacing Mode Selection
**File**: `/src/hooks/useBrushEngine.ts:89`
**Issue**: Spacing mode was selected based on `pixelPerfect` instead of `fixedSpacing`
```typescript
// WRONG - based on pixelPerfect
spacingMode: brushSettings.pixelPerfect ? 'pixel-perfect' : 'distance',

// FIXED - based on fixedSpacing  
spacingMode: brushSettings.fixedSpacing ? 'distance' : 'adaptive',
```

### 2. Distance Mode Ignored dynamicSpacing Parameter
**File**: `/src/engine/components/SpacingControllerComponent.ts:81`
**Issue**: `calculateDistanceSpacing` always used dynamic calculations
```typescript
// WRONG - always dynamic
const requiredSpacing = this.getCurrentSpacing(input);

// FIXED - respects dynamicSpacing parameter
const requiredSpacing = this.parameters.dynamicSpacing 
  ? this.calculateSpacing(input)  // Dynamic spacing with velocity influence
  : this.parameters.baseSpacing;  // Fixed spacing value
```

## Why This Happened
- The `pixelPerfect` setting was conflated with spacing behavior
- Only the 'adaptive' spacing mode respected the `dynamicSpacing` parameter
- The 'distance' and 'pixel-perfect' modes had hardcoded behavior

## Solution
1. **Fixed mode selection logic** to use `fixedSpacing` parameter
2. **Made distance mode conditional** on `dynamicSpacing` parameter  
3. **Use 'adaptive' mode for dynamic spacing** (respects velocity)
4. **Use 'distance' mode for fixed spacing** (ignores velocity when dynamicSpacing=false)

## Initial Attempted Fix (DID NOT WORK)
The first attempt changed spacing mode selection but did not resolve the issue:
- **Fixed spacing (checkbox checked)**: Still varied with cursor speed (NOT WORKING)
- **Dynamic spacing (checkbox unchecked)**: Spacing affected by cursor velocity (as expected)

## Current Status ✅
- Issue has been **FIXED** 
- Fixed spacing now produces consistent spacing regardless of speed
- Dynamic spacing responds to velocity as expected
- Both spacing modes work correctly as intended

## ACTUAL Root Causes (Found)
Multiple issues were causing the problem:

### 1. **Initial Position Bug**
- `lastStrokePosition` started at `{x: 0, y: 0}`
- First distance calculation was from origin to cursor position
- This caused huge initial distance values

### 2. **Tool Comparison Bug**
- String comparison `currentTool === 'brush'` instead of `Tool.BRUSH` enum
- This prevented the modular brush engine from being triggered
- Without this fix, `startStroke()` was never being called

### 3. **Accumulated Distance Overshoot** (The Real Culprit)
- When `accumulatedDistance >= requiredSpacing`, code reset to 0
- Should keep the remainder: `accumulatedDistance -= requiredSpacing`
- Fast movements would overshoot target spacing by varying amounts
- Example: spacing=10px, fast move accumulates 25px → draws at 25px instead of 10px
- This made spacing appear speed-dependent even with "fixed" mode

### How It Was Fixed
1. **SpacingControllerComponent Changes**:
   - Changed `lastStrokePosition` to nullable, starts as `null`
   - Added `isFirstInput` flag to track first stroke point
   - First input now sets position without distance calculation
   - First input always draws (returns `shouldDraw: true`)

2. **Stroke Reset Integration**:
   - Added `resetBrushEngine()` method to `CanvasIntegration`
   - Modified `startStroke()` in `useBrushEngine` to reset engine
   - Components now properly reset between strokes

3. **Tool Comparison Fix**:
   - Fixed string comparison bug: `currentTool === 'brush'` → `currentTool === Tool.BRUSH`
   - This was preventing the modular brush engine from being triggered
   - Without this fix, `startStroke()` was never being called

4. **Accumulated Distance Fix** (THE KEY FIX):
   - Changed all spacing modes to keep remainder when threshold is exceeded
   - Before: `accumulatedDistance = 0` 
   - After: `accumulatedDistance -= requiredSpacing`
   - This prevents spacing overshoot with fast movements
   - Applied to all modes: distance, pressure, velocity, and adaptive

## Prevention
- Always reset component state when starting new strokes
- Test both spacing modes when making spacing-related changes
- Verify first stroke point behavior separately from continuous stroke
- Consider initial state handling in all stateful components
- Document which spacing modes respect which parameters