import type React from 'react';
import { useComprehensiveKeyboard } from '@/hooks/useComprehensiveKeyboard';
import { BrushShape, type Layer, type Tool } from '@/types';

interface UseDrawingCanvasKeyboardOptions {
  isSpacePressedRef: React.MutableRefObject<boolean>;
  setIsSpacePressed: React.Dispatch<React.SetStateAction<boolean>>;
  setShowBrushCursorRef: React.MutableRefObject<React.Dispatch<React.SetStateAction<boolean>>>;
  setCursorStyleRef: React.MutableRefObject<React.Dispatch<React.SetStateAction<string>>>;
  mousePositionRef: React.MutableRefObject<{ x: number; y: number }>;
  isMouseDownRef: React.MutableRefObject<boolean>;
  panRef: React.MutableRefObject<{
    startPan: (x: number, y: number) => void;
    endPan: () => void;
    panState: { isPanning: boolean };
  }>;
  pauseAnimationForPan: () => void;
  defaultCursorStyle: string;
  resumeAnimationAfterPan: () => Promise<void> | void;
  switchTool: (tool: Tool) => Promise<void> | void;
  saveProject: () => Promise<unknown>;
  openProjectModal: () => void;
  canUndo: () => boolean | Promise<boolean>;
  canRedo: () => boolean | Promise<boolean>;
  undo: () => Promise<unknown>;
  redo: () => Promise<unknown>;
  toolStateMachine: {
    completePolygonGradient: () => boolean;
    polygonGradientState: {
      points: Array<{ x: number; y: number; color: string }>;
    };
    isContourPolygon: boolean;
    resetPolygonGradient: () => void;
  };
  drawingHandlers: {
    initDrawingCanvas: () => void;
    drawingCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
    drawingCanvasHasContent: React.MutableRefObject<boolean>;
    finalizeDrawing: () => Promise<void>;
  };
  brushEngine: {
    resetColorCycle: (resetGradient?: boolean) => void;
    fillCcGradientConcentric: (points: Array<{ x: number; y: number }>) => Promise<void>;
    renderColorCycle: (ctx: CanvasRenderingContext2D, toLayerCanvas?: boolean) => void;
    drawContourPolygon: (
      ctx: CanvasRenderingContext2D,
      polygon: { vertices: Array<{ x: number; y: number }>; fillColor?: string },
      toLayerCanvas?: boolean,
      options?: { strokeColorOverride?: string }
    ) => void;
    drawPolygonGradient: (
      ctx: CanvasRenderingContext2D,
      polygon: { vertices: Array<{ x: number; y: number }>; colors: string[] },
      toLayerCanvas?: boolean
    ) => void;
  } | null;
  layers: Layer[];
  activeLayerId: string | null;
  tools: {
    currentTool: Tool;
    brushSettings: {
      brushShape?: BrushShape;
    };
    shapeMode: boolean;
  };
  isColorCyclePlaybackActive: () => boolean | Promise<boolean>;
  wrappedStartAnimation: () => void;
  compositeCanvasDirtyRef: React.MutableRefObject<boolean>;
  rebuildStaticComposite: () => boolean | Promise<boolean>;
  stateMachine: {
    finalizationComplete: () => void;
  };
  setNeedsRedraw: React.Dispatch<React.SetStateAction<number>>;
  cancelActiveOperations: (options: {
    includeFloatingPaste: boolean;
    dispatchInteractionEnd: boolean;
  }) => boolean;
  interactionDispatch: (action: { type: 'DRAWING_END' }) => void;
  canvasShapeEditor: {
    active: boolean;
    draft: unknown;
  };
  commitCanvasShape: () => void;
  cancelCanvasShapeEdit: () => void;
  colorAdjustActive: boolean;
  applyColorAdjust: () => Promise<void>;
  crop: { marquee: unknown; commitInFlight: boolean };
  commitCrop: () => Promise<void>;
  finalizeActiveShape: () => Promise<boolean>;
  floatingPaste: unknown;
  commitFloatingPaste: () => Promise<void>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  draw: (
    ctx: CanvasRenderingContext2D,
    transform: { scale: number; offsetX: number; offsetY: number },
    skipDrawingCanvas?: boolean
  ) => void;
  viewTransformRef: React.MutableRefObject<{ scale: number; offsetX: number; offsetY: number }>;
  cancelColorAdjust: () => void;
  previousTool: Tool | null | undefined;
  cancelCrop: () => void;
}

