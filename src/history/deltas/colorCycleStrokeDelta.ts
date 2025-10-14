import { useAppStore } from '@/stores/useAppStore';
import { getColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import type { HistoryDelta, HistoryDirection } from '../actionTypes';

type ColorCycleBrushState = ReturnType<NonNullable<ReturnType<typeof getColorCycleBrushManager>['getBrush']>['serialize']>;

export interface ColorCycleStrokeDeltaOptions {
  layerId: string;
  forwardState: ColorCycleBrushState | null;
  backwardState: ColorCycleBrushState | null;
}

const cloneState = (state: ColorCycleBrushState | null): ColorCycleBrushState | null => {
  if (!state) {
    return null;
  }
  return {
    cycleSpeed: state.cycleSpeed,
    fps: state.fps,
    brushSize: state.brushSize,
    layers: state.layers
      ? state.layers.map((layer) => ({
          layerId: layer.layerId,
          data: layer.data,
          strokeData: layer.strokeData
            ? {
                ...layer.strokeData,
                paintBuffer: layer.strokeData.paintBuffer?.slice(0)
              }
            : undefined
        }))
      : []
  };
};

export class ColorCycleStrokeDelta implements HistoryDelta {
  readonly _tag = 'color-cycle-stroke';
  readonly approxBytes?: number;

  private readonly layerId: string;
  private readonly forwardState: ColorCycleBrushState | null;
  private readonly backwardState: ColorCycleBrushState | null;

  constructor(options: ColorCycleStrokeDeltaOptions) {
    this.layerId = options.layerId;
    this.forwardState = cloneState(options.forwardState);
    this.backwardState = cloneState(options.backwardState);
    const forwardBytes = options.forwardState?.layers?.reduce((sum, layer) => {
      const paintLength = layer.strokeData?.paintBuffer?.byteLength ?? 0;
      return sum + paintLength;
    }, 0) ?? 0;
    const backwardBytes = options.backwardState?.layers?.reduce((sum, layer) => {
      const paintLength = layer.strokeData?.paintBuffer?.byteLength ?? 0;
      return sum + paintLength;
    }, 0) ?? 0;
    this.approxBytes = forwardBytes + backwardBytes;
  }

  async apply(direction: HistoryDirection): Promise<void> {
    const state = direction === 'forward' ? this.forwardState : this.backwardState;
    if (!state) {
      return;
    }

    const manager = getColorCycleBrushManager();
    const store = useAppStore.getState();
    const layer = store.layers.find((candidate) => candidate.id === this.layerId);
    if (!layer || layer.layerType !== 'color-cycle' || !layer.colorCycleData) {
      return;
    }

    const brush = manager.getBrush(this.layerId);
    if (!brush) {
      if (layer.colorCycleData.canvas) {
        try {
          store.initColorCycleForLayer(
            this.layerId,
            layer.colorCycleData.canvas.width,
            layer.colorCycleData.canvas.height
          );
        } catch {
          return;
        }
      } else {
        return;
      }
    }

    const refreshedBrush = manager.getBrush(this.layerId);
    if (!refreshedBrush) {
      return;
    }

    try {
      refreshedBrush.restoreFullState({
        cycleSpeed: state.cycleSpeed,
        fps: state.fps,
        brushSize: state.brushSize,
        layerSnapshots: state.layers?.map((layerSnapshot) => ({
          layerId: layerSnapshot.layerId,
          data: layerSnapshot.data,
          paintBuffer: layerSnapshot.strokeData?.paintBuffer ?? new ArrayBuffer(0),
          hasContent: Boolean(layerSnapshot.strokeData?.hasContent),
          strokeCounter: layerSnapshot.strokeData?.strokeCounter ?? 0
        }))
      });
    } catch {
      // If restore fails, leave state unchanged. Fallback bitmap delta should cover visual output.
    }
  }
}

export const createColorCycleStrokeDelta = (
  options: ColorCycleStrokeDeltaOptions
): HistoryDelta | null => {
  if (!options.forwardState && !options.backwardState) {
    return null;
  }
  return new ColorCycleStrokeDelta(options);
};
