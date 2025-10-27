import { shapeFillBrushPreset, pixelBrushPreset } from '@/presets/brushPresets';
import { __shapeToolTestUtils } from '@/hooks/canvas/handlers/shapes/ShapeToolHandler';
import { useAppStore } from '@/stores/useAppStore';

describe('ShapeToolHandler – shape fill tool detection', () => {
  const store = useAppStore.getState();

  beforeEach(() => {
    store.setBrushPreset(shapeFillBrushPreset);
    store.setCurrentTool('brush');
  });

  afterEach(() => {
    store.setBrushPreset(pixelBrushPreset);
    store.setCurrentTool('brush');
  });

  it('treats shape fill brush as inactive when the current tool is not brush', () => {
    expect(__shapeToolTestUtils.isShapeFillToolActive()).toBe(true);

    store.setCurrentTool('eraser');

    expect(__shapeToolTestUtils.isShapeFillToolActive()).toBe(false);
  });
});
