import {
  fillColorCycleConcentric,
  fillColorCycleLinear,
} from '../colorCycleFillController';
import { BrushShape } from '@/types';
import type { ColorCycleBrushImplementation } from '../ColorCycleBrushMigration';

const createBrush = () => ({
  setLayerId: jest.fn(),
  setActiveLayer: jest.fn(),
  getLayerId: jest.fn(() => 'layer-1'),
  setGradientBands: jest.fn(),
  setBandSpacing: jest.fn(),
  setDitherPixelSize: jest.fn(),
  fillShapeDispatch: jest.fn(async () => undefined),
  endStroke: jest.fn(),
});

describe('colorCycleFillController', () => {
  it('dispatches linear fill payload and renders layer', async () => {
    const brush = createBrush();
    const renderBrushToLayerCanvas = jest.fn();

    await fillColorCycleLinear({
      vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }],
      direction: { x: 1, y: 0 },
      options: { ditherPixelSize: 2 },
      initializeColorCycleBrush: () => brush as unknown as ColorCycleBrushImplementation,
      activeLayerId: 'layer-1',
      isCCGradientActiveLayer: true,
      brushSettings: {
        ditherEnabled: true,
        gradientBands: 8,
        brushShape: BrushShape.COLOR_CYCLE_SHAPE,
        gridSnapEnabled: false,
        gridSnapSize: 8,
        colorCycleBandSpacingPx: 10,
        spacing: 6,
        lostEdge: 4,
        ditherBackgroundFill: true,
        ditherGradBgFill: true,
      },
      defaultBandSpacing: 12,
      clampColorCycleBandSpacing: (value) => value ?? 12,
      requestGradientApply: jest.fn(),
      flushGradientApply: jest.fn(),
      renderBrushToLayerCanvas,
    });

    expect(brush.fillShapeDispatch).toHaveBeenCalledWith(expect.objectContaining({ mode: 'linear', layerId: 'layer-1' }));
    expect(brush.endStroke).toHaveBeenCalledWith('layer-1');
    expect(renderBrushToLayerCanvas).toHaveBeenCalledWith(brush, 'layer-1');
  });

  it('allows 1 dither color level for cc-gradient fills', async () => {
    const brush = createBrush();

    await fillColorCycleLinear({
      vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }],
      direction: { x: 1, y: 0 },
      initializeColorCycleBrush: () => brush as unknown as ColorCycleBrushImplementation,
      activeLayerId: 'layer-1',
      isCCGradientActiveLayer: true,
      brushSettings: {
        ditherEnabled: true,
        gradientBands: 1,
        brushShape: BrushShape.COLOR_CYCLE_SHAPE,
        gridSnapEnabled: false,
        gridSnapSize: 8,
        colorCycleBandSpacingPx: 10,
        spacing: 6,
        lostEdge: 0,
        ditherBackgroundFill: true,
        ditherGradBgFill: false,
      },
      defaultBandSpacing: 12,
      clampColorCycleBandSpacing: (value) => value ?? 12,
      requestGradientApply: jest.fn(),
      flushGradientApply: jest.fn(),
      renderBrushToLayerCanvas: jest.fn(),
    });

    expect(brush.fillShapeDispatch).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({
        ditherLevels: 1,
        ditherBackgroundFill: false,
      }),
    }));
  });

  it('uses quantized dither levels for multi-band cc-gradient fills', async () => {
    const brush = createBrush();

    await fillColorCycleLinear({
      vertices: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }],
      direction: { x: 1, y: 0 },
      initializeColorCycleBrush: () => brush as unknown as ColorCycleBrushImplementation,
      activeLayerId: 'layer-1',
      isCCGradientActiveLayer: true,
      brushSettings: {
        ditherEnabled: true,
        gradientBands: 5,
        brushShape: BrushShape.COLOR_CYCLE_SHAPE,
        gridSnapEnabled: false,
        gridSnapSize: 8,
        colorCycleBandSpacingPx: 10,
        spacing: 6,
        lostEdge: 0,
        ditherBackgroundFill: true,
        ditherGradBgFill: true,
      },
      defaultBandSpacing: 12,
      clampColorCycleBandSpacing: (value) => value ?? 12,
      requestGradientApply: jest.fn(),
      flushGradientApply: jest.fn(),
      renderBrushToLayerCanvas: jest.fn(),
    });

    expect(brush.fillShapeDispatch).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({
        ditherLevels: 5,
      }),
    }));
  });

  it('dispatches concentric fill payload and renders layer', async () => {
    const brush = createBrush();
    const renderBrushToLayerCanvas = jest.fn();

    await fillColorCycleConcentric({
      vertices: [{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 3, y: 3 }],
      options: { ditherPixelSize: 3 },
      initializeColorCycleBrush: () => brush as unknown as ColorCycleBrushImplementation,
      activeLayerId: 'layer-1',
      isCCGradientActiveLayer: false,
      brushSettings: {
        ditherEnabled: false,
        gradientBands: 6,
        brushShape: BrushShape.COLOR_CYCLE_SHAPE,
        gridSnapEnabled: false,
        gridSnapSize: 8,
        colorCycleBandSpacingPx: 9,
        spacing: 7,
        lostEdge: 0,
        ditherBackgroundFill: true,
        ditherGradBgFill: true,
      },
      defaultBandSpacing: 12,
      clampColorCycleBandSpacing: (value) => value ?? 12,
      requestGradientApply: jest.fn(),
      flushGradientApply: jest.fn(),
      renderBrushToLayerCanvas,
    });

    expect(brush.fillShapeDispatch).toHaveBeenCalledWith(expect.objectContaining({ mode: 'concentric', layerId: 'layer-1' }));
    expect(brush.endStroke).toHaveBeenCalledWith('layer-1');
    expect(renderBrushToLayerCanvas).toHaveBeenCalledWith(brush, 'layer-1');
  });

  it('snaps cc-gradient fill vertices to the configured grid when enabled', async () => {
    const brush = createBrush();

    await fillColorCycleLinear({
      vertices: [{ x: 3, y: 5 }, { x: 14, y: 18 }, { x: 25, y: 29 }],
      direction: { x: 1, y: 0 },
      initializeColorCycleBrush: () => brush as unknown as ColorCycleBrushImplementation,
      activeLayerId: 'layer-1',
      isCCGradientActiveLayer: true,
      brushSettings: {
        ditherEnabled: false,
        gradientBands: 8,
        brushShape: BrushShape.COLOR_CYCLE_SHAPE,
        gridSnapEnabled: true,
        gridSnapSize: 8,
        colorCycleBandSpacingPx: 10,
        spacing: 6,
        lostEdge: 0,
        ditherBackgroundFill: true,
        ditherGradBgFill: true,
      },
      defaultBandSpacing: 12,
      clampColorCycleBandSpacing: (value) => value ?? 12,
      requestGradientApply: jest.fn(),
      flushGradientApply: jest.fn(),
      renderBrushToLayerCanvas: jest.fn(),
    });

    expect(brush.fillShapeDispatch).toHaveBeenCalledWith(expect.objectContaining({
      vertices: [{ x: 0, y: 8 }, { x: 16, y: 16 }, { x: 24, y: 32 }],
    }));
  });

  it('leaves non-snapped cc-gradient fill vertices unchanged when grid snap is disabled', async () => {
    const brush = createBrush();
    const vertices = [{ x: 3, y: 5 }, { x: 14, y: 18 }, { x: 25, y: 29 }];

    await fillColorCycleConcentric({
      vertices,
      initializeColorCycleBrush: () => brush as unknown as ColorCycleBrushImplementation,
      activeLayerId: 'layer-1',
      isCCGradientActiveLayer: true,
      brushSettings: {
        ditherEnabled: false,
        gradientBands: 8,
        brushShape: BrushShape.COLOR_CYCLE_SHAPE,
        gridSnapEnabled: false,
        gridSnapSize: 8,
        colorCycleBandSpacingPx: 10,
        spacing: 6,
        lostEdge: 0,
        ditherBackgroundFill: true,
        ditherGradBgFill: true,
      },
      defaultBandSpacing: 12,
      clampColorCycleBandSpacing: (value) => value ?? 12,
      requestGradientApply: jest.fn(),
      flushGradientApply: jest.fn(),
      renderBrushToLayerCanvas: jest.fn(),
    });

    expect(brush.fillShapeDispatch).toHaveBeenCalledWith(expect.objectContaining({
      vertices,
    }));
  });
});
