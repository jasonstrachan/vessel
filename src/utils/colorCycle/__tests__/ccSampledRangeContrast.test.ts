import {
  applyCcSampledRangeContrast,
  resolveCcSampledRangeContrastAmount,
} from '@/utils/colorCycle/ccSampledRangeContrast';

describe('ccSampledRangeContrast', () => {
  it('preserves sampled stops at the source-range point', () => {
    const stops = [
      { position: 0, color: '#000000' },
      { position: 1, color: '#ffffff' },
    ];

    expect(applyCcSampledRangeContrast(stops, 70)).toEqual(stops);
  });

  it('expands sampled differences substantially at maximum contrast', () => {
    const stops = [
      { position: 0, color: '#404040' },
      { position: 1, color: '#c0c0c0' },
    ];

    expect(applyCcSampledRangeContrast(stops, 100)).toEqual([
      { position: 0, color: 'rgb(16, 16, 16)' },
      { position: 1, color: 'rgb(240, 240, 240)' },
    ]);
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

  it('compresses toward an explicitly weighted dominant color when provided', () => {
    const stops = [
      { position: 0, color: '#465a78' },
      { position: 0.5, color: '#87865f' },
      { position: 1, color: '#ff8000' },
    ];

    expect(applyCcSampledRangeContrast(stops, 0, '#465a78')).toEqual([
      { position: 0, color: '#465a78' },
      { position: 0.5, color: 'rgb(70, 90, 120)' },
      { position: 1, color: 'rgb(70, 90, 120)' },
    ]);
  });

  it('uses an eased response so low values stay subtle', () => {
    expect(resolveCcSampledRangeContrastAmount(25)).toBeLessThan(0.25);
    expect(resolveCcSampledRangeContrastAmount(70)).toBe(1);
    expect(resolveCcSampledRangeContrastAmount(100)).toBe(1.75);
  });
});
