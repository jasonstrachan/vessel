import { BrushShape, type BrushSettings } from '@/types';
import { canvasPool } from '@/utils/canvasPool';
import * as risographTexture from '@/utils/risographTexture';

import { BrushEngineFacade } from '../BrushEngineFacade';
import { createPixelCircleStamp } from '../brushStampController';
import type { Rect } from '../engineShared';
import type { CustomBrushStrokeData } from '../brushEngineFacadeTypes';
import { finalizePixelStroke, resolveDeferredPixelStamp } from '../strokeFinalizer';
import { createBrushUtilities } from '../utilities';

type PreviewResult = { canvas: HTMLCanvasElement; bounds: Rect };
type PreviewEngine = BrushEngineFacade & {
  beginStroke?: (target: 'paint' | 'erase-mask') => void;
  getPixelStrokePreview?: (args: {
    rawCanvas: HTMLCanvasElement;
    bounds: Rect;
  }) => PreviewResult | null;
};

const settings = (patch: Partial<BrushSettings> = {}): BrushSettings => ({
  size: 5, opacity: 1, color: '#ffffff', blendMode: 'source-over', spacing: 1,
  pressure: 1, rotation: 0, antialiasing: false, pressureEnabled: false,
  minPressure: 1, maxPressure: 100, rotationEnabled: false, dashedEnabled: false,
  dashLength: 3, dashGap: 2, gridSnapEnabled: false, shapeEnabled: false,
  useSwatchColor: false, colorJitter: 0, risographIntensity: 0,
  risographOutline: false, ditherEnabled: false, brushShape: BrushShape.SQUARE,
  ...patch,
});

const surface = (side = 256) => {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = side;
  return { canvas, ctx: canvas.getContext('2d')! };
};
const pixels = (canvas: HTMLCanvasElement) => canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
const differenceCount = (a: Uint8ClampedArray, b: Uint8ClampedArray) =>
  a.reduce((sum, value, index) => sum + Number(value !== b[index]), 0);

const setup = (patch: Partial<BrushSettings> = {}, side = 256) => {
  const raw = surface(side);
  const brushStampCache = new Map<string, HTMLCanvasElement>();
  const engine: PreviewEngine = new BrushEngineFacade({
    brushSettings: settings(patch),
    createPixelCircleStamp: (size) => createPixelCircleStamp({ size, brushStampCache }),
  });
  const draw = (from: { x: number; y: number }, to: { x: number; y: number }, pressure = 1) =>
    engine.renderBrushStroke(raw.ctx, { from, to, pressure, velocity: 0, timestamp: 1 });
  return { ...raw, engine, draw };
};

const rasterWindow = globalThis as typeof globalThis & { __VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__?: boolean };

describe('deferred pixel endpoint presentation', () => {
  beforeEach(() => { rasterWindow.__VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__ = true; });
  afterEach(() => {
    delete rasterWindow.__VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__;
    jest.restoreAllMocks();
  });

  it.each([
    [BrushShape.SQUARE, 'square'],
    [BrushShape.PIXEL_ROUND, 'round'],
    [BrushShape.PIXEL_DITHER, 'diamond5'],
  ] as const)('presents the pending %s cap without accepting it into canonical raw', (brushShape, ditherStrokeTipShape) => {
    const fixture = setup({ brushShape, ditherStrokeTipShape });
    const start = { x: 32, y: 128 };
    const end = { x: 224, y: 128 };
    fixture.draw(start, start);
    fixture.draw(start, end);
    const rawBefore = pixels(fixture.canvas);
    const queueBefore = { ...fixture.engine.getPixelQueue() };
    const preview = fixture.engine.getPixelStrokePreview?.({
      rawCanvas: fixture.canvas, bounds: { x: 0, y: 0, width: 256, height: 256 },
    });
    const held = pixels(preview?.canvas ?? fixture.canvas);
    expect(differenceCount(pixels(fixture.canvas), rawBefore)).toBe(0);
    expect(fixture.engine.getPixelQueue()).toEqual(queueBefore);
    fixture.engine.finalizeStroke(fixture.ctx);
    expect(differenceCount(held, pixels(fixture.canvas))).toBe(0);
  });
});

