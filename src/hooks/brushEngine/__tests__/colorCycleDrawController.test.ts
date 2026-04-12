import {
  drawColorCycleStroke,
  renderColorCycleToContext,
} from '../colorCycleDrawController';
import { BrushShape } from '@/types';
import type { ColorCycleBrushImplementation } from '../ColorCycleBrushMigration';

const createCtx = () => {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;

  const ctx: Partial<CanvasRenderingContext2D> = {
    canvas,
    clearRect: jest.fn(),
    drawImage: jest.fn(),
    fill: jest.fn(),
    fillRect: jest.fn(),
    beginPath: jest.fn(),
    closePath: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    arc: jest.fn(),
    save: jest.fn(),
    restore: jest.fn(),
    fillStyle: '#000000',
    strokeStyle: '#000000',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    imageSmoothingEnabled: true,
  };
  return ctx as CanvasRenderingContext2D;
};

const previewGradient = [
  { position: 0, color: '#ff0000' },
  { position: 1, color: '#00ff00' },
];

const createBrush = () => ({
  renderDirectToCanvas: jest.fn(),
  startStroke: jest.fn(),
  getLayerSnapshot: jest.fn(() => ({
    paintBuffer: new ArrayBuffer(0),
    hasContent: false,
    strokeCounter: 0,
  })),
  applyLayerSnapshot: jest.fn(),
  setPressureEnabled: jest.fn(),
  setMinPressure: jest.fn(),
  setMaxPressure: jest.fn(),
  setStampShape: jest.fn(),
  setBrushSize: jest.fn(),
  paint: jest.fn(),
  paintCustomStamp: jest.fn(),
  getCanvas: jest.fn(() => {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    return c;
  }),
});

