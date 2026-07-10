import {
  createSequentialAppendFrameDelta,
  createSequentialFrameDelta,
} from '@/history/deltas/sequentialFrameDelta';
import { replayDeltaForTest } from '@/history/__tests__/replayTestUtils';
import type { HistoryDelta, HistoryDirection, PreparedHistoryDelta } from '@/history/actionTypes';
import { HistoryReplayApplyError } from '@/history/errors';
import HistoryManager from '@/history/historyManager';
import { useAppStore } from '@/stores/useAppStore';
import { BrushShape, type Layer, type SequentialLayerData } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

const createSequentialLayer = (id: string, sequentialData: SequentialLayerData): Layer => {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  return {
    id,
    name: id,
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    locked: false,
    order: 0,
    imageData: null,
    framebuffer: canvas,
    alignment: createDefaultLayerAlignment(),
    layerType: 'sequential',
    sequentialData,
  };
};

const createSequentialData = (eventIds: string[]): SequentialLayerData => ({
  frameCount: 12,
  fps: 12,
  durationMs: 1000,
  events: eventIds.map((id, index) => ({
    id,
    layerId: 'layer-seq',
    strokeId: `stroke-${index}`,
    timestampMs: index,
    frameIndex: index % 12,
    brush: {
      tool: 'brush',
      brushShape: BrushShape.ROUND,
      size: 8,
      opacity: 1,
      blendMode: 'source-over',
      rotation: 0,
      spacing: 1,
      color: '#ff0000',
      customStampId: null,
    },
    stamps: [{ x: 1 + index, y: 1, pressure: 1, rotation: 0, size: 8, alpha: 1 }],
  })),
});

class LateFailureDelta implements HistoryDelta {
  readonly _tag = 'late-failure';

  apply(direction: HistoryDirection): void {
    void direction;
    throw new Error('Injected late replay failure');
  }

  prepare(direction: HistoryDirection): PreparedHistoryDelta {
    return {
      deltaTag: this._tag,
      apply: () => this.apply(direction),
      requiresCompensation: () => false,
      compensate: () => undefined,
    };
  }
}

describe('SequentialFrameDelta', () => {
  beforeEach(() => {
    const before = createSequentialData(['event-a']);
    useAppStore.setState((state) => ({
      layers: [createSequentialLayer('layer-seq', before)],
      activeLayerId: 'layer-seq',
      layersNeedRecomposition: false,
      pendingCompositeDirtyBatches: [],
      project: state.project
        ? { ...state.project, width: 16, height: 16 }
        : state.project,
    }));
  });

  it('applies backward and forward sequential payloads', async () => {
    const before = createSequentialData(['event-a']);
    const after = createSequentialData(['event-a', 'event-b', 'event-c']);
    useAppStore.getState().updateLayer(
      'layer-seq',
      { sequentialData: after },
      { skipColorCycleSync: true }
    );
    useAppStore.setState({ layersNeedRecomposition: false, pendingCompositeDirtyBatches: [] });

    const delta = createSequentialFrameDelta({
      layerId: 'layer-seq',
      before,
      after,
    });

    await replayDeltaForTest(delta, 'backward');
    let layer = useAppStore.getState().layers.find((entry) => entry.id === 'layer-seq');
    expect(layer?.sequentialData?.events.map((event) => event.id)).toEqual(['event-a']);
    expect(useAppStore.getState().layersNeedRecomposition).toBe(true);
    expect(useAppStore.getState().pendingCompositeDirtyBatches).toEqual([
      {
        layerId: 'layer-seq',
        version: 0,
        rects: [{ x: 0, y: 0, width: 16, height: 16 }],
      },
    ]);

    useAppStore.setState({ layersNeedRecomposition: false, pendingCompositeDirtyBatches: [] });
    await replayDeltaForTest(delta, 'forward');
    layer = useAppStore.getState().layers.find((entry) => entry.id === 'layer-seq');
    expect(layer?.sequentialData?.events.map((event) => event.id)).toEqual([
      'event-a',
      'event-b',
      'event-c',
    ]);
    expect(useAppStore.getState().layersNeedRecomposition).toBe(true);
    expect(useAppStore.getState().pendingCompositeDirtyBatches).toEqual([
      {
        layerId: 'layer-seq',
        version: 0,
        rects: [{ x: 0, y: 0, width: 16, height: 16 }],
      },
    ]);
  });

  it('applies appended sequential events through the dirty-batch contract', async () => {
    const before = createSequentialData(['event-a']);
    const after = createSequentialData(['event-a', 'event-b']);
    const delta = createSequentialAppendFrameDelta({
      layerId: 'layer-seq',
      before,
      after,
    });

    await replayDeltaForTest(delta, 'forward');
    const layer = useAppStore.getState().layers.find((entry) => entry.id === 'layer-seq');
    expect(layer?.sequentialData?.events.map((event) => event.id)).toEqual(['event-a', 'event-b']);
    expect(useAppStore.getState().layersNeedRecomposition).toBe(true);
    expect(useAppStore.getState().pendingCompositeDirtyBatches).toEqual([
      {
        layerId: 'layer-seq',
        version: 0,
        rects: [{ x: 0, y: 0, width: 16, height: 16 }],
      },
    ]);
  });

  it('compensates a real sequential frame delta when a later delta fails', async () => {
    const before = createSequentialData(['event-a']);
    const after = createSequentialData(['event-a', 'event-b']);
    useAppStore.getState().updateLayer('layer-seq', { sequentialData: after }, { skipColorCycleSync: true });
    const manager = new HistoryManager({
      runtimeRehydration: {
        createTargets: () => ({ layerIds: new Set(), colorCycleLayerIds: new Set(), sequentialLayerIds: new Set(), workerScopes: new Set() }),
        rehydrate: async () => undefined,
      },
    });
    const txn = manager.begin('sequential-stroke');
    txn.push(new LateFailureDelta());
    txn.push(createSequentialFrameDelta({ layerId: 'layer-seq', before, after }));
    txn.commit('Atomic sequential frame');

    await expect(manager.undo()).rejects.toBeInstanceOf(HistoryReplayApplyError);
    const layer = useAppStore.getState().layers.find((entry) => entry.id === 'layer-seq');
    expect(layer?.sequentialData?.events.map((event) => event.id)).toEqual(['event-a', 'event-b']);
    expect(manager.entries()).toHaveLength(1);
    expect(manager.redoEntries()).toHaveLength(0);
  });
});
