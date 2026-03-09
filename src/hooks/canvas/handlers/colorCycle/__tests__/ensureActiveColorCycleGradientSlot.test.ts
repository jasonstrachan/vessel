import { ensureActiveColorCycleGradientSlot } from '@/hooks/canvas/handlers/colorCycle/ensureActiveColorCycleGradientSlot';
import { useAppStore } from '@/stores/useAppStore';
import type { Layer } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

const createColorCycleLayer = (): Layer => ({
  id: 'layer-cc',
  name: 'Layer CC',
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
  },
  version: 1,
});

describe('ensureActiveColorCycleGradientSlot', () => {
  beforeEach(() => {
    const layer = createColorCycleLayer();
    useAppStore.setState((state) => ({
      layers: [layer],
      activeLayerId: layer.id,
      project: state.project
        ? { ...state.project, width: 8, height: 8, layers: [layer] }
        : state.project,
      tools: {
        ...state.tools,
        ccGradientSource: 'sampled',
        brushSettings: {
          ...state.tools.brushSettings,
          colorCycleUseForegroundGradient: false,
          colorCycleGradient: [
            { position: 0, color: '#112233' },
            { position: 1, color: '#ddeeff' },
          ],
        },
      },
    }));
  });

  it('does not persist sampled preview gradients before commit', () => {
    const before = useAppStore.getState().layers[0];
    ensureActiveColorCycleGradientSlot({
      state: useAppStore.getState(),
      layer: before,
    });

    const after = useAppStore.getState().layers[0];
    expect(after?.colorCycleData?.gradientDefs).toEqual([]);
    expect(after?.colorCycleData?.slotPalettes).toEqual([]);
    expect(after?.colorCycleData?.gradientDefStore).toEqual([]);
    expect(after?.colorCycleData?.paintSlot).toBeUndefined();
    expect(after?.colorCycleData?.activeGradientId).toBeUndefined();
  });
});
