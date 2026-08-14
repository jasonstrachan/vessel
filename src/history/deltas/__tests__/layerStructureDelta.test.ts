import { createLayerStructureDelta } from '@/history/deltas/layerStructureDelta';
import { replayDeltaForTest } from '@/history/__tests__/replayTestUtils';
import { createRehydrationTargets } from '@/history/runtimeRehydration';
import { useAppStore } from '@/stores/useAppStore';
import type {
  CanvasSnapshot,
  Layer,
  LayerGroup,
  ReferenceSamplingSource,
} from '@/types';
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
  layerGroups: LayerGroup[] = [],
  referenceSamplingSource?: ReferenceSamplingSource,
) => ({
  snapshot: createSnapshot(id, layers, activeLayerId),
  selectedLayerIds,
  referenceLayerId,
  referenceSamplingSource,
  layerGroups,
});

describe('LayerStructureDelta', () => {
  beforeEach(() => {
    useAppStore.setState((state) => ({
      layers: [],
      activeLayerId: null,
      selectedLayerIds: [],
      layerGroups: [],
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

  it('replays layer order and active layer in both directions', async () => {
    const beforeLayers = [createLayer('layer-a', 0), createLayer('layer-b', 1, 'color-cycle')];
    const afterLayers = [beforeLayers[1]!, beforeLayers[0]!];

    const delta = createLayerStructureDelta({
      before: createLayerStructureSnapshot('before', beforeLayers, 'layer-a', ['layer-a'], 'layer-a'),
      after: createLayerStructureSnapshot('after', afterLayers, 'layer-b', ['layer-b', 'layer-a'], 'layer-b'),
    });

    await replayDeltaForTest(delta, 'forward');
    expect(useAppStore.getState().layers.map((layer) => layer.id)).toEqual(['layer-b', 'layer-a']);
    expect(useAppStore.getState().activeLayerId).toBe('layer-b');
    expect(useAppStore.getState().selectedLayerIds).toEqual(['layer-b', 'layer-a']);
    expect(useAppStore.getState().referenceLayerId).toBe('layer-b');

    await replayDeltaForTest(delta, 'backward');
    expect(useAppStore.getState().layers.map((layer) => layer.id)).toEqual(['layer-a', 'layer-b']);
    expect(useAppStore.getState().activeLayerId).toBe('layer-a');
    expect(useAppStore.getState().selectedLayerIds).toEqual(['layer-a']);
    expect(useAppStore.getState().referenceLayerId).toBe('layer-a');
  });

  it('replays layer group registry in both directions', async () => {
    const beforeLayers = [createLayer('layer-a', 0), createLayer('layer-b', 1)];
    const afterLayers = [
      { ...beforeLayers[0]!, groupId: 'group-1' },
      { ...beforeLayers[1]!, groupId: 'group-1' },
    ];

    const delta = createLayerStructureDelta({
      before: createLayerStructureSnapshot('before', beforeLayers, 'layer-a', [], null, []),
      after: createLayerStructureSnapshot(
        'after',
        afterLayers,
        'layer-a',
        [],
        null,
        [{ id: 'group-1', name: 'Group 1' }],
      ),
    });

    await replayDeltaForTest(delta, 'forward');
    expect(useAppStore.getState().layerGroups).toEqual([{ id: 'group-1', name: 'Group 1' }]);

    await replayDeltaForTest(delta, 'backward');
    expect(useAppStore.getState().layerGroups).toEqual([]);
  });

  it('preserves an external sampling source while replaying layer history', async () => {
    const beforeLayers = [createLayer('layer-a', 0), createLayer('layer-b', 1)];
    const afterLayers = [beforeLayers[1]!, beforeLayers[0]!];
    const source = { kind: 'asset' as const, assetId: 'portrait-reference' };
    useAppStore.setState((state) => ({
      project: state.project
        ? {
            ...state.project,
            referenceAssets: [{
              id: source.assetId,
              name: 'Portrait',
              dataUrl: 'data:image/png;base64,AAAA',
              naturalWidth: 1,
              naturalHeight: 1,
              visible: true,
              locked: false,
              opacity: 1,
              x: 0,
              y: 0,
              scale: 1,
              crop: { x: 0, y: 0, width: 1, height: 1 },
              flipX: false,
              flipY: false,
              createdAt: 1,
              updatedAt: 1,
            }],
            referenceSamplingSource: source,
          }
        : state.project,
    }));
    const delta = createLayerStructureDelta({
      before: createLayerStructureSnapshot(
        'before',
        beforeLayers,
        'layer-a',
        ['layer-a'],
        'layer-a',
        [],
        source,
      ),
      after: createLayerStructureSnapshot(
        'after',
        afterLayers,
        'layer-b',
        ['layer-b'],
        'layer-a',
        [],
        source,
      ),
    });

    await replayDeltaForTest(delta, 'forward');
    expect(useAppStore.getState().project?.referenceSamplingSource).toEqual(source);

    await replayDeltaForTest(delta, 'backward');
    expect(useAppStore.getState().project?.referenceSamplingSource).toEqual(source);
  });

  it('routes restored active layers through the store runtime lifecycle', async () => {
    const beforeLayers = [createLayer('layer-a', 0), createLayer('layer-b', 1, 'color-cycle')];
    const afterLayers = [beforeLayers[1]!, beforeLayers[0]!];
    useAppStore.setState({
      layers: afterLayers,
      activeLayerId: 'layer-b',
      selectedLayerIds: ['layer-b'],
    });
    const originalSetActiveLayer = useAppStore.getState().setActiveLayer;
    const setActiveLayer = jest.fn((
      id: Parameters<typeof originalSetActiveLayer>[0],
      options?: Parameters<typeof originalSetActiveLayer>[1],
    ) => originalSetActiveLayer(id, options));
    useAppStore.setState({ setActiveLayer });

    try {
      const delta = createLayerStructureDelta({
        before: createLayerStructureSnapshot('before', beforeLayers, 'layer-a', ['layer-a']),
        after: createLayerStructureSnapshot('after', afterLayers, 'layer-b', ['layer-b']),
      });

      await replayDeltaForTest(delta, 'backward');

      expect(setActiveLayer).toHaveBeenCalledWith('layer-a', expect.objectContaining({
        forceLifecycle: true,
        previousActiveLayer: expect.objectContaining({ id: 'layer-b' }),
      }));
    } finally {
      useAppStore.setState({ setActiveLayer: originalSetActiveLayer });
    }
  });

  it('restores active-layer tool state exactly during compensation', async () => {
    const beforeLayers = [createLayer('layer-a', 0), createLayer('layer-b', 1, 'color-cycle')];
    const afterLayers = [beforeLayers[1]!, beforeLayers[0]!];
    useAppStore.setState((state) => ({
      layers: afterLayers,
      activeLayerId: 'layer-b',
      selectedLayerIds: ['layer-b'],
      tools: {
        ...state.tools,
        brushSettings: {
          ...state.tools.brushSettings,
          customBrushColorCycle: true,
        },
      },
    }));
    const toolsBeforeReplay = useAppStore.getState().tools;
    const delta = createLayerStructureDelta({
      before: createLayerStructureSnapshot('before', beforeLayers, 'layer-a', ['layer-a']),
      after: createLayerStructureSnapshot('after', afterLayers, 'layer-b', ['layer-b']),
    });
    const prepared = await delta.prepare('backward');

    await prepared.apply();
    expect(useAppStore.getState().activeLayerId).toBe('layer-a');
    expect(useAppStore.getState().tools.brushSettings.customBrushColorCycle).toBe(false);

    await prepared.compensate();
    expect(useAppStore.getState().activeLayerId).toBe('layer-b');
    expect(useAppStore.getState().tools).toBe(toolsBeforeReplay);
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
