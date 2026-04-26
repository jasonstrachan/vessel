import type { Layer, SequentialEventChunk, SequentialStrokeEvent } from '@/types';

type SequentialLayerMetadata = {
  frameCount: number;
  fps: number;
  durationMs: number;
};

type AppendSequentialLayerEventsResult = {
  didAppend: boolean;
  layers: Layer[];
};

let cachedSequentialAppendLayerId: string | null = null;
let cachedSequentialAppendLayerIndex = -1;

export const resetSequentialAppendLayerIndexCache = (): void => {
  cachedSequentialAppendLayerId = null;
  cachedSequentialAppendLayerIndex = -1;
};

export const resolveSequentialAppendLayerIndex = (
  layers: Layer[],
  layerId: string
): number => {
  if (cachedSequentialAppendLayerId === layerId && cachedSequentialAppendLayerIndex >= 0) {
    const cachedLayer = layers[cachedSequentialAppendLayerIndex];
    if (cachedLayer?.id === layerId && cachedLayer.layerType === 'sequential') {
      return cachedSequentialAppendLayerIndex;
    }
  }

  const scannedIndex = layers.findIndex(
    (layer) => layer.id === layerId && layer.layerType === 'sequential'
  );
  cachedSequentialAppendLayerId = scannedIndex >= 0 ? layerId : null;
  cachedSequentialAppendLayerIndex = scannedIndex;
  return scannedIndex;
};

export const normalizeSequentialLayerMetadata = (
  metadata: SequentialLayerMetadata
): SequentialLayerMetadata => ({
  frameCount: Math.max(1, Math.round(metadata.frameCount)),
  fps: Math.max(1, Math.round(metadata.fps)),
  durationMs: Math.max(1, Math.round(metadata.durationMs)),
});

export const appendSequentialLayerEventsToLayers = (
  layers: Layer[],
  layerId: string,
  events: SequentialStrokeEvent[],
  metadata: SequentialLayerMetadata
): AppendSequentialLayerEventsResult => {
  if (events.length === 0) {
    return { didAppend: false, layers };
  }

  const targetIndex = resolveSequentialAppendLayerIndex(layers, layerId);
  if (targetIndex < 0) {
    return { didAppend: false, layers };
  }

  const targetLayer = layers[targetIndex];
  const normalizedMetadata = normalizeSequentialLayerMetadata(metadata);
  const previousSequentialData = targetLayer.sequentialData;
  const previousEvents = previousSequentialData?.events ?? [];
  const nextEvents = [...previousEvents, ...events];
  const frameIndexes = Array.from(new Set(events.map((event) => event.frameIndex))).sort(
    (a, b) => a - b
  );
  const nextChunk: SequentialEventChunk = {
    id: `${layerId}:${previousEvents.length}:${events.length}`,
    startEventIndex: previousEvents.length,
    eventCount: events.length,
    frameIndexes,
  };
  const nextEventChunks = [...(previousSequentialData?.eventChunks ?? []), nextChunk];
  const updatedLayer: Layer = {
    ...targetLayer,
    sequentialData: {
      frameCount: normalizedMetadata.frameCount,
      fps: normalizedMetadata.fps,
      durationMs: normalizedMetadata.durationMs,
      events: nextEvents,
      eventChunks: nextEventChunks,
    },
  };
  const nextLayers = [...layers];
  nextLayers[targetIndex] = updatedLayer;

  return {
    didAppend: true,
    layers: nextLayers,
  };
};
