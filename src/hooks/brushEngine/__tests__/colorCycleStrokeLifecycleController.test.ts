import {
  endColorCycleStrokeForLayer,
  resetColorCycleStroke,
} from '../colorCycleStrokeLifecycleController';
import type { ColorCycleBrushImplementation } from '../ColorCycleBrushMigration';

const createBrush = () => {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 1, 1);
  }

  return {
    getCanvas: jest.fn(() => canvas),
    setLayerId: jest.fn(),
    setActiveLayer: jest.fn(),
    commitCurrentStroke: jest.fn(),
    commitToLayer: jest.fn(),
    renderDirectToCanvas: jest.fn(),
    clearPaintBuffer: jest.fn(),
    finalizeCurrentStroke: jest.fn(),
    endStroke: jest.fn(),
    startStroke: jest.fn(),
  };
};

describe('colorCycleStrokeLifecycleController', () => {
  it('starts a new stroke and marks first stamp immediate', () => {
    const brush = createBrush();
    const firstStampImmediateRef = { current: false };

    resetColorCycleStroke({
      clearBuffer: true,
      initializeColorCycleBrush: () => brush as unknown as ColorCycleBrushImplementation,
      activeLayerId: 'layer-1',
      getLayers: () => [{
        id: 'layer-1',
        layerType: 'color-cycle',
        colorCycleData: { canvas: document.createElement('canvas') },
      }],
      bindBrushToCanvas: jest.fn(),
      firstStampImmediateRef,
    });

    expect(brush.startStroke).toHaveBeenCalledWith('layer-1', true);
    expect(brush.clearPaintBuffer).not.toHaveBeenCalled();
    expect(firstStampImmediateRef.current).toBe(true);
  });

  it('does not clear committed layer buffers when playback is paused', () => {
    const brush = createBrush();
    const firstStampImmediateRef = { current: false };

    resetColorCycleStroke({
      clearBuffer: false,
      initializeColorCycleBrush: () => brush as unknown as ColorCycleBrushImplementation,
      activeLayerId: 'layer-1',
      getLayers: () => [{
        id: 'layer-1',
        layerType: 'color-cycle',
        colorCycleData: { canvas: document.createElement('canvas') },
      }],
      bindBrushToCanvas: jest.fn(),
      firstStampImmediateRef,
    });

    expect(brush.commitCurrentStroke).toHaveBeenCalledWith('layer-1');
    expect(brush.clearPaintBuffer).not.toHaveBeenCalled();
    expect(brush.startStroke).toHaveBeenCalledWith('layer-1', false);
  });

  it('noops when initializer returns null', () => {
    const firstStampImmediateRef = { current: false };

    resetColorCycleStroke({
      clearBuffer: false,
      initializeColorCycleBrush: () => null,
      activeLayerId: 'layer-1',
      getLayers: () => [],
      bindBrushToCanvas: jest.fn(),
      firstStampImmediateRef,
    });

    expect(firstStampImmediateRef.current).toBe(false);
  });

  it('ends active stroke for current layer', () => {
    const brush = createBrush();

    endColorCycleStrokeForLayer({
      activeLayerId: 'layer-2',
      getActiveLayerColorCycleBrush: () => brush as unknown as ColorCycleBrushImplementation,
    });

    expect(brush.endStroke).toHaveBeenCalledWith('layer-2');
  });
});
