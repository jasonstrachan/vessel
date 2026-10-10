import type {
  HistoryDelta,
  HistoryDirection,
  HistoryRehydrationTargets,
  PreparedHistoryDelta,
} from '@/history/actionTypes';
import type { ColorCycleEraseMaskSnapshot, ColorCycleSerializedState } from '@/history/helpers/colorCycle';
import { prepareAppStoreHistoryDelta } from '@/history/storeStateCompensation';
import { useAppStore } from '@/stores/useAppStore';

export interface ColorCycleEraseMaskDeltaOptions {
  layerId: string;
  forwardState: ColorCycleSerializedState;
  backwardState: ColorCycleSerializedState;
}

const cloneMask = (
  state: ColorCycleSerializedState,
  layerId: string,
): ColorCycleEraseMaskSnapshot | undefined => {
  const mask = state?.layers.find((layer) => layer.layerId === layerId)?.eraseMaskSnapshot;
  if (!mask) return undefined;
  if (
    !Number.isInteger(mask.width) || mask.width <= 0
    || !Number.isInteger(mask.height) || mask.height <= 0
    || mask.alpha.length !== mask.width * mask.height
  ) {
    throw new Error(`Invalid color-cycle erase mask snapshot for layer ${layerId}.`);
  }
  return { ...mask, alpha: new Uint8ClampedArray(mask.alpha) };
};

const masksEqual = (
  left: ColorCycleEraseMaskSnapshot | undefined,
  right: ColorCycleEraseMaskSnapshot | undefined,
): boolean => {
  if (!left || !right) return left === right;
  return left.width === right.width
    && left.height === right.height
    && left.version === right.version
    && left.alpha.every((value, index) => value === right.alpha[index]);
};

class ColorCycleEraseMaskDelta implements HistoryDelta {
  readonly _tag = 'color-cycle-erase-mask';
  readonly approxBytes: number;

  constructor(
    readonly layerId: string,
    private readonly forwardMask: ColorCycleEraseMaskSnapshot | undefined,
    private readonly backwardMask: ColorCycleEraseMaskSnapshot | undefined,
  ) {
    this.approxBytes = (forwardMask?.alpha.byteLength ?? 0) + (backwardMask?.alpha.byteLength ?? 0);
  }

  prepare(direction: HistoryDirection): PreparedHistoryDelta {
    this.requireLayer();
    return prepareAppStoreHistoryDelta(
      this._tag,
      direction,
      (requestedDirection) => this.applyReplay(requestedDirection),
      ['layers', 'layersNeedRecomposition', 'compositeSegments', 'pendingCompositeDirtyBatches'],
      (targets) => this.collectRehydrationTargets(targets),
    );
  }

  private requireLayer() {
    const layer = useAppStore.getState().layers.find((candidate) => candidate.id === this.layerId);
    if (layer?.layerType !== 'color-cycle' || !layer.colorCycleData) {
      throw new Error(`Color-cycle layer ${this.layerId} is unavailable for history replay.`);
    }
    return layer;
  }

  private applyReplay(direction: HistoryDirection): void {
    const snapshot = direction === 'forward' ? this.forwardMask : this.backwardMask;
    const layer = this.requireLayer();
    const colorCycleData = { ...layer.colorCycleData };
    if (snapshot) {
      const canvas = document.createElement('canvas');
      canvas.width = snapshot.width;
      canvas.height = snapshot.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error(`Could not restore erase mask for layer ${this.layerId}.`);
      const image = new ImageData(snapshot.width, snapshot.height);
      for (let index = 0; index < snapshot.alpha.length; index += 1) {
        image.data[index * 4 + 3] = snapshot.alpha[index];
      }
      ctx.putImageData(image, 0, 0);
      colorCycleData.eraseMask = canvas;
      colorCycleData.eraseMaskImageData = image;
      colorCycleData.eraseMaskVersion = snapshot.version;
    } else {
      delete colorCycleData.eraseMask;
      delete colorCycleData.eraseMaskImageData;
      delete colorCycleData.eraseMaskVersion;
    }

    // Crop's indexed delta owns document anchors. Replace mask surfaces without
    // resizing or mutating the previous canvas so failed replay can restore it exactly.
    useAppStore.setState((state) => ({
      layers: state.layers.map((candidate) => candidate.id === this.layerId
        ? { ...candidate, colorCycleData }
        : candidate),
      layersNeedRecomposition: true,
    }));
    useAppStore.getState().markCompositeSegmentsDirtyByLayerIds([this.layerId]);
  }

  collectRehydrationTargets(targets: HistoryRehydrationTargets): void {
    targets.layerIds.add(this.layerId);
    targets.colorCycleLayerIds.add(this.layerId);
  }
}

/** Whole mask history for crops whose before/after dimensions may differ. */
export const createColorCycleEraseMaskDelta = (
  options: ColorCycleEraseMaskDeltaOptions,
): HistoryDelta | null => {
  const forwardMask = cloneMask(options.forwardState, options.layerId);
  const backwardMask = cloneMask(options.backwardState, options.layerId);
  if (masksEqual(forwardMask, backwardMask)) return null;
  return new ColorCycleEraseMaskDelta(options.layerId, forwardMask, backwardMask);
};