const fullBounds = { x: 0, y: 0, width: 256, height: 256 };
const snapshotQueue = (engine: BrushEngineFacade) => {
  const queue = engine.getPixelQueue();
  const { enqueue, flushNow, onIdle, addDirtyRect, ...state } = queue;
  void enqueue; void flushNow; void onIdle; void addDirtyRect;
  return {
    ...state,
    lastStrokePosition: { ...queue.lastStrokePosition },
    lastLiftPosition: queue.lastLiftPosition ? { ...queue.lastLiftPosition } : queue.lastLiftPosition,
    stampedGridPositions: [...queue.stampedGridPositions],
    drawnPixels: [...queue.drawnPixels],
  };
};

describe('native endpoint preview ownership', () => {
  beforeEach(() => { rasterWindow.__VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__ = true; });
  afterEach(() => {
    delete rasterWindow.__VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__;
    jest.restoreAllMocks();
  });

  it.each([1, 5, 20, 500])('matches immediate release at all project edges for size %i', (size) => {
    for (const [start, end] of [
      [{ x: 4, y: 0 }, { x: 0, y: 0 }],
      [{ x: 251, y: 255 }, { x: 255, y: 255 }],
      [{ x: 0, y: 251 }, { x: 0, y: 255 }],
      [{ x: 255, y: 4 }, { x: 255, y: 0 }],
    ]) {
      const fixture = setup({ size });
      fixture.draw(start, start);
      fixture.draw(start, end);
      const preview = fixture.engine.getPixelStrokePreview!({ rawCanvas: fixture.canvas, bounds: fullBounds });
      const held = pixels(preview?.canvas ?? fixture.canvas);
      fixture.engine.finalizeStroke(fixture.ctx);
      expect(differenceCount(held, pixels(fixture.canvas))).toBe(0);
    }
  });

  it('retracts a discarded corner without changing accepted pixels or queue admission', () => {
    const fixture = setup({ size: 1 });
    const baseline = setup({ size: 1 });
    const points = [{ x: 50, y: 50 }, { x: 51, y: 50 }, { x: 51, y: 51 }, { x: 51, y: 52 }];
    let last = points[0];
    for (const [index, point] of points.entries()) {
      fixture.draw(last, point);
      baseline.draw(last, point);
      const canonicalBefore = pixels(fixture.canvas);
      const queueBefore = snapshotQueue(fixture.engine);
      const preview = fixture.engine.getPixelStrokePreview!({ rawCanvas: fixture.canvas, bounds: fullBounds });
      expect(differenceCount(pixels(fixture.canvas), canonicalBefore)).toBe(0);
      expect(snapshotQueue(fixture.engine)).toEqual(queueBefore);
      expect(snapshotQueue(fixture.engine)).toEqual(snapshotQueue(baseline.engine));
      if (index === 1) expect(preview!.canvas.getContext('2d')!.getImageData(51, 50, 1, 1).data[3]).toBe(255);
      if (index === 2) {
        expect(preview!.canvas.getContext('2d')!.getImageData(51, 50, 1, 1).data[3]).toBe(0);
        expect(preview!.canvas.getContext('2d')!.getImageData(51, 51, 1, 1).data[3]).toBe(255);
      }
      last = point;
    }
    fixture.engine.finalizeStroke(fixture.ctx);
    baseline.engine.finalizeStroke(baseline.ctx);
    expect(differenceCount(pixels(fixture.canvas), pixels(baseline.canvas))).toBe(0);
  });

  it.each([1, 20])('leaves dash/spacing/pressure decisions unchanged at spacing %i', (spacing) => {
    const patch = { spacing, dashedEnabled: true, dashLength: 1, dashGap: 3, pressureEnabled: true, minPressure: 50, maxPressure: 200 };
    const fixture = setup(patch);
    const baseline = setup(patch);
    let last = { x: 32, y: 128 };
    const points = [{ x: 32, y: 128 }, { x: 60, y: 128 }, { x: 60, y: 150 }, { x: 40, y: 150 }, { x: 120, y: 150 }];
    for (const [index, point] of points.entries()) {
      const pressure = index % 2 ? 0.25 : 1;
      fixture.draw(last, point, pressure);
      baseline.draw(last, point, pressure);
      const preview = fixture.engine.getPixelStrokePreview!({ rawCanvas: fixture.canvas, bounds: fullBounds });
      expect(snapshotQueue(fixture.engine)).toEqual(snapshotQueue(baseline.engine));
      expect(differenceCount(pixels(fixture.canvas), pixels(baseline.canvas))).toBe(0);
      const immediateRelease = setup(patch);
      let previous = points[0];
      for (let step = 0; step <= index; step++) {
        immediateRelease.draw(previous, points[step], step % 2 ? 0.25 : 1);
        previous = points[step];
      }
      immediateRelease.engine.finalizeStroke(immediateRelease.ctx);
      expect(differenceCount(pixels(preview?.canvas ?? fixture.canvas), pixels(immediateRelease.canvas))).toBe(0);
      last = point;
    }
    fixture.engine.finalizeStroke(fixture.ctx);
    baseline.engine.finalizeStroke(baseline.ctx);
    expect(differenceCount(pixels(fixture.canvas), pixels(baseline.canvas))).toBe(0);
  });

  it.each([
    [BrushShape.SQUARE, 'square'],
    [BrushShape.PIXEL_ROUND, 'round'],
    [BrushShape.PIXEL_DITHER, 'diamond5'],
  ] as const)('reuses stable %s presentation without RNG, support, or tracked authored stamps', (brushShape, ditherStrokeTipShape) => {
    const fixture = setup({ brushShape, ditherStrokeTipShape });
    const support = jest.fn(() => null);
    fixture.engine.updateConfig({ getNativeAuthoredSupportContext: support });
    fixture.draw({ x: 32, y: 128 }, { x: 80, y: 128 });
    fixture.engine.consumeRecentStamps();
    support.mockClear();
    const random = jest.spyOn(Math, 'random').mockImplementation(() => { throw new Error('Unexpected speculative RNG'); });
    const before = snapshotQueue(fixture.engine);
    const preview = fixture.engine.getPixelStrokePreview!({ rawCanvas: fixture.canvas, bounds: fullBounds });
    expect(preview).not.toBeNull();
    const first = pixels(preview!.canvas);
    expect(fixture.engine.getPixelStrokePreview!({ rawCanvas: fixture.canvas, bounds: fullBounds })).toBe(preview);
    expect(differenceCount(pixels(preview!.canvas), first)).toBe(0);
    expect(random).not.toHaveBeenCalled();
    expect(support).not.toHaveBeenCalled();
    expect(fixture.engine.consumeRecentStamps()).toEqual([]);
    expect(snapshotQueue(fixture.engine)).toEqual(before);
    fixture.engine.finalizeStroke(fixture.ctx);
    expect(support).toHaveBeenCalledTimes(1);
    expect(fixture.engine.getPixelStrokePreview!({ rawCanvas: fixture.canvas, bounds: fullBounds })).toBeNull();
  });

  it.each([{ lostEdge: 100 }, { ditherEnabled: true, pressureLinkedFillResolution: false }])(
    'completes deterministic effect raw without changing authoring %o', (patch) => {
      const fixture = setup({ ...patch, opacity: 0.5 });
      const baseline = setup({ ...patch, opacity: 0.5 });
      const random = jest.spyOn(Math, 'random').mockImplementation(() => { throw new Error('Speculative RNG'); });
      const support = jest.fn(() => null);
      fixture.engine.updateConfig({ getNativeAuthoredSupportContext: support });
      let last = { x: 32, y: 128 };
      for (const point of [{ x: 80, y: 128 }, { x: 120, y: 128 }, { x: 160, y: 128 }]) {
        fixture.draw(last, point);
        baseline.draw(last, point);
        const before = pixels(fixture.canvas);
        const queue = snapshotQueue(fixture.engine);
        support.mockClear();
        fixture.engine.consumeRecentStamps();
        const preview = fixture.engine.getPixelStrokePreview!({ rawCanvas: fixture.canvas, bounds: fullBounds });
        expect(preview).not.toBeNull();
        expect(differenceCount(pixels(fixture.canvas), before)).toBe(0);
        expect(snapshotQueue(fixture.engine)).toEqual(queue);
        expect(snapshotQueue(fixture.engine)).toEqual(snapshotQueue(baseline.engine));
        expect(support).not.toHaveBeenCalled();
        expect(fixture.engine.consumeRecentStamps()).toEqual([]);
        expect(fixture.engine.getPixelStrokePreview!({ rawCanvas: fixture.canvas, bounds: fullBounds })).toBe(preview);
        last = point;
      }
      const held = pixels(fixture.engine.getPixelStrokePreview!({ rawCanvas: fixture.canvas, bounds: fullBounds })!.canvas);
      fixture.engine.finalizeStroke(fixture.ctx);
      baseline.engine.finalizeStroke(baseline.ctx);
      expect(differenceCount(pixels(fixture.canvas), pixels(baseline.canvas))).toBe(0);
      expect(differenceCount(held, pixels(fixture.canvas))).toBe(0);
      expect(random).not.toHaveBeenCalled();
    },
  );

  it.each([
    { risographIntensity: 50 }, { ditherEnabled: true, pressureLinkedFillResolution: true },
    { antialiasing: true }, { brushShape: BrushShape.SPAM_TEXT },
  ])('does not render unsupported preview settings %o', (patch) => {
    const fixture = setup();
    fixture.draw({ x: 32, y: 128 }, { x: 80, y: 128 });
    fixture.engine.updateConfig({ brushSettings: settings(patch) });
    const random = jest.spyOn(Math, 'random').mockImplementation(() => { throw new Error('Unexpected speculative RNG'); });
    expect(fixture.engine.getPixelStrokePreview!({ rawCanvas: fixture.canvas, bounds: fullBounds })).toBeNull();
    expect(random).not.toHaveBeenCalled();
  });

  it('retracts an old tentative cap when held settings become unsupported', () => {
    const fixture = setup({ size: 1 });
    fixture.draw({ x: 50, y: 50 }, { x: 51, y: 50 });
    const preview = fixture.engine.getPixelStrokePreview!({ rawCanvas: fixture.canvas, bounds: fullBounds })!;
    expect(preview.canvas.getContext('2d')!.getImageData(51, 50, 1, 1).data[3]).toBe(255);
    fixture.engine.updateConfig({ brushSettings: settings({ size: 1, risographIntensity: 50 }) });
    const random = jest.spyOn(Math, 'random').mockImplementation(() => { throw new Error('Unexpected speculative RNG'); });
    const cleanup = fixture.engine.getPixelStrokePreview!({ rawCanvas: fixture.canvas, bounds: { x: 50, y: 50, width: 1, height: 1 } })!;
    expect(cleanup.canvas).toBe(preview.canvas);
    expect(cleanup.bounds).toEqual(fullBounds);
    expect(differenceCount(pixels(cleanup.canvas), pixels(fixture.canvas))).toBe(0);
    expect(random).not.toHaveBeenCalled();
  });

  it('reuses the scratch surface across reset and refuses zero-size input', () => {
    const fixture = setup({ size: 1 });
    fixture.draw({ x: 50, y: 50 }, { x: 51, y: 50 });
    const preview = fixture.engine.getPixelStrokePreview!({ rawCanvas: fixture.canvas, bounds: fullBounds })!;
    fixture.engine.resetStroke();
    expect(fixture.engine.getPixelStrokePreview!({ rawCanvas: fixture.canvas, bounds: fullBounds })).toBeNull();
    fixture.ctx.clearRect(0, 0, 256, 256);
    fixture.draw({ x: 100, y: 100 }, { x: 110, y: 100 });
    const fresh = fixture.engine.getPixelStrokePreview!({ rawCanvas: fixture.canvas, bounds: fullBounds })!;
    expect(fresh.canvas).toBe(preview.canvas);
    expect(fresh.canvas.getContext('2d')!.getImageData(50, 50, 2, 1).data[3]).toBe(0);
    fixture.canvas.width = 0;
    expect(fixture.engine.getPixelStrokePreview!({ rawCanvas: fixture.canvas, bounds: fullBounds })).toBeNull();
  });
});

