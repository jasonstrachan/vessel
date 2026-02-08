import type React from 'react';
import { useEffect } from 'react';
import type { Tool } from '@/types';

interface UseDrawingCanvasToolSyncOptions {
  currentTool: Tool;
  previousToolRef: React.MutableRefObject<Tool | null>;
  lastStateMachineToolRef: React.MutableRefObject<Tool | null>;
  setCanvasStateMachineTool: (tool: Tool) => void;
  defaultCursorStyle: string;
  isPointerInsideCanvas: () => boolean;
  setShowBrushCursor: React.Dispatch<React.SetStateAction<boolean>>;
  setCursorStyle: React.Dispatch<React.SetStateAction<string>>;
  cancelActiveOperations: (options: {
    includeFloatingPaste: boolean;
    dispatchInteractionEnd: boolean;
  }) => boolean;
  interactionDispatch: (action: { type: 'RESET' }) => void;
  forceCanvasIdle: () => void;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  draw: (
    ctx: CanvasRenderingContext2D,
    transform: { scale: number; offsetX: number; offsetY: number },
    skipDrawingCanvas?: boolean
  ) => void;
  viewTransformRef: React.MutableRefObject<{ scale: number; offsetX: number; offsetY: number }>;
}

export const useDrawingCanvasToolSync = ({
  currentTool,
  previousToolRef,
  lastStateMachineToolRef,
  setCanvasStateMachineTool,
  defaultCursorStyle,
  isPointerInsideCanvas,
  setShowBrushCursor,
  setCursorStyle,
  cancelActiveOperations,
  interactionDispatch,
  forceCanvasIdle,
  canvasRef,
  draw,
  viewTransformRef,
}: UseDrawingCanvasToolSyncOptions) => {
  useEffect(() => {
    if (lastStateMachineToolRef.current !== currentTool) {
      setCanvasStateMachineTool(currentTool);
      lastStateMachineToolRef.current = currentTool;
    }

    const previousTool = previousToolRef.current;
    if (previousTool && previousTool !== currentTool) {
      if (previousTool === 'color-picker' && currentTool !== 'color-picker') {
        setShowBrushCursor(isPointerInsideCanvas());
        setCursorStyle(defaultCursorStyle);
      }
      const cancelled = cancelActiveOperations({ includeFloatingPaste: false, dispatchInteractionEnd: false });
      interactionDispatch({ type: 'RESET' });
      forceCanvasIdle();

      if (cancelled) {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          draw(ctx, viewTransformRef.current);
        }
      }
    }

    previousToolRef.current = currentTool;
  }, [
    currentTool,
    previousToolRef,
    lastStateMachineToolRef,
    setCanvasStateMachineTool,
    defaultCursorStyle,
    isPointerInsideCanvas,
    setShowBrushCursor,
    setCursorStyle,
    cancelActiveOperations,
    interactionDispatch,
    forceCanvasIdle,
    canvasRef,
    draw,
    viewTransformRef,
  ]);
};
