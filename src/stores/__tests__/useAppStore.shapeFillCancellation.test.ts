import { shapeFillBrushPreset, pixelBrushPreset } from '@/presets/brushPresets';
import { useAppStore } from '@/stores/useAppStore';
import { BrushShape } from '@/types';

const TRIANGLE_POINTS = [
  { x: 0, y: 0 },
  { x: 32, y: 8 },
  { x: 16, y: 28 }
];

const resetStore = (): void => {
  const store = useAppStore.getState();

  store.cancelShapeFillSession();
  store.setCurrentTool('brush');
  store.setBrushPreset(pixelBrushPreset);

  useAppStore.setState(state => ({
    tools: {
      ...state.tools,
      shapeMode: false,
      lastRegularShapeMode: false,
      lastColorCycleShapeMode: false
    },
    shapeFill: {
      ...state.shapeFill,
      session: null,
      lastFinalize: null
    }
  }));
};

const startShapeFillDrawing = (): void => {
  const store = useAppStore.getState();
  store.setBrushPreset(shapeFillBrushPreset);
  store.beginShapeFillSession(TRIANGLE_POINTS);
};

describe('Shape fill session management', () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    resetStore();
  });

  it('cancels the active shape fill session when switching tools', () => {
    startShapeFillDrawing();

    const activeState = useAppStore.getState();
    expect(activeState.shapeFill.session).not.toBeNull();
    expect(activeState.tools.currentTool).toBe('brush');
    expect(activeState.tools.brushSettings.brushShape).toBe(BrushShape.SHAPE_FILL);
    expect(activeState.tools.shapeMode).toBe(true);

    useAppStore.getState().setCurrentTool('eraser');

    const updatedState = useAppStore.getState();
    expect(updatedState.shapeFill.session).toBeNull();
    expect(updatedState.tools.currentTool).toBe('eraser');
    expect(updatedState.tools.shapeMode).toBe(false);
  });

  it('cancels the active shape fill session when switching brush presets', () => {
    startShapeFillDrawing();

    const activeState = useAppStore.getState();
    expect(activeState.shapeFill.session).not.toBeNull();
    expect(activeState.currentBrushPreset?.id).toBe(shapeFillBrushPreset.id);
    expect(activeState.tools.shapeMode).toBe(true);

    useAppStore.getState().setBrushPreset(pixelBrushPreset);

    const updatedState = useAppStore.getState();
    expect(updatedState.shapeFill.session).toBeNull();
    expect(updatedState.currentBrushPreset?.id).toBe(pixelBrushPreset.id);
    expect(updatedState.tools.brushSettings.brushShape).not.toBe(BrushShape.SHAPE_FILL);
    expect(updatedState.tools.shapeMode).toBe(false);
  });
});
