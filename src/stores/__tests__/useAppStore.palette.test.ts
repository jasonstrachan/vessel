import { useAppStore } from '@/stores/useAppStore';
import type { Project } from '@/types';

const prepareStore = () => {
  const store = useAppStore.getState();
  // Ensure we start from brush tool to avoid eraser side effects
  store.setCurrentTool('brush');
  store.setActivePaletteSlot('foreground');
  store.setPaletteColor('foreground', '#000000');
  store.setPaletteColor('background', '#FFFFFF');
  store.setBrushSettings({ color: '#000000' });
  store.setEraserSettings({ color: '#000000', linkSizeToBrush: store.tools.eraserSettings.linkSizeToBrush });
};

beforeEach(() => {
  prepareStore();
});

describe('useAppStore palette integration', () => {
  it('initializes palette with default foreground/background values', () => {
    const palette = useAppStore.getState().palette;
    expect(palette.foregroundColor).toBe('#000000');
    expect(palette.backgroundColor).toBe('#FFFFFF');
    expect(palette.activeSlot).toBe('foreground');

    const projectPalette = useAppStore.getState().project?.palette;
    expect(projectPalette).toBeDefined();
    expect(projectPalette?.foregroundColor).toBe('#000000');
    expect(projectPalette?.backgroundColor).toBe('#FFFFFF');
  });

  it('keeps palette and brush settings in sync when brush color changes', () => {
    const store = useAppStore.getState();
    store.setBrushSettings({ color: '#FFAA00' });

    const nextState = useAppStore.getState();
    expect(nextState.palette.foregroundColor).toBe('#FFAA00');
    expect(nextState.tools.brushSettings.color).toBe('#FFAA00');
    expect(nextState.project?.palette?.foregroundColor).toBe('#FFAA00');
  });

  it('swaps foreground/background colors without changing current brush color', () => {
    const store = useAppStore.getState();
    store.setPaletteColor('foreground', '#112233');
    store.setBrushSettings({ color: '#112233' });
    store.setPaletteColor('background', '#ABCDEF');

    store.swapPaletteColors();

    const nextState = useAppStore.getState();
    expect(nextState.palette.foregroundColor).toBe('#ABCDEF');
    expect(nextState.palette.backgroundColor).toBe('#112233');
    expect(nextState.tools.brushSettings.color).toBe('#112233');
  });

  it('updates palette when eraser color changes while foreground slot is active', () => {
    const store = useAppStore.getState();
    store.setCurrentTool('eraser');
    store.setActivePaletteSlot('foreground');

    store.setEraserSettings({ color: '#123456' });

    const nextState = useAppStore.getState();
    expect(nextState.palette.foregroundColor).toBe('#123456');
    expect(nextState.tools.brushSettings.color).toBe('#123456');
    expect(nextState.project?.palette?.foregroundColor).toBe('#123456');
  });

  it('hydrates palette and tools from a loaded project', () => {
    const baseProject = useAppStore.getState().project as Project;
    const paletteOverride = {
      foregroundColor: '#336699',
      backgroundColor: '#FFEEDD',
      activeSlot: 'background' as const
    };
    const project: Project = {
      ...baseProject,
      id: `${baseProject.id}-palette-test`,
      createdAt: new Date(baseProject.createdAt),
      updatedAt: new Date(baseProject.updatedAt),
      palette: paletteOverride
    };

    useAppStore.getState().setProject(project);

    const nextState = useAppStore.getState();
    expect(nextState.palette).toEqual(paletteOverride);
    expect(nextState.tools.brushSettings.color).toBe(paletteOverride.foregroundColor);
  });
});
