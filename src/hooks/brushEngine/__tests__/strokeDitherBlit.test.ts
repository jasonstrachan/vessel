import { blitDitheredRegionWithOverlay } from '../strokeDitherBlit';

describe('blitDitheredRegionWithOverlay', () => {
  it.each([true, false])('restores the pre-stroke pixels with BG-off=%s and preserves alpha lock', (bgOff) => {
    const baseCanvas = document.createElement('canvas');
    const ditherCanvas = document.createElement('canvas');
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.globalAlpha = 0.35;
    ctx.globalCompositeOperation = 'source-over';
    const drawStates: Array<{ alpha: number; composite: GlobalCompositeOperation }> = [];
    const savedStates: typeof drawStates = [];
    // The shared canvas mock does not implement the native context state stack.
    jest.spyOn(ctx, 'save').mockImplementation(() => {
      savedStates.push({ alpha: ctx.globalAlpha, composite: ctx.globalCompositeOperation });
    });
    jest.spyOn(ctx, 'restore').mockImplementation(() => {
      const saved = savedStates.pop();
      if (saved) {
        ctx.globalAlpha = saved.alpha;
        ctx.globalCompositeOperation = saved.composite;
      }
    });
    const drawImage = jest.spyOn(ctx, 'drawImage').mockImplementation(() => {
      drawStates.push({ alpha: ctx.globalAlpha, composite: ctx.globalCompositeOperation });
    });
    const clearRect = jest.spyOn(ctx, 'clearRect');
    const rect = jest.spyOn(ctx, 'rect');
    const clip = jest.spyOn(ctx, 'clip');
    const withAlphaLock = jest.fn((
      targetCtx: CanvasRenderingContext2D,
      draw: (lockedCtx: CanvasRenderingContext2D) => void
    ) => draw(targetCtx));

    blitDitheredRegionWithOverlay({
      ctx,
      ditherCanvas,
      rawCanvas: null,
      baseCanvas,
      strokeBounds: { x: 2, y: 3, width: 4, height: 5 },
      region: { x: 2, y: 3, width: 4, height: 5 },
      withAlphaLock,
      applyStrokeRisographOverlay: jest.fn(),
      bgOff,
      clearBgOffOnTarget: bgOff,
      isDitherStrokeBrush: true,
      warnIfDitherStrokePath: jest.fn(),
      warnContext: 'test',
      includeRawFallbackForOverlay: false,
    });

    expect(clearRect).not.toHaveBeenCalled();
    expect(drawImage.mock.calls[0][0]).toBe(baseCanvas);
    expect(drawImage.mock.calls[1][0]).toBe(ditherCanvas);
    expect(rect).toHaveBeenCalledWith(2, 3, 4, 5);
    expect(clip.mock.invocationCallOrder[0]).toBeLessThan(drawImage.mock.invocationCallOrder[0]);
    expect(drawStates).toEqual([
      { alpha: 1, composite: 'copy' },
      { alpha: 0.35, composite: 'source-over' },
    ]);
    expect(ctx.globalAlpha).toBe(0.35);
    expect(savedStates).toHaveLength(0);
    expect(withAlphaLock).toHaveBeenCalled();
  });
});
