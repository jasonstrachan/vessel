import type { StoreApi } from 'zustand';
import historyManager from '@/history/historyService';
import { isLegacySnapshotDelta } from '@/history/legacyCanvasSnapshot';
import type { HistoryEntry } from '@/history/actionTypes';
import {
  captureColorCycleBrushState,
  type ColorCycleSerializedState,
} from '@/history/helpers/colorCycle';
import type { CanvasSnapshot, Layer, Project } from '@/types';
import { cloneLayerAlignment } from '@/utils/layoutDefaults';
import { captureCanvasImageData } from '@/utils/canvas/canvasImage';
import { waitForFinalizeQueueIdle, waitForPendingColorCycleSaves } from '../pendingColorCycleSaves';
import { flushPendingToolWork } from '@/utils/toolFlushRegistry';

type AppState = import('../useAppStore').AppState;
type CCReason = import('../useAppStore').CCReason;

type StoreSet = StoreApi<AppState>['setState'];
type StoreGet = StoreApi<AppState>['getState'];

const NON_COMPOSITE_DELTA_TAGS = new Set<string>(['selection-bounds', 'view-state']);

export const entryRequiresComposite = (entry: HistoryEntry | null): boolean => {
  if (!entry) {
    return true;
  }
  return entry.deltas.some((delta) => !NON_COMPOSITE_DELTA_TAGS.has(delta._tag));
};

export const cloneImageDataForHistory = (imageData: ImageData | null | undefined): ImageData | undefined => {
  if (!imageData) {
    return undefined;
  }
  return new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
};

interface CloneLayerForHistoryOptions {
  actionType: CanvasSnapshot['actionType'];
  description?: string;
  activeLayerId: string;
  isColorCycleTarget?: boolean;
  isColorCycleAction?: boolean;
  previousLayersById?: Map<string, LayerHistorySnapshot | Layer>;
  contextOptions?: CanvasRenderingContext2DSettings;
}

type PersistedColorCycleData = Omit<NonNullable<Layer['colorCycleData']>, 'brushState'> & {
  canvasImageData?: ImageData;
  canvasWidth?: number;
  canvasHeight?: number;
  eraseMaskImageData?: ImageData;
  brushState?: ColorCycleSerializedState | null;
};

type LayerHistorySnapshot = Layer & { colorCycleData?: PersistedColorCycleData };

