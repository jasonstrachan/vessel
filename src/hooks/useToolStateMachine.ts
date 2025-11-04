import { useCallback, useRef } from 'react';
import { useAppStore } from '../stores/useAppStore';
import { BrushShape } from '../types';
import { parseCssColor } from '@/utils/color/parseCssColor';
import { selectPolygonGradientState, selectToolsState } from '@/stores/selectors/toolsSelectors';
import { useStoreSelectorRef } from './useStoreSelectorRef';

interface ToolStateMachineProps {
  sampleColorAtPosition: (x: number, y: number) => string;
}

const toOpaqueColorString = (color: string): string => {
  const parsed = parseCssColor(color);
  return `rgb(${parsed.r}, ${parsed.g}, ${parsed.b})`;
};

export function useToolStateMachine({ 
  sampleColorAtPosition
}: ToolStateMachineProps) {
  const tools = useAppStore(selectToolsState);
  const rectangleBrushState = useAppStore((state) => state.rectangleBrushState);
  const setRectangleBrushState = useAppStore((state) => state.setRectangleBrushState);
  const polygonGradientState = useAppStore(selectPolygonGradientState);
  const setPolygonGradientState = useAppStore((state) => state.setPolygonGradientState);
  const rectangleBrushStateRef = useStoreSelectorRef((state) => state.rectangleBrushState);
  const polygonGradientStateRef = useStoreSelectorRef(selectPolygonGradientState);
  const toolsRef = useStoreSelectorRef(selectToolsState);
  
  // Rectangle gradient state machine
  const handleRectangleGradientMouseDown = useCallback((worldPos: { x: number; y: number }) => {
    const currentState = rectangleBrushStateRef.current;
    
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
  }, [sampleColorAtPosition, setRectangleBrushState, rectangleBrushStateRef]);
  
  // Ref to store the end position without triggering re-renders
  const tempEndPosRef = useRef({ x: 0, y: 0 });
  
  const handleRectangleGradientMouseMove = useCallback((worldPos: { x: number; y: number }) => {
    const currentState = rectangleBrushStateRef.current;
    
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
  }, [setRectangleBrushState, rectangleBrushStateRef]);

  const handleRectangleGradientMouseUp = useCallback(() => {
    const currentState = rectangleBrushStateRef.current;
    
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
  }, [setRectangleBrushState, rectangleBrushStateRef]);
  
  const resetRectangleGradient = useCallback(() => {
    setRectangleBrushState({
      drawingState: 'idle',
      startPos: { x: 0, y: 0 },
      endPos: { x: 0, y: 0 }
    });
  }, [setRectangleBrushState]);

  const resolvePolygonPointColor = useCallback((worldPos: { x: number; y: number }) => {
    const brushSettings = toolsRef.current.brushSettings;
    if (brushSettings.brushShape === BrushShape.POLYGON_GRADIENT) {
      const sampled = sampleColorAtPosition(worldPos.x, worldPos.y);
      return toOpaqueColorString(sampled);
    }
    return brushSettings.color;
  }, [sampleColorAtPosition, toolsRef]);

  // Polygon gradient state machine
  const handlePolygonGradientMouseDown = useCallback((worldPos: { x: number; y: number }) => {
    const sampledColor = resolvePolygonPointColor(worldPos);
    
    setPolygonGradientState({
      drawingState: 'drawing',
      points: [{
        x: worldPos.x,
        y: worldPos.y,
        color: sampledColor
      }],
      vertices: undefined,
      fillColor: sampledColor,
      adjustmentStartPos: undefined,
      tempRotation: undefined,
      tempSpacing: undefined,
      mode: undefined,
      rotationReferenceAngle: undefined,
      rotationInitialRotation: undefined,
    });
    
    return true; // Proceed with drawing state
  }, [resolvePolygonPointColor, setPolygonGradientState]);
  
  const handlePolygonGradientMouseMove = useCallback((worldPos: { x: number; y: number }) => {
    const currentState = polygonGradientStateRef.current;
    
    if (currentState.drawingState === 'drawing') {
      const lastPoint = currentState.points[currentState.points.length - 1];
      if (lastPoint) {
        const distance = Math.hypot(worldPos.x - lastPoint.x, worldPos.y - lastPoint.y);
        const minSpacing = 5;
        
        if (distance >= minSpacing) {
          const sampledColor = resolvePolygonPointColor(worldPos);
          const newPoints = [...currentState.points, {
            x: worldPos.x,
            y: worldPos.y,
            color: sampledColor
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
  }, [resolvePolygonPointColor, setPolygonGradientState, polygonGradientStateRef]);
  
  const handlePolygonGradientMouseUp = useCallback(() => {
    const currentState = polygonGradientStateRef.current;
    return currentState.points.length >= 3; // Can finalize if we have at least 3 points
  }, [polygonGradientStateRef]);
  
  const resetPolygonGradient = useCallback(() => {
    setPolygonGradientState({
      drawingState: 'idle',
      points: [],
      vertices: undefined,
      fillColor: undefined,
      adjustmentStartPos: undefined,
      tempRotation: undefined,
      tempSpacing: undefined,
      tempSize: undefined,
      mode: undefined,
      rotationReferenceAngle: undefined,
      rotationInitialRotation: undefined,
      sizeReferenceDistance: undefined,
      sizeInitialSize: undefined,
    });
  }, [setPolygonGradientState]);
  
  const completePolygonGradient = useCallback(() => {
    const currentState = polygonGradientStateRef.current;
    if (currentState.points.length >= 3) {
      return true; // Ready to draw
    }
    return false;
  }, [polygonGradientStateRef]);
  
  // Check which tool is active
  const isRectangleGradient = tools.brushSettings.brushShape === BrushShape.RECTANGLE_GRADIENT;
  const isPolygonGradient = tools.brushSettings.brushShape === BrushShape.POLYGON_GRADIENT;
  const isColorCycleShape = tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE_SHAPE;
  const isContourPolygon =
    tools.brushSettings.brushShape === BrushShape.CONTOUR_POLYGON ||
    tools.brushSettings.brushShape === BrushShape.CONTOUR_LINES2;
  
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
    
    // Color cycle shape (uses same handlers as polygon gradient)
    isColorCycleShape,
    
    // Contour polygon (uses same handlers as polygon gradient)
    isContourPolygon,
  };
}

export type ToolStateMachine = ReturnType<typeof useToolStateMachine>;
