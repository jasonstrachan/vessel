import type { ColorCycleBrushCanvas2D } from '@/hooks/brushEngine/ColorCycleBrushCanvas2D';
import { getColorCycleBrushManager, getColorCycleStoreState } from '@/stores/colorCycleBrushManager';
import { useAppStore } from '@/stores/useAppStore';
import {
  logCCMutation,
  summarizeColorCycleLayer,
  summarizeScalarBuffer,
} from '@/utils/colorCycle/ccMutationAudit';
import type { HistoryDelta, HistoryDirection, HistoryRehydrationTargets } from '../actionTypes';
import { readBlob, releaseBlob, storeBlob } from '../blobStore';

type ColorCycleBrushState = ReturnType<ColorCycleBrushCanvas2D['serialize']>;
type ColorCycleSerializedLayer = NonNullable<ColorCycleBrushState['layers']>[number];

type ManagedColorCycleBrush = ColorCycleBrushCanvas2D & {
  applyPaintPatch?: (
    layerId: string,
    roi: { x: number; y: number; width: number; height: number },
    bytes: Uint8Array,
    extras?: {
      gradientIdBytes?: Uint8Array;
      gradientDefIdBytes?: Uint8Array;
      speedBytes?: Uint8Array;
      flowBytes?: Uint8Array;
      phaseBytes?: Uint8Array;
    }
  ) => boolean;
  commitToLayer?: (targetCanvas: HTMLCanvasElement, layerId: string) => void;
  renderDirectToCanvas?: (targetCanvas: HTMLCanvasElement, layerId: string) => void;
  render?: (forceFullOpacity?: boolean) => void;
  setTargetCanvas?: (canvas: HTMLCanvasElement | null) => void;
  updateColorCycleTexture?: () => void;
};

type PatchEncoding = 'raw' | 'rle';

export const COLOR_CYCLE_PIXEL_PATCH_BUFFER_KEYS = [
  'paint',
  'gradientId',
  'gradientDefId',
  'speed',
  'flow',
  'phase',
] as const;

type ColorCyclePixelPatchBufferKey = typeof COLOR_CYCLE_PIXEL_PATCH_BUFFER_KEYS[number];
type ColorCyclePixelPatchBytes = Record<ColorCyclePixelPatchBufferKey, Uint8Array | null>;
type EncodedColorCyclePixelPatches = Record<ColorCyclePixelPatchBufferKey, PaintPatch | null>;
type ColorCyclePatchRuntimeExtras = {
  gradientIdBytes?: Uint8Array;
  gradientDefIdBytes?: Uint8Array;
  speedBytes?: Uint8Array;
  flowBytes?: Uint8Array;
  phaseBytes?: Uint8Array;
};

type PaintPatch = {
  roi: { x: number; y: number; width: number; height: number };
  blobId: string;
  encoding: PatchEncoding;
  approxBytes: number;
};

type ColorCyclePixelBufferSpec = {
  key: ColorCyclePixelPatchBufferKey;
  bytesPerPixel: number;
  read: (layer: ColorCycleSerializedLayer) => ArrayBuffer | ArrayBufferView | undefined;
};

const COLOR_CYCLE_PIXEL_BUFFER_SPECS: readonly ColorCyclePixelBufferSpec[] = [
  {
    key: 'paint',
    bytesPerPixel: Uint8Array.BYTES_PER_ELEMENT,
    read: (layer) => layer.strokeData?.paintBuffer ?? layer.data?.indexBuffer?.data,
  },
  {
    key: 'gradientId',
    bytesPerPixel: Uint8Array.BYTES_PER_ELEMENT,
    read: (layer) => layer.strokeData?.gradientIdBuffer ?? layer.data?.indexBuffer?.gradientId,
  },
  {
    key: 'gradientDefId',
    bytesPerPixel: Uint16Array.BYTES_PER_ELEMENT,
    read: (layer) => layer.strokeData?.gradientDefIdBuffer,
  },
  {
    key: 'speed',
    bytesPerPixel: Uint8Array.BYTES_PER_ELEMENT,
    read: (layer) => layer.strokeData?.speedBuffer ?? layer.data?.indexBuffer?.speedData,
  },
  {
    key: 'flow',
    bytesPerPixel: Uint8Array.BYTES_PER_ELEMENT,
    read: (layer) => layer.strokeData?.flowBuffer ?? layer.data?.indexBuffer?.flowData,
  },
  {
    key: 'phase',
    bytesPerPixel: Uint8Array.BYTES_PER_ELEMENT,
    read: (layer) => layer.strokeData?.phaseBuffer ?? layer.data?.indexBuffer?.phaseData,
  },
];

