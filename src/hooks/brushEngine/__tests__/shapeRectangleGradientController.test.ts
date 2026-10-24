import {
  drawRectangleGradient,
  type DrawRectangleGradientArgs,
} from '../shapeRectangleGradientController';
import { spreadPaletteColors } from '../engineShared';
import * as lostEdgeErosion from '@/shapeFill/lostEdgeErosion';
import * as rectangleDithering from '../dithering';
import * as customTilePattern from '@/utils/colorCycle/ccCustomTilePattern';
import type { BrushSettings } from '@/types';

const createGradientRecorder = () => {
  const stops: Array<{ position: number; color: string }> = [];
  return {
    stops,
    gradient: {
      addColorStop: jest.fn((position: number, color: string) => {
        stops.push({ position, color });
      }),
    } as unknown as CanvasGradient,
  };
};

type MockCtx = CanvasRenderingContext2D & {
  createLinearGradient: jest.Mock;
};

const createMockCtx = (): MockCtx => {
  const gradient = createGradientRecorder();
  const ctx: Partial<CanvasRenderingContext2D> = {
    save: jest.fn(),
    restore: jest.fn(),
    beginPath: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    closePath: jest.fn(),
    fill: jest.fn(),
    clip: jest.fn(),
    drawImage: jest.fn(),
    translate: jest.fn(),
    rotate: jest.fn(),
    scale: jest.fn(),
    fillRect: jest.fn(),
    globalAlpha: 1,
    imageSmoothingEnabled: false,
    filter: 'none',
    createLinearGradient: jest.fn(() => gradient.gradient),
  };
  return ctx as MockCtx;
};

const createDefaultArgs = (): DrawRectangleGradientArgs => {
  const ctx = createMockCtx();
  const applyDithering = jest.fn((imageData: ImageData) => imageData);
  const applyDitheringWithFillResolution = jest.fn((imageData: ImageData) => imageData);
  const withTransparencyLock = jest.fn((_ctx: CanvasRenderingContext2D, draw: () => void) => draw());

  return {
    ctx,
    startX: 2,
    startY: 2,
    endX: 10,
    endY: 2,
    width: 4,
    colors: ['#111111', '#222222'],
    isPreview: false,
    isPixelBrush: false,
    brushSettings: {
      opacity: 0.75,
      color: '#123456',
      ditherEnabled: false,
      risographIntensity: 0,
      colors: 2,
      gradientBands: 0,
      fillResolution: 1,
      ditherAlgorithm: 'sierra-lite',
      patternStyle: 'dots',
      risographColorShift: 3,
    } satisfies Pick<
      BrushSettings,
      | 'opacity'
      | 'color'
      | 'ditherEnabled'
      | 'risographIntensity'
      | 'colors'
      | 'gradientBands'
      | 'fillResolution'
      | 'ditherAlgorithm'
      | 'patternStyle'
      | 'ditherPaletteSpread'
      | 'risographColorShift'
    >,
    withTransparencyLock,
    setBlendIfUnlocked: jest.fn(),
    setMultiplyIfUnlocked: jest.fn(),
    applyDithering,
    applyDitheringWithFillResolution,
    canvasPool: {
      acquire: jest.fn(() => document.createElement('canvas')),
      release: jest.fn(),
    },
    getRisographPattern: jest.fn(() => null),
    getRisographEffectSettings: jest.fn(() => ({ alpha: 0.2, jitter: 1 })),
    getRisographFilter: jest.fn(() => 'none'),
    createSeededRng: jest.fn(() => () => 0.5),
    hashNumbers: jest.fn(() => 123),
    createRisoTintMask: jest.fn(() => undefined),
  };
};

