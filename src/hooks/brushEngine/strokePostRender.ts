import { inflateRect, type Rect } from './engineShared';

export const runStrokePostRenderPipeline = ({
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
}: {
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
}): void => {
  if (!shouldApplyStrokeDither && lostEdge && lostEdge > 0) {
    const region = inflateRect(segmentBounds, 2);
    applyLostEdgeMaskInRegion(rawCtx, region, lostEdge);
  }

  if (pressureLinkedFillResolution && shouldApplyStrokeDither) {
    runLivePressureDitherForCurrentStroke({ rawCtx, segmentBounds, enableLargeRegionFallback });
  }

  scheduleLiveStrokeRender(ctx);
};
