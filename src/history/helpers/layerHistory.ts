import historyManager from '@/history/historyService';
import { createBitmapTileDelta } from '@/history/deltas/bitmapDelta';
import { createColorCycleStrokeDelta } from '@/history/deltas/colorCycleStrokeDelta';
import { mapCanvasActionToHistoryId } from './actions';
import { captureColorCycleBrushState, type ColorCycleSerializedState } from './colorCycle';
import type { ColorCycleBrushImplementation } from '@/hooks/brushEngine/ColorCycleBrushMigration';
import type { CanvasSnapshot } from '@/types';
import { CC_DEBUG } from '@/debug/ccDebug';
import { useAppStore } from '@/stores/useAppStore';
import { createSelectionDelta } from '@/history/deltas/selectionDelta';
import { getColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import { timeAsync } from '@/utils/perf/ccPerfProbe';
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
  afterColorState?: ColorCycleSerializedState | null;
  bitmapRoi?: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
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
  skipBitmapDelta?: boolean;
}

type BrushWithOptionalFlush = ColorCycleBrushImplementation & {
  flush?: (layerId: string) => void;
};

export const commitLayerHistory = async ({
  layerId,
  beforeImage,
  beforeColorState,
  afterColorState: afterColorStateOverride,
  actionType,
  description,
  tool,
  coalesce,
  selectionBefore,
  skipBitmapDelta,
  bitmapRoi,
}: LayerHistoryPayload): Promise<void> =>
  timeAsync('commitLayerHistory', async () => {
    const afterState = useAppStore.getState();
    const refreshedLayer = afterState.layers.find((layer) => layer.id === layerId) ?? null;
    if (!refreshedLayer) {
      return;
    }
    const isColorCycleLayer = refreshedLayer.layerType === 'color-cycle';

    const refreshedImageData = refreshedLayer.imageData ?? null;
    const shouldCaptureBitmap = !skipBitmapDelta && !isColorCycleLayer && Boolean(refreshedImageData);
    const afterImage = shouldCaptureBitmap ? refreshedImageData : null;

    if (isColorCycleLayer) {
      const manager = getColorCycleBrushManager();
      const brush = manager.getBrush(layerId) as BrushWithOptionalFlush | undefined;
      brush?.flush?.(layerId);
    }

    const afterColorState =
      isColorCycleLayer
        ? (afterColorStateOverride ?? captureColorCycleBrushState(refreshedLayer.id))
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

    const txn = historyManager.begin(
      historyId,
      meta,
      undefined,
      coalesce
        ? {
            coalesce: {
              key: coalesce.key,
              maxIntervalMs: coalesce.maxIntervalMs,
              mergeLabel: coalesce.mergeLabel,
            },
          }
        : undefined,
    );
    let deltaCount = 0;
    let committed = false;

    try {
      const skipBitmap = skipBitmapDelta === true;

      if (afterImage && !skipBitmap && !isColorCycleLayer) {
        const bitmapDelta = await createBitmapTileDelta({
          layerId,
          before: beforeImage,
          after: afterImage,
          roi: bitmapRoi ?? undefined,
        });
        if (bitmapDelta) {
          txn.push(bitmapDelta);
          deltaCount += 1;
        }
      }

      if (afterColorState || beforeColorState) {
        if (CC_DEBUG.on) {
          console.debug('[cc-delta-capture]', {
            beforeBytes: beforeColorState?.layers?.[0]?.strokeData?.paintBuffer?.byteLength ?? -1,
            afterBytes: afterColorState?.layers?.[0]?.strokeData?.paintBuffer?.byteLength ?? -1,
            beforeCtr: beforeColorState?.layers?.[0]?.strokeData?.strokeCounter ?? -1,
            afterCtr: afterColorState?.layers?.[0]?.strokeData?.strokeCounter ?? -1,
          });
        }
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
        committed = true;
      } else {
        txn.cancel();
      }
    } catch (error) {
      txn.cancel();
      throw error;
    } finally {
      if (committed) {
        markUnsavedChanges();
      }
    }
  });

export const cloneLayerImageData = cloneImageData;
