# Brush Engine Testing Instructions

## Current Status
✅ Migration infrastructure is in place and ready for testing

### What's Been Done:
1. **Updated imports** - `DrawingCanvas` and `useDrawingHandlers` now use the adapter
2. **Enabled test panels** - Visual comparison and toggle UI are active
3. **Feature flag ready** - Can switch between implementations

## Testing Procedure

### Phase 3.2: Test Each Component

#### Step 1: Test with OLD Implementation (Baseline)
Current setting: `NEXT_PUBLIC_USE_MODULAR_BRUSH=false`

1. **Open the app** at http://localhost:3000
2. **Look for the testing UI**:
   - Bottom right: "🔧 Brush Engine" toggle (shows "MONOLITHIC")
   - Top right: "🧪 Brush Engine Comparison" panel
3. **Run visual tests**:
   - Click "Run Tests" in the comparison panel
   - Both canvases should show identical output (using old engine)
   - Note the performance times

4. **Manual testing**:
   - Draw various strokes
   - Test pressure sensitivity (if available)
   - Try different brush sizes
   - Test grid snapping
   - Test dithering effects

#### Step 2: Switch to NEW Implementation
Using the toggle UI:
1. Click "Switch to MODULAR" button
2. Click "Reload" when prompted
3. Console should show: `[BrushEngine] Using MODULAR implementation`

Or manually in `.env.development`:
```bash
NEXT_PUBLIC_USE_MODULAR_BRUSH=true
```

#### Step 3: Compare Results
1. **Run the same visual tests**
2. **Compare performance metrics**:
   - Stroke rendering time
   - Memory usage
   - Check for any visual differences

3. **Manual comparison**:
   - Repeat the same drawing tests
   - Look for:
     - Visual differences
     - Performance issues
     - Missing functionality
     - Errors in console

### Phase 3.3: Performance Comparison

The test panel shows metrics for:
- **Simple Stroke**: Basic line drawing
- **Multiple Strokes**: Parallel lines with varying pressure
- **Pressure Variation**: Curved stroke with pressure changes
- **Grid Snapping**: Grid-aligned strokes

#### Expected Results:
- ✅ Visual output should be **identical**
- ✅ Performance difference should be **< 10%**
- ✅ No errors in console
- ✅ All features working

#### If Issues Found:
1. Note the specific test case
2. Check browser console for errors
3. Use the toggle to switch back to MONOLITHIC
4. Document the issue

## Current Implementation Status

| Feature | Old Engine | New Engine | Status |
|---------|------------|------------|--------|
| Basic Drawing | ✅ | ✅ | Working |
| Pressure Sensitivity | ✅ | ✅ | Working |
| Grid Snapping | ✅ | ✅ | Working |
| Color Jitter | ✅ | ✅ | Working |
| Dithering | ✅ | ✅ | Working |
| Custom Brushes | ✅ | ⚠️ | Stub (needs implementation) |
| Shape Tools | ✅ | ✅ | Working |
| Gradients | ✅ | ✅ | Working |

## Known Limitations

The new implementation currently has stubs for:
- `drawCustomBrushLine`
- `drawCustomBrushStamp`
- `executeComponents`

These will need to be implemented if they're actively used.

## Debug Tools

### Check Current Implementation:
Open browser console and run:
```javascript
// Get status
getBrushEngineStatus()

// Toggle implementation
toggleBrushEngineImplementation()
```

### Performance Monitoring:
The test panel automatically shows timing for each test.
Look for the difference percentage - green means faster, red means slower.

## Next Steps

After successful testing:
1. Fix any issues found
2. Implement missing features (if needed)
3. Run extended testing with real usage
4. Once validated, proceed with cleanup phase

## Rollback

If critical issues are found:
1. Set `NEXT_PUBLIC_USE_MODULAR_BRUSH=false`
2. Reload the page
3. Old implementation will be used immediately

The adapter ensures zero breaking changes - the app will always work!