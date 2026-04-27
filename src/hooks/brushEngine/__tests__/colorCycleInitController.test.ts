import {
  ensureColorCycleAnimationForLayers,
  initializeColorCycleBrushForActiveLayer,
} from '../colorCycleInitController';
import { BrushShape, type BrushSettings } from '@/types';

const makeBrushSettings = (): BrushSettings => ({
  size: 12,
  opacity: 1,
  color: '#000000',
  blendMode: 'source-over',
  spacing: 8,
  pressure: 1,
  rotation: 0,
  antialiasing: true,
  pressureEnabled: false,
  minPressure: 0,
  rotationEnabled: false,
  dashedEnabled: false,
  dashLength: 1,
  useSwatchColor: true,
  dashGap: 1,
  gridSnapEnabled: false,
  shapeEnabled: false,
  colorJitter: 0,
  risographIntensity: 0,
  risographOutline: false,
  ditherEnabled: false,
} as BrushSettings);

const makeBrush = () => ({
  setOnFrameRendered: jest.fn(),
  endStroke: jest.fn(),
  setBrushSize: jest.fn(),
  setFPS: jest.fn(),
  setSpeed: jest.fn(),
  setLayerBaseSpeed: jest.fn(),
  setPlaybackSpeedScale: jest.fn(),
  setGradientBands: jest.fn(),
  setBandSpacing: jest.fn(),
  setDitherEnabled: jest.fn(),
  setDitherPixelSize: jest.fn(),
  setPxlEdgeEnabled: jest.fn(),
  setStampDitherEnabled: jest.fn(),
  setPressureEnabled: jest.fn(),
  setMinPressure: jest.fn(),
  setMaxPressure: jest.fn(),
  setStampShape: jest.fn(),
  setFlowMode: jest.fn(),
  setFlowDirection: jest.fn(),
  setLegacyFlowMode: jest.fn(),
  setDitherStrength: jest.fn(),
});