describe('shapeRectangleGradientController', () => {
  it('uses fallback brush color when colors array is empty', () => {
    const args = createDefaultArgs();
    args.colors = [];

    const gradient = createGradientRecorder();
    (args.ctx.createLinearGradient as unknown as jest.Mock).mockImplementation(() => gradient.gradient);

    drawRectangleGradient(args);

    expect(gradient.stops).toEqual([
      { position: 0, color: '#123456' },
      { position: 1, color: '#123456' },
    ]);
    expect(args.withTransparencyLock).toHaveBeenCalledTimes(1);
    expect(args.setBlendIfUnlocked).toHaveBeenCalledTimes(1);
  });

  it('returns early for zero-length rectangle geometry', () => {
    const args = createDefaultArgs();
    args.endX = args.startX;
    args.endY = args.startY;

    drawRectangleGradient(args);

    expect(args.withTransparencyLock).not.toHaveBeenCalled();
    expect(args.ctx.fill).not.toHaveBeenCalled();
  });

  it('skips dithering branch in preview mode', () => {
    const args = createDefaultArgs();
    args.isPreview = true;
    args.brushSettings.ditherEnabled = true;

    drawRectangleGradient(args);

    expect(args.applyDithering).not.toHaveBeenCalled();
    expect(args.applyDitheringWithFillResolution).not.toHaveBeenCalled();
    expect(args.canvasPool.acquire).not.toHaveBeenCalled();
  });

  it('uses fill-resolution dithering path when fillResolution > 1', () => {
    const args = createDefaultArgs();
    args.brushSettings.ditherEnabled = true;
    args.brushSettings.fillResolution = 3;

    const mainGradient = createGradientRecorder();
    const localGradient = createGradientRecorder();
    (args.ctx.createLinearGradient as unknown as jest.Mock)
      .mockImplementationOnce(() => mainGradient.gradient)
      .mockImplementationOnce(() => localGradient.gradient);

    const imageData = new ImageData(new Uint8ClampedArray(16 * 16 * 4), 16, 16);
    const tempCtx: Partial<CanvasRenderingContext2D> = {
      clearRect: jest.fn(),
      createLinearGradient: jest.fn(() => localGradient.gradient),
      fillRect: jest.fn(),
      getImageData: jest.fn(() => imageData),
      putImageData: jest.fn(),
    };
    const tempCanvas = {
      getContext: jest.fn(() => tempCtx as CanvasRenderingContext2D),
    } as unknown as HTMLCanvasElement;

    args.canvasPool.acquire = jest.fn(() => tempCanvas);

    drawRectangleGradient(args);

    expect(args.applyDitheringWithFillResolution).toHaveBeenCalledTimes(1);
    expect(args.applyDithering).not.toHaveBeenCalled();
    expect(args.applyDitheringWithFillResolution).toHaveBeenCalledWith(
      imageData,
      2,
      3,
      'sierra-lite',
      'dots',
      ['#111111', '#222222'],
      undefined,
      undefined,
      { diversity: 1, seed: 0 },
    );
    expect(args.canvasPool.release).toHaveBeenCalledWith(tempCanvas);
  });

  it('reuses ditherPaletteSpread for rectangle gradient dithering palettes', () => {
    const args = createDefaultArgs();
    args.brushSettings.ditherEnabled = true;
    args.brushSettings.ditherPaletteSpread = 65;

    const mainGradient = createGradientRecorder();
    const localGradient = createGradientRecorder();
    (args.ctx.createLinearGradient as unknown as jest.Mock)
      .mockImplementationOnce(() => mainGradient.gradient)
      .mockImplementationOnce(() => localGradient.gradient);

    const imageData = new ImageData(new Uint8ClampedArray(16 * 16 * 4), 16, 16);
    const tempCtx: Partial<CanvasRenderingContext2D> = {
      clearRect: jest.fn(),
      createLinearGradient: jest.fn(() => localGradient.gradient),
      fillRect: jest.fn(),
      getImageData: jest.fn(() => imageData),
      putImageData: jest.fn(),
    };
    const tempCanvas = {
      getContext: jest.fn(() => tempCtx as CanvasRenderingContext2D),
    } as unknown as HTMLCanvasElement;

    args.canvasPool.acquire = jest.fn(() => tempCanvas);

    drawRectangleGradient(args);

    expect(args.applyDithering).toHaveBeenCalledWith(
      imageData,
      2,
      'sierra-lite',
      'dots',
      spreadPaletteColors(['#111111', '#222222'], 65),
      undefined,
      undefined,
      { diversity: 1, seed: 0 },
    );
  });
});


