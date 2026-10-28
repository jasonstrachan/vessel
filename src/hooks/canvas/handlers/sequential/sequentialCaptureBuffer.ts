import { clearSequentialLivePreview } from '@/lib/sequential/SequentialLivePreviewRuntime';
import { createSequentialPayloadBudgetRuntime, readSequentialProjectPayloadBytes } from '@/lib/sequential/SequentialPayloadBudget';
import { recordSequentialFlushPerf } from '@/lib/sequential/SequentialPerfCounters';
import type { AppState } from '@/stores/useAppStore';
import type { SequentialStrokeEvent } from '@/types';
import {
  defaultEventBufferRuntime,
  type SequentialEventBufferRuntime,
} from '@/hooks/canvas/handlers/sequential/sequentialCaptureRuntime';

export const flushBufferedSequentialEvents = ({
  state,
  runtime,
  preserveLivePreview = false,
}: {
  state: AppState;
  runtime?: SequentialEventBufferRuntime;
  preserveLivePreview?: boolean;
}): number => {
  const flushStartMs =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
  const targetRuntime = runtime ?? defaultEventBufferRuntime;
  if (targetRuntime.isFlushing || targetRuntime.layers.size === 0) {
    return 0;
  }

  targetRuntime.isFlushing = true;
  const queuedLayerEntries = Array.from(targetRuntime.layers.entries());
  targetRuntime.layers.clear();
  targetRuntime.pendingPayloadBytes = 0;
  targetRuntime.selectionClipKeysByLayer.clear();

  let flushedEventCount = 0;
  try {
    queuedLayerEntries.forEach(([layerId, entry]) => {
      if (entry.events.length === 0) {
        return;
      }
      state.appendSequentialLayerEvents(layerId, entry.events, {
        frameCount: entry.frameCount,
        fps: entry.fps,
        durationMs: entry.durationMs,
      });
      if (!preserveLivePreview) {
        clearSequentialLivePreview(layerId);
      }
      entry.byFrame.clear();
      flushedEventCount += entry.events.length;
    });
  } finally {
    targetRuntime.isFlushing = false;
  }
  const flushDurationMs =
    (typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now()) - flushStartMs;
  recordSequentialFlushPerf({
    events: flushedEventCount,
    durationMs: flushDurationMs,
  });
  return flushedEventCount;
};

export const getBufferedSequentialPendingPayloadBytes = ({
  runtime,
}: {
  runtime?: SequentialEventBufferRuntime;
} = {}): number => {
  const targetRuntime = runtime ?? defaultEventBufferRuntime;
  return Math.max(0, targetRuntime.pendingPayloadBytes);
};

export const getBufferedSequentialLayerFrameEvents = ({
  layerId,
  frameIndex,
  runtime,
}: {
  layerId: string;
  frameIndex: number;
  runtime?: SequentialEventBufferRuntime;
}): ReadonlyArray<SequentialStrokeEvent> => {
  if (!layerId) {
    return [];
  }
  const targetRuntime = runtime ?? defaultEventBufferRuntime;
  const layerEvents = targetRuntime.layers.get(layerId);
  if (!layerEvents) {
    return [];
  }
  const normalizedFrameIndex = Number.isFinite(frameIndex) ? Math.round(frameIndex) : 0;
  return layerEvents.byFrame.get(normalizedFrameIndex) ?? [];
};

export const enqueueBufferedSequentialEvent = ({
  layerId,
  event,
  metadata,
  payloadBytes,
  runtime,
}: {
  layerId: string;
  event: SequentialStrokeEvent;
  metadata: { frameCount: number; fps: number; durationMs: number };
  payloadBytes: number;
  runtime: SequentialEventBufferRuntime;
}): void => {
  const existing = runtime.layers.get(layerId);
  if (existing) {
    existing.events.push(event);
    const existingFrameEvents = existing.byFrame.get(event.frameIndex);
    if (existingFrameEvents) {
      existingFrameEvents.push(event);
    } else {
      existing.byFrame.set(event.frameIndex, [event]);
    }
    existing.frameCount = metadata.frameCount;
    existing.fps = metadata.fps;
    existing.durationMs = metadata.durationMs;
  } else {
    runtime.layers.set(layerId, {
      events: [event],
      byFrame: new Map([[event.frameIndex, [event]]]),
      frameCount: metadata.frameCount,
      fps: metadata.fps,
      durationMs: metadata.durationMs,
    });
  }
  runtime.pendingPayloadBytes += payloadBytes;
};

export const readCachedProjectPayloadBytes = ({
  state,
  payloadRuntime,
  eventBufferRuntime,
}: {
  state: AppState;
  payloadRuntime: ReturnType<typeof createSequentialPayloadBudgetRuntime>;
  eventBufferRuntime: SequentialEventBufferRuntime;
}): number => {
  if (
    eventBufferRuntime.lastKnownLayersRef === state.layers &&
    Number.isFinite(eventBufferRuntime.lastKnownProjectPayloadBytes)
  ) {
    return Math.max(0, eventBufferRuntime.lastKnownProjectPayloadBytes ?? 0);
  }
  const projectPayloadBytes = readSequentialProjectPayloadBytes({
    layers: state.layers,
    runtime: payloadRuntime,
  });
  eventBufferRuntime.lastKnownLayersRef = state.layers;
  eventBufferRuntime.lastKnownProjectPayloadBytes = projectPayloadBytes;
  return projectPayloadBytes;
};
