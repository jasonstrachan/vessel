# Coordinate System Fix Documentation

## Problem Summary
The tinybrush application had multiple coordinate system alignment issues causing painting actions to be offset from cursor positions.

## Root Causes Identified

### 1. CSS `contain` Property Breaking Fixed Positioning
**Issue**: CSS `contain` properties in parent elements created new containing blocks
**Location**: 
- `src/app/page.tsx:53` - `contain: 'layout style paint'`
- `src/components/canvas/DrawingCanvas.tsx:1455` - `contain: 'strict'`

**Effect**: `position: fixed` elements (like BrushCursor) were positioned relative to containers instead of viewport

### 2. Inconsistent Coordinate Reference Points
**Issue**: Different systems used different coordinate references
- Orange debug dot: Used `getBoundingClientRect()` + complex calculations
- Painting logic: Used `transformScreenToCanvas()` with canvas-relative coordinates  
- Cursor positioning: Used raw `event.clientX/clientY`

### 3. Complex Scaling Calculations
**Issue**: `transformScreenToCanvas()` used complex scaling logic that accumulated errors
- `width / rect.width` ratios
- Border compensation logic
- Device pixel ratio considerations

## Solutions Implemented

### 1. Removed CSS `contain` Properties
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

### 2. Unified Coordinate System with Wrapper Reference
**Added**: `wrapperRef` to create stable positioning context
```tsx
<div ref={wrapperRef} className="relative" style={{ width: `${width}px`, height: `${height}px` }}>
  <canvas ref={canvasRef} />
  {/* Orange debug dot positioned absolutely within wrapper */}
</div>
```

### 3. Simplified Coordinate Transformations
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

### 4. Aligned All Coordinate Systems
- **Orange dot**: `position: absolute` relative to wrapper
- **Painting logic**: Wrapper-relative coordinates via `transformScreenToCanvas()`
- **Cursor positioning**: Raw coordinates (now work due to removed `contain` properties)

## Key Functions Updated

### `transformScreenToCanvas()`
- Changed from canvas `getBoundingClientRect()` to wrapper `getBoundingClientRect()`
- Removed complex scaling calculations
- Added border compensation using `clientLeft/clientTop`

### Orange Dot Positioning
- Changed from `position: fixed` with viewport coordinates
- To `position: absolute` with simple `left: ${canvas.panX}px`

## Testing Results
- ✅ Orange dot appears at world coordinate (0,0) 
- ✅ Cursor aligns with mouse pointer
- ✅ Painting appears exactly where clicked
- ✅ No offset issues during zoom/pan operations

## Future Maintenance Notes
- Keep wrapper-based coordinate system for any new positioning logic
- Avoid CSS `contain` properties in parent elements of fixed-positioned overlays
- All coordinate transformations should use `wrapperRef.getBoundingClientRect()` as reference
- Canvas logical size should match CSS display size to avoid scaling calculations