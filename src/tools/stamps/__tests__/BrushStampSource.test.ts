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

    const state = makeState();
    const getState = () => state;

    const source = new BrushStampSource({
      getState,
      brushRuntime: brushEngine,
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

  it('resolves eraser settings even when its size and tip match the brush', () => {
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
          opacity: 1,
        },
        eraserSettings: {
          size: 8,
          brushShape: BrushShape.ROUND,
          linkSizeToBrush: true,
          opacity: 0.5,
        },
      },
    } as unknown as AppState);

    const source = new BrushStampSource({
      getState: () => state,
      brushRuntime: brushEngine,
      userBrushEngine,
      resolveCustomBrush: () => undefined,
    });

    const ctx = {} as CanvasRenderingContext2D;
    source.begin(ctx, { x: 0, y: 0 }, 1);
    expect(brushEngine.updateConfig).toHaveBeenCalledWith({
      brushSettings: expect.objectContaining({
        size: 8,
        brushShape: BrushShape.ROUND,
        opacity: 0.5,
      }),
    });
  });

  it.each([
    [BrushShape.SQUARE, true, 8],
    [BrushShape.PIXEL_ROUND, true, 8],
    [BrushShape.PIXEL_ROUND, false, 12],
  ] as const)(
    'preserves eraser opacity with tip %s and linked size %s',
    (brushShape, linkSizeToBrush, expectedSize) => {
      const state = makeState();
      state.tools.brushSettings.opacity = 1;
      state.tools.eraserSettings = {
        ...state.tools.eraserSettings,
        brushShape,
        linkSizeToBrush,
        opacity: 0.25,
      };
      const brushRuntime = { drawBrush: jest.fn(), updateConfig: jest.fn() };
      const source = new BrushStampSource({
        getState: () => state,
        brushRuntime,
        userBrushEngine: {
          isUserBrush: () => false,
          setActiveBrush: jest.fn(),
          startStroke: jest.fn(),
          continueStroke: jest.fn(),
          endStroke: jest.fn(),
        },
        resolveCustomBrush: () => undefined,
      });

      source.begin({} as CanvasRenderingContext2D, { x: 4, y: 5 });

      expect(brushRuntime.updateConfig).toHaveBeenCalledWith({
        brushSettings: expect.objectContaining({
          brushShape,
          size: expectedSize,
          opacity: 0.25,
          antialiasing: false,
        }),
      });
    },
  );

  it.each([
    [false, false],
    [true, false],
    [false, true],
  ])('flushes the started eraser unless cancelled=%s, even after tool changes=%s', (cancelled, switchTool) => {
    const state = makeState();
    const ctx = {} as CanvasRenderingContext2D;
    const updateConfig = jest.fn();
    const finalizeStroke = jest.fn(() => {
      expect(updateConfig).toHaveBeenCalledTimes(1);
      expect(source.last()).toEqual({ x: 4, y: 5 });
    });
    const source = new BrushStampSource({
      getState: () => state,
      brushRuntime: { drawBrush: jest.fn(), updateConfig, finalizeStroke },
      userBrushEngine: {
        isUserBrush: () => false,
        setActiveBrush: jest.fn(),
        startStroke: jest.fn(),
        continueStroke: jest.fn(),
        endStroke: jest.fn(),
      },
      resolveCustomBrush: () => undefined,
    });
    source.begin(ctx, { x: 4, y: 5 });
    if (switchTool) {
      state.tools.currentTool = 'brush';
    }

    source.end(cancelled);

    expect(finalizeStroke).toHaveBeenCalledTimes(cancelled ? 0 : 1);
    if (!cancelled) {
      expect(finalizeStroke).toHaveBeenCalledWith(ctx);
    }
    expect(updateConfig).toHaveBeenCalledTimes(2);
    expect(updateConfig).toHaveBeenLastCalledWith({ brushSettings: state.tools.brushSettings });
    expect(source.last()).toBeNull();
    source.end();
    expect(finalizeStroke).toHaveBeenCalledTimes(cancelled ? 0 : 1);
  });

  it('forces opaque brush settings when requested and restores opacity on end', () => {
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
        currentTool: 'brush',
        brushSettings: {
          size: 8,
          brushShape: BrushShape.SQUARE,
          opacity: 0.35,
        },
        eraserSettings: {
          size: 12,
          brushShape: BrushShape.PIXEL_ROUND,
          linkSizeToBrush: false,
        },
      },
    } as unknown as AppState);

    const source = new BrushStampSource(
      {
        getState: () => state,
        brushRuntime: brushEngine,
        userBrushEngine,
        resolveCustomBrush: () => undefined,
      },
      { forceOpaque: true }
    );

    const ctx = {} as CanvasRenderingContext2D;
    source.begin(ctx, { x: 0, y: 0 }, 1);
    expect(brushEngine.updateConfig).toHaveBeenCalledWith({
      brushSettings: expect.objectContaining({
        opacity: 1,
      }),
    });

    source.end();
    expect(brushEngine.updateConfig).toHaveBeenLastCalledWith({
      brushSettings: expect.objectContaining({
        opacity: 0.35,
      }),
    });
  });

  it('can skip initial point stamp while still initializing stroke state', () => {
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
        currentTool: 'brush',
        brushSettings: {
          size: 8,
          brushShape: BrushShape.ROUND,
          opacity: 1,
        },
        eraserSettings: {
          size: 12,
          brushShape: BrushShape.SQUARE,
          linkSizeToBrush: true,
        },
      },
    } as unknown as AppState);

    const source = new BrushStampSource({
      getState: () => state,
      brushRuntime: brushEngine,
      userBrushEngine,
      resolveCustomBrush: () => undefined,
    });

    const ctx = {} as CanvasRenderingContext2D;
    source.begin(ctx, { x: 3, y: 4 }, 0.8, { skipInitialStamp: true });
    expect(brushEngine.drawBrush).not.toHaveBeenCalled();

    source.draw(ctx, { x: 3, y: 4 }, { x: 5, y: 6 }, { pressure: 0.8 });
    expect(brushEngine.drawBrush).toHaveBeenCalledTimes(1);
    expect(source.last()).toEqual({ x: 5, y: 6 });
  });
});


