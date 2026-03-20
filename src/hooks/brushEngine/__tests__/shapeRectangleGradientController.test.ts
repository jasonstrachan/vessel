import {
  drawRectangleGradient,
  type DrawRectangleGradientArgs,
} from '../shapeRectangleGradientController';
import { spreadPaletteColors } from '../engineShared';
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
      ['#111111', '#222222']
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
      spreadPaletteColors(['#111111', '#222222'], 65)
    );
  });
});
