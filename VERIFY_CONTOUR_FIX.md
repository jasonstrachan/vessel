# Contour Lines Finalization - Verification Checklist

## Test Setup
1. Select Contour Lines brush (CONTOUR_LINES2 or NEW_SHAPE_FILL)
2. Draw a polygon shape (3+ vertices)
3. Adjust spacing by dragging

## Critical Tests

### ✅ 1. Stroke Appears Immediately
**Test:** Click to commit spacing
- [ ] Stroke appears on active layer after single rAF
- [ ] No delay or "ghost" preview
- [ ] Content is visible immediately

**Expected:** Drawing appears instantly, no flicker

---

### ✅ 2. Undo Restores Correctly
**Test:** After committing stroke, press Cmd+Z (or Ctrl+Z)
- [ ] Undo restores to pre-stroke state
- [ ] No residual artifacts
- [ ] Stroke completely removed from layer

**Expected:** Clean undo to previous state

---

### ✅ 3. No "Empty Output" with Large Spacing
**Test:** Set spacing larger than shape radius
- [ ] No "empty output" logs in console
- [ ] Preview shows valid contours (clamped to maxDistance)
- [ ] Final stroke matches preview (not blank)

**Expected:** Spacing clamped to `min(spacing, basis.maxDistance)`

---

### ✅ 4. No Console Spam
**Test:** During preview and finalization
- [ ] No "extra restore()" errors
- [ ] No canvas state stack warnings
- [ ] Clean console output (only debug logs if enabled)

**Expected:** No browser warnings about canvas state

---

### ✅ 5. Transform Consistency
**Test:** At various zoom levels (50%, 100%, 200%)
- [ ] Preview renders correctly with view transform
- [ ] Final stroke appears at same world coordinates as preview
- [ ] No offset between preview and final render
- [ ] Stroke matches zoom-independent world position

**Expected:** Preview and final render perfectly aligned

---

## Edge Cases

### Test: Rapid Spacing Changes
- [ ] Drag spacing slider quickly
- [ ] Click to commit while preview is updating
- [ ] Verify no race conditions or missing strokes

### Test: Shape Finalization During Busy State
- [ ] System is processing (isBusyRef = true)
- [ ] Spacing click still works (bypass via allowAdjustmentWhileBusy)
- [ ] Final stroke commits correctly

### Test: Multiple Strokes in Session
- [ ] Draw shape A, commit
- [ ] Draw shape B, commit
- [ ] Draw shape C, commit
- [ ] Verify all three strokes persist
- [ ] Undo reverses in correct order

---

## Debug Console Commands

```js
// Enable contour debug logging
window.__CONTOUR_DEBUG = true;

// Check final stroke state
console.log('Drawing canvas has content:', drawingHandlers.drawingCanvasHasContent.current);

// Verify composite is dirty
console.log('Composite dirty:', compositeCanvasDirtyRef.current);

// Check state after finalize
console.log('Contour state:', contourLinesStateRef.current);
```

---

## Success Criteria

All checkboxes must pass. Any failure indicates regression or incomplete fix.

**Key Indicators:**
- ✅ Immediate visual feedback on commit
- ✅ Undo works perfectly
- ✅ No empty strokes regardless of spacing
- ✅ Clean console (no canvas errors)
- ✅ Preview = final render position