const cloneLayerForHistory = (
  layer: Layer,
  {
    actionType,
    description,
    activeLayerId,
    isColorCycleTarget = false,
    isColorCycleAction = false,
    previousLayersById,
    contextOptions = { willReadFrequently: true },
  }: CloneLayerForHistoryOptions
): LayerHistorySnapshot => {
  if (
    isColorCycleTarget &&
    isColorCycleAction &&
    previousLayersById &&
    layer.id !== activeLayerId
  ) {
    const previousLayer = previousLayersById.get(layer.id) as LayerHistorySnapshot | Layer | undefined;
    if (previousLayer && 'alignment' in previousLayer) {
      return previousLayer as LayerHistorySnapshot;
    }
  }

  const shouldCloneImageData =
    !!layer.imageData &&
    (!isColorCycleTarget || !isColorCycleAction || layer.id === activeLayerId);
  const clonedImageData = shouldCloneImageData
    ? cloneImageDataForHistory(layer.imageData)
    : layer.imageData;

  const { colorCycleData: existingColorCycleData, ...layerWithoutCC } = layer;
  const layerCopy: LayerHistorySnapshot = {
    ...layerWithoutCC,
    layerType: layer.layerType,
    imageData: clonedImageData ?? null,
    alignment: cloneLayerAlignment(layer.alignment),
  };

  if (existingColorCycleData) {
    let captured: ImageData | undefined;
    const isStructural =
      actionType === 'layer' ||
      actionType === 'layers' ||
      actionType === 'structure' ||
      actionType.startsWith('layer-');
    const isCCActionForLayer =
      isStructural ||
      actionType === 'fill' ||
      (description && (description.includes('CC') || description.includes('Color Cycle')));

    if (!isCCActionForLayer && existingColorCycleData.canvas) {
      try {
        const ccCtx = existingColorCycleData.canvas.getContext('2d', contextOptions);
        if (ccCtx) {
          captured = ccCtx.getImageData(
            0,
            0,
            existingColorCycleData.canvas.width,
            existingColorCycleData.canvas.height
          );
        }
      } catch {
        captured = undefined;
      }
    }

    let hasCCPixels = Boolean(existingColorCycleData.hasContent);
    if (captured?.data) {
      const data = captured.data;
      const step = Math.max(4, Math.floor(data.length / 4096));
      for (let i = 3; i < data.length; i += step) {
        if (data[i] > 0) {
          hasCCPixels = true;
          break;
        }
      }
    }

    const shouldCaptureBrushState =
      existingColorCycleData &&
      layer.layerType === 'color-cycle' &&
      (isColorCycleTarget || isCCActionForLayer || layer.id === activeLayerId);
    const existingBrushState = (existingColorCycleData?.brushState ?? null) as ColorCycleSerializedState | null;
    const brushState = shouldCaptureBrushState
      ? captureColorCycleBrushState(layer.id)
      : existingBrushState;

    const canvasImageData = captured ?? existingColorCycleData.canvasImageData;
    const canvasWidth =
      existingColorCycleData.canvas?.width ??
      captured?.width ??
      existingColorCycleData.canvasWidth;
    const canvasHeight =
      existingColorCycleData.canvas?.height ??
      captured?.height ??
      existingColorCycleData.canvasHeight;
    const eraseMaskImageData =
      captureCanvasImageData(existingColorCycleData.eraseMask ?? null) ??
      existingColorCycleData.eraseMaskImageData;

    layerCopy.layerType = 'color-cycle';
    layerCopy.colorCycleData = {
      ...existingColorCycleData,
      hasContent: hasCCPixels,
      gradient: existingColorCycleData.gradient ? [...existingColorCycleData.gradient] : undefined,
      canvasImageData,
      canvasWidth,
      canvasHeight,
      eraseMaskImageData,
      brushState,
    } satisfies PersistedColorCycleData;
  }

  return layerCopy;
};

interface SnapshotFromStateOptions {
  actionType: CanvasSnapshot['actionType'];
  description: string;
  activeLayerId?: string;
  previousSnapshot?: CanvasSnapshot | null;
  isColorCycleTarget?: boolean;
  isColorCycleAction?: boolean;
}

interface SerializedColorCycleLayerSnapshot {
  layerId: string;
  data?: {
    indexBuffer?: {
      width: number;
      height: number;
      data?: ArrayBufferLike | Uint8Array;
      gradient?: {
        gradientStops?: Array<{ position: number; color: string }>;
      };
    };
    gradient?: {
      gradientStops?: Array<{ position: number; color: string }>;
    };
  };
  strokeData?: {
    paintBuffer?: ArrayBufferLike;
    hasContent?: boolean;
    strokeCounter?: number;
  };
}

interface SerializedColorCycleBrushState {
  layers?: SerializedColorCycleLayerSnapshot[];
  cycleSpeed?: number;
  fps?: number;
  brushSize?: number;
}

const isSerializedColorCycleBrushState = (value: unknown): value is SerializedColorCycleBrushState => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const maybeState = value as { layers?: unknown };
  if (maybeState.layers !== undefined && !Array.isArray(maybeState.layers)) {
    return false;
  }
  return true;
};

