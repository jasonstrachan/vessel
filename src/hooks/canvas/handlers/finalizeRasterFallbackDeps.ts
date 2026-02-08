import type { MutableRefObject } from 'react';
import type { AppState } from '@/stores/useAppStore';
import type { CommitRasterOverlayOptions } from '@/hooks/canvas/handlers/colorCycle/colorCycleCommit';
import { applyFinalizePolygonLostEdge } from '@/hooks/canvas/handlers/finalizeLostEdge';
import type { FinalizeRasterFallbackDeps } from '@/hooks/canvas/handlers/finalizeRasterFallback';

export const createFinalizeRasterFallbackDeps = ({
  logError,
  drawingCtxRef,
  drawingCanvasRef,
  storeRef,
  shapePointsRef,
  commitRasterOverlay,
  isDev,
}: {
  logError: (message: string) => void;
  drawingCtxRef: MutableRefObject<CanvasRenderingContext2D | null>;
  drawingCanvasRef: MutableRefObject<HTMLCanvasElement | null>;
  storeRef: MutableRefObject<AppState>;
  shapePointsRef: MutableRefObject<Array<{ x: number; y: number }>>;
  commitRasterOverlay: (args: CommitRasterOverlayOptions) => Promise<void>;
  isDev: boolean;
}): FinalizeRasterFallbackDeps => ({
  logError,
  applyFinalizePolygonLostEdge: ({ isColorCycleLayer, activeSettings, logDevStats }) =>
    applyFinalizePolygonLostEdge({
      isColorCycleLayer,
      drawingCtxRef,
      drawingCanvasRef,
      storeRef,
      activeSettings,
      shapePointsRef,
      logDevStats,
    }),
  commitRasterOverlay: (args) =>
    commitRasterOverlay({
      layer: args.layer,
      overlayCanvas: args.overlayCanvas,
      beforeImage: args.beforeImage,
      beforeColorState: args.beforeColorState,
      historyAction: args.historyAction,
      historyDescription: args.historyDescription,
      tool: args.tool,
      coalesce: args.coalesce as CommitRasterOverlayOptions['coalesce'],
      bitmapRoi: args.bitmapRoi,
      skipHistory: args.skipHistory,
      deferHistory: args.deferHistory,
    }),
  getOverlayCanvas: () => drawingCanvasRef.current ?? null,
  isDev,
});
