import { getColorCycleBrushManager, getColorCycleStoreState } from '@/stores/colorCycleBrushManager';
import { useAppStore } from '@/stores/useAppStore';
import type { ColorCycleBrushImplementation } from '@/stores/colorCycleBrushManager';
import { captureColorCyclePersistenceSnapshot } from '@/lib/colorCycle/persistence';

type BaseColorCycleSerializedState = ReturnType<ColorCycleBrushImplementation['serialize']>;
type BaseColorCycleSerializedLayer = NonNullable<BaseColorCycleSerializedState['layers']>[number];

export type ColorCycleEraseMaskSnapshot = {
  width: number;
  height: number;
  alpha: Uint8ClampedArray;
  version: number;
};

export type ColorCycleSerializedLayerState = BaseColorCycleSerializedLayer & {
  eraseMaskSnapshot?: ColorCycleEraseMaskSnapshot;
};

export type ColorCycleSerializedState = (Omit<BaseColorCycleSerializedState, 'layers'> & {
  layers: ColorCycleSerializedLayerState[];
}) | null;

type EraseMaskSnapshotCacheEntry = {
  mask: HTMLCanvasElement;
  width: number;
  height: number;
  version: number;
  snapshot: ColorCycleEraseMaskSnapshot;
};

const eraseMaskSnapshotCacheByLayerId = new Map<string, EraseMaskSnapshotCacheEntry>();

const captureEraseMaskSnapshot = (layerId: string): ColorCycleEraseMaskSnapshot | undefined => {
  const layer = useAppStore.getState().layers.find((candidate) => candidate.id === layerId);
  const mask = layer?.layerType === 'color-cycle' ? layer.colorCycleData?.eraseMask : null;
  const version = layer?.colorCycleData?.eraseMaskVersion ?? 0;
  if (!mask) {
    eraseMaskSnapshotCacheByLayerId.delete(layerId);
    return undefined;
  }

  const cached = eraseMaskSnapshotCacheByLayerId.get(layerId);
  if (
    cached &&
    cached.mask === mask &&
    cached.width === mask.width &&
    cached.height === mask.height &&
    cached.version === version
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
      version,
    };
    eraseMaskSnapshotCacheByLayerId.set(layerId, {
      mask,
      width: mask.width,
      height: mask.height,
      version,
      snapshot,
    });
    return snapshot;
  } catch {
    return undefined;
  }
};

const bufferLikeByteLength = (value: unknown): number => {
  if (value instanceof ArrayBuffer) {
    return value.byteLength;
  }
  if (ArrayBuffer.isView(value)) {
    return value.byteLength;
  }
  return 0;
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
              })) ?? [],
          }
        : null;
    } catch {
      return null;
    }
  })();
