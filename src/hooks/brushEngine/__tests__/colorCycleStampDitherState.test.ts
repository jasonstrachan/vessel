import { encodeRgbaToBase64 } from '@/utils/colorCycle/ccCustomTilePattern';
import type { CcCustomTilePattern } from '@/types';

import { ColorCycleStampDitherState } from '../colorCycleStampDitherState';

const makePattern = (): CcCustomTilePattern => ({
  id: 'tile-a',
  name: 'Tile A',
  width: 1,
  height: 1,
  rgbaBase64: encodeRgbaToBase64(new Uint8ClampedArray([255, 255, 255, 255])),
  createdAt: 1,
  updatedAt: 2,
});

describe('ColorCycleStampDitherState', () => {
  it('owns stamp dither settings and normalizes tile settings', () => {
    const state = new ColorCycleStampDitherState();

    expect(state.getSettings()).toMatchObject({
      stampDitherEnabled: false,
      stampDitherPixelSize: 1,
      stampDitherAlgorithm: 'sierra-lite',
      stampDitherPatternStyle: 'dots',
      stampDitherBgFill: true,
      stampDitherPressureLinked: false,
    });

    expect(state.setEnabled(true)).toBe(true);
    expect(state.setAlgorithm('pattern')).toBe(true);
    expect(state.setPatternStyle('crosshatch')).toBe(true);
    expect(state.setPixelSize(3.8)).toBe(true);
    state.setPressureLinked(true);
    state.setClears(true);
    expect(state.setPatternTileSettings({
      patternTileId: 'tile-a',
      patternTileScale: 2.2,
      patternTileInvert: true,
      patternTileThreshold: 1.5,
      patternTileOffsetX: 1.2,
      patternTileOffsetY: -1.7,
    })).toBe(true);

    expect(state.getSettings()).toMatchObject({
      stampDitherEnabled: true,
      stampDitherPixelSize: 3,
      stampDitherAlgorithm: 'pattern',
      stampDitherPatternStyle: 'crosshatch',
      stampDitherPatternTileId: 'tile-a',
      stampDitherPatternTileScale: 2,
      stampDitherPatternTileInvert: true,
      stampDitherPatternTileThreshold: 1,
      stampDitherPatternTileOffsetX: 1,
      stampDitherPatternTileOffsetY: -2,
      stampDitherBgFill: false,
      stampDitherPressureLinked: true,
    });
  });

  it('caches image-tile threshold resolvers by tile signature', () => {
    const state = new ColorCycleStampDitherState();
    state.setAlgorithm('pattern');
    state.setPatternTileSettings({ patternTileId: 'tile-a' });
    const patterns = [makePattern()];

    const first = state.createConfig({ patterns, seed: 1 }).imageTileThresholdResolver;
    const second = state.createConfig({ patterns, seed: 2 }).imageTileThresholdResolver;

    expect(first).toBeDefined();
    expect(second).toBe(first);
  });

  it('version-tracks and clears derived runtime tile caches when settings invalidate them', () => {
    const state = new ColorCycleStampDitherState();
    const runtime = state.getRuntime();
    runtime.baseTiles.set('base', new Uint8Array([1]));
    runtime.tiles.set('tile', new Uint8Array([2]));

    expect(runtime.builtFromVersion).toBe(0);
    expect(state.setPixelSize(2)).toBe(true);

    const nextRuntime = state.getRuntime();
    expect(nextRuntime).toBe(runtime);
    expect(nextRuntime.builtFromVersion).toBe(1);
    expect(nextRuntime.baseTiles.size).toBe(0);
    expect(nextRuntime.tiles.size).toBe(0);
  });
});
