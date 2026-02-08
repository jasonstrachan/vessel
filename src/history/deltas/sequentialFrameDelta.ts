import { useAppStore } from '@/stores/useAppStore';
import type { SequentialLayerData } from '@/types';

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
