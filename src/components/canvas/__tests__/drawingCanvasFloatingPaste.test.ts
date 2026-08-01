import { drawFloatingPasteMarquee } from '../drawingCanvasFloatingPaste';
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
