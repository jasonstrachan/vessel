import { BrushEngineFacade } from '@/hooks/brushEngine/BrushEngineFacade';
import { createPixelCircleStamp } from '@/hooks/brushEngine/brushStampController';
import { resolveCustomPatternDrawDimensions } from '@/hooks/brushEngine/shapes';
import { BrushShape, type BrushSettings } from '@/types';

const createBaseSettings = (): BrushSettings => ({
  size: 8,
  opacity: 1,
  color: '#000000',
  blendMode: 'source-over',
  spacing: 20,
  pressure: 1,
  rotation: 0,
  antialiasing: false,
  pressureEnabled: false,
  minPressure: 1,
  maxPressure: 100,
  rotationEnabled: false,
  dashedEnabled: false,
  dashLength: 3,
  dashGap: 2,
  gridSnapEnabled: true,
  gridSnapSize: 8,
  shapeEnabled: false,
  useSwatchColor: false,
  colorJitter: 0,
  risographIntensity: 0,
  risographOutline: false,
  ditherEnabled: false,
  brushShape: BrushShape.SQUARE,
});

describe('BrushEngineFacade grid snap stamping', () => {
  const rasterWindow = globalThis as typeof globalThis & { __VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__?: boolean };

  beforeEach(() => {
    rasterWindow.__VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__ = true;
  });

  afterEach(() => {
    delete rasterWindow.__VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__;
    jest.restoreAllMocks();
  });

  it('does not consume an extra Spam character when releasing a completed grid segment', () => {
    const engine = new BrushEngineFacade({
      brushSettings: { ...createBaseSettings(), brushShape: BrushShape.SPAM_TEXT },
    });
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 192;
    const ctx = canvas.getContext('2d')!;
    const fillText = jest.spyOn(ctx, 'fillText');
    engine.initializeSpamText('mixed', 'ABCD');

    engine.renderBrushStroke(ctx, {
      from: { x: 64, y: 64 }, to: { x: 80, y: 64 },
      pressure: 1, velocity: 0, timestamp: 1,
    });
    const accepted = fillText.mock.calls.map((call) => [...call]);
    expect(accepted.map((call) => call[0])).toEqual(['A', 'B', 'C']);
    const count = engine.getSpamTextState().charIndex;
    engine.finalizeStroke(ctx);
    engine.finalizeStroke(ctx);

    expect(fillText.mock.calls).toEqual(accepted);
    expect(engine.getSpamTextState().charIndex).toBe(count);
    engine.resetStroke();
    engine.renderBrushStroke(ctx, {
      from: { x: 128, y: 64 }, to: { x: 128, y: 64 },
      pressure: 1, velocity: 0, timestamp: 2,
    });
    expect(fillText.mock.calls.map((call) => call[0])).toEqual(['A', 'B', 'C', 'D']);
    expect(engine.getSpamTextState().charIndex).toBe(count + 1);
  });

  it.each([BrushShape.SQUARE, BrushShape.PIXEL_ROUND])('preserves a non-origin %s grid stamp raster during finalization', (brushShape) => {
    const brushStampCache = new Map<string, HTMLCanvasElement>();
    const engine = new BrushEngineFacade({
      brushSettings: { ...createBaseSettings(), brushShape },
      createPixelCircleStamp: (size) => createPixelCircleStamp({ size, brushStampCache }),
    });
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    engine.renderBrushStroke(ctx, {
      from: { x: 16, y: 16 }, to: { x: 16, y: 16 },
      pressure: 1, velocity: 0, timestamp: 1,
    });
    const before = ctx.getImageData(0, 0, 64, 64).data.slice();
    expect(before.some((value, index) => index % 4 === 3 && value > 0)).toBe(true);
    expect(ctx.getImageData(0, 0, 1, 1).data[3]).toBe(0);

    engine.finalizeStroke(ctx);
    engine.finalizeStroke(ctx);

    expect(ctx.getImageData(0, 0, 64, 64).data).toEqual(before);
    expect(ctx.getImageData(0, 0, 1, 1).data[3]).toBe(0);
  });

  it('leaves no deferred custom stamp after anisotropic custom snapping', () => {
    const engine = new BrushEngineFacade({
      brushSettings: {
        ...createBaseSettings(), brushShape: BrushShape.CUSTOM,
        gridSnapEnabled: false, customBrushSnapEnabled: true, size: 20,
      },
    });
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    const imageData = new ImageData(20, 10);
    imageData.data.fill(255);
    const drawImage = jest.spyOn(ctx, 'drawImage');
    engine.renderBrushStroke(ctx, {
      from: { x: 21, y: 21 }, to: { x: 59, y: 39 },
      pressure: 1, velocity: 0, timestamp: 1,
      customBrushData: { imageData, width: 20, height: 10 },
    });
    const stamps = engine.consumeRecentStamps();
    expect(stamps.map(({ x, y }) => ({ x, y }))).toEqual([
      { x: 20, y: 20 }, { x: 40, y: 30 }, { x: 60, y: 40 },
    ]);
    expect(drawImage).toHaveBeenCalled();
    const calls = drawImage.mock.calls.map((call) => [...call]);
    const queue = engine.getPixelQueue();
    expect([queue.waitingPixelX, queue.waitingPixelY]).toEqual([60, 40]);

    engine.finalizeStroke(ctx);

    expect(drawImage.mock.calls).toEqual(calls);
  });

  it('does not turn a rejected grid contact into an unchecked deferred Spam stamp', () => {
    const engine = new BrushEngineFacade({
      brushSettings: { ...createBaseSettings(), brushShape: BrushShape.SPAM_TEXT },
    });
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    const fillText = jest.spyOn(ctx, 'fillText');
    const admission = jest.spyOn(engine, 'canDrawAt').mockReturnValue(false);
    engine.initializeSpamText('mixed', 'AB');
    engine.renderBrushStroke(ctx, {
      from: { x: 64, y: 64 }, to: { x: 80, y: 64 },
      pressure: 1, velocity: 0, timestamp: 1,
    });
    expect(admission).toHaveBeenCalled();
    expect(fillText).not.toHaveBeenCalled();

    engine.finalizeStroke(ctx);

    expect(fillText).not.toHaveBeenCalled();
    expect(engine.getSpamTextState().charIndex).toBe(0);
  });

  it('stamps across every traversed grid cell for pixel square regardless of spacing', () => {
    const engine = new BrushEngineFacade({
      brushSettings: createBaseSettings(),
    });
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    expect(ctx).not.toBeNull();
    if (!ctx) {
      return;
    }

    engine.renderBrushStroke(ctx, {
      from: { x: 0, y: 0 },
      to: { x: 32, y: 0 },
      pressure: 1,
      velocity: 1,
      timestamp: performance.now(),
    });

    const stamps = engine.consumeRecentStamps();
    const uniqueX = Array.from(new Set(stamps.map((stamp) => stamp.x))).sort((a, b) => a - b);
    expect(uniqueX).toEqual([0, 8, 16, 24, 32]);
  });

  it('stamps across every traversed grid cell for a diagonal snapped stroke', () => {
    const engine = new BrushEngineFacade({
      brushSettings: createBaseSettings(),
    });
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    expect(ctx).not.toBeNull();
    if (!ctx) {
      return;
    }

    engine.renderBrushStroke(ctx, {
      from: { x: 1, y: 1 },
      to: { x: 31, y: 30 },
      pressure: 1,
      velocity: 1,
      timestamp: performance.now(),
    });

    const stamps = engine.consumeRecentStamps();
    expect(stamps.map((stamp) => ({ x: stamp.x, y: stamp.y }))).toEqual([
      { x: 0, y: 0 },
      { x: 8, y: 8 },
      { x: 16, y: 16 },
      { x: 24, y: 24 },
      { x: 32, y: 32 },
    ]);
  });

  it('freezes grid spacing for the full stroke when pressure changes', () => {
    const engine = new BrushEngineFacade({
      brushSettings: {
        ...createBaseSettings(),
        pressureEnabled: true,
        minPressure: 100,
        maxPressure: 200,
      },
    });
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    expect(ctx).not.toBeNull();
    if (!ctx) {
      return;
    }

    engine.renderBrushStroke(ctx, {
      from: { x: 0, y: 0 },
      to: { x: 16, y: 16 },
      pressure: 1,
      velocity: 1,
      timestamp: performance.now(),
    });
    engine.consumeRecentStamps();

    engine.renderBrushStroke(ctx, {
      from: { x: 16, y: 16 },
      to: { x: 32, y: 32 },
      pressure: 0,
      velocity: 1,
      timestamp: performance.now(),
    });

    const stamps = engine.consumeRecentStamps();
    expect(stamps.map((stamp) => ({ x: stamp.x, y: stamp.y }))).toEqual([
      { x: 32, y: 32 },
    ]);
  });

  it('uses spacing-driven stamps when grid snap is disabled', () => {
    const engine = new BrushEngineFacade({
      brushSettings: {
        ...createBaseSettings(),
        gridSnapEnabled: false,
      },
    });
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    expect(ctx).not.toBeNull();
    if (!ctx) {
      return;
    }

    engine.renderBrushStroke(ctx, {
      from: { x: 0, y: 0 },
      to: { x: 32, y: 0 },
      pressure: 1,
      velocity: 1,
      timestamp: performance.now(),
    });

    const stamps = engine.consumeRecentStamps();
    expect(stamps.length).toBeLessThan(5);
  });

  it('snaps custom brushes on both axes using rendered width and height', () => {
    const engine = new BrushEngineFacade({
      brushSettings: {
        ...createBaseSettings(),
        brushShape: BrushShape.CUSTOM,
        gridSnapEnabled: false,
        customBrushSnapEnabled: true,
        size: 20,
      },
    });
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    expect(ctx).not.toBeNull();
    if (!ctx) {
      return;
    }

    engine.renderBrushStroke(ctx, {
      from: { x: 1, y: 1 },
      to: { x: 35, y: 19 },
      pressure: 1,
      velocity: 1,
      timestamp: performance.now(),
      customBrushData: {
        imageData: new ImageData(20, 10),
        width: 20,
        height: 10,
      },
    });

    const stamps = engine.consumeRecentStamps();
    expect(stamps.map((stamp) => ({ x: stamp.x, y: stamp.y }))).toEqual([
      { x: 0, y: 0 },
      { x: 20, y: 10 },
      { x: 40, y: 20 },
    ]);
  });

  it('uses resolved custom brush dimensions for final custom stamp scaling', () => {
    expect(
      resolveCustomPatternDrawDimensions(
        20,
        { width: 10, height: 10 },
        { width: 20, height: 10 }
      )
    ).toEqual({
      scaledWidth: 20,
      scaledHeight: 10,
    });
  });

  it('skips a near-duplicate terminal custom-brush stamp', () => {
    const engine = new BrushEngineFacade({
      brushSettings: {
        ...createBaseSettings(),
        brushShape: BrushShape.CUSTOM,
        gridSnapEnabled: false,
        customBrushSnapEnabled: false,
        antialiasing: true,
        spacing: 1,
        dashedEnabled: false,
        size: 12,
      },
    });
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    expect(ctx).not.toBeNull();
    if (!ctx) {
      return;
    }

    engine.renderBrushStroke(ctx, {
      from: { x: 0, y: 0 },
      to: { x: 2.4, y: 0 },
      pressure: 1,
      velocity: 0,
      timestamp: performance.now(),
      customBrushData: {
        imageData: new ImageData(12, 12),
        width: 12,
        height: 12,
      },
    });

    const stamps = engine.consumeRecentStamps();
    expect(stamps).toHaveLength(2);
    expect(stamps[0]?.x).toBe(0);
    expect(stamps[1]?.x).toBeCloseTo(1.6);
  });
});
