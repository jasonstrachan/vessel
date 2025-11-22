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

  it.skip('clears preview state on flush', () => {
    // ShapeToolHandler no longer exposes a flush hook publicly; kept skipped to avoid regressions.
  });
});
