import { getColorCycleBrushManager, getColorCycleStoreState } from '@/stores/colorCycleBrushManager';
import { useAppStore } from '@/stores/useAppStore';
import type { ColorCycleBrushImplementation } from '@/stores/colorCycleBrushManager';
import { captureColorCyclePersistenceSnapshot } from '@/lib/colorCycle/persistence';
import { logCCMutation, summarizeColorCycleLayer, summarizeScalarBuffer } from '@/utils/colorCycle/ccMutationAudit';
import type { Layer } from '@/types';

type BaseColorCycleSerializedState = ReturnType<ColorCycleBrushImplementation['serialize']>;
type BaseColorCycleSerializedLayer = NonNullable<BaseColorCycleSerializedState['layers']>[number];

export type ColorCycleEraseMaskSnapshot = {
  width: number;
  height: number;
  alpha: Uint8ClampedArray;
  enabled?: boolean;
  version: number;
};

export type ColorCycleSerializedLayerState = BaseColorCycleSerializedLayer & {
  eraseMaskSnapshot?: ColorCycleEraseMaskSnapshot;
  softEdgeMaskSnapshot?: ColorCycleEraseMaskSnapshot;
};

export type ColorCycleSerializedState = (Omit<BaseColorCycleSerializedState, 'layers'> & {
  layers: ColorCycleSerializedLayerState[];
}) | null;

type EraseMaskSnapshotCacheEntry = {
  mask: HTMLCanvasElement;
  width: number;
  height: number;
  version: number;
  enabled?: boolean;
  snapshot: ColorCycleEraseMaskSnapshot;
};

const eraseMaskSnapshotCacheByLayerId = new Map<string, EraseMaskSnapshotCacheEntry>();

const captureMaskSnapshot = (
  layerId: string,
  field: 'eraseMask' | 'softEdgeMask',
  versionField: 'eraseMaskVersion' | 'softEdgeMaskVersion',
  cache: Map<string, EraseMaskSnapshotCacheEntry>,
): ColorCycleEraseMaskSnapshot | undefined => {
  const layer = useAppStore.getState().layers.find((candidate) => candidate.id === layerId);
  const mask = layer?.layerType === 'color-cycle' ? layer.colorCycleData?.[field] : null;
  const version = layer?.colorCycleData?.[versionField] ?? 0;
  const enabled = field === 'softEdgeMask'
    ? layer?.colorCycleData?.softEdgeMaskEnabled !== false
    : undefined;
  if (!mask) {
    cache.delete(layerId);
    return undefined;
  }

  const cached = cache.get(layerId);
  if (
    cached &&
    cached.mask === mask &&
    cached.width === mask.width &&
    cached.height === mask.height &&
    cached.version === version &&
    cached.enabled === enabled
  ) {
    return cached.snapshot;
  }

  const ctx = mask.getContext('2d', { willReadFrequently: true });
  if (!ctx || mask.width <= 0 || mask.height <= 0) {
    return undefined;
  }

  try {
    const image = ctx.getImageData(0, 0, mask.width, mask.height);
    const alpha = new Uint8ClampedArray(mask.width * mask.height);
    for (let src = 3, dst = 0; src < image.data.length; src += 4, dst += 1) {
      alpha[dst] = image.data[src] ?? 0;
    }
    const snapshot: ColorCycleEraseMaskSnapshot = {
      width: mask.width,
      height: mask.height,
      alpha,
      enabled,
      version,
    };
    cache.set(layerId, {
      mask,
      width: mask.width,
      height: mask.height,
      version,
      enabled,
      snapshot,
    });
    return snapshot;
  } catch {
    return undefined;
  }
};

const softEdgeMaskSnapshotCacheByLayerId = new Map<string, EraseMaskSnapshotCacheEntry>();

const captureEraseMaskSnapshot = (layerId: string): ColorCycleEraseMaskSnapshot | undefined => (
  captureMaskSnapshot(layerId, 'eraseMask', 'eraseMaskVersion', eraseMaskSnapshotCacheByLayerId)
);

const captureSoftEdgeMaskSnapshot = (layerId: string): ColorCycleEraseMaskSnapshot | undefined => (
  captureMaskSnapshot(layerId, 'softEdgeMask', 'softEdgeMaskVersion', softEdgeMaskSnapshotCacheByLayerId)
);

const bufferLikeByteLength = (value: unknown): number => {
  if (value instanceof ArrayBuffer) {
    return value.byteLength;
  }
  if (ArrayBuffer.isView(value)) {
    return value.byteLength;
  }
  return 0;
};

const bufferLikeToUint8Array = (value: unknown): Uint8Array | null => {
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return null;
};

