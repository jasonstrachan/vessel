import { createPaletteSlice } from '@/stores/slices/paletteSlice';
import { createDefaultPalette } from '@/utils/layoutDefaults';

type MutableState = Record<string, any>;

const createTestStore = (overrides: MutableState = {}) => {
  let state: MutableState = {
    palette: createDefaultPalette(),
    paletteDirty: false,
    tools: {
      brushSettings: { color: '#000000' },
      eraserSettings: { color: '#EEEEEE', linkSizeToBrush: false },
      currentTool: 'brush',
    },
    project: null,
    ...overrides,
  };

  const set = (updater: any) => {
    const next = typeof updater === 'function' ? updater(state) : updater;
    state = { ...state, ...next };
    return state;
  };

  const get = () => state;
  const slice = (createPaletteSlice as any)(set, get);

  return {
    ...slice,
    getState: () => state,
    setState: (partial: MutableState) => {
      state = { ...state, ...partial };
    },
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
});
