import { finalizeStrokeOrchestrated } from '../strokeFinalizeOrchestrator';
import {
  buildStrokeFinalizeContext,
  finalizeStrokeAfterEngine,
  finalizeStrokeEngineBuffers,
} from '../strokeFinalizeController';

jest.mock('../strokeFinalizeController', () => ({
  buildStrokeFinalizeContext: jest.fn(),
  finalizeStrokeEngineBuffers: jest.fn(),
  finalizeStrokeAfterEngine: jest.fn(),
}));

describe('strokeFinalizeOrchestrator', () => {
  it('runs finalize pipeline and returns finalize result', () => {
    const ctx = {} as CanvasRenderingContext2D;
    const finalizeResult = { x: 1, y: 2, width: 3, height: 4 };

    (buildStrokeFinalizeContext as jest.Mock).mockReturnValue({
      strokeBounds: finalizeResult,
      region: finalizeResult,
      rawCanvas: null,
      ditherCanvas: null,
      rawCtx: null,
      ditherCtx: null,
    });
    (finalizeStrokeAfterEngine as jest.Mock).mockReturnValue(finalizeResult);

    const result = finalizeStrokeOrchestrated({
      ctx,
      strokeBoundsRef: { current: finalizeResult },
      liveStrokeBoundsRef: { current: null },
      liveStrokeRawRef: { current: null },
      liveStrokeDitherRef: { current: null },
      clearLiveStrokeBuffers: jest.fn(),
      clearCoverageMaps: jest.fn(),
      brushEngine: { finalizeStroke: jest.fn() },
      withAlphaLock: jest.fn(),
      shouldApplyStrokeDither: true,
      lostEdge: 1,
      ditherBackgroundFill: true,
      pressureLinkedFillResolution: false,
      applyLostEdgeMaskInRegion: jest.fn(),
      committedPixelSizeRef: { current: null },
      lastPressureDitherPixelSizeRef: { current: null },
      getStrokeDitherPixelSize: jest.fn(() => 1),
      ditherRegionWithCurrentPressure: jest.fn(),
      applyStrokeDither: jest.fn(),
      isPixelDitherNoBg: false,
      applyStrokeRisographOverlay: jest.fn(),
      isDitherStrokeBrush: false,
      warnIfDitherStrokePath: jest.fn(),
    });

    expect(buildStrokeFinalizeContext).toHaveBeenCalled();
    expect(finalizeStrokeEngineBuffers).toHaveBeenCalled();
    expect(finalizeStrokeAfterEngine).toHaveBeenCalled();
    expect(result).toEqual(finalizeResult);
  });
});