const bufferLikeToUint16Array = (value: unknown): Uint16Array | null => {
  if (value instanceof ArrayBuffer) {
    if (value.byteLength % Uint16Array.BYTES_PER_ELEMENT !== 0) {
      return null;
    }
    return new Uint16Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    if (value.byteLength % Uint16Array.BYTES_PER_ELEMENT !== 0) {
      return null;
    }
    return new Uint16Array(
      value.buffer,
      value.byteOffset,
      value.byteLength / Uint16Array.BYTES_PER_ELEMENT
    );
  }
  return null;
};

const inferSerializedLayerDimensions = (
  snapshot: BaseColorCycleSerializedLayer,
  fallbackWidth: number,
  fallbackHeight: number
): { width: number; height: number; raw: unknown } => {
  const snapshotMeta = snapshot as BaseColorCycleSerializedLayer & {
    dimensions?: { width?: unknown; height?: unknown };
  };
  const width = Number(snapshotMeta.dimensions?.width);
  const height = Number(snapshotMeta.dimensions?.height);
  return {
    width: Number.isFinite(width) && width > 0 ? width : fallbackWidth,
    height: Number.isFinite(height) && height > 0 ? height : fallbackHeight,
    raw: snapshotMeta.dimensions ?? null,
  };
};

const summarizeHistoryBuffer = (
  value: unknown,
  width: number,
  height: number,
  kind: 'uint8' | 'uint16' = 'uint8'
): Record<string, unknown> => {
  const byteLength = bufferLikeByteLength(value);
  const buffer = kind === 'uint16'
    ? bufferLikeToUint16Array(value)
    : bufferLikeToUint8Array(value);
  return {
    present: byteLength > 0,
    byteLength,
    summary: buffer ? summarizeScalarBuffer(buffer, width, height) : null,
  };
};

const isEmptyColorCycleHistoryState = (
  state: BaseColorCycleSerializedState,
  layerId: string,
): boolean => {
  const snapshot = state.layers?.find((entry) => entry.layerId === layerId);
  if (!snapshot) {
    return false;
  }
  const strokeData = snapshot.strokeData;
  if (!strokeData) {
    return true;
  }
  if (strokeData.hasContent === true) {
    return false;
  }
  return [
    strokeData.paintBuffer,
    strokeData.gradientIdBuffer,
    strokeData.gradientDefIdBuffer,
    strokeData.speedBuffer,
    strokeData.flowBuffer,
    strokeData.phaseBuffer,
  ].every((buffer) => bufferLikeByteLength(buffer) === 0);
};

const summarizeSerializedHistoryLayer = (
  state: BaseColorCycleSerializedState | null | undefined,
  layerId: string,
  fallbackWidth: number,
  fallbackHeight: number
): Record<string, unknown> | null => {
  const snapshot = state?.layers?.find((entry) => entry.layerId === layerId);
  if (!snapshot) {
    return null;
  }
  const snapshotMeta = snapshot as BaseColorCycleSerializedLayer & {
    canonicalPaint?: boolean;
    dimensions?: unknown;
    schemaVersion?: unknown;
  };
  const stateMeta = state as BaseColorCycleSerializedState & {
    canonicalPaint?: boolean;
    schemaVersion?: unknown;
  };
  const strokeData = snapshot.strokeData;
  const dimensions = inferSerializedLayerDimensions(snapshot, fallbackWidth, fallbackHeight);
  return {
    hasSnapshot: true,
    stateLayerCount: state?.layers?.length ?? 0,
    stateLayerIds: state?.layers?.map((entry) => entry.layerId) ?? [],
    schemaVersion: stateMeta.schemaVersion ?? snapshotMeta.schemaVersion ?? null,
    canonicalPaint: Boolean(snapshotMeta.canonicalPaint || stateMeta.canonicalPaint),
    dimensions: {
      width: dimensions.width,
      height: dimensions.height,
      raw: dimensions.raw,
    },
    hasStrokeData: Boolean(strokeData),
    strokeHasContent: strokeData?.hasContent ?? null,
    strokeCounter: strokeData?.strokeCounter ?? null,
    paintBytes: bufferLikeByteLength(strokeData?.paintBuffer),
    gradientIdBytes: bufferLikeByteLength(strokeData?.gradientIdBuffer),
    gradientDefIdBytes: bufferLikeByteLength(strokeData?.gradientDefIdBuffer),
    speedBytes: bufferLikeByteLength(strokeData?.speedBuffer),
    flowBytes: bufferLikeByteLength(strokeData?.flowBuffer),
    phaseBytes: bufferLikeByteLength(strokeData?.phaseBuffer),
    buffers: {
      paint: summarizeHistoryBuffer(strokeData?.paintBuffer, dimensions.width, dimensions.height),
      gradientId: summarizeHistoryBuffer(strokeData?.gradientIdBuffer, dimensions.width, dimensions.height),
      gradientDefId: summarizeHistoryBuffer(
        strokeData?.gradientDefIdBuffer,
        dimensions.width,
        dimensions.height,
        'uint16'
      ),
      speed: summarizeHistoryBuffer(strokeData?.speedBuffer, dimensions.width, dimensions.height),
      flow: summarizeHistoryBuffer(strokeData?.flowBuffer, dimensions.width, dimensions.height),
      phase: summarizeHistoryBuffer(strokeData?.phaseBuffer, dimensions.width, dimensions.height),
    },
  };
};

