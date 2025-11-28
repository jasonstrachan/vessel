import { applyPatternDither, type DitherSettings } from '@/utils/ditherAlgorithms';

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
    patternStyle: 'tone-adaptive'
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
