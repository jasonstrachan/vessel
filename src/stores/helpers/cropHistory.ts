import type { ScopedTxn } from '@/history/actionTypes';
import { createBitmapTileDelta } from '@/history/deltas/bitmapDelta';
import { createColorCycleStrokeDelta } from '@/history/deltas/colorCycleStrokeDelta';
import { createColorCycleEraseMaskDelta } from '@/history/deltas/colorCycleEraseMaskDelta';
import { createColorCycleSoftEdgeMaskDelta } from '@/history/deltas/colorCycleSoftEdgeMaskDelta';
import { cloneSequentialLayerData, createSequentialFrameDelta } from '@/history/deltas/sequentialFrameDelta';
import { createProjectDimensionsDelta } from '@/history/deltas/projectDimensionsDelta';
import { createSelectionDelta } from '@/history/deltas/selectionDelta';
import { cloneTxtShapes, createTxtShapeDelta } from '@/history/deltas/txtShapeDelta';
import { createUiShapeDelta } from '@/history/deltas/uiShapeDelta';
import {
  captureColorCycleBrushState,
  type ColorCycleSerializedState,
} from '@/history/helpers/colorCycle';
import { cloneLayerImageData } from '@/history/helpers/layerHistory';
import {
  selectionSnapshotFromState,
  type SelectionSnapshot,
} from '@/history/selectionState';
import { ResizeLayerDelta } from '@/stores/helpers/resizeHistory';
import { cloneRecolorSettings, createRecolorDelta } from '@/history/deltas/recolorDelta';
import type { Layer, Project, TxtShape, UiShape } from '@/types';
import { cloneUiShapes } from '@/utils/uiShape';
import { cloneCropAlignment, cloneCropProjectGeometry, createCropGeometryDelta, type CropProjectGeometry } from '@/history/deltas/cropGeometryDelta';

export type ProjectSizeSnapshot = CropProjectGeometry;

export interface CropLayerSnapshot {
  image: ImageData | null;
  colorState: ColorCycleSerializedState | null;
  sequentialData?: Layer['sequentialData'];
  recolorSettings?: NonNullable<Layer['colorCycleData']>['recolorSettings'];
  alignment?: Layer['alignment'];
}

export type CropLayerSnapshotMap = Map<string, CropLayerSnapshot>;

export interface CropHistoryBaseline {
  projectSize: ProjectSizeSnapshot | null;
  layerSnapshots: CropLayerSnapshotMap;
  selectionSnapshot: SelectionSnapshot;
  txtShapes: TxtShape[];
  uiShapes: UiShape[];
}

interface CaptureCropHistoryBaselineArgs {
  project: Project | null;
  layers: Layer[];
  selectionState: Parameters<typeof selectionSnapshotFromState>[0];
}

export const captureCropHistoryBaseline = ({
  project,
  layers,
  selectionState,
}: CaptureCropHistoryBaselineArgs): CropHistoryBaseline => {
  const projectSize = project
    ? cloneCropProjectGeometry(project)
    : null;

  const layerSnapshots: CropLayerSnapshotMap = new Map();
  layers.forEach((layer) => {
    layerSnapshots.set(layer.id, {
      image: cloneLayerImageData(layer.imageData),
      alignment: cloneCropAlignment(layer.alignment),
      sequentialData: layer.sequentialData ? cloneSequentialLayerData(layer.sequentialData) : undefined,
      recolorSettings: cloneRecolorSettings(layer.colorCycleData?.recolorSettings),
      colorState:
        layer.layerType === 'color-cycle'
          ? captureColorCycleBrushState(layer.id)
          : null,
    });
  });

  const selectionSnapshot = selectionSnapshotFromState(selectionState);

  return {
    projectSize,
    layerSnapshots,
    selectionSnapshot,
    txtShapes: cloneTxtShapes(project?.txtShapes ?? []),
    uiShapes: cloneUiShapes(project?.uiShapes ?? []),
  };
};

export interface RecordCropHistoryArgs {
  txn: ScopedTxn;
  beforeProject: ProjectSizeSnapshot | null;
  afterProject: ProjectSizeSnapshot | null;
  beforeLayers: CropLayerSnapshotMap;
  afterLayers: Layer[];
  beforeTxtShapes: readonly TxtShape[];
  afterTxtShapes: readonly TxtShape[];
  beforeUiShapes: readonly UiShape[];
  afterUiShapes: readonly UiShape[];
  beforeSelection: SelectionSnapshot;
  afterSelection: SelectionSnapshot;
  description: string;
}

