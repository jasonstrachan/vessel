import type { StrokeBounds } from '@/hooks/useBrushEngineSimplified';
import type { Tool } from '@/types';

type UserBrushEngine = {
  isUserBrush: (brushId: string) => boolean;
  endStroke: () => void;
};

type BrushEngine = {
  finalizeStroke?: (ctx: CanvasRenderingContext2D) => StrokeBounds | null;
};

export type FinalizeStrokePrepArgs = {
  finalizeTool: Tool | 'eraser';
  isEraserV2: boolean;
  strokeBatchTimerRef: React.MutableRefObject<number | null>;
  lastDrawPosRef: React.MutableRefObject<{ x: number; y: number } | null>;
  resamplerBrushDataRef: React.MutableRefObject<unknown>;
  stampCounterRef: React.MutableRefObject<number>;
  drawingCtx: CanvasRenderingContext2D | null;
  currentBrushId?: string | null;
};

export type FinalizeStrokePrepDeps = {
  brushEngine: BrushEngine;
  userBrushEngine: UserBrushEngine;
  cancelAnimationFrame: (handle: number) => void;
};

export const finalizeStrokePrep = (
  args: FinalizeStrokePrepArgs,
  deps: FinalizeStrokePrepDeps
): StrokeBounds | null => {
  if (args.strokeBatchTimerRef.current) {
    deps.cancelAnimationFrame(args.strokeBatchTimerRef.current);
    args.strokeBatchTimerRef.current = null;
  }

  args.lastDrawPosRef.current = null;
  args.resamplerBrushDataRef.current = undefined;
  args.stampCounterRef.current = 0;

  let engineStrokeBounds: StrokeBounds | null = null;
  const shouldSkipEngineFinalize = args.isEraserV2 && args.finalizeTool === 'eraser';
  if (!shouldSkipEngineFinalize && deps.brushEngine.finalizeStroke && args.drawingCtx) {
    engineStrokeBounds = deps.brushEngine.finalizeStroke(args.drawingCtx);
  }

  if (args.currentBrushId && deps.userBrushEngine.isUserBrush(args.currentBrushId)) {
    deps.userBrushEngine.endStroke();
  }

  return engineStrokeBounds;
};
