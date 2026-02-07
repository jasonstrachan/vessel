import { runStrokeDrawCoreEntry } from '../strokeDrawCoreEntryController';
import { runStrokeDrawCore } from '../strokeDrawCoreController';

jest.mock('../strokeDrawCoreController', () => ({
  runStrokeDrawCore: jest.fn(),
}));

describe('strokeDrawCoreEntryController', () => {
  it('maps runtime settings and forwards args to strokeDrawCoreController', () => {
    const ctx = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D;

    runStrokeDrawCoreEntry({
      ctx,
      from: { x: 1, y: 2 },
      to: { x: 3, y: 4 },
      rawPressure: 0.5,
      sampleTag: { x: 3, y: 4, tag: 'test' },
      enableLargeRegionFallback: true,
      makeStrokeParams: jest.fn(),
      resolveStrokePressureForRender: jest.fn(),
      estimateStrokeBounds: jest.fn(() => ({ x: 0, y: 0, width: 1, height: 1 })),
      getLiveStrokeRawCtx: jest.fn(),
      trackLiveStrokeSegment: jest.fn(),
      renderBrushStrokeToRaw: jest.fn(),
      runStrokePostRenderPipeline: jest.fn(),
      shouldApplyStrokeDither: true,
      strokeDrawRuntimeSettings: {
        lostEdge: 7,
        pressureLinkedFillResolution: false,
      },
      applyLostEdgeMaskInRegion: jest.fn(),
      runLivePressureDitherForCurrentStroke: jest.fn(),
      scheduleLiveStrokeRender: jest.fn(),
    });

    expect(runStrokeDrawCore).toHaveBeenCalledWith(expect.objectContaining({
      ctx,
      lostEdge: 7,
      pressureLinkedFillResolution: false,
      shouldApplyStrokeDither: true,
    }));
  });
});
