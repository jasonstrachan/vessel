import type { SequentialStrokeEvent } from '@/types';

const cloneEvent = (event: SequentialStrokeEvent): SequentialStrokeEvent => ({
  ...event,
  brush: { ...event.brush },
  stamps: event.stamps.map((stamp) => ({ ...stamp })),
});

export class SequentialEventLog {
  private eventsByLayer = new Map<string, SequentialStrokeEvent[]>();

  append(layerId: string, events: ReadonlyArray<SequentialStrokeEvent>): number {
    if (!layerId || events.length === 0) {
      return 0;
    }
    const current = this.eventsByLayer.get(layerId) ?? [];
    const next = current.concat(events.map(cloneEvent));
    this.eventsByLayer.set(layerId, next);
    return events.length;
  }

  replaceLayer(layerId: string, events: ReadonlyArray<SequentialStrokeEvent>): void {
    if (!layerId) {
      return;
    }
    this.eventsByLayer.set(layerId, events.map(cloneEvent));
  }

  clearLayer(layerId: string): void {
    this.eventsByLayer.delete(layerId);
  }

  clearAll(): void {
    this.eventsByLayer.clear();
  }

  getLayerEvents(layerId: string): SequentialStrokeEvent[] {
    const events = this.eventsByLayer.get(layerId) ?? [];
    return events.map(cloneEvent);
  }

  getLayerFrameEvents(layerId: string, frameIndex: number): SequentialStrokeEvent[] {
    return this.getLayerEvents(layerId).filter((event) => event.frameIndex === frameIndex);
  }

  getLayerStrokeEvents(layerId: string, strokeId: string): SequentialStrokeEvent[] {
    return this.getLayerEvents(layerId).filter((event) => event.strokeId === strokeId);
  }

  getLayerEventCount(layerId: string): number {
    return this.eventsByLayer.get(layerId)?.length ?? 0;
  }
}
