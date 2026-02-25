import { useCallback } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import { computeShapeFillColors } from '@/shapeFill/colorUtils';
import { FillStage } from '@/shapeFill/types';
import { snapPointToPixel } from '@/utils/pixelSharp';
import { applyLostEdgeErosionToContext } from '@/shapeFill/lostEdgeErosion';

const LOST_EDGE_TILE_SIZE = 4;

interface ShapePointLike {
  x: number;
  y: number;
}

interface DrawingHandlersLike {
  initDrawingCanvas: () => void;
  drawingCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  drawingCanvasHasContent: React.MutableRefObject<boolean>;
  finalizeDrawing: (skipHistory: boolean) => Promise<void>;
  isDrawingShapeRef: React.MutableRefObject<boolean>;
  finalizeShapeDrawing: () => Promise<void>;
}

interface UseDrawingCanvasFinalizeActiveShapeOptions {
  finalizeRectangleGradientFromState: () => Promise<boolean>;
  drawingHandlers: DrawingHandlersLike;
  sampleColorAtPosition: (x: number, y: number) => string;
  stateMachine: { finalizationComplete: () => void };
  overlayCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  rebuildStaticComposite: () => boolean | Promise<boolean>;
  compositeCanvasDirtyRef: React.MutableRefObject<boolean>;
  setNeedsRedraw: React.Dispatch<React.SetStateAction<number>>;
  interactionDispatch: (action: { type: 'DRAWING_END' }) => void;
  tools: { shapeMode: boolean };
}

export const useDrawingCanvasFinalizeActiveShape = ({
  finalizeRectangleGradientFromState,
  drawingHandlers,
  sampleColorAtPosition,
  stateMachine,
  overlayCanvasRef,
  rebuildStaticComposite,
  compositeCanvasDirtyRef,
  setNeedsRedraw,
  interactionDispatch,
  tools,
}: UseDrawingCanvasFinalizeActiveShapeOptions) =>
  useCallback(async (): Promise<boolean> => {
    const store = useAppStore.getState();

    if (store.rectangleBrushState.drawingState !== 'idle') {
      return finalizeRectangleGradientFromState();
    }

    if (store.shapeFill.session) {
      if (store.shapeFill.session.stage === FillStage.AdjustingParam) {
        store.commitShapeFillParameter();
      }

      const payload = useAppStore.getState().finalizeShapeFillSession();
      if (payload) {
        if (!drawingHandlers.drawingCanvasRef.current) {
          drawingHandlers.initDrawingCanvas();
        }

        const canvas = drawingHandlers.drawingCanvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (canvas && ctx) {
          const storeSnapshot = useAppStore.getState();
          const colors = computeShapeFillColors({
            points: payload.shape.points as ShapePointLike[],
            palette: storeSnapshot.palette,
            brushColor: storeSnapshot.tools.brushSettings.color,
            sampleUnderShape: storeSnapshot.shapeFill.sampleUnderShape,
            useBackgroundColor: storeSnapshot.shapeFill.useBackgroundColor,
            sampleColorAtPosition,
            fallbackBackground: storeSnapshot.project?.backgroundColor,
          });
          const pixelPerfect = storeSnapshot.shapeFill.pixelPerfectMode;

          const primaryColor =
            colors.primary === 'background' && colors.background
              ? colors.background
              : colors.foreground;
          const secondaryColor =
            colors.primary === 'background' ? colors.foreground : colors.background;

          payload.params = {
            ...payload.params,
            fillColor: primaryColor,
          };
          if (secondaryColor) {
            payload.params.backgroundColor = secondaryColor;
          } else if ('backgroundColor' in payload.params) {
            delete (payload.params as { backgroundColor?: string }).backgroundColor;
          }

          const renderPolygon = pixelPerfect
            ? payload.shape.points.map((point) => snapPointToPixel(point, { strategy: 'nearest' }))
            : payload.shape.points;
          const byFill = (storeSnapshot.shapeFill.paramsByFill as Record<string, Partial<typeof payload.params>>)[
            payload.fillId
          ] ?? {};

          const sessionParams = storeSnapshot.shapeFill.session?.params ?? {};
          const uiLostEdge = sessionParams.lostEdge ?? byFill.lostEdge;
          const perFillEdge = byFill.lostEdge;
          const payloadEdge = payload.params.lostEdge;

          const rawLostEdge = uiLostEdge ?? perFillEdge ?? payloadEdge ?? 0;
          const lostEdge = Math.max(0, Math.min(100, rawLostEdge));

          if (process.env.NODE_ENV !== 'production') {
            console.log('[shapeFill] lostEdge', {
              uiLostEdge,
              perFillEdge,
              payloadEdge,
              rawLostEdge,
              lostEdge,
            });
          }

          if (lostEdge > 0) {
            const bounds = payload.shape.bounds;
            const padding = Math.max(
              4,
              Math.ceil((payload.params.thickness ?? 1) * 2 + (payload.params.spacing ?? 0))
            );

            applyLostEdgeErosionToContext(ctx, renderPolygon, bounds, padding, lostEdge, LOST_EDGE_TILE_SIZE);
          }

          drawingHandlers.drawingCanvasHasContent.current = true;
          try {
            await drawingHandlers.finalizeDrawing(false);
          } finally {
            stateMachine.finalizationComplete();
          }

          const overlayCanvas = overlayCanvasRef.current;
          overlayCanvas?.getContext('2d')?.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

          useAppStore.getState().cancelShapeFillSession();

          if (rebuildStaticComposite()) {
            compositeCanvasDirtyRef.current = false;
          }

          setNeedsRedraw((prev) => prev + 1);
          interactionDispatch({ type: 'DRAWING_END' });
          return true;
        }
      }
      return true;
    }

    if (tools.shapeMode && drawingHandlers.isDrawingShapeRef.current) {
      try {
        await drawingHandlers.finalizeShapeDrawing();
      } finally {
        stateMachine.finalizationComplete();
      }

      if (rebuildStaticComposite()) {
        compositeCanvasDirtyRef.current = false;
      }

      setNeedsRedraw((prev) => prev + 1);
      interactionDispatch({ type: 'DRAWING_END' });
      return true;
    }

    return false;
  }, [
    compositeCanvasDirtyRef,
    drawingHandlers,
    finalizeRectangleGradientFromState,
    interactionDispatch,
    overlayCanvasRef,
    rebuildStaticComposite,
    sampleColorAtPosition,
    setNeedsRedraw,
    stateMachine,
    tools.shapeMode,
  ]);
