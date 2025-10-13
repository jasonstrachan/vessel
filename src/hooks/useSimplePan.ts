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
  const isPanningRef = useRef(false);

  const startPan = useCallback((x: number, y: number) => {
    panStartRef.current = { x, y };
    setPanState(prev => {
      panStartOffsetRef.current = { x: prev.offsetX, y: prev.offsetY };
      isPanningRef.current = true;
      return { ...prev, isPanning: true };
    });
  }, []);

  const updatePan = useCallback((currentX: number, currentY: number) => {
    if (!isPanningRef.current) {
      return;
    }

    const deltaX = currentX - panStartRef.current.x;
    const deltaY = currentY - panStartRef.current.y;
    const nextOffsetX = panStartOffsetRef.current.x + deltaX;
    const nextOffsetY = panStartOffsetRef.current.y + deltaY;

    setPanState(prev => {
      if (prev.offsetX === nextOffsetX && prev.offsetY === nextOffsetY && prev.isPanning) {
        return prev;
      }
      return {
        ...prev,
        offsetX: nextOffsetX,
        offsetY: nextOffsetY,
        isPanning: true
      };
    });
  }, []);

  const setPan = useCallback((offsetX: number, offsetY: number) => {
    setPanState(prev => {
      if (prev.offsetX === offsetX && prev.offsetY === offsetY) {
        return prev;
      }
      return { ...prev, offsetX, offsetY };
    });
  }, []);

  const endPan = useCallback(() => {
    isPanningRef.current = false;
    setPanState(prev => ({ ...prev, isPanning: false }));
  }, []);

  const resetPan = useCallback(() => {
    isPanningRef.current = false;
    setPanState({
      offsetX: 0,
      offsetY: 0,
      isPanning: false
    });
  }, []);

  const screenToWorld = useCallback(
    (x: number, y: number, currentScale: number = scale) => {
      return {
        x: (x - panState.offsetX) / currentScale,
        y: (y - panState.offsetY) / currentScale
      };
    },
    [panState.offsetX, panState.offsetY, scale]
  );

  const worldToScreen = useCallback(
    (x: number, y: number, currentScale: number = scale) => {
      return {
        x: x * currentScale + panState.offsetX,
        y: y * currentScale + panState.offsetY
      };
    },
    [panState.offsetX, panState.offsetY, scale]
  );

  return {
    panState,
    panStartRef,
    panStartOffsetRef,
    startPan,
    updatePan,
    setPan,
    endPan,
    resetPan,
    screenToWorld,
    worldToScreen
  };
}

export type SimplePan = ReturnType<typeof useSimplePan>;