export const createHistorySnapshotFromState = (
  state: AppState,
  {
    actionType,
    description,
    activeLayerId,
    previousSnapshot = null,
    isColorCycleTarget = false,
    isColorCycleAction = false,
  }: SnapshotFromStateOptions
): CanvasSnapshot => {
  const resolvedActiveLayerId =
    activeLayerId ?? state.activeLayerId ?? state.layers[0]?.id ?? '';
  const previousLayersById = previousSnapshot
    ? new Map<string, LayerHistorySnapshot | Layer>(previousSnapshot.layers.map((layer) => [layer.id, layer]))
    : undefined;

  const contextOptions: CanvasRenderingContext2DSettings = { willReadFrequently: true };
  const layersCopy = (state.layers || []).map((layer) =>
    cloneLayerForHistory(layer, {
      actionType,
      description,
      activeLayerId: resolvedActiveLayerId,
      isColorCycleTarget,
      isColorCycleAction,
      previousLayersById,
      contextOptions,
    })
  );

  let colorCycleState: CanvasSnapshot['colorCycleState'] = undefined;
  const activeLayer = (state.layers || []).find((layer) => layer.id === state.activeLayerId);
  const brush = activeLayer?.colorCycleData?.colorCycleBrush;
  const rawState =
    brush?.serialize?.() ??
    brush?.getFullState?.() ??
    null;

  if (activeLayer && isSerializedColorCycleBrushState(rawState) && rawState.layers) {
    colorCycleState = {
      layerId: activeLayer.id,
      strokeData: new ArrayBuffer(0),
      gradients: [],
      animationState: {
        cycleOffset: 0,
        speed: 1,
        fps: 30,
        isPaused: false,
      },
      layerStrokes: rawState.layers.map((layerSnapshot) => {
        const indexBuffer = layerSnapshot.data?.indexBuffer;
        const indexSource = indexBuffer?.data;
        const indexArray = indexSource ? new Uint8Array(indexSource) : null;
        const hasNonZeroIndex = indexArray ? indexArray.some((value) => value !== 0) : false;

        const paintBufferSource = layerSnapshot.strokeData?.paintBuffer;
        const paintBufferArray = paintBufferSource ? new Uint8Array(paintBufferSource) : null;
        const paintBufferCopy = paintBufferArray ? paintBufferArray.slice().buffer : new ArrayBuffer(0);

        const animatorIndex = indexBuffer
          ? {
              width: indexBuffer.width,
              height: indexBuffer.height,
              data: (indexArray ? indexArray.slice() : new Uint8Array()).buffer,
              gradientStops: layerSnapshot.data?.gradient?.gradientStops || undefined,
            }
          : undefined;

        return {
          layerId: layerSnapshot.layerId,
          paintBuffer: paintBufferCopy,
          hasContent: Boolean(layerSnapshot.strokeData?.hasContent) || hasNonZeroIndex,
          strokeCounter: layerSnapshot.strokeData?.strokeCounter ?? 0,
          strokeLength: 0,
          gradientLayerIndices: [],
          currentGradientIndex: 0,
          animatorIndex,
        };
      }),
    };
  }

  const projectSize = resolveProjectSize(state.project);

  return {
    id: `snapshot_${Date.now()}_${Math.random()}`,
    timestamp: Date.now(),
    layers: layersCopy,
    activeLayerId: resolvedActiveLayerId,
    actionType,
    description,
    colorCycleState,
    projectSize,
    canvasState: state.canvas
      ? {
          canvasWidth: state.canvas.canvasWidth,
          canvasHeight: state.canvas.canvasHeight,
          offsetX: state.canvas.offsetX,
          offsetY: state.canvas.offsetY,
          zoom: state.canvas.zoom,
        }
      : undefined,
  };
};

const resolveProjectSize = (project: Project | null): CanvasSnapshot['projectSize'] => {
  if (!project) {
    return undefined;
  }
  return {
    width: project.width,
    height: project.height,
  };
};

export interface HistoryServiceOptions {
  set: StoreSet;
  get: StoreGet;
  runWithColorCycleSuspended: <T>(reason: CCReason, fn: () => T | Promise<T>) => Promise<T>;
}

export interface HistoryService {
  undo: () => Promise<CanvasSnapshot | null>;
  redo: () => Promise<CanvasSnapshot | null>;
  canUndo: () => boolean;
  canRedo: () => boolean;
  clearHistory: () => void;
}

