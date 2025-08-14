# Undo/Redo Test Instructions

## Test Procedure

1. Open the application at http://localhost:3000
2. Draw something with the brush
3. Press Ctrl+Z (or Cmd+Z on Mac) to undo
4. Press Ctrl+Shift+Z (or Cmd+Shift+Z on Mac) to redo

## Expected Behavior

- **Undo (Ctrl+Z)**: Should restore the canvas to the previous state
- **Redo (Ctrl+Shift+Z)**: Should restore the undone action

## Implementation Details

The undo/redo functionality has been fixed to work with the new rendering pipeline:

1. **Keyboard shortcuts added**: Ctrl+Z for undo, Ctrl+Shift+Z for redo
2. **State saving**: saveCanvasState is now called after each drawing operation
3. **State restoration**: Undo/redo properly restores the layer's imageData and triggers a redraw

## Code Changes

- Added keyboard handlers in DrawingCanvas.tsx
- Added saveCanvasState calls after captureCanvasToActiveLayer
- Imported necessary functions from useAppStore