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
        colorCycleBandSpacingPx: 10,
        spacing: 6,
        lostEdge: 4,
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
        colorCycleBandSpacingPx: 9,
        spacing: 7,
        lostEdge: 0,
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
});
