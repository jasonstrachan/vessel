import {
  updateColorCycleBandSpacingForLayer,
  updateColorCycleDitherSettings,
  updateColorCycleDitherPaletteSpreadForLayer,
  updateColorCycleFillDitherPixelSize,
  updateColorCycleGradientBandsForLayer,
  updateColorCycleStampDitherPixelSize,
} from '../colorCycleBrushSettingsController';
import { BrushShape } from '@/types';
import type { ColorCycleBrushImplementation } from '../ColorCycleBrushMigration';

const makeBrush = () => ({
  setGradientBands: jest.fn(),
  setBandSpacing: jest.fn(),
  setDitherEnabled: jest.fn(),
  setDitherStrength: jest.fn(),
  setPxlEdgeEnabled: jest.fn(),
  setStampDitherEnabled: jest.fn(),
  setStampDitherAlgorithm: jest.fn(),
  setStampDitherPatternStyle: jest.fn(),
  setStampDitherPressureLinked: jest.fn(),
  setStampDitherBgFill: jest.fn(),
  setStampDitherClears: jest.fn(),
  setDitherPixelSize: jest.fn(),
  setStampDitherPixelSize: jest.fn(),
});

describe('colorCycleBrushSettingsController', () => {
  it('updates gradient bands and renders for color-cycle layer', () => {
    const brush = makeBrush();
    const renderBrushToLayerCanvas = jest.fn();

    updateColorCycleGradientBandsForLayer({
      activeLayerId: 'layer-1',
      getLayers: () => [{ id: 'layer-1', layerType: 'color-cycle' }],
      getActiveLayerColorCycleBrush: () => brush as unknown as ColorCycleBrushImplementation,
      initializeColorCycleBrush: () => null,
      gradientBands: 14,
      renderBrushToLayerCanvas,
    });

    expect(brush.setGradientBands).toHaveBeenCalledWith(14);
    expect(renderBrushToLayerCanvas).toHaveBeenCalledWith(brush, 'layer-1');
  });

  it('updates spacing based on brush shape mode', () => {
    const brush = makeBrush();
    const renderBrushToLayerCanvas = jest.fn();

    updateColorCycleBandSpacingForLayer({
      activeLayerId: 'layer-1',
      getLayers: () => [{ id: 'layer-1', layerType: 'color-cycle' }],
      getActiveLayerColorCycleBrush: () => brush as unknown as ColorCycleBrushImplementation,
      initializeColorCycleBrush: () => null,
      brushShape: BrushShape.COLOR_CYCLE_SHAPE,
      colorCycleBandSpacingPx: 9,
      spacing: 5,
      defaultBandSpacing: 12,
      clampColorCycleBandSpacing: (v) => v ?? 12,
      renderBrushToLayerCanvas,
    });

    expect(brush.setBandSpacing).toHaveBeenCalledWith(9);
  });

  it('re-renders the active color-cycle layer when dither spread changes', () => {
    const brush = makeBrush();
    const renderBrushToLayerCanvas = jest.fn();

    updateColorCycleDitherPaletteSpreadForLayer({
      activeLayerId: 'layer-1',
      getLayers: () => [{ id: 'layer-1', layerType: 'color-cycle' }],
      getActiveLayerColorCycleBrush: () => brush as unknown as ColorCycleBrushImplementation,
      initializeColorCycleBrush: () => null,
      renderBrushToLayerCanvas,
    });

    expect(renderBrushToLayerCanvas).toHaveBeenCalledWith(brush, 'layer-1');
  });

  it('updates dither toggles and derived bg fill', () => {
    const brush = makeBrush();

    updateColorCycleDitherSettings({
      brush: brush as unknown as ColorCycleBrushImplementation,
      isCCGradientActiveLayer: true,
      ditherEnabled: true,
      stampDitherEnabled: true,
      ditherAlgorithm: 'sierra-lite',
      patternStyle: 'dots',
      stampDitherPressureLinked: true,
      stampDitherBgFill: undefined,
      stampDitherClears: true,
      pxlEdge: true,
    });

    expect(brush.setDitherEnabled).toHaveBeenCalledWith(true);
    expect(brush.setDitherStrength).toHaveBeenCalledWith(1);
    expect(brush.setPxlEdgeEnabled).toHaveBeenCalledWith(true);
    expect(brush.setStampDitherEnabled).toHaveBeenCalledWith(false);
    expect(brush.setStampDitherBgFill).toHaveBeenCalledWith(false);
  });

  it('updates fill/stamp dither pixel sizes', () => {
    const brush = makeBrush();

    updateColorCycleFillDitherPixelSize({
      brush: brush as unknown as ColorCycleBrushImplementation,
      isCCGradientActiveLayer: true,
      pressureLinkedFillResolution: false,
      fillResolution: 4.9,
    });

    updateColorCycleStampDitherPixelSize({
      brush: brush as unknown as ColorCycleBrushImplementation,
      stampDitherPixelSize: 2.2,
    });

    expect(brush.setDitherPixelSize).toHaveBeenCalledWith(4);
    expect(brush.setStampDitherPixelSize).toHaveBeenCalledWith(2);
  });
});
