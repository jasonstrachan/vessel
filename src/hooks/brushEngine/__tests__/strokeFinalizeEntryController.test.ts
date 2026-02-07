import { finalizeStrokeCurrent } from '../strokeFinalizeEntryController';
import { finalizeStrokeOrchestrated } from '../strokeFinalizeOrchestrator';

jest.mock('../strokeFinalizeOrchestrator', () => ({
  finalizeStrokeOrchestrated: jest.fn(),
}));

describe('strokeFinalizeEntryController', () => {
  it('forwards finalize args to orchestrator with settings mapping', () => {
    const ctx = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D;
    const resultRect = { x: 1, y: 2, width: 3, height: 4 };
    (finalizeStrokeOrchestrated as jest.Mock).mockReturnValue(resultRect);

    const result = finalizeStrokeCurrent({
      ctx,
      strokeBoundsRef: { current: null },
      liveStrokeBoundsRef: { current: null },
      liveStrokeRawRef: { current: null },
      liveStrokeDitherRef: { current: null },
      clearLiveStrokeBuffers: jest.fn(),
      clearCoverageMaps: jest.fn(),
      brushEngine: { finalizeStroke: jest.fn() },
      withAlphaLock: jest.fn(),
      shouldApplyStrokeDither: true,
      finalizeStrokeSettings: {
        lostEdge: 9,
        ditherBackgroundFill: true,
        pressureLinkedFillResolution: false,
      },
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

    expect(finalizeStrokeOrchestrated).toHaveBeenCalledWith(expect.objectContaining({
      ctx,
      lostEdge: 9,
      ditherBackgroundFill: true,
      pressureLinkedFillResolution: false,
    }));
    expect(result).toEqual(resultRect);
  });
});
