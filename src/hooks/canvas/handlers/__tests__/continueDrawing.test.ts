import { createContinueDrawingHandler } from '@/hooks/canvas/handlers/continueDrawing';
import type { AppState } from '@/stores/useAppStore';

describe('createContinueDrawingHandler', () => {
  const createState = (): AppState =>
    ({
      globalBrushSize: 20,
      activeLayerId: 'layer-1',
      layers: [{ id: 'layer-1', visible: true }],
      tools: {
        currentTool: 'eraser',
        brushSettings: {
          size: 10,
          antialiasing: false,
          pressureEnabled: false,
        },
        eraserSettings: {
          size: 22,
          antialiasing: false,
          pressureEnabled: false,
          linkSizeToBrush: false,
        },
      },
    } as unknown as AppState);

  it('extends stroke bounds and padding for eraser movement', () => {
    const state = createState();
    const strokeBoundingBoxRef = {
      current: { minX: 2, minY: 2, maxX: 2, maxY: 2 },
    };
    const strokeCapturePaddingRef = { current: 0 };

    const handler = createContinueDrawingHandler({
      storeRef: { current: state },
      endStrokeSession: jest.fn(),
      processBatchedStrokes: jest.fn(),
      throttleMs: Number.MAX_SAFE_INTEGER,
      strokeBatchRef: { current: [] },
      strokeBatchTimerRef: { current: null },
      lastProcessedTimeRef: { current: performance.now() },
      lastStrokePointRef: { current: null },
      brushSamplingPreviewActiveRef: { current: false },
      strokeBoundingBoxRef,
      strokeCapturePaddingRef,
      resamplerBrushDataRef: { current: undefined },
    });

    handler({ x: 8, y: 5 }, 0.5);

    expect(strokeBoundingBoxRef.current).toEqual({
      minX: 2,
      minY: 2,
      maxX: 8,
      maxY: 5,
    });
    expect(strokeCapturePaddingRef.current).toBeGreaterThan(0);
  });
});
