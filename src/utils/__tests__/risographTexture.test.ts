import { createForkableSeededRng, createSeededRng, getRisographEffectSettings } from '@/utils/risographTexture';

describe('getRisographEffectSettings', () => {
  it('returns zeroed settings when intensity is 0', () => {
    const effect = getRisographEffectSettings(0);
    expect(effect.alpha).toBe(0);
    expect(effect.jitter).toBe(0);
    expect(effect.outlineJitter).toBe(0);
  });

  it('grows alpha and jitter as intensity increases', () => {
    const low = getRisographEffectSettings(10);
    const mid = getRisographEffectSettings(50);
    const high = getRisographEffectSettings(100);

    expect(mid.alpha).toBeGreaterThan(low.alpha);
    expect(high.alpha).toBeGreaterThan(mid.alpha);

    expect(mid.jitter).toBeGreaterThan(low.jitter);
    expect(high.jitter).toBeGreaterThan(mid.jitter);
  });

  it('boosts alpha for pixel brushes relative to smooth brushes', () => {
    const smooth = getRisographEffectSettings(75, { isPixelBrush: false });
    const pixel = getRisographEffectSettings(75, { isPixelBrush: true });

    expect(pixel.alpha).toBeGreaterThan(smooth.alpha);
    expect(pixel.outlineJitter).toBeLessThanOrEqual(smooth.outlineJitter * 1.05);
  });
});


describe('forkable native risograph randomness', () => {
  const expected = [
    0.9797282677609473, 0.3067522644996643, 0.484205421525985,
    0.817934412509203, 0.5094283693470061, 0.34747186047025025,
  ];

  it('preserves fixed legacy seeded values and uses the same sequence in a forkable stream', () => {
    const legacy = createSeededRng(12345);
    const stream = createForkableSeededRng(12345);
    expect(Array.from({ length: 6 }, () => legacy())).toEqual(expected);
    expect(Array.from({ length: 6 }, () => stream.next())).toEqual(expected);
  });

  it('copies current state without advancing its parent or siblings, including discarded forks', () => {
    const stream = createForkableSeededRng(12345);
    expect(stream.next()).toBe(expected[0]);
    const first = stream.fork();
    const sibling = stream.fork();
    expect(first.next()).toBe(expected[1]);
    expect(first.next()).toBe(expected[2]);
    for (let index = 0; index < 100; index += 1) {
      const discarded = stream.fork();
      discarded.next();
      discarded.next();
    }
    expect(sibling.next()).toBe(expected[1]);
    expect(stream.next()).toBe(expected[1]);
    expect(stream.next()).toBe(expected[2]);
    expect(first.next()).toBe(expected[3]);
  });

  it('treats zero as a valid new stream and fork state', () => {
    const stream = createForkableSeededRng(0);
    const fork = stream.fork();
    expect(fork.next()).toBe(0.26642920868471265);
    expect(stream.next()).toBe(0.26642920868471265);
    expect(stream.next()).toBe(0.0003297457005828619);
    expect(fork.next()).toBe(0.0003297457005828619);
  });

  it('keeps fixed BASE_SEED pattern commands and context caching on the legacy texture stream', () => {
    const random = jest.spyOn(Math, 'random').mockReturnValue(0.25);
    let firstDot: number[] | null = null;
    let firstDotInk: string | CanvasGradient | CanvasPattern | null = null;
    const pattern = {} as CanvasPattern;
    const context: Partial<CanvasRenderingContext2D> = {
      fillStyle: '',
      fillRect: () => undefined,
      beginPath: () => undefined,
      arc: (x, y, radius) => {
        if (!firstDot) firstDot = [x, y, radius];
      },
      fill: () => {
        if (!firstDotInk) firstDotInk = context.fillStyle ?? null;
      },
      createPattern: jest.fn(() => pattern),
    };
    const canvasPrototype: {
      getContext: (contextId: '2d', options?: CanvasRenderingContext2DSettings) => CanvasRenderingContext2D | null;
    } = HTMLCanvasElement.prototype;
    const getContext = jest.spyOn(canvasPrototype, 'getContext')
      .mockReturnValue(context as CanvasRenderingContext2D);
    try {
      jest.isolateModules(() => {
        const isolated = jest.requireActual<typeof import('@/utils/risographTexture')>('@/utils/risographTexture');
        const ctx = context as CanvasRenderingContext2D;
        expect(isolated.getRisographPattern(ctx)).toBe(pattern);
        expect(isolated.getRisographPattern(ctx)).toBe(pattern);
        expect(context.createPattern).toHaveBeenCalledTimes(1);
        expect(random).toHaveBeenCalledTimes(1);
        expect(firstDot).toEqual([200.28972244262695, 197.1228209733963, 1.8143555062822998]);
        expect(firstDotInk).toBe('rgba(0, 0, 0, 0.36969478444661946)');
      });
    } finally {
      getContext.mockRestore();
      random.mockRestore();
    }
  });

  it('keeps legacy zero-seed fallback and BASE_SEED acquisition unchanged', () => {
    const random = jest.spyOn(Math, 'random').mockReturnValue(0.25);
    try {
      jest.isolateModules(() => {
        const isolated = jest.requireActual<typeof import('@/utils/risographTexture')>('@/utils/risographTexture');
        const legacy = isolated.createSeededRng(0);
        expect(Array.from({ length: 3 }, () => legacy())).toEqual([
          0.39119086414575577, 0.38500550971366465, 0.936559634283185,
        ]);
        expect(random).toHaveBeenCalledTimes(1);
      });
    } finally {
      random.mockRestore();
    }
  });
});
