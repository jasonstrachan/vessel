import { useAppStore } from '@/stores/useAppStore';
import type { Layer } from '@/types';
import { encodeRgbaToBase64 } from '@/utils/colorCycle/ccCustomTilePattern';

const makePattern = (id = 'tile-1') => ({
  id,
  name: 'Tile 1',
  width: 1,
  height: 1,
  rgbaBase64: encodeRgbaToBase64(Uint8Array.from([0, 0, 0, 255])),
  createdAt: 1,
  updatedAt: 1,
});

describe('cc custom tile pattern store actions', () => {
  beforeEach(() => {
    useAppStore.getState().newProject(32, 32, 'Tile Test');
  });

  it('adds tile patterns and selects them for pattern dithering', () => {
    useAppStore.getState().addCcCustomTilePattern(makePattern());

    const state = useAppStore.getState();
    expect(state.project?.ccCustomTilePatterns).toHaveLength(1);
    expect(state.tools.brushSettings.ditherAlgorithm).toBe('pattern');
    expect(state.tools.brushSettings.patternStyle).toBe('image-tile');
    expect(state.tools.brushSettings.patternTileId).toBe('tile-1');
  });

  it('removing the selected tile falls back without clearing committed project content', () => {
    const state = useAppStore.getState();
    const framebuffer = document.createElement('canvas');
    framebuffer.width = 1;
    framebuffer.height = 1;
    const layer = {
      id: 'layer-1',
      name: 'Layer 1',
      visible: true,
      opacity: 1,
      blendMode: 'source-over' as const,
      order: 0,
      locked: false,
      alignment: {
        fit: 'contain',
        horizontal: 'center',
        vertical: 'center',
        positioning: 'auto',
      } as const,
      layerType: 'normal' as const,
      imageData: null,
      framebuffer,
    } as unknown as Layer;
    useAppStore.setState({
      project: {
        ...state.project!,
        layers: [layer],
      },
    });

    useAppStore.getState().addCcCustomTilePattern(makePattern());
    useAppStore.getState().removeCcCustomTilePattern('tile-1');

    const nextState = useAppStore.getState();
    expect(nextState.project?.ccCustomTilePatterns).toEqual([]);
    expect(nextState.tools.brushSettings.patternStyle).toBe('dots');
    expect(nextState.tools.brushSettings.patternTileId).toBeNull();
    expect(nextState.project?.layers).toHaveLength(1);
    expect(nextState.project?.layers[0]?.id).toBe('layer-1');
  });

  it('keeps a tile pattern when committed color-cycle state still references it', () => {
    const state = useAppStore.getState();
    const framebuffer = document.createElement('canvas');
    framebuffer.width = 1;
    framebuffer.height = 1;
    const layer = {
      id: 'cc-layer-1',
      name: 'CC Layer 1',
      visible: true,
      opacity: 1,
      blendMode: 'source-over' as const,
      order: 0,
      locked: false,
      alignment: {
        fit: 'contain',
        horizontal: 'center',
        vertical: 'center',
        positioning: 'auto',
      } as const,
      layerType: 'color-cycle' as const,
      imageData: null,
      framebuffer,
      colorCycleData: {
        brushState: {
          stampDitherPatternStyle: 'image-tile',
          stampDitherPatternTileId: 'tile-1',
        },
      },
    } as unknown as Layer;
    useAppStore.setState({
      layers: [layer],
      project: {
        ...state.project!,
        layers: [layer],
      },
    });

    useAppStore.getState().addCcCustomTilePattern(makePattern());
    useAppStore.getState().removeCcCustomTilePattern('tile-1');

    const nextState = useAppStore.getState();
    expect(nextState.project?.ccCustomTilePatterns).toEqual([makePattern()]);
    expect(nextState.tools.brushSettings.patternStyle).toBe('image-tile');
    expect(nextState.tools.brushSettings.patternTileId).toBe('tile-1');
  });

  it('keeps a tile pattern when live color-cycle brush serialization references it', () => {
    const state = useAppStore.getState();
    const framebuffer = document.createElement('canvas');
    framebuffer.width = 1;
    framebuffer.height = 1;
    const layer = {
      id: 'cc-layer-1',
      name: 'CC Layer 1',
      visible: true,
      opacity: 1,
      blendMode: 'source-over' as const,
      order: 0,
      locked: false,
      alignment: {
        fit: 'contain',
        horizontal: 'center',
        vertical: 'center',
        positioning: 'auto',
      } as const,
      layerType: 'color-cycle' as const,
      imageData: null,
      framebuffer,
      colorCycleData: {
        colorCycleBrush: {
          serialize: () => ({
            stampDitherPatternStyle: 'image-tile',
            stampDitherPatternTileId: 'tile-1',
          }),
        },
      },
    } as unknown as Layer;
    useAppStore.setState({
      layers: [layer],
      project: {
        ...state.project!,
        layers: [layer],
      },
    });

    useAppStore.getState().addCcCustomTilePattern(makePattern());
    useAppStore.getState().removeCcCustomTilePattern('tile-1');

    expect(useAppStore.getState().project?.ccCustomTilePatterns).toEqual([makePattern()]);
  });

  it('resets shared dither selection even when the active brush no longer points at the removed tile', () => {
    useAppStore.getState().addCcCustomTilePattern(makePattern());
    useAppStore.setState((state) => ({
      tools: {
        ...state.tools,
        brushSettings: {
          ...state.tools.brushSettings,
          patternStyle: 'dots',
          patternTileId: null,
        },
      },
      ccBrushDitherSelection: {
        ...state.ccBrushDitherSelection,
        ditherAlgorithm: 'pattern',
        patternStyle: 'image-tile',
        patternTileId: 'tile-1',
      },
    }));

    useAppStore.getState().removeCcCustomTilePattern('tile-1');

    const state = useAppStore.getState();
    expect(state.project?.ccCustomTilePatterns).toEqual([]);
    expect(state.tools.brushSettings.patternStyle).toBe('dots');
    expect(state.tools.brushSettings.patternTileId).toBeNull();
    expect(state.ccBrushDitherSelection.patternStyle).toBe('dots');
    expect(state.ccBrushDitherSelection.patternTileId).toBeNull();
  });
});
