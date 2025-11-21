import { renderHook, act } from '@testing-library/react';
import { createShapeToolHandler } from '@/hooks/canvas/handlers/shapes/ShapeToolHandler';
import { useAppStore } from '@/stores/useAppStore';
import { BrushShape } from '@/types';

const makeCtx = () => ({
  canvasRef: { current: { width: 10, height: 10 } as HTMLCanvasElement },
  setCanvasCursor: jest.fn(),
  setCanvasPanLock: jest.fn(),
  setCurrentCompositeBitmap: jest.fn(),
  setLayersNeedRecomposition: jest.fn(),
  setNeedsRedraw: jest.fn(),
  viewTransformRef: { current: { scale: 1, offsetX: 0, offsetY: 0 } },
});

const makeDelegate = () => ({
  redraw: jest.fn(),
  onShapePreview: jest.fn(),
  onShapeCommit: jest.fn(),
});

describe('ShapeToolHandler finalize/preview flow', () => {
  beforeEach(() => {
    useAppStore.setState((state) => ({
      ...state,
      currentTool: 'brush',
      tools: {
        ...state.tools,
        brushSettings: {
          ...state.tools.brushSettings,
          brushShape: BrushShape.POLYGON_GRADIENT,
        },
      },
    }));
  });

  it('clears preview state on flush', () => {
    const ctx = makeCtx();
    const delegate = makeDelegate();
    const handler = createShapeToolHandler(ctx as any, delegate as any);

    act(() => {
      handler.shapeState.previewPath = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
      handler.shapeState.previewCanvas = { width: 10, height: 10 } as HTMLCanvasElement;
      handler.flush();
    });

    expect(handler.shapeState.previewPath).toBeNull();
    expect(handler.shapeState.previewCanvas).toBeNull();
    expect(delegate.onShapePreview).not.toHaveBeenCalled();
  });
});
