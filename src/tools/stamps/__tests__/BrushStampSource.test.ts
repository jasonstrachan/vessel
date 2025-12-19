import { BrushShape } from '@/types';
import type { AppState } from '@/stores/useAppStore';
import { BrushStampSource } from '../BrushStampSource';

const makeState = (overrides: Partial<AppState> = {}): AppState =>
  ({
    tools: {
      currentTool: 'eraser',
      brushSettings: {
        size: 8,
        brushShape: BrushShape.SQUARE,
      },
      eraserSettings: {
        size: 12,
        brushShape: BrushShape.PIXEL_ROUND,
        linkSizeToBrush: false,
      },
    },
    currentBrushPreset: null,
    globalBrushSize: 8,
    ...overrides,
  } as unknown as AppState);

describe('BrushStampSource eraser overrides', () => {
  it('applies eraser size and shape overrides then restores them on end', () => {
    const brushEngine = {
      drawBrush: jest.fn(),
      updateConfig: jest.fn(),
    };
    const userBrushEngine = {
      isUserBrush: jest.fn().mockReturnValue(false),
      setActiveBrush: jest.fn(),
      startStroke: jest.fn(),
      continueStroke: jest.fn(),
      endStroke: jest.fn(),
    };

    let state = makeState();
    const getState = () => state;

    const source = new BrushStampSource({
      getState,
      brushEngine,
      userBrushEngine,
      resolveCustomBrush: () => undefined,
    });

    const ctx = {} as CanvasRenderingContext2D;

    source.begin(ctx, { x: 10, y: 10 }, 1);
    expect(brushEngine.updateConfig).toHaveBeenCalledTimes(1);
    expect(brushEngine.updateConfig).toHaveBeenCalledWith({
      brushSettings: expect.objectContaining({
        size: 12,
        brushShape: BrushShape.PIXEL_ROUND,
      }),
    });

    source.end();
    expect(brushEngine.updateConfig).toHaveBeenCalledTimes(2);
    expect(brushEngine.updateConfig).toHaveBeenLastCalledWith({
      brushSettings: expect.objectContaining({
        size: 8,
        brushShape: BrushShape.SQUARE,
      }),
    });
  });

  it('skips overrides when eraser matches brush settings', () => {
    const brushEngine = {
      drawBrush: jest.fn(),
      updateConfig: jest.fn(),
    };
    const userBrushEngine = {
      isUserBrush: jest.fn().mockReturnValue(false),
      setActiveBrush: jest.fn(),
      startStroke: jest.fn(),
      continueStroke: jest.fn(),
      endStroke: jest.fn(),
    };

    const state = makeState({
      tools: {
        currentTool: 'eraser',
        brushSettings: {
          size: 8,
          brushShape: BrushShape.ROUND,
        },
        eraserSettings: {
          size: 8,
          brushShape: BrushShape.ROUND,
          linkSizeToBrush: true,
        },
      },
    } as unknown as AppState);

    const source = new BrushStampSource({
      getState: () => state,
      brushEngine,
      userBrushEngine,
      resolveCustomBrush: () => undefined,
    });

    const ctx = {} as CanvasRenderingContext2D;
    source.begin(ctx, { x: 0, y: 0 }, 1);
    expect(brushEngine.updateConfig).not.toHaveBeenCalled();
  });
});