export interface ColorCycleStrokePatchDeltaOptions {
  layerId: string;
  width: number;
  height: number;
  roi: { x: number; y: number; width: number; height: number };
  forwardState: ColorCycleBrushState | null;
  backwardState: ColorCycleBrushState | null;
}

const encodeRLE = (input: Uint8Array): Uint8Array => {
  const output: number[] = [];
  let current = input[0];
  let count = 1;
  for (let i = 1; i < input.length; i += 1) {
    const value = input[i];
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
  for (let i = 0; i < input.length; i += 2) {
    const count = input[i] ?? 0;
    const value = input[i + 1] ?? 0;
    for (let j = 0; j < count; j += 1) {
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

const emptyColorCyclePatchBytes = (): ColorCyclePixelPatchBytes => ({
  paint: null,
  gradientId: null,
  gradientDefId: null,
  speed: null,
  flow: null,
  phase: null,
});

const emptyEncodedColorCyclePatches = (): EncodedColorCyclePixelPatches => ({
  paint: null,
  gradientId: null,
  gradientDefId: null,
  speed: null,
  flow: null,
  phase: null,
});

const findSerializedLayer = (
  state: ColorCycleBrushState | null,
  layerId: string
): ColorCycleSerializedLayer | null => {
  if (!state?.layers) {
    return null;
  }
  return state.layers.find((candidate: ColorCycleSerializedLayer) => candidate.layerId === layerId) ?? null;
};

const bufferToPatchBytes = (
  buffer: ArrayBuffer | ArrayBufferView | undefined,
  expectedPixels: number,
  bytesPerPixel: number
): Uint8Array | null => {
  if (!buffer) {
    return null;
  }
  const byteLength = expectedPixels * bytesPerPixel;
  const bytes =
    buffer instanceof ArrayBuffer
      ? new Uint8Array(buffer)
      : ArrayBuffer.isView(buffer)
        ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
        : null;
  if (!bytes || bytes.length < byteLength) {
    return null;
  }
  return bytes;
};

const extractRoiPatch = (
  source: Uint8Array,
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

const extractRoiPatchBytes = (
  source: Uint8Array,
  bytesPerPixel: number,
  width: number,
  height: number,
  roi: { x: number; y: number; width: number; height: number }
): Uint8Array => {
  if (bytesPerPixel === 1) {
    return extractRoiPatch(source, width, height, roi);
  }
  const output = new Uint8Array(roi.width * roi.height * bytesPerPixel);
  let targetIndex = 0;
  for (let row = 0; row < roi.height; row += 1) {
    const srcY = roi.y + row;
    if (srcY < 0 || srcY >= height) {
      targetIndex += roi.width * bytesPerPixel;
      continue;
    }
    for (let col = 0; col < roi.width; col += 1) {
      const srcX = roi.x + col;
      if (srcX < 0 || srcX >= width) {
        targetIndex += bytesPerPixel;
        continue;
      }
      const sourceStart = (srcY * width + srcX) * bytesPerPixel;
      output.set(source.subarray(sourceStart, sourceStart + bytesPerPixel), targetIndex);
      targetIndex += bytesPerPixel;
    }
  }
  return output;
};

const extractColorCyclePixelPatchBytes = (
  state: ColorCycleBrushState | null,
  layerId: string,
  width: number,
  height: number,
  roi: { x: number; y: number; width: number; height: number }
): ColorCyclePixelPatchBytes => {
  const output = emptyColorCyclePatchBytes();
  const layer = findSerializedLayer(state, layerId);
  if (!layer) {
    return output;
  }
  const expectedPixels = width * height;
  for (const spec of COLOR_CYCLE_PIXEL_BUFFER_SPECS) {
    const bytes = bufferToPatchBytes(spec.read(layer), expectedPixels, spec.bytesPerPixel);
    output[spec.key] = bytes
      ? extractRoiPatchBytes(bytes, spec.bytesPerPixel, width, height, roi)
      : null;
  }
  return output;
};

const patchesEqual = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
};

const patchesMatch = (
  forward: ColorCyclePixelPatchBytes,
  backward: ColorCyclePixelPatchBytes
): boolean =>
  COLOR_CYCLE_PIXEL_PATCH_BUFFER_KEYS.every((key) => {
    const forwardBytes = forward[key];
    const backwardBytes = backward[key];
    return (
      (!forwardBytes && !backwardBytes) ||
      Boolean(forwardBytes && backwardBytes && patchesEqual(forwardBytes, backwardBytes))
    );
  });

const synthesizeMissingBackwardPatches = (
  forward: ColorCyclePixelPatchBytes,
  backward: ColorCyclePixelPatchBytes,
  roi: { width: number; height: number }
): ColorCyclePixelPatchBytes => {
  const next = { ...backward };
  if (!next.paint) {
    return next;
  }
  for (const spec of COLOR_CYCLE_PIXEL_BUFFER_SPECS) {
    if (spec.key === 'paint') {
      continue;
    }
    if (!next[spec.key] && forward[spec.key]) {
      next[spec.key] = new Uint8Array(roi.width * roi.height * spec.bytesPerPixel);
    }
  }
  return next;
};

const synthesizeEmptyBackwardPatches = (
  forward: ColorCyclePixelPatchBytes,
  roi: { width: number; height: number }
): ColorCyclePixelPatchBytes => {
  const next = emptyColorCyclePatchBytes();
  for (const spec of COLOR_CYCLE_PIXEL_BUFFER_SPECS) {
    if (forward[spec.key]) {
      next[spec.key] = new Uint8Array(roi.width * roi.height * spec.bytesPerPixel);
    }
  }
  return next;
};

const canSynthesizeEmptyBackwardPaint = (
  backwardState: ColorCycleBrushState | null,
  layerId: string
): boolean => {
  const layer = findSerializedLayer(backwardState, layerId);
  if (!layer) {
    return false;
  }
  const strokeData = layer.strokeData;
  if (!strokeData) {
    return true;
  }
  if (strokeData.hasContent === true) {
    return false;
  }
  return COLOR_CYCLE_PIXEL_BUFFER_SPECS.every((spec) => {
    const value = spec.read(layer);
    if (!value) {
      return true;
    }
    const byteLength = value instanceof ArrayBuffer
      ? value.byteLength
      : ArrayBuffer.isView(value)
        ? value.byteLength
        : 0;
    return byteLength === 0;
  });
};

const encodeColorCyclePatchBytes = async (
  bytes: ColorCyclePixelPatchBytes,
  roi: { x: number; y: number; width: number; height: number }
): Promise<EncodedColorCyclePixelPatches> => {
  const encoded = emptyEncodedColorCyclePatches();
  await Promise.all(
    COLOR_CYCLE_PIXEL_PATCH_BUFFER_KEYS.map(async (key) => {
      const patchBytes = bytes[key];
      encoded[key] = patchBytes ? { ...(await encodePatchData(patchBytes)), roi } : null;
    })
  );
  return encoded;
};

const encodedPatchApproxBytes = (patches: EncodedColorCyclePixelPatches): number =>
  COLOR_CYCLE_PIXEL_PATCH_BUFFER_KEYS.reduce(
    (sum, key) => sum + (patches[key]?.approxBytes ?? 0),
    0
  );

const decodePatch = async (patch: PaintPatch | null): Promise<Uint8Array | undefined> => {
  if (!patch) {
    return undefined;
  }
  const blob = await readBlob(patch.blobId);
  if (!blob) {
    return undefined;
  }
  return patch.encoding === 'rle' ? decodeRLE(blob.data) : blob.data;
};

const decodeColorCyclePatchSet = async (
  patches: EncodedColorCyclePixelPatches
): Promise<ColorCyclePixelPatchBytes> => {
  const decoded = emptyColorCyclePatchBytes();
  await Promise.all(
    COLOR_CYCLE_PIXEL_PATCH_BUFFER_KEYS.map(async (key) => {
      decoded[key] = (await decodePatch(patches[key])) ?? null;
    })
  );
  return decoded;
};

const patchSetRuntimeExtras = (
  patches: ColorCyclePixelPatchBytes
): ColorCyclePatchRuntimeExtras => ({
  gradientIdBytes: patches.gradientId ?? undefined,
  gradientDefIdBytes: patches.gradientDefId ?? undefined,
  speedBytes: patches.speed ?? undefined,
  flowBytes: patches.flow ?? undefined,
  phaseBytes: patches.phase ?? undefined,
});

class ColorCycleStrokePatchDelta implements HistoryDelta {
  readonly _tag = 'color-cycle-stroke-patch';
  readonly approxBytes?: number;

  readonly layerId: string;
  private readonly width: number;
  private readonly height: number;
  private readonly roi: { x: number; y: number; width: number; height: number };
  private readonly forwardPatches: EncodedColorCyclePixelPatches;
  private readonly backwardPatches: EncodedColorCyclePixelPatches;

  constructor(options: {
    layerId: string;
    width: number;
    height: number;
    roi: { x: number; y: number; width: number; height: number };
    forwardPatches: EncodedColorCyclePixelPatches;
    backwardPatches: EncodedColorCyclePixelPatches;
  }) {
    this.layerId = options.layerId;
    this.width = options.width;
    this.height = options.height;
    this.roi = options.roi;
    this.forwardPatches = options.forwardPatches;
    this.backwardPatches = options.backwardPatches;
    this.approxBytes =
      encodedPatchApproxBytes(options.forwardPatches) +
      encodedPatchApproxBytes(options.backwardPatches);
  }

  async apply(direction: HistoryDirection): Promise<void> {
    const patches = direction === 'forward' ? this.forwardPatches : this.backwardPatches;
    const patch = patches.paint;
    if (!patch) {
      return;
    }

    const manager = getColorCycleBrushManager();
    const store = useAppStore.getState();
    const layer = store.layers.find((candidate) => candidate.id === this.layerId);
    if (!layer || layer.layerType !== 'color-cycle' || !layer.colorCycleData) {
      return;
    }

    if (!(getColorCycleStoreState()?.getLayerColorCycleBrush?.(this.layerId) ?? manager.getBrush(this.layerId))) {
      const width = this.width || layer.colorCycleData.canvas?.width || store.project?.width || 0;
      const height = this.height || layer.colorCycleData.canvas?.height || store.project?.height || 0;
      if (!width || !height) {
        return;
      }
      try {
        store.initColorCycleForLayer(this.layerId, width, height);
      } catch {
        return;
      }
    }

    const brush = (
      getColorCycleStoreState()?.getLayerColorCycleBrush?.(this.layerId) ??
      manager.getBrush(this.layerId)
    ) as ManagedColorCycleBrush | undefined;
    const targetCanvas = layer.colorCycleData.canvas;
    if (!brush || !targetCanvas || typeof brush.applyPaintPatch !== 'function') {
      return;
    }

    if (
      typeof HTMLCanvasElement !== 'undefined' &&
      targetCanvas instanceof HTMLCanvasElement &&
      typeof brush.setTargetCanvas === 'function'
    ) {
      try {
        brush.setTargetCanvas(targetCanvas);
      } catch {}
    }

    const decoded = await decodeColorCyclePatchSet(patches);
    if (!decoded.paint) {
      return;
    }

    const beforeAudit = summarizeColorCycleLayer(layer);
    const beforeHasContent = Boolean(layer.colorCycleData.hasContent);
    const patchPaintSummary = summarizeScalarBuffer(decoded.paint, patch.roi.width, patch.roi.height);
    const hasContent = brush.applyPaintPatch(
      this.layerId,
      patch.roi,
      decoded.paint,
      patchSetRuntimeExtras(decoded)
    );
    if (beforeHasContent && !hasContent) {
      logCCMutation({
        event: 'color-cycle-layer-cleared',
        layerId: this.layerId,
        reason: direction === 'backward' ? 'history-undo-patch' : 'history-redo-patch',
        severity: 'error',
        before: beforeAudit,
        after: beforeAudit ? { ...beforeAudit, hasContent: false } : null,
        details: {
          source: 'history-color-cycle-stroke-patch',
          operation: direction === 'backward' ? 'undo' : 'redo',
          expectedDestructive: true,
          direction,
          roi: this.roi,
          patchRoi: patch.roi,
          width: this.width,
          height: this.height,
          patchPaint: patchPaintSummary,
          patchGradientId: decoded.gradientId
            ? summarizeScalarBuffer(decoded.gradientId, patch.roi.width, patch.roi.height)
            : null,
          patchGradientDefId: decoded.gradientDefId
            ? summarizeScalarBuffer(new Uint16Array(
              decoded.gradientDefId.buffer,
              decoded.gradientDefId.byteOffset,
              Math.floor(decoded.gradientDefId.byteLength / Uint16Array.BYTES_PER_ELEMENT)
            ), patch.roi.width, patch.roi.height)
            : null,
          patchSpeed: decoded.speed
            ? summarizeScalarBuffer(decoded.speed, patch.roi.width, patch.roi.height)
            : null,
          patchFlow: decoded.flow
            ? summarizeScalarBuffer(decoded.flow, patch.roi.width, patch.roi.height)
            : null,
          patchPhase: decoded.phase
            ? summarizeScalarBuffer(decoded.phase, patch.roi.width, patch.roi.height)
            : null,
        },
      });
    }

    try {
      brush.updateColorCycleTexture?.();
    } catch {}

    let synced = false;
    if (typeof brush.commitToLayer === 'function') {
      try {
        brush.commitToLayer(targetCanvas, this.layerId);
        synced = true;
      } catch {}
    }
    if (!synced && typeof brush.renderDirectToCanvas === 'function') {
      try {
        brush.renderDirectToCanvas(targetCanvas, this.layerId);
        synced = true;
      } catch {}
    }
    if (!synced) {
      try {
        brush.render?.(false);
      } catch {}
    }

    try {
      const latest = useAppStore.getState();
      const latestLayer = latest.layers.find((candidate) => candidate.id === this.layerId);
      if (latestLayer?.colorCycleData) {
        latest.updateLayer(this.layerId, {
          colorCycleData: { ...latestLayer.colorCycleData, hasContent },
        });
      }
    } catch {}

    useAppStore.getState().setLayersNeedRecomposition(true);
  }

  dispose(): void {
    for (const patches of [this.forwardPatches, this.backwardPatches]) {
      for (const patch of Object.values(patches)) {
        if (patch) {
          releaseBlob(patch.blobId);
        }
      }
    }
  }

  collectRehydrationTargets(targets: HistoryRehydrationTargets): void {
    targets.layerIds.add(this.layerId);
    targets.colorCycleLayerIds.add(this.layerId);
    targets.workerScopes.add('color-cycle-gradient');
  }
}

export const createColorCycleStrokePatchDelta = async (
  options: ColorCycleStrokePatchDeltaOptions
): Promise<HistoryDelta | null> => {
  if (!options.forwardState && !options.backwardState) {
    return null;
  }
  const { width, height, roi } = options;
  if (!width || !height || roi.width <= 0 || roi.height <= 0) {
    return null;
  }

  const forwardPatchBytes = extractColorCyclePixelPatchBytes(
    options.forwardState,
    options.layerId,
    width,
    height,
    roi
  );
  let backwardPatchBytes = extractColorCyclePixelPatchBytes(
    options.backwardState,
    options.layerId,
    width,
    height,
    roi
  );
  if (forwardPatchBytes.paint && !backwardPatchBytes.paint) {
    if (canSynthesizeEmptyBackwardPaint(options.backwardState, options.layerId)) {
      backwardPatchBytes = synthesizeEmptyBackwardPatches(forwardPatchBytes, roi);
    } else {
      const state = useAppStore.getState();
      const layer = state.layers.find((candidate) => candidate.id === options.layerId) ?? null;
      logCCMutation({
        event: 'history-cc-before-state-missing',
        layerId: options.layerId,
        reason: 'missing-backward-paint-patch',
        severity: 'warn',
        before: null,
        after: summarizeColorCycleLayer(layer),
        details: {
          source: 'history-color-cycle-stroke-patch',
          expectedDestructive: false,
          roi,
          width,
          height,
          forwardPaint: summarizeScalarBuffer(forwardPatchBytes.paint, roi.width, roi.height),
          message: 'Skipped CC history delta because undo would synthesize an empty backward paint patch.',
        },
      });
      return null;
    }
  }
  if (!forwardPatchBytes.paint && !backwardPatchBytes.paint) {
    return null;
  }
  backwardPatchBytes = synthesizeMissingBackwardPatches(forwardPatchBytes, backwardPatchBytes, roi);

  if (forwardPatchBytes.paint && backwardPatchBytes.paint && patchesMatch(forwardPatchBytes, backwardPatchBytes)) {
    return null;
  }

  const [forwardPatches, backwardPatches] = await Promise.all([
    encodeColorCyclePatchBytes(forwardPatchBytes, roi),
    encodeColorCyclePatchBytes(backwardPatchBytes, roi),
  ]);

  if (!forwardPatches.paint && !backwardPatches.paint) {
    return null;
  }

  return new ColorCycleStrokePatchDelta({
    layerId: options.layerId,
    width,
    height,
    roi,
    forwardPatches,
    backwardPatches,
  });
};
