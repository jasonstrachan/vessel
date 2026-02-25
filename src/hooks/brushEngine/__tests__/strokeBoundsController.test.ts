import { BrushShape, type BrushSettings } from '@/types';

import { estimateStrokeBounds } from '../strokeBoundsController';

const createSettings = (overrides: Partial<BrushSettings> = {}): BrushSettings =>
  ({
    size: 10,
    spacing: 2,
    brushShape: BrushShape.ROUND,
    ditherStrokeTipShape: 'round',
    ...overrides,
  }) as BrushSettings;

describe('strokeBoundsController', () => {
  it('expands bounds around a basic stroke', () => {
    const result = estimateStrokeBounds({
      from: { x: 10, y: 20 },
      to: { x: 30, y: 24 },
      pressure: 1,
      brushSettings: createSettings(),
      clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
      inflateRect: (rect, padding) => ({
        x: rect.x - padding,
        y: rect.y - padding,
        width: rect.width + padding * 2,
        height: rect.height + padding * 2,
      }),
    });

    expect(result.width).toBeGreaterThan(20);
    expect(result.height).toBeGreaterThan(4);
    expect(result.x).toBeLessThan(10);
    expect(result.y).toBeLessThan(20);
  });

  it('accounts for mosaic extent when brush shape is mosaic', () => {
    const result = estimateStrokeBounds({
      from: { x: 0, y: 0 },
      to: { x: 0, y: 0 },
      pressure: 1,
      brushSettings: createSettings({
        brushShape: BrushShape.MOSAIC,
        mosaicTilePx: 16,
        mosaicBlocksCount: 6,
      }),
      clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
      inflateRect: (rect, padding) => ({
        x: rect.x - padding,
        y: rect.y - padding,
        width: rect.width + padding * 2,
        height: rect.height + padding * 2,
      }),
    });

    expect(result.width).toBeGreaterThan(100);
    expect(result.height).toBeGreaterThan(100);
  });
});

