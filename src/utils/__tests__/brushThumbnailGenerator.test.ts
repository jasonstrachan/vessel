import { generateBrushThumbnail } from '@/utils/brushThumbnailGenerator';
import { BrushShape } from '@/types';

describe('brushThumbnailGenerator', () => {
  const basePreset = {
    id: 'p1',
    name: 'test',
    isDefault: false,
    components: [
      { type: 'shape', parameters: { shape: BrushShape.ROUND } },
    ],
  } as any;

  it('returns empty string when document is undefined', () => {
    const original = (global as any).document;
    // @ts-expect-error override
    delete (global as any).document;
    expect(generateBrushThumbnail(basePreset)).toBe('');
    (global as any).document = original;
  });

  it('returns fallback data URL when context is unavailable', () => {
    const originalCreate = document.createElement;
    (document as any).createElement = () => ({ getContext: () => null });

    const url = generateBrushThumbnail(basePreset, { size: 8 });
    expect(url).toMatch(/^data:image\/png;base64/);

    (document as any).createElement = originalCreate;
  });

  it('returns fallback on toDataURL failure', () => {
    const canvas = document.createElement('canvas');
    const originalToDataURL = canvas.toDataURL;
    canvas.toDataURL = () => { throw new Error('boom'); };
    const originalCreate = document.createElement;
    (document as any).createElement = () => canvas;

    const url = generateBrushThumbnail({
      ...basePreset,
      components: [{ type: 'shape', parameters: { shape: BrushShape.ROUND } }],
    }, { size: 8 });

    expect(url).toMatch(/^data:image\/png;base64/);

    canvas.toDataURL = originalToDataURL;
    (document as any).createElement = originalCreate;
  });
});
