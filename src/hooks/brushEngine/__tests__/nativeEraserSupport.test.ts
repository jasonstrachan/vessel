import { BrushShape, type BrushSettings } from '@/types';
import { canvasPool } from '@/utils/canvasPool';
import { getRisographPattern } from '@/utils/risographTexture';

import { createShapeDrawer, type ShapeDrawingDependencies } from '../shapes';

jest.mock('@/utils/risographTexture', () => ({
  getRisographPattern: jest.fn(() => ({ texture: 'shared' })),
  getRisographEffectSettings: jest.fn(() => ({ alpha: 0.6, jitter: 2 })),
}));

type Emission = {
  kind: string;
  args: unknown[];
  fillStyle: CanvasRenderingContext2D['fillStyle'];
  alpha: number;
  composite: GlobalCompositeOperation;
  smoothing: boolean;
  filter: string;
};

const createContext = () => {
  const emissions: Emission[] = [];
  const operations: Array<{ kind: string; args: unknown[] }> = [];
  const matrix = { a: 0.8, b: 0.2, c: -0.2, d: 0.8, e: 3, f: 5 } as DOMMatrix;
  const state = {
    fillStyle: '#ffffff' as CanvasRenderingContext2D['fillStyle'],
    globalAlpha: 0.75,
    globalCompositeOperation: 'source-over' as GlobalCompositeOperation,
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'high' as ImageSmoothingQuality,
    filter: 'none',
    shadowColor: 'rgba(0, 0, 0, 0)',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
  };
  const stack: Array<typeof state> = [];
  const record = (kind: string, args: unknown[]) => {
    operations.push({ kind, args });
  };
  const emit = (kind: string, args: unknown[]) => {
    record(kind, args);
    emissions.push({
      kind,
      args,
      fillStyle: ctx.fillStyle,
      alpha: ctx.globalAlpha,
      composite: ctx.globalCompositeOperation,
      smoothing: ctx.imageSmoothingEnabled,
      filter: ctx.filter,
    });
  };
  const ctx = {
    ...state,
    save: jest.fn(() => {
      record('save', []);
      stack.push(Object.fromEntries(Object.keys(state).map((key) => [key, ctx[key as keyof typeof state]])) as typeof state);
    }),
    restore: jest.fn(() => {
      record('restore', []);
      Object.assign(ctx, stack.pop());
    }),
    getTransform: jest.fn(() => matrix),
    setTransform: jest.fn(),
    translate: jest.fn((...args: number[]) => record('translate', args)),
    rotate: jest.fn((...args: number[]) => record('rotate', args)),
    beginPath: jest.fn(() => record('beginPath', [])),
    arc: jest.fn((...args: number[]) => record('arc', args)),
    moveTo: jest.fn((...args: number[]) => record('moveTo', args)),
    lineTo: jest.fn((...args: number[]) => record('lineTo', args)),
    closePath: jest.fn(() => record('closePath', [])),
    fill: jest.fn(() => emit('fill', [])),
    fillRect: jest.fn((...args: number[]) => emit('fillRect', args)),
    drawImage: jest.fn((...args: unknown[]) => emit('drawImage', args)),
    getImageData: jest.fn(() => { throw new Error('Support must not read cumulative raw alpha.'); }),
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, emissions, operations, matrix };
};

const normalizeOperations = (operations: Array<{ kind: string; args: unknown[] }>) =>
  operations.map(({ kind, args }) => ({
    kind,
    args: args.map((value) => value instanceof HTMLCanvasElement
      ? { width: value.width, height: value.height }
      : value),
  }));

