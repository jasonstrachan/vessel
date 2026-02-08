import type React from 'react';
import type { AppState } from '@/stores/useAppStore';
import type { BrushSettings } from '@/types';
import { applyFinalizePolygonLostEdge } from '@/hooks/canvas/handlers/finalizeLostEdge';

export type FinalizeLostEdgeDispatcher = {
  applyFinalizeLostEdge: (args: {
    isColorCycleLayer: boolean;
    activeSettings: BrushSettings;
    logDevStats?: boolean;
  }) => void;
};

export const createFinalizeLostEdgeDispatcher = ({
  drawingCtxRef,
  drawingCanvasRef,
  storeRef,
  shapePointsRef,
}: {
  drawingCtxRef: React.MutableRefObject<CanvasRenderingContext2D | null>;
  drawingCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  storeRef: React.MutableRefObject<AppState>;
  shapePointsRef: React.MutableRefObject<Array<{ x: number; y: number }>>;
}): FinalizeLostEdgeDispatcher => ({
  applyFinalizeLostEdge: ({
    isColorCycleLayer,
    activeSettings,
    logDevStats,
  }: {
    isColorCycleLayer: boolean;
    activeSettings: BrushSettings;
    logDevStats?: boolean;
  }): void =>
    applyFinalizePolygonLostEdge({
      isColorCycleLayer,
      drawingCtxRef,
      drawingCanvasRef,
      storeRef,
      activeSettings,
      shapePointsRef,
      logDevStats,
    }),
});
