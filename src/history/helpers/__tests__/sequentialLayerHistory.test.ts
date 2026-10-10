import historyManager from '@/history/historyService';
import { commitLayerHistory } from '@/history/helpers/layerHistory';
import { commitSequentialLayerHistory } from '@/history/helpers/sequentialLayerHistory';
import { cloneSequentialLayerData } from '@/history/deltas/sequentialFrameDelta';
import { trackPendingHistoryCommit, waitForPendingHistoryCommits } from '@/history/pendingHistoryCommits';
import { HISTORY_FINALIZE_LANE } from '@/hooks/canvas/drawingHandlersConfig';
import { FinalizeQueue } from '@/lib/canvas/FinalizeQueue';
import { registerFinalizeQueue } from '@/stores/pendingColorCycleSaves';
import { useAppStore } from '@/stores/useAppStore';
import { BrushShape, type Layer, type SequentialLayerData } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

const image = (alpha: number): ImageData =>
  new ImageData(new Uint8ClampedArray([255, 0, 0, alpha]), 1, 1);

const sequentialData = (ids: string[]): SequentialLayerData => ({
  frameCount: 2,
  fps: 2,
  durationMs: 1000,
  eventChunks: [],
  events: ids.map((id, index) => ({
    id,
    layerId: 'sequence',
    strokeId: id,
    timestampMs: index,
    frameIndex: index === 0 ? 1 : 0,
    brush: {
      tool: 'eraser',
      brushShape: BrushShape.ROUND,
      size: 1,
      opacity: 1,
      blendMode: 'destination-out',
      rotation: 0,
      spacing: 1,
      color: '#000000',
      customStampId: null,
    },
    stamps: [{ x: index, y: 0, pressure: 1, rotation: 0, size: 1, alpha: 1 }],
  })),
});

const layer = (id: string, data?: SequentialLayerData): Layer => {
  const framebuffer = document.createElement('canvas');
  framebuffer.width = 1;
  framebuffer.height = 1;
  return {
    id,
    name: id,
    order: data ? 1 : 0,
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    locked: false,
    layerType: data ? 'sequential' : 'normal',
    imageData: data ? null : image(255),
    framebuffer,
    alignment: createDefaultLayerAlignment(),
    ...(data ? { sequentialData: data } : {}),
  };
};

const writeSequence = (data: SequentialLayerData): void => {
  useAppStore.getState().updateLayer('sequence', {
    sequentialData: cloneSequentialLayerData(data),
  }, { skipColorCycleSync: true });
};

const readSequence = (): SequentialLayerData | undefined =>
  useAppStore.getState().layers.find((entry) => entry.id === 'sequence')?.sequentialData;

const readRaster = (): number[] =>
  Array.from(useAppStore.getState().layers.find((entry) => entry.id === 'raster')?.imageData?.data ?? []);