export const useDrawingCanvasKeyboard = ({
  isSpacePressedRef,
  setIsSpacePressed,
  setShowBrushCursorRef,
  setCursorStyleRef,
  mousePositionRef,
  isMouseDownRef,
  panRef,
  pauseAnimationForPan,
  defaultCursorStyle,
  resumeAnimationAfterPan,
  switchTool,
  saveProject,
  openProjectModal,
  canUndo,
  canRedo,
  undo,
  redo,
  toolStateMachine,
  drawingHandlers,
  brushEngine,
  layers,
  activeLayerId,
  tools,
  isColorCyclePlaybackActive,
  wrappedStartAnimation,
  compositeCanvasDirtyRef,
  rebuildStaticComposite,
  stateMachine,
  setNeedsRedraw,
  cancelActiveOperations,
  interactionDispatch,
  canvasShapeEditor,
  commitCanvasShape,
  cancelCanvasShapeEdit,
  colorAdjustActive,
  applyColorAdjust,
  crop,
  commitCrop,
  finalizeActiveShape,
  floatingPaste,
  commitFloatingPaste,
  canvasRef,
  draw,
  viewTransformRef,
  cancelColorAdjust,
  previousTool,
  cancelCrop,
}: UseDrawingCanvasKeyboardOptions) => {
  useComprehensiveKeyboard({
    onSpacePressed: () => {
      if (!isSpacePressedRef.current) {
        isSpacePressedRef.current = true;
        setIsSpacePressed(true);
        setShowBrushCursorRef.current(false);
        setCursorStyleRef.current('grab');
        const { x: pointerX, y: pointerY } = mousePositionRef.current;
        if (isMouseDownRef.current) {
          panRef.current.startPan(pointerX, pointerY);
          setCursorStyleRef.current('grabbing');
          pauseAnimationForPan();
        }
      }
    },
    onSpaceReleased: () => {
      if (isSpacePressedRef.current) {
        isSpacePressedRef.current = false;
        setIsSpacePressed(false);
        if (panRef.current.panState.isPanning) {
          panRef.current.endPan();
        }
        setCursorStyleRef.current(defaultCursorStyle);
        setShowBrushCursorRef.current(true);
        void resumeAnimationAfterPan();
      }
    },
    onSave: () => {
      void saveProject().catch(() => {});
    },
    onOpen: () => {
      openProjectModal();
    },
    onCustomTool: () => {
      void switchTool('custom');
    },
    onUndo: async () => {
      if (!(await canUndo())) {
        return;
      }
      await undo();
    },
    onRedo: async () => {
      if (!(await canRedo())) {
        return;
      }
      await redo();
    },
    onPolygonComplete: async () => {
      if (toolStateMachine.completePolygonGradient()) {
        drawingHandlers.initDrawingCanvas();
        const drawCtx = drawingHandlers.drawingCanvasRef.current?.getContext('2d', {
          willReadFrequently: true,
        });

        if (drawCtx && brushEngine) {
          const activeLayer = layers.find((l) => l.id === activeLayerId);
          const isColorCycleLayer = activeLayer?.layerType === 'color-cycle';

          if (isColorCycleLayer && tools.shapeMode) {
            brushEngine.resetColorCycle(true);
            const points = toolStateMachine.polygonGradientState.points.map((p) => ({ x: p.x, y: p.y }));
            await brushEngine.fillCcGradientConcentric(points);
            drawCtx.clearRect(0, 0, drawCtx.canvas.width, drawCtx.canvas.height);
            brushEngine.renderColorCycle(drawCtx, false);
          } else if (toolStateMachine.isContourPolygon) {
            const sampledStrokeColor = toolStateMachine.polygonGradientState.points.find((p) => p.color)?.color;
            brushEngine.drawContourPolygon(
              drawCtx,
              {
                vertices: toolStateMachine.polygonGradientState.points.map((p) => ({ x: p.x, y: p.y })),
                fillColor: toolStateMachine.polygonGradientState.points[0]?.color,
              },
              false,
              sampledStrokeColor ? { strokeColorOverride: sampledStrokeColor } : undefined
            );
          } else if (toolStateMachine.polygonGradientState.points.length >= 3) {
            brushEngine.drawPolygonGradient(
              drawCtx,
              {
                vertices: toolStateMachine.polygonGradientState.points.map((p) => ({ x: p.x, y: p.y })),
                colors: toolStateMachine.polygonGradientState.points.map((p) => p.color),
              },
              false
            );
          }

          drawingHandlers.drawingCanvasHasContent.current = true;
          compositeCanvasDirtyRef.current = true;

          void drawingHandlers.finalizeDrawing().then(() => {
            void Promise.resolve(rebuildStaticComposite()).then((rebuilt) => {
              if (rebuilt) {
                compositeCanvasDirtyRef.current = false;
              }
              setNeedsRedraw((prev) => prev + 1);
              const shouldPlayColorCycle =
                tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE ||
                tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE_TRIANGLE;
              void Promise.resolve(isColorCyclePlaybackActive()).then((isActive) => {
                if (shouldPlayColorCycle && isActive) {
                  wrappedStartAnimation();
                }
              });
            });
          }).finally(() => {
            stateMachine.finalizationComplete();
          });
        }
        toolStateMachine.resetPolygonGradient();
      }
    },
    onPolygonCancel: () => {
      const cancelled = cancelActiveOperations({
        includeFloatingPaste: false,
        dispatchInteractionEnd: true,
      });
      if (!cancelled) {
        toolStateMachine.resetPolygonGradient();
        interactionDispatch({ type: 'DRAWING_END' });
      }
    },
    onEnterPressed: async () => {
      if (canvasShapeEditor.active) {
        if (canvasShapeEditor.draft) {
          commitCanvasShape();
        } else {
          cancelCanvasShapeEdit();
        }
        setNeedsRedraw((prev) => prev + 1);
        return;
      }

      if (tools.currentTool === 'color-adjust' && colorAdjustActive) {
        await applyColorAdjust();
        return;
      }

      if (tools.currentTool === 'crop') {
        if (crop.marquee && !crop.commitInFlight) {
          await commitCrop();
        }
        return;
      }

      if (await finalizeActiveShape()) {
        return;
      }

      if (floatingPaste) {
        await commitFloatingPaste();
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          draw(ctx, viewTransformRef.current);
        }
      }
    },
    onEscapePressed: () => {
      if (canvasShapeEditor.active) {
        cancelCanvasShapeEdit();
        setNeedsRedraw((prev) => prev + 1);
        return;
      }

      if (tools.currentTool === 'color-adjust' && colorAdjustActive) {
        cancelColorAdjust();
        const fallbackTool = (previousTool ?? 'brush') as Tool;
        const resolvedTool: Tool = fallbackTool === 'color-adjust' ? 'brush' : fallbackTool;
        void switchTool(resolvedTool);
        return;
      }

      if (tools.currentTool === 'crop') {
        cancelCrop();
        return;
      }

      const cancelled = cancelActiveOperations({
        includeFloatingPaste: true,
        dispatchInteractionEnd: true,
      });

      if (cancelled) {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          draw(ctx, viewTransformRef.current);
        }
      }
    },
    enabled: true,
  });
};
