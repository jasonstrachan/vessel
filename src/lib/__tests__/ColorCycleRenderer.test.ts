import { ColorCycleRenderer } from '@/lib/ColorCycleRenderer';
import type { IndexBuffer } from '@/lib/IndexBuffer';

describe('ColorCycleRenderer', () => {
  it('advances indices when painting without explicit color', () => {
    const renderer: any = new ColorCycleRenderer({ width: 16, height: 16 });

    renderer.paint(8, 8, 4);
    const indexBuffer = renderer.indexBuffer as IndexBuffer;
    const firstIndex = indexBuffer.getPixel(8, 8);
    expect(firstIndex).toBeGreaterThan(0);

    renderer.paint(9, 8, 4);
    const secondIndex = indexBuffer.getPixel(9, 8);
    expect(secondIndex).toBeGreaterThan(0);
    expect(secondIndex).not.toBe(firstIndex);
  });

  it('reuses numeric indices for repeated explicit colors', () => {
    const renderer: any = new ColorCycleRenderer({ width: 16, height: 16 });

    renderer.paint(4, 4, 3, '#ff0000');
    const buffer = renderer.indexBuffer as IndexBuffer;
    const first = buffer.getPixel(4, 4);
    expect(first).toBeGreaterThan(0);

    renderer.paint(5, 4, 3, '#ff0000');
    const second = buffer.getPixel(5, 4);
    expect(second).toBe(first);

    renderer.paint(6, 4, 3, '#00ff00');
    const third = buffer.getPixel(6, 4);
    expect(third).toBeGreaterThan(0);
    expect(third).not.toBe(first);
  });
});
