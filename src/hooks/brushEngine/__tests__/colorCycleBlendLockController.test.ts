import {
  createColorCycleTransparencyLockMaskCanvas,
  renderColorCycleWithBlendAndLock,
} from '../colorCycleBlendLockController';

describe('colorCycleBlendLockController', () => {
  it('builds a stable alpha mask from canonical CC paint occupancy', () => {
    const maskCanvas = createColorCycleTransparencyLockMaskCanvas({
      paintMask: new Uint8Array([0, 3, 0, 8]),
      width: 2,
      height: 2,
    });
    const maskCtx = maskCanvas?.getContext('2d', { willReadFrequently: true });

    expect(maskCtx).not.toBeNull();
    expect(Array.from(maskCtx!.getImageData(0, 0, 2, 2).data).filter(
      (_, index) => index % 4 === 3
    )).toEqual([0, 255, 0, 255]);
  });

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
    const frozenMaskCanvas = document.createElement('canvas');
    frozenMaskCanvas.width = 64;
    frozenMaskCanvas.height = 64;

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
      transparencyLockMaskCanvas: frozenMaskCanvas,
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
    expect(tempCtx.drawImage).toHaveBeenNthCalledWith(
      2,
      frozenMaskCanvas,
      0,
      0,
      64,
      64,
      0,
      0,
      64,
      64
    );
    expect(targetCtx.save).toHaveBeenCalled();
    expect(targetCtx.drawImage).toHaveBeenCalledWith(tempCanvas, 0, 0);
    expect(targetCtx.restore).toHaveBeenCalled();
    expect(alphaPresenceCacheRef.current).toEqual(expect.objectContaining({
      canvas: maskCanvas,
      hasAlpha: true,
    }));
  });
});
