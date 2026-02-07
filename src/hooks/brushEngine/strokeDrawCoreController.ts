import type { BrushStrokeParams, CustomBrushStrokeData } from './BrushEngineFacade';
import { executeStrokeRenderStep } from './strokeRenderStep';

import type { Rect } from './engineShared';

type RunStrokeDrawCoreArgs = {
  ctx: CanvasRenderingContext2D;
  from: { x: number; y: number };
  to: { x: number; y: number };
  rawPressure: number;
  customBrushData?: CustomBrushStrokeData;
  sampleTag: { x: number; y: number; tag: string };
  enableLargeRegionFallback: boolean;
  makeStrokeParams: (smoothedPressure: number) => BrushStrokeParams;
  resolveStrokePressureForRender: (rawPressure: number, nowHighRes: number) => number;
  estimateStrokeBounds: (
    from: { x: number; y: number },
    to: { x: number; y: number },
    pressure?: number,
    customBrushData?: Pick<CustomBrushStrokeData, 'width' | 'height' | 'isResampler'>
  ) => Rect;
  getLiveStrokeRawCtx: (ctx: CanvasRenderingContext2D) => CanvasRenderingContext2D | null;
  trackLiveStrokeSegment: (segmentBounds: Rect) => void;
  renderBrushStrokeToRaw: (rawCtx: CanvasRenderingContext2D, params: BrushStrokeParams) => void;
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
    scheduleLiveStrokeRender: (visibleCtx: CanvasRenderingContext2D) => void;
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
  scheduleLiveStrokeRender: (visibleCtx: CanvasRenderingContext2D) => void;
  getNowHighRes?: () => number;
};

export const runStrokeDrawCore = ({
  ctx,
  from,
  to,
  rawPressure,
  customBrushData,
  sampleTag,
  enableLargeRegionFallback,
  makeStrokeParams,
  resolveStrokePressureForRender,
  estimateStrokeBounds,
  getLiveStrokeRawCtx,
  trackLiveStrokeSegment,
  renderBrushStrokeToRaw,
  runStrokePostRenderPipeline,
  shouldApplyStrokeDither,
  lostEdge,
  pressureLinkedFillResolution,
  applyLostEdgeMaskInRegion,
  runLivePressureDitherForCurrentStroke,
  scheduleLiveStrokeRender,
  getNowHighRes,
}: RunStrokeDrawCoreArgs): void => {
  const nowHighRes = getNowHighRes
    ? getNowHighRes()
    : (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const smoothedPressure = resolveStrokePressureForRender(rawPressure, nowHighRes);
  const segmentBounds = estimateStrokeBounds(from, to, smoothedPressure, customBrushData);
  const strokeParams = makeStrokeParams(smoothedPressure);

  executeStrokeRenderStep({
    ctx,
    strokeParams,
    segmentBounds,
    sampleTag,
    getLiveStrokeRawContext: getLiveStrokeRawCtx,
    updateLiveStrokeTracking: trackLiveStrokeSegment,
    renderBrushStroke: renderBrushStrokeToRaw,
    runStrokePostRenderPipeline,
    shouldApplyStrokeDither,
    lostEdge,
    pressureLinkedFillResolution,
    applyLostEdgeMaskInRegion,
    runLivePressureDitherForCurrentStroke,
    scheduleLiveStrokeRender,
    enableLargeRegionFallback,
  });
};
