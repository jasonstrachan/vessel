import { getMaskManager } from '@/layers/MaskManager';
import { useAppStore } from '@/stores/useAppStore';
import type { ColorCycleSerializedState } from '@/history/helpers/colorCycle';
import type { HistoryDelta, HistoryDirection, HistoryRehydrationTargets } from '../actionTypes';
import { readBlob, releaseBlob, storeBlob } from '../blobStore';

type PatchEncoding = 'raw' | 'rle';

type MaskPatch = {
  roi: { x: number; y: number; width: number; height: number };
  blobId: string;
  encoding: PatchEncoding;
  approxBytes: number;
};

export interface ColorCycleEraseMaskPatchDeltaOptions {
  layerId: string;
  width: number;
  height: number;
  roi: { x: number; y: number; width: number; height: number };
  forwardState: ColorCycleSerializedState;
  backwardState: ColorCycleSerializedState;
}

const encodeRLE = (input: Uint8Array): Uint8Array => {
  const output: number[] = [];
  let current = input[0];
  let count = 1;
  for (let index = 1; index < input.length; index += 1) {
    const value = input[index];
    if (value === current && count < 255) {
      count += 1;
    } else {
      output.push(count, current ?? 0);
      current = value;
      count = 1;
    }
  }
  output.push(count, current ?? 0);
  return Uint8Array.from(output);
};

const decodeRLE = (input: Uint8Array): Uint8Array => {
  const output: number[] = [];
  for (let index = 0; index < input.length; index += 2) {
    const count = input[index] ?? 0;
    const value = input[index + 1] ?? 0;
    for (let run = 0; run < count; run += 1) {
      output.push(value);
    }
  }
  return Uint8Array.from(output);
};

const encodePatchData = async (bytes: Uint8Array) => {
  const rle = encodeRLE(bytes);
  if (rle.length < bytes.length) {
    const blobId = await storeBlob(rle.buffer);
    return { blobId, encoding: 'rle' as const, approxBytes: rle.length };
  }
  const blobId = await storeBlob(bytes.buffer);
  return { blobId, encoding: 'raw' as const, approxBytes: bytes.length };
};

const patchesEqual = (left: Uint8Array, right: Uint8Array): boolean => {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
};

const extractMask = (
  state: ColorCycleSerializedState,
  layerId: string,
): { width: number; height: number; alpha: Uint8ClampedArray; version: number } | null => {
  if (!state?.layers) {
    return null;
  }
  const layer = state.layers.find((candidate) => candidate.layerId === layerId);
  const mask = layer?.eraseMaskSnapshot;
  if (!mask || mask.width <= 0 || mask.height <= 0) {
    return null;
  }
  if (mask.alpha.length < mask.width * mask.height) {
    return null;
  }
  return mask;
};

const extractRoiPatch = (
  source: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  roi: { x: number; y: number; width: number; height: number }
): Uint8Array => {
  const output = new Uint8Array(roi.width * roi.height);
  let targetIndex = 0;
  for (let row = 0; row < roi.height; row += 1) {
    const srcY = roi.y + row;
    if (srcY < 0 || srcY >= height) {
      targetIndex += roi.width;
      continue;
    }
    const srcOffset = srcY * width + roi.x;
    for (let col = 0; col < roi.width; col += 1) {
      const srcX = roi.x + col;
      if (srcX < 0 || srcX >= width) {
        output[targetIndex++] = 0;
        continue;
      }
      output[targetIndex++] = source[srcOffset + col] ?? 0;
    }
  }
  return output;
};

class ColorCycleEraseMaskPatchDelta implements HistoryDelta {
  readonly _tag = 'color-cycle-erase-mask-patch';
  readonly approxBytes?: number;

  readonly layerId: string;
  private readonly roi: { x: number; y: number; width: number; height: number };
  private readonly forwardMask: MaskPatch;
  private readonly backwardMask: MaskPatch;
  private readonly forwardVersion: number;
  private readonly backwardVersion: number;

  constructor(options: {
    layerId: string;
    roi: { x: number; y: number; width: number; height: number };
    forwardMask: MaskPatch;
    backwardMask: MaskPatch;
    forwardVersion: number;
    backwardVersion: number;
  }) {
    this.layerId = options.layerId;
    this.roi = options.roi;
    this.forwardMask = options.forwardMask;
    this.backwardMask = options.backwardMask;
    this.forwardVersion = options.forwardVersion;
    this.backwardVersion = options.backwardVersion;
    this.approxBytes = this.forwardMask.approxBytes + this.backwardMask.approxBytes;
  }

