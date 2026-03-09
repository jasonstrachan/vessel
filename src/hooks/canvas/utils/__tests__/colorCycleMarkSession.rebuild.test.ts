import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import type { Layer } from '@/types';
import {
  beginMarkGradientSession,
  finalizeMarkGradientSession,
} from '@/hooks/canvas/utils/colorCycleMarkSession';
import { useAppStore } from '@/stores/useAppStore';

describe('colorCycleMarkSession rebuild', () => {
  const stops = [
    { position: 0, color: '#000000' },
    { position: 1, color: '#ffffff' },
  ];

  const createLayer = (overrides?: Partial<Layer>): Layer => ({
    id: 'layer-cc',
    name: 'Layer 1',
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    locked: false,
    transparencyLocked: false,
    order: 0,
    imageData: null,
    framebuffer: document.createElement('canvas'),
    alignment: createDefaultLayerAlignment(),
    layerType: 'color-cycle',
    colorCycleData: {
      gradientDefs: [],
      slotPalettes: [],
      gradientDefStore: [],
      nextGradientDefId: 1,
      gradientDefIdBuffer: new Uint16Array([0, 0, 0, 0]).buffer,
      paintSlot: 0,
    },
    version: 1,
    ...(overrides ?? {}),
  });

  beforeEach(() => {
    useAppStore.setState((state) => ({
      layers: [],
      activeLayerId: null,
      project: state.project
        ? { ...state.project, width: 2, height: 2 }
        : state.project,
    }));
  });

  it('begins sampled session without preallocating a slot', () => {
    const layer = createLayer({
      colorCycleData: {
        gradientDefs: [],
        slotPalettes: [],
        gradientDefStore: [],
        nextGradientDefId: 1,
        gradientDefIdBuffer: new Uint16Array([0, 0, 0, 0]).buffer,
        paintSlot: 0,
      },
    });

    useAppStore.setState((state) => ({
      layers: [layer],
      activeLayerId: layer.id,
      project: state.project
        ? { ...state.project, width: 2, height: 2, layers: [layer] }
        : state.project,
    }));

    const session = beginMarkGradientSession({
      layerId: layer.id,
      markKind: 'shape',
      gradientKind: 'linear',
      source: 'sampled',
      stops,
    });

    expect(session).not.toBeNull();
    expect(session?.binding).toBeNull();
    expect(useAppStore.getState().layers[0]?.colorCycleData?.gradientDefStore).toEqual([]);

    const finalized = finalizeMarkGradientSession(layer.id);
    const finalizedLayer = useAppStore.getState().layers[0];

    expect(finalized?.binding).not.toBeNull();
    expect(finalizedLayer?.colorCycleData?.gradientDefStore).toHaveLength(1);
    expect(finalizedLayer?.colorCycleData?.gradientDefStore?.[0]?.source).toBe('sampled');
  });
});
