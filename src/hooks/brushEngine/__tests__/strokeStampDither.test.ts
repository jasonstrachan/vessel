import { applyStampDitherStamp, createStampDitherRuntime, resolveStampDitherTileSample } from '../strokeStampDither';

describe('strokeStampDither', () => {
  it('varies non-pattern sampling across tile blocks', () => {
    const size = 8;
    const tile = new Uint8Array(size * size);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        tile[y * size + x] = (x + y) % 2 === 0 ? 1 : 0;
      }
    }

    const seed = 12345;
    const originX = 0;
    const originY = 0;
    const samples: number[] = [];
    for (let block = 0; block < 8; block += 1) {
      const worldX = block * size + 2;
      const worldY = 3;
      samples.push(resolveStampDitherTileSample(tile, size, worldX, worldY, originX, originY, seed));
    }

    const unique = new Set(samples);
    expect(unique.size).toBeGreaterThan(1);
  });

  it('updates pressure-linked tile scale with pressure changes', () => {
    const width = 16;
    const height = 16;
    const animator = {
      beginDirectFill: () => ({
        data: new Uint8Array(width * height),
        gradientId: new Uint8Array(width * height),
        speedData: new Uint8Array(width * height),
        width,
        height,
      }),
      endDirectFill: jest.fn(),
      markDirtyBounds: jest.fn(),
      hasWebGL: jest.fn(() => false),
    };
    const state = {
      paintBuffer: new Uint8Array(width * height),
      gradientIdBuffer: new Uint8Array(width * height),
      speedBuffer: new Uint8Array(width * height),
      stampDitherStrokeScale: 1,
    };
    const config = {
      algorithm: 'sierra-lite' as const,
      pixelSize: 2,
      patternStyle: 'dots' as const,
      bgFill: true,
      pressureLinked: true,
      seed: 42,
    };
    const runtime = createStampDitherRuntime();

    applyStampDitherStamp({
      animator: animator as unknown as Parameters<typeof applyStampDitherStamp>[0]['animator'],
      state,
      config,
      runtime,
      stampShape: 'round',
      x: 6,
      y: 6,
      pressure: 0.2,
      pressureSize: 4,
      primaryIndex: 5,
      flowSlot: 1,
      cycleSpeed: 1,
      width,
      height,
      isAnimating: false,
    });
    const firstScale = state.stampDitherStrokeScale ?? 0;

    applyStampDitherStamp({
      animator: animator as unknown as Parameters<typeof applyStampDitherStamp>[0]['animator'],
      state,
      config,
      runtime,
      stampShape: 'round',
      x: 8,
      y: 8,
      pressure: 1.0,
      pressureSize: 4,
      primaryIndex: 5,
      flowSlot: 1,
      cycleSpeed: 1,
      width,
      height,
      isAnimating: false,
    });

    expect(state.stampDitherStrokeScale).toBeGreaterThanOrEqual(firstScale);
  });
});
