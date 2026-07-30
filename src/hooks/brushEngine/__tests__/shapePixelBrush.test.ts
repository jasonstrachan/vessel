import { BrushShape } from '@/types';

import { drawPixelBrush } from '../shapePixelBrush';

describe('drawPixelBrush', () => {
  it('draws an unrotated square directly without allocating a stamp canvas', () => {
    const createElement = jest.spyOn(document, 'createElement');
    const drawingCtx = {
      fillStyle: '#123456',
      fillRect: jest.fn(),
      imageSmoothingEnabled: true,
    } as unknown as CanvasRenderingContext2D;

    drawPixelBrush({
      drawingCtx,
      drawX: 10,
      drawY: 12,
      size: 8,
      halfSize: 4,
      shape: BrushShape.PIXEL_DITHER,
      quantizedRotation: 0,
      brushSettings: {
        ditherStrokeTipShape: 'square',
      } as never,
    });

    expect(drawingCtx.fillRect).toHaveBeenCalledWith(6, 8, 8, 8);
    expect(createElement).not.toHaveBeenCalled();
    createElement.mockRestore();
  });
});
