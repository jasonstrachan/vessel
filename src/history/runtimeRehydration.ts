import { useAppStore } from '@/stores/useAppStore';
import { getColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import {
  applyColorCycleBrushLayerSnapshotToRuntime,
  canApplyColorCycleBrushLayerSnapshotToRuntime,
  getColorCycleLegacyLayerBuffer,
  type ColorCycleBrushLayerSnapshotRuntimeWriter,
} from '@/lib/colorCycle/document';
import { RecolorManager } from '@/lib/colorCycle/RecolorManager';
import { clearSequentialLayerRendererLayer } from '@/lib/sequential/SequentialLayerRenderer';
import type { ColorCycleHistoryBrushContext } from '@/hooks/brushEngine/colorCycleBrushContracts';
import type {
  HistoryDirection,
  HistoryEntry,
  HistoryRehydrationTargets,
  HistoryWorkerScope,
} from './actionTypes';

const isClient = typeof window !== 'undefined';

type SerializedStrokeData = {
  paintBuffer?: ArrayBuffer | ArrayBufferView | string;
  gradientIdBuffer?: ArrayBuffer | ArrayBufferView | string;
  gradientDefIdBuffer?: ArrayBuffer | ArrayBufferView | string;
  speedBuffer?: ArrayBuffer | ArrayBufferView | string;
  flowBuffer?: ArrayBuffer | ArrayBufferView | string;
  phaseBuffer?: ArrayBuffer | ArrayBufferView | string;
  hasContent?: boolean;
  strokeCounter?: number;
};

type SerializedLayerBrushState = {
  layerId?: string;
  strokeData?: SerializedStrokeData;
  data?: {
    indexBuffer?: {
      data?: ArrayBuffer | ArrayBufferView | string;
      gradientId?: ArrayBuffer | ArrayBufferView | string;
      speedData?: ArrayBuffer | ArrayBufferView | string;
      flowData?: ArrayBuffer | ArrayBufferView | string;
      phaseData?: ArrayBuffer | ArrayBufferView | string;
    };
  };
};

type SerializedBrushState = {
  layers?: SerializedLayerBrushState[];
};

type RestorableColorCycleBrush = ColorCycleHistoryBrushContext & ColorCycleBrushLayerSnapshotRuntimeWriter;

const cloneBufferLike = (
  input: ArrayBuffer | ArrayBufferView | string | null | undefined,
): ArrayBuffer | undefined => {
  if (!input) {
    return undefined;
  }
  if (input instanceof ArrayBuffer) {
    return input.slice(0);
  }
  if (ArrayBuffer.isView(input)) {
    const bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    return bytes.slice().buffer;
  }
  if (typeof input !== 'string') {
    return undefined;
  }
  if (input.startsWith('archive:') || input.startsWith('buffer:')) {
    return undefined;
  }
  try {
    const binary = atob(input.replace(/\s+/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  } catch {
    return undefined;
  }
};

const bufferHasNonZeroPayload = (input: ArrayBuffer | undefined): boolean => {
  if (!input || input.byteLength === 0) {
    return false;
  }
  const bytes = new Uint8Array(input);
  return bytes.some((value) => value !== 0);
};

const ensurePositiveDimension = (value: number | undefined, fallback: number): number => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  return Math.floor(Math.max(1, fallback));
};

const runtimeRehydrationError = (
  layerId: string,
  operation: string,
  cause?: unknown,
): Error => {
  const detail = cause instanceof Error ? `: ${cause.message}` : '';
  return new Error(`Failed to ${operation} for color-cycle layer ${layerId}${detail}`);
};

const rehydrateColorCycleRuntime = async (
  layerIds: Iterable<string> | null,
  options?: { restoreBrushState?: boolean },
): Promise<void> => {
  if (!isClient) {
    return;
  }

  const manager = getColorCycleBrushManager();
  const store = useAppStore.getState();
  const requested = layerIds ? new Set(layerIds) : null;
  if (requested && requested.size > 0) {
    const liveColorCycleLayerIds = new Set(
      store.layers
        .filter((layer) => layer.layerType === 'color-cycle' && layer.colorCycleData)
        .map((layer) => layer.id),
    );
    requested.forEach((layerId) => {
      if (!liveColorCycleLayerIds.has(layerId)) {
        manager.deleteBrush?.(layerId);
      }
    });
  }

  const targetLayers = store.layers.filter((layer) => {
    if (layer.layerType !== 'color-cycle' || !layer.colorCycleData) {
      return false;
    }
    if (!requested || requested.size === 0) {
      return true;
    }
    return requested.has(layer.id);
  });

  if (targetLayers.length === 0) {
    return;
  }

  let flaggedForRecomposition = false;

  for (const layer of targetLayers) {
    const colorState = layer.colorCycleData;
    if (!colorState) {
      continue;
    }

    let restoredCanonicalSurface = false;
    let rejectedEmptySerializedBrushState = false;

    const hasValidBrush = manager.validateColorCycleBrush(layer.id);
    if (!hasValidBrush) {
      const canvasWidth = ensurePositiveDimension(
        colorState.canvas?.width ?? layer.imageData?.width,
        store.project?.width ?? 1024,
      );
      const canvasHeight = ensurePositiveDimension(
        colorState.canvas?.height ?? layer.imageData?.height,
        store.project?.height ?? 1024,
      );
      try {
        const initialized = manager.initColorCycleForLayer(
          layer.id,
          canvasWidth,
          canvasHeight,
          undefined,
        );
        if (!initialized) {
          throw runtimeRehydrationError(layer.id, 'initialize runtime');
        }
        flaggedForRecomposition = true;
      } catch (error) {
        throw runtimeRehydrationError(layer.id, 'initialize runtime', error);
      }
    }

    if (options?.restoreBrushState) {
      const latestStore = useAppStore.getState();
      const latestLayer = latestStore.layers.find((candidate) => candidate.id === layer.id);
      const latestColorState = latestLayer?.layerType === 'color-cycle'
        ? latestLayer.colorCycleData
        : null;
      const brushState = latestColorState?.brushState as SerializedBrushState | null | undefined;
      const serializedLayer = brushState?.layers?.find((candidate) => candidate.layerId === layer.id);
      const strokeData = serializedLayer?.strokeData;
      const paintBuffer = cloneBufferLike(
        strokeData?.paintBuffer ?? serializedLayer?.data?.indexBuffer?.data,
      );
      const paintBufferHasContent = bufferHasNonZeroPayload(paintBuffer);
      const serializedHasContent = Boolean(strokeData?.hasContent) || paintBufferHasContent;
      const serializedIsExplicitlyEmpty =
        strokeData?.hasContent === false &&
        paintBuffer !== undefined &&
        !paintBufferHasContent &&
        latestColorState?.hasContent === false;
      const brush = manager.getHistoryBrush(layer.id) as RestorableColorCycleBrush | null | undefined;

      const shouldApplySerializedBrushState =
        Boolean(paintBuffer) &&
        (serializedHasContent || serializedIsExplicitlyEmpty);
      rejectedEmptySerializedBrushState =
        Boolean(paintBuffer) &&
        !shouldApplySerializedBrushState &&
        !paintBufferHasContent &&
        latestColorState?.hasContent === true;

      if (latestColorState && paintBuffer && shouldApplySerializedBrushState) {
        if (!canApplyColorCycleBrushLayerSnapshotToRuntime(brush)) {
          throw runtimeRehydrationError(layer.id, 'restore canonical brush state');
        }
        try {
          brush.setTargetCanvas?.(latestColorState.canvas ?? null);
          applyColorCycleBrushLayerSnapshotToRuntime(brush, layer.id, {
            paintBuffer,
            gradientIdBuffer: cloneBufferLike(
              strokeData?.gradientIdBuffer ??
              serializedLayer?.data?.indexBuffer?.gradientId ??
              getColorCycleLegacyLayerBuffer(latestColorState, 'gradientIdBuffer'),
            ),
            gradientDefIdBuffer: cloneBufferLike(
              strokeData?.gradientDefIdBuffer ??
              getColorCycleLegacyLayerBuffer(latestColorState, 'gradientDefIdBuffer'),
            ),
            speedBuffer: cloneBufferLike(
              strokeData?.speedBuffer ?? serializedLayer?.data?.indexBuffer?.speedData,
            ),
            flowBuffer: cloneBufferLike(
              strokeData?.flowBuffer ?? serializedLayer?.data?.indexBuffer?.flowData,
            ),
            phaseBuffer: cloneBufferLike(
              strokeData?.phaseBuffer ?? serializedLayer?.data?.indexBuffer?.phaseData,
            ),
            hasContent: serializedHasContent,
            strokeCounter: strokeData?.strokeCounter ?? 0,
          });
          brush.updateColorCycleTexture?.();
          if (latestColorState.canvas) {
            if (typeof brush.renderDirectToCanvas === 'function') {
              brush.renderDirectToCanvas(latestColorState.canvas, layer.id);
            } else if (typeof brush.render === 'function') {
              brush.render(false);
            } else {
              throw runtimeRehydrationError(layer.id, 'render restored canonical state');
            }
          } else if (typeof brush.render === 'function') {
            brush.render(false);
          } else {
            throw runtimeRehydrationError(layer.id, 'render restored canonical state');
          }
          restoredCanonicalSurface = true;
          latestStore.updateLayer(layer.id, {
            colorCycleData: {
              ...latestColorState,
              hasContent: serializedHasContent,
            },
          }, { skipColorCycleSync: true });
          flaggedForRecomposition = true;
        } catch (error) {
          throw runtimeRehydrationError(layer.id, 'restore canonical brush state', error);
        }
      }

      if (rejectedEmptySerializedBrushState) {
        try {
          if (brush && latestColorState?.canvas) {
            brush.setTargetCanvas?.(latestColorState.canvas);
            brush.updateColorCycleTexture?.();
            brush.renderDirectToCanvas?.(latestColorState.canvas, layer.id);
          }
          flaggedForRecomposition = true;
        } catch (error) {
          throw runtimeRehydrationError(layer.id, 'render rejected empty snapshot', error);
        }
        restoredCanonicalSurface = true;
      }
    }

    if (!restoredCanonicalSurface && colorState.canvas && colorState.canvasImageData) {
      try {
        const ctx = colorState.canvas.getContext('2d', {
          willReadFrequently: true,
        } as CanvasRenderingContext2DSettings);
        if (!ctx) {
          throw runtimeRehydrationError(layer.id, 'acquire preview canvas context');
        }
        ctx.putImageData(colorState.canvasImageData, 0, 0);
      } catch (error) {
        throw runtimeRehydrationError(layer.id, 'restore preview canvas', error);
      }
    }

    if (colorState.mode === 'recolor') {
      try {
        await RecolorManager.getInstance().processLayer(layer);
        flaggedForRecomposition = true;
      } catch (error) {
        throw runtimeRehydrationError(layer.id, 'rehydrate recolor output', error);
      }
    }
  }

  if (flaggedForRecomposition) {
    useAppStore.getState().setLayersNeedRecomposition(true);
  }
};

const rehydrateWorkerScope = async (scope: HistoryWorkerScope): Promise<void> => {
  switch (scope) {
    case 'color-cycle-gradient': {
      if (!isClient) {
        return;
      }
      // Touch the recolor manager so gradient workers spin up lazily when needed.
      try {
        void RecolorManager.getInstance();
      } catch {
        // ignore warm-up failures
      }
      break;
    }
    default:
      break;
  }
};

export const createRehydrationTargets = (): HistoryRehydrationTargets => ({
  layerIds: new Set<string>(),
  colorCycleLayerIds: new Set<string>(),
  sequentialLayerIds: new Set<string>(),
  workerScopes: new Set<HistoryWorkerScope>(),
});

export const rehydrateEntryResources = async (
  entry: HistoryEntry,
  direction: HistoryDirection,
  targets: HistoryRehydrationTargets,
): Promise<void> => {
  if (targets.colorCycleLayerIds.size > 0) {
    await rehydrateColorCycleRuntime(targets.colorCycleLayerIds, {
      restoreBrushState: entry.action === 'layer-structure',
    });
  }

  if (targets.workerScopes.size > 0) {
    for (const scope of targets.workerScopes) {
      await rehydrateWorkerScope(scope);
    }
  }

  if (targets.sequentialLayerIds.size > 0) {
    targets.sequentialLayerIds.forEach((layerId) => {
      clearSequentialLayerRendererLayer(layerId);
    });
  }

  if (targets.layerIds.size > 0) {
    // Mark bitmap updates so downstream renderers refresh composite buffers.
    useAppStore.getState().setLayersNeedRecomposition(true);
  }

  // Canvas/view transforms are handled directly by their deltas; no extra work required here.
  void entry; // appease unused parameter lint in case of future additions
  void direction; // appease unused parameter lint in case of future additions
};