export const recordCropHistory = async ({
  txn,
  beforeProject,
  afterProject,
  beforeLayers,
  afterLayers,
  beforeTxtShapes,
  afterTxtShapes,
  beforeUiShapes,
  afterUiShapes,
  beforeSelection,
  afterSelection,
  description,
}: RecordCropHistoryArgs): Promise<void> => {
  let deltaCount = 0;

  try {
    for (const layer of afterLayers) {
      const baseline = beforeLayers.get(layer.id) ?? {
        image: null,
        colorState: null,
      };
      const afterColor = layer.layerType === 'color-cycle' ? captureColorCycleBrushState(layer.id) : null;
      const afterImage = cloneLayerImageData(layer.imageData);
      const beforeDimensions = baseline.image ?? beforeProject;
      const afterDimensions = afterImage ?? afterProject;
      const dimensionsChanged = beforeDimensions && afterDimensions && (
        beforeDimensions.width !== afterDimensions.width || beforeDimensions.height !== afterDimensions.height
      );
      const presenceChanged = Boolean(baseline.image) !== Boolean(afterImage);
      const useWholeImage = dimensionsChanged || presenceChanged;
      const bitmapDelta = useWholeImage
        ? new ResizeLayerDelta(
            layer.id,
            baseline.image,
            afterImage,
            Boolean(afterColor && baseline.colorState),
            beforeDimensions && afterDimensions ? {
              before: { width: beforeDimensions.width, height: beforeDimensions.height },
              after: { width: afterDimensions.width, height: afterDimensions.height },
            } : undefined,
          )
        : await createBitmapTileDelta({
            layerId: layer.id,
            before: baseline.image,
            after: afterImage,
          });
      if (bitmapDelta) {
        txn.push(bitmapDelta);
        deltaCount += 1;
      }

      if (layer.layerType === 'color-cycle' || baseline.colorState) {
        const colorDelta = await createColorCycleStrokeDelta({
          layerId: layer.id,
          forwardState: afterColor,
          backwardState: baseline.colorState,
          beforeDimensions: beforeProject ?? undefined,
          afterDimensions: afterProject ?? undefined,
        });
        if (colorDelta) {
          txn.push(colorDelta);
          deltaCount += 1;
        }
        const maskOptions = {
          layerId: layer.id,
          forwardState: afterColor,
          backwardState: baseline.colorState,
        };
        for (const maskDelta of [
          createColorCycleEraseMaskDelta(maskOptions),
          createColorCycleSoftEdgeMaskDelta(maskOptions),
        ]) {
          if (maskDelta) {
            txn.push(maskDelta);
            deltaCount += 1;
          }
        }
      }
      if (baseline.sequentialData && layer.sequentialData) {
        txn.push(createSequentialFrameDelta({
          layerId: layer.id,
          before: baseline.sequentialData,
          after: layer.sequentialData,
        }));
        deltaCount += 1;
      }
      const recolorDelta = createRecolorDelta({
        layerId: layer.id,
        before: baseline.recolorSettings,
        after: layer.colorCycleData?.recolorSettings,
      });
      if (recolorDelta) {
        txn.push(recolorDelta);
        deltaCount += 1;
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

    const txtShapeDelta = createTxtShapeDelta({
      before: beforeTxtShapes,
      after: afterTxtShapes,
    });
    if (txtShapeDelta) {
      txn.push(txtShapeDelta);
      deltaCount += 1;
    }

    const uiShapeDelta = createUiShapeDelta({
      before: beforeUiShapes,
      after: afterUiShapes,
    });
    if (uiShapeDelta) {
      txn.push(uiShapeDelta);
      deltaCount += 1;
    }

    const selectionDelta = createSelectionDelta({ before: beforeSelection, after: afterSelection });
    if (selectionDelta) {
      txn.push(selectionDelta);
      deltaCount += 1;
    }

    if (deltaCount > 0) {
      if (beforeProject && afterProject) {
        txn.push(createCropGeometryDelta({
          project: beforeProject,
          alignments: new Map([...beforeLayers].flatMap(([id, layer]) =>
            layer.alignment ? [[id, layer.alignment] as const] : [])),
        }, {
          project: afterProject,
          alignments: new Map(afterLayers.map((layer) => [layer.id, layer.alignment])),
        }));
      }
      txn.commit(description);
    } else {
      txn.cancel();
    }
  } catch (error) {
    txn.cancel();
    throw error;
  }
};
