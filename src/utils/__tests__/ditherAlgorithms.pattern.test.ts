import { createHash } from 'crypto';

import { applyPatternDither, type DitherSettings, type PatternStyle } from '@/utils/ditherAlgorithms';

describe('applyPatternDither tone-adaptive', () => {
  const palette: [number, number, number][] = [
    [0, 0, 0],
    [255, 255, 255]
  ];

  const makeStripedImage = () => {
    const width = 12;
    const height = 12;
    const data = new Uint8ClampedArray(width * height * 4);

    const setRow = (row: number, luminance: number) => {
      for (let x = 0; x < width; x++) {
        const idx = (row * width + x) * 4;
        data[idx] = luminance;
        data[idx + 1] = luminance;
        data[idx + 2] = luminance;
        data[idx + 3] = 255;
      }
    };

    // Shadows (0-3), mids (4-7), highlights (8-11)
    for (let y = 0; y < height; y++) {
      if (y < 4) setRow(y, 30);
      else if (y < 8) setRow(y, 128);
      else setRow(y, 230);
    }

    return new ImageData(data, width, height);
  };

  const settings: DitherSettings = {
    algorithm: 'pattern',
    pressure: 0.5,
    intensity: 1,
    bayerMatrixSize: 8,
    palette,
    patternStyle: 'tone-adaptive' as PatternStyle
  };

  it('produces different column patterns for shadows vs mids', () => {
    const image = makeStripedImage();
    const result = applyPatternDither(image, settings);
    const width = result.width;

    const pickRow = (y: number) => {
      const row: number[] = [];
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        row.push(result.data[idx] > 127 ? 1 : 0);
      }
      return row;
    };

    const lowRow = pickRow(1); // shadow band
    const midRow = pickRow(5); // midtones
    const highRow = pickRow(10); // highlights

    const rowsDiffer = (a: number[], b: number[]) => a.some((v, i) => v !== b[i]);

    expect(rowsDiffer(lowRow, midRow)).toBe(true);
    expect(rowsDiffer(highRow, midRow)).toBe(true);
  });
});