describe('colorCycleDrawController', () => {
  const originalRequestAnimationFrame = global.requestAnimationFrame;

  beforeEach(() => {
    global.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    }) as typeof requestAnimationFrame;
  });

  afterAll(() => {
    global.requestAnimationFrame = originalRequestAnimationFrame;
  });

  it('renderColorCycleToContext returns early without active layer', () => {
    const ctx = createCtx();
    const brush = createBrush();
    const requestGradientApply = jest.fn();

    renderColorCycleToContext({
      ctx,
      activeLayerId: null,
      getActiveLayerColorCycleBrush: () => brush as unknown as ColorCycleBrushImplementation,
      isFgPending: () => false,
      refreshLayerCCSurface: () => document.createElement('canvas'),
      ensureCanvasPixelSize: jest.fn(),
      bindBrushToCanvas: jest.fn(),
      requestGradientApply,
      flushGradientApply: jest.fn(),
      brushSettings: { opacity: 1, blendMode: 'source-over' },
      activeLayerTransparencyLock: false,
      renderCCWithBlendAndLock: jest.fn(),
      applyColorCycleRisographOverlay: jest.fn(),
    });

    expect(requestGradientApply).not.toHaveBeenCalled();
    expect(brush.renderDirectToCanvas).not.toHaveBeenCalled();
  });

  it('renderColorCycleToContext renders and applies overlay', () => {
    const ctx = createCtx();
    const brush = createBrush();
    const layerCanvas = document.createElement('canvas');
    layerCanvas.width = 64;
    layerCanvas.height = 64;

    const requestGradientApply = jest.fn();
    const flushGradientApply = jest.fn();
    const overlay = jest.fn();

    renderColorCycleToContext({
      ctx,
      activeLayerId: 'layer-1',
      getActiveLayerColorCycleBrush: () => brush as unknown as ColorCycleBrushImplementation,
      isFgPending: () => false,
      refreshLayerCCSurface: () => layerCanvas,
      ensureCanvasPixelSize: jest.fn(),
      bindBrushToCanvas: jest.fn(),
      requestGradientApply,
      flushGradientApply,
      brushSettings: { opacity: 0.5, blendMode: 'source-over' },
      activeLayerTransparencyLock: false,
      renderCCWithBlendAndLock: jest.fn(),
      applyColorCycleRisographOverlay: overlay,
    });

    expect(requestGradientApply).toHaveBeenCalledWith('layer-1', 'render-color-cycle');
    expect(flushGradientApply).toHaveBeenCalledWith('layer-1');
    expect(brush.renderDirectToCanvas).toHaveBeenCalledWith(layerCanvas, 'layer-1');
    expect((ctx.drawImage as jest.Mock)).toHaveBeenCalled();
    expect(overlay).toHaveBeenCalledWith(ctx, layerCanvas, 0.5);
  });

  it('drawColorCycleStroke paints and triggers immediate render on first stamp', () => {
    const ctx = createCtx();
    const brush = createBrush();
    const renderColorCycle = jest.fn();

    const firstStampImmediateRef = { current: true };
    const mirrorScheduledRef = { current: false };

    drawColorCycleStroke({
      ctx,
      x: 10,
      y: 12,
      pressure: 0.8,
      rotation: 0,
      brushSettings: {
        size: 8,
        brushShape: BrushShape.COLOR_CYCLE,
        colorCycleStampShape: 'square',
        color: '#ff0000',
        colorCycleGradient: previewGradient,
        gridSnapEnabled: false,
        gridSnapSize: 8,
        pressureEnabled: false,
        minPressure: 0,
        maxPressure: 100,
      },
      activeLayerId: 'layer-1',
      activeLayerTransparencyLock: false,
      getActiveLayerColorCycleBrush: () => brush as unknown as ColorCycleBrushImplementation,
      getActiveLayerBitmapCanvas: () => null,
      maskHasAlphaNear: jest.fn(() => true),
      resolveBrushPressureRange: () => ({ enabled: false, minPercent: 100, maxPercent: 100 }),
      requestGradientApply: jest.fn(),
      flushGradientApply: jest.fn(),
      renderColorCycle,
      firstStampImmediateRef,
      mirrorScheduledRef,
      gridSnapStrokePointRef: { current: null },
      roundedCornerAnchorsRef: { current: [] },
      roundedCornerBaselineSnapshotRef: { current: null },
    });

    expect(brush.paint).toHaveBeenCalled();
    expect(renderColorCycle).toHaveBeenCalledWith(ctx, true, { withOverlay: false });
    expect(firstStampImmediateRef.current).toBe(false);
  });

  it('quantizes color-cycle paint coordinates by stamp raster anchor', () => {
    const ctx = createCtx();
    const brush = createBrush();

    drawColorCycleStroke({
      ctx,
      x: 10.2,
      y: 12.9,
      brushSettings: {
        size: 1,
        brushShape: BrushShape.COLOR_CYCLE,
        colorCycleStampShape: 'round',
        color: '#ff0000',
        colorCycleGradient: previewGradient,
        gridSnapEnabled: false,
        gridSnapSize: 8,
        pressureEnabled: false,
        minPressure: 0,
        maxPressure: 100,
      },
      activeLayerId: 'layer-1',
      activeLayerTransparencyLock: false,
      getActiveLayerColorCycleBrush: () => brush as unknown as ColorCycleBrushImplementation,
      getActiveLayerBitmapCanvas: () => null,
      maskHasAlphaNear: jest.fn(() => true),
      resolveBrushPressureRange: () => ({ enabled: false, minPercent: 100, maxPercent: 100 }),
      requestGradientApply: jest.fn(),
      flushGradientApply: jest.fn(),
      renderColorCycle: jest.fn(),
      firstStampImmediateRef: { current: false },
      mirrorScheduledRef: { current: false },
      gridSnapStrokePointRef: { current: null },
      roundedCornerAnchorsRef: { current: [] },
      roundedCornerBaselineSnapshotRef: { current: null },
    });

    expect(brush.paint).toHaveBeenCalledWith(10.5, 12.5, 'layer-1', 1, 0);

    (brush.paint as jest.Mock).mockClear();

    drawColorCycleStroke({
      ctx,
      x: 10.8,
      y: 12.2,
      brushSettings: {
        size: 1,
        brushShape: BrushShape.COLOR_CYCLE,
        colorCycleStampShape: 'square',
        color: '#ff0000',
        colorCycleGradient: previewGradient,
        gridSnapEnabled: false,
        gridSnapSize: 8,
        pressureEnabled: false,
        minPressure: 0,
        maxPressure: 100,
      },
      activeLayerId: 'layer-1',
      activeLayerTransparencyLock: false,
      getActiveLayerColorCycleBrush: () => brush as unknown as ColorCycleBrushImplementation,
      getActiveLayerBitmapCanvas: () => null,
      maskHasAlphaNear: jest.fn(() => true),
      resolveBrushPressureRange: () => ({ enabled: false, minPercent: 100, maxPercent: 100 }),
      requestGradientApply: jest.fn(),
      flushGradientApply: jest.fn(),
      renderColorCycle: jest.fn(),
      firstStampImmediateRef: { current: false },
      mirrorScheduledRef: { current: false },
      gridSnapStrokePointRef: { current: null },
      roundedCornerAnchorsRef: { current: [] },
      roundedCornerBaselineSnapshotRef: { current: null },
    });

    expect(brush.paint).toHaveBeenCalledWith(11, 12, 'layer-1', 1, 0);
  });

  it('rasterizes a continuous snapped line for color-cycle stroke grid snap', () => {
    const ctx = createCtx();
    const brush = createBrush();
    const gridSnapStrokePointRef = { current: null as { x: number; y: number } | null };
    const roundedCornerAnchorsRef = { current: [] as Array<{ x: number; y: number }> };
    const roundedCornerBaselineSnapshotRef = { current: null as {
      paintBuffer: ArrayBuffer;
      gradientIdBuffer?: ArrayBuffer;
      gradientDefIdBuffer?: ArrayBuffer;
      speedBuffer?: ArrayBuffer;
      flowBuffer?: ArrayBuffer;
      hasContent: boolean;
      strokeCounter: number;
    } | null };

    const baseArgs = {
      ctx,
      activeLayerId: 'layer-1',
      activeLayerTransparencyLock: false,
      getActiveLayerColorCycleBrush: () => brush as unknown as ColorCycleBrushImplementation,
      getActiveLayerBitmapCanvas: () => null,
      maskHasAlphaNear: jest.fn(() => true),
      resolveBrushPressureRange: () => ({ enabled: false, minPercent: 100, maxPercent: 100 }),
      requestGradientApply: jest.fn(),
      flushGradientApply: jest.fn(),
      renderColorCycle: jest.fn(),
      firstStampImmediateRef: { current: true },
      mirrorScheduledRef: { current: false },
      gridSnapStrokePointRef,
      roundedCornerAnchorsRef,
      roundedCornerBaselineSnapshotRef,
      brushSettings: {
        size: 1,
        brushShape: BrushShape.COLOR_CYCLE,
        colorCycleStampShape: 'square' as const,
        color: '#ff0000',
        colorCycleGradient: previewGradient,
        gridSnapEnabled: true,
        gridSnapSize: 8,
        roundedCornersEnabled: false,
        cornerRadiusPx: 8,
        pressureEnabled: false,
        minPressure: 0,
        maxPressure: 100,
      },
    };

    drawColorCycleStroke({
      ...baseArgs,
      x: 1,
      y: 1,
    });

    drawColorCycleStroke({
      ...baseArgs,
      x: 25,
      y: 1,
    });

    const paintedPoints = (brush.paint as jest.Mock).mock.calls.map((call) => [call[0], call[1]]);
    expect(paintedPoints[0]).toEqual([0, 0]);
    expect(paintedPoints[paintedPoints.length - 1]).toEqual([24, 0]);
    expect(paintedPoints).toContainEqual([12, 0]);
    expect(paintedPoints).toContainEqual([20, 0]);
    expect(paintedPoints.length).toBe(25);
  });

  it('does not connect a new snapped stroke to the previous stroke after reset', () => {
    const ctx = createCtx();
    const brush = createBrush();
    const gridSnapStrokePointRef = { current: null as { x: number; y: number } | null };
    const roundedCornerAnchorsRef = { current: [] as Array<{ x: number; y: number }> };
    const roundedCornerBaselineSnapshotRef = { current: null as {
      paintBuffer: ArrayBuffer;
      gradientIdBuffer?: ArrayBuffer;
      gradientDefIdBuffer?: ArrayBuffer;
      speedBuffer?: ArrayBuffer;
      flowBuffer?: ArrayBuffer;
      hasContent: boolean;
      strokeCounter: number;
    } | null };

    const baseArgs = {
      ctx,
      activeLayerId: 'layer-1',
      activeLayerTransparencyLock: false,
      getActiveLayerColorCycleBrush: () => brush as unknown as ColorCycleBrushImplementation,
      getActiveLayerBitmapCanvas: () => null,
      maskHasAlphaNear: jest.fn(() => true),
      resolveBrushPressureRange: () => ({ enabled: false, minPercent: 100, maxPercent: 100 }),
      requestGradientApply: jest.fn(),
      flushGradientApply: jest.fn(),
      renderColorCycle: jest.fn(),
      firstStampImmediateRef: { current: false },
      mirrorScheduledRef: { current: false },
      gridSnapStrokePointRef,
      roundedCornerAnchorsRef,
      roundedCornerBaselineSnapshotRef,
      brushSettings: {
        size: 1,
        brushShape: BrushShape.COLOR_CYCLE,
        colorCycleStampShape: 'square' as const,
        color: '#ff0000',
        colorCycleGradient: previewGradient,
        gridSnapEnabled: true,
        gridSnapSize: 8,
        roundedCornersEnabled: false,
        cornerRadiusPx: 8,
        pressureEnabled: false,
        minPressure: 0,
        maxPressure: 100,
      },
    };

    drawColorCycleStroke({
      ...baseArgs,
      x: 1,
      y: 1,
    });
    drawColorCycleStroke({
      ...baseArgs,
      x: 25,
      y: 1,
    });

    gridSnapStrokePointRef.current = null;
    (brush.paint as jest.Mock).mockClear();

    drawColorCycleStroke({
      ...baseArgs,
      x: 1,
      y: 17,
    });

    expect((brush.paint as jest.Mock).mock.calls.map((call) => [call[0], call[1]])).toEqual([
      [0, 16],
    ]);
  });

  it('uses rounded grid path points when rounded corners are enabled', () => {
    const ctx = createCtx();
    const brush = createBrush();
    const gridSnapStrokePointRef = { current: { x: 0, y: 0 } };
    const roundedCornerAnchorsRef = { current: [{ x: 0, y: 0 }] as Array<{ x: number; y: number }> };
    const roundedCornerBaselineSnapshotRef = { current: null as {
      paintBuffer: ArrayBuffer;
      gradientIdBuffer?: ArrayBuffer;
      gradientDefIdBuffer?: ArrayBuffer;
      speedBuffer?: ArrayBuffer;
      flowBuffer?: ArrayBuffer;
      hasContent: boolean;
      strokeCounter: number;
    } | null };

    drawColorCycleStroke({
      ctx,
      x: 17,
      y: 17,
      brushSettings: {
        size: 1,
        brushShape: BrushShape.COLOR_CYCLE,
        colorCycleStampShape: 'square',
        color: '#ff0000',
        colorCycleGradient: previewGradient,
        gridSnapEnabled: true,
        gridSnapSize: 8,
        roundedCornersEnabled: true,
        cornerRadiusPx: 2,
        pressureEnabled: false,
        minPressure: 0,
        maxPressure: 100,
      },
      activeLayerId: 'layer-1',
      activeLayerTransparencyLock: false,
      getActiveLayerColorCycleBrush: () => brush as unknown as ColorCycleBrushImplementation,
      getActiveLayerBitmapCanvas: () => null,
      maskHasAlphaNear: jest.fn(() => true),
      resolveBrushPressureRange: () => ({ enabled: false, minPercent: 100, maxPercent: 100 }),
      requestGradientApply: jest.fn(),
      flushGradientApply: jest.fn(),
      renderColorCycle: jest.fn(),
      firstStampImmediateRef: { current: false },
      mirrorScheduledRef: { current: false },
      gridSnapStrokePointRef,
      roundedCornerAnchorsRef,
      roundedCornerBaselineSnapshotRef,
    });

    const paintedPoints = (brush.paint as jest.Mock).mock.calls.map((call) => [call[0], call[1]]);
    expect(paintedPoints).not.toContainEqual([16, 0]);
    expect(paintedPoints).toContainEqual([15, 1]);
    expect(brush.applyLayerSnapshot).toHaveBeenCalledWith('layer-1', expect.objectContaining({ hasContent: false }));
    expect(brush.startStroke).toHaveBeenCalledWith('layer-1', false);
  });

  it('skips rounded rebuild work when the pointer stays in the same snapped cell', () => {
    const ctx = createCtx();
    const brush = createBrush();
    const gridSnapStrokePointRef = { current: { x: 16, y: 16 } };
    const roundedCornerAnchorsRef = { current: [{ x: 16, y: 16 }] as Array<{ x: number; y: number }> };
    const roundedCornerBaselineSnapshotRef = { current: null as {
      paintBuffer: ArrayBuffer;
      gradientIdBuffer?: ArrayBuffer;
      gradientDefIdBuffer?: ArrayBuffer;
      speedBuffer?: ArrayBuffer;
      flowBuffer?: ArrayBuffer;
      hasContent: boolean;
      strokeCounter: number;
    } | null };

    drawColorCycleStroke({
      ctx,
      x: 17,
      y: 17,
      brushSettings: {
        size: 1,
        brushShape: BrushShape.COLOR_CYCLE,
        colorCycleStampShape: 'square',
        color: '#ff0000',
        colorCycleGradient: previewGradient,
        gridSnapEnabled: true,
        gridSnapSize: 8,
        roundedCornersEnabled: true,
        cornerRadiusPx: 2,
        pressureEnabled: false,
        minPressure: 0,
        maxPressure: 100,
      },
      activeLayerId: 'layer-1',
      activeLayerTransparencyLock: false,
      getActiveLayerColorCycleBrush: () => brush as unknown as ColorCycleBrushImplementation,
      getActiveLayerBitmapCanvas: () => null,
      maskHasAlphaNear: jest.fn(() => true),
      resolveBrushPressureRange: () => ({ enabled: false, minPercent: 100, maxPercent: 100 }),
      requestGradientApply: jest.fn(),
      flushGradientApply: jest.fn(),
      renderColorCycle: jest.fn(),
      firstStampImmediateRef: { current: false },
      mirrorScheduledRef: { current: false },
      gridSnapStrokePointRef,
      roundedCornerAnchorsRef,
      roundedCornerBaselineSnapshotRef,
    });

    expect(brush.paint).not.toHaveBeenCalled();
    expect(brush.getLayerSnapshot).not.toHaveBeenCalled();
    expect(brush.applyLayerSnapshot).not.toHaveBeenCalled();
    expect(brush.startStroke).not.toHaveBeenCalled();
  });

  it('still re-renders grid snap preview when the cursor moves inside the same snapped cell', () => {
    const ctx = createCtx();
    const brush = createBrush();
    const renderColorCycle = jest.fn();
    const gridSnapStrokePointRef = { current: { x: 16, y: 16 } };
    const roundedCornerAnchorsRef = { current: [{ x: 16, y: 16 }] as Array<{ x: number; y: number }> };

    drawColorCycleStroke({
      ctx,
      x: 19,
      y: 18,
      brushSettings: {
        size: 2,
        brushShape: BrushShape.COLOR_CYCLE,
        colorCycleStampShape: 'square',
        color: '#ff0000',
        colorCycleGradient: previewGradient,
        gridSnapEnabled: true,
        gridSnapSize: 8,
        roundedCornersEnabled: false,
        cornerRadiusPx: 2,
        pressureEnabled: false,
        minPressure: 0,
        maxPressure: 100,
      },
      activeLayerId: 'layer-1',
      activeLayerTransparencyLock: false,
      getActiveLayerColorCycleBrush: () => brush as unknown as ColorCycleBrushImplementation,
      getActiveLayerBitmapCanvas: () => null,
      maskHasAlphaNear: jest.fn(() => true),
      resolveBrushPressureRange: () => ({ enabled: false, minPercent: 100, maxPercent: 100 }),
      requestGradientApply: jest.fn(),
      flushGradientApply: jest.fn(),
      renderColorCycle,
      firstStampImmediateRef: { current: false },
      mirrorScheduledRef: { current: false },
      gridSnapStrokePointRef,
      roundedCornerAnchorsRef,
      roundedCornerBaselineSnapshotRef: { current: null },
    });

    expect(brush.paint).not.toHaveBeenCalled();
    expect(renderColorCycle).toHaveBeenCalledWith(ctx, true, { withOverlay: false });
    expect((ctx.fillRect as jest.Mock)).not.toHaveBeenCalled();
  });

  it('rebuilds the full rounded path so multiple corners stay rounded', () => {
    const ctx = createCtx();
    const brush = createBrush();
    const gridSnapStrokePointRef = { current: null as { x: number; y: number } | null };
    const roundedCornerAnchorsRef = { current: [] as Array<{ x: number; y: number }> };
    const roundedCornerBaselineSnapshotRef = { current: null as {
      paintBuffer: ArrayBuffer;
      gradientIdBuffer?: ArrayBuffer;
      gradientDefIdBuffer?: ArrayBuffer;
      speedBuffer?: ArrayBuffer;
      flowBuffer?: ArrayBuffer;
      hasContent: boolean;
      strokeCounter: number;
    } | null };

    const baseArgs = {
      ctx,
      activeLayerId: 'layer-1',
      activeLayerTransparencyLock: false,
      getActiveLayerColorCycleBrush: () => brush as unknown as ColorCycleBrushImplementation,
      getActiveLayerBitmapCanvas: () => null,
      maskHasAlphaNear: jest.fn(() => true),
      resolveBrushPressureRange: () => ({ enabled: false, minPercent: 100, maxPercent: 100 }),
      requestGradientApply: jest.fn(),
      flushGradientApply: jest.fn(),
      renderColorCycle: jest.fn(),
      firstStampImmediateRef: { current: false },
      mirrorScheduledRef: { current: false },
      gridSnapStrokePointRef,
      roundedCornerAnchorsRef,
      roundedCornerBaselineSnapshotRef,
      brushSettings: {
        size: 1,
        brushShape: BrushShape.COLOR_CYCLE,
        colorCycleStampShape: 'square' as const,
        color: '#ff0000',
        colorCycleGradient: previewGradient,
        gridSnapEnabled: true,
        gridSnapSize: 8,
        roundedCornersEnabled: true,
        cornerRadiusPx: 2,
        pressureEnabled: false,
        minPressure: 0,
        maxPressure: 100,
      },
    };

    drawColorCycleStroke({ ...baseArgs, x: 1, y: 1 });
    drawColorCycleStroke({ ...baseArgs, x: 9, y: 1 });
    drawColorCycleStroke({ ...baseArgs, x: 9, y: 9 });
    (brush.paint as jest.Mock).mockClear();
    drawColorCycleStroke({ ...baseArgs, x: 0, y: 9 });

    const paintedPoints = (brush.paint as jest.Mock).mock.calls.map((call) => [call[0], call[1]]);
    expect(paintedPoints).not.toContainEqual([8, 0]);
    expect(paintedPoints).not.toContainEqual([8, 8]);
    expect(paintedPoints).toContainEqual([7, 1]);
    expect(paintedPoints).toContainEqual([7, 7]);
  });

  it('restores the baseline snapshot before rounded rebuilds so older strokes are preserved', () => {
    const ctx = createCtx();
    const brush = createBrush();
    const baselineSnapshot = {
      paintBuffer: new Uint8Array([1, 2, 3]).buffer,
      gradientIdBuffer: new Uint8Array([4, 5, 6]).buffer,
      hasContent: true,
      strokeCounter: 12,
    };
    brush.getLayerSnapshot.mockReturnValue(baselineSnapshot);

    const gridSnapStrokePointRef = { current: { x: 0, y: 0 } };
    const roundedCornerAnchorsRef = { current: [{ x: 0, y: 0 }] as Array<{ x: number; y: number }> };
    const roundedCornerBaselineSnapshotRef = { current: null as {
      paintBuffer: ArrayBuffer;
      gradientIdBuffer?: ArrayBuffer;
      gradientDefIdBuffer?: ArrayBuffer;
      speedBuffer?: ArrayBuffer;
      flowBuffer?: ArrayBuffer;
      hasContent: boolean;
      strokeCounter: number;
    } | null };

    drawColorCycleStroke({
      ctx,
      x: 17,
      y: 17,
      brushSettings: {
        size: 1,
        brushShape: BrushShape.COLOR_CYCLE,
        colorCycleStampShape: 'square',
        color: '#ff0000',
        colorCycleGradient: previewGradient,
        gridSnapEnabled: true,
        gridSnapSize: 8,
        roundedCornersEnabled: true,
        cornerRadiusPx: 2,
        pressureEnabled: false,
        minPressure: 0,
        maxPressure: 100,
      },
      activeLayerId: 'layer-1',
      activeLayerTransparencyLock: false,
      getActiveLayerColorCycleBrush: () => brush as unknown as ColorCycleBrushImplementation,
      getActiveLayerBitmapCanvas: () => null,
      maskHasAlphaNear: jest.fn(() => true),
      resolveBrushPressureRange: () => ({ enabled: false, minPercent: 100, maxPercent: 100 }),
      requestGradientApply: jest.fn(),
      flushGradientApply: jest.fn(),
      renderColorCycle: jest.fn(),
      firstStampImmediateRef: { current: false },
      mirrorScheduledRef: { current: false },
      gridSnapStrokePointRef,
      roundedCornerAnchorsRef,
      roundedCornerBaselineSnapshotRef,
    });

    expect(roundedCornerBaselineSnapshotRef.current).toBe(baselineSnapshot);
    expect(brush.applyLayerSnapshot).toHaveBeenCalledWith('layer-1', baselineSnapshot);
    expect(brush.startStroke).toHaveBeenCalledWith('layer-1', false);
    expect(brush.startStroke).not.toHaveBeenCalledWith('layer-1', true);
  });
});
