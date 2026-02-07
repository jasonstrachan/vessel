import type { BrushStrokeParams } from './BrushEngineFacade';
import type { Rect } from './engineShared';

export const executeStrokeRenderStep = ({
  ctx,
  strokeParams,
  segmentBounds,
  sampleTag,
  getLiveStrokeRawContext,
  updateLiveStrokeTracking,
  renderBrushStroke,
  runStrokePostRenderPipeline,
  shouldApplyStrokeDither,
  lostEdge,
  pressureLinkedFillResolution,
  applyLostEdgeMaskInRegion,
  runLivePressureDitherForCurrentStroke,
  scheduleLiveStrokeRender,
  enableLargeRegionFallback,
}: {
  ctx: CanvasRenderingContext2D;
  strokeParams: BrushStrokeParams;
  segmentBounds: Rect;
  sampleTag: { x: number; y: number; tag: string };
  getLiveStrokeRawContext: (ctx: CanvasRenderingContext2D) => CanvasRenderingContext2D | null;
  updateLiveStrokeTracking: (segmentBounds: Rect) => void;
  renderBrushStroke: (ctx: CanvasRenderingContext2D, params: BrushStrokeParams) => void;
  runStrokePostRenderPipeline: (args: {
    ctx: CanvasRenderingContext2D;
    rawCtx: CanvasRenderingContext2D;
    segmentBounds: Rect;
    shouldApplyStrokeDither: boolean;
    lostEdge: number | undefined;
    pressureLinkedFillResolution: boolean | undefined;
    applyLostEdgeMaskInRegion: (
      ctx: CanvasRenderingContext2D,
      region: Rect | null,
      lostEdgePercent?: number
    ) => void;
    runLivePressureDitherForCurrentStroke: (args: {
      rawCtx: CanvasRenderingContext2D;
      segmentBounds: Rect;
      enableLargeRegionFallback: boolean;
    }) => void;
    scheduleLiveStrokeRender: (ctx: CanvasRenderingContext2D) => void;
    enableLargeRegionFallback: boolean;
  }) => void;
  shouldApplyStrokeDither: boolean;
  lostEdge: number | undefined;
  pressureLinkedFillResolution: boolean | undefined;
  applyLostEdgeMaskInRegion: (
    ctx: CanvasRenderingContext2D,
    region: Rect | null,
    lostEdgePercent?: number
  ) => void;
  runLivePressureDitherForCurrentStroke: (args: {
    rawCtx: CanvasRenderingContext2D;
    segmentBounds: Rect;
    enableLargeRegionFallback: boolean;
  }) => void;
  scheduleLiveStrokeRender: (ctx: CanvasRenderingContext2D) => void;
  enableLargeRegionFallback: boolean;
}): void => {
  if (typeof window !== 'undefined') {
    window.__AL_sample = sampleTag;
  }

  const rawCtx = getLiveStrokeRawContext(ctx);
  if (!rawCtx) {
    return;
  }

  updateLiveStrokeTracking(segmentBounds);

  renderBrushStroke(rawCtx, strokeParams);

  runStrokePostRenderPipeline({
    ctx,
    rawCtx,
    segmentBounds,
    shouldApplyStrokeDither,
    lostEdge,
    pressureLinkedFillResolution,
    applyLostEdgeMaskInRegion,
    runLivePressureDitherForCurrentStroke,
    scheduleLiveStrokeRender,
    enableLargeRegionFallback,
  });
};
