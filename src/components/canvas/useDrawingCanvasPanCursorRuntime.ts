import { useRef } from 'react';
import { useDrawingCanvasPanSync } from './useDrawingCanvasPanSync';
import { useDrawingCanvasViewScaleSync } from './useDrawingCanvasViewScaleSync';
import type { Tool } from '@/types';
import type { SimplePan } from '@/hooks/useSimplePan';

interface UseDrawingCanvasPanCursorRuntimeOptions {
  pan: SimplePan;
  canvasZoom: number;
  canvasOffsetX: number;
  canvasOffsetY: number;
  setCanvasOffset: (x: number, y: number) => void;
  currentTool: Tool;
}

export const useDrawingCanvasPanCursorRuntime = ({
  pan,
  canvasZoom,
  canvasOffsetX,
  canvasOffsetY,
  setCanvasOffset,
  currentTool,
}: UseDrawingCanvasPanCursorRuntimeOptions) => {
  const viewTransformRef = useRef({
    scale: canvasZoom || 1,
    offsetX: canvasOffsetX,
    offsetY: canvasOffsetY,
  });

  useDrawingCanvasPanSync({
    canvasOffsetX,
    canvasOffsetY,
    getPanState: pan.getState,
    setPan: pan.setPan,
    subscribeToPan: pan.subscribe,
    setCanvasOffset,
    viewTransformRef,
  });

  const isSpacePressedRef = useRef(false);
  const suppressBootstrapUntilPointerUpRef = useRef(false);

  const previousToolRef = useRef<Tool | null>(currentTool);
  const lastStateMachineToolRef = useRef<Tool | null>(currentTool);

  useDrawingCanvasViewScaleSync({
    viewTransformRef,
    canvasZoom,
  });

  return {
    viewTransformRef,
    isSpacePressedRef,
    suppressBootstrapUntilPointerUpRef,
    previousToolRef,
    lastStateMachineToolRef,
  };
};
