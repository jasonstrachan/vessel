import { defaultBrushPreset, mosaicBrushPreset, resamplerBrushPreset } from '@/presets/brushPresets';
import { useAppStore } from '@/stores/useAppStore';
import { BrushShape } from '@/types';

const resetStore = (): void => {
  useAppStore.setState(state => ({
    currentBrushPreset: defaultBrushPreset,
    shapeModeByBrush: {},
    brushSpecificSettings: {},
    tools: {
      ...state.tools,
      currentTool: 'brush',
      previousTool: 'brush',
      shapeMode: false,
      lastRegularShapeMode: false,
      lastColorCycleShapeMode: false,
      brushSettings: {
        ...state.tools.brushSettings,
        brushShape: BrushShape.ROUND
      }
    }
  }));
};

describe('Tool + shape mode transitions', () => {
  it('selects Resampler without inheriting shape mode or discarding regular brush memory', () => {
    const store = useAppStore.getState();
    store.setShapeMode(true);
    useAppStore.setState(state => ({
      shapeModeByBrush: { ...state.shapeModeByBrush, mosaic: true, resampler: true },
      brushSpecificSettings: { ...state.brushSpecificSettings, resampler: { risographIntensity: 37 } },
    }));

    store.setBrushPreset(resamplerBrushPreset);

    const resampling = useAppStore.getState();
    expect(resampling.tools.shapeMode).toBe(false);
    expect(resampling.tools.lastRegularShapeMode).toBe(true);
    expect(resampling.shapeModeByBrush).toEqual({ 'soft-round': true, mosaic: true, resampler: true });
    expect(resampling.tools.brushSettings.risographIntensity).toBe(37);
    store.setBrushPreset(defaultBrushPreset);
    expect(useAppStore.getState().tools.shapeMode).toBe(true);
  });

  it.each([true, false])('denies effective Resampler shape mode without rewriting memories (%s)', enabled => {
    const store = useAppStore.getState();
    store.setBrushPreset(resamplerBrushPreset);
    const memories = { 'soft-round': true, mosaic: true, resampler: true };
    useAppStore.setState(state => ({
      shapeModeByBrush: memories,
      tools: { ...state.tools, lastRegularShapeMode: true, lastColorCycleShapeMode: true },
    }));

    store.setShapeMode(enabled);

    const after = useAppStore.getState();
    expect(after.tools.shapeMode).toBe(false);
    expect(after.tools.lastRegularShapeMode).toBe(true);
    expect(after.tools.lastColorCycleShapeMode).toBe(true);
    expect(after.shapeModeByBrush).toBe(memories);
  });

  it('disables shape mode when settings transition to the sampled tip without clearing regular memory', () => {
    const store = useAppStore.getState();
    store.setShapeMode(true);

    store.setBrushSettings({ brushShape: BrushShape.RESAMPLER, risographIntensity: 37 });

    const after = useAppStore.getState();
    expect(after.tools.brushSettings.brushShape).toBe(BrushShape.RESAMPLER);
    expect(after.tools.shapeMode).toBe(false);
    expect(after.tools.lastRegularShapeMode).toBe(true);
    expect(after.shapeModeByBrush['soft-round']).toBe(true);
    expect(after.tools.brushSettings.risographIntensity).toBe(37);
  });

  it.each(['eraser', 'selection'] as const)('returns from %s to Resampler without borrowing or clearing regular shape memory', tool => {
    const store = useAppStore.getState();
    store.setShapeMode(true);
    store.setBrushPreset(resamplerBrushPreset);

    store.setCurrentTool(tool);
    expect(useAppStore.getState().tools.shapeMode).toBe(false);
    expect(useAppStore.getState().tools.lastRegularShapeMode).toBe(true);
    store.setCurrentTool('brush');

    const resumed = useAppStore.getState();
    expect(resumed.tools.brushSettings.brushShape).toBe(BrushShape.RESAMPLER);
    expect(resumed.tools.shapeMode).toBe(false);
    expect(resumed.tools.lastRegularShapeMode).toBe(true);
    store.setBrushPreset(defaultBrushPreset);
    expect(useAppStore.getState().tools.shapeMode).toBe(true);
  });

  it('selects Mosaic as a stroke without discarding raw maps or supported regular/CC memories', () => {
    const store = useAppStore.getState();
    store.setShapeMode(true);
    const memories = { 'soft-round': true, mosaic: true, 'color-cycle-shape': true };
    useAppStore.setState(state => ({
      shapeModeByBrush: memories,
      tools: { ...state.tools, lastColorCycleShapeMode: true },
    }));

    store.setBrushPreset(mosaicBrushPreset);

    const mosaic = useAppStore.getState();
    expect(mosaic.tools.brushSettings.brushShape).toBe(BrushShape.MOSAIC);
    expect(mosaic.tools.shapeMode).toBe(false);
    expect(mosaic.tools.lastRegularShapeMode).toBe(true);
    expect(mosaic.tools.lastColorCycleShapeMode).toBe(true);
    expect(mosaic.shapeModeByBrush).toBe(memories);
    store.setBrushPreset(defaultBrushPreset);
    expect(useAppStore.getState().tools.shapeMode).toBe(true);
  });

  it.each([true, false])('denies effective Mosaic Shape without rewriting preferences or supported brush memories (%s)', enabled => {
    const store = useAppStore.getState();
    store.setBrushPreset(mosaicBrushPreset);
    const memories = { 'soft-round': true, mosaic: true, 'color-cycle-shape': true };
    useAppStore.setState(state => ({
      shapeModeByBrush: memories,
      tools: { ...state.tools, lastRegularShapeMode: true, lastColorCycleShapeMode: true },
    }));

    store.setShapeMode(enabled);

    const after = useAppStore.getState();
    expect(after.tools.shapeMode).toBe(false);
    expect(after.tools.lastRegularShapeMode).toBe(true);
    expect(after.tools.lastColorCycleShapeMode).toBe(true);
    expect(after.shapeModeByBrush).toBe(memories);
  });

  it('denies Shape when settings change the effective tip to Mosaic without clobbering memories', () => {
    const store = useAppStore.getState();
    store.setShapeMode(true);
    useAppStore.setState(state => ({ tools: { ...state.tools, lastColorCycleShapeMode: true } }));
    const memories = useAppStore.getState().shapeModeByBrush;

    store.setBrushSettings({ brushShape: BrushShape.MOSAIC, mosaicTilePx: 13 });

    const after = useAppStore.getState();
    expect(after.tools.brushSettings).toMatchObject({ brushShape: BrushShape.MOSAIC, mosaicTilePx: 13 });
    expect(after.tools.shapeMode).toBe(false);
    expect(after.tools.lastRegularShapeMode).toBe(true);
    expect(after.tools.lastColorCycleShapeMode).toBe(true);
    expect(after.shapeModeByBrush).toBe(memories);
  });

  it.each(['eraser', 'selection'] as const)('returns from %s to Mosaic stroke without borrowing or clearing supported Shape memory', tool => {
    const store = useAppStore.getState();
    store.setShapeMode(true);
    useAppStore.setState(state => ({
      shapeModeByBrush: { ...state.shapeModeByBrush, mosaic: true },
      tools: { ...state.tools, lastColorCycleShapeMode: true },
    }));
    store.setBrushPreset(mosaicBrushPreset);

    store.setCurrentTool(tool);
    expect(useAppStore.getState().tools.shapeMode).toBe(false);
    expect(useAppStore.getState().tools.lastRegularShapeMode).toBe(true);
    store.setCurrentTool('brush');

    const resumed = useAppStore.getState();
    expect(resumed.tools.brushSettings.brushShape).toBe(BrushShape.MOSAIC);
    expect(resumed.tools.shapeMode).toBe(false);
    expect(resumed.tools.lastRegularShapeMode).toBe(true);
    expect(resumed.tools.lastColorCycleShapeMode).toBe(true);
    expect(resumed.shapeModeByBrush.mosaic).toBe(true);
    store.setBrushPreset(defaultBrushPreset);
    expect(useAppStore.getState().tools.shapeMode).toBe(true);
  });

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
