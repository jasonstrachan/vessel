import type { Layer, SequentialStrokeEvent } from '@/types';

export const SEQUENTIAL_PAYLOAD_SOFT_LIMIT_BYTES = 32 * 1024 * 1024;
export const SEQUENTIAL_PAYLOAD_HARD_LIMIT_BYTES = 96 * 1024 * 1024;

const SEQUENTIAL_LAYER_BASE_BYTES = 96;
const SEQUENTIAL_EVENT_BASE_BYTES = 192;
const SEQUENTIAL_STAMP_BYTES = 52;
const UTF16_CODE_UNIT_BYTES = 2;

const estimateStringBytes = (value: string | null | undefined): number => {
  if (!value) {
    return 0;
  }
  return value.length * UTF16_CODE_UNIT_BYTES;
};

export const estimateSequentialStrokeEventPayloadBytes = (
  event: SequentialStrokeEvent
): number => {
  const brush = event.brush;
  return (
    SEQUENTIAL_EVENT_BASE_BYTES +
    estimateStringBytes(event.id) +
    estimateStringBytes(event.layerId) +
    estimateStringBytes(event.strokeId) +
    estimateStringBytes(brush.tool) +
    estimateStringBytes(brush.brushShape) +
    estimateStringBytes(brush.blendMode) +
    estimateStringBytes(brush.color) +
    estimateStringBytes(brush.customStampId) +
    event.stamps.length * SEQUENTIAL_STAMP_BYTES
  );
};

export const estimateSequentialLayerPayloadBytes = (
  layer: Pick<Layer, 'layerType' | 'sequentialData'>
): number => {
  if (layer.layerType !== 'sequential' || !layer.sequentialData) {
    return 0;
  }

  let bytes = SEQUENTIAL_LAYER_BASE_BYTES;
  const events = layer.sequentialData.events;
  for (let i = 0; i < events.length; i += 1) {
    bytes += estimateSequentialStrokeEventPayloadBytes(events[i]);
  }
  return bytes;
};

export const estimateSequentialProjectPayloadBytes = (
  layers: Array<Pick<Layer, 'layerType' | 'sequentialData'>>
): number => {
  let bytes = 0;
  for (let i = 0; i < layers.length; i += 1) {
    bytes += estimateSequentialLayerPayloadBytes(layers[i]);
  }
  return bytes;
};

export interface SequentialPayloadBudgetRuntime {
  initialized: boolean;
  layerEventCounts: Map<string, number>;
  layerLastEventIds: Map<string, string | null>;
  layerPayloadBytes: Map<string, number>;
  projectPayloadBytes: number;
}

export const createSequentialPayloadBudgetRuntime = (): SequentialPayloadBudgetRuntime => ({
  initialized: false,
  layerEventCounts: new Map<string, number>(),
  layerLastEventIds: new Map<string, string | null>(),
  layerPayloadBytes: new Map<string, number>(),
  projectPayloadBytes: 0,
});

export const resetSequentialPayloadBudgetRuntime = (
  runtime: SequentialPayloadBudgetRuntime
): void => {
  runtime.initialized = false;
  runtime.layerEventCounts.clear();
  runtime.layerLastEventIds.clear();
  runtime.layerPayloadBytes.clear();
  runtime.projectPayloadBytes = 0;
};

const rebuildRuntimeFromLayers = ({
  layers,
  runtime,
}: {
  layers: Layer[];
  runtime: SequentialPayloadBudgetRuntime;
}): number => {
  runtime.layerEventCounts.clear();
  runtime.layerLastEventIds.clear();
  runtime.layerPayloadBytes.clear();

  let totalBytes = 0;
  for (let i = 0; i < layers.length; i += 1) {
    const layer = layers[i];
    if (layer.layerType !== 'sequential' || !layer.sequentialData) {
      continue;
    }

    const layerBytes = estimateSequentialLayerPayloadBytes(layer);
    const eventCount = layer.sequentialData.events.length;
    const lastEvent = eventCount > 0 ? layer.sequentialData.events[eventCount - 1] : null;
    runtime.layerEventCounts.set(layer.id, eventCount);
    runtime.layerLastEventIds.set(layer.id, lastEvent?.id ?? null);
    runtime.layerPayloadBytes.set(layer.id, layerBytes);
    totalBytes += layerBytes;
  }

  runtime.initialized = true;
  runtime.projectPayloadBytes = totalBytes;
  return totalBytes;
};

export const readSequentialProjectPayloadBytes = ({
  layers,
  runtime,
}: {
  layers: Layer[];
  runtime: SequentialPayloadBudgetRuntime;
}): number => {
  if (!runtime.initialized) {
    return rebuildRuntimeFromLayers({ layers, runtime });
  }

  const sequentialLayerCount = layers.reduce((count, layer) => (
    layer.layerType === 'sequential' && layer.sequentialData ? count + 1 : count
  ), 0);

  if (runtime.layerEventCounts.size !== sequentialLayerCount) {
    return rebuildRuntimeFromLayers({ layers, runtime });
  }

  for (let i = 0; i < layers.length; i += 1) {
    const layer = layers[i];
    if (layer.layerType !== 'sequential' || !layer.sequentialData) {
      continue;
    }

    const currentCount = layer.sequentialData.events.length;
    const runtimeCount = runtime.layerEventCounts.get(layer.id);
    if (runtimeCount !== currentCount) {
      return rebuildRuntimeFromLayers({ layers, runtime });
    }

    const currentLastEventId =
      currentCount > 0 ? layer.sequentialData.events[currentCount - 1]?.id ?? null : null;
    const runtimeLastEventId = runtime.layerLastEventIds.get(layer.id) ?? null;
    if (runtimeLastEventId !== currentLastEventId) {
      return rebuildRuntimeFromLayers({ layers, runtime });
    }
  }

  return runtime.projectPayloadBytes;
};

export const appendSequentialEventPayloadBytes = ({
  layerId,
  event,
  runtime,
}: {
  layerId: string;
  event: SequentialStrokeEvent;
  runtime: SequentialPayloadBudgetRuntime;
}): number => {
  const eventBytes = estimateSequentialStrokeEventPayloadBytes(event);
  const currentLayerBytes = runtime.layerPayloadBytes.get(layerId);
  const currentEventCount = runtime.layerEventCounts.get(layerId);

  if (typeof currentLayerBytes !== 'number' || typeof currentEventCount !== 'number') {
    return runtime.projectPayloadBytes;
  }

  runtime.layerPayloadBytes.set(layerId, currentLayerBytes + eventBytes);
  runtime.layerEventCounts.set(layerId, currentEventCount + 1);
  runtime.layerLastEventIds.set(layerId, event.id);
  runtime.projectPayloadBytes += eventBytes;
  return runtime.projectPayloadBytes;
};