describe('applyPatternDither ascii', () => {
  const palette: [number, number, number][] = [
    [0, 0, 0],
    [255, 255, 255]
  ];

  const settings: DitherSettings = {
    algorithm: 'pattern',
    pressure: 0.5,
    intensity: 1,
    bayerMatrixSize: 8,
    palette,
    patternStyle: 'ascii' as PatternStyle
  };

  it('preserves complete ASCII color output over tones and cell phases', () => {
    const source = new ImageData(35, 49);
    for (let y = 0; y < source.height; y += 1) {
      for (let x = 0; x < source.width; x += 1) {
        source.data.set([(x * 13 + y * 17) % 256, (x * 7) % 256, (y * 11) % 256, (x + y) % 3 ? 255 : 0], (y * source.width + x) * 4);
      }
    }
    const result = applyPatternDither(source, { ...settings, phaseOffset: { x: -9, y: 13 } });
    expect(createHash('sha256').update(result.data).digest('hex')).toBe('d4f30b1fe5966313d840965dd4e2985ede373381bbd851e68df0e5594d73f602');
  });

  it('varies unchanged equal-density glyphs deterministically between cells', () => {
    const source = new ImageData(10, 7);
    for (let i = 0; i < source.data.length; i += 4) source.data.set([100, 100, 100, 255], i);
    const options = { ...settings, signal: 'alpha' as const };
    const result = applyPatternDither(source, options);
    expect(applyPatternDither(source, options).data).toEqual(result.data);
    const cells = [0, 1].map(cellX => {
      const bits: number[] = [];
      for (let y = 0; y < 7; y += 1) {
        for (let x = 0; x < 5; x += 1) bits.push(result.data[(y * 10 + cellX * 5 + x) * 4] / 255);
      }
      return bits;
    });
    expect(cells[0].reduce((sum, bit) => sum + bit, 0)).toBe(14);
    expect(cells[1].reduce((sum, bit) => sum + bit, 0)).toBe(14);
    expect(cells[0]).not.toEqual(cells[1]);
  });

  it('selects nearest rendered glyph coverage for every alpha byte and complete-cell phase', () => {
    const counts = [0, 1, 3, 4, 11, 13, 14, 15, 17, 20, 35];
    for (let alpha = 0; alpha <= 255; alpha += 1) {
      const target = alpha / 255 * 35;
      const expected = counts.reduce((best, count) => Math.abs(count - target) < Math.abs(best - target) ? count : best);
      for (const cell of [-5, 0, 3, 17]) {
        const source = new ImageData(5, 7);
        for (let i = 0; i < source.data.length; i += 4) source.data.set([alpha, alpha, alpha, i % 12 ? 255 : 128], i);
        const result = applyPatternDither(source, { ...settings, signal: 'alpha', phaseOffset: { x: cell * 5, y: cell * 7 } });
        let count = 0;
        for (let i = 0; i < result.data.length; i += 4) {
          count += result.data[i] / 255;
          expect(result.data[i + 3]).toBe(source.data[i + 3]);
        }
        expect(count).toBe(expected);
      }
    }
  });

  it('increases ink density as luminance gets darker', () => {
    const width = 12;
    const height = 18;
    const data = new Uint8ClampedArray(width * height * 4);
    const rows = [
      { start: 0, end: 5, luminance: 235 },
      { start: 6, end: 11, luminance: 140 },
      { start: 12, end: 17, luminance: 35 },
    ];

    for (const band of rows) {
      for (let y = band.start; y <= band.end; y++) {
        for (let x = 0; x < width; x++) {
          const idx = (y * width + x) * 4;
          data[idx] = band.luminance;
          data[idx + 1] = band.luminance;
          data[idx + 2] = band.luminance;
          data[idx + 3] = 255;
        }
      }
    }

    const image = new ImageData(data, width, height);
    const result = applyPatternDither(image, settings);

    const countInk = (startRow: number, endRow: number) => {
      let ink = 0;
      for (let y = startRow; y <= endRow; y++) {
        for (let x = 0; x < width; x++) {
          const idx = (y * width + x) * 4;
          if (result.data[idx] < 128) {
            ink += 1;
          }
        }
      }
      return ink;
    };

    const highlightInk = countInk(0, 5);
    const midInk = countInk(6, 11);
    const shadowInk = countInk(12, 17);

    expect(highlightInk).toBeLessThan(midInk);
    expect(midInk).toBeLessThan(shadowInk);
  });
});

describe('applyPatternDither image-tile', () => {
  const palette: [number, number, number][] = [
    [0, 0, 0],
    [255, 255, 255]
  ];

  const makeMidImage = () => {
    const width = 2;
    const height = 1;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let x = 0; x < width; x++) {
      const idx = x * 4;
      data[idx] = 128;
      data[idx + 1] = 128;
      data[idx + 2] = 128;
      data[idx + 3] = 255;
    }
    return new ImageData(data, width, height);
  };

  it('uses the supplied image tile threshold resolver', () => {
    const result = applyPatternDither(makeMidImage(), {
      algorithm: 'pattern',
      pressure: 1,
      intensity: 1,
      bayerMatrixSize: 8,
      palette,
      patternStyle: 'image-tile',
      imageTileThresholdResolver: (x) => (x === 0 ? 0 : 1),
    });

    expect(result.data[0]).toBe(0);
    expect(result.data[4]).toBe(255);
  });

  it('falls back to dots when no image tile resolver is available', () => {
    const result = applyPatternDither(makeMidImage(), {
      algorithm: 'pattern',
      pressure: 1,
      intensity: 1,
      bayerMatrixSize: 8,
      palette,
      patternStyle: 'image-tile',
    });

    expect(Array.from(result.data)).not.toEqual([0, 0, 0, 255, 0, 0, 0, 255]);
  });
});