  async apply(direction: HistoryDirection): Promise<void> {
    const patch = direction === 'forward' ? this.forwardMask : this.backwardMask;
    const nextVersion = direction === 'forward' ? this.forwardVersion : this.backwardVersion;
    const stored = await readBlob(patch.blobId);
    if (!stored) {
      return;
    }
    const decoded = patch.encoding === 'rle' ? decodeRLE(stored.data) : stored.data;
    const maskManager = getMaskManager();
    const maskCanvas = maskManager.getMask(this.layerId);
    if (!maskCanvas) {
      return;
    }
    const ctx = maskCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      return;
    }

    const clampedX = Math.max(0, Math.floor(this.roi.x));
    const clampedY = Math.max(0, Math.floor(this.roi.y));
    const clampedRight = Math.min(maskCanvas.width, Math.ceil(this.roi.x + this.roi.width));
    const clampedBottom = Math.min(maskCanvas.height, Math.ceil(this.roi.y + this.roi.height));
    const clampedWidth = clampedRight - clampedX;
    const clampedHeight = clampedBottom - clampedY;
    if (clampedWidth <= 0 || clampedHeight <= 0) {
      return;
    }

    const image = ctx.getImageData(clampedX, clampedY, clampedWidth, clampedHeight);
    for (let y = 0; y < clampedHeight; y += 1) {
      const sourceY = y + (clampedY - this.roi.y);
      for (let x = 0; x < clampedWidth; x += 1) {
        const sourceX = x + (clampedX - this.roi.x);
        const sourceIndex = sourceY * this.roi.width + sourceX;
        const targetIndex = (y * clampedWidth + x) * 4;
        const alpha = decoded[sourceIndex] ?? 0;
        image.data[targetIndex] = 0;
        image.data[targetIndex + 1] = 0;
        image.data[targetIndex + 2] = 0;
        image.data[targetIndex + 3] = alpha;
      }
    }
    ctx.putImageData(image, clampedX, clampedY);

    const state = useAppStore.getState();
    const layer = state.layers.find((candidate) => candidate.id === this.layerId);
    if (layer?.layerType === 'color-cycle' && layer.colorCycleData) {
      state.updateLayer(
        this.layerId,
        {
          colorCycleData: {
            eraseMaskVersion: nextVersion,
          },
        },
        { skipColorCycleSync: true }
      );
    }
    state.setLayersNeedRecomposition(true);
  }

  dispose(): void {
    releaseBlob(this.forwardMask.blobId);
    releaseBlob(this.backwardMask.blobId);
  }

  collectRehydrationTargets(targets: HistoryRehydrationTargets): void {
    targets.layerIds.add(this.layerId);
    targets.colorCycleLayerIds.add(this.layerId);
  }
}

export const createColorCycleEraseMaskPatchDelta = async (
  options: ColorCycleEraseMaskPatchDeltaOptions
): Promise<HistoryDelta | null> => {
  const { width, height, roi } = options;
  if (width <= 0 || height <= 0 || roi.width <= 0 || roi.height <= 0) {
    return null;
  }

  const forwardMask = extractMask(options.forwardState, options.layerId);
  const backwardMask = extractMask(options.backwardState, options.layerId);
  if (!forwardMask || !backwardMask) {
    return null;
  }

  const forwardPatchBytes = extractRoiPatch(forwardMask.alpha, forwardMask.width, forwardMask.height, roi);
  const backwardPatchBytes = extractRoiPatch(backwardMask.alpha, backwardMask.width, backwardMask.height, roi);
  if (patchesEqual(forwardPatchBytes, backwardPatchBytes)) {
    return null;
  }

  const encodedForward = await encodePatchData(forwardPatchBytes);
  const encodedBackward = await encodePatchData(backwardPatchBytes);

  return new ColorCycleEraseMaskPatchDelta({
    layerId: options.layerId,
    roi,
    forwardMask: { ...encodedForward, roi },
    backwardMask: { ...encodedBackward, roi },
    forwardVersion: forwardMask.version,
    backwardVersion: backwardMask.version,
  });
};

