import studioExtension from '@/extensions/studioExtension';
import { brushPresets } from '@/presets/brushPresets';

describe('public studio extension boundary', () => {
  it('ships with a no-op extension and no private authoring presets', () => {
    expect(studioExtension).toEqual({ brushPresets: [] });
    expect(brushPresets.some((preset) => preset.components.some(
      (component) => component.parameters.shape === 'extension',
    ))).toBe(false);
  });
});
