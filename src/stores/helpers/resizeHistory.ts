import { debugWarn } from '@/utils/debug';
import historyManager from '@/history/historyService';
import { createColorCycleStrokeDelta } from '@/history/deltas/colorCycleStrokeDelta';
import { createProjectDimensionsDelta } from '@/history/deltas/projectDimensionsDelta';
import {
  captureColorCycleBrushState,
  type ColorCycleSerializedState,
} from '@/history/helpers/colorCycle';
import { cloneLayerImageData } from '@/history/helpers/layerHistory';
import { useAppStore } from '@/stores/useAppStore';
import type { HistoryDelta, HistoryDirection, PreparedHistoryDelta } from '@/history/actionTypes';
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
    private readonly preserveColorCycleFramebuffer: boolean,
  ) {
    this.approxBytes =
      (beforeImage?.data.byteLength ?? 0) + (afterImage?.data.byteLength ?? 0);
  }

  prepare(direction: HistoryDirection): PreparedHistoryDelta {
    const currentState = useAppStore.getState();
    const currentLayer = currentState.layers.find((layer) => layer.id === this.layerId);
    const compensationImage = cloneLayerImageData(currentLayer?.imageData);
    const compensationVersion = currentLayer?.version;
    const compensationNeedsRecomposition = currentState.layersNeedRecomposition;
    const compensationLayers = currentState.layers;
    const projectId = currentState.project?.id ?? null;
    const targetImage = direction === 'forward' ? this.afterImage : this.beforeImage;
    const targetVersion = (compensationVersion ?? 0) + 1;

    return {
      deltaTag: this._tag,
      apply: () => this.applyState(targetImage, targetVersion),
      requiresCompensation: () => {
        const state = useAppStore.getState();
        return (
          (state.project?.id ?? null) === projectId &&
          (
            !Object.is(state.layers, compensationLayers) ||
            state.layersNeedRecomposition !== compensationNeedsRecomposition
          )
        );
      },
      compensate: () => {
        if ((useAppStore.getState().project?.id ?? null) !== projectId) return;
        this.applyState(compensationImage, compensationVersion);
        useAppStore.setState({
          layersNeedRecomposition: compensationNeedsRecomposition,
        });
      },
    };
  }

  applyReplay(direction: HistoryDirection): void {
    const targetImage = direction === 'forward' ? this.afterImage : this.beforeImage;
    const currentVersion = useAppStore.getState().layers.find(
      (layer) => layer.id === this.layerId,
    )?.version;
    this.applyState(targetImage, (currentVersion ?? 0) + 1);
  }

  private applyState(targetImage: ImageData | null, targetVersion: number | undefined): void {
    useAppStore.setState((state) => {
      const updatedLayers = state.layers.map((layer) => {
        if (layer.id !== this.layerId) {
          return layer;
        }

        const framebuffer = layer.framebuffer;
        if (
          framebuffer &&
          targetImage &&
          !(layer.layerType === 'color-cycle' && this.preserveColorCycleFramebuffer)
        ) {
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
          version: targetVersion,
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
      let colorDelta: HistoryDelta | null = null;
      if (baseline.colorState) {
        const afterColor = captureColorCycleBrushState(layer.id);
        colorDelta = await createColorCycleStrokeDelta({
          layerId: layer.id,
          forwardState: afterColor,
          backwardState: baseline.colorState,
          beforeVersion: baseline.colorState?.documentVersion,
          afterVersion: afterColor?.documentVersion,
          beforePixelVersion: baseline.colorState?.pixelVersion,
          afterPixelVersion: afterColor?.pixelVersion,
          beforeDimensions: beforeProject ?? undefined,
          afterDimensions: afterProject ?? undefined,
        });
      }

      const afterImage = cloneLayerImageData(layer.imageData);
      if (baseline.image || afterImage) {
        txn.push(new ResizeLayerDelta(
          layer.id,
          baseline.image,
          afterImage,
          Boolean(colorDelta),
        ));
        deltaCount += 1;
      }
      if (colorDelta) {
        txn.push(colorDelta);
        deltaCount += 1;
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
      debugWarn('raw-console', '[history] Failed to record resize history', error);
    }
  }
};
