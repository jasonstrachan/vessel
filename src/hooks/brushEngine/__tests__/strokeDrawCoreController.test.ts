import { runStrokeDrawCore } from '../strokeDrawCoreController';
import { executeStrokeRenderStep } from '../strokeRenderStep';
import type { BrushStrokeParams } from '../BrushEngineFacade';

jest.mock('../strokeRenderStep', () => ({
  executeStrokeRenderStep: jest.fn(),
}));

describe('strokeDrawCoreController', () => {
  it('resolves pressure, estimates bounds, and forwards args to executeStrokeRenderStep', () => {
    const ctx = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D;
    const segmentBounds = { x: 1, y: 2, width: 30, height: 40 };
    const strokeParams: BrushStrokeParams = {
      from: { x: 10, y: 20 },
      to: { x: 15, y: 25 },
      pressure: 0.7,
      velocity: 1,
      timestamp: 123,
    };

    const resolveStrokePressureForRender = jest.fn(() => 0.7);
    const estimateStrokeBounds = jest.fn(() => segmentBounds);
    const makeStrokeParams = jest.fn(() => strokeParams);
    const getLiveStrokeRawCtx = jest.fn(() => null);
    const trackLiveStrokeSegment = jest.fn();
    const renderBrushStrokeToRaw = jest.fn();
    const runStrokePostRenderPipeline = jest.fn();
    const applyLostEdgeMaskInRegion = jest.fn();
    const runLivePressureDitherForCurrentStroke = jest.fn();
    const scheduleLiveStrokeRender = jest.fn();

    runStrokeDrawCore({
      ctx,
      from: { x: 10, y: 20 },
      to: { x: 15, y: 25 },
      rawPressure: 0.5,
      sampleTag: { x: 12, y: 22, tag: 'test' },
      enableLargeRegionFallback: true,
      makeStrokeParams,
      resolveStrokePressureForRender,
      estimateStrokeBounds,
      getLiveStrokeRawCtx,
      trackLiveStrokeSegment,
      renderBrushStrokeToRaw,
      runStrokePostRenderPipeline,
      shouldApplyStrokeDither: true,
      lostEdge: 12,
      pressureLinkedFillResolution: true,
      applyLostEdgeMaskInRegion,
      runLivePressureDitherForCurrentStroke,
      scheduleLiveStrokeRender,
      getNowHighRes: () => 999,
    });

    expect(resolveStrokePressureForRender).toHaveBeenCalledWith(0.5, 999);
    expect(estimateStrokeBounds).toHaveBeenCalledWith({ x: 10, y: 20 }, { x: 15, y: 25 }, 0.7, undefined);
    expect(makeStrokeParams).toHaveBeenCalledWith(0.7);
    expect(executeStrokeRenderStep).toHaveBeenCalledWith(expect.objectContaining({
      ctx,
      strokeParams,
      segmentBounds,
      shouldApplyStrokeDither: true,
      lostEdge: 12,
      pressureLinkedFillResolution: true,
      applyLostEdgeMaskInRegion,
      runLivePressureDitherForCurrentStroke,
      scheduleLiveStrokeRender,
      enableLargeRegionFallback: true,
    }));
  });
});

