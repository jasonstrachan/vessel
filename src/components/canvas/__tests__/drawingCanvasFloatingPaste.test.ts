import {
  drawFloatingPasteMarquee,
  renderFloatingPasteLayerOverlay,
} from '../drawingCanvasFloatingPaste';
import { strokeMarqueeRect } from '@/utils/marqueeStroke';

jest.mock('@/utils/marqueeStroke', () => ({
  strokeMarqueePath: jest.fn(),
  strokeMarqueeRect: jest.fn(),
}));

describe('drawFloatingPasteMarquee', () => {
  it('draws the outline at display size without scaling its stroke', () => {
    const ctx = {
      save: jest.fn(),
      restore: jest.fn(),
      translate: jest.fn(),
      rotate: jest.fn(),
      scale: jest.fn(),
    } as unknown as CanvasRenderingContext2D;

    drawFloatingPasteMarquee({
      ctx,
      floatingPaste: {
        imageData: {} as ImageData,
        position: { x: 10, y: 20 },
        width: 10,
        height: 6,
        displayWidth: 40,
        displayHeight: 18,
        rotation: 0,
      },
      contextIsWorldTransformed: true,
      scale: 12,
      offsetX: 0,
      offsetY: 0,
      marchingAntsOffset: 0,
    });

    expect(ctx.scale).not.toHaveBeenCalled();
    expect(strokeMarqueeRect).toHaveBeenCalledWith(
      ctx,
      0,
      0,
      40,
      18,
      expect.objectContaining({ scale: 12 }),
    );
  });
});

describe('renderFloatingPasteLayerOverlay', () => {
  it('combines an existing live layer overlay with the floating paste bitmap', () => {
    const base = document.createElement('canvas');
    base.width = 2;
    base.height = 1;
    const baseContext = base.getContext('2d');
    baseContext!.fillStyle = '#ff0000';
    baseContext!.fillRect(0, 0, 2, 1);
    const imageData = new ImageData(1, 1);
    imageData.data.set([0, 255, 0, 255]);
    const outputCanvas = document.createElement('canvas');
    const outputContext = outputCanvas.getContext('2d', { willReadFrequently: true });
    const drawImage = jest.spyOn(outputContext!, 'drawImage');
    const outputCanvasRef = { current: outputCanvas as HTMLCanvasElement | null };

    const output = renderFloatingPasteLayerOverlay({
      outputCanvasRef,
      baseOverlay: base,
      floatingPaste: {
        imageData,
        position: { x: 1, y: 0 },
        width: 1,
        height: 1,
      },
      project: { width: 2, height: 1 },
      pasteCanvasRef: { current: null },
      lastPasteInfoRef: { current: { imageData: null, width: 0, height: 0 } },
      activeCanvasShape: null,
      applyCanvasShapeClip: jest.fn(),
    });

    expect(output).toBe(outputCanvas);
    expect(drawImage).toHaveBeenCalledWith(base, 0, 0);
    expect(drawImage).toHaveBeenCalledTimes(2);
  });
});
