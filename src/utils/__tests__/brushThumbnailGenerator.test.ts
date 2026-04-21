/* eslint-disable @typescript-eslint/no-explicit-any */
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
    delete (global as any).document;
    expect(generateBrushThumbnail(basePreset)).toBe('data:image/png;base64,');
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

  it('renders a checkered thumbnail for the checkered preset', () => {
    const fillRect = jest.fn();
    const canvas = {
      width: 0,
      height: 0,
      toDataURL: () => 'data:image/png;base64,',
      getContext: () => ({
        fillRect,
        beginPath: jest.fn(),
        arc: jest.fn(),
        stroke: jest.fn(),
        strokeRect: jest.fn(),
        moveTo: jest.fn(),
        lineTo: jest.fn(),
        closePath: jest.fn(),
        createLinearGradient: jest.fn(() => ({ addColorStop: jest.fn() })),
        imageSmoothingEnabled: true,
        globalAlpha: 1,
        fillStyle: '#fff',
        strokeStyle: '#fff',
        lineCap: 'round',
        lineJoin: 'round',
        lineWidth: 1,
      }),
    };
    const originalCreate = document.createElement;
    (document as any).createElement = () => canvas;

    generateBrushThumbnail({
      ...basePreset,
      components: [{ type: 'shape', parameters: { shape: BrushShape.COLOR_CYCLE } }],
      preferredSettings: {
        colorCycleStampShape: 'checkered',
      },
    }, { size: 16 });

    expect(fillRect).toHaveBeenCalledTimes(8);

    (document as any).createElement = originalCreate;
  });
});
