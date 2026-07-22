import { webcrypto } from 'node:crypto';

import {
  createCumulativeThresholdResolver,
  decodeCumulativeThresholdPattern,
  hashCumulativeThresholdPayload,
  isCumulativeThresholdActive,
  MAX_CUMULATIVE_PATTERN_DIMENSION,
  parseCumulativeThresholdPatternDefinition,
  resolveCumulativePatternTone,
  resolveCumulativeThreshold,
} from '@/utils/ditherPatterns/cumulativeThresholdPattern';
import { createDitherPatternRegistry } from '@/utils/ditherPatterns/ditherPatternRegistry';
import { fillCcGradientDither } from '@/utils/colorCycle/ccGradientDither';
import { resolveFlatCycleInkSetForPosition } from '@/utils/colorCycle/ccFlatModePatterns';
import { applyPatternDither } from '@/utils/ditherAlgorithms';

Object.defineProperty(globalThis, 'crypto', {
  configurable: true,
  value: webcrypto,
});

const makeFixture = async () => {
  const payload = new Uint8Array([
    16, 96, 176, 255,
    32, 112, 192, 255,
    48, 128, 208, 255,
  ]);
  const payloadHash = await hashCumulativeThresholdPayload(payload);
  const definition = {
    id: 'synthetic-cumulative-fixture',
    name: 'Synthetic Fixture',
    kind: 'cumulative-threshold',
    width: 4,
    height: 3,
    coveragePolicy: 'mark-tone-map',
    payloadHash,
    storageScope: 'local-library',
    toneMap: [
      { maxInput: 0.4, tone: 0.1 },
      { maxInput: 0.7, tone: 0.5 },
      { maxInput: 1, tone: 0.9 },
    ],
  } as const;
  return {
    definition,
    payload,
    runtime: await decodeCumulativeThresholdPattern({ definition, payload }),
  };
};