describe('pixel round preview resources', () => {
  it('uses the existing circle owner once and balances its pool resources across repeated held publication', () => {
    rasterWindow.__VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__ = true;
    const fixture = setup({ brushShape: BrushShape.PIXEL_ROUND });
    fixture.draw({ x: 32, y: 128 }, { x: 80, y: 128 });
    const acquire = jest.spyOn(canvasPool, 'acquire');
    const release = jest.spyOn(canvasPool, 'release');
    try {
      const preview = fixture.engine.getPixelStrokePreview!({ rawCanvas: fixture.canvas, bounds: fullBounds })!;
      expect(acquire).toHaveBeenCalledTimes(1);
      expect(release).toHaveBeenCalledTimes(1);
      expect(release).toHaveBeenCalledWith(acquire.mock.results[0].value);
      fixture.engine.getPixelStrokePreview!({ rawCanvas: fixture.canvas, bounds: fullBounds });
      expect(acquire).toHaveBeenCalledTimes(1);
      expect(release).toHaveBeenCalledTimes(1);
      expect(preview.canvas.width).toBe(256);
    } finally {
      delete rasterWindow.__VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__;
      jest.restoreAllMocks();
    }
  });
});


describe('admitted native eraser risograph stream', () => {
  beforeEach(() => {
    rasterWindow.__VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__ = true;
    // Pattern pixels are canvas I/O; all native geometry/jitter/composition is real.
    jest.spyOn(risographTexture, 'getRisographPattern').mockReturnValue('#a800ff' as unknown as CanvasPattern);
  });
  afterEach(() => {
    delete rasterWindow.__VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__;
    jest.restoreAllMocks();
  });

  it('acquires the native cap preview context with the raw authoring readback setting on its first use', () => {
    const fixture = setup({ risographIntensity: 100, opacity: 0.5 });
    fixture.engine.beginStroke?.('erase-mask');
    fixture.draw({ x: 32, y: 128 }, { x: 80, y: 128 });
    const acquire = jest.spyOn(HTMLCanvasElement.prototype, 'getContext');
    const preview = fixture.engine.getPixelStrokePreview!({ rawCanvas: fixture.canvas, bounds: fullBounds })!;
    expect(preview).not.toBeNull();
    const firstAcquisition = acquire.mock.contexts.findIndex(canvas => canvas === preview.canvas);
    expect(firstAcquisition).toBeGreaterThanOrEqual(0);
    // Later readback calls cannot change a canvas's initial rendering backend.
    expect(acquire.mock.calls[firstAcquisition]).toEqual(['2d', { willReadFrequently: true }]);
  });

  it('seeds each eraser admission once, including initial intensity zero, and leaves painting on its original provider', () => {
    const random = jest.spyOn(Math, 'random').mockReturnValue(0.25);
    const fixture = setup({ risographIntensity: 0 });
    fixture.engine.beginStroke?.('erase-mask');
    expect(random).toHaveBeenCalledTimes(1);
    fixture.draw({ x: 32, y: 128 }, { x: 80, y: 128 });
    fixture.engine.updateConfig({ brushSettings: settings({ risographIntensity: 100 }) });
    fixture.draw({ x: 80, y: 128 }, { x: 120, y: 128 });
    fixture.engine.getPixelStrokePreview!({ rawCanvas: fixture.canvas, bounds: fullBounds });
    fixture.engine.finalizeStroke(fixture.ctx);
    expect(random).toHaveBeenCalledTimes(1);
    fixture.engine.resetStroke();
    fixture.engine.beginStroke?.('paint');
    expect(random).toHaveBeenCalledTimes(1);
    fixture.draw({ x: 32, y: 128 }, { x: 80, y: 128 });
    expect(random.mock.calls.length).toBeGreaterThan(1);
    fixture.engine.resetStroke();
    const calls = random.mock.calls.length;
    fixture.engine.beginStroke?.('erase-mask');
    expect(random).toHaveBeenCalledTimes(calls + 1);
  });

  it.each([
    [BrushShape.SQUARE, 'square'], [BrushShape.PIXEL_ROUND, 'round'], [BrushShape.PIXEL_DITHER, 'diamond5'],
  ] as const)('keeps authored %s bytes, queue, support and tracker neutral across discarded/repeated forks', (brushShape, ditherStrokeTipShape) => {
    const random = jest.spyOn(Math, 'random').mockReturnValue(0.375);
    const patch = { brushShape, ditherStrokeTipShape, risographIntensity: 100, opacity: 0.5 };
    const fixture = setup(patch);
    const baseline = setup(patch);
    fixture.engine.beginStroke?.('erase-mask');
    baseline.engine.beginStroke?.('erase-mask');
    const supportSurface = surface();
    const baselineSupport = surface();
    const support = jest.fn(() => supportSurface.ctx);
    fixture.engine.updateConfig({ getNativeAuthoredSupportContext: support });
    baseline.engine.updateConfig({ getNativeAuthoredSupportContext: () => baselineSupport.ctx });
    let last = { x: 32, y: 128 };
    let held: Uint8ClampedArray | undefined;
    for (const point of [{ x: 80, y: 128 }, { x: 80, y: 129 }, { x: 81, y: 129 }, { x: 120, y: 129 }]) {
      fixture.draw(last, point);
      baseline.draw(last, point);
      expect(fixture.engine.consumeRecentStamps()).toEqual(baseline.engine.consumeRecentStamps());
      const canonical = pixels(fixture.canvas);
      const queue = snapshotQueue(fixture.engine);
      const supportCalls = support.mock.calls.length;
      const supportBefore = pixels(supportSurface.canvas);
      expect(differenceCount(supportBefore, pixels(baselineSupport.canvas))).toBe(0);
      const randomCalls = random.mock.calls.length;
      const preview = fixture.engine.getPixelStrokePreview!({ rawCanvas: fixture.canvas, bounds: fullBounds });
      expect(preview).not.toBeNull();
      held = pixels(preview!.canvas);
      expect(fixture.engine.getPixelStrokePreview!({ rawCanvas: fixture.canvas, bounds: fullBounds })).toBe(preview);
      expect(differenceCount(pixels(preview!.canvas), held)).toBe(0);
      expect(differenceCount(pixels(fixture.canvas), canonical)).toBe(0);
      expect(differenceCount(pixels(fixture.canvas), pixels(baseline.canvas))).toBe(0);
      expect(snapshotQueue(fixture.engine)).toEqual(queue);
      expect(snapshotQueue(fixture.engine)).toEqual(snapshotQueue(baseline.engine));
      expect(fixture.engine.consumeRecentStamps()).toEqual([]);
      expect(support).toHaveBeenCalledTimes(supportCalls);
      expect(differenceCount(pixels(supportSurface.canvas), supportBefore)).toBe(0);
      expect(random).toHaveBeenCalledTimes(randomCalls);
      last = point;
    }
    fixture.engine.finalizeStroke(fixture.ctx);
    baseline.engine.finalizeStroke(baseline.ctx);
    expect(differenceCount(pixels(fixture.canvas), pixels(baseline.canvas))).toBe(0);
    expect(differenceCount(held!, pixels(fixture.canvas))).toBe(0);
    expect(differenceCount(pixels(supportSurface.canvas), pixels(baselineSupport.canvas))).toBe(0);
    expect(random).toHaveBeenCalledTimes(2);
    expect(fixture.engine.getPixelStrokePreview!({ rawCanvas: fixture.canvas, bounds: fullBounds })).toBeNull();
  });

  it('includes size500 native Riso texture outside the untextured cap radius', () => {
    const random = jest.spyOn(Math, 'random').mockReturnValue(0.25);
    const fixture = setup({ size: 500, risographIntensity: 100, opacity: 0.5 }, 1024);
    fixture.engine.beginStroke?.('erase-mask');
    fixture.draw({ x: 499, y: 500 }, { x: 500, y: 500 });
    const preview = fixture.engine.getPixelStrokePreview!({
      rawCanvas: fixture.canvas, bounds: { x: 499, y: 499, width: 3, height: 3 },
    });
    expect(preview).not.toBeNull();
    expect(preview!.bounds).toEqual({ x: 222, y: 222, width: 556, height: 556 });
    const held = pixels(preview!.canvas);
    fixture.engine.finalizeStroke(fixture.ctx);
    expect(differenceCount(held, pixels(fixture.canvas))).toBe(0);
    expect(random).toHaveBeenCalledTimes(1);
  });

});


