import { createLayerStructureDelta } from '@/history/deltas/layerStructureDelta';
import { createRehydrationTargets } from '@/history/runtimeRehydration';
import { useAppStore } from '@/stores/useAppStore';
import type { CanvasSnapshot, Layer } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

const createLayer = (
  id: string,
  order: number,
  type: Layer['layerType'] = 'normal',
): Layer => {
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 2;

  return {
    id,
    name: id,
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    locked: false,
    transparencyLocked: false,
    order,
    imageData: new ImageData(2, 2),
    framebuffer: canvas,
    alignment: createDefaultLayerAlignment(),
    layerType: type,
    colorCycleData:
      type === 'color-cycle'
        ? {
            canvas,
            gradientDefs: [],
            slotPalettes: [],
          }
        : undefined,
  };
};

const createSnapshot = (
  id: string,
  layers: Layer[],
  activeLayerId: string,
): CanvasSnapshot => ({
  id,
  timestamp: Date.now(),
  layers,
  activeLayerId,
  actionType: 'layer-reorder',
  description: 'Layer reorder',
});

const createLayerStructureSnapshot = (
  id: string,
  layers: Layer[],
  activeLayerId: string,
  selectedLayerIds: string[] = [],
  referenceLayerId: string | null = null,
) => ({
  snapshot: createSnapshot(id, layers, activeLayerId),
  selectedLayerIds,
  referenceLayerId,
});

describe('LayerStructureDelta', () => {
  beforeEach(() => {
    useAppStore.setState((state) => ({
      layers: [],
      activeLayerId: null,
      selectedLayerIds: [],
      referenceLayerId: null,
      project: state.project
        ? {
            ...state.project,
            width: 16,
            height: 16,
            layers: [],
          }
        : state.project,
    }));
  });

  it('replays layer order and active layer in both directions', () => {
    const beforeLayers = [createLayer('layer-a', 0), createLayer('layer-b', 1, 'color-cycle')];
    const afterLayers = [beforeLayers[1]!, beforeLayers[0]!];

    const delta = createLayerStructureDelta({
      before: createLayerStructureSnapshot('before', beforeLayers, 'layer-a', ['layer-a'], 'layer-a'),
      after: createLayerStructureSnapshot('after', afterLayers, 'layer-b', ['layer-b', 'layer-a'], 'layer-b'),
    });

    delta.apply('forward');
    expect(useAppStore.getState().layers.map((layer) => layer.id)).toEqual(['layer-b', 'layer-a']);
    expect(useAppStore.getState().activeLayerId).toBe('layer-b');
    expect(useAppStore.getState().selectedLayerIds).toEqual(['layer-b', 'layer-a']);
    expect(useAppStore.getState().referenceLayerId).toBe('layer-b');

    delta.apply('backward');
    expect(useAppStore.getState().layers.map((layer) => layer.id)).toEqual(['layer-a', 'layer-b']);
    expect(useAppStore.getState().activeLayerId).toBe('layer-a');
    expect(useAppStore.getState().selectedLayerIds).toEqual(['layer-a']);
    expect(useAppStore.getState().referenceLayerId).toBe('layer-a');
  });

  it('collects rehydration targets for touched normal and color-cycle layers', () => {
    const beforeLayers = [createLayer('layer-a', 0), createLayer('layer-b', 1, 'color-cycle')];
    const afterLayers = [beforeLayers[1]!, beforeLayers[0]!];
    const delta = createLayerStructureDelta({
      before: createLayerStructureSnapshot('before', beforeLayers, 'layer-a'),
      after: createLayerStructureSnapshot('after', afterLayers, 'layer-b'),
    });

    const targets = createRehydrationTargets();
    delta.collectRehydrationTargets?.(targets);

    expect(targets.layerIds.has('layer-a')).toBe(true);
    expect(targets.layerIds.has('layer-b')).toBe(true);
    expect(targets.colorCycleLayerIds.has('layer-b')).toBe(true);
    expect(targets.workerScopes.has('color-cycle-gradient')).toBe(true);
  });
});
