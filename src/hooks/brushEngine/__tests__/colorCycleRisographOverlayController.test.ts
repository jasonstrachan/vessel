import { applyColorCycleRisographOverlay } from '../colorCycleRisographOverlayController';

const createCtx = () => {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx: Partial<CanvasRenderingContext2D> = {
    canvas,
    save: jest.fn(),
    restore: jest.fn(),
    drawImage: jest.fn(),
    globalCompositeOperation: 'source-over',
    globalAlpha: 1,
    imageSmoothingEnabled: false,
  };
  return ctx as CanvasRenderingContext2D;
};

describe('colorCycleRisographOverlayController', () => {
  it('returns early when intensity is zero', () => {
    const ctx = createCtx();
    const source = document.createElement('canvas');
    const acquire = jest.fn();

    applyColorCycleRisographOverlay({
      ctx,
      sourceCanvas: source,
      outputOpacity: 1,
      brushSettings: {
        risographIntensity: 0,
        risographColorShift: 3,
        color: '#000',
        ditherEnabled: false,
      },
      canvasPool: { acquire, release: jest.fn() },
      getRisographPattern: jest.fn(() => null),
      getRisographEffectSettings: jest.fn(() => ({ alpha: 1, jitter: 1 })),
      getRisographFilter: jest.fn(() => 'none'),
      hashNumbers: jest.fn(() => 1),
      createSeededRng: jest.fn(() => () => 0.5),
    });

    expect(acquire).not.toHaveBeenCalled();
  });

  it('draws overlay and releases temp canvas', () => {
    const ctx = createCtx();
    const source = document.createElement('canvas');
    source.width = 32;
    source.height = 32;

    const tempCanvas = {
      width: 32,
      height: 32,
    } as unknown as HTMLCanvasElement;
    const tempCtx: Partial<CanvasRenderingContext2D> = {
      imageSmoothingEnabled: false,
      setTransform: jest.fn(),
      globalCompositeOperation: 'source-over',
      globalAlpha: 1,
      clearRect: jest.fn(),
      drawImage: jest.fn(),
      fillStyle: '#fff',
      fillRect: jest.fn(),
      translate: jest.fn(),
      rotate: jest.fn(),
      scale: jest.fn(),
      filter: 'none',
    };
    (tempCanvas as unknown as { getContext: (id: string, opts?: unknown) => CanvasRenderingContext2D | null }).getContext =
      jest.fn(() => tempCtx as CanvasRenderingContext2D);

    const acquire = jest.fn(() => tempCanvas);
    const release = jest.fn();

    applyColorCycleRisographOverlay({
      ctx,
      sourceCanvas: source,
      outputOpacity: 0.8,
      brushSettings: {
        risographIntensity: 50,
        risographColorShift: 3,
        color: '#123456',
        ditherEnabled: false,
      },
      canvasPool: { acquire, release },
      getRisographPattern: jest.fn(() => ({}) as CanvasPattern),
      getRisographEffectSettings: jest.fn(() => ({ alpha: 0.5, jitter: 1 })),
      getRisographFilter: jest.fn(() => 'none'),
      hashNumbers: jest.fn(() => 1),
      createSeededRng: jest.fn(() => () => 0.5),
    });

    expect(acquire).toHaveBeenCalled();
    expect((ctx.drawImage as jest.Mock)).toHaveBeenCalled();
    expect(release).toHaveBeenCalledWith(tempCanvas);
  });
});
