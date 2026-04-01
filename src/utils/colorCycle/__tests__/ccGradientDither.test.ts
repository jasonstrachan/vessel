import { fillCcGradientDither } from '@/utils/colorCycle/ccGradientDither';
import {
  fillFlatPatternMode,
  getSierraLiteTileBank,
  resolveFlatInkSetForBand,
  resolveToneBand,
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

  it('selects distinct Sierra Lite flat tiles across 5 tone bands', async () => {
    expect(getSierraLiteTileBank().toneBands).toHaveLength(5);

    const width = 12;
    const height = 12;
    const tones = [0.1, 0.3, 0.5, 0.7, 0.9];
    const outputs: string[] = [];

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
      outputs.push(Array.from(out).join(','));
    }

    expect(tones.map((tone) => resolveToneBand(tone))).toEqual([0, 1, 2, 3, 4]);
    expect(new Set(outputs).size).toBe(5);
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

  it('keeps Sierra Lite flat mode globally flat for a constant tone', async () => {
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
      pairBandCount: 0,
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
    expect(left.size).toBeGreaterThanOrEqual(3);
  });

  it('supports 3-ink and 4-ink flat subsets without changing global band selection', () => {
    const gridW = 12;
    const gridH = 12;
    const threeInk = new Uint16Array(gridW * gridH);
    const fourInk = new Uint16Array(gridW * gridH);
    const tone = 0.5;

    fillFlatPatternMode({
      algorithm: 'sierra-lite',
      tone,
      gridW,
      gridH,
      fillBackground: true,
      baseOffset: 0,
      phaseX: 0,
      phaseY: 0,
      inkCount: 3,
      writeCellIndex: (cellIdx, index) => {
        threeInk[cellIdx] = index;
      },
    });

    fillFlatPatternMode({
      algorithm: 'sierra-lite',
      tone,
      gridW,
      gridH,
      fillBackground: true,
      baseOffset: 0,
      phaseX: 0,
      phaseY: 0,
      inkCount: 4,
      writeCellIndex: (cellIdx, index) => {
        fourInk[cellIdx] = index;
      },
    });

    const threeSet = new Set(Array.from(threeInk).filter((value) => value > 0));
    const fourSet = new Set(Array.from(fourInk).filter((value) => value > 0));

    expect(resolveToneBand(tone)).toBe(2);
    expect(threeSet.size).toBe(3);
    expect(fourSet.size).toBe(4);
  });

  it('uses adjacent CC indices for flat-mode ink subsets', () => {
    const anchors = [1, 65, 128, 192, 254];
    const expectContiguousSubset = (indices: number[]) => {
      const start = anchors.indexOf(indices[0]);
      expect(start).toBeGreaterThanOrEqual(0);
      expect(indices).toEqual(anchors.slice(start, start + indices.length));
    };

    expect(resolveFlatInkSetForBand(0, 2, 0).indices).toEqual([1, 65]);
    expect(resolveFlatInkSetForBand(1, 3, 0).indices).toEqual([1, 65, 128]);
    expectContiguousSubset(resolveFlatInkSetForBand(2, 4, 0).indices);
    expectContiguousSubset(resolveFlatInkSetForBand(3, 3, 0).indices);
    expect(resolveFlatInkSetForBand(4, 2, 0).indices).toEqual([192, 254]);
  });

  it('does not reuse Bayer-like structure for Sierra Lite flat mode', async () => {
    const width = 12;
    const height = 12;
    const run = async (algorithm: 'sierra-lite' | 'bayer') => {
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
        algorithm,
        sampleNormalized: () => 0.5,
        writeIndex: (x, y, index) => {
          out[y * width + x] = index;
        },
      });
      return Array.from(out).join(',');
    };

    expect(await run('sierra-lite')).not.toEqual(await run('bayer'));
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
