import { useAppStore } from '@/stores/useAppStore';
import type { SequentialLayerData, SequentialStrokeEvent } from '@/types';

import type { HistoryDelta, HistoryDirection, HistoryRehydrationTargets } from '@/history/actionTypes';

const cloneSequentialEvents = (
  events: SequentialLayerData['events']
): SequentialLayerData['events'] =>
  events.map((event) => ({
    ...event,
    brush: { ...event.brush },
    stamps: event.stamps.map((stamp) => ({ ...stamp })),
  }));

export const cloneSequentialLayerData = (data: SequentialLayerData): SequentialLayerData => ({
  frameCount: data.frameCount,
  fps: data.fps,
  durationMs: data.durationMs,
  events: cloneSequentialEvents(data.events),
  eventChunks: data.eventChunks?.map((chunk) => ({
    ...chunk,
    frameIndexes: [...chunk.frameIndexes],
  })),
});

class SequentialFrameDelta implements HistoryDelta {
  readonly _tag = 'sequential-frame';

  readonly layerId: string;
  readonly approxBytes?: number;

  private readonly before: SequentialLayerData;
  private readonly after: SequentialLayerData;

  constructor({
    layerId,
    before,
    after,
  }: {
    layerId: string;
    before: SequentialLayerData;
    after: SequentialLayerData;
  }) {
    this.layerId = layerId;
    this.before = cloneSequentialLayerData(before);
    this.after = cloneSequentialLayerData(after);
    this.approxBytes = Math.max(0, (before.events.length + after.events.length) * 64);
  }

  apply(direction: HistoryDirection): void {
    const next = direction === 'forward' ? this.after : this.before;
    const state = useAppStore.getState();
    const targetLayer = state.layers.find((layer) => layer.id === this.layerId);
    if (!targetLayer || targetLayer.layerType !== 'sequential') {
      return;
    }

    state.updateLayer(
      this.layerId,
      { sequentialData: cloneSequentialLayerData(next) },
      { skipColorCycleSync: true }
    );
    state.setLayersNeedRecomposition(true);
  }

  collectRehydrationTargets(targets: HistoryRehydrationTargets): void {
    targets.layerIds.add(this.layerId);
  }
}

export const createSequentialFrameDelta = ({
  layerId,
  before,
  after,
}: {
  layerId: string;
  before: SequentialLayerData;
  after: SequentialLayerData;
}): HistoryDelta => new SequentialFrameDelta({ layerId, before, after });

class SequentialAppendFrameDelta implements HistoryDelta {
  readonly _tag = 'sequential-frame-append';

  readonly layerId: string;
  readonly approxBytes?: number;

  private readonly beforeEventCount: number;
  private readonly beforeChunkCount: number;
  private readonly metadata: Pick<SequentialLayerData, 'frameCount' | 'fps' | 'durationMs'>;
  private readonly appendedEvents: SequentialStrokeEvent[];
  private readonly appendedChunks: NonNullable<SequentialLayerData['eventChunks']>;

  constructor({
    layerId,
    before,
    after,
  }: {
    layerId: string;
    before: SequentialLayerData;
    after: SequentialLayerData;
  }) {
    this.layerId = layerId;
    this.beforeEventCount = before.events.length;
    this.beforeChunkCount = before.eventChunks?.length ?? 0;
    this.metadata = {
      frameCount: after.frameCount,
      fps: after.fps,
      durationMs: after.durationMs,
    };
    this.appendedEvents = cloneSequentialEvents(after.events.slice(this.beforeEventCount));
    this.appendedChunks = (after.eventChunks ?? [])
      .slice(this.beforeChunkCount)
      .map((chunk) => ({
        ...chunk,
        frameIndexes: [...chunk.frameIndexes],
      }));
    this.approxBytes = Math.max(0, this.appendedEvents.length * 96);
  }

  apply(direction: HistoryDirection): void {
    const state = useAppStore.getState();
    const targetLayer = state.layers.find((layer) => layer.id === this.layerId);
    if (!targetLayer || targetLayer.layerType !== 'sequential' || !targetLayer.sequentialData) {
      return;
    }

    const current = targetLayer.sequentialData;
    const next: SequentialLayerData =
      direction === 'forward'
        ? {
            ...this.metadata,
            events: [...current.events.slice(0, this.beforeEventCount), ...cloneSequentialEvents(this.appendedEvents)],
            eventChunks: [
              ...(current.eventChunks ?? []).slice(0, this.beforeChunkCount),
              ...this.appendedChunks.map((chunk) => ({
                ...chunk,
                frameIndexes: [...chunk.frameIndexes],
              })),
            ],
          }
        : {
            ...this.metadata,
            events: cloneSequentialEvents(current.events.slice(0, this.beforeEventCount)),
            eventChunks: (current.eventChunks ?? [])
              .slice(0, this.beforeChunkCount)
              .map((chunk) => ({
                ...chunk,
                frameIndexes: [...chunk.frameIndexes],
              })),
          };

    state.updateLayer(
      this.layerId,
      { sequentialData: next },
      { skipColorCycleSync: true }
    );
    state.setLayersNeedRecomposition(true);
  }

  collectRehydrationTargets(targets: HistoryRehydrationTargets): void {
    targets.layerIds.add(this.layerId);
  }
}

export const canUseSequentialAppendDelta = (
  before: SequentialLayerData,
  after: SequentialLayerData
): boolean => {
  if (
    before.frameCount !== after.frameCount ||
    before.fps !== after.fps ||
    before.durationMs !== after.durationMs ||
    after.events.length < before.events.length
  ) {
    return false;
  }
  for (let i = 0; i < before.events.length; i += 1) {
    if (before.events[i]?.id !== after.events[i]?.id) {
      return false;
    }
  }
  return after.events.length > before.events.length;
};

export const createSequentialAppendFrameDelta = ({
  layerId,
  before,
  after,
}: {
  layerId: string;
  before: SequentialLayerData;
  after: SequentialLayerData;
}): HistoryDelta => new SequentialAppendFrameDelta({ layerId, before, after });