describe('colorCycleInitController', () => {
  it('returns null for non color-cycle layer', () => {
    const initColorCycleForLayer = jest.fn();

    const result = initializeColorCycleBrushForActiveLayer({
      activeLayerId: 'layer-1',
      projectWidth: 64,
      projectHeight: 64,
      brushSettings: makeBrushSettings(),
      isCCGradientActiveLayer: false,
      defaultBandSpacing: 12,
      clampColorCycleBandSpacing: (v) => v ?? 12,
      resolveBrushPressureRange: () => ({ enabled: false, minPercent: 100, maxPercent: 100 }),
      getLayers: () => [{ id: 'layer-1', layerType: 'bitmap' }],
      initColorCycleForLayer,
      getActiveLayerColorCycleBrush: () => null,
      requestGradientApply: jest.fn(),
    });

    expect(result).toBeNull();
    expect(initColorCycleForLayer).not.toHaveBeenCalled();
  });

  it('initializes and configures brush for active color-cycle layer', () => {
    const brush = makeBrush();
    const initColorCycleForLayer = jest.fn();
    const requestGradientApply = jest.fn();
    let firstCall = true;

    const result = initializeColorCycleBrushForActiveLayer({
      activeLayerId: 'layer-cc',
      projectWidth: 128,
      projectHeight: 64,
      brushSettings: {
        ...makeBrushSettings(),
        colorCycleFPS: 24,
        colorCycleSpeed: 6,
        gradientBands: 16,
        ditherEnabled: true,
        fillResolution: 3,
        pxlEdge: true,
      } as BrushSettings,
      isCCGradientActiveLayer: true,
      defaultBandSpacing: 12,
      clampColorCycleBandSpacing: (v) => v ?? 12,
      resolveBrushPressureRange: () => ({ enabled: true, minPercent: 80, maxPercent: 120 }),
      getLayers: () => [{ id: 'layer-cc', layerType: 'color-cycle' }],
      initColorCycleForLayer,
      getActiveLayerColorCycleBrush: () => {
        if (firstCall) {
          firstCall = false;
          return null;
        }
        return brush;
      },
      requestGradientApply,
    });

    expect(result).toBe(brush);
    expect(initColorCycleForLayer).toHaveBeenCalledWith('layer-cc', 128, 64);
    expect(brush.setBrushSize).toHaveBeenCalledWith(12);
    expect(brush.setFPS).toHaveBeenCalledWith(24);
    expect(brush.setSpeed).toHaveBeenCalledWith(6);
    expect(brush.setLayerBaseSpeed).toHaveBeenCalledWith(1);
    expect(brush.setGradientBands).toHaveBeenCalledWith(16);
    expect(brush.setDitherEnabled).toHaveBeenCalledWith(true);
    expect(brush.setDitherPixelSize).toHaveBeenCalledWith(3);
    expect(brush.setPxlEdgeEnabled).toHaveBeenCalledWith(true);
    expect(brush.setPressureEnabled).toHaveBeenCalledWith(true);
    expect(brush.setMinPressure).toHaveBeenCalledWith(80);
    expect(brush.setMaxPressure).toHaveBeenCalledWith(120);
    expect(requestGradientApply).toHaveBeenCalledWith('layer-cc', 'brush-init');
    expect(brush.setFlowMode).toHaveBeenCalledWith('forward');
  });

  it('does not initialize a fresh brush while a restored color-cycle layer is cold', () => {
    const initColorCycleForLayer = jest.fn();
    const requestGradientApply = jest.fn();

    const result = initializeColorCycleBrushForActiveLayer({
      activeLayerId: 'layer-cc',
      projectWidth: 128,
      projectHeight: 64,
      brushSettings: makeBrushSettings(),
      isCCGradientActiveLayer: true,
      defaultBandSpacing: 12,
      clampColorCycleBandSpacing: (v) => v ?? 12,
      resolveBrushPressureRange: () => ({ enabled: false, minPercent: 100, maxPercent: 100 }),
      getLayers: () => [{
        id: 'layer-cc',
        layerType: 'color-cycle',
        colorCycleData: {
          runtimeHydrationState: 'cold',
          deferredRuntimeRestore: true,
        },
      }],
      initColorCycleForLayer,
      getActiveLayerColorCycleBrush: () => null,
      requestGradientApply,
    });

    expect(result).toBeNull();
    expect(initColorCycleForLayer).not.toHaveBeenCalled();
    expect(requestGradientApply).not.toHaveBeenCalled();
  });

  it('passes the dedicated checkered stamp shape through to the CC brush', () => {
    const brush = makeBrush();

    initializeColorCycleBrushForActiveLayer({
      activeLayerId: 'layer-cc',
      projectWidth: 64,
      projectHeight: 64,
      brushSettings: {
        ...makeBrushSettings(),
        brushShape: BrushShape.COLOR_CYCLE,
        colorCycleStampShape: 'checkered',
      } as BrushSettings,
      isCCGradientActiveLayer: false,
      defaultBandSpacing: 12,
      clampColorCycleBandSpacing: (v) => v ?? 12,
      resolveBrushPressureRange: () => ({ enabled: false, minPercent: 100, maxPercent: 100 }),
      getLayers: () => [{ id: 'layer-cc', layerType: 'color-cycle' }],
      initColorCycleForLayer: jest.fn(),
      getActiveLayerColorCycleBrush: () => brush,
      requestGradientApply: jest.fn(),
    });

    expect(brush.setStampShape).toHaveBeenCalledWith('checkered');
  });

  it('applies global CC layer speed scale when configuring speed', () => {
    const brush = makeBrush();

    initializeColorCycleBrushForActiveLayer({
      activeLayerId: 'layer-cc',
      projectWidth: 64,
      projectHeight: 64,
      brushSettings: {
        ...makeBrushSettings(),
        colorCycleSpeed: 0.5,
      } as BrushSettings,
      playbackSpeedScale: 0.4,
      isCCGradientActiveLayer: false,
      defaultBandSpacing: 12,
      clampColorCycleBandSpacing: (v) => v ?? 12,
      resolveBrushPressureRange: () => ({ enabled: false, minPercent: 100, maxPercent: 100 }),
      getLayers: () => [{ id: 'layer-cc', layerType: 'color-cycle' }],
      initColorCycleForLayer: jest.fn(),
      getActiveLayerColorCycleBrush: () => brush,
      requestGradientApply: jest.fn(),
    });

    expect(brush.setSpeed).toHaveBeenCalledWith(0.5);
    expect(brush.setLayerBaseSpeed).toHaveBeenCalledWith(1);
    expect(brush.setPlaybackSpeedScale).toHaveBeenCalledWith(0.4);
  });

  it('keeps tool write speed separate from layer base speed when the layer has an override', () => {
    const brush = makeBrush();

    initializeColorCycleBrushForActiveLayer({
      activeLayerId: 'layer-cc',
      projectWidth: 64,
      projectHeight: 64,
      brushSettings: {
        ...makeBrushSettings(),
        colorCycleSpeed: 0.5,
      } as BrushSettings,
      playbackSpeedScale: 1,
      isCCGradientActiveLayer: false,
      defaultBandSpacing: 12,
      clampColorCycleBandSpacing: (v) => v ?? 12,
      resolveBrushPressureRange: () => ({ enabled: false, minPercent: 100, maxPercent: 100 }),
      getLayers: () => [{
        id: 'layer-cc',
        layerType: 'color-cycle',
        colorCycleData: { layerBaseSpeedCps: 1.4 },
      }],
      initColorCycleForLayer: jest.fn(),
      getActiveLayerColorCycleBrush: () => brush,
      requestGradientApply: jest.fn(),
    });

    expect(brush.setSpeed).toHaveBeenCalledWith(0.5);
    expect(brush.setLayerBaseSpeed).toHaveBeenCalledWith(1.4);
  });

  it('does not use legacy brushSpeed as a live layer base speed override', () => {
    const brush = makeBrush();

    initializeColorCycleBrushForActiveLayer({
      activeLayerId: 'layer-cc',
      projectWidth: 64,
      projectHeight: 64,
      brushSettings: {
        ...makeBrushSettings(),
        colorCycleSpeed: 0.5,
      } as BrushSettings,
      playbackSpeedScale: 1,
      isCCGradientActiveLayer: false,
      defaultBandSpacing: 12,
      clampColorCycleBandSpacing: (v) => v ?? 12,
      resolveBrushPressureRange: () => ({ enabled: false, minPercent: 100, maxPercent: 100 }),
      getLayers: () => [{
        id: 'layer-cc',
        layerType: 'color-cycle',
        colorCycleData: { brushSpeed: 1.4 },
      }],
      initColorCycleForLayer: jest.fn(),
      getActiveLayerColorCycleBrush: () => brush,
      requestGradientApply: jest.fn(),
    });

    expect(brush.setSpeed).toHaveBeenCalledWith(0.5);
    expect(brush.setLayerBaseSpeed).toHaveBeenCalledWith(1);
  });

  it('toggles animation only for color-cycle layers', () => {
    const ccBrush = { startAnimation: jest.fn(), stopAnimation: jest.fn() };
    const bitmapBrush = { startAnimation: jest.fn(), stopAnimation: jest.fn() };

    ensureColorCycleAnimationForLayers({
      shouldPlay: true,
      layers: [
        { id: 'cc', layerType: 'color-cycle' },
        { id: 'bmp', layerType: 'bitmap' },
      ],
      getBrush: (id) => (id === 'cc' ? ccBrush : bitmapBrush),
    });

    expect(ccBrush.startAnimation).toHaveBeenCalledTimes(1);
    expect(bitmapBrush.startAnimation).not.toHaveBeenCalled();

    ensureColorCycleAnimationForLayers({
      shouldPlay: false,
      layers: [{ id: 'cc', layerType: 'color-cycle' }],
      getBrush: () => ccBrush,
    });

    expect(ccBrush.stopAnimation).toHaveBeenCalledTimes(1);
  });
});
