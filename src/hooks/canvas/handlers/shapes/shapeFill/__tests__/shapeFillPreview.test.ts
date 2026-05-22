import { renderShapeFillDraftPreview } from '../shapeFillPreview';

describe('shapeFillPreview', () => {
  it('renders an explicit draft preview for the renderPreview:false Shape Fill path', () => {
    const overlayCanvas = document.createElement('canvas');
    overlayCanvas.width = 64;
    overlayCanvas.height = 64;
    const ctx = overlayCanvas.getContext('2d', { willReadFrequently: true })!;
    const fillSpy = jest.spyOn(ctx, 'fill');
    const strokeSpy = jest.spyOn(ctx, 'stroke');
    const lineToSpy = jest.spyOn(ctx, 'lineTo');

    const rect = renderShapeFillDraftPreview({
      overlayCanvas,
      points: [
        { x: 10, y: 10 },
        { x: 30, y: 10 },
        { x: 30, y: 30 },
      ],
      previewPoint: { x: 10, y: 30 },
      transform: { scale: 1, offsetX: 0, offsetY: 0 },
      fillStyle: '#00ff00',
      previousRect: null,
    });

    expect(rect).toEqual({ x: 0, y: 0, width: 46, height: 46 });
    expect(fillSpy).toHaveBeenCalled();
    expect(strokeSpy).toHaveBeenCalled();
    expect(lineToSpy).toHaveBeenCalledWith(10, 30);
  });
});
