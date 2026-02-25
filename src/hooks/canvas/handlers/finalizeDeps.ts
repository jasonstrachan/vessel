import type React from 'react';
import type { AppState } from '@/stores/useAppStore';
import type { CommitStrokeHistoryDeps } from '@/hooks/canvas/handlers/colorCycle/colorCycleStrokeHistory';
import type { CommitRasterOverlayOptions } from '@/hooks/canvas/handlers/colorCycle/colorCycleCommit';
import { createFinalizePostCommitDeps } from '@/hooks/canvas/handlers/finalizePostCommitDeps';
import { createFinalizeRasterFallbackDeps } from '@/hooks/canvas/handlers/finalizeRasterFallbackDeps';
import type { RunFinalizePostCommitDeps } from '@/hooks/canvas/handlers/finalizePostCommit';
import type { FinalizeRasterFallbackDeps } from '@/hooks/canvas/handlers/finalizeRasterFallback';

export const createFinalizeDeps = ({
  clearFinalizeOverlayIfNeeded,
  commitStrokeHistoryDeps,
  logError,
  drawingCtxRef,
  drawingCanvasRef,
  storeRef,
  shapePointsRef,
  commitRasterOverlay,
}: {
  clearFinalizeOverlayIfNeeded: RunFinalizePostCommitDeps['clearFinalizeOverlayIfNeeded'];
  commitStrokeHistoryDeps: CommitStrokeHistoryDeps;
  logError: (message: string) => void;
  drawingCtxRef: React.MutableRefObject<CanvasRenderingContext2D | null>;
  drawingCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  storeRef: React.MutableRefObject<AppState>;
  shapePointsRef: React.MutableRefObject<Array<{ x: number; y: number }>>;
  commitRasterOverlay: (args: CommitRasterOverlayOptions) => Promise<void>;
}): {
  finalizePostCommitDeps: RunFinalizePostCommitDeps;
  finalizeRasterFallbackDeps: FinalizeRasterFallbackDeps;
} => ({
  finalizePostCommitDeps: createFinalizePostCommitDeps({
    clearFinalizeOverlayIfNeeded,
    commitStrokeHistoryDeps,
  }),
  finalizeRasterFallbackDeps: createFinalizeRasterFallbackDeps({
    logError,
    drawingCtxRef,
    drawingCanvasRef,
    storeRef,
    shapePointsRef,
    commitRasterOverlay,
    isDev: process.env.NODE_ENV !== 'production',
  }),
});
