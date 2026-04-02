import { fillCcGradientDither } from '@/utils/colorCycle/ccGradientDither';
import {
  resolveFlatInkSetForBand,
  resolveFlatInkSetForPosition,
  resolveFlatInkCountForBand,
} from '@/utils/colorCycle/ccFlatModePatterns';

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

  it('resolves Sierra Lite flat tones into local ink pairs centered on the sampled position', async () => {
    const width = 16;
    const height = 16;
    const tones = [0.1, 0.3, 0.5, 0.7, 0.9];
    const outputs: number[][] = [];

    for (const tone of tones) {
      const out = new Uint8Array(width * height);
      await fillCcGradientDither({
        vertices: [
          { x: 0, y: 0 },
          { x: width - 1, y: 0 },
          { x: width - 1, y: height - 1 },
          { x: 0, y: height - 1 },
        ],
        minX: 0,
        minY: 0,
        maxX: width - 1,
        maxY: height - 1,
        pixelSize: 1,
        levels: 1,
        baseOffset: 0,
        algorithm: 'sierra-lite',
        sampleNormalized: () => tone,
        writeIndex: (x, y, index) => {
          out[y * width + x] = index;
        },
      });
      outputs.push(Array.from(new Set(out)).filter((value) => value > 0).sort((a, b) => a - b));
    }

    expect(outputs).toEqual(
      tones.map((tone) => resolveFlatInkSetForPosition(Math.round(tone * 255) / 255, 2, 0).indices)
    );
  });

  it('does not snap flat levels=1 output to the legacy fixed-band pair when the sampled position falls between band centers', async () => {
    const width = 12;
    const height = 12;
    const sampledTone = 0.24;
    const out = new Uint8Array(width * height);

    await fillCcGradientDither({
      vertices: [
        { x: 0, y: 0 },
        { x: width - 1, y: 0 },
        { x: width - 1, y: height - 1 },
        { x: 0, y: height - 1 },
      ],
      minX: 0,
      minY: 0,
      maxX: width - 1,
      maxY: height - 1,
      pixelSize: 1,
      levels: 1,
      baseOffset: 0,
      algorithm: 'sierra-lite',
      sampleNormalized: () => sampledTone,
      writeIndex: (x, y, index) => {
        out[y * width + x] = index;
      },
    });

    const usedPair = Array.from(new Set(out)).filter((value) => value > 0).sort((a, b) => a - b);
    const sampledPair = resolveFlatInkSetForPosition(
      Math.round(sampledTone * 255) / 255,
      2,
      0
    ).indices;
    const legacyBandPair = resolveFlatInkSetForBand(1, 2, 0).indices;

    expect(usedPair).toEqual(sampledPair);
    expect(usedPair).not.toEqual(legacyBandPair);
  });

  it('uses band-local ink pairs when pairBandCount is provided', async () => {
    const width = 8;
    const height = 4;
    const out = new Uint8Array(width * height);

    await fillCcGradientDither({
      vertices: [
        { x: 0, y: 0 },
        { x: 7, y: 0 },
        { x: 7, y: 3 },
        { x: 0, y: 3 },
      ],
      minX: 0,
      minY: 0,
      maxX: 7,
      maxY: 3,
      pixelSize: 1,
      levels: 2,
      pairBandCount: 2,
      baseOffset: 0,
      algorithm: 'pattern',
      patternStyle: 'dots',
      sampleNormalized: (x) => (x < 4 ? 0.2 : 0.7),
      writeIndex: (x, y, index) => {
        out[y * width + x] = index;
      },
    });

    const values = new Set<number>();
    for (let i = 0; i < out.length; i += 1) {
      if (out[i] > 0) values.add(out[i]);
    }

    expect(Array.from(values).every((value) => [1, 65, 128, 192].includes(value))).toBe(true);
    expect(Array.from(values).some((value) => value <= 65)).toBe(true);
    expect(Array.from(values).some((value) => value >= 128)).toBe(true);
  });

  it('keeps a single Sierra Lite flat ink pair across the shape in levels=1 mode', async () => {
    const width = 8;
    const height = 4;
    const out = new Uint8Array(width * height);

    await fillCcGradientDither({
      vertices: [
        { x: 0, y: 0 },
        { x: 7, y: 0 },
        { x: 7, y: 3 },
        { x: 0, y: 3 },
      ],
      minX: 0,
      minY: 0,
      maxX: 7,
      maxY: 3,
      pixelSize: 1,
      levels: 1,
      baseOffset: 0,
      algorithm: 'sierra-lite',
      sampleNormalized: (x) => (x < 4 ? 0.2 : 0.8),
      writeIndex: (x, y, index) => {
        out[y * width + x] = index;
      },
    });

    const left = new Set<number>();
    const right = new Set<number>();
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const value = out[y * width + x];
        if (value <= 0) {
          continue;
        }
        (x < 4 ? left : right).add(value);
      }
    }

    expect(Array.from(left).sort((a, b) => a - b)).toEqual(
      Array.from(right).sort((a, b) => a - b)
    );
    expect(left.size).toBe(2);
    expect(right.size).toBe(2);
  });

  it('applies spread to Sierra Lite flat mode ink pair selection', async () => {
    const width = 10;
    const height = 6;
    const run = async (spread: number) => {
      const out = new Uint8Array(width * height);
      await fillCcGradientDither({
        vertices: [
          { x: 0, y: 0 },
          { x: width - 1, y: 0 },
          { x: width - 1, y: height - 1 },
          { x: 0, y: height - 1 },
        ],
        minX: 0,
        minY: 0,
        maxX: width - 1,
        maxY: height - 1,
        pixelSize: 1,
        levels: 1,
        baseOffset: 0,
        flatPairSpread: spread,
        algorithm: 'sierra-lite',
        sampleNormalized: () => 0.5,
        writeIndex: (x, y, index) => {
          out[y * width + x] = index;
        },
      });
      return Array.from(new Set(out)).filter((value) => value > 0).sort((a, b) => a - b);
    };

    const tight = await run(0);
    const wide = await run(100);

    expect(tight).toHaveLength(2);
    expect(wide).toHaveLength(2);
    expect(wide[1] - wide[0]).toBeGreaterThan(tight[1] - tight[0]);
  });

  it('drives Sierra Lite flat diffusion from mix amount when provided', async () => {
    const width = 8;
    const height = 8;
    const run = async (mix: number) => {
      const out = new Uint8Array(width * height);
      await fillCcGradientDither({
        vertices: [
          { x: 0, y: 0 },
          { x: width - 1, y: 0 },
          { x: width - 1, y: height - 1 },
          { x: 0, y: height - 1 },
        ],
        minX: 0,
        minY: 0,
        maxX: width - 1,
        maxY: height - 1,
        pixelSize: 1,
        levels: 1,
        baseOffset: 0,
        flatSeed: 7,
        algorithm: 'sierra-lite',
        sampleNormalized: () => 0.5,
        flatMixByBand: [mix, mix, mix, mix, mix],
        writeIndex: (x, y, index) => {
          out[y * width + x] = index;
        },
      });
      return out;
    };

    const low = await run(0);
    const high = await run(1);
    const lowValues = Array.from(new Set(low)).filter((value) => value > 0).sort((a, b) => a - b);
    const highValues = Array.from(new Set(high)).filter((value) => value > 0).sort((a, b) => a - b);

    expect(lowValues).toHaveLength(2);
    expect(highValues).toHaveLength(2);
    expect(lowValues).toEqual(highValues);
    expect(Array.from(low)).not.toEqual(Array.from(high));
  });

  it('varies Sierra Lite flat arrangement when flatSeed changes', async () => {
    const width = 12;
    const height = 12;
    const run = async (flatSeed: number) => {
      const out = new Uint8Array(width * height);
      await fillCcGradientDither({
        vertices: [
          { x: 0, y: 0 },
          { x: width - 1, y: 0 },
          { x: width - 1, y: height - 1 },
          { x: 0, y: height - 1 },
        ],
        minX: 0,
        minY: 0,
        maxX: width - 1,
        maxY: height - 1,
        pixelSize: 1,
        levels: 1,
        baseOffset: 0,
        flatSeed,
        algorithm: 'sierra-lite',
        sampleNormalized: () => 0.5,
        flatMixByBand: [0.52, 0.52, 0.52, 0.52, 0.52],
        writeIndex: (x, y, index) => {
          out[y * width + x] = index;
        },
      });
      return out;
    };

    const seedA = await run(1);
    const seedB = await run(2);
    const valuesA = Array.from(new Set(seedA)).filter((value) => value > 0).sort((a, b) => a - b);
    const valuesB = Array.from(new Set(seedB)).filter((value) => value > 0).sort((a, b) => a - b);

    expect(valuesA).toHaveLength(2);
    expect(valuesB).toHaveLength(2);
    expect(valuesA).toEqual(valuesB);
    expect(Array.from(seedA)).not.toEqual(Array.from(seedB));
  });

  it('uses two separated inks for each Sierra Lite flat tone band', () => {
    for (let band = 0; band < 5; band += 1) {
      const indices = resolveFlatInkSetForBand(band, 2, 0).indices;
      expect(indices).toHaveLength(2);
      expect(indices[1] - indices[0]).toBe(8);
      expect(resolveFlatInkCountForBand()).toBe(2);
    }
  });

  it('uses explicit stable CC ink pairs for Sierra Lite flat tone bands', () => {
    expect(resolveFlatInkSetForBand(0, 2, 0).indices).toEqual([22, 30]);
    expect(resolveFlatInkSetForBand(1, 2, 0).indices).toEqual([73, 81]);
    expect(resolveFlatInkSetForBand(2, 2, 0).indices).toEqual([124, 132]);
    expect(resolveFlatInkSetForBand(3, 2, 0).indices).toEqual([175, 183]);
    expect(resolveFlatInkSetForBand(4, 2, 0).indices).toEqual([226, 234]);
  });

  it('lets flat Sierra pair spread tighten down to adjacent local indices', () => {
    expect(resolveFlatInkSetForBand(0, 2, 0, 0).indices).toEqual([25, 27]);
    expect(resolveFlatInkSetForBand(2, 2, 0, 0).indices).toEqual([127, 129]);
    expect(resolveFlatInkSetForBand(4, 2, 0, 0).indices).toEqual([229, 231]);
  });

  it('widens flat Sierra pair spread as the slider increases', () => {
    const tight = resolveFlatInkSetForBand(2, 2, 0, 0).indices;
    const medium = resolveFlatInkSetForBand(2, 2, 0, 50).indices;
    const wide = resolveFlatInkSetForBand(2, 2, 0, 100).indices;

    expect(tight[1] - tight[0]).toBeLessThan(medium[1] - medium[0]);
    expect(medium[1] - medium[0]).toBeLessThan(wide[1] - wide[0]);
    expect(wide).toEqual([104, 152]);
  });

  it('shifts local flat ink pairs with baseOffset while keeping them centered on the sampled position', async () => {
    const width = 10;
    const height = 6;
    const out = new Uint8Array(width * height);

    await fillCcGradientDither({
      vertices: [
        { x: 0, y: 0 },
        { x: width - 1, y: 0 },
        { x: width - 1, y: height - 1 },
        { x: 0, y: height - 1 },
      ],
      minX: 0,
      minY: 0,
      maxX: width - 1,
      maxY: height - 1,
      pixelSize: 1,
      levels: 1,
      baseOffset: 23,
      algorithm: 'sierra-lite',
      sampleNormalized: () => 0.5,
      writeIndex: (_x, _y, index) => {
        out[_y * width + _x] = index;
      },
    });

    expect(
      Array.from(new Set(out)).filter((value) => value > 0).sort((a, b) => a - b)
    ).toEqual(resolveFlatInkSetForPosition(0.5, 2, 23).indices);
  });

  it('preserves existing behavior when clampedLevels > 1', async () => {
    const width = 16;
    const height = 8;
    const out = new Uint8Array(width * height);

    await fillCcGradientDither({
      vertices: [
        { x: 0, y: 0 },
        { x: width - 1, y: 0 },
        { x: width - 1, y: height - 1 },
        { x: 0, y: height - 1 },
      ],
      minX: 0,
      minY: 0,
      maxX: width - 1,
      maxY: height - 1,
      pixelSize: 1,
      levels: 4,
      baseOffset: 0,
      algorithm: 'sierra-lite',
      sampleNormalized: (x) => x / (width - 1),
      writeIndex: (x, y, index) => {
        out[y * width + x] = index;
      },
    });

    const left = new Set<number>();
    const right = new Set<number>();
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const value = out[y * width + x];
        if (x < width / 2) {
          left.add(value);
        } else {
          right.add(value);
        }
      }
    }

    expect(left).not.toEqual(right);
    expect(new Set(out).size).toBeGreaterThan(3);
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

  it('does not collapse sierra-lite multi-level diffusion into a repeating row band pattern', async () => {
    const width = 16;
    const height = 16;
    const out = new Uint8Array(width * height);

    await fillCcGradientDither({
      vertices: [
        { x: 0, y: 0 },
        { x: 15, y: 0 },
        { x: 15, y: 15 },
        { x: 0, y: 15 },
      ],
      minX: 0,
      minY: 0,
      maxX: 15,
      maxY: 15,
      pixelSize: 1,
      levels: 8,
      baseOffset: 0,
      algorithm: 'sierra-lite',
      sampleNormalized: () => 0.22,
      writeIndex: (x, y, index) => {
        out[y * width + x] = index;
      },
    });

    const uniqueRows = new Set<string>();
    for (let y = 0; y < height; y += 1) {
      uniqueRows.add(Array.from(out.slice(y * width, (y + 1) * width)).join(','));
    }

    expect(uniqueRows.size).toBeGreaterThanOrEqual(8);
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

  it('fills whole dither cells at polygon edges when pxlEdge is enabled', async () => {
    const width = 4;
    const height = 4;
    const tri = [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 0, y: 3 },
    ];

    const run = async (pxlEdge: boolean) => {
      const out = new Uint8Array(width * height);
      await fillCcGradientDither({
        vertices: tri,
        minX: 0,
        minY: 0,
        maxX: 3,
        maxY: 3,
        pixelSize: 2,
        levels: 2,
        baseOffset: 0,
        algorithm: 'sierra-lite',
        fillBackground: true,
        pxlEdge,
        sampleNormalized: () => 0.7,
        writeIndex: (x, y, index) => {
          out[y * width + x] = index;
        },
      });
      return out;
    };

    const defaultOut = await run(false);
    const pxlEdgeOut = await run(true);

    const countNonZero = (data: Uint8Array) => {
      let count = 0;
      for (let i = 0; i < data.length; i += 1) {
        if (data[i] !== 0) {
          count += 1;
        }
      }
      return count;
    };

    expect(countNonZero(pxlEdgeOut)).toBeGreaterThan(countNonZero(defaultOut));
  });

  it('does not issue full-cell clear writes in pxlEdge mode when BG fill is off', async () => {
    const writes: number[] = [];
    await fillCcGradientDither({
      vertices: [
        { x: 0, y: 0 },
        { x: 3, y: 0 },
        { x: 0, y: 3 },
      ],
      minX: 0,
      minY: 0,
      maxX: 3,
      maxY: 3,
      pixelSize: 2,
      levels: 1,
      baseOffset: 0,
      algorithm: 'pattern',
      patternStyle: 'dots',
      fillBackground: false,
      pxlEdge: true,
      sampleNormalized: () => 0.5,
      writeIndex: (_x, _y, index) => {
        writes.push(index);
      },
    });

    expect(writes.some((value) => value === 0)).toBe(false);
  });

  it('preserves prior pixels outside new shape writes in pxlEdge mode with BG fill off', async () => {
    const width = 4;
    const height = 4;
    const priorValue = 77;
    const out = new Uint8Array(width * height);
    out.fill(priorValue);

    await fillCcGradientDither({
      vertices: [
        { x: 0, y: 0 },
        { x: 3, y: 0 },
        { x: 0, y: 3 },
      ],
      minX: 0,
      minY: 0,
      maxX: 3,
      maxY: 3,
      pixelSize: 2,
      levels: 1,
      baseOffset: 0,
      algorithm: 'pattern',
      patternStyle: 'dots',
      fillBackground: false,
      pxlEdge: true,
      sampleNormalized: () => 0.5,
      writeIndex: (x, y, index) => {
        out[y * width + x] = index;
      },
    });

    let unchanged = 0;
    let changed = 0;
    let wroteZero = false;
    for (let i = 0; i < out.length; i += 1) {
      const value = out[i];
      if (value === priorValue) unchanged += 1;
      if (value !== priorValue) changed += 1;
      if (value === 0) wroteZero = true;
    }

    expect(unchanged).toBeGreaterThan(0);
    expect(changed).toBeGreaterThan(0);
    expect(wroteZero).toBe(false);
  });
});
