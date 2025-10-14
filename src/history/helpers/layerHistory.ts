import historyManager from '@/history/historyService';
import { createBitmapTileDelta } from '@/history/deltas/bitmapDelta';
import { createColorCycleStrokeDelta } from '@/history/deltas/colorCycleStrokeDelta';
import { mapCanvasActionToHistoryId } from './actions';
import { captureColorCycleBrushState, type ColorCycleSerializedState } from './colorCycle';
import type { CanvasSnapshot } from '@/types';
import { useAppStore } from '@/stores/useAppStore';
import { createSelectionDelta } from '@/history/deltas/selectionDelta';
import {
  cloneSelectionSnapshot,
  selectionSnapshotFromValues,
  type SelectionSnapshot,
} from '@/history/selectionState';

const cloneImageData = (imageData: ImageData | null | undefined): ImageData | null => {
  if (!imageData) {
    return null;
  }
  return new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
};

const markUnsavedChanges = (): void => {
  useAppStore.setState((state) => ({
    autosave: {
      ...state.autosave,
      hasUnsavedChanges: true,
      lastSaveTime: new Date(),
    },
  }));
};

export interface LayerHistoryPayload {
  layerId: string;
  beforeImage: ImageData | null;
  beforeColorState: ColorCycleSerializedState;
  actionType: CanvasSnapshot['actionType'];
  description: string;
  tool: string;
  coalesce?: {
    key: string;
    maxIntervalMs?: number;
    mergeLabel?: boolean;
    pointerSession?: {
      pointerId: number | string;
      startedAt: number;
      endedAt?: number;
    };
  };
  selectionBefore?: SelectionSnapshot | null;
}

export const commitLayerHistory = async ({
  layerId,
  beforeImage,
  beforeColorState,
  actionType,
  description,
  tool,
  coalesce,
  selectionBefore,
}: LayerHistoryPayload): Promise<void> => {
  const afterState = useAppStore.getState();
  const refreshedLayer = afterState.layers.find((layer) => layer.id === layerId) ?? null;
  if (!refreshedLayer) {
    return;
  }

  const afterImage = cloneImageData(refreshedLayer.imageData);
  const afterColorState =
    refreshedLayer.layerType === 'color-cycle'
      ? captureColorCycleBrushState(refreshedLayer.id)
      : null;

  const historyId = mapCanvasActionToHistoryId(actionType);
  const meta: Record<string, unknown> = {
    layerId,
    tool,
  };

  if (coalesce) {
    meta.coalesceKey = coalesce.key;
    if (coalesce.pointerSession) {
      meta.pointerSession = {
        pointerId: coalesce.pointerSession.pointerId,
        startedAt: coalesce.pointerSession.startedAt,
        endedAt: coalesce.pointerSession.endedAt,
      };
    }
  }

  const selectionBeforeSnapshot = selectionBefore
    ? cloneSelectionSnapshot(selectionBefore)
    : null;

  const txn = historyManager.begin(historyId, meta, undefined, coalesce ? {
    coalesce: {
      key: coalesce.key,
      maxIntervalMs: coalesce.maxIntervalMs,
      mergeLabel: coalesce.mergeLabel,
    },
  } : undefined);
  let deltaCount = 0;

  if (afterImage) {
    const bitmapDelta = await createBitmapTileDelta({
      layerId,
      before: beforeImage,
      after: afterImage,
    });
    if (bitmapDelta) {
      txn.push(bitmapDelta);
      deltaCount += 1;
    }
  }

  if (afterColorState || beforeColorState) {
    const colorDelta = createColorCycleStrokeDelta({
      layerId,
      forwardState: afterColorState,
      backwardState: beforeColorState,
    });
    if (colorDelta) {
      txn.push(colorDelta);
      deltaCount += 1;
    }
  }

  if (selectionBeforeSnapshot) {
    const selectionAfterSnapshot = selectionSnapshotFromValues(
      afterState.selectionStart,
      afterState.selectionEnd,
    );
    const selectionDelta = createSelectionDelta({
      before: selectionBeforeSnapshot,
      after: selectionAfterSnapshot,
    });
    if (selectionDelta) {
      txn.push(selectionDelta);
      deltaCount += 1;
    }
  }

  if (deltaCount > 0) {
    txn.commit(description);
    markUnsavedChanges();
  } else {
    txn.cancel();
  }
};

export const cloneLayerImageData = cloneImageData;
