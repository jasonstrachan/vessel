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
    drawImage: jest.fn(),
    save: jest.fn(),
    restore: jest.fn(),
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    imageSmoothingEnabled: true,
  };
  return ctx as CanvasRenderingContext2D;
};

const createBrush = () => ({
  renderDirectToCanvas: jest.fn(),
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
    });

    expect(brush.paint).toHaveBeenCalledWith(11, 12, 'layer-1', 1, 0);
  });
});
