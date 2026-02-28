import { drawCanvasOverlayLayer } from '@/components/canvas/drawingCanvasOverlay';

jest.mock('@/utils/selectionMaskContourPath', () => ({
  getSelectionMaskContourPath: jest.fn(() => ({ __path: 'mask' })),
}));

describe('drawCanvasOverlayLayer', () => {
  const originalPath2D = global.Path2D;

  beforeAll(() => {
    class MockPath2D {
      moveTo() {}
      lineTo() {}
      closePath() {}
      rect() {}
    }
    // @ts-expect-error test shim
    global.Path2D = MockPath2D;
  });

  afterAll(() => {
    global.Path2D = originalPath2D;
  });

  it('clips overlay preview to rectangular selection bounds', () => {
    const ctx = {
      save: jest.fn(),
      restore: jest.fn(),
      clip: jest.fn(),
      drawImage: jest.fn(),
      translate: jest.fn(),
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
    } as unknown as CanvasRenderingContext2D;

    drawCanvasOverlayLayer({
      ctx,
      layers: [],
      activeLayer: null,
      visibleRect: { x: 0, y: 0, width: 100, height: 100 },
      overlayCanvasElement: document.createElement('canvas'),
      overlayActive: true,
      colorCycleManager: null,
      selectionStart: { x: 10, y: 10 },
      selectionEnd: { x: 30, y: 30 },
      selectionMask: null,
      selectionMaskBounds: null,
      selectionVectorPath: null,
    });

    expect(ctx.clip).toHaveBeenCalledTimes(1);
    expect(ctx.drawImage).toHaveBeenCalledTimes(1);
  });

  it('clips overlay preview to selection mask contour', () => {
    const ctx = {
      save: jest.fn(),
      restore: jest.fn(),
      clip: jest.fn(),
      drawImage: jest.fn(),
      translate: jest.fn(),
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
    } as unknown as CanvasRenderingContext2D;

    const selectionMask = new ImageData(2, 2);
    selectionMask.data[3] = 255;

    drawCanvasOverlayLayer({
      ctx,
      layers: [],
      activeLayer: null,
      visibleRect: { x: 0, y: 0, width: 100, height: 100 },
      overlayCanvasElement: document.createElement('canvas'),
      overlayActive: true,
      colorCycleManager: null,
      selectionStart: null,
      selectionEnd: null,
      selectionMask,
      selectionMaskBounds: { x: 5, y: 7, width: 2, height: 2 },
      selectionVectorPath: null,
    });

    expect(ctx.translate).toHaveBeenCalledWith(5, 7);
    expect(ctx.clip).toHaveBeenCalledTimes(1);
    expect(ctx.drawImage).toHaveBeenCalledTimes(1);
  });
});
