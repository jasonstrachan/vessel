/* eslint-disable @typescript-eslint/no-explicit-any */
import { createPaletteSlice } from '@/stores/slices/paletteSlice';
import { createDefaultPalette } from '@/utils/layoutDefaults';
import { createSliceTestStore } from '@/stores/__tests__/sliceTestUtils';

const createTestStore = (overrides: Record<string, any> = {}) => {
  const { slice, getState, setState } = createSliceTestStore(
    (set, get) => (createPaletteSlice as any)(set, get),
    {
      palette: createDefaultPalette(),
      paletteDirty: false,
      tools: {
        brushSettings: { color: '#000000' },
        eraserSettings: { color: '#EEEEEE', linkSizeToBrush: false },
        currentTool: 'brush',
      },
      project: null,
      ...overrides,
    }
  );

  return {
    ...slice,
    getState,
    setState,
  };
};

describe('palette slice', () => {
  it('updates foreground color and syncs tools/project palette', () => {
    const store = createTestStore({
      project: { palette: createDefaultPalette() },
    });

    store.setPaletteColor('foreground', '#123456');

    const next = store.getState();
    expect(next.palette.foregroundColor).toBe('#123456');
    expect(next.paletteDirty).toBe(true);
    expect(next.project.palette.foregroundColor).toBe('#123456');
    expect(next.tools.brushSettings.color).toBe('#123456');
  });

  it('swaps colors only when they differ and marks dirty', () => {
    const store = createTestStore();
    store.setState({
      palette: {
        ...store.getState().palette,
        foregroundColor: '#111111',
        backgroundColor: '#222222',
      },
      paletteDirty: false,
    });

    store.swapPaletteColors();
    const swapped = store.getState();
    expect(swapped.palette.foregroundColor).toBe('#222222');
    expect(swapped.palette.backgroundColor).toBe('#111111');
    expect(swapped.paletteDirty).toBe(true);
  });

  it('does not mutate palette when swap would be a no-op', () => {
    const store = createTestStore();
    store.setState({
      palette: {
        ...store.getState().palette,
        foregroundColor: '#AAAAAA',
        backgroundColor: '#AAAAAA',
      },
      paletteDirty: false,
    });

    const before = store.getState().palette;
    store.swapPaletteColors();
    const after = store.getState();

    expect(after.palette).toBe(before);
    expect(after.paletteDirty).toBe(false);
  });

  it('updates active slot and stays idempotent on repeat selection', () => {
    const store = createTestStore();
    store.setActivePaletteSlot('background');
    expect(store.getState().palette.activeSlot).toBe('background');

    const before = store.getState().palette;
    store.setActivePaletteSlot('background');
    expect(store.getState().palette).toBe(before);
  });

  it('syncPaletteFromTool writes to chosen slot without redundant dirty flags', () => {
    const store = createTestStore();
    store.setState({ paletteDirty: false });

    store.syncPaletteFromTool('#0F0F0F', 'background');

    const next = store.getState();
    expect(next.palette.backgroundColor).toBe('#0F0F0F');
    expect(next.paletteDirty).toBe(true);
  });

  it('updates color picker preference', () => {
    const store = createTestStore();
    expect(store.getState().colorPickerPreferReferenceLayer).toBe(true);
    store.setColorPickerPreferReferenceLayer(false);
    expect(store.getState().colorPickerPreferReferenceLayer).toBe(false);
  });

  it('selects a shared CC gradient and applies it as manual ink', () => {
    const store = createTestStore();
    const gradient = store.getState().palette.colorCycleGradients[1];

    store.selectColorCycleGradient(gradient.id);

    const next = store.getState();
    expect(next.palette.activeColorCycleGradientId).toBe(gradient.id);
    expect(next.tools.brushSettings.colorCycleGradient).toEqual(gradient.stops);
    expect(next.tools.brushSettings.ccGradientSource).toBe('manual');
    expect(next.tools.brushSettings.colorCycleGradientIsRuntimePalette).toBe(false);
  });

  it('reuses sampled runtime stops exactly until the user edits the swatch', () => {
    const store = createTestStore();
    const stops = [
      { position: 0, color: '#112233' },
      { position: 1, color: '#ddeeff' },
    ];
    const runtimeStops = [
      { position: 0, color: '#223344' },
      { position: 1, color: '#ccddee' },
    ];

    const id = store.rememberColorCycleGradient({
      stops,
      runtimeStops,
      seamProfile: 'soft',
      motion: { phaseByte: 91, speedByte: 17, flowByte: 2 },
    });
    expect(store.getState().tools.brushSettings.colorCycleGradient).toEqual(runtimeStops);
    expect(store.getState().tools.brushSettings.colorCycleGradientSeamProfile).toBe('soft');
    expect(store.getState().tools.brushSettings.colorCycleGradientIsRuntimePalette).toBe(true);
    expect(store.getState().tools.brushSettings.colorCycleSampledMotion).toEqual({
      phaseByte: 91,
      speedByte: 17,
      flowByte: 2,
    });

    store.updateActiveColorCycleGradient([
      { position: 0, color: '#112233' },
      { position: 1, color: '#ffffff' },
    ]);
    const active = store.getState().palette.colorCycleGradients.find((entry: any) => entry.id === id);
    expect(active.runtimeStops).toBeUndefined();
    expect(store.getState().tools.brushSettings.colorCycleGradientSeamProfile).toBe('soft');
    expect(store.getState().tools.brushSettings.colorCycleGradientIsRuntimePalette).toBe(false);
    expect(store.getState().tools.brushSettings.colorCycleSampledMotion).toBeUndefined();
  });
});