describe('cumulative threshold patterns', () => {
  it('hashes deterministically and rejects mismatched or malformed payloads', async () => {
    const { definition, payload } = await makeFixture();
    await expect(hashCumulativeThresholdPayload(payload)).resolves.toBe(definition.payloadHash);
    await expect(decodeCumulativeThresholdPattern({
      definition,
      payload: new Uint8Array(payload.length - 1),
    })).rejects.toThrow('dimensions');
    await expect(decodeCumulativeThresholdPattern({
      definition: { ...definition, payloadHash: `sha256:${'0'.repeat(64)}` },
      payload,
    })).rejects.toThrow('hash');
    expect(parseCumulativeThresholdPatternDefinition({
      ...definition,
      width: MAX_CUMULATIVE_PATTERN_DIMENSION + 1,
    })).toBeNull();
    expect(parseCumulativeThresholdPatternDefinition({
      ...definition,
      toneMap: [
        { maxInput: 0.7, tone: 0.5 },
        { maxInput: 0.6, tone: 0.9 },
      ],
    })).toBeNull();
  });

  it('is periodic, cumulative, and keeps 255 pixels permanently inactive', async () => {
    const { runtime } = await makeFixture();
    expect(resolveCumulativeThreshold(runtime, 0, 0)).toBeCloseTo(16 / 254);
    expect(resolveCumulativeThreshold(runtime, 4, 3)).toBeCloseTo(16 / 254);
    expect(resolveCumulativeThreshold(runtime, -4, -3)).toBeCloseTo(16 / 254);
    expect(resolveCumulativeThreshold(runtime, 3, 0)).toBe(Number.POSITIVE_INFINITY);

    const activeCounts = [0.1, 0.5, 0.9].map((tone) => {
      let count = 0;
      for (let y = 0; y < runtime.definition.height; y += 1) {
        for (let x = 0; x < runtime.definition.width; x += 1) {
          if (isCumulativeThresholdActive(runtime, x, y, tone)) count += 1;
        }
      }
      return count;
    });
    expect(activeCounts[1]).toBeGreaterThan(activeCounts[0]);
    expect(activeCounts[2]).toBeGreaterThan(activeCounts[1]);
    expect(isCumulativeThresholdActive(runtime, 3, 0, 1)).toBe(false);
  });

  it('maps mark tone through data-only stages and registers by opaque id', async () => {
    const { runtime } = await makeFixture();
    expect(resolveCumulativePatternTone(runtime.definition, 0.2)).toBe(0.1);
    expect(resolveCumulativePatternTone(runtime.definition, 0.6)).toBe(0.5);
    expect(resolveCumulativePatternTone(runtime.definition, 0.8)).toBe(0.9);

    const registry = createDitherPatternRegistry();
    registry.register(runtime);
    expect(registry.resolve(runtime.definition.id)).toBe(runtime);
    expect(registry.list()).toEqual([runtime]);
    expect(() => registry.register({
      ...runtime,
      definition: {
        ...runtime.definition,
        payloadHash: `sha256:${'f'.repeat(64)}`,
      },
    })).toThrow('different content');
    registry.unregister(runtime.definition.id);
    expect(registry.resolve(runtime.definition.id)).toBeNull();
  });

  it('shares one synthetic payload across regular, CC Gradient, and CC Flat rendering', async () => {
    const { runtime } = await makeFixture();
    const resolver = createCumulativeThresholdResolver(runtime);
    const width = runtime.definition.width;
    const height = runtime.definition.height;
    const darkness = 0.6;
    const gray = Math.round((1 - darkness) * 255);
    const source = new Uint8ClampedArray(width * height * 4);
    for (let index = 0; index < source.length; index += 4) {
      source[index] = gray;
      source[index + 1] = gray;
      source[index + 2] = gray;
      source[index + 3] = 255;
    }
    const regular = applyPatternDither(new ImageData(source, width, height), {
      algorithm: 'pattern',
      pressure: 1,
      intensity: 1,
      bayerMatrixSize: 8,
      palette: [[0, 0, 0], [255, 255, 255]],
      patternStyle: 'image-tile',
      imageTileThresholdResolver: resolver,
    });

    const vertices = [
      { x: 0, y: 0 },
      { x: width - 1, y: 0 },
      { x: width - 1, y: height - 1 },
      { x: 0, y: height - 1 },
    ];
    const sampledStopsOverride = [
      { position: 0, color: `rgb(${gray}, ${gray}, ${gray})` },
      { position: 1, color: `rgb(${gray}, ${gray}, ${gray})` },
    ];
    const gradient = new Uint8Array(width * height);
    await fillCcGradientDither({
      vertices,
      minX: 0,
      minY: 0,
      maxX: width - 1,
      maxY: height - 1,
      pixelSize: 1,
      levels: 2,
      baseOffset: 0,
      algorithm: 'pattern',
      patternStyle: 'image-tile',
      imageTileThresholdResolver: resolver,
      sampledStopsOverride,
      sampleNormalized: () => darkness,
      writeIndex: (x, y, index) => {
        gradient[y * width + x] = index;
      },
    });

    const flat = new Uint8Array(width * height);
    await fillCcGradientDither({
      vertices,
      minX: 0,
      minY: 0,
      maxX: width - 1,
      maxY: height - 1,
      pixelSize: 1,
      levels: 64,
      baseOffset: 0,
      flatPairSpread: 40,
      algorithm: 'pattern',
      patternStyle: 'image-tile',
      imageTileThresholdResolver: resolver,
      sampledStopsOverride,
      flatCycle: true,
      sampleNormalized: () => 0.5,
      writeIndex: (x, y, index) => {
        flat[y * width + x] = index;
      },
    });
    const flatPair = resolveFlatCycleInkSetForPosition(128 / 255, 2, 0, 40).indices;

    for (let y = 0; y < height - 1; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const expectedActive = isCumulativeThresholdActive(runtime, x, y, darkness);
        const pixelIndex = y * width + x;
        expect(regular.data[pixelIndex * 4] === 0).toBe(expectedActive);
        expect(gradient[pixelIndex] === 128).toBe(expectedActive);
        expect(flat[pixelIndex] === flatPair[1]).toBe(expectedActive);
      }
    }
  });
});
