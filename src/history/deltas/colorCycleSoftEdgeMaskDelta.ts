import { useAppStore } from '@/stores/useAppStore';
import type { ColorCycleEraseMaskSnapshot, ColorCycleSerializedState } from '@/history/helpers/colorCycle';
import type { Layer } from '@/types';
import type { HistoryDelta, HistoryDirection, HistoryRehydrationTargets } from '../actionTypes';

export interface ColorCycleSoftEdgeMaskDeltaOptions {
  layerId: string;
  forwardState: ColorCycleSerializedState;
  backwardState: ColorCycleSerializedState;
}

const extractMask = (
  state: ColorCycleSerializedState,
  layerId: string,
): ColorCycleEraseMaskSnapshot | undefined => {
  const layer = state?.layers?.find((candidate) => candidate.layerId === layerId);
  return layer?.softEdgeMaskSnapshot;
};

const masksEqual = (
  left: ColorCycleEraseMaskSnapshot | undefined,
  right: ColorCycleEraseMaskSnapshot | undefined,
): boolean => {
  if (!left && !right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  if (
    left.width !== right.width ||
    left.height !== right.height ||
    left.enabled !== right.enabled ||
    left.version !== right.version ||
    left.alpha.length !== right.alpha.length
  ) {
    return false;
  }
  for (let index = 0; index < left.alpha.length; index += 1) {
    if (left.alpha[index] !== right.alpha[index]) {
      return false;
    }
  }
  return true;
};

const cloneSnapshot = (
  snapshot: ColorCycleEraseMaskSnapshot | undefined,
): ColorCycleEraseMaskSnapshot | undefined => (
  snapshot
    ? {
        width: snapshot.width,
        height: snapshot.height,
        alpha: new Uint8ClampedArray(snapshot.alpha),
        enabled: snapshot.enabled,
        version: snapshot.version,
      }
    : undefined
);

const snapshotToImageData = (snapshot: ColorCycleEraseMaskSnapshot): ImageData => {
  const imageData = new ImageData(snapshot.width, snapshot.height);
  for (let src = 0, dst = 0; src < snapshot.alpha.length; src += 1, dst += 4) {
    const alpha = snapshot.alpha[src] ?? 0;
    imageData.data[dst] = 255;
    imageData.data[dst + 1] = 255;
    imageData.data[dst + 2] = 255;
    imageData.data[dst + 3] = alpha;
  }
  return imageData;
};

const snapshotToCanvas = (snapshot: ColorCycleEraseMaskSnapshot): HTMLCanvasElement | undefined => {
  if (typeof document === 'undefined') {
    return undefined;
  }
  const canvas = document.createElement('canvas');
  canvas.width = snapshot.width;
  canvas.height = snapshot.height;
  canvas.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings)
    ?.putImageData(snapshotToImageData(snapshot), 0, 0);
  return canvas;
};

const removeSoftEdgeMaskFromLayer = (layer: Layer, nextVersion: number): Layer => {
  if (!layer.colorCycleData) {
    return layer;
  }
  const colorCycleData = { ...layer.colorCycleData };
  delete colorCycleData.softEdgeMask;
  delete colorCycleData.softEdgeMaskImageData;
  return {
    ...layer,
    colorCycleData: {
      ...colorCycleData,
      softEdgeMaskVersion: nextVersion,
    },
  };
};

class ColorCycleSoftEdgeMaskDelta implements HistoryDelta {
  readonly _tag = 'color-cycle-soft-edge-mask';
  readonly layerId: string;
  readonly approxBytes?: number;
  private readonly forwardMask: ColorCycleEraseMaskSnapshot | undefined;
  private readonly backwardMask: ColorCycleEraseMaskSnapshot | undefined;

  constructor(options: {
    layerId: string;
    forwardMask: ColorCycleEraseMaskSnapshot | undefined;
    backwardMask: ColorCycleEraseMaskSnapshot | undefined;
  }) {
    this.layerId = options.layerId;
    this.forwardMask = cloneSnapshot(options.forwardMask);
    this.backwardMask = cloneSnapshot(options.backwardMask);
    this.approxBytes = (this.forwardMask?.alpha.byteLength ?? 0) + (this.backwardMask?.alpha.byteLength ?? 0);
  }

  async apply(direction: HistoryDirection): Promise<void> {
    const snapshot = direction === 'forward' ? this.forwardMask : this.backwardMask;
    const state = useAppStore.getState();
    const layer = state.layers.find((candidate) => candidate.id === this.layerId);
    if (!layer || layer.layerType !== 'color-cycle') {
      return;
    }

    if (!snapshot) {
      const nextVersion = (layer.colorCycleData?.softEdgeMaskVersion ?? 0) + 1;
      useAppStore.setState((current) => ({
        layers: current.layers.map((candidate) => (
          candidate.id === this.layerId
            ? removeSoftEdgeMaskFromLayer(candidate, nextVersion)
            : candidate
        )),
      }));
      state.setLayersNeedRecomposition(true);
      return;
    }

    state.updateLayer(
      this.layerId,
      {
        colorCycleData: {
          softEdgeMask: snapshotToCanvas(snapshot),
          softEdgeMaskImageData: snapshotToImageData(snapshot),
          softEdgeMaskEnabled: snapshot.enabled ?? true,
          softEdgeMaskVersion: snapshot.version,
        },
      },
      { skipColorCycleSync: true },
    );
    state.setLayersNeedRecomposition(true);
  }

  collectRehydrationTargets(targets: HistoryRehydrationTargets): void {
    targets.layerIds.add(this.layerId);
    targets.colorCycleLayerIds.add(this.layerId);
  }
}

export const createColorCycleSoftEdgeMaskDelta = (
  options: ColorCycleSoftEdgeMaskDeltaOptions,
): HistoryDelta | null => {
  const forwardMask = extractMask(options.forwardState, options.layerId);
  const backwardMask = extractMask(options.backwardState, options.layerId);
  if (masksEqual(forwardMask, backwardMask)) {
    return null;
  }
  return new ColorCycleSoftEdgeMaskDelta({
    layerId: options.layerId,
    forwardMask,
    backwardMask,
  });
};
