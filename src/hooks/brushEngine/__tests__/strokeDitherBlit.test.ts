import { blitDitheredRegionWithOverlay } from '../strokeDitherBlit';

describe('blitDitheredRegionWithOverlay', () => {
  it('restores the pre-stroke pixels before a BG-off blit and preserves alpha lock', () => {
    const baseCanvas = document.createElement('canvas');
    const ditherCanvas = document.createElement('canvas');
    const drawImage = jest.fn();
    const clearRect = jest.fn();
    const ctx = {
      save: jest.fn(),
      restore: jest.fn(),
      drawImage,
      clearRect,
      globalCompositeOperation: 'source-over',
    } as unknown as CanvasRenderingContext2D;
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
      bgOff: true,
      clearBgOffOnTarget: true,
      isDitherStrokeBrush: true,
      warnIfDitherStrokePath: jest.fn(),
      warnContext: 'test',
      includeRawFallbackForOverlay: false,
    });

    expect(clearRect).not.toHaveBeenCalled();
    expect(drawImage.mock.calls[0][0]).toBe(baseCanvas);
    expect(drawImage.mock.calls[1][0]).toBe(ditherCanvas);
    expect(withAlphaLock).toHaveBeenCalled();
  });
});
