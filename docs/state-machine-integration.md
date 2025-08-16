# State Machine Integration Guide

## Overview
We've created a robust state machine for managing canvas interactions with proper panning support. Here's how to integrate it into DrawingCanvas.

## Key State Machine Features

### States
- **IDLE**: Default state, ready for any interaction
- **AWAITING_PAN**: Spacebar held, shows "grab" cursor, ready to pan on mouse down
- **PANNING**: Actively panning the canvas with "grabbing" cursor
- **DRAWING**: Active drawing in progress
- **SELECTING**: Making a selection
- **FINALIZING**: Finalizing a drawing operation
- **BUSY**: System busy, all interactions blocked

### State Transitions
```
IDLE → (Space Down) → AWAITING_PAN
AWAITING_PAN → (Mouse Down) → PANNING
PANNING → (Mouse Up + Space Held) → AWAITING_PAN
PANNING → (Mouse Up + Space Released) → IDLE
AWAITING_PAN → (Space Up) → IDLE
```

## Integration Example

```typescript
import { useCanvasStateMachine } from './hooks/useCanvasStateMachine';
import { useSimplePan } from './hooks/useSimplePan';
import { useComprehensiveKeyboard } from './hooks/useComprehensiveKeyboard';

const DrawingCanvas = () => {
  // Replace old state management with state machine
  const stateMachine = useCanvasStateMachine();
  const pan = useSimplePan({ scale: canvas?.zoom || 1 });
  
  // Track previous state for transitions
  const prevStateRef = useRef(stateMachine.state);
  
  // Wire up keyboard to state machine
  useComprehensiveKeyboard({
    onSpacePressed: () => {
      stateMachine.dispatch({ type: 'SPACE_DOWN' });
    },
    onSpaceReleased: () => {
      stateMachine.dispatch({ type: 'SPACE_UP' });
    },
    // ... other keyboard handlers
  });
  
  // Handle mouse events
  const handleMouseDown = (event: React.MouseEvent) => {
    const pos = getMousePos(event);
    stateMachine.dispatch({ 
      type: 'MOUSE_DOWN', 
      button: event.button,
      position: pos,
      tool: tools.currentTool 
    });
  };
  
  const handleMouseMove = (event: React.MouseEvent) => {
    const pos = getMousePos(event);
    stateMachine.dispatch({ 
      type: 'MOUSE_MOVE',
      position: pos 
    });
  };
  
  const handleMouseUp = (event: React.MouseEvent) => {
    const pos = getMousePos(event);
    stateMachine.dispatch({ 
      type: 'MOUSE_UP',
      position: pos 
    });
  };
  
  // Handle state transitions and side effects
  useEffect(() => {
    const prevState = prevStateRef.current;
    const currentState = stateMachine.state;
    
    // Handle panning transitions
    if (currentState.mode === 'PANNING' && prevState.mode !== 'PANNING') {
      // Just entered panning mode
      if (currentState.lastPosition) {
        pan.startPan(currentState.lastPosition.x, currentState.lastPosition.y);
      }
    } else if (currentState.mode === 'PANNING' && currentState.lastPosition) {
      // Update pan while in panning mode
      pan.updatePan(currentState.lastPosition.x, currentState.lastPosition.y);
    } else if (currentState.mode !== 'PANNING' && prevState.mode === 'PANNING') {
      // Just exited panning mode
      pan.endPan();
    }
    
    // Handle drawing transitions
    if (currentState.mode === 'DRAWING' && prevState.mode !== 'DRAWING') {
      // Start drawing
      if (currentState.drawingStartPosition) {
        const worldPos = pan.screenToWorld(
          currentState.drawingStartPosition.x,
          currentState.drawingStartPosition.y,
          canvas?.zoom || 1
        );
        drawingHandlers.startDrawing(worldPos);
      }
    }
    
    // Handle finalization
    if (currentState.mode === 'FINALIZING' && prevState.mode !== 'FINALIZING') {
      // Start finalization
      drawingHandlers.finalizeDrawing().then(() => {
        stateMachine.finalizationComplete();
      });
    }
    
    prevStateRef.current = currentState;
  }, [stateMachine.state, pan, drawingHandlers, canvas?.zoom]);
  
  // Determine cursor based on state
  const cursorStyle = useMemo(() => {
    switch (stateMachine.state.mode) {
      case 'AWAITING_PAN':
        return 'grab';
      case 'PANNING':
        return 'grabbing';
      case 'DRAWING':
        return 'none'; // Show brush cursor
      default:
        return defaultCursorStyle;
    }
  }, [stateMachine.state.mode, defaultCursorStyle]);
  
  // Update view transform with pan offset
  useEffect(() => {
    viewTransformRef.current = {
      offsetX: pan.panState.offsetX,
      offsetY: pan.panState.offsetY,
      scale: canvas?.zoom || 1
    };
  }, [pan.panState.offsetX, pan.panState.offsetY, canvas?.zoom]);
  
  return (
    <div style={{ cursor: cursorStyle }}>
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => stateMachine.dispatch({ type: 'MOUSE_LEAVE' })}
      />
      {/* Debug info */}
      <div style={{ position: 'absolute', top: 10, left: 10 }}>
        Mode: {stateMachine.state.mode}
      </div>
    </div>
  );
};
```

## Benefits of This Approach

1. **No Race Conditions**: Single source of truth for all interaction states
2. **Predictable Behavior**: Clear state transitions prevent edge cases
3. **Proper Panning**: AWAITING_PAN state replicates Figma's UX perfectly
4. **Easy to Debug**: Can log state transitions and see exactly what's happening
5. **Maintainable**: Adding new features is just adding new states and transitions

## Migration Steps

1. Replace `isSpacePressed.current`, `isBusyRef.current`, `isMouseDownRef.current` with state machine
2. Replace `useCanvasInteraction` with `useCanvasStateMachine`
3. Update event handlers to dispatch actions
4. Move side effects (pan updates, drawing) to useEffect watching state changes
5. Update cursor logic to use state machine mode

## Testing Scenarios

1. **Spacebar + Click**: Should pan, not draw
2. **Draw then Space**: Should finalize drawing, then allow pan
3. **Space Hold + Release**: Should show grab cursor, then return to normal
4. **Pan + Mouse Leave**: Should continue panning when mouse re-enters
5. **Busy State**: Should block all interactions until complete