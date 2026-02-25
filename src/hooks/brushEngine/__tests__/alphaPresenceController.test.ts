import { detectLayerHasAnyAlpha } from '../alphaPresenceController';

describe('alphaPresenceController', () => {
  const makeCacheRef = () => ({
    current: {
      canvas: null as HTMLCanvasElement | OffscreenCanvas | null,
      hasAlpha: true,
      sampledAt: 0,
    },
  });

  it('returns true and resets cache when there is no active mask canvas', () => {
    const cacheRef = makeCacheRef();
    cacheRef.current.canvas = document.createElement('canvas');
    cacheRef.current.hasAlpha = false;

    const result = detectLayerHasAnyAlpha({
      getMaskCanvas: () => null,
      alphaPresenceCacheRef: cacheRef,
      alphaProbeCanvasRef: { current: null },
      maxAlphaProbeSize: 256,
      pick2DRead: () => null,
      getNow: () => 100,
    });

    expect(result).toBe(true);
    expect(cacheRef.current.canvas).toBeNull();
    expect(cacheRef.current.hasAlpha).toBe(true);
    expect(cacheRef.current.sampledAt).toBe(100);
  });

  it('returns false for a fully transparent mask', () => {
    const mask = document.createElement('canvas');
    mask.width = 8;
    mask.height = 8;

    const result = detectLayerHasAnyAlpha({
      getMaskCanvas: () => mask,
      alphaPresenceCacheRef: makeCacheRef(),
      alphaProbeCanvasRef: { current: null },
      maxAlphaProbeSize: 256,
      pick2DRead: (canvas) => canvas?.getContext('2d') as CanvasRenderingContext2D,
      getNow: () => 10,
    });

    expect(result).toBe(false);
  });

  it('returns true when the mask contains alpha', () => {
    const mask = document.createElement('canvas');
    mask.width = 8;
    mask.height = 8;
    const ctx = mask.getContext('2d') as CanvasRenderingContext2D;
    ctx.fillStyle = 'rgba(255,0,0,1)';
    ctx.fillRect(2, 2, 1, 1);

    const result = detectLayerHasAnyAlpha({
      getMaskCanvas: () => mask,
      alphaPresenceCacheRef: makeCacheRef(),
      alphaProbeCanvasRef: { current: null },
      maxAlphaProbeSize: 256,
      pick2DRead: (canvas) => canvas?.getContext('2d') as CanvasRenderingContext2D,
      getNow: () => 10,
    });

    expect(result).toBe(true);
  });

  it('returns cached false result within TTL for the same canvas', () => {
    const mask = document.createElement('canvas');
    mask.width = 8;
    mask.height = 8;
    const cacheRef = makeCacheRef();
    cacheRef.current.canvas = mask;
    cacheRef.current.hasAlpha = false;
    cacheRef.current.sampledAt = 100;

    const pick2DRead = jest.fn(() => mask.getContext('2d') as CanvasRenderingContext2D);

    const result = detectLayerHasAnyAlpha({
      getMaskCanvas: () => mask,
      alphaPresenceCacheRef: cacheRef,
      alphaProbeCanvasRef: { current: null },
      maxAlphaProbeSize: 256,
      pick2DRead,
      getNow: () => 150,
    });

    expect(result).toBe(false);
    expect(pick2DRead).not.toHaveBeenCalled();
  });
});
