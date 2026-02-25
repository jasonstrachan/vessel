import { useAppStore } from '@/stores/useAppStore';
import { createDefaultLayerAlignment, createDefaultExportLayout } from '@/utils/layoutDefaults';
import type { Layer, PaletteState, Project } from '@/types';

const resetAutosaveState = () => {
  useAppStore.setState((state) => ({
    autosave: {
      ...state.autosave,
      hasUnsavedChanges: false,
      lastDirtyReason: null,
      lastDirtyAt: null,
    },
  }));
};

const coerceLayer = (overrides: Partial<Layer> = {}): Layer => {
  const base = useAppStore.getState().layers[0];
  if (base) {
    return { ...base, ...overrides };
  }
  return {
    id: `layer-${Math.random().toString(36).slice(2)}`,
    name: 'Layer',
    layerType: 'normal',
    order: 0,
    blendMode: 'source-over',
    opacity: 1,
    locked: false,
    visible: true,
    imageData: null,
    framebuffer: document.createElement('canvas'),
    alignment: createDefaultLayerAlignment(),
    colorCycleData: undefined,
    ...overrides,
  };
};

describe('autosave dirty tracking', () => {
  beforeEach(() => {
    resetAutosaveState();
  });

  it('marks dirty when project updates', () => {
    const store = useAppStore.getState();
    const existingProject = store.project;
    const fallbackExportLayout = existingProject?.exportLayout ?? createDefaultExportLayout();

    const baseProject: Project =
      existingProject ?? {
      id: 'project-test',
      name: 'Untitled',
      width: 1024,
      height: 1024,
      layers: [],
      backgroundColor: 'transparent',
      createdAt: new Date(),
      updatedAt: new Date(),
      customBrushes: [],
      defaultCustomBrushId: null,
      brushSpecificSettings: {},
      exportLayout: fallbackExportLayout,
      palette: store.palette,
    };

    store.setProject({ ...baseProject, name: 'Dirty Project' });

    const autosave = useAppStore.getState().autosave;
    expect(autosave.hasUnsavedChanges).toBe(true);
    expect(['project-change', 'palette-change']).toContain(autosave.lastDirtyReason);
  });

  it('marks dirty when layers array changes', () => {
    useAppStore.setState(() => ({
      layers: [coerceLayer()],
    }));

    const autosave = useAppStore.getState().autosave;
    expect(autosave.hasUnsavedChanges).toBe(true);
    expect(autosave.lastDirtyReason).toBe('layer-change');
  });

  it('marks dirty when palette mutates', () => {
    resetAutosaveState();
    const store = useAppStore.getState();
    const nextPalette: PaletteState = {
      ...store.palette,
      foregroundColor: '#123456',
    };
    useAppStore.setState({ palette: nextPalette });

    const autosave = useAppStore.getState().autosave;
    expect(autosave.hasUnsavedChanges).toBe(true);
    expect(autosave.lastDirtyReason).toBe('palette-change');
  });

  it('marks dirty when history operations explicitly flag dirty state', () => {
    resetAutosaveState();
    useAppStore.getState().markAutosaveDirty('history-change');

    const autosave = useAppStore.getState().autosave;
    expect(autosave.hasUnsavedChanges).toBe(true);
    expect(autosave.lastDirtyReason).toBe('history-change');
  });

  it('clearDirtyState resets reason metadata', () => {
    const store = useAppStore.getState();
    store.markAutosaveDirty('manual');
    store.clearDirtyState();

    const autosave = useAppStore.getState().autosave;
    expect(autosave.hasUnsavedChanges).toBe(false);
    expect(autosave.lastDirtyReason).toBeNull();
    expect(autosave.lastDirtyAt).toBeNull();
  });
});
