import {
  applyColorCycleRasterFootprintMaskToCanvasContext,
  applyPolygonMaskToCanvasContext,
} from '@/hooks/canvas/handlers/shapes/shapePreviewMask';

describe('applyPolygonMaskToCanvasContext', () => {
  it('builds a hard-edged pixel mask without a vector outline', () => {
    const rect = jest.fn();
    const moveTo = jest.fn();
    const targetCtx = {
      canvas: { width: 6, height: 6 },
      save: jest.fn(),
      restore: jest.fn(),
      beginPath: jest.fn(),
      rect,
      moveTo,
      lineTo: jest.fn(),
      closePath: jest.fn(),
      fill: jest.fn(),
      fillStyle: '',
      globalCompositeOperation: 'source-over',
    } as unknown as CanvasRenderingContext2D;

    applyPolygonMaskToCanvasContext(
      targetCtx,
      [
        { x: 1, y: 1 },
        { x: 5, y: 1 },
        { x: 5, y: 5 },
        { x: 1, y: 5 },
      ],
      { hardEdges: true }
    );

    expect(moveTo).not.toHaveBeenCalled();
    expect(rect).toHaveBeenCalledWith(1, 1, 4, 1);
    expect(rect).toHaveBeenCalledWith(1, 4, 4, 1);
    expect(targetCtx.globalCompositeOperation).toBe('destination-in');
    expect(targetCtx.fill).toHaveBeenCalledTimes(1);
  });

  it('uses the final CC row-span edge inclusion for raster previews', () => {
    const rect = jest.fn();
    const targetCtx = {
      canvas: { width: 6, height: 6 },
      save: jest.fn(),
      restore: jest.fn(),
      beginPath: jest.fn(),
      rect,
      fill: jest.fn(),
      fillStyle: '',
      globalCompositeOperation: 'source-over',
    } as unknown as CanvasRenderingContext2D;

    applyColorCycleRasterFootprintMaskToCanvasContext(
      targetCtx,
      [
        { x: 1, y: 1 },
        { x: 5, y: 1 },
        { x: 5, y: 5 },
        { x: 1, y: 5 },
      ],
    );

    expect(rect).toHaveBeenCalledWith(1, 1, 5, 1);
    expect(rect).toHaveBeenCalledWith(1, 4, 5, 1);
    expect(targetCtx.globalCompositeOperation).toBe('destination-in');
    expect(targetCtx.fill).toHaveBeenCalledTimes(1);
  });
});