describe('custom pattern deferred pixel endpoint', () => {
  beforeEach(() => { rasterWindow.__VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__ = true; });
  afterEach(() => {
    delete rasterWindow.__VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__;
    jest.restoreAllMocks();
  });

  const customTip = (rasterSize = { width: 32, height: 16 }): CustomBrushStrokeData => {
    const canvas = document.createElement('canvas');
    canvas.width = rasterSize.width;
    canvas.height = rasterSize.height;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, canvas.width / 4, canvas.height);
    ctx.globalAlpha = 0.5; ctx.fillStyle = '#0000ff';
    ctx.fillRect(canvas.width / 4, 0, canvas.width / 4, canvas.height);
    ctx.globalAlpha = 1; ctx.fillStyle = '#00ff00';
    ctx.fillRect(canvas.width / 2, canvas.height / 2, canvas.width / 2, canvas.height / 2);
    return { imageData: ctx.getImageData(0, 0, canvas.width, canvas.height), width: 32, height: 16, isColorizable: false };
  };

  it.each([
    { name: 'original tip', opacity: 1, pressureEnabled: false, pressure: 0.5, diameter: 32, raster: { width: 32, height: 16 } },
    { name: 'half-opacity tip', opacity: 0.5, pressureEnabled: false, pressure: 0.5, diameter: 32, raster: { width: 32, height: 16 } },
    { name: 'low-pressure tip', opacity: 1, pressureEnabled: true, pressure: 0.25, diameter: 22, raster: { width: 32, height: 16 } },
    { name: 'high-pressure tip', opacity: 1, pressureEnabled: true, pressure: 0.75, diameter: 42, raster: { width: 32, height: 16 } },
    { name: 'natural aspect independent of raster', opacity: 1, pressureEnabled: false, pressure: 0.5, diameter: 32, raster: { width: 8, height: 8 } },
  ])('commits the actual $name material at release after the admitted interval stamps', ({ opacity, pressureEnabled, pressure, diameter, raster }) => {
    const fixture = setup({ brushShape: BrushShape.CUSTOM, size: 32, spacing: 20, opacity, pressureEnabled, minPressure: 50, maxPressure: 150 });
    const tip = customTip(raster);
    const sourceBefore = new Uint8ClampedArray(tip.imageData.data);
    const draw = (from: { x: number; y: number }, to: { x: number; y: number }) => fixture.engine.renderBrushStroke(fixture.ctx, {
      from, to, pressure, velocity: 0, timestamp: 1, customBrushData: tip,
    });
    draw({ x: 96, y: 160 }, { x: 96, y: 160 });
    for (let x = 97; x <= 184; x++) draw({ x: x - 1, y: 160 }, { x, y: 160 });
    const queue = fixture.engine.getPixelQueue();
    expect(queue.waitingPixelX).toBe(184);
    expect(queue.lastDrawnX).toBe(183);

    const source = document.createElement('canvas'); source.width = tip.imageData.width; source.height = tip.imageData.height;
    source.getContext('2d')!.putImageData(tip.imageData, 0, 0);
    const scaled = document.createElement('canvas'); scaled.width = diameter; scaled.height = Math.round(diameter / 2);
    const sc = scaled.getContext('2d')!; sc.imageSmoothingEnabled = false;
    sc.drawImage(source, 0, 0, source.width, source.height, 0, 0, scaled.width, scaled.height);
    const expected = surface(); expected.ctx.imageSmoothingEnabled = false; expected.ctx.globalAlpha = opacity;
    // This independently specified cadence is the existing delayed-pixel interval contract.
    for (const x of [96, 115, 135, 155, 175]) expected.ctx.drawImage(scaled, x - scaled.width / 2, 160 - scaled.height / 2);
    expect(differenceCount(pixels(fixture.canvas), pixels(expected.canvas))).toBe(0);
    const before = pixels(fixture.canvas);
    expect(fixture.engine.getPixelStrokePreview!({ rawCanvas: fixture.canvas, bounds: fullBounds })).toBeNull();
    expect(differenceCount(pixels(fixture.canvas), before)).toBe(0);

    expected.ctx.drawImage(scaled, 184 - scaled.width / 2, 160 - scaled.height / 2);
    fixture.engine.finalizeStroke(fixture.ctx);
    expect(differenceCount(pixels(fixture.canvas), pixels(expected.canvas))).toBe(0);
    expect(differenceCount(pixels(fixture.canvas), before)).toBeGreaterThan(0);
    expect(tip.imageData.data).toEqual(sourceBefore);
    if (diameter === 32 && opacity === 1) {
      expect([...fixture.ctx.getImageData(199, 164, 1, 1).data]).toEqual([0, 255, 0, 255]);
    }
  });

  it.each([false, true])('preserves the active tip and natural dimensions with colorizable=%s in the deferred shape call', (isColorizable) => {
    const brushSettings = settings({ brushShape: BrushShape.CUSTOM, size: 32, spacing: 20 });
    const fixture = setup(brushSettings);
    const tip = { ...customTip({ width: 8, height: 8 }), isColorizable };
    fixture.engine.renderBrushStroke(fixture.ctx, { from: { x: 96, y: 160 }, to: { x: 184, y: 160 }, pressure: 0.5, velocity: 0, timestamp: 1, customBrushData: tip });
    const args = { brushSettings, pixelQueue: fixture.engine.getPixelQueue(), lastStrokePressure: 0.5, lastCustomBrushData: tip, utilities: createBrushUtilities(() => brushSettings) };
    const stamp = resolveDeferredPixelStamp({ ...args, composite: 'source-over' });
    expect(stamp?.settings.pattern).toBe(tip.imageData);
    expect(stamp?.settings.customPatternDimensions).toEqual({ width: 32, height: 16 });
    expect(stamp?.settings.isColorizable).toBe(isColorizable);
    const shapeDrawer = jest.fn();
    finalizePixelStroke({ ...args, ctx: fixture.ctx, shapeDrawer });
    expect(shapeDrawer).toHaveBeenCalledWith(fixture.ctx, 184, 160, 32, BrushShape.CUSTOM, false, 0, 0, tip.imageData, isColorizable, { width: 32, height: 16 });
  });
});
