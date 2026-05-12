import {
  encodeRgbaToBase64,
  makeCcCustomTilePattern,
  normalizeCcCustomTilePatternPack,
  resolveCcPatternPackBrushSettings,
  resolveCcCustomTileThreshold,
  toCcCustomTileRuntime,
} from '@/utils/colorCycle/ccCustomTilePattern';
import type { BrushSettings, CcCustomTilePattern } from '@/types';

const makeTile = (rgba: number[]): CcCustomTilePattern => ({
  id: 'tile-1',
  name: 'Tile 1',
  width: 2,
  height: 1,
  rgbaBase64: encodeRgbaToBase64(Uint8Array.from(rgba)),
  createdAt: 1,
  updatedAt: 1,
});

describe('cc custom tile pattern threshold', () => {
  it('maps opaque black toward ink 1 and transparent pixels toward ink 2', () => {
    const tile = toCcCustomTileRuntime(makeTile([
      0, 0, 0, 255,
      255, 255, 255, 0,
    ]));

    expect(tile).not.toBeNull();
    if (!tile) {
      throw new Error('expected tile runtime');
    }

    expect(resolveCcCustomTileThreshold(tile, 0, 0)).toBe(0);
    expect(resolveCcCustomTileThreshold(tile, 1, 0)).toBe(1);
  });

  it('wraps coordinates and applies invert after alpha/luminance conversion', () => {
    const tile = toCcCustomTileRuntime(makeTile([
      0, 0, 0, 255,
      255, 255, 255, 0,
    ]));

    expect(tile).not.toBeNull();
    if (!tile) {
      throw new Error('expected tile runtime');
    }

    expect(resolveCcCustomTileThreshold(tile, 2, 0)).toBe(0);
    expect(resolveCcCustomTileThreshold(tile, 2, 0, { patternTileInvert: true })).toBe(1);
  });

  it('invalidates decoded runtime cache when a reused id has different pixels', () => {
    const first = toCcCustomTileRuntime(makeTile([
      0, 0, 0, 255,
      255, 255, 255, 0,
    ]));
    const second = toCcCustomTileRuntime({
      ...makeTile([
        255, 255, 255, 0,
        0, 0, 0, 255,
      ]),
      updatedAt: 2,
    });

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    if (!first || !second) {
      throw new Error('expected tile runtimes');
    }

    expect(resolveCcCustomTileThreshold(first, 0, 0)).toBe(0);
    expect(resolveCcCustomTileThreshold(second, 0, 0)).toBe(1);
  });

  it('saves custom tile pixels at the exact pasted size without scaling', () => {
    const imageData = new ImageData(3, 2);
    imageData.data.set([
      0, 0, 0, 255,
      10, 20, 30, 255,
      40, 50, 60, 255,
      70, 80, 90, 255,
      100, 110, 120, 255,
      130, 140, 150, 255,
    ]);

    const pattern = makeCcCustomTilePattern({ name: 'Exact', imageData });
    const runtime = toCcCustomTileRuntime(pattern);

    expect(pattern.width).toBe(3);
    expect(pattern.height).toBe(2);
    expect(runtime?.data).toEqual(imageData.data);
  });

  it('allows large custom tiles without silently resizing them', () => {
    const imageData = new ImageData(576, 260);
    const pattern = makeCcCustomTilePattern({ name: 'Large', imageData });

    expect(pattern.width).toBe(576);
    expect(pattern.height).toBe(260);
  });

  it('normalizes pattern packs by pruning duplicate and missing tile ids', () => {
    const pack = normalizeCcCustomTilePatternPack(
      {
        id: 'pack-1',
        name: '',
        patternIds: ['tile-1', 'missing', 'tile-1'],
        createdAt: 1,
        updatedAt: 1,
      },
      new Set(['tile-1'])
    );

    expect(pack).toEqual({
      id: 'pack-1',
      name: 'Pack',
      patternIds: ['tile-1'],
      createdAt: 1,
      updatedAt: 1,
    });
  });

  it('freezes a concrete tile id from pack-random brush settings', () => {
    const settings = resolveCcPatternPackBrushSettings({
      settings: {
        ditherAlgorithm: 'pattern',
        patternStyle: 'image-tile',
        patternTilePackId: 'pack-1',
        patternTileSelectionMode: 'pack-random',
      } as BrushSettings,
      packs: [
        {
          id: 'pack-1',
          name: 'Pack 1',
          patternIds: ['tile-1', 'missing'],
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      patterns: [makeTile([0, 0, 0, 255, 255, 255, 255, 255])],
      seed: 'layer-1:shape-1',
    });

    expect(settings).toEqual({
      ditherAlgorithm: 'pattern',
      patternStyle: 'image-tile',
      patternTileId: 'tile-1',
    });
  });

  it('retries pack-random resolution after an empty-pack dots fallback', () => {
    const settings = resolveCcPatternPackBrushSettings({
      settings: {
        ditherAlgorithm: 'pattern',
        patternStyle: 'dots',
        patternTileId: null,
        patternTilePackId: 'pack-1',
        patternTileSelectionMode: 'pack-random',
      } as BrushSettings,
      packs: [
        {
          id: 'pack-1',
          name: 'Pack 1',
          patternIds: ['tile-1'],
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      patterns: [makeTile([0, 0, 0, 255, 255, 255, 255, 255])],
      seed: 'layer-1:shape-2',
    });

    expect(settings).toEqual({
      ditherAlgorithm: 'pattern',
      patternStyle: 'image-tile',
      patternTileId: 'tile-1',
    });
  });
});
