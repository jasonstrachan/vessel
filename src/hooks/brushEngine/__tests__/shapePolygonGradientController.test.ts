import { drawPolygonGradient, type DrawPolygonGradientArgs } from '../shapePolygonGradientController';
import { spreadPaletteColors } from '../engineShared';
import type { BrushSettings } from '@/types';

jest.mock('@/utils/debug', () => ({
  debugWarn: jest.fn(),
}));

import { debugWarn } from '@/utils/debug';

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
    drawImage: jest.fn(),
    globalAlpha: 1,
    imageSmoothingEnabled: false,
    createLinearGradient: jest.fn(() => gradient.gradient),
  };
  return ctx as MockCtx;
};

const createDefaultArgs = (): DrawPolygonGradientArgs => {
  const ctx = createMockCtx();

  return {
    ctx,
    polygonData: {
      vertices: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
      colors: ['#ff0000', '#00ff00', '#0000ff', '#ffff00'],
    },
    isPreview: false,
    brushSettings: {
      opacity: 0.8,
      color: '#123456',
      ditherEnabled: false,
      risographIntensity: 0,
      colors: 4,
      gradientBands: 2,
      fillResolution: 1,
      ditherAlgorithm: 'sierra-lite',
      patternStyle: 'dots',
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
    >,
    withTransparencyLock: jest.fn((_ctx: CanvasRenderingContext2D, draw: () => void) => draw()),
    setBlendIfUnlocked: jest.fn(),
    canvasPool: {
      acquire: jest.fn(() => document.createElement('canvas')),
      release: jest.fn(),
    },
    applyDithering: jest.fn((imageData: ImageData) => imageData),
    applyDitheringWithFillResolution: jest.fn((imageData: ImageData) => imageData),
    applyRisographEffect: jest.fn(),
  };
};

describe('shapePolygonGradientController', () => {
  it('warns and returns for insufficient vertices', () => {
    const args = createDefaultArgs();
    args.polygonData = { vertices: [{ x: 0, y: 0 }, { x: 1, y: 1 }], colors: [] };

    drawPolygonGradient(args);

    expect(debugWarn).toHaveBeenCalledWith('raw-console', '[drawPolygonGradient] Skipping - insufficient vertices:', 2);
    expect(args.withTransparencyLock).not.toHaveBeenCalled();
  });

  it('creates banded stops for main gradient when gradientBands is enabled', () => {
    const args = createDefaultArgs();
    const mainGradient = createGradientRecorder();
    (args.ctx.createLinearGradient as unknown as jest.Mock).mockImplementation(() => mainGradient.gradient);

    drawPolygonGradient(args);

    expect(mainGradient.stops).toEqual([
      { position: 0, color: '#ff0000' },
      { position: 0.499, color: '#ff0000' },
      { position: 0.5, color: '#0000ff' },
      { position: 1, color: '#0000ff' },
    ]);
  });

  it('uses fill-resolution dither path and applies risograph effect', () => {
    const args = createDefaultArgs();
    args.brushSettings.ditherEnabled = true;
    args.brushSettings.fillResolution = 3;
    args.brushSettings.risographIntensity = 20;

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
      save: jest.fn(),
      restore: jest.fn(),
      beginPath: jest.fn(),
      moveTo: jest.fn(),
      lineTo: jest.fn(),
      closePath: jest.fn(),
      fill: jest.fn(),
      globalCompositeOperation: 'source-over',
      lineJoin: 'miter',
      lineCap: 'butt',
      imageSmoothingEnabled: false,
      fillStyle: '#fff',
    };

    const tempCanvas = {
      width: 14,
      height: 14,
      getContext: jest.fn(() => tempCtx as CanvasRenderingContext2D),
    } as unknown as HTMLCanvasElement;

    args.canvasPool.acquire = jest.fn(() => tempCanvas);

    drawPolygonGradient(args);

    expect(args.applyDitheringWithFillResolution).toHaveBeenCalledTimes(1);
    expect(args.applyDitheringWithFillResolution).toHaveBeenCalledWith(
      imageData,
      2,
      3,
      'sierra-lite',
      'dots',
      ['#ff0000', '#00ff00', '#0000ff', '#ffff00']
    );
    expect(args.applyDithering).not.toHaveBeenCalled();
    expect(args.applyRisographEffect).toHaveBeenCalledTimes(1);
    expect(args.canvasPool.release).toHaveBeenCalledWith(tempCanvas);
  });

  it('reuses ditherPaletteSpread for sampled polygon palettes', () => {
    const args = createDefaultArgs();
    args.brushSettings.ditherEnabled = true;
    args.brushSettings.fillResolution = 1;
    args.brushSettings.ditherPaletteSpread = 70;

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
      save: jest.fn(),
      restore: jest.fn(),
      beginPath: jest.fn(),
      moveTo: jest.fn(),
      lineTo: jest.fn(),
      closePath: jest.fn(),
      fill: jest.fn(),
      globalCompositeOperation: 'source-over',
      lineJoin: 'miter',
      lineCap: 'butt',
      imageSmoothingEnabled: false,
      fillStyle: '#fff',
    };

    const tempCanvas = {
      width: 14,
      height: 14,
      getContext: jest.fn(() => tempCtx as CanvasRenderingContext2D),
    } as unknown as HTMLCanvasElement;

    args.canvasPool.acquire = jest.fn(() => tempCanvas);

    drawPolygonGradient(args);

    expect(args.applyDithering).toHaveBeenCalledWith(
      imageData,
      2,
      'sierra-lite',
      'dots',
      spreadPaletteColors(['#ff0000', '#00ff00', '#0000ff', '#ffff00'], 70)
    );
  });
});
