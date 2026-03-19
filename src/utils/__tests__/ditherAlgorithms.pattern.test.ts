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
