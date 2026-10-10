import { sequentialSelectionClipKey } from '@/lib/sequential/selectionClip';
import type { Layer, SequentialStrokeEvent } from '@/types';
import { estimatePluginConfigPayloadBytes } from '@/lib/sequential/pluginConfig';

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
  event: SequentialStrokeEvent,
  selectionClipKeys?: Set<string>,
  knownSelectionClipKeys?: ReadonlySet<string>,
): number => {
  const brush = event.brush;
  // Capture and decoded strokes share immutable mask content; charge its raster once per layer.
  let selectionClipBytes = brush.selectionClip ? 40 : 0;
  if (brush.selectionClip?.kind === 'mask') {
    const key = sequentialSelectionClipKey(brush.selectionClip);
    if (!selectionClipKeys?.has(key) && !knownSelectionClipKeys?.has(key)) {
      selectionClipBytes += estimateStringBytes(brush.selectionClip.alphaBase64);
    }
    selectionClipKeys?.add(key);
  }
  return (
    SEQUENTIAL_EVENT_BASE_BYTES +
    estimateStringBytes(event.id) +
    estimateStringBytes(event.layerId) +
    estimateStringBytes(event.strokeId) +
    selectionClipBytes +
    estimateStringBytes(brush.tool) +
    estimateStringBytes(brush.brushShape) +
    estimateStringBytes(brush.blendMode) +
    estimateStringBytes(brush.color) +
    estimateStringBytes(brush.pluginBrushId) +
    estimatePluginConfigPayloadBytes(brush.pluginConfig) +
    estimateStringBytes(brush.customStampId) +
    estimateStringBytes(brush.customStampHash) +
    estimateStringBytes(brush.ditherAlgorithm) +
    estimateStringBytes(brush.ditherStrokeTipShape) +
    (Number.isFinite(brush.mosaicTilePx) ? 4 : 0) +
    (Number.isFinite(brush.mosaicSegmentPx) ? 4 : 0) +
    (Number.isFinite(brush.mosaicBlocksCount) ? 4 : 0) +
    (Number.isFinite(brush.mosaicPaletteCount) ? 4 : 0) +
    (Number.isFinite(brush.mosaicSegmentJitter) ? 4 : 0) +
    (Number.isFinite(brush.mosaicSeed) ? 4 : 0) +
    (Array.isArray(brush.colorCycleGradient)
      ? brush.colorCycleGradient.reduce(
          (sum, stop) => sum + 8 + (stop.color?.length ?? 0),
          0
        )
      : 0) +
    (brush.customStamp
      ? estimateStringBytes(brush.customStamp.rgbaBase64) + 16
      : 0) +
    event.stamps.length * SEQUENTIAL_STAMP_BYTES
  );
};

export const estimateSequentialLayerPayloadBytes = (
  layer: Pick<Layer, 'layerType' | 'sequentialData'>,
  selectionClipKeys = new Set<string>(),
): number => {
  if (layer.layerType !== 'sequential' || !layer.sequentialData) {
    return 0;
  }

  let bytes = SEQUENTIAL_LAYER_BASE_BYTES;
  const events = layer.sequentialData.events;
  for (let i = 0; i < events.length; i += 1) {
    bytes += estimateSequentialStrokeEventPayloadBytes(events[i], selectionClipKeys);
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
  layerEventRefs: Map<string, ReadonlyArray<SequentialStrokeEvent>>;
  layerLastEventIds: Map<string, string | null>;
  layerPayloadBytes: Map<string, number>;
  projectPayloadBytes: number;
  selectionClipKeysByLayer: Map<string, Set<string>>;
}

export const createSequentialPayloadBudgetRuntime = (): SequentialPayloadBudgetRuntime => ({
  initialized: false,
  layerEventCounts: new Map<string, number>(),
  layerEventRefs: new Map(),
  layerLastEventIds: new Map<string, string | null>(),
  layerPayloadBytes: new Map<string, number>(),
  projectPayloadBytes: 0,
  selectionClipKeysByLayer: new Map(),
});

export const resetSequentialPayloadBudgetRuntime = (
  runtime: SequentialPayloadBudgetRuntime
): void => {
  runtime.initialized = false;
  runtime.selectionClipKeysByLayer.clear();
  runtime.layerEventCounts.clear();
  runtime.layerEventRefs.clear();
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
  runtime.selectionClipKeysByLayer.clear();
  runtime.layerEventCounts.clear();
  runtime.layerEventRefs.clear();
  runtime.layerLastEventIds.clear();
  runtime.layerPayloadBytes.clear();

  let totalBytes = 0;
  for (let i = 0; i < layers.length; i += 1) {
    const layer = layers[i];
    if (layer.layerType !== 'sequential' || !layer.sequentialData) {
      continue;
    }

    const selectionClipKeys = new Set<string>();
    const layerBytes = estimateSequentialLayerPayloadBytes(layer, selectionClipKeys);
    runtime.selectionClipKeysByLayer.set(layer.id, selectionClipKeys);
    const eventCount = layer.sequentialData.events.length;
    const lastEvent = eventCount > 0 ? layer.sequentialData.events[eventCount - 1] : null;
    runtime.layerEventCounts.set(layer.id, eventCount);
    runtime.layerEventRefs.set(layer.id, layer.sequentialData.events);
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
    if (runtimeCount !== currentCount || runtime.layerEventRefs.get(layer.id) !== layer.sequentialData.events) {
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
  eventBytes,
  runtime,
}: {
  layerId: string;
  event: SequentialStrokeEvent;
  eventBytes?: number;
  runtime: SequentialPayloadBudgetRuntime;
}): number => {
  const currentLayerBytes = runtime.layerPayloadBytes.get(layerId);
  const currentEventCount = runtime.layerEventCounts.get(layerId);

  if (typeof currentLayerBytes !== 'number' || typeof currentEventCount !== 'number') {
    return runtime.projectPayloadBytes;
  }

  const selectionClipKeys = runtime.selectionClipKeysByLayer.get(layerId) ?? new Set<string>();
  const estimatedBytes = estimateSequentialStrokeEventPayloadBytes(event, selectionClipKeys);
  runtime.selectionClipKeysByLayer.set(layerId, selectionClipKeys);
  const resolvedEventBytes = typeof eventBytes === 'number' && Number.isFinite(eventBytes)
    ? Math.max(0, Math.round(eventBytes)) : estimatedBytes;

  runtime.layerPayloadBytes.set(layerId, currentLayerBytes + resolvedEventBytes);
  runtime.layerEventCounts.set(layerId, currentEventCount + 1);
  runtime.layerLastEventIds.set(layerId, event.id);
  runtime.projectPayloadBytes += resolvedEventBytes;
  return runtime.projectPayloadBytes;
};
