import { renderCanvasBackground } from '@/components/canvas/drawingCanvasBackground';

describe('renderCanvasBackground', () => {
  it('fills visible project area with solid gray when configured', () => {
    const fillRect = jest.fn();
    const ctx = {
      fillStyle: '',
      fillRect,
      createPattern: jest.fn(),
    } as unknown as CanvasRenderingContext2D;

    renderCanvasBackground({
      ctx,
      visibleRect: { x: 12, y: 20, width: 40, height: 55 },
      project: { width: 200, height: 100 },
      offsetX: 0,
      offsetY: 0,
      scale: 1,
      displayWidth: 200,
      displayHeight: 100,
      checkerPatternCanvasRef: { current: null },
      checkerPatternCacheRef: { current: new WeakMap() },
      transparencyBackgroundMode: 'gray',
      solidBackgroundColor: '#5a5a5f',
      checkerLight: '#2a2a2e',
      checkerDark: '#1c1c1f',
    });

    expect(ctx.fillStyle).toBe('#5a5a5f');
    expect(fillRect).toHaveBeenCalledWith(12, 20, 40, 55);
  });
});
