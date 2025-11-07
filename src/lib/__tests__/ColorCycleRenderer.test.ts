import { ColorCycleRenderer } from '@/lib/ColorCycleRenderer';

describe('ColorCycleRenderer', () => {
  it('advances indices when painting without explicit color', () => {
    const renderer = new ColorCycleRenderer({ width: 16, height: 16 });

    renderer.paint(8, 8, 4);
    const firstIndex = renderer.getIndexValue(8, 8);
    expect(firstIndex).toBeGreaterThan(0);

    renderer.paint(9, 8, 4);
    const secondIndex = renderer.getIndexValue(9, 8);
    expect(secondIndex).toBeGreaterThan(0);
    expect(secondIndex).not.toBe(firstIndex);
  });

  it('reuses numeric indices for repeated explicit colors', () => {
    const renderer = new ColorCycleRenderer({ width: 16, height: 16 });

    renderer.paint(4, 4, 3, '#ff0000');
    const first = renderer.getIndexValue(4, 4);
    expect(first).toBeGreaterThan(0);

    renderer.paint(5, 4, 3, '#ff0000');
    const second = renderer.getIndexValue(5, 4);
    expect(second).toBe(first);

    renderer.paint(6, 4, 3, '#00ff00');
    const third = renderer.getIndexValue(6, 4);
    expect(third).toBeGreaterThan(0);
    expect(third).not.toBe(first);
  });
});
