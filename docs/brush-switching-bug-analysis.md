# Brush Switching Bug Analysis

## Summary
I have identified the root causes of the brush switching bugs affecting MiniCanvas painting and preview display. The issues stem from **state synchronization problems** and **cache invalidation timing** during brush switches.

## Root Cause Analysis

### 1. MiniCanvas Unresponsiveness for Custom Brushes

**Primary Issue**: State synchronization delay between brush switching and MiniCanvas initialization.

**Code Location**: `/src/components/canvas/MiniCanvas.tsx` lines 175-273 (`initializeBrushTip()`)

**Problem**: When switching to a custom brush, the MiniCanvas depends on multiple state updates to complete:
- `brushSettings.selectedCustomBrush` update
- `temporaryCustomBrush` state update  
- Potential `currentBrushTip` state update

The `initializeBrushTip()` function runs before all state updates are synchronized, causing it to find no custom brush data and falling back to standard brush rendering.

**Evidence**:
```typescript
// Line 185-196: Brush ID logic is fragile
const currentBrushId = brushSettings.brushShape === BrushShape.CUSTOM && brushSettings.selectedCustomBrush 
  ? brushSettings.selectedCustomBrush
  : `standard_${brushSettings.brushShape}`;

// Line 198-221: Multiple lookup attempts that can fail during state transitions
if (brushSettings.brushShape === BrushShape.CUSTOM && brushSettings.selectedCustomBrush) {
  let customBrush = temporaryCustomBrush && temporaryCustomBrush.id === brushSettings.selectedCustomBrush
    ? temporaryCustomBrush
    : project?.customBrushes.find(b => b.id === brushSettings.selectedCustomBrush);
  // Additional fallback to brushPresets...
}
```

### 2. Default Brushes Showing Custom Brush Previews

**Primary Issue**: Stale `currentBrushTip` state persisting across brush switches.

**Code Location**: `/src/components/canvas/MiniCanvas.tsx` lines 189-196

**Problem**: When switching from a custom brush back to a default brush, the `currentBrushTip` state is not cleared immediately. The MiniCanvas checks for `currentBrushTip` first and uses it if the `brushId` matches, even when switching to a different brush type.

**Evidence**:
```typescript
// Line 189-196: currentBrushTip takes precedence over brush type
if (brushSettings.currentBrushTip && brushSettings.currentBrushTip.brushId === currentBrushId) {
  // Use the edited brush tip for this brush
  ctx.clearRect(0, 0, size, size);
  ctx.putImageData(brushSettings.currentBrushTip.imageData, 0, 0);
  return; // Early return prevents standard brush rendering
}
```

### 3. Cache Invalidation Issues

**Secondary Issue**: Cache systems are not invalidated during brush switches.

**Code Locations**: 
- `/src/utils/brushCache.ts` - No brush switch invalidation
- `/src/utils/scaledBrushCache.ts` - Only cleared on brush tip changes, not switches
- `/src/components/panels/MiniCanvasPanel.tsx` lines 36-43 - Cache clearing only for custom brushes

**Problem**: When switching brushes, cached data from previous brushes can persist and be used incorrectly for the new brush.

### 4. State Update Sequence Issues

**Primary Issue**: Brush switching logic in the store doesn't ensure atomic state updates.

**Code Location**: `/src/stores/useAppStore.ts` lines 421-458 (`setBrushPreset`)

**Problem**: The `setBrushPreset` function updates multiple state properties but doesn't clear `currentBrushTip` when switching away from custom brushes, leading to stale state.

**Evidence**:
```typescript
// setBrushPreset doesn't clear currentBrushTip when switching to non-custom brushes
// This leaves stale custom brush tip data that can be picked up by MiniCanvas
```

## Specific Bug Symptoms Explained

### Bug 1: Can't Paint on Custom Brush MiniCanvas
- **Root Cause**: Race condition between brush selection and MiniCanvas initialization
- **Mechanism**: `initializeBrushTip()` runs before `selectedCustomBrush` state is fully propagated
- **Result**: MiniCanvas treats custom brush as standard brush, making it read-only

### Bug 2: Default Brushes Show Custom Brush Preview
- **Root Cause**: Stale `currentBrushTip` state with mismatched `brushId`
- **Mechanism**: `currentBrushTip.brushId` can match standard brush ID patterns after custom brush edits
- **Result**: MiniCanvas displays custom brush tip instead of generating standard brush preview

## Recommended Fixes

### 1. Immediate Fix - Clear currentBrushTip on Brush Switch
Add `currentBrushTip: undefined` to brush switching logic in `setBrushPreset` and `setBrushSettings`.

### 2. State Synchronization Fix  
Add state synchronization checks in MiniCanvas `useEffect` to wait for complete state updates before initialization.

### 3. Cache Invalidation Fix
Implement proper cache clearing on all brush switches, not just custom brush tip changes.

### 4. Brush ID Consistency Fix
Standardize brush ID generation to prevent ID collisions between different brush types.

## Impact Assessment
- **Severity**: High - Prevents core editing functionality
- **Frequency**: Occurs on every brush switch involving custom brushes
- **User Experience**: Confusing and blocks workflow
- **Data Loss Risk**: Low - No data corruption, just display/interaction issues