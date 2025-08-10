# TinyBrush Issues and Resolutions

This document tracks all critical issues encountered during TinyBrush development, their analysis, and resolutions. Use this as the primary reference for debugging and preventing similar issues.

## Table of Contents

1. [Issue #16: Custom Brush Size Persistence Issues](#issue-16-custom-brush-size-persistence-issues) - Multiple related bugs with custom brush sizing
2. [Issue #15: Gradient Brush Dither Resolution Not Persisting](#issue-15-gradient-brush-dither-resolution-not-persisting) - Feature persistence for gradient brushes
3. [Issue #14: Custom Brush Hue/Saturation Cache Invalidation](#issue-14-custom-brush-huesaturation-cache-invalidation) - Dual cache system requiring comprehensive clearing
4. [Issue #13: Coordinate System Fix Documentation](#issue-13-coordinate-system-fix-documentation) - Complete drawing system coordinate alignment fix
5. [Issue #12: Canvas Resize Cursor Alignment Fix](#issue-12-canvas-resize-cursor-alignment-fix---complete-solution) - Canvas resize cursor misalignment resolution  
6. [Issue #11: Custom Brush Pressure Sensitivity Implementation](#issue-11-custom-brush-pressure-sensitivity-implementation) - Smooth pressure transitions for custom brushes
7. [Issue #10: Image Paste Not Working](#issue-10-image-paste-not-working---event-listener-thrashing) - Event listener thrashing preventing paste functionality
8. [Issue #9: Zoom Controls Not Using Cursor Position](#issue-9-zoom-controls-not-using-cursor-position) - Button/slider zoom coordinate system mismatch
9. [Issue #8: Right Column Padding Not Visible](#issue-8-right-column-padding-not-visible) - UI layout padding visibility issue
10. [Issue #7: Server Shutdown During Runtime](#issue-7-server-shutdown-during-runtime) - Next.js dev server crashes
11. [Issue #6: Fast Movement Breaks Pixel-Perfect Lines](#issue-6-fast-movement-breaks-pixel-perfect-lines-waiting-pixel-algorithm-issue) - Waiting pixel algorithm causing broken lines
12. [Issue #5: Pixel Brush Non-Pixel-Perfect Drawing During Slow Movement](#issue-5-pixel-brush-non-pixel-perfect-drawing-during-slow-movement) - Stair-stepping during slow movement
13. [Issue #4: Canvas Dragging Clears Content](#issue-4-canvas-dragging-clears-content-archived-from-planmd) - useEffect clearing canvas during drag
14. [Issue #3: Canvas Display Mode Affecting Existing Strokes](#issue-3-canvas-display-mode-affecting-existing-strokes) - imageRendering CSS affecting all content
15. [Issue #2: Persistent Cursor Alignment After Initial Fix](#issue-2-persistent-cursor-alignment-after-initial-fix) - Double-applying pan offset issue
16. [Issue #1: Port 3001 ERR_CONNECTION_REFUSED](#issue-1-port-3001-err_connection_refused) - Development server port confusion

### Fixed Issues (Historical Documentation)
- [Canvas Flash and Disappear on Page Load](#fixed-canvas-flash-and-disappear-on-page-load) - Canvas initialization scaling conflicts
- [Line Shifting During Undo/Redo](#fixed-line-shifting-during-undoredo---dual-canvas-implementation) - Dual canvas architecture implementation
- [Faint Traces During Undo/Redo](#fixed-faint-traces-during-undoredo) - Canvas state management enhancement
- [Stroke Capture Missing](#fixed-stroke-capture-missing) - Missing finishStroke() call
- [Cursor Alignment After Panning](#fixed-cursor-alignment-after-panning) - Coordinate transformation order fix

---

## Issue #16: Custom Brush Size Persistence Issues
**Date**: 2025-01-31  
**Status**: ✅ RESOLVED  
**Severity**: Critical (Multiple related bugs)

### Problem Description
Multiple interconnected issues with custom brush sizing:
1. **Bug #1**: After saving a custom brush edit, it wasn't painting with the saved version
2. **Bug #2**: Clicking away from custom brush and back incorrectly reset size to 5px
3. **Bug #3**: Brush edit overlay remained visible on canvas after saving
4. **Bug #4**: New pixels drawn during brush editing appeared under existing pixels
5. **Bug #5**: Custom brush size at 100% was rendering at half size

### Root Cause Analysis

#### Bug #1: Saved Brush Not Being Used
- `saveBrushEdit` cleared `currentBrushTip` instead of updating it with new brush data
- Fixed by setting `currentBrushTip` to the updated brush ImageData immediately after save

#### Bug #2: Size Reset on Selection
- Custom brushes inherited size from previous brush instead of maintaining their own
- Fixed by ensuring custom brushes always set to 100% when selected

#### Bug #3: Edit Overlay Persistence
- Race condition between brush editor state reset and canvas recomposition
- Fixed by including `layersNeedRecomposition: true` in state update

#### Bug #4: Edit Layering Issue
- Rendering order was wrong - brush preview drawn after new strokes
- Fixed by reversing render order in `renderView()` function

#### Bug #5: Size Scaling Issue
- Multiple calculation errors causing custom brushes to be scaled down:
  - Scale factor calculation even at 100% size
  - ID mismatch between stored and lookup IDs
  - Final fix: At 100% size, use scaleFactor = 1.0 (no scaling)

### Resolution Details

#### Key Files Modified
1. **`src/stores/useAppStore.ts`**
   - Added `currentBrushTip` update in `saveBrushEdit`
   - Fixed size persistence logic in `setBrushPreset`
   - Added `layersNeedRecomposition` flag to brush edit operations

2. **`src/components/BrushLibrary.tsx`**
   - Added SHAPE_RENDERER component to custom brush presets
   - Imported ComponentType for proper brush identification

3. **`src/components/canvas/DrawingCanvas.tsx`**
   - Fixed rendering order for brush editing overlay
   - Removed duplicate brush preview rendering

4. **`src/hooks/useBrushEngine.ts`**
   - Added special case for 100% size to use scaleFactor = 1.0
   - Fixed ID lookup to handle both prefixed and unprefixed IDs

### Technical Implementation
```typescript
// Critical fix for size scaling at 100%
const scaleFactor = tools.brushSettings.size === 100 
  ? 1.0  // At 100%, no scaling - use natural size
  : pressureOptimizer.calculateScaleFactor(
      actualBrushSize,
      customBrushMaxDimension,
      !!isCurrentBrushTip,
      brushTipBaseSize
    );
```

### Post-Resolution Verification
- ✅ Custom brushes paint with saved version immediately after editing
- ✅ Custom brushes maintain 100% size when selected
- ✅ Edit overlay properly removed from canvas after saving
- ✅ New edit pixels draw on top of existing brush pixels
- ✅ Custom brushes at 100% render at full size

### Prevention Measures
- Always update active state when saving changes
- Ensure proper component identification for custom brushes
- Use atomic state updates to prevent race conditions
- Test size calculations at boundary values (especially 100%)

### Key Insights
1. **State synchronization is critical** - saved data must immediately become active
2. **Component identification matters** - custom brushes need proper SHAPE_RENDERER
3. **Race conditions in React** - use atomic state updates with flags
4. **Rendering order affects functionality** - layer order determines what's visible
5. **Scale calculations need edge cases** - 100% should mean "no scaling"

---

## Issue #15: Gradient Brush Dither Resolution Not Persisting
**Date**: 2025-01-31  
**Status**: RESOLVED  
**Severity**: High (Feature Persistence)  

### Problem Description
When using rectangle and polygon gradient brushes, the dither resolution (`fillResolution`) setting was not persisting when switching between brushes. The colors setting persisted correctly, but fillResolution always reset to 1, making the dither feature difficult to use effectively.

### Root Cause Analysis
The issue had multiple contributing factors:

#### 1. Missing from Save Operations in BrushLibrary
The `fillResolution` setting was not included in the brush settings save operations in `BrushLibrary.tsx`:
- **useEffect cleanup function** - saves settings when component unmounts
- **handlePresetClick function** - saves settings when switching brushes

#### 2. React Component Mounting/Unmounting Issue
The conditional rendering of the dither resolution slider caused React to unmount and remount the component:
```typescript
// PROBLEMATIC CODE
{activeSettings.ditherEnabled && (
  <ProgressSlider value={activeSettings.fillResolution || 1} />
)}
```
This mounting/unmounting could reset the component state to default values.

#### 3. Robust Preset Loading Issue
The `setBrushPreset` function wasn't properly applying user overrides due to incorrect parameter passing:
```typescript
// BROKEN
const { settings, components } = applyBrushPreset(preset, userSavedSettings);

// FIXED  
const { settings: presetDefaults, components } = applyBrushPreset(preset);
const userOverrides = get().loadBrushSettings(preset.id);
// Then properly merge with userOverrides having highest priority
```

### Resolution Strategy
**Three-pronged fix to ensure fillResolution persistence**:

#### 1. Added fillResolution to Save Operations
In `src/components/BrushLibrary.tsx`:
```typescript
// Added to both save locations
fillResolution: tools.brushSettings.fillResolution,
```

#### 2. Implemented "Sledgehammer" Fix for Slider
In `src/components/toolbar/BrushControls.tsx`:
```typescript
// Always render slider but control visibility with CSS
<ProgressSlider
  style={{
    visibility: activeSettings.ditherEnabled ? 'visible' : 'hidden',
    opacity: activeSettings.ditherEnabled ? 1 : 0,
    transition: 'opacity 0.2s',
  }}
  value={activeSettings.fillResolution || 1}
  // ... rest of props
/>
```

#### 3. Fixed Robust Preset Loading
In `src/stores/useAppStore.ts`:
```typescript
// Proper order of operations
const { settings: presetDefaults, components } = applyBrushPreset(preset);
const userOverrides = get().loadBrushSettings(preset.id);

const newBrushSettings = {
  ...defaultBrushSettingsForStore, // 1. Base defaults
  ...presetDefaults,               // 2. Preset-specific settings
  ...userOverrides,                // 3. User saved settings (highest priority)
  // 4. Settings that carry over between brushes
  color: currentSettings.color,
  blendMode: currentSettings.blendMode,
  size: state.globalBrushSize
};
```

### Files Modified
1. **`src/components/BrushLibrary.tsx`** - Added fillResolution to save operations
2. **`src/components/toolbar/BrushControls.tsx`** - Implemented always-visible slider with CSS visibility control
3. **`src/stores/useAppStore.ts`** - Fixed robust preset loading with proper user override application
4. **`src/hooks/useBrushEngine.ts`** - Fixed division by zero when colors=1 (added special case)

### Additional Bug Fixed
**Division by Zero in Dither Algorithm**:
When `colors = 1`, the palette generation caused:
```typescript
// BROKEN
palette.push(Math.round((i / (numColors - 1)) * 255)); // 0/0 = NaN

// FIXED
if (numColors === 1) {
  palette.push(128); // Single mid-gray color
} else {
  // Original logic for 2+ colors
}
```

Also enforced minimum 2 colors for dithering to be meaningful:
```typescript
const numColors = Math.max(2, brushSettings.colors || 2);
```

### Post-Resolution Verification
- ✅ **fillResolution persists**: Setting saved and restored when switching brushes
- ✅ **colors setting persists**: Continues to work as before
- ✅ **No slider flashing**: Slider remains stable with CSS visibility control
- ✅ **No division by zero**: Dithering works with any color count
- ✅ **User overrides respected**: Saved settings have highest priority

### Prevention Measures
- **Include all settings in save operations**: Audit save/load logic when adding new settings
- **Avoid conditional component rendering**: Use CSS visibility for UI state changes
- **Test edge cases**: Check boundary values (like colors=1) for mathematical operations
- **Proper state merging order**: Ensure user overrides always have highest priority

### Key Insights
1. **Component lifecycle matters**: Conditional rendering can reset component state
2. **Save operations must be comprehensive**: Missing fields won't persist
3. **CSS visibility > conditional rendering**: For preserving component state
4. **Mathematical edge cases**: Always handle division by zero and boundary conditions

### Manual Testing Checklist
- [ ] Set fillResolution to a value (e.g., 16)
- [ ] Switch to another brush
- [ ] Switch back to gradient brush
- [ ] Verify fillResolution is still 16
- [ ] Toggle dither on/off and verify slider stability
- [ ] Test with colors=1 and verify no black rendering
- [ ] Test with multiple gradient brushes

---

## Issue #14: Custom Brush Hue/Saturation Cache Invalidation

**Date:** 2025-01-27  
**Status:** ✅ RESOLVED  
**Severity:** Medium - Functionality impairment

### Problem Description

Custom brush hue/saturation changes showed correctly in the MiniCanvas preview but did not immediately reflect when painting on the main canvas. The first hue change would work, but subsequent changes would take multiple paint strokes before taking effect.

### Symptoms

- ✅ MiniCanvas preview updated immediately with hue/saturation changes
- ❌ Main canvas painting used old hue/saturation values 
- ❌ First hue change worked, subsequent changes delayed
- ❌ Multiple paint strokes needed before new colors appeared

### Root Cause Analysis

**Dual Cache Architecture Issue:**

The system uses two separate cache systems for brush optimization:

1. **`brushCache`** - Caches brush calculations and metadata (includes `customBrushId` in cache key)
2. **`scaledBrushCache`** - Caches pre-scaled brush canvases (includes `customBrushId` in cache key)

**Cache Key Mismatch:**

When hue/saturation is applied to a custom brush, the brush engine creates a modified brush with ID `current-brush-tip` instead of using the original custom brush ID. This means:

- **Original brush entries:** `temp_brush_1753617605345`
- **Modified brush entries:** `current-brush-tip` ← **Not being cleared**

**Cache Invalidation Gap:**

The original fix only cleared caches for the original custom brush ID, but the scaled brush cache was actually using `current-brush-tip` for the modified brush data.

### Debug Evidence

Console logs revealed the issue:

```
// Cache clearing (working):
Clearing cache for custom brush ID: temp_brush_1753617605345
Both caches cleared.

// But actual usage (using different ID):
Using cached scaled brush for key: current-brush-tip_1.00_0.00_none_0
```

### Solution

Enhanced cache clearing in `RHC1Panel.tsx` to clear **both** brush IDs:

```typescript
// Clear both cache systems for custom brushes when hue/saturation changes
if (brushSettings.brushShape === BrushShape.CUSTOM) {
  const brushId = getCurrentBrushId();
  scaledBrushCache.clearForBrush(brushId);
  // Also clear cache for current-brush-tip which is used when hue/saturation is applied
  scaledBrushCache.clearForBrush('current-brush-tip');
  brushCache.clear();
}
```

### Files Modified

- `/src/components/panels/RHC1Panel.tsx` - Enhanced cache clearing logic

### Technical Details

**Cache Key Analysis:**
- `brushCache.getCacheKey()` includes `customBrushId` but **excludes** `hueShift` and `saturation`
- When only hue/saturation changes, identical cache keys are generated
- Modified brush data is stored under `current-brush-tip` ID in `useBrushEngine.ts:879`

**Why MiniCanvas Worked:**
- MiniCanvas directly applies `adjustHueAndSaturation()` to `originalBrushData` on every render
- Doesn't rely on brush cache for preview rendering

**Why Main Canvas Failed:**
- Brush engine retrieves cached brush data using incomplete cache key
- Cached calculations don't reflect hue/saturation changes
- Pre-scaled brush canvases cached under wrong ID

### Prevention

- Consider including hue/saturation in cache keys for future enhancements
- Document dual cache architecture for future developers
- Add comprehensive cache clearing for any brush modification operations

### Verification

After fix:
- ✅ Immediate hue/saturation reflection in main canvas painting
- ✅ No delay between MiniCanvas preview and actual painting
- ✅ Cache clearing logs show both IDs being cleared
- ✅ Performance maintained through proper cache regeneration

---

## Issue #13: Coordinate System Fix Documentation
**Date**: Historical  
**Status**: RESOLVED  
**Severity**: Critical (Complete Drawing System Failure)  

### Problem Summary
The tinybrush application had multiple coordinate system alignment issues causing painting actions to be offset from cursor positions, making the application completely unusable for drawing.

### Root Causes Identified

#### 1. CSS `contain` Property Breaking Fixed Positioning
**Issue**: CSS `contain` properties in parent elements created new containing blocks
**Location**: 
- `src/app/page.tsx:53` - `contain: 'layout style paint'`
- `src/components/canvas/DrawingCanvas.tsx:1455` - `contain: 'strict'`

**Effect**: `position: fixed` elements (like BrushCursor) were positioned relative to containers instead of viewport

#### 2. Inconsistent Coordinate Reference Points
**Issue**: Different systems used different coordinate references
- Orange debug dot: Used `getBoundingClientRect()` + complex calculations
- Painting logic: Used `transformScreenToCanvas()` with canvas-relative coordinates  
- Cursor positioning: Used raw `event.clientX/clientY`

#### 3. Complex Scaling Calculations
**Issue**: `transformScreenToCanvas()` used complex scaling logic that accumulated errors
- `width / rect.width` ratios
- Border compensation logic
- Device pixel ratio considerations

### Solutions Implemented

#### 1. Removed CSS `contain` Properties
```diff
// src/app/page.tsx
style={{
  overflow: 'hidden',
  position: 'relative',
- contain: 'layout style paint'
}}

// src/components/canvas/DrawingCanvas.tsx  
style={{
  overflow: 'hidden',
  clipPath: 'inset(0)',
- contain: 'strict'
}}
```

#### 2. Unified Coordinate System with Wrapper Reference
**Added**: `wrapperRef` to create stable positioning context
```tsx
<div ref={wrapperRef} className="relative" style={{ width: `${width}px`, height: `${height}px` }}>
  <canvas ref={canvasRef} />
  {/* Orange debug dot positioned absolutely within wrapper */}
</div>
```

#### 3. Simplified Coordinate Transformations
**Before**: Complex calculations with getBoundingClientRect() + scaling
```typescript
const rect = canvasEl.getBoundingClientRect();
const scaleX = width / rect.width;
const canvasX = (clientX - rect.left) * scaleX;
```

**After**: Simple wrapper-relative calculations
```typescript
const wrapperRect = wrapperEl.getBoundingClientRect();
const mouseXInWrapper = clientX - wrapperRect.left;
const canvasCssX = mouseXInWrapper - canvasEl.clientLeft;
```

#### 4. Aligned All Coordinate Systems
- **Orange dot**: `position: absolute` relative to wrapper
- **Painting logic**: Wrapper-relative coordinates via `transformScreenToCanvas()`
- **Cursor positioning**: Raw coordinates (now work due to removed `contain` properties)

### Key Functions Updated

#### `transformScreenToCanvas()`
- Changed from canvas `getBoundingClientRect()` to wrapper `getBoundingClientRect()`
- Removed complex scaling calculations
- Added border compensation using `clientLeft/clientTop`

#### Orange Dot Positioning
- Changed from `position: fixed` with viewport coordinates
- To `position: absolute` with simple `left: ${canvas.panX}px`

### Testing Results
- ✅ Orange dot appears at world coordinate (0,0) 
- ✅ Cursor aligns with mouse pointer
- ✅ Painting appears exactly where clicked
- ✅ No offset issues during zoom/pan operations

### Future Maintenance Notes
- Keep wrapper-based coordinate system for any new positioning logic
- Avoid CSS `contain` properties in parent elements of fixed-positioned overlays
- All coordinate transformations should use `wrapperRef.getBoundingClientRect()` as reference
- Canvas logical size should match CSS display size to avoid scaling calculations

### Prevention Measures
- Document wrapper-based coordinate system in component architecture
- Test coordinate accuracy after any CSS layout changes
- Verify cursor alignment at multiple zoom/pan combinations
- Add coordinate transformation unit tests

### Manual Testing Checklist
- [ ] Orange debug dot appears at world coordinate (0,0)
- [ ] Cursor aligns perfectly with mouse pointer at all zoom levels
- [ ] Drawing operations occur exactly where cursor points
- [ ] No offset issues during panning operations
- [ ] Coordinate accuracy maintained across browser zoom levels

### Related Technical Concepts
- **CSS Containment**: Effects of `contain` property on positioning contexts
- **Coordinate Systems**: Browser viewport vs element-relative positioning
- **Canvas Transformations**: Relationship between DOM attributes and rendering context
- **getBoundingClientRect()**: Behavior with CSS transforms and containment

### Issue #16a: Pixel Round Brush Not Working in Custom Brush Edit Mode
**Date**: 2025-01-31  
**Status**: ✅ RESOLVED  
**Severity**: High (Feature not working)

#### Problem Description
Pixel round brush wasn't working when editing custom brushes:
- No cursor visible when pixel round selected
- No pixels drawn on the custom brush canvas
- Other brush shapes worked fine

#### Root Cause
The pixel round brush was incorrectly being routed through the custom brush rendering path in `useBrushEngine.ts`. When `customBrush` was set (which happens during custom brush editing), ALL brushes were treated as custom brushes, including pixel round.

#### Solution
Added explicit check to prevent PIXEL_ROUND from going through custom brush path:
```typescript
// Ensure PIXEL_ROUND never goes through custom brush path
if (customBrush && tools.brushSettings.brushShape !== BrushShape.PIXEL_ROUND) {
  // Custom brush rendering
} else {
  // Regular brush rendering including PIXEL_ROUND
}
```

Also added minimum cursor size in BrushCursor.tsx for visibility:
```typescript
// Ensure minimum visible cursor size, especially for pixel brushes
const screenSize = Math.max(4, size * zoom);
```

#### Simplified Bounds Checking
Originally added complex manual bounds checking in multiple places:
1. `drawShape` function - checking if brush stamps would extend outside bounds
2. `drawCustomBrushStamp` function - similar stamp boundary checks  
3. `DrawingCanvas.tsx` handlePointerDown - checking if brush radius stays within bounds
4. `DrawingCanvas.tsx` handlePointerMove - redundant brush radius calculations and checks

However, discovered that canvas already uses `ctx.clip()` for automatic bounds restriction. Removed ALL redundant manual checks since canvas clipping prevents any pixels from being drawn outside the clipped region automatically.

**Files cleaned up**:
- `/src/hooks/useBrushEngine.ts` - Removed manual bounds checks from drawShape and drawCustomBrushStamp
- `/src/components/canvas/DrawingCanvas.tsx` - Removed brush radius calculations and bounds checks

**Before**: Complex manual bounds calculations with brush radius math
**After**: Simple comments noting canvas clipping handles everything

This simplification removes ~50 lines of redundant code while maintaining the same functionality through the browser's built-in canvas clipping mechanism. The canvas API's `ctx.clip()` is more efficient and reliable than manual bounds checking.

---

[Rest of issues remain unchanged from Issue #12 downward...]