import { useAppStore } from '@/stores/useAppStore';
import { BrushShape } from '@/types';

const resetStore = (): void => {
  useAppStore.setState(state => ({
    tools: {
      ...state.tools,
      currentTool: 'brush',
      previousTool: 'brush',
      shapeMode: false,
      lastRegularShapeMode: false,
      lastColorCycleShapeMode: false,
      brushSettings: {
        ...state.tools.brushSettings,
        brushShape: BrushShape.SQUARE
      }
    }
  }));
};

describe('Tool + shape mode transitions', () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    resetStore();
  });

  it('restores regular shape mode after returning from eraser', () => {
    const store = useAppStore.getState();

    store.setShapeMode(true);
    expect(useAppStore.getState().tools.shapeMode).toBe(true);

    store.setCurrentTool('eraser');
    const afterEraser = useAppStore.getState();
    expect(afterEraser.tools.currentTool).toBe('eraser');
    expect(afterEraser.tools.shapeMode).toBe(false);
    expect(afterEraser.tools.lastRegularShapeMode).toBe(true);

    store.setCurrentTool('brush');
    const restored = useAppStore.getState();
    expect(restored.tools.currentTool).toBe('brush');
    expect(restored.tools.shapeMode).toBe(true);
  });

  it('restores color cycle shape mode after returning from eraser', () => {
    const store = useAppStore.getState();

    store.setBrushSettings({ brushShape: BrushShape.COLOR_CYCLE_SHAPE });
    store.setShapeMode(true);
    expect(useAppStore.getState().tools.shapeMode).toBe(true);

    store.setCurrentTool('eraser');
    const erasing = useAppStore.getState();
    expect(erasing.tools.shapeMode).toBe(false);
    expect(erasing.tools.lastColorCycleShapeMode).toBe(true);

    store.setCurrentTool('brush');
    const resumed = useAppStore.getState();
    expect(resumed.tools.shapeMode).toBe(true);
  });
});
