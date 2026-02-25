import { initializeStrokeStartCaptureBounds } from '@/hooks/canvas/handlers/strokeStartCaptureBounds';
import type { AppState } from '@/stores/useAppStore';

describe('initializeStrokeStartCaptureBounds', () => {
  const createState = (): AppState =>
    ({
      globalBrushSize: 20,
      tools: {
        currentTool: 'eraser',
        brushSettings: {
          size: 12,
          pressureEnabled: false,
          antialiasing: false,
        },
        eraserSettings: {
          size: 24,
          pressureEnabled: false,
          antialiasing: false,
          linkSizeToBrush: false,
        },
      },
    } as unknown as AppState);

  it('initializes bounding box and padding for eraser strokes', () => {
    const state = createState();
    const strokeBoundingBoxRef = { current: null as { minX: number; minY: number; maxX: number; maxY: number } | null };
    const strokeCapturePaddingRef = { current: 0 };

    initializeStrokeStartCaptureBounds({
      currentState: state,
      currentTool: 'eraser',
      worldPos: { x: 10, y: 15 },
      strokeBoundingBoxRef,
      strokeCapturePaddingRef,
      resolveCustomBrushData: () => undefined,
      resamplerBrushDataRef: { current: undefined },
    });

    expect(strokeBoundingBoxRef.current).toEqual({
      minX: 10,
      minY: 15,
      maxX: 10,
      maxY: 15,
    });
    expect(strokeCapturePaddingRef.current).toBeGreaterThan(0);
  });
});