const summarizeHistoryCaptureContext = (
  state: ReturnType<typeof useAppStore.getState>,
  layer: Layer,
  brush: ColorCycleBrushImplementation | null | undefined
): Record<string, unknown> => {
  const colorCycleData = layer.layerType === 'color-cycle' ? layer.colorCycleData : undefined;
  const brushState = colorCycleData?.brushState as { layers?: unknown[] } | undefined;
  const colorCycleDataExtra = colorCycleData as (typeof colorCycleData & {
    deferredArchive?: unknown;
    paintBuffer?: unknown;
    speedBuffer?: unknown;
    flowBuffer?: unknown;
  });
  return {
    source: 'captureColorCycleBrushState',
    expectedDestructive: false,
    project: {
      width: state.project?.width ?? null,
      height: state.project?.height ?? null,
      layerCount: state.layers.length,
      activeLayerId: state.activeLayerId ?? null,
    },
    targetLayer: {
      id: layer.id,
      name: layer.name,
      visible: layer.visible,
      opacity: layer.opacity,
      order: layer.order,
      layerType: layer.layerType,
    },
    colorCycleData: colorCycleData ? {
      mode: colorCycleData.mode ?? null,
      hasContent: colorCycleData.hasContent ?? null,
      isAnimating: colorCycleData.isAnimating ?? null,
      runtimeHydrationState: colorCycleData.runtimeHydrationState ?? null,
      deferredRuntimeRestore: Boolean(colorCycleData.deferredRuntimeRestore),
      deferredArchive: Boolean(colorCycleDataExtra.deferredArchive),
      canvasWidth: colorCycleData.canvas?.width ?? colorCycleData.canvasWidth ?? null,
      canvasHeight: colorCycleData.canvas?.height ?? colorCycleData.canvasHeight ?? null,
      canvasImageDataWidth: colorCycleData.canvasImageData?.width ?? null,
      canvasImageDataHeight: colorCycleData.canvasImageData?.height ?? null,
      brushStateLayers: brushState?.layers?.length ?? 0,
      paintBufferBytes: bufferLikeByteLength(colorCycleDataExtra.paintBuffer),
      gradientIdBufferBytes: bufferLikeByteLength(colorCycleData.gradientIdBuffer),
      gradientDefIdBufferBytes: bufferLikeByteLength(colorCycleData.gradientDefIdBuffer),
      speedBufferBytes: bufferLikeByteLength(colorCycleDataExtra.speedBuffer),
      flowBufferBytes: bufferLikeByteLength(colorCycleDataExtra.flowBuffer),
      phaseBufferBytes: bufferLikeByteLength(colorCycleData.phaseBuffer),
      gradientDefStoreCount: colorCycleData.gradientDefStore?.length ?? 0,
      slotPaletteCount: colorCycleData.slotPalettes?.length ?? 0,
      paintSlot: colorCycleData.paintSlot ?? null,
    } : null,
    runtimeBrush: {
      present: Boolean(brush),
      hasSerialize: typeof brush?.serialize === 'function',
      constructorName: brush?.constructor?.name ?? null,
    },
  };
};