describe('BrushStampSource mask target ownership', () => {
  it('forwards the latched target once per segment and clears it for the next stroke', () => {
    const state = makeState();
    const runtime = { drawBrush: jest.fn(), updateConfig: jest.fn(), finalizeStroke: jest.fn() };
    const source = new BrushStampSource({
      getState: () => state,
      brushRuntime: runtime,
      userBrushEngine: {
        isUserBrush: () => false, setActiveBrush: jest.fn(), startStroke: jest.fn(),
        continueStroke: jest.fn(), endStroke: jest.fn(),
      },
      resolveCustomBrush: () => undefined,
    });
    const ctx = {} as CanvasRenderingContext2D;
    source.begin(ctx, { x: 4, y: 5 }, 0.25, { target: 'erase-mask', skipInitialStamp: true });
    source.draw(ctx, { x: 4, y: 5 }, { x: 6, y: 7 }, { pressure: 0.75 });
    expect(runtime.drawBrush).toHaveBeenCalledTimes(1);
    expect(runtime.drawBrush).toHaveBeenLastCalledWith(ctx, { x: 4, y: 5 }, { x: 6, y: 7 },
      expect.objectContaining({ pressure: 0.75, target: 'erase-mask' }));
    source.end();
    expect(runtime.finalizeStroke).toHaveBeenCalledWith(ctx);
    source.begin(ctx, { x: 1, y: 2 });
    expect(runtime.drawBrush.mock.calls[1][3]).not.toHaveProperty('target');
    source.end();
  });
});