describe('Rectangle Gradient Lostedge', () => {
  let erosion: jest.SpyInstance;

  beforeEach(() => {
    erosion = jest.spyOn(lostEdgeErosion, 'applyLostEdgeErosionToContext').mockImplementation(() => {});
  });

  afterEach(() => {
    erosion.mockRestore();
  });

  const argsWithLostedge = (percent: number) => {
    const args = createDefaultArgs();
    Object.assign(args.brushSettings, { lostEdge: percent });
    Object.defineProperty(args.ctx, 'canvas', { value: { width: 256, height: 256 } });
    return args;
  };

  it.each([false, true])('leaves preview and Lostedge0 on the existing drawing path (preview=%s)', preview => {
    const args = argsWithLostedge(preview ? 100 : 0);
    args.isPreview = preview;
    if (preview) Object.assign(args.brushSettings, { ditherEnabled: true, risographIntensity: 40 });
    drawRectangleGradient(args);
    expect(erosion).not.toHaveBeenCalled();
    expect(args.applyDithering).not.toHaveBeenCalled();
    expect(args.applyDitheringWithFillResolution).not.toHaveBeenCalled();
    expect(args.getRisographPattern).not.toHaveBeenCalled();
    expect(args.ctx.fill).toHaveBeenCalledTimes(1);
    expect(args.ctx.save).toHaveBeenCalledTimes(1);
    expect(args.ctx.restore).toHaveBeenCalledTimes(1);
  });

  it('erodes the exact unrounded oriented final rectangle once', () => {
    const args = argsWithLostedge(100);
    Object.assign(args, { startX: 40.25, startY: 40.5, endX: 100.25, endY: 120.5, width: 20 });
    args.brushSettings.fillResolution = 3;
    drawRectangleGradient(args);
    expect(erosion).toHaveBeenCalledTimes(1);
    expect(erosion).toHaveBeenCalledWith(args.ctx,
      [{ x: 32.25, y: 46.5 }, { x: 48.25, y: 34.5 }, { x: 108.25, y: 114.5 }, { x: 92.25, y: 126.5 }],
      { minX: 32.25, minY: 34.5, maxX: 108.25, maxY: 126.5 }, 4, 100, 3);
  });

  it.each([1, 4])('erodes after final dither and Riso without changing their palette contracts (Res=%s)', resolution => {
    const args = argsWithLostedge(100);
    Object.assign(args, { startX: 32, startY: 64, endX: 160, endY: 64, width: 64 });
    Object.assign(args.brushSettings, { ditherEnabled: true, fillResolution: resolution, risographIntensity: 40 });
    args.getRisographPattern = jest.fn(() => ({} as CanvasPattern));
    const tempCtx = { clearRect: jest.fn(), createLinearGradient: jest.fn(() => createGradientRecorder().gradient),
      fillRect: jest.fn(), getImageData: jest.fn(() => new ImageData(128, 64)), putImageData: jest.fn() };
    args.canvasPool.acquire = jest.fn(() => ({ getContext: () => tempCtx } as unknown as HTMLCanvasElement));
    drawRectangleGradient(args);
    const dither = (resolution === 1 ? args.applyDithering : args.applyDitheringWithFillResolution) as jest.Mock;
    expect(dither).toHaveBeenCalledTimes(1);
    expect(dither.mock.calls[0][resolution === 1 ? 4 : 5]).toEqual(['#111111', '#222222']);
    expect(args.getRisographPattern).toHaveBeenCalledTimes(1);
    expect(erosion).toHaveBeenCalledTimes(1);
    expect(erosion.mock.invocationCallOrder[0]).toBeGreaterThan(dither.mock.invocationCallOrder[0]);
    expect(erosion.mock.invocationCallOrder[0]).toBeGreaterThan((args.ctx.fillRect as jest.Mock).mock.invocationCallOrder.at(-1)!);
    expect(args.ctx.restore).toHaveBeenCalledTimes((args.ctx.save as jest.Mock).mock.calls.length);
  });

  it('keeps the tiny-Riso skip from bypassing erosion or leaking canvas state', () => {
    const args = argsWithLostedge(100);
    Object.assign(args, { startX: 2, startY: 2, endX: 4, endY: 2, width: 2 });
    args.brushSettings.risographIntensity = 40;
    args.getRisographPattern = jest.fn(() => ({} as CanvasPattern));
    drawRectangleGradient(args);
    expect(erosion).toHaveBeenCalledTimes(1);
    expect(args.ctx.fillRect).not.toHaveBeenCalled();
    expect(args.ctx.restore).toHaveBeenCalledTimes((args.ctx.save as jest.Mock).mock.calls.length);
  });

  it('does not read back pixels for a rectangle entirely outside the canvas', () => {
    const args = argsWithLostedge(100);
    Object.assign(args, { startX: 300, startY: 300, endX: 400, endY: 300, width: 20 });
    drawRectangleGradient(args);
    expect(erosion).not.toHaveBeenCalled();
  });
});


