import historyManager from '@/history/historyService';
import { createBitmapTileDelta } from '@/history/deltas/bitmapDelta';
import { createColorCycleStrokePatchDelta } from '@/history/deltas/colorCycleStrokePatchDelta';
import { mapCanvasActionToHistoryId } from './actions';
import { captureColorCycleBrushState, type ColorCycleSerializedState } from './colorCycle';
import type { ColorCycleBrushImplementation } from '@/hooks/brushEngine/ColorCycleBrushMigration';
import type { HistoryDelta } from '@/history/actionTypes';
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
  const state = useAppStore.getState();
  if (state.markAutosaveDirty) {
    state.markAutosaveDirty('history-change');
  }
};

const normalizeInflatedRoi = (
  roi: { x: number; y: number; width: number; height: number } | null | undefined,
  width: number,
  height: number,
  padding = 2
): { x: number; y: number; width: number; height: number } | null => {
  if (!roi || width <= 0 || height <= 0) {
    return null;
  }
  const x0 = Math.floor(roi.x);
  const y0 = Math.floor(roi.y);
  const right0 = Math.ceil(roi.x + roi.width);
  const bottom0 = Math.ceil(roi.y + roi.height);
  if (right0 <= x0 || bottom0 <= y0) {
    return null;
  }

  const x = Math.max(0, x0 - padding);
  const y = Math.max(0, y0 - padding);
  const right = Math.min(width, right0 + padding);
  const bottom = Math.min(height, bottom0 + padding);
  const w = right - x;
  const h = bottom - y;
  if (w <= 0 || h <= 0) {
    return null;
  }
  return { x, y, width: w, height: h };
};

const bufferToU8 = (
  buffer: ArrayBuffer | ArrayBufferView | { buffer?: ArrayBuffer | SharedArrayBuffer } | null | undefined
): Uint8Array | null => {
  if (!buffer) {
    return null;
  }
  if (buffer instanceof ArrayBuffer) {
    return new Uint8Array(buffer);
  }
  if (ArrayBuffer.isView(buffer)) {
    return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }
  if (typeof buffer === 'object' && 'buffer' in buffer && buffer.buffer instanceof ArrayBuffer) {
    return new Uint8Array(buffer.buffer);
  }
  return null;
};

const findDiffBounds = (
  beforeBytes: Uint8Array,
  afterBytes: Uint8Array,
  width: number,
  height: number,
  stride: number
): { minX: number; minY: number; maxX: number; maxY: number } | null => {
  const step = Math.max(1, Math.floor(stride));
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += step) {
    const row = y * width;
    for (let x = 0; x < width; x += step) {
      const idx = row + x;
      if (beforeBytes[idx] !== afterBytes[idx]) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0 || maxY < 0) {
    return null;
  }
  return { minX, minY, maxX, maxY };
};

export const inferFallbackRoiFromStateDiff = (
  before: ColorCycleSerializedState,
  after: ColorCycleSerializedState,
  width: number,
  height: number,
  stride = 16
): { x: number; y: number; width: number; height: number } | null => {
  if (!before || !after || width <= 0 || height <= 0) {
    return null;
  }
  const beforeLayer = before.layers?.[0];
  const afterLayer = after.layers?.[0];
  const beforeBytes = bufferToU8(beforeLayer?.strokeData?.paintBuffer ?? null);
  const afterBytes = bufferToU8(afterLayer?.strokeData?.paintBuffer ?? null);
  if (!beforeBytes || !afterBytes) {
    return null;
  }

  const minStride = Math.max(1, Math.floor(stride));
  let bounds = findDiffBounds(beforeBytes, afterBytes, width, height, minStride);
  let padStride = minStride;
  if (!bounds && minStride > 1) {
    bounds = findDiffBounds(beforeBytes, afterBytes, width, height, 1);
    padStride = 1;
  }

  if (!bounds) {
    return null;
  }

  const pad = Math.max(2, padStride * 2);
  const x = Math.max(0, bounds.minX - pad);
  const y = Math.max(0, bounds.minY - pad);
  const right = Math.min(width, bounds.maxX + pad);
  const bottom = Math.min(height, bounds.maxY + pad);
  const roiWidth = Math.max(1, right - x);
  const roiHeight = Math.max(1, bottom - y);
  return { x, y, width: roiWidth, height: roiHeight };
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
    const projectWidth =
      afterState.project?.width ??
      refreshedLayer.imageData?.width ??
      refreshedLayer.colorCycleData?.canvas?.width ??
      0;
    const projectHeight =
      afterState.project?.height ??
      refreshedLayer.imageData?.height ??
      refreshedLayer.colorCycleData?.canvas?.height ??
      0;
    const normalizedColorCycleRoi = normalizeInflatedRoi(
      bitmapRoi ?? null,
      projectWidth,
      projectHeight,
      2,
    );

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
    const pushDelta = (d: HistoryDelta | null | undefined): void => {
      if (!d) {
        return;
      }
      txn.push(d);
      deltaCount += 1;
    };

    try {
      const skipBitmap = skipBitmapDelta === true;

      if (afterImage && !skipBitmap && !isColorCycleLayer) {
        const bitmapDelta = await createBitmapTileDelta({
          layerId,
          before: beforeImage,
          after: afterImage,
          roi: bitmapRoi ?? undefined,
        });
        pushDelta(bitmapDelta);
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
        const inferredRoi = inferFallbackRoiFromStateDiff(
          beforeColorState,
          afterColorState,
          projectWidth,
          projectHeight
        );
        const colorCycleRoi =
          normalizedColorCycleRoi ??
          inferredRoi ??
          (projectWidth > 0 && projectHeight > 0
            ? { x: 0, y: 0, width: projectWidth, height: projectHeight }
            : null);
        const patchDelta = colorCycleRoi
          ? await createColorCycleStrokePatchDelta({
              layerId,
              forwardState: afterColorState,
              backwardState: beforeColorState,
              roi: colorCycleRoi,
              width: projectWidth,
              height: projectHeight,
            })
          : null;
        pushDelta(patchDelta);
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
        pushDelta(selectionDelta);
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
