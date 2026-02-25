import { GradientPalette } from '@/lib/GradientPalette';
import { ensurePalette } from '@/lib/colorCycle/paletteService';

describe('paletteService ensurePalette', () => {
  it('provides stop indices aligned to palette resolution', () => {
    const palette = new GradientPalette([
      { position: 0, color: '#000000' },
      { position: 0.25, color: '#ff0000' },
      { position: 0.75, color: '#00ff00' },
      { position: 1, color: '#ffffff' }
    ]);

    const handle = ensurePalette({ palette });
    const stops = palette.getGradientStops();

    expect(handle.stopIndices).toHaveLength(stops.length);
    expect(handle.stopIndices[0]).toBe(1);
    expect(handle.stopIndices[handle.stopIndices.length - 1]).toBe(255);
    // Ensure intermediate stops land inside the palette span
    for (const index of handle.stopIndices) {
      expect(index).toBeGreaterThanOrEqual(1);
      expect(index).toBeLessThanOrEqual(255);
    }
  });
});
