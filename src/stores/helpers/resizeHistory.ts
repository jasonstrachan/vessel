import historyManager from '@/history/historyService';
import { createColorCycleStrokePatchDelta } from '@/history/deltas/colorCycleStrokePatchDelta';
import { createProjectDimensionsDelta } from '@/history/deltas/projectDimensionsDelta';
import {
  captureColorCycleBrushState,
  type ColorCycleSerializedState,
} from '@/history/helpers/colorCycle';
import { cloneLayerImageData } from '@/history/helpers/layerHistory';
import { useAppStore } from '@/stores/useAppStore';
import type { HistoryDelta, HistoryDirection } from '@/history/actionTypes';
import type { Layer, Project } from '@/types';

export type ResizeProjectSizeSnapshot = { width: number; height: number };

export interface ResizeLayerSnapshot {
  image: ImageData | null;
  colorState: ColorCycleSerializedState | null;
}

export type ResizeLayerSnapshotMap = Map<string, ResizeLayerSnapshot>;

export interface ResizeHistoryBaseline {
  projectSize: ResizeProjectSizeSnapshot | null;
  layerSnapshots: ResizeLayerSnapshotMap;
}

class ResizeLayerDelta implements HistoryDelta {
  readonly _tag = 'resize-layer';
  readonly approxBytes: number;

  constructor(
    private readonly layerId: string,
    private readonly beforeImage: ImageData | null,
    private readonly afterImage: ImageData | null,
  ) {
    this.approxBytes =
      (beforeImage?.data.byteLength ?? 0) + (afterImage?.data.byteLength ?? 0);
  }

  apply(direction: HistoryDirection): void {
    const targetImage = direction === 'forward' ? this.afterImage : this.beforeImage;

    useAppStore.setState((state) => {
      const updatedLayers = state.layers.map((layer) => {
        if (layer.id !== this.layerId) {
          return layer;
        }

        const framebuffer = layer.framebuffer;
        if (framebuffer && targetImage) {
          framebuffer.width = targetImage.width;
          framebuffer.height = targetImage.height;
          const ctx = framebuffer.getContext(
            '2d',
            { willReadFrequently: true } as CanvasRenderingContext2DSettings
          ) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
          ctx?.clearRect(0, 0, framebuffer.width, framebuffer.height);
          ctx?.putImageData(targetImage, 0, 0);
        }

        return {
          ...layer,
          imageData: targetImage ? cloneLayerImageData(targetImage) : null,
          version: (layer.version ?? 0) + 1,
        };
      });

      return {
        layers: updatedLayers,
      };
    });

    useAppStore.getState().setLayersNeedRecomposition(true);
  }
}

export const captureResizeHistoryBaseline = ({
  project,
  layers,
}: {
  project: Project | null;
  layers: Layer[];
}): ResizeHistoryBaseline => {
  const projectSize = project
    ? {
        width: project.width,
        height: project.height,
      }
    : null;

  const layerSnapshots: ResizeLayerSnapshotMap = new Map();
  layers.forEach((layer) => {
    layerSnapshots.set(layer.id, {
      image: cloneLayerImageData(layer.imageData),
      colorState:
        layer.layerType === 'color-cycle'
          ? captureColorCycleBrushState(layer.id)
          : null,
    });
  });

  return {
    projectSize,
    layerSnapshots,
  };
};

export const recordResizeHistory = async ({
  beforeProject,
  afterProject,
  beforeLayers,
  afterLayers,
  description,
}: {
  beforeProject: ResizeProjectSizeSnapshot | null;
  afterProject: ResizeProjectSizeSnapshot | null;
  beforeLayers: ResizeLayerSnapshotMap;
  afterLayers: Layer[];
  description: string;
}): Promise<void> => {
  if (historyManager.isReplaying) {
    return;
  }

  let deltaCount = 0;
  const txn = historyManager.begin('project-transform', {
    description,
  });

  try {
    for (const layer of afterLayers) {
      const baseline = beforeLayers.get(layer.id) ?? {
        image: null,
        colorState: null,
      };
      const afterImage = cloneLayerImageData(layer.imageData);
      if (baseline.image || afterImage) {
        txn.push(new ResizeLayerDelta(layer.id, baseline.image, afterImage));
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
        if (roi) {
          const patchDelta = await createColorCycleStrokePatchDelta({
            layerId: layer.id,
            forwardState: afterColor,
            backwardState: baseline.colorState ?? null,
            roi,
            width,
            height,
          });
          if (patchDelta) {
            txn.push(patchDelta);
            deltaCount += 1;
          }
        }
      }
    }

    if (
      beforeProject &&
      afterProject &&
      (beforeProject.width !== afterProject.width || beforeProject.height !== afterProject.height)
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
      console.warn('[history] Failed to record resize history', error);
    }
  }
};
