import { useState, useRef, useCallback } from 'react';

interface PanState {
  offsetX: number;
  offsetY: number;
  isPanning: boolean;
}

interface SimplePanOptions {
  scale?: number;
}

export function useSimplePan(options: SimplePanOptions = {}) {
  const { scale = 1 } = options;
  const [panState, setPanState] = useState<PanState>({
    offsetX: 0,
    offsetY: 0,
    isPanning: false
  });
  
  const panStartRef = useRef({ x: 0, y: 0 });
  const panStartOffsetRef = useRef({ x: 0, y: 0 });
  
  const startPan = useCallback((x: number, y: number) => {
    panStartRef.current = { x, y };
    panStartOffsetRef.current = { x: panState.offsetX, y: panState.offsetY };
    setPanState(prev => ({ ...prev, isPanning: true }));
  }, [panState.offsetX, panState.offsetY]);
  
  const updatePan = useCallback((currentX: number, currentY: number) => {
    if (!panState.isPanning) return;
    
    const deltaX = currentX - panStartRef.current.x;
    const deltaY = currentY - panStartRef.current.y;
    
    setPanState(prev => ({
      ...prev,
      offsetX: panStartOffsetRef.current.x + deltaX,
      offsetY: panStartOffsetRef.current.y + deltaY
    }));
  }, [panState.isPanning]);
  
  // Direct setter for wheel panning  
  const setPan = useCallback((offsetX: number, offsetY: number) => {
    setPanState(prev => ({ ...prev, offsetX, offsetY }));
  }, []);
  
  const endPan = useCallback(() => {
    setPanState(prev => ({ ...prev, isPanning: false }));
  }, []);
  
  const resetPan = useCallback(() => {
    setPanState({
      offsetX: 0,
      offsetY: 0,
      isPanning: false
    });
  }, []);
  
  // Transform screen coordinates to world coordinates
  const screenToWorld = useCallback((x: number, y: number, currentScale: number = scale) => {
    return {
      x: (x - panState.offsetX) / currentScale,
      y: (y - panState.offsetY) / currentScale
    };
  }, [panState.offsetX, panState.offsetY, scale]);
  
  // Transform world coordinates to screen coordinates
  const worldToScreen = useCallback((x: number, y: number, currentScale: number = scale) => {
    return {
      x: x * currentScale + panState.offsetX,
      y: y * currentScale + panState.offsetY
    };
  }, [panState.offsetX, panState.offsetY, scale]);
  
  return {
    panState,
    startPan,
    updatePan,
    setPan,
    endPan,
    resetPan,
    screenToWorld,
    worldToScreen
  };
}