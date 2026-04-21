import { captureColorCycleCanvasSnapshot } from '@/utils/colorCycleCanvasSnapshot';

const fillRect = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string
) => {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, width, height);
};

describe('captureColorCycleCanvasSnapshot', () => {
  it('merges a captured ROI into the existing snapshot', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 4;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    expect(ctx).not.toBeNull();
    if (!ctx) {
      return;
    }

    fillRect(ctx, 0, 0, 4, 4, '#000000');
    fillRect(ctx, 1, 1, 2, 2, '#ff0000');

    const existing = new ImageData(4, 4);
    const next = captureColorCycleCanvasSnapshot({
      canvas,
      existingImageData: existing,
      roi: { x: 1, y: 1, width: 2, height: 2 },
    });

    expect(next).toBe(existing);
    expect(next).toBeDefined();
    expect(next?.width).toBe(4);
    expect(next?.height).toBe(4);

    const pixelAt = (x: number, y: number) => {
      const idx = ((y * 4) + x) * 4;
      return next?.data.slice(idx, idx + 4);
    };

    expect(Array.from(pixelAt(0, 0) ?? [])).toEqual([0, 0, 0, 0]);
    expect(Array.from(pixelAt(1, 1) ?? [])).toEqual([255, 0, 0, 255]);
    expect(Array.from(pixelAt(2, 2) ?? [])).toEqual([255, 0, 0, 255]);
  });

  it('falls back to a full capture when no existing snapshot matches the canvas', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    expect(ctx).not.toBeNull();
    if (!ctx) {
      return;
    }

    fillRect(ctx, 0, 0, 2, 2, '#00ff00');

    const next = captureColorCycleCanvasSnapshot({
      canvas,
      existingImageData: new ImageData(1, 1),
      roi: { x: 0, y: 0, width: 1, height: 1 },
    });

    expect(next).toBeDefined();
    expect(next?.width).toBe(2);
    expect(next?.height).toBe(2);
    expect(Array.from(next?.data.slice(0, 4) ?? [])).toEqual([0, 255, 0, 255]);
  });
});
