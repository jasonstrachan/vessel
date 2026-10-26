import { getSequentialFrameCursor } from '@/runtime/playback/sequentialFrameCursor';
import {
  createSequentialAppendFrameDelta,
  createSequentialFrameDelta,
  createSequentialSettingsDelta,
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

describe('SequentialSettingsDelta', () => {
  const setup = () => {
    const before = createSequentialData(['settings-a', 'settings-b']);
    const after = {
      ...before,
      fps: 24,
      durationMs: 500
    };
    useAppStore.setState(state => ({
      layers: [createSequentialLayer('layer-seq', after)],
      activeLayerId: 'layer-seq',
      sequentialRecord: {
        ...state.sequentialRecord,
        fps: 24,
        durationMs: 500,
        currentFrame: 7,
        trailFalloff: 0.3,
        recordArmed: false
      },
      layersNeedRecomposition: false,
      pendingCompositeDirtyBatches: []
    }));
    return {
      before,
      after
    };
  };
  it('has a bounded scalar payload and preserves event/chunk identities on both directions', async () => {
    const {
      before,
      after
    } = setup();
    const delta = createSequentialSettingsDelta({
      layerId: 'layer-seq',
      before,
      after,
      recordBefore: {
        fps: 12,
        durationMs: 1000
      },
      recordAfter: {
        fps: 24,
        durationMs: 500
      }
    });
    expect(delta.approxBytes).toBeLessThan(1024);
    await replayDeltaForTest(delta, 'backward');
    expect(useAppStore.getState().layers[0].sequentialData!.events).toBe(before.events);
    expect(useAppStore.getState().sequentialRecord).toMatchObject({
      fps: 12,
      durationMs: 1000,
      currentFrame: 7,
      trailFalloff: 0.3
    });
    await replayDeltaForTest(delta, 'forward');
    expect(useAppStore.getState().layers[0].sequentialData!.events).toBe(before.events);
    expect(useAppStore.getState().sequentialRecord).toMatchObject({
      fps: 24,
      durationMs: 500,
      currentFrame: 7,
      trailFalloff: 0.3
    });
  });
  it('deeply isolates destructive event snapshots from subsequent source mutation', async () => {
    const {
      before
    } = setup();
    before.eventChunks = [{
      id: 'chunk',
      startEventIndex: 0,
      eventCount: 2,
      frameIndexes: [0, 1]
    }];
    const after = {
      ...before,
      frameCount: 1,
      events: [before.events[0]]
    };
    const delta = createSequentialSettingsDelta({
      layerId: 'layer-seq',
      before,
      after,
      recordBefore: {
        frameCount: 12
      },
      recordAfter: {
        frameCount: 1
      }
    });
    before.events[1].stamps[0].x = 999;
    before.eventChunks[0].frameIndexes[0] = 999;
    await replayDeltaForTest(delta, 'backward');
    const data = useAppStore.getState().layers[0].sequentialData!;
    expect(data.events[1].stamps[0].x).toBe(2);
    expect(data.eventChunks![0].frameIndexes).toEqual([0, 1]);
  });
  it.each(['backward', 'forward'] as const)('isolates nested brush snapshots and replay data in %s history', async direction => {
    const { before } = setup();
    const gradient = [{ position: 0, color: '#ff0000', opacity: 0.5 }];
    const pluginConfig = { spamCustomText: 'original' };
    const customStamp = { width: 1, height: 1, rgbaBase64: 'original', isColorizable: true };
    const selectionClip = { kind: 'rect' as const, minX: 1, minY: 2, maxX: 3, maxY: 4 };
    before.events[0].brush = {
      ...before.events[0].brush,
      colorCycleGradient: gradient,
      pluginConfig,
      customStamp,
      selectionClip,
    };
    const after = { ...before, frameCount: 1, events: [before.events[0]] };
    const delta = createSequentialSettingsDelta({
      layerId: 'layer-seq', before, after,
      recordBefore: { frameCount: 12 }, recordAfter: { frameCount: 1 },
    });
    gradient[0].color = '#000000';
    gradient[0].opacity = 0;
    pluginConfig.spamCustomText = 'poison';
    customStamp.rgbaBase64 = 'poison';
    selectionClip.minX = 999;
    for (let cycle = 0; cycle < 2; cycle += 1) {
      await replayDeltaForTest(delta, direction);
      const brush = useAppStore.getState().layers[0].sequentialData!.events[0].brush;
      expect(brush.colorCycleGradient).toEqual([{ position: 0, color: '#ff0000', opacity: 0.5 }]);
      expect(brush.pluginConfig).toEqual({ spamCustomText: 'original' });
      expect(brush.customStamp).toEqual({ width: 1, height: 1, rgbaBase64: 'original', isColorizable: true });
      expect(brush.selectionClip).toEqual({ kind: 'rect', minX: 1, minY: 2, maxX: 3, maxY: 4 });
      brush.colorCycleGradient![0].color = '#ffffff';
      brush.pluginConfig!.spamCustomText = 'replay poison';
      brush.customStamp!.rgbaBase64 = 'replay poison';
      Object.assign(brush.selectionClip!, { minX: 777 });
      await replayDeltaForTest(delta, direction === 'backward' ? 'forward' : 'backward');
    }
  });

  it('compensates exact metadata and global preferences after a later real replay failure', async () => {
    const {
      before,
      after
    } = setup();
    const snapshot = useAppStore.getState();
    const cursor = getSequentialFrameCursor();
    const manager = new HistoryManager({
      runtimeRehydration: {
        createTargets: () => ({
          layerIds: new Set(),
          colorCycleLayerIds: new Set(),
          sequentialLayerIds: new Set(),
          workerScopes: new Set()
        }),
        rehydrate: async () => undefined
      }
    });
    const txn = manager.begin('settings-change');
    txn.push(new LateFailureDelta());
    txn.push(createSequentialSettingsDelta({
      layerId: 'layer-seq',
      before,
      after,
      recordBefore: {
        fps: 12,
        durationMs: 1000
      },
      recordAfter: {
        fps: 24,
        durationMs: 500
      }
    }));
    txn.commit('FPS');
    await expect(manager.undo()).rejects.toBeInstanceOf(HistoryReplayApplyError);
    expect(useAppStore.getState().layers).toBe(snapshot.layers);
    expect(useAppStore.getState().sequentialRecord).toBe(snapshot.sequentialRecord);
    expect(getSequentialFrameCursor()).toEqual(cursor);
    expect(manager.entries()).toHaveLength(1);
    expect(manager.redoEntries()).toHaveLength(0);
  });
});
