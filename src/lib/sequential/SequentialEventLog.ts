import type { SequentialStrokeEvent } from '@/types';

const cloneEvent = (event: SequentialStrokeEvent): SequentialStrokeEvent => ({
  ...event,
  brush: { ...event.brush },
  stamps: event.stamps.map((stamp) => ({ ...stamp })),
});

export class SequentialEventLog {
  private eventsByLayer = new Map<string, SequentialStrokeEvent[]>();

  private eventsByLayerAndFrame = new Map<string, Map<number, SequentialStrokeEvent[]>>();

  private getOrCreateLayerEvents(layerId: string): SequentialStrokeEvent[] {
    const existing = this.eventsByLayer.get(layerId);
    if (existing) {
      return existing;
    }
    const created: SequentialStrokeEvent[] = [];
    this.eventsByLayer.set(layerId, created);
    return created;
  }

  private getOrCreateLayerFrameMap(layerId: string): Map<number, SequentialStrokeEvent[]> {
    const existing = this.eventsByLayerAndFrame.get(layerId);
    if (existing) {
      return existing;
    }
    const created = new Map<number, SequentialStrokeEvent[]>();
    this.eventsByLayerAndFrame.set(layerId, created);
    return created;
  }

  private appendEventReference(layerId: string, event: SequentialStrokeEvent): void {
    const events = this.getOrCreateLayerEvents(layerId);
    events.push(event);

    const byFrame = this.getOrCreateLayerFrameMap(layerId);
    const frameEvents = byFrame.get(event.frameIndex);
    if (frameEvents) {
      frameEvents.push(event);
      return;
    }
    byFrame.set(event.frameIndex, [event]);
  }

  private rebuildLayerFrameIndex(
    layerId: string,
    events: ReadonlyArray<SequentialStrokeEvent>
  ): void {
    const byFrame = new Map<number, SequentialStrokeEvent[]>();
    for (let i = 0; i < events.length; i += 1) {
      const event = events[i];
      const existing = byFrame.get(event.frameIndex);
      if (existing) {
        existing.push(event);
      } else {
        byFrame.set(event.frameIndex, [event]);
      }
    }
    this.eventsByLayerAndFrame.set(layerId, byFrame);
  }

  append(layerId: string, events: ReadonlyArray<SequentialStrokeEvent>): number {
    if (!layerId || events.length === 0) {
      return 0;
    }
    for (let i = 0; i < events.length; i += 1) {
      this.appendEventReference(layerId, events[i]);
    }
    return events.length;
  }

  appendFromIndex(
    layerId: string,
    events: ReadonlyArray<SequentialStrokeEvent>,
    startIndex: number
  ): number {
    if (!layerId || events.length === 0) {
      return 0;
    }
    const safeStart = Math.max(0, Math.min(events.length, Math.round(startIndex)));
    let appendedCount = 0;
    for (let i = safeStart; i < events.length; i += 1) {
      this.appendEventReference(layerId, events[i]);
      appendedCount += 1;
    }
    return appendedCount;
  }

  replaceLayer(layerId: string, events: ReadonlyArray<SequentialStrokeEvent>): void {
    if (!layerId) {
      return;
    }
    const next = Array.from(events);
    this.eventsByLayer.set(layerId, next);
    this.rebuildLayerFrameIndex(layerId, next);
  }

  clearLayer(layerId: string): void {
    this.eventsByLayer.delete(layerId);
    this.eventsByLayerAndFrame.delete(layerId);
  }

  clearAll(): void {
    this.eventsByLayer.clear();
    this.eventsByLayerAndFrame.clear();
  }

  getLayerEvents(layerId: string): SequentialStrokeEvent[] {
    const events = this.eventsByLayer.get(layerId) ?? [];
    return events.map(cloneEvent);
  }

  getLayerEventsReadonly(layerId: string): ReadonlyArray<SequentialStrokeEvent> {
    return this.eventsByLayer.get(layerId) ?? [];
  }

  getLayerFrameEvents(layerId: string, frameIndex: number): SequentialStrokeEvent[] {
    const byFrame = this.eventsByLayerAndFrame.get(layerId);
    if (!byFrame) {
      return [];
    }
    return (byFrame.get(frameIndex) ?? []).map(cloneEvent);
  }

  getLayerFrameEventsReadonly(
    layerId: string,
    frameIndex: number
  ): ReadonlyArray<SequentialStrokeEvent> {
    const byFrame = this.eventsByLayerAndFrame.get(layerId);
    if (!byFrame) {
      return [];
    }
    return byFrame.get(frameIndex) ?? [];
  }

  getLayerStrokeEvents(layerId: string, strokeId: string): SequentialStrokeEvent[] {
    return this.getLayerEvents(layerId).filter((event) => event.strokeId === strokeId);
  }

  getLayerEventCount(layerId: string): number {
    return this.eventsByLayer.get(layerId)?.length ?? 0;
  }
}