export const captureColorCycleBrushState = (layerId: string): ColorCycleSerializedState =>
  (() => {
    const state = useAppStore.getState();
    const layer = state.layers.find((candidate) => candidate.id === layerId);
    if (!layer || layer.layerType !== 'color-cycle') {
      return null;
    }
    const manager = getColorCycleBrushManager();
    const brush =
      getColorCycleStoreState()?.getLayerColorCycleBrush?.(layerId) ??
      manager.getBrush(layerId);
    if (!brush || typeof brush.serialize !== 'function') {
      const eraseMaskSnapshot = captureEraseMaskSnapshot(layerId);
      const softEdgeMaskSnapshot = captureSoftEdgeMaskSnapshot(layerId);
      if (eraseMaskSnapshot || softEdgeMaskSnapshot) {
        return {
          layers: [
            {
              layerId,
              eraseMaskSnapshot,
              softEdgeMaskSnapshot,
            } as ColorCycleSerializedLayerState,
          ],
        } as ColorCycleSerializedState;
      }
      if (layer.colorCycleData?.hasContent) {
        logCCMutation({
          event: 'history-cc-before-state-capture-failed',
          layerId,
          reason: 'missing-runtime-brush',
          severity: 'warn',
          after: summarizeColorCycleLayer(layer),
          details: {
            ...summarizeHistoryCaptureContext(state, layer, brush),
          },
        });
      }
      return null;
    }
    try {
      const rawSnapshot = brush.serialize();
      const snapshotResult = captureColorCyclePersistenceSnapshot(layer, {
        projectWidth: state.project?.width ?? layer.colorCycleData?.canvasWidth ?? layer.imageData?.width ?? 1,
        projectHeight: state.project?.height ?? layer.colorCycleData?.canvasHeight ?? layer.imageData?.height ?? 1,
        requirePaint: true,
        mode: 'history',
        runtimeBrush: {
          serialize: () => rawSnapshot,
        },
      });
      if (!snapshotResult.ok && !isEmptyColorCycleHistoryState(rawSnapshot, layerId)) {
        logCCMutation({
          event: 'history-cc-before-state-capture-failed',
          layerId,
          reason: snapshotResult.reason,
          severity: 'warn',
          after: summarizeColorCycleLayer(layer),
          details: {
            ...summarizeHistoryCaptureContext(state, layer, brush),
            damageKind: snapshotResult.damageKind ?? null,
            diagnostics: snapshotResult.diagnostics,
            rawSnapshot: summarizeSerializedHistoryLayer(
              rawSnapshot,
              layerId,
              state.project?.width ?? layer.colorCycleData?.canvasWidth ?? layer.imageData?.width ?? 1,
              state.project?.height ?? layer.colorCycleData?.canvasHeight ?? layer.imageData?.height ?? 1
            ),
          },
        });
        return null;
      }
      const snapshot = snapshotResult.ok
        ? snapshotResult.brushState as unknown as BaseColorCycleSerializedState
        : rawSnapshot;
      return snapshot
        ? {
            ...snapshot,
            layers:
              snapshot.layers?.map((layer) => ({
                ...layer,
                gradientDefs: layer.gradientDefs
                  ? layer.gradientDefs.map((entry) => ({
                      id: entry.id,
                      name: entry.name,
                      currentSlot: entry.currentSlot,
                    }))
                  : undefined,
                slotPalettes: layer.slotPalettes
                  ? layer.slotPalettes.map((entry) => ({
                      slot: entry.slot,
                      stops: entry.stops.map((stop) => ({ position: stop.position, color: stop.color })),
                    }))
                  : undefined,
                gradientDefStore: layer.gradientDefStore
                  ? layer.gradientDefStore.map((entry) => ({
                      id: entry.id,
                      kind: entry.kind,
                      stops: entry.stops.map((stop) => ({ position: stop.position, color: stop.color })),
                      hash: entry.hash,
                      source: entry.source,
                      createdAtMs: entry.createdAtMs,
                      slot: entry.slot,
                      speedCps: entry.speedCps,
                    }))
                  : undefined,
                nextGradientDefId: layer.nextGradientDefId,
                fgActiveSlot: layer.fgActiveSlot,
                fgDerivedKey: layer.fgDerivedKey,
                fgDerivedGradients: (layer.fgDerivedGradients ?? layer.derivedGradients)
                  ? (layer.fgDerivedGradients ?? layer.derivedGradients)?.map((entry) => ({
                      key: entry.key,
                      slot: entry.slot,
                      spec: { ...entry.spec },
                    }))
                  : undefined,
                derivedGradients: (layer.fgDerivedGradients ?? layer.derivedGradients)
                  ? (layer.fgDerivedGradients ?? layer.derivedGradients)?.map((entry) => ({
                      key: entry.key,
                      slot: entry.slot,
                      spec: { ...entry.spec },
                    }))
                  : undefined,
                strokeData: layer.strokeData
                  ? {
                      ...layer.strokeData,
                      paintBuffer: layer.strokeData.paintBuffer?.slice(0),
                      gradientIdBuffer: layer.strokeData.gradientIdBuffer?.slice(0),
                      gradientDefIdBuffer: layer.strokeData.gradientDefIdBuffer?.slice(0),
                      speedBuffer: layer.strokeData.speedBuffer?.slice(0),
                      flowBuffer: layer.strokeData.flowBuffer?.slice(0),
                      phaseBuffer: layer.strokeData.phaseBuffer?.slice(0),
                    }
                  : undefined,
                eraseMaskSnapshot: captureEraseMaskSnapshot(layer.layerId),
                softEdgeMaskSnapshot: captureSoftEdgeMaskSnapshot(layer.layerId),
              })) ?? [],
          }
        : null;
    } catch (error) {
      logCCMutation({
        event: 'history-cc-before-state-capture-failed',
        layerId,
        reason: 'capture-exception',
        severity: 'warn',
        after: summarizeColorCycleLayer(layer),
        details: {
          ...summarizeHistoryCaptureContext(state, layer, brush),
          message: error instanceof Error ? error.message : String(error),
        },
      });
      return null;
    }
	  })();
