import { getColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import { useAppStore } from '@/stores/useAppStore';
import type { ColorCycleEraseMaskSnapshot, ColorCycleSerializedState } from '@/history/helpers/colorCycle';
import type { Layer } from '@/types';
import type { HistoryDelta, HistoryDirection, HistoryRehydrationTargets } from '../actionTypes';
import { HistoryReplayDriftError } from '../errors';

export interface ColorCycleSoftEdgeMaskDeltaOptions {
  layerId: string;
  forwardState: ColorCycleSerializedState;
  backwardState: ColorCycleSerializedState;
  beforeVersion?: number;
  afterVersion?: number;
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

const getSoftEdgeDirtyRect = (
  layer: Layer,
  snapshot: ColorCycleEraseMaskSnapshot | undefined,
  project: ReturnType<typeof useAppStore.getState>['project'],
) => {
  const width = snapshot?.width ?? layer.imageData?.width ?? layer.framebuffer?.width ?? project?.width ?? 0;
  const height = snapshot?.height ?? layer.imageData?.height ?? layer.framebuffer?.height ?? project?.height ?? 0;
  return width > 0 && height > 0 ? { x: 0, y: 0, width, height } : null;
};

class ColorCycleSoftEdgeMaskDelta implements HistoryDelta {
  readonly _tag = 'color-cycle-soft-edge-mask';
  readonly layerId: string;
  readonly approxBytes?: number;
  private readonly forwardMask: ColorCycleEraseMaskSnapshot | undefined;
  private readonly backwardMask: ColorCycleEraseMaskSnapshot | undefined;
  private readonly beforeVersion?: number;
  private readonly afterVersion?: number;

  constructor(options: {
    layerId: string;
    forwardMask: ColorCycleEraseMaskSnapshot | undefined;
    backwardMask: ColorCycleEraseMaskSnapshot | undefined;
    beforeVersion?: number;
    afterVersion?: number;
  }) {
    this.layerId = options.layerId;
    this.forwardMask = cloneSnapshot(options.forwardMask);
    this.backwardMask = cloneSnapshot(options.backwardMask);
    this.beforeVersion = options.beforeVersion;
    this.afterVersion = options.afterVersion;
    this.approxBytes = (this.forwardMask?.alpha.byteLength ?? 0) + (this.backwardMask?.alpha.byteLength ?? 0);
  }

  async apply(direction: HistoryDirection): Promise<void> {
    const snapshot = direction === 'forward' ? this.forwardMask : this.backwardMask;
    const expectedDocumentVersion = this.afterVersion ?? this.beforeVersion;
    const documentRead = getColorCycleBrushManager().getDocument(this.layerId)?.read?.();
    if (
      typeof expectedDocumentVersion === 'number' &&
      documentRead &&
      documentRead.version !== expectedDocumentVersion
    ) {
      throw new HistoryReplayDriftError({
        deltaTag: this._tag,
        direction,
        layerId: this.layerId,
        expected: expectedDocumentVersion,
        actual: documentRead.version,
        reason: 'document-version-mismatch',
      });
    }
    const state = useAppStore.getState();
    const layer = state.layers.find((candidate) => candidate.id === this.layerId);
    if (!layer || layer.layerType !== 'color-cycle') {
      return;
    }

    if (!snapshot) {
      const nextVersion = (layer.colorCycleData?.softEdgeMaskVersion ?? 0) + 1;
      const dirtyRect = getSoftEdgeDirtyRect(layer, snapshot, state.project);
      useAppStore.setState((current) => ({
        layers: current.layers.map((candidate) => (
          candidate.id === this.layerId
            ? removeSoftEdgeMaskFromLayer(candidate, nextVersion)
            : candidate
        )),
      }));
      if (dirtyRect) {
        useAppStore.getState().markCompositeSegmentsDirtyByLayerIds([this.layerId], {
          dirtyRectsByLayerId: new Map([[this.layerId, [dirtyRect]]]),
        });
      }
      useAppStore.setState({ layersNeedRecomposition: true });
      return;
    }

    const dirtyRect = getSoftEdgeDirtyRect(layer, snapshot, state.project);
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
      {
        skipColorCycleSync: true,
        dirtyRects: dirtyRect ? [dirtyRect] : undefined,
      },
    );
    useAppStore.setState({ layersNeedRecomposition: true });
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
    beforeVersion: options.beforeVersion ?? options.backwardState?.documentVersion,
    afterVersion: options.afterVersion ?? options.forwardState?.documentVersion,
  });
};