describe('native eraser authored support', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each([
    ['square', BrushShape.SQUARE, 12, 0, false, 1],
    ['rotated square', BrushShape.SQUARE, 12, Math.PI / 6, false, 1],
    ['pixel round', BrushShape.PIXEL_ROUND, 12, 0, true, 1],
    ['rotated pixel round', BrushShape.PIXEL_ROUND, 12, Math.PI / 6, true, 1],
    ['pixel round fallback', BrushShape.PIXEL_ROUND, 12, 0, false, 1],
    ['legacy round cache', BrushShape.ROUND, 6, 0, true, 1],
    ['legacy round path', BrushShape.ROUND, 12, Math.PI / 6, true, 1],
    ['diamond5', BrushShape.PIXEL_DITHER, 15, Math.PI / 6, false, 13],
  ] as const)('preserves raw calls and emits the actual %s primitives once', (
    _name, shape, size, rotation, useCircleStamp, emissionCount,
  ) => {
    const direct = createContext();
    const raw = createContext();
    const support = createContext();
    const createCircle = jest.fn((stampSize: number) => {
      const stamp = document.createElement('canvas');
      stamp.width = stampSize;
      stamp.height = stampSize;
      return stamp;
    });
    const deps: ShapeDrawingDependencies = useCircleStamp
      ? { createPixelCircleStamp: createCircle }
      : {};
    const settings = { brushSettings: { ditherStrokeTipShape: 'diamond5' } as BrushSettings };
    createShapeDrawer(settings, deps)(direct.ctx, 30.2, 40.4, size, shape, false, rotation);
    const resourcesBefore = createCircle.mock.calls.length;
    const release = jest.spyOn(canvasPool, 'release');
    createShapeDrawer(settings, {
      ...deps,
      getNativeAuthoredSupportContext: (ctx) => ctx === raw.ctx ? support.ctx : null,
    })(raw.ctx, 30.2, 40.4, size, shape, false, rotation);

    expect(normalizeOperations(raw.operations)).toEqual(normalizeOperations(direct.operations));
    expect(raw.emissions).toHaveLength(emissionCount);
    expect(support.emissions).toEqual(raw.emissions);
    expect(createCircle.mock.calls.length - resourcesBefore).toBe(resourcesBefore);
    expect(raw.ctx.getImageData).not.toHaveBeenCalled();
    expect(support.ctx.setTransform).toHaveBeenCalledWith(raw.matrix);
    if (shape === BrushShape.PIXEL_ROUND && useCircleStamp) {
      expect(jest.mocked(support.ctx.drawImage).mock.invocationCallOrder[0]).toBeLessThan(release.mock.invocationCallOrder[0]);
    }
  });

  it.each(['square', 'round', 'diamond', 'diamond5', 'diamond7', 'diamond9', 'triangle'] as const)(
    'admits Dither Stroke %s and preserves its native emissions', (tip) => {
      const raw = createContext();
      const support = createContext();
      const settings = { brushSettings: { ditherStrokeTipShape: tip } as BrushSettings };
      createShapeDrawer(settings, { getNativeAuthoredSupportContext: () => support.ctx })(
        raw.ctx, 30, 40, 16, BrushShape.PIXEL_DITHER, false,
      );
      expect(raw.emissions.length).toBeGreaterThan(0);
      expect(support.emissions).toEqual(raw.emissions);
      expect(raw.ctx.getImageData).not.toHaveBeenCalled();
    },
  );

  it('rejects the unsupported legacy checkered tip before drawing', () => {
    const raw = createContext();
    const support = createContext();
    expect(() => createShapeDrawer(
      { brushSettings: { ditherStrokeTipShape: 'checkered' } as BrushSettings },
      { getNativeAuthoredSupportContext: () => support.ctx },
    )(raw.ctx, 30, 40, 16, BrushShape.PIXEL_DITHER, false)).toThrow('supported native tip');
    expect(raw.operations).toEqual([]);
  });

  it('uses the original riso pattern and jitter once, including its support outside the native tip', () => {
    const raw = createContext();
    const support = createContext();
    const random = jest.spyOn(Math, 'random').mockReturnValueOnce(0.25).mockReturnValueOnce(0.75);
    const patternCallsBefore = jest.mocked(getRisographPattern).mock.calls.length;
    createShapeDrawer({}, { getNativeAuthoredSupportContext: () => support.ctx })(
      raw.ctx, 30, 40, 10, BrushShape.SQUARE, false, 0, 50,
    );

    expect(random).toHaveBeenCalledTimes(2);
    expect(jest.mocked(getRisographPattern).mock.calls.length - patternCallsBefore).toBe(1);
    expect(getRisographPattern).toHaveBeenLastCalledWith(raw.ctx);
    expect(raw.emissions).toHaveLength(2);
    expect(support.emissions).toEqual(raw.emissions);
    expect(support.emissions[1]).toMatchObject({ args: [24, 35, 11, 11], composite: 'multiply', alpha: 0.75 * 0.6 });
    expect(raw.ctx.globalAlpha).toBe(0.75);
    expect(raw.ctx.globalCompositeOperation).toBe('source-over');
  });

  it.each([
    [BrushShape.CUSTOM, false, undefined],
    [BrushShape.SPAM_TEXT, false, undefined],
    [BrushShape.SQUARE, true, undefined],
    [BrushShape.SQUARE, false, new ImageData(1, 1)],
  ] as const)('rejects unsupported support before mutating raw (%s)', (shape, antialiasing, pattern) => {
    const raw = createContext();
    const support = createContext();
    expect(() => createShapeDrawer({}, { getNativeAuthoredSupportContext: () => support.ctx })(
      raw.ctx, 30, 40, 10, shape, antialiasing, 0, 0, pattern,
    )).toThrow('supported native tip');
    expect(raw.operations).toEqual([]);
  });

  it('rejects using the raw context as support before drawing', () => {
    const raw = createContext();
    expect(() => createShapeDrawer({}, { getNativeAuthoredSupportContext: () => raw.ctx })(
      raw.ctx, 30, 40, 10, BrushShape.SQUARE, false,
    )).toThrow('separate context');
    expect(raw.operations).toEqual([]);
  });
});
