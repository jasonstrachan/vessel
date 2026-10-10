import { BrushShape, type BrushSettings } from '@/types';

import { drawPixelBrush } from '../shapePixelBrush';

describe('drawPixelBrush', () => {
  it.each([1, 2])('keeps a nonzero triangle footprint at size %s', (size) => {
    const raw = document.createElement('canvas').getContext('2d')!;
    const support = document.createElement('canvas').getContext('2d')!;
    const move = jest.spyOn(raw, 'moveTo');
    const line = jest.spyOn(raw, 'lineTo');
    const supportMove = jest.spyOn(support, 'moveTo');
    const supportLine = jest.spyOn(support, 'lineTo');
    drawPixelBrush({
      drawingCtx: raw, supportCtx: support,
      drawX: 30, drawY: 40, size, halfSize: size / 2,
      shape: BrushShape.PIXEL_DITHER, quantizedRotation: 0,
      brushSettings: { ditherStrokeTipShape: 'triangle' } as BrushSettings,
    });
    const [top] = move.mock.calls;
    const [left, right] = line.mock.calls;
    expect(right[0] - left[0]).toBeGreaterThan(0);
    expect(left[1] - top[1]).toBeGreaterThan(0);
    expect(right[0] - left[0]).toBeLessThanOrEqual(size);
    expect(left[1] - top[1]).toBeLessThanOrEqual(size);
    expect(supportMove.mock.calls).toEqual(move.mock.calls);
    expect(supportLine.mock.calls).toEqual(line.mock.calls);
  });

  it.each(['square', 'diamond', 'triangle', 'round', 'diamond5', 'diamond7', 'diamond9'] as const)(
    'records the same native %s geometry for pressure-run support',
    (tip) => {
      const raw = document.createElement('canvas').getContext('2d')!;
      const support = document.createElement('canvas').getContext('2d')!;
      const methods = ['fillRect', 'drawImage', 'fill', 'arc', 'moveTo', 'lineTo'] as const;
      const rawCalls = methods.map((method) => jest.spyOn(raw, method));
      const supportCalls = methods.map((method) => jest.spyOn(support, method));
      raw.fillStyle = '#123456';
      raw.globalAlpha = 0.5;
      drawPixelBrush({
        drawingCtx: raw, supportCtx: support,
        drawX: 30, drawY: 40, size: 16, halfSize: 8,
        shape: BrushShape.PIXEL_DITHER, quantizedRotation: 0,
        brushSettings: { ditherStrokeTipShape: tip } as BrushSettings,
      });
      expect(rawCalls.some((call) => call.mock.calls.length > 0)).toBe(true);
      methods.forEach((_, index) => {
        expect(supportCalls[index].mock.calls).toEqual(rawCalls[index].mock.calls);
      });
    },
  );

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