export const createHistoryService = ({
  set,
  get,
  runWithColorCycleSuspended,
}: HistoryServiceOptions): HistoryService => {
  const undo = async (): Promise<CanvasSnapshot | null> => {
    return runWithColorCycleSuspended('history-apply', async () => {
      await flushPendingToolWork();

      const pendingEntry = historyManager.peekUndo();
      if (!pendingEntry) {
        return null;
      }

      const hasLegacySnapshot = pendingEntry.deltas.some((delta) => isLegacySnapshotDelta(delta));
      const requiresComposite = entryRequiresComposite(pendingEntry);
      let currentSnapshot: CanvasSnapshot | null = null;
      let previousSnapshot: CanvasSnapshot | null = null;

      if (hasLegacySnapshot) {
        const snapshotState = get();
        if (snapshotState.history.undoStack.length <= 1) {
          return null;
        }

        currentSnapshot =
          snapshotState.history.undoStack[snapshotState.history.undoStack.length - 1] ?? null;
        previousSnapshot =
          snapshotState.history.undoStack[snapshotState.history.undoStack.length - 2] ?? null;
      }

      const pendingLayerId =
        typeof pendingEntry.meta?.['layerId'] === 'string'
          ? (pendingEntry.meta['layerId'] as string)
          : null;

      if (pendingLayerId) {
        await waitForFinalizeQueueIdle(pendingLayerId);
        await waitForPendingColorCycleSaves(pendingLayerId);
      } else {
        await waitForFinalizeQueueIdle();
      }

      await historyManager.undo();

      set((state) => {
        const nextHistory = {
          ...state.history,
          isCapturing: false,
        };

        if (hasLegacySnapshot && currentSnapshot) {
          nextHistory.undoStack = state.history.undoStack.slice(0, -1);
          nextHistory.redoStack = [currentSnapshot, ...state.history.redoStack];
        }

        return {
          history: nextHistory,
        };
      });

      if (requiresComposite) {
        get().setLayersNeedRecomposition(true);
      }

      return previousSnapshot;
    });
  };

  const redo = async (): Promise<CanvasSnapshot | null> => {
    return runWithColorCycleSuspended('history-apply', async () => {
      await flushPendingToolWork();

      const pendingEntry = historyManager.peekRedo();
      if (!pendingEntry) {
        return null;
      }

      const hasLegacySnapshot = pendingEntry.deltas.some((delta) => isLegacySnapshotDelta(delta));
      const requiresComposite = entryRequiresComposite(pendingEntry);
      let stateToRestore: CanvasSnapshot | null = null;

      if (hasLegacySnapshot) {
        const snapshotState = get();
        if (snapshotState.history.redoStack.length === 0) {
          return null;
        }
        stateToRestore = snapshotState.history.redoStack[0] ?? null;
      }

      const pendingLayerId =
        typeof pendingEntry.meta?.['layerId'] === 'string'
          ? (pendingEntry.meta['layerId'] as string)
          : null;

      if (pendingLayerId) {
        await waitForFinalizeQueueIdle(pendingLayerId);
        await waitForPendingColorCycleSaves(pendingLayerId);
      } else {
        await waitForFinalizeQueueIdle();
      }

      await historyManager.redo();

      set((state) => {
        const nextHistory = {
          ...state.history,
          isCapturing: false,
        };

        if (hasLegacySnapshot && stateToRestore) {
          nextHistory.redoStack = state.history.redoStack.slice(1);
          nextHistory.undoStack = [...state.history.undoStack, stateToRestore];
        }

        return {
          history: nextHistory,
        };
      });

      if (requiresComposite) {
        get().setLayersNeedRecomposition(true);
      }

      return stateToRestore;
    });
  };

  const canUndo = (): boolean => Boolean(historyManager.peekUndo());
  const canRedo = (): boolean => Boolean(historyManager.peekRedo());

  const clearHistory = (): void => {
    historyManager.clear();
    set((state) => ({
      history: {
        ...state.history,
        undoStack: [],
        redoStack: [],
      },
    }));
  };

  return {
    undo,
    redo,
    canUndo,
    canRedo,
    clearHistory,
  };
};
