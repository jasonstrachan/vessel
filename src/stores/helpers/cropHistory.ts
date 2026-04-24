import { debugWarn } from '@/utils/debug';
import historyManager from '@/history/historyService';
import { mapCanvasActionToHistoryId } from '@/history/helpers/actions';
import { createBitmapTileDelta } from '@/history/deltas/bitmapDelta';
import { createColorCycleStrokePatchDelta } from '@/history/deltas/colorCycleStrokePatchDelta';
import { createProjectDimensionsDelta } from '@/history/deltas/projectDimensionsDelta';
import {
  captureColorCycleBrushState,
  type ColorCycleSerializedState,
} from '@/history/helpers/colorCycle';
import { cloneLayerImageData } from '@/history/helpers/layerHistory';
import {
  selectionSnapshotFromValues,
  type SelectionSnapshot,
} from '@/history/selectionState';
import { commitSelectionHistory } from '@/history/helpers/selectionHistory';
import type { Layer, Project } from '@/types';

export type ProjectSizeSnapshot = { width: number; height: number };

export interface CropLayerSnapshot {
  image: ImageData | null;
  colorState: ColorCycleSerializedState | null;
}

export type CropLayerSnapshotMap = Map<string, CropLayerSnapshot>;

export interface CropHistoryBaseline {
  projectSize: ProjectSizeSnapshot | null;
  layerSnapshots: CropLayerSnapshotMap;
  selectionSnapshot: SelectionSnapshot;
}

interface CaptureCropHistoryBaselineArgs {
  project: Project | null;
  layers: Layer[];
  selectionStart: { x: number; y: number } | null;
  selectionEnd: { x: number; y: number } | null;
}

export const captureCropHistoryBaseline = ({
  project,
  layers,
  selectionStart,
  selectionEnd,
}: CaptureCropHistoryBaselineArgs): CropHistoryBaseline => {
  const projectSize = project
    ? {
        width: project.width,
        height: project.height,
      }
    : null;

  const layerSnapshots: CropLayerSnapshotMap = new Map();
  layers.forEach((layer) => {
    layerSnapshots.set(layer.id, {
      image: cloneLayerImageData(layer.imageData),
      colorState:
        layer.layerType === 'color-cycle'
          ? captureColorCycleBrushState(layer.id)
          : null,
    });
  });

  const selectionSnapshot = selectionSnapshotFromValues(selectionStart, selectionEnd);

  return {
    projectSize,
    layerSnapshots,
    selectionSnapshot,
  };
};

export interface RecordCropHistoryArgs {
  beforeProject: ProjectSizeSnapshot | null;
  afterProject: ProjectSizeSnapshot | null;
  beforeLayers: CropLayerSnapshotMap;
  afterLayers: Layer[];
  description: string;
}

export const recordCropHistory = async ({
  beforeProject,
  afterProject,
  beforeLayers,
  afterLayers,
  description,
}: RecordCropHistoryArgs): Promise<void> => {
  let deltaCount = 0;
  const txn = historyManager.begin(mapCanvasActionToHistoryId('crop'), {
    description,
  });

  try {
    for (const layer of afterLayers) {
      const baseline = beforeLayers.get(layer.id) ?? {
        image: null,
        colorState: null,
      };
      const afterImage = cloneLayerImageData(layer.imageData);
      const bitmapDelta = await createBitmapTileDelta({
        layerId: layer.id,
        before: baseline.image,
        after: afterImage,
      });
      if (bitmapDelta) {
        txn.push(bitmapDelta);
        deltaCount += 1;
      }

      if (layer.layerType === 'color-cycle' || baseline.colorState) {
        const afterColor = captureColorCycleBrushState(layer.id);
        const width = afterProject?.width ?? layer.imageData?.width ?? 0;
        const height = afterProject?.height ?? layer.imageData?.height ?? 0;
        const roi =
          width > 0 && height > 0
            ? { x: 0, y: 0, width, height }
            : null;
        const patchDelta = roi
          ? await createColorCycleStrokePatchDelta({
              layerId: layer.id,
              forwardState: afterColor,
              backwardState: baseline.colorState ?? null,
              roi,
              width,
              height,
            })
          : null;
        if (patchDelta) {
          txn.push(patchDelta);
          deltaCount += 1;
        }
      }
    }

    if (
      beforeProject &&
      afterProject &&
      (beforeProject.width !== afterProject.width ||
        beforeProject.height !== afterProject.height)
    ) {
      txn.push(
        createProjectDimensionsDelta({
          before: beforeProject,
          after: afterProject,
        }),
      );
      deltaCount += 1;
    }

    if (deltaCount > 0) {
      txn.commit(description);
    } else {
      txn.cancel();
    }
  } catch (error) {
    txn.cancel();
    if (process.env.NODE_ENV !== 'production') {
      debugWarn('raw-console', '[history] Failed to record crop history', error);
    }
  }
};

interface RecordCropSelectionHistoryArgs {
  before: SelectionSnapshot;
  after: SelectionSnapshot;
  description?: string;
}

export const recordCropSelectionHistory = ({
  before,
  after,
  description = 'Crop selection reset',
}: RecordCropSelectionHistoryArgs): void => {
  commitSelectionHistory({
    before,
    after,
    description,
    meta: { action: 'crop' },
  });
};

export const selectionSnapshotFromCropState = (
  selectionStart: { x: number; y: number } | null,
  selectionEnd: { x: number; y: number } | null,
): SelectionSnapshot => selectionSnapshotFromValues(selectionStart, selectionEnd);
