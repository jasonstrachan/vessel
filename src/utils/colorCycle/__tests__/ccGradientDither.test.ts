import { fillCcGradientDither } from '@/utils/colorCycle/ccGradientDither';

describe('fillCcGradientDither', () => {
  const vertices = [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 4 },
    { x: 0, y: 4 },
  ];

  it('maps the top slice of 2-level mode to a cyclic mid index instead of endpoint 255', async () => {
    const width = 5;
    const height = 5;
    const out = new Uint8Array(width * height);

    await fillCcGradientDither({
      vertices,
      minX: 0,
      minY: 0,
      maxX: 4,
      maxY: 4,
      pixelSize: 1,
      levels: 2,
      baseOffset: 0,
      algorithm: 'sierra-lite',
      sampleNormalized: () => 1,
      writeIndex: (x, y, index) => {
        if (x < 0 || y < 0 || x >= width || y >= height) return;
        out[y * width + x] = index;
      },
    });

    const values = new Set<number>();
    for (let i = 0; i < out.length; i += 1) {
      if (out[i] > 0) values.add(out[i]);
    }
    expect(values.size).toBe(1);
    expect(values.has(128)).toBe(true);
    expect(values.has(255)).toBe(false);
  });

  it('uses two gradient indices and dithers when levels is 1', async () => {
    const width = 5;
    const height = 5;
    const out = new Uint8Array(width * height);

    await fillCcGradientDither({
      vertices,
      minX: 0,
      minY: 0,
      maxX: 4,
      maxY: 4,
      pixelSize: 1,
      levels: 1,
      baseOffset: 0,
      algorithm: 'sierra-lite',
      sampleNormalized: (x) => (x < 2 ? 0 : 1),
      writeIndex: (x, y, index) => {
        if (x < 0 || y < 0 || x >= width || y >= height) return;
        out[y * width + x] = index;
      },
    });

    const values = new Set<number>();
    for (let i = 0; i < out.length; i += 1) {
      if (out[i] > 0) values.add(out[i]);
    }
    expect(values.size).toBe(2);
    expect(values.has(1)).toBe(true);
    expect(values.has(128)).toBe(true);
  });

  it('honors pixelSize for levels=1 so resolution affects the pattern grid', async () => {
    const width = 8;
    const height = 8;
    const run = async (pixelSize: number) => {
      const out = new Uint8Array(width * height);
      await fillCcGradientDither({
        vertices: [
          { x: 0, y: 0 },
          { x: 7, y: 0 },
          { x: 7, y: 7 },
          { x: 0, y: 7 },
        ],
        minX: 0,
        minY: 0,
        maxX: 7,
        maxY: 7,
        pixelSize,
        levels: 1,
        baseOffset: 0,
        algorithm: 'pattern',
        patternStyle: 'dots',
        fillBackground: false,
        sampleNormalized: () => 0.5,
        writeIndex: (x, y, index) => {
          out[y * width + x] = index;
        },
      });
      return out;
    };

    const out1 = await run(1);
    const out2 = await run(2);
    let transitions1 = 0;
    let transitions2 = 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = 1; x < width; x += 1) {
        if (out1[y * width + x] !== out1[y * width + x - 1]) transitions1 += 1;
        if (out2[y * width + x] !== out2[y * width + x - 1]) transitions2 += 1;
      }
    }
    expect(transitions2).toBeLessThan(transitions1);
  });

  it('honors pixelSize for levels=2 so resolution affects dither density', async () => {
    const width = 8;
    const height = 8;
    const run = async (pixelSize: number) => {
      const out = new Uint8Array(width * height);
      await fillCcGradientDither({
        vertices: [
          { x: 0, y: 0 },
          { x: 7, y: 0 },
          { x: 7, y: 7 },
          { x: 0, y: 7 },
        ],
        minX: 0,
        minY: 0,
        maxX: 7,
        maxY: 7,
        pixelSize,
        levels: 2,
        baseOffset: 0,
        algorithm: 'sierra-lite',
        fillBackground: true,
        sampleNormalized: () => 0.5,
        writeIndex: (x, y, index) => {
          out[y * width + x] = index;
        },
      });
      return out;
    };

    const out1 = await run(1);
    const out2 = await run(2);
    let transitions1 = 0;
    let transitions2 = 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = 1; x < width; x += 1) {
        if (out1[y * width + x] !== out1[y * width + x - 1]) transitions1 += 1;
        if (out2[y * width + x] !== out2[y * width + x - 1]) transitions2 += 1;
      }
    }
    expect(transitions2).toBeLessThan(transitions1);
  });

  it('clears pattern holes only when fillBackground is false', async () => {
    const writesBgOn: number[] = [];
    await fillCcGradientDither({
      vertices,
      minX: 0,
      minY: 0,
      maxX: 4,
      maxY: 4,
      pixelSize: 1,
      levels: 1,
      baseOffset: 0,
      algorithm: 'pattern',
      patternStyle: 'dots',
      fillBackground: true,
      sampleNormalized: () => 0.5,
      writeIndex: (_x, _y, index) => {
        writesBgOn.push(index);
      },
    });
    expect(writesBgOn.some((value) => value === 0)).toBe(false);

    const writesBgOff: number[] = [];
    await fillCcGradientDither({
      vertices,
      minX: 0,
      minY: 0,
      maxX: 4,
      maxY: 4,
      pixelSize: 1,
      levels: 1,
      baseOffset: 0,
      algorithm: 'pattern',
      patternStyle: 'dots',
      fillBackground: false,
      sampleNormalized: () => 0.5,
      writeIndex: (_x, _y, index) => {
        writesBgOff.push(index);
      },
    });
    expect(writesBgOff.some((value) => value === 0)).toBe(true);
  });
});