describe('sequential history ordering', () => {
  let queue: FinalizeQueue;
  let releases: Array<() => void>;

  const holdHistory = (commit: () => Promise<void> = async () => {}): Promise<void> => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    releases.push(release);
    return queue.enqueue(async () => {
      await held;
      await commit();
    }, HISTORY_FINALIZE_LANE);
  };

  const commitSequence = (
    before: SequentialLayerData,
    after: SequentialLayerData,
    coalesce?: Parameters<typeof commitSequentialLayerHistory>[0]['coalesce'],
  ): Promise<void> => commitSequentialLayerHistory({
    layerId: 'sequence',
    beforeSequentialData: before,
    afterSequentialData: after,
    actionType: 'eraser',
    description: 'Later sequential erase',
    tool: 'eraser',
    coalesce,
  });

  beforeEach(() => {
    queue = new FinalizeQueue();
    releases = [];
    registerFinalizeQueue(queue);
    historyManager.clear();
    const layers = [layer('raster'), layer('sequence', sequentialData(['other-frame']))];
    useAppStore.setState((state) => ({
      layers,
      activeLayerId: 'sequence',
      layersNeedRecomposition: false,
      pendingCompositeDirtyBatches: [],
      project: state.project ? { ...state.project, width: 1, height: 1, layers } : state.project,
      history: { ...state.history, undoStack: [], redoStack: [] },
    }));
  });

  afterEach(async () => {
    releases.forEach((release) => release());
    await queue.whenIdle();
    await waitForPendingHistoryCommits();
    registerFinalizeQueue(null);
    historyManager.clear();
  });

  it('keeps an older held raster erase before a sequential erase through two undo/redo steps', async () => {
    const rasterBefore = image(255);
    const rasterAfter = image(0);
    const before = sequentialData(['other-frame']);
    const after = sequentialData(['other-frame', 'erase']);
    useAppStore.getState().updateLayer('raster', { imageData: rasterAfter });
    writeSequence(after);
    const olderCommit = holdHistory(() => commitLayerHistory({
      layerId: 'raster',
      beforeImage: rasterBefore,
      afterImage: rasterAfter,
      beforeColorState: null,
      actionType: 'eraser',
      description: 'Earlier raster erase',
      tool: 'eraser',
    }));
    const laterCommit = commitSequence(before, after);

    await Promise.resolve();
    expect(historyManager.entries()).toHaveLength(0);
    releases[0]();
    await Promise.all([olderCommit, laterCommit]);
    expect(historyManager.entries().map((entry) => entry.label)).toEqual([
      'Earlier raster erase', 'Later sequential erase',
    ]);

    await historyManager.undo();
    expect(readSequence()).toEqual(before);
    expect(readRaster()).toEqual(Array.from(rasterAfter.data));
    await historyManager.undo();
    expect(readSequence()).toEqual(before);
    expect(readRaster()).toEqual(Array.from(rasterBefore.data));
    await historyManager.redo();
    expect(readSequence()).toEqual(before);
    expect(readRaster()).toEqual(Array.from(rasterAfter.data));
    await historyManager.redo();
    expect(readSequence()).toEqual(after);
    expect(readRaster()).toEqual(Array.from(rasterAfter.data));
  });

  it('captures caller data and nested coalescing metadata before the queued commit', async () => {
    const before = sequentialData(['before']);
    const after = sequentialData(['replacement']);
    const expectedBefore = cloneSequentialLayerData(before);
    const expectedAfter = cloneSequentialLayerData(after);
    const coalesce = {
      key: 'original-key',
      maxIntervalMs: 250,
      pointerSession: { pointerId: 3, startedAt: 100, endedAt: 200 },
    };
    writeSequence(after);
    const held = holdHistory();
    const pending = commitSequence(before, after, coalesce);
    before.events[0].stamps[0].x = 99;
    after.events[0].brush.opacity = 0;
    after.events[0].stamps[0].x = 88;
    coalesce.key = 'mutated-key';
    coalesce.pointerSession.endedAt = 999;

    await Promise.resolve();
    expect(historyManager.entries()).toHaveLength(0);
    releases[0]();
    await Promise.all([held, pending]);
    expect(historyManager.entries()[0]?.meta).toMatchObject({
      coalesceKey: 'original-key',
      pointerSession: { pointerId: 3, startedAt: 100, endedAt: 200 },
    });
    await historyManager.undo();
    expect(readSequence()).toEqual(expectedBefore);
    await historyManager.redo();
    expect(readSequence()).toEqual(expectedAfter);
  });

  it('settles when the caller tracks the returned promise as pending history', async () => {
    const before = sequentialData(['other-frame']);
    const after = sequentialData(['other-frame', 'delete']);
    writeSequence(after);
    const held = holdHistory();
    const pending = commitSequence(before, after);
    trackPendingHistoryCommit(pending);
    const drained = waitForPendingHistoryCommits();

    await Promise.resolve();
    expect(historyManager.entries()).toHaveLength(0);
    releases[0]();
    await Promise.all([held, pending, drained]);
    expect(historyManager.entries()).toHaveLength(1);
    await historyManager.undo();
    expect(readSequence()).toEqual(before);
  });

  it('preserves immediate commit and replay without a registered canvas queue', async () => {
    registerFinalizeQueue(null);
    const before = sequentialData(['other-frame']);
    const after = sequentialData(['other-frame', 'erase']);
    writeSequence(after);
    const pending = commitSequence(before, after);
    expect(historyManager.entries()).toHaveLength(1);
    await pending;
    await historyManager.undo();
    expect(readSequence()).toEqual(before);
    await historyManager.redo();
    expect(readSequence()).toEqual(after);
  });
});
