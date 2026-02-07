import { applyRisographEffect, type ApplyRisographEffectArgs } from '../shapeRisographEffect';

const createMockCtx = () => {
  const ctx: Partial<CanvasRenderingContext2D> = {
    save: jest.fn(),
    restore: jest.fn(),
    beginPath: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    closePath: jest.fn(),
    clip: jest.fn(),
    translate: jest.fn(),
    rotate: jest.fn(),
    scale: jest.fn(),
    fillRect: jest.fn(),
    drawImage: jest.fn(),
    globalAlpha: 1,
    filter: 'none',
  };

  return ctx as CanvasRenderingContext2D;
};

const createArgs = (): ApplyRisographEffectArgs => {
  const ctx = createMockCtx();
  return {
    ctx,
    vertices: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ],
    risographIntensity: 40,
    isPixelBrush: false,
    brushColor: '#123456',
    risographColorShift: 3,
    setMultiplyIfUnlocked: jest.fn(),
    canvasPool: {
      acquire: jest.fn(() => document.createElement('canvas')),
      release: jest.fn(),
    },
    getRisographPattern: jest.fn(() => ({}) as CanvasPattern),
    getRisographEffectSettings: jest.fn(() => ({ alpha: 0.3, jitter: 1 })),
    getRisographFilter: jest.fn(() => 'none'),
    createSeededRng: jest.fn(() => () => 0.5),
    hashNumbers: jest.fn(() => 123),
    createRisoTintMask: jest.fn(() => undefined),
  };
};

describe('shapeRisographEffect', () => {
  it('returns immediately when no pattern is available', () => {
    const args = createArgs();
    args.getRisographPattern = jest.fn(() => null as CanvasPattern | null);

    applyRisographEffect(args);

    expect(args.ctx.save).not.toHaveBeenCalled();
  });

  it('restores and exits when effect alpha is non-positive', () => {
    const args = createArgs();
    args.getRisographEffectSettings = jest.fn(() => ({ alpha: 0, jitter: 1 }));

    applyRisographEffect(args);

    expect(args.ctx.save).toHaveBeenCalledTimes(1);
    expect(args.ctx.restore).toHaveBeenCalledTimes(1);
    expect(args.ctx.fillRect).not.toHaveBeenCalled();
  });

  it('restores and exits for tiny bounds', () => {
    const args = createArgs();
    args.vertices = [
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 2, y: 2 },
    ];

    applyRisographEffect(args);

    expect(args.ctx.save).toHaveBeenCalledTimes(1);
    expect(args.ctx.restore).toHaveBeenCalledTimes(1);
    expect(args.ctx.fillRect).not.toHaveBeenCalled();
  });
});
