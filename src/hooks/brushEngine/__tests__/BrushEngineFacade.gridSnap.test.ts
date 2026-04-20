import { BrushEngineFacade } from '@/hooks/brushEngine/BrushEngineFacade';
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
        minPressure: 0,
        maxPressure: 100,
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
    expect(stamps).toHaveLength(1);
    expect(stamps[0]?.x).toBeCloseTo(1.6);
  });
});