describe('Rectangle Gradient Sierra Variety', () => {
  const ditherArgs = (resolution: number, diversity?: number) => {
    const args = createDefaultArgs();
    Object.assign(args, { startX: 32, startY: 64, endX: 160, endY: 64, width: 64 });
    Object.assign(args.brushSettings, { ditherEnabled: true, fillResolution: resolution, ditherPatternDiversity: diversity });
    const image = new ImageData(128, 64);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 128; x++) {
      const i = (y * 128 + x) * 4, value = Math.round(x * 255 / 127);
      image.data.set([value, value, value, 255], i);
    }
    const output = jest.fn();
    const tempCtx = { clearRect: jest.fn(), createLinearGradient: jest.fn(() => createGradientRecorder().gradient),
      fillRect: jest.fn(), getImageData: () => new ImageData(image.data.slice(), 128, 64), putImageData: output };
    args.canvasPool.acquire = jest.fn(() => ({ getContext: () => tempCtx } as unknown as HTMLCanvasElement));
    return { args, image, output };
  };

  it.each([1, 4].flatMap(resolution => [0, 100].map(diversity => ({ resolution, diversity }))))(
    'forwards Sierra Variety$diversity after the tile resolver for Res$resolution', ({ resolution, diversity }) => {
      const { args } = ditherArgs(resolution, diversity);
      drawRectangleGradient(args);
      const called = (resolution === 1 ? args.applyDithering : args.applyDitheringWithFillResolution) as jest.Mock;
      expect(called).toHaveBeenCalledTimes(1);
      expect(called.mock.calls[0].slice(resolution === 1 ? 5 : 6)).toEqual([
        undefined, undefined, { diversity: diversity / 100, seed: 0 },
      ]);
    },
  );

  it.each([1, 4])('changes real BW Sierra material with stable repeated Variety0 and unchanged alpha (Res=%s)', resolution => {
    const paint = (diversity: number) => {
      const { args, output } = ditherArgs(resolution, diversity);
      args.colors = ['#000000', '#ffffff'];
      args.applyDithering = rectangleDithering.applyDithering;
      args.applyDitheringWithFillResolution = rectangleDithering.applyDitheringWithFillResolution;
      drawRectangleGradient(args);
      return output.mock.calls[0][0] as ImageData;
    };
    const zero = paint(0), repeat = paint(0), full = paint(100);
    expect(repeat.data).toEqual(zero.data);
    expect(full.data).not.toEqual(zero.data);
    for (const image of [zero, full]) {
      const colors = new Set<number>();
      for (let i = 0; i < image.data.length; i += 4) {
        colors.add(image.data[i]);
        expect(image.data[i + 3]).toBe(255);
        expect(image.data[i]).toBe(image.data[i + 1]);
        expect(image.data[i]).toBe(image.data[i + 2]);
      }
      expect([...colors].sort((a, b) => a - b)).toEqual([0, 255]);
    }
  });

  it.each([1, 4])('keeps non-Sierra custom tile resolver in its existing argument position (Res=%s)', resolution => {
    const resolver = () => .5;
    const tile = jest.spyOn(customTilePattern, 'createCcCustomTileThresholdResolver').mockReturnValue(resolver);
    try {
      const { args } = ditherArgs(resolution, 100);
      Object.assign(args.brushSettings, { ditherAlgorithm: 'bayer', patternStyle: 'image-tile' });
      drawRectangleGradient(args);
      const called = (resolution === 1 ? args.applyDithering : args.applyDitheringWithFillResolution) as jest.Mock;
      expect(called.mock.calls[0].slice(resolution === 1 ? 5 : 6)).toEqual([undefined, resolver]);
    } finally { tile.mockRestore(); }
  });
});
