import { createCustomBrushPreset } from '@/utils/customBrushPreset';
import type { CustomBrush } from '@/types';

describe('customBrushPreset', () => {
  it('includes color-cycle metadata in customBrushData payload', () => {
    const brush: CustomBrush = {
      id: 'preset-cc-1',
      name: 'Preset CC',
      imageData: new ImageData(2, 2),
      thumbnail: 'data:image/png;base64,abc',
      width: 2,
      height: 2,
      createdAt: 123,
      colorCycle: {
        schemaVersion: 1,
        source: 'color-cycle-layer',
        gradient: [
          { position: 0, color: '#111111' },
          { position: 1, color: '#eeeeee' },
        ],
        speed: 2,
        phaseMode: 'per-stroke-seeded',
        phaseJitter: 0.2,
      },
    };

    const preset = createCustomBrushPreset(brush);

    expect(preset.isCustomBrush).toBe(true);
    expect(preset.customBrushData?.colorCycle).toEqual(brush.colorCycle);
  });
});
