import {
  applyCcSampledRangeContrast,
  resolveCcSampledRangeContrastAmount,
} from '@/utils/colorCycle/ccSampledRangeContrast';

describe('ccSampledRangeContrast', () => {
  it('preserves sampled stops at full range contrast', () => {
    const stops = [
      { position: 0, color: '#000000' },
      { position: 1, color: '#ffffff' },
    ];

    expect(applyCcSampledRangeContrast(stops, 100)).toEqual(stops);
  });

  it('compresses sampled stops toward their representative color at low range contrast', () => {
    const stops = [
      { position: 0, color: '#000000' },
      { position: 1, color: '#ffffff' },
    ];

    expect(applyCcSampledRangeContrast(stops, 0)).toEqual([
      { position: 0, color: 'rgb(128, 128, 128)' },
      { position: 1, color: 'rgb(128, 128, 128)' },
    ]);
  });

  it('uses an eased response so low values stay subtle', () => {
    expect(resolveCcSampledRangeContrastAmount(25)).toBeLessThan(0.25);
    expect(resolveCcSampledRangeContrastAmount(100)).toBe(1);
  });
});
