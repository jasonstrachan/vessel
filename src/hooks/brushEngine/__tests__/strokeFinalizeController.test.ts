import {
  buildStrokeFinalizeContext,
  finalizeStrokeEngineBuffers,
} from '../strokeFinalizeController';

describe('strokeFinalizeController', () => {
  it('buildStrokeFinalizeContext derives region and contexts', () => {
    const ctxCanvas = document.createElement('canvas');
    ctxCanvas.width = 100;
    ctxCanvas.height = 80;
    const ctx = ctxCanvas.getContext('2d') as CanvasRenderingContext2D;

    const rawCanvas = document.createElement('canvas');
    const ditherCanvas = document.createElement('canvas');

    const result = buildStrokeFinalizeContext({
      ctx,
      strokeBoundsRef: { current: { x: -5, y: 10, width: 30, height: 200 } },
      liveStrokeBoundsRef: { current: { x: 1, y: 2, width: 3, height: 4 } },
      liveStrokeRawRef: { current: rawCanvas },
      liveStrokeDitherRef: { current: ditherCanvas },
    });

    expect(result.strokeBounds).toEqual({ x: -5, y: 10, width: 30, height: 200 });
    expect(result.region).toEqual({ x: 0, y: 10, width: 25, height: 70 });
    expect(result.rawCanvas).toBe(rawCanvas);
    expect(result.ditherCanvas).toBe(ditherCanvas);
    expect(result.rawCtx).toBe(rawCanvas.getContext('2d'));
    expect(result.ditherCtx).toBe(ditherCanvas.getContext('2d'));
  });

  it('buildStrokeFinalizeContext falls back to live stroke bounds when needed', () => {
    const ctx = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D;

    const result = buildStrokeFinalizeContext({
      ctx,
      strokeBoundsRef: { current: null },
      liveStrokeBoundsRef: { current: { x: 2, y: 3, width: 4, height: 5 } },
      liveStrokeRawRef: { current: null },
      liveStrokeDitherRef: { current: null },
    });

    expect(result.strokeBounds).toEqual({ x: 2, y: 3, width: 4, height: 5 });
  });

  it('finalizeStrokeEngineBuffers finalizes on raw context without alpha lock', () => {
    const ctx = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D;
    const rawCtx = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D;
    const brushEngine = { finalizeStroke: jest.fn() };
    const withAlphaLock = jest.fn();

    finalizeStrokeEngineBuffers({
      ctx,
      strokeBounds: { x: 1, y: 2, width: 3, height: 4 },
      rawCtx,
      brushEngine,
      withAlphaLock,
    });

    expect(brushEngine.finalizeStroke).toHaveBeenCalledWith(rawCtx);
    expect(withAlphaLock).not.toHaveBeenCalled();
  });

  it('finalizeStrokeEngineBuffers uses alpha lock path when raw context is missing', () => {
    const ctx = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D;
    const targetCtx = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D;
    const brushEngine = { finalizeStroke: jest.fn() };

    const withAlphaLock = jest.fn((_: CanvasRenderingContext2D, draw: (c: CanvasRenderingContext2D) => void) => {
      draw(targetCtx);
    });

    const bounds = { x: 10, y: 20, width: 30, height: 40 };

    finalizeStrokeEngineBuffers({
      ctx,
      strokeBounds: bounds,
      rawCtx: null,
      brushEngine,
      withAlphaLock,
    });

    expect(withAlphaLock).toHaveBeenCalledWith(ctx, expect.any(Function), bounds);
    expect(brushEngine.finalizeStroke).toHaveBeenCalledWith(targetCtx);
  });
});
