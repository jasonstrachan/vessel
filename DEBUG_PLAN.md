# Color Cycle Shape Undo Debug Plan

## The Problem
When drawing multiple color cycle shapes on a color cycle layer, pressing undo removes ALL shapes instead of just the last one.

## Debug Logging Added

### 1. Undo Stack Monitor (`DrawingCanvas.tsx`)
- Logs when new states are saved to undo stack
- Shows description of each saved state

### 2. Shape Draw Logging (`DrawingCanvas.tsx`)
- Logs when color cycle shape is drawn
- Shows canvas state before/after operations
- Tracks resetColorCycle and fillColorCycleShape calls

### 3. Finalization Logging (`useDrawingHandlers.ts`)
- Logs when CC layer state is saved
- Shows what's being saved and with what description

### 4. ColorCycleBrush Internal (`ColorCycleBrushCanvas2D.ts`)
- Logs startStroke calls
- Shows if paint buffer exists before operations
- Tracks when stroke data is reset

### 5. Brush Engine (`useBrushEngineSimplified.ts`)
- Logs resetColorCycle calls
- Logs fillColorCycleShape process
- Shows when startStroke is called multiple times

## Test Sequence

1. Open browser console and clear it
2. Create or select a Color Cycle layer
3. Enable Shape Mode
4. Draw Shape 1 (polygon)
5. **OBSERVE CONSOLE**: Should see:
   - COLOR CYCLE SHAPE DRAW
   - resetColorCycle logs
   - fillColorCycleShape logs
   - FINALIZE logs
   - NEW UNDO STATE SAVED

6. Draw Shape 2 (another polygon)
7. **OBSERVE CONSOLE**: Same sequence as above

8. Press Ctrl+Z once
9. **OBSERVE**:
   - What does "UNDO TRIGGERED" show?
   - Do both shapes disappear or just one?

## Key Questions to Answer

1. **Are shapes being saved separately?**
   - Check if each shape creates its own undo entry
   - Look for "NEW UNDO STATE SAVED" after each shape

2. **Is resetColorCycle clearing previous data?**
   - Look for "Previous paint buffer exists?" logs
   - Check if startStroke is being called multiple times

3. **Is the paint buffer being preserved?**
   - Look for "NOT clearing paint buffer" logs
   - Check if the buffer exists between operations

## Hypothesis

The issue might be that:
1. `resetColorCycle()` calls `startStroke()` which might reset the paint buffer
2. `fillColorCycleShape()` also calls `startStroke()` again
3. Multiple `startStroke()` calls might be clearing accumulated data

## Next Steps

After running the test:
1. Analyze console output to identify where data is lost
2. Check if saves are happening correctly
3. Verify undo restoration process
4. Fix the root cause based on findings