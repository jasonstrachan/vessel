import { applyAlphaLockToPaint } from '../alphaLockController';

describe('alphaLockController', () => {
  it('paints directly when transparency lock is disabled', () => {
    const paint = jest.fn();
    const dstCtx = {
      canvas: { width: 64, height: 64 },
      getImageData: jest.fn(),
    } as unknown as CanvasRenderingContext2D;

    const acquire = jest.fn();
    const release = jest.fn();

    applyAlphaLockToPaint({
      dstCtx,
      paint,
      activeLayerTransparencyLock: false,
      alphaLockEmptyMaskWarnedRef: { current: true },
      getActiveLayerBitmapCanvas: () => null,
      layerHasAnyAlpha: () => false,
      getAlphaLockDebugLevel: () => 0,
      getStateSnapshot: () => ({ activeLayerId: null, layers: [] }),
      normalizeRectForCanvas: () => ({ x: 0, y: 0, width: 1, height: 1 }),
      sampleRGBA: jest.fn(() => null),
      canvasPool: { acquire, release },
      blendMode: 'source-over',
      alphaPresenceCacheRef: { current: { canvas: null, hasAlpha: true, sampledAt: 0 } },
      AL: jest.fn(),
    });

    expect(paint).toHaveBeenCalledWith(dstCtx);
    expect(acquire).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });

  it('composites through mask when lock is enabled and mask has alpha', () => {
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = 64;
    maskCanvas.height = 64;

    const scratchCtx = {
      clearRect: jest.fn(),
      save: jest.fn(),
      restore: jest.fn(),
      translate: jest.fn(),
      drawImage: jest.fn(),
      getImageData: jest.fn(() => ({ data: new Uint8ClampedArray([0, 0, 0, 255]) })),
      globalCompositeOperation: 'source-over',
    } as unknown as CanvasRenderingContext2D;

    const scratchCanvas = {
      width: 64,
      height: 64,
      getContext: jest.fn(() => scratchCtx),
    } as unknown as HTMLCanvasElement;

    const dstCtx = {
      canvas: { width: 64, height: 64 },
      getImageData: jest.fn(() => ({ data: new Uint8ClampedArray([0, 0, 0, 255]) })),
      save: jest.fn(),
      restore: jest.fn(),
      drawImage: jest.fn(),
      globalCompositeOperation: 'source-over',
    } as unknown as CanvasRenderingContext2D;

    const alphaPresenceCacheRef = { current: { canvas: null, hasAlpha: false, sampledAt: 0 } };
    const paint = jest.fn();
    const release = jest.fn();

    applyAlphaLockToPaint({
      dstCtx,
      paint,
      activeLayerTransparencyLock: true,
      alphaLockEmptyMaskWarnedRef: { current: false },
      getActiveLayerBitmapCanvas: () => maskCanvas,
      layerHasAnyAlpha: () => true,
      getAlphaLockDebugLevel: () => 0,
      getStateSnapshot: () => ({ activeLayerId: 'layer-1', layers: [{ id: 'layer-1' }] }),
      normalizeRectForCanvas: () => ({ x: 0, y: 0, width: 64, height: 64 }),
      sampleRGBA: jest.fn(() => [0, 0, 0, 255]),
      canvasPool: {
        acquire: jest.fn(() => scratchCanvas),
        release,
      },
      blendMode: 'multiply',
      alphaPresenceCacheRef,
      AL: jest.fn(),
    });

    expect(paint).toHaveBeenCalled();
    expect(scratchCtx.drawImage).toHaveBeenCalled();
    expect(dstCtx.drawImage).toHaveBeenCalledWith(scratchCanvas, 0, 0);
    expect(alphaPresenceCacheRef.current).toEqual(expect.objectContaining({
      canvas: maskCanvas,
      hasAlpha: true,
    }));
    expect(release).toHaveBeenCalledWith(scratchCanvas);
  });
});

