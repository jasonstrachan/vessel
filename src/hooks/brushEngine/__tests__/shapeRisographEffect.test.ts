import { BrushShape } from '@/types';
import * as risographTexture from '@/utils/risographTexture';
import { drawShape } from '../shapes';
import { applyRisographEffect, applyRisographTexture, getNativeRisographStampRadius, type ApplyRisographEffectArgs } from '../shapeRisographEffect';

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


describe('native risograph texture randomness', () => {
  beforeEach(() => {
    jest.spyOn(risographTexture, 'getRisographPattern').mockReturnValue({} as CanvasPattern);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const createNativeContext = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.globalAlpha = 0.4;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#123456';
    ctx.imageSmoothingEnabled = false;
    jest.spyOn(ctx, 'fillRect');
    jest.spyOn(ctx, 'save');
    jest.spyOn(ctx, 'restore');
    return ctx;
  };

  it.each(['intensity', 'pattern', 'effect'] as const)('does not read randomness before the %s guard passes', (guard) => {
    const ctx = createNativeContext();
    const provider = jest.fn(() => 0.5);
    const globalRandom = jest.spyOn(Math, 'random');
    if (guard === 'pattern') {
      jest.mocked(risographTexture.getRisographPattern).mockReturnValue(null);
    }
    if (guard === 'effect') {
      jest.spyOn(risographTexture, 'getRisographEffectSettings').mockReturnValue({ alpha: 0, jitter: 3, outlineJitter: 1 });
    }
    applyRisographTexture(ctx, 10, 20, 20, guard === 'intensity' ? 0 : 100, null, provider);
    expect(provider).not.toHaveBeenCalled();
    expect(globalRandom).not.toHaveBeenCalled();
    expect(ctx.fillRect).not.toHaveBeenCalled();
    expect(ctx.globalAlpha).toBe(0.4);
    expect(ctx.globalCompositeOperation).toBe('source-over');
  });

  it('uses exactly two supplied values for identical native texture/support geometry and restores state', () => {
    const ctx = createNativeContext();
    const support = createNativeContext();
    const originalFill = ctx.fillStyle;
    const random = jest.fn().mockReturnValueOnce(0.25).mockReturnValueOnce(0.75);
    const globalRandom = jest.spyOn(Math, 'random');
    applyRisographTexture(ctx, 10, 20, 20, 100, support, random);
    expect(random).toHaveBeenCalledTimes(2);
    expect(globalRandom).not.toHaveBeenCalled();
    expect(ctx.fillRect).toHaveBeenCalledWith(-1.75, 9.75, 22, 22);
    expect(support.fillRect).toHaveBeenCalledWith(-1.75, 9.75, 22, 22);
    expect(support.save).toHaveBeenCalledTimes(1);
    expect(support.restore).toHaveBeenCalledTimes(1);
    expect(ctx.globalAlpha).toBe(0.4);
    expect(ctx.globalCompositeOperation).toBe('source-over');
    expect(ctx.fillStyle).toBe(originalFill);
  });

  it('forwards shape dependencies while keeping absent-provider global calls and native support unchanged', () => {
    const baseline = createNativeContext();
    const baselineSupport = createNativeContext();
    const injected = createNativeContext();
    const injectedSupport = createNativeContext();
    const globalRandom = jest.spyOn(Math, 'random').mockReturnValueOnce(0.25).mockReturnValueOnce(0.75);
    const draw = (ctx: CanvasRenderingContext2D, support: CanvasRenderingContext2D, random?: () => number) => {
      drawShape(ctx, 10.4, 20.4, 20, BrushShape.SQUARE, false, 0, 100,
        undefined, undefined, undefined, undefined,
        { getNativeAuthoredSupportContext: () => support, risographRandom: random });
    };
    draw(baseline, baselineSupport);
    expect(globalRandom).toHaveBeenCalledTimes(2);
    const supplied = jest.fn().mockReturnValueOnce(0.25).mockReturnValueOnce(0.75);
    draw(injected, injectedSupport, supplied);
    expect(supplied).toHaveBeenCalledTimes(2);
    expect(globalRandom).toHaveBeenCalledTimes(2);
    expect(jest.mocked(injected.fillRect).mock.calls).toEqual(jest.mocked(baseline.fillRect).mock.calls);
    expect(jest.mocked(injectedSupport.fillRect).mock.calls).toEqual(jest.mocked(baselineSupport.fillRect).mock.calls);
    expect(injected.save).toHaveBeenCalledTimes(1);
    expect(injected.restore).toHaveBeenCalledTimes(1);
    expect(injectedSupport.save).toHaveBeenCalledTimes(2);
    expect(injectedSupport.restore).toHaveBeenCalledTimes(2);
  });

  it.each([[1, 4], [5, 6], [20, 14], [500, 278]])('bounds native texture size %s with scale, maximum jitter and pixel quantization', (size, radius) => {
    expect(getNativeRisographStampRadius(size, 100)).toBe(radius);
  });
});
