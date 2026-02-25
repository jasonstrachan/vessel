import { renderColorCycleWithBlendAndLock } from '../colorCycleBlendLockController';

describe('colorCycleBlendLockController', () => {
  it('returns early when destination canvas has no size', () => {
    const targetCtx = {
      canvas: { width: 0, height: 0 },
      drawImage: jest.fn(),
      save: jest.fn(),
      restore: jest.fn(),
      globalCompositeOperation: 'source-over',
    } as unknown as CanvasRenderingContext2D;

    const acquire = jest.fn();
    const release = jest.fn();

    renderColorCycleWithBlendAndLock({
      targetCtx,
      sourceCanvas: document.createElement('canvas'),
      blendMode: 'source-over',
      activeLayerTransparencyLock: true,
      getActiveLayerBitmapCanvas: () => null,
      layerHasAnyAlpha: () => false,
      alphaPresenceCacheRef: { current: null },
      AL: jest.fn(),
      sampleMaskA: jest.fn(() => null),
      canvasPool: { acquire, release },
    });

    expect(acquire).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });

  it('applies alpha lock mask and updates alpha cache', () => {
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = 64;
    maskCanvas.height = 64;

    const tempCtx = {
      clearRect: jest.fn(),
      drawImage: jest.fn(),
      getImageData: jest.fn(() => ({ data: new Uint8ClampedArray([1, 2, 3, 4]) })),
      globalCompositeOperation: 'source-over',
    } as unknown as CanvasRenderingContext2D;

    const tempCanvas = {
      width: 64,
      height: 64,
      getContext: jest.fn(() => tempCtx),
    } as unknown as HTMLCanvasElement;

    const targetCtx = {
      canvas: { width: 64, height: 64 },
      drawImage: jest.fn(),
      save: jest.fn(),
      restore: jest.fn(),
      globalCompositeOperation: 'source-over',
    } as unknown as CanvasRenderingContext2D;

    const alphaPresenceCacheRef = { current: null as {
      canvas: HTMLCanvasElement | OffscreenCanvas;
      hasAlpha: boolean;
      sampledAt: number;
    } | null };

    renderColorCycleWithBlendAndLock({
      targetCtx,
      sourceCanvas: document.createElement('canvas'),
      blendMode: 'multiply',
      activeLayerTransparencyLock: true,
      getActiveLayerBitmapCanvas: () => maskCanvas,
      layerHasAnyAlpha: () => true,
      alphaPresenceCacheRef,
      AL: jest.fn(),
      sampleMaskA: jest.fn(() => 255),
      canvasPool: {
        acquire: jest.fn(() => tempCanvas),
        release: jest.fn(),
      },
    });

    expect(tempCtx.drawImage).toHaveBeenCalledTimes(2);
    expect(targetCtx.save).toHaveBeenCalled();
    expect(targetCtx.drawImage).toHaveBeenCalledWith(tempCanvas, 0, 0);
    expect(targetCtx.restore).toHaveBeenCalled();
    expect(alphaPresenceCacheRef.current).toEqual(expect.objectContaining({
      canvas: maskCanvas,
      hasAlpha: true,
    }));
  });
});

