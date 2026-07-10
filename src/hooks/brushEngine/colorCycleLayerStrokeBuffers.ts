import type { ColorCycleAnimator } from '@/lib/ColorCycleAnimator';
import { cloneStrokeSnapshotBuffers } from '@/lib/colorCycle/document';

import type { LayerStrokeState } from './colorCycleCanvas2DTypes';

export type CreateLayerStrokeStateOptions = {
  hasContent?: boolean;
  bufferSize?: number;
  contentIsOptimistic?: boolean;
  strokeCycleSpeed: number;
  strokeSpeedByte: number;
};

export const createLayerStrokeState = (
  options: CreateLayerStrokeStateOptions,
): LayerStrokeState => {
  const size = Math.max(0, Math.floor(options.bufferSize ?? 0));
  return {
    hasContent: Boolean(options.hasContent),
    contentIsOptimistic: Boolean(options.contentIsOptimistic),
    strokeCounter: 0,
    stampCounter: 0,
    strokePhaseUnits: 0,
    strokeCycleSpeed: options.strokeCycleSpeed,
    strokeSpeedByte: options.strokeSpeedByte,
    lastPoint: null,
    buffers: createLayerStrokeBuffers(size),
    flow: {
      activeSlot: 0,
      encoded: false,
      mode: undefined,
    },
    externalBase: {
      hasExternalBase: false,
    },
    stampDither: undefined,
    snapshot: undefined,
  };
};

export const ensureLayerStrokeBuffersSize = (
  strokeData: LayerStrokeState,
  expected: number,
): void => {
  if (strokeData.buffers.paint.length !== expected) {
    strokeData.buffers.paint = new Uint8Array(expected);
  }
  if (strokeData.buffers.gid.length !== expected) {
    strokeData.buffers.gid = new Uint8Array(expected);
  }
  if (strokeData.buffers.spd.length !== expected) {
    strokeData.buffers.spd = new Uint8Array(expected);
  }
  if (strokeData.buffers.flow.length !== expected) {
    strokeData.buffers.flow = new Uint8Array(expected);
  }
  if (strokeData.buffers.phase.length !== expected) {
    strokeData.buffers.phase = new Uint8Array(expected);
  }
  if (strokeData.buffers.def.length !== expected) {
    strokeData.buffers.def = new Uint16Array(expected);
  }
};

export const ensureLayerStrokeBuffersAllocated = (
  strokeData: LayerStrokeState,
  expected: number,
): void => {
  if (strokeData.buffers.paint.length === 0) {
    strokeData.buffers.paint = new Uint8Array(expected);
  }
  if (strokeData.buffers.gid.length === 0) {
    strokeData.buffers.gid = new Uint8Array(expected);
  }
  if (strokeData.buffers.spd.length === 0) {
    strokeData.buffers.spd = new Uint8Array(expected);
  }
  if (strokeData.buffers.flow.length === 0) {
    strokeData.buffers.flow = new Uint8Array(expected);
  }
  if (strokeData.buffers.phase.length === 0) {
    strokeData.buffers.phase = new Uint8Array(expected);
  }
  if (strokeData.buffers.def.length === 0) {
    strokeData.buffers.def = new Uint16Array(expected);
  }
};

export const ensureLayerStrokeDefBufferSize = (
  strokeData: LayerStrokeState,
  expected: number,
): void => {
  if (strokeData.buffers.def.length !== expected) {
    strokeData.buffers.def = new Uint16Array(expected);
  }
};

export const resizeLayerStrokeBuffersAfterTargetCanvasChange = (
  strokeData: LayerStrokeState,
  expected: number,
): void => {
  if (strokeData.buffers.paint.length !== expected) {
    strokeData.buffers.paint = new Uint8Array(expected);
    strokeData.buffers.gid = new Uint8Array(expected);
    strokeData.buffers.spd = new Uint8Array(expected);
    strokeData.buffers.flow = new Uint8Array(expected);
    strokeData.buffers.phase = new Uint8Array(expected);
    strokeData.buffers.def = new Uint16Array(expected);
  }
};

export const bindLayerStrokeBuffersToAnimator = (
  strokeData: LayerStrokeState,
  animator: ColorCycleAnimator,
  expected: number,
): void => {
  const handle = animator.beginDirectFill();
  if (handle.data && handle.data.length === expected) {
    strokeData.buffers.paint = handle.data;
  }
  if (handle.gradientId && handle.gradientId.length === expected) {
    strokeData.buffers.gid = handle.gradientId;
  }
  if (handle.speedData && handle.speedData.length === expected) {
    strokeData.buffers.spd = handle.speedData;
  }
  if (handle.flowData && handle.flowData.length === expected) {
    strokeData.buffers.flow = handle.flowData;
  }
  if (handle.phaseData && handle.phaseData.length === expected) {
    strokeData.buffers.phase = handle.phaseData;
  }
  if (handle.defIdData && handle.defIdData.length === expected) {
    strokeData.buffers.def = handle.defIdData;
  }
  animator.endDirectFill({ markDirty: false });
  animator.setDefIdData(strokeData.buffers.def);
};

export const snapshotLayerStrokeStateFromBuffers = (
  strokeData: LayerStrokeState,
  hasContent: boolean,
): void => {
  strokeData.hasContent = hasContent;
  strokeData.snapshot = {
    ...cloneStrokeSnapshotBuffers({
      buffers: strokeData.buffers,
      snapshot: strokeData.snapshot,
    }),
    hasContent,
    strokeCounter: strokeData.strokeCounter,
  };
};

export const paintBufferHasContent = (
  paint: Uint8Array | undefined,
  width: number,
  height: number,
): boolean => {
  try {
    if (!paint || paint.length === 0 || width <= 0 || height <= 0) {
      return false;
    }
    const limit = Math.min(width * height, paint.length);
    let index = 0;
    while (index < limit && ((paint.byteOffset + index) % Uint32Array.BYTES_PER_ELEMENT) !== 0) {
      if (paint[index] !== 0) {
        return true;
      }
      index += 1;
    }

    const alignedLength = limit - index;
    const wordLength = Math.floor(alignedLength / Uint32Array.BYTES_PER_ELEMENT);
    if (wordLength > 0) {
      const words = new Uint32Array(paint.buffer, paint.byteOffset + index, wordLength);
      for (let wordIndex = 0; wordIndex < words.length; wordIndex += 1) {
        if (words[wordIndex] !== 0) {
          return true;
        }
      }
      index += wordLength * Uint32Array.BYTES_PER_ELEMENT;
    }

    for (; index < limit; index += 1) {
      if (paint[index] !== 0) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
};

export const layerStrokeStateHasContent = (
  strokeData: LayerStrokeState | undefined,
  width: number,
  height: number,
): boolean => {
  if (!strokeData) {
    return false;
  }
  return Boolean(
    (strokeData.hasContent && !strokeData.contentIsOptimistic) ||
    paintBufferHasContent(strokeData.buffers.paint, width, height)
  );
};

export const refreshLayerStrokeStateContent = (
  strokeData: LayerStrokeState,
  width: number,
  height: number,
): boolean => {
  const hasContent = layerStrokeStateHasContent(strokeData, width, height);
  strokeData.hasContent = hasContent;
  strokeData.contentIsOptimistic = false;
  return hasContent;
};

const createLayerStrokeBuffers = (
  size: number,
): LayerStrokeState['buffers'] => ({
  paint: new Uint8Array(size),
  gid: new Uint8Array(size),
  spd: new Uint8Array(size),
  flow: new Uint8Array(size),
  phase: new Uint8Array(size),
  def: new Uint16Array(size),
});
