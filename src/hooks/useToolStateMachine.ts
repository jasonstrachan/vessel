import { useCallback, useRef } from 'react';
import { useAppStore } from '../stores/useAppStore';
import { BrushShape } from '../types';

interface ToolStateMachineProps {
  sampleColorAtPosition: (x: number, y: number) => string;
}

export function useToolStateMachine({ 
  sampleColorAtPosition
}: ToolStateMachineProps) {
  const {
    tools,
    rectangleBrushState,
    setRectangleBrushState,
    polygonGradientState,
    setPolygonGradientState,
  } = useAppStore();
  
  // Rectangle gradient state machine
  const handleRectangleGradientMouseDown = useCallback((worldPos: { x: number; y: number }) => {
    const currentState = useAppStore.getState().rectangleBrushState;
    
    // If defining width, this click finalizes the width
    if (currentState.drawingState === 'definingWidth') {
      return 'finalize'; // Special return value to indicate we should finalize
    }
    
    // Start defining length
    const startColor = sampleColorAtPosition(worldPos.x, worldPos.y);
    setRectangleBrushState({
      drawingState: 'definingLength',
      startPos: { x: worldPos.x, y: worldPos.y },
      endPos: { x: worldPos.x, y: worldPos.y },
      startColor: startColor
    });
    
    return true; // Proceed with drawing state
  }, [sampleColorAtPosition, setRectangleBrushState]);
  
  // Ref to store the end position without triggering re-renders
  const tempEndPosRef = useRef({ x: 0, y: 0 });
  
  const handleRectangleGradientMouseMove = useCallback((worldPos: { x: number; y: number }) => {
    const currentState = useAppStore.getState().rectangleBrushState;
    
    if (currentState.drawingState === 'definingLength') {
      // Store in ref to avoid re-renders - we'll update state on mouse up
      tempEndPosRef.current = { x: worldPos.x, y: worldPos.y };
      // Still update state but less frequently - only if moved significantly
      const dx = worldPos.x - currentState.endPos.x;
      const dy = worldPos.y - currentState.endPos.y;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
        setRectangleBrushState({
          ...currentState,
          endPos: { x: worldPos.x, y: worldPos.y }
        });
      }
      return 'length'; // Return preview type
    } else if (currentState.drawingState === 'definingWidth') {
      // Don't update state, just return for preview
      return 'width'; // Return preview type
    }
    
    return null;
  }, [setRectangleBrushState]);
  
  const handleRectangleGradientMouseUp = useCallback(() => {
    const currentState = useAppStore.getState().rectangleBrushState;
    
    if (currentState.drawingState === 'definingLength') {
      // Use the final position from the ref
      const finalEndPos = tempEndPosRef.current;
      // Transition to defining width with final position
      setRectangleBrushState({
        ...currentState,
        endPos: finalEndPos,
        drawingState: 'definingWidth'
      });
      return false; // Don't finalize yet
    } else if (currentState.drawingState === 'definingWidth') {
      // Ready to draw
      return true; // Finalize drawing
    }
    
    return false;
  }, [setRectangleBrushState]);
  
  const resetRectangleGradient = useCallback(() => {
    setRectangleBrushState({
      drawingState: 'idle',
      startPos: { x: 0, y: 0 },
      endPos: { x: 0, y: 0 }
    });
  }, [setRectangleBrushState]);
  
  // Polygon gradient state machine
  const handlePolygonGradientMouseDown = useCallback((worldPos: { x: number; y: number }) => {
    const startColor = sampleColorAtPosition(worldPos.x, worldPos.y);
    
    setPolygonGradientState({
      drawingState: 'drawing',
      points: [{
        x: worldPos.x,
        y: worldPos.y,
        color: startColor
      }]
    });
    
    return true; // Proceed with drawing state
  }, [sampleColorAtPosition, setPolygonGradientState]);
  
  const handlePolygonGradientMouseMove = useCallback((worldPos: { x: number; y: number }) => {
    const currentState = useAppStore.getState().polygonGradientState;
    
    if (currentState.drawingState === 'drawing') {
      const lastPoint = currentState.points[currentState.points.length - 1];
      if (lastPoint) {
        const distance = Math.hypot(worldPos.x - lastPoint.x, worldPos.y - lastPoint.y);
        const minSpacing = 5;
        
        if (distance >= minSpacing) {
          const newColor = sampleColorAtPosition(worldPos.x, worldPos.y);
          const newPoints = [...currentState.points, {
            x: worldPos.x,
            y: worldPos.y,
            color: newColor
          }];
          
          setPolygonGradientState({
            drawingState: 'drawing',
            points: newPoints
          });
        }
      }
      return true; // Drawing in progress
    }
    
    return false;
  }, [sampleColorAtPosition, setPolygonGradientState]);
  
  const handlePolygonGradientMouseUp = useCallback(() => {
    const currentState = useAppStore.getState().polygonGradientState;
    return currentState.points.length >= 3; // Can finalize if we have at least 3 points
  }, []);
  
  const resetPolygonGradient = useCallback(() => {
    setPolygonGradientState({
      drawingState: 'idle',
      points: []
    });
  }, [setPolygonGradientState]);
  
  const completePolygonGradient = useCallback(() => {
    const currentState = useAppStore.getState().polygonGradientState;
    if (currentState.points.length >= 3) {
      return true; // Ready to draw
    }
    return false;
  }, []);
  
  // Check which tool is active
  const isRectangleGradient = tools.brushSettings.brushShape === BrushShape.RECTANGLE_GRADIENT;
  const isPolygonGradient = tools.brushSettings.brushShape === BrushShape.POLYGON_GRADIENT;
  
  return {
    // Rectangle gradient
    isRectangleGradient,
    rectangleBrushState,
    handleRectangleGradientMouseDown,
    handleRectangleGradientMouseMove,
    handleRectangleGradientMouseUp,
    resetRectangleGradient,
    
    // Polygon gradient
    isPolygonGradient,
    polygonGradientState,
    handlePolygonGradientMouseDown,
    handlePolygonGradientMouseMove,
    handlePolygonGradientMouseUp,
    resetPolygonGradient,
    completePolygonGradient,
  };
}