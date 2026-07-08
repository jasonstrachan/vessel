import {
  applyColorCycleBrushPaintPatchToRuntime,
  canApplyColorCycleBrushPaintPatchToRuntime,
  COLOR_CYCLE_DOCUMENT_CANONICAL_PIXEL_BUFFERS,
  type ColorCycleLayerDocumentRead,
  type ColorCycleBrushSerializedState,
  type ColorCycleBrushPaintPatchRuntimeWriter,
} from '@/lib/colorCycle/document';
import type { ColorCycleHistoryBrushContext } from '@/hooks/brushEngine/colorCycleBrushContracts';
import { getColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import { useAppStore } from '@/stores/useAppStore';
import {
  logCCMutation,
  summarizeColorCycleLayer,
  summarizeScalarBuffer,
} from '@/utils/colorCycle/ccMutationAudit';
import type { HistoryDelta, HistoryDirection, HistoryRehydrationTargets } from '../actionTypes';
import { readBlob, releaseBlob, storeBlob } from '../blobStore';
import { HistoryBlobReadError, HistoryReplayDriftError } from '../errors';

type ColorCycleBrushState = ColorCycleBrushSerializedState;
type ColorCycleSerializedLayer = NonNullable<ColorCycleBrushState['layers']>[number];

type ManagedColorCycleBrush = ColorCycleHistoryBrushContext & ColorCycleBrushPaintPatchRuntimeWriter & {
  getColorCycleLayerDocument?: (layerId: string) => { read(): ColorCycleLayerDocumentRead } | null | undefined;
  getColorCycleDerivedSurface?: (layerId: string) => {
    builtFromVersion: number | null;
    rebuild(snapshot: ColorCycleLayerDocumentRead['snapshot'], version: number): void;
  } | null | undefined;
};
type ManagedColorCycleDocument = {
  read(): ColorCycleLayerDocumentRead;
  rebaseVersionAnchors?: (options: {
    version?: number;
    pixelVersion?: number;
  }) => ColorCycleLayerDocumentRead;
};

type PatchEncoding = 'raw' | 'rle';

export const COLOR_CYCLE_PIXEL_PATCH_BUFFER_KEYS =
  COLOR_CYCLE_DOCUMENT_CANONICAL_PIXEL_BUFFERS.map((buffer) => buffer.historyKey);

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

const readPixelBuffer = (
  key: ColorCyclePixelPatchBufferKey,
  layer: ColorCycleSerializedLayer,
): ArrayBuffer | ArrayBufferView | undefined => {
  switch (key) {
    case 'paint':
      return layer.strokeData?.paintBuffer ?? layer.data?.indexBuffer?.data;
    case 'gradientId':
      return layer.strokeData?.gradientIdBuffer ?? layer.data?.indexBuffer?.gradientId;
    case 'gradientDefId':
      return layer.strokeData?.gradientDefIdBuffer;
    case 'speed':
      return layer.strokeData?.speedBuffer ?? layer.data?.indexBuffer?.speedData;
    case 'flow':
      return layer.strokeData?.flowBuffer ?? layer.data?.indexBuffer?.flowData;
    case 'phase':
      return layer.strokeData?.phaseBuffer ?? layer.data?.indexBuffer?.phaseData;
    default: {
      const exhaustive: never = key;
      return exhaustive;
    }
  }
};

const COLOR_CYCLE_PIXEL_BUFFER_SPECS: readonly ColorCyclePixelBufferSpec[] =
  COLOR_CYCLE_DOCUMENT_CANONICAL_PIXEL_BUFFERS.map((buffer) => ({
    key: buffer.historyKey,
    bytesPerPixel: buffer.bytesPerPixel,
    read: (layer) => readPixelBuffer(buffer.historyKey, layer),
  }));

export interface ColorCycleStrokePatchDeltaOptions {
  layerId: string;
  width: number;
  height: number;
  roi: { x: number; y: number; width: number; height: number };
  forwardState: ColorCycleBrushState | null;
  backwardState: ColorCycleBrushState | null;
  beforeDocumentVersion?: number;
  afterDocumentVersion?: number;
  beforeVersion?: number;
  afterVersion?: number;
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
  if (
    roi.x >= 0 &&
    roi.y >= 0 &&
    roi.x + roi.width <= width &&
    roi.y + roi.height <= height
  ) {
    let targetIndex = 0;
    for (let row = 0; row < roi.height; row += 1) {
      const srcStart = (roi.y + row) * width + roi.x;
      output.set(source.subarray(srcStart, srcStart + roi.width), targetIndex);
      targetIndex += roi.width;
    }
    return output;
  }

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
  if (
    roi.x >= 0 &&
    roi.y >= 0 &&
    roi.x + roi.width <= width &&
    roi.y + roi.height <= height
  ) {
    const rowBytes = roi.width * bytesPerPixel;
    let targetIndex = 0;
    for (let row = 0; row < roi.height; row += 1) {
      const srcStart = ((roi.y + row) * width + roi.x) * bytesPerPixel;
      output.set(source.subarray(srcStart, srcStart + rowBytes), targetIndex);
      targetIndex += rowBytes;
    }
    return output;
  }

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

const patchHasNonZero = (patch: Uint8Array | null): boolean =>
  Boolean(patch?.some((value) => value !== 0));

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
    return false;
  }
  if (strokeData.hasContent === true) {
    return false;
  }
  if (strokeData.hasContent === false) {
    const directBuffers = [
      strokeData.paintBuffer,
      strokeData.gradientIdBuffer,
      strokeData.gradientDefIdBuffer,
      strokeData.speedBuffer,
      strokeData.flowBuffer,
      strokeData.phaseBuffer,
    ];
    return directBuffers.every((value) => {
      if (!value) {
        return true;
      }
      if (value instanceof ArrayBuffer) {
        return value.byteLength === 0;
      }
      return false;
    });
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

const decodePatch = async (
  patch: PaintPatch | null,
  direction: HistoryDirection,
  layerId: string
): Promise<Uint8Array | undefined> => {
  if (!patch) {
    return undefined;
  }
  const blob = await readBlob(patch.blobId);
  if (!blob) {
    throw new HistoryBlobReadError({
      deltaTag: 'color-cycle-stroke-patch',
      direction,
      layerId,
      expected: patch.blobId,
      actual: null,
      reason: 'missing-color-cycle-patch-blob',
    });
  }
  return patch.encoding === 'rle' ? decodeRLE(blob.data) : blob.data;
};

const decodeColorCyclePatchSet = async (
  patches: EncodedColorCyclePixelPatches,
  direction: HistoryDirection,
  layerId: string
): Promise<ColorCyclePixelPatchBytes> => {
  const decoded = emptyColorCyclePatchBytes();
  await Promise.all(
    COLOR_CYCLE_PIXEL_PATCH_BUFFER_KEYS.map(async (key) => {
      decoded[key] = (await decodePatch(patches[key], direction, layerId)) ?? null;
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

const clipPatchDirtyRect = (
  roi: { x: number; y: number; width: number; height: number },
  maxWidth: number,
  maxHeight: number,
) => {
  const x = Math.max(0, Math.floor(roi.x));
  const y = Math.max(0, Math.floor(roi.y));
  const right = Math.min(maxWidth, Math.ceil(roi.x + roi.width));
  const bottom = Math.min(maxHeight, Math.ceil(roi.y + roi.height));
  const width = Math.max(0, right - x);
  const height = Math.max(0, bottom - y);
  return width > 0 && height > 0 ? { x, y, width, height } : null;
};

class ColorCycleStrokePatchDelta implements HistoryDelta {
  readonly _tag = 'color-cycle-stroke-patch';
  readonly approxBytes?: number;

  readonly layerId: string;
  private readonly width: number;
  private readonly height: number;
  private readonly roi: { x: number; y: number; width: number; height: number };
  private readonly forwardPatches: EncodedColorCyclePixelPatches;
  private readonly backwardPatches: EncodedColorCyclePixelPatches;
  private readonly beforeDocumentVersion?: number;
  private readonly afterDocumentVersion?: number;
  private readonly beforeVersion?: number;
  private readonly afterVersion?: number;

  constructor(options: {
    layerId: string;
    width: number;
    height: number;
    roi: { x: number; y: number; width: number; height: number };
    forwardPatches: EncodedColorCyclePixelPatches;
    backwardPatches: EncodedColorCyclePixelPatches;
    beforeDocumentVersion?: number;
    afterDocumentVersion?: number;
    beforeVersion?: number;
    afterVersion?: number;
  }) {
    this.layerId = options.layerId;
    this.width = options.width;
    this.height = options.height;
    this.roi = options.roi;
    this.forwardPatches = options.forwardPatches;
    this.backwardPatches = options.backwardPatches;
    this.beforeDocumentVersion = options.beforeDocumentVersion;
    this.afterDocumentVersion = options.afterDocumentVersion;
    this.beforeVersion = options.beforeVersion;
    this.afterVersion = options.afterVersion;
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

    if (!manager.getHistoryBrush(this.layerId)) {
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

    const brush = manager.getHistoryBrush(this.layerId) as ManagedColorCycleBrush | undefined;
    const targetCanvas = layer.colorCycleData.canvas;
    if (!brush || !targetCanvas || !canApplyColorCycleBrushPaintPatchToRuntime(brush)) {
      return;
    }

    const decoded = await decodeColorCyclePatchSet(patches, direction, this.layerId);
    if (!decoded.paint) {
      return;
    }

    const expectedVersion = direction === 'forward' ? this.beforeVersion : this.afterVersion;
    const document = (manager.getDocument(this.layerId) ??
      (typeof brush.getColorCycleLayerDocument === 'function'
        ? brush.getColorCycleLayerDocument(this.layerId) ?? undefined
        : undefined)) as ManagedColorCycleDocument | undefined;
    const documentRead = document?.read?.() ??
      brush.getColorCycleLayerDocument?.(this.layerId)?.read?.();
    if (
      typeof expectedVersion === 'number' &&
      documentRead &&
      documentRead.pixelVersion !== expectedVersion
    ) {
      logCCMutation({
        event: 'history-cc-document-version-mismatch',
        layerId: this.layerId,
        reason: direction === 'backward' ? 'history-undo-patch' : 'history-redo-patch',
        severity: 'warn',
        before: summarizeColorCycleLayer(layer),
        after: summarizeColorCycleLayer(layer),
        details: {
          source: 'history-color-cycle-stroke-patch',
          operation: direction === 'backward' ? 'undo' : 'redo',
          direction,
          expectedVersion,
          actualVersion: documentRead.pixelVersion,
          documentVersion: documentRead.version,
        },
      });
      throw new HistoryReplayDriftError({
        deltaTag: this._tag,
        direction,
        layerId: this.layerId,
        expected: expectedVersion,
        actual: documentRead.pixelVersion,
        reason: 'pixel-version-mismatch',
      });
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

    const beforeAudit = summarizeColorCycleLayer(layer);
    const beforeHasContent = Boolean(layer.colorCycleData.hasContent);
    const patchPaintSummary = summarizeScalarBuffer(decoded.paint, patch.roi.width, patch.roi.height);
    const hasContent = applyColorCycleBrushPaintPatchToRuntime(
      brush,
      this.layerId,
      patch.roi,
      decoded.paint,
      patchSetRuntimeExtras(decoded)
    );
    const targetPixelVersion = direction === 'forward' ? this.afterVersion : this.beforeVersion;
    const targetDocumentVersion = direction === 'forward'
      ? this.afterDocumentVersion
      : this.beforeDocumentVersion;
    if (
      typeof document?.rebaseVersionAnchors === 'function' &&
      (typeof targetPixelVersion === 'number' || typeof targetDocumentVersion === 'number')
    ) {
      const rebasedRead = document.rebaseVersionAnchors({
        version: targetDocumentVersion,
        pixelVersion: targetPixelVersion,
      });
      const derivedSurface = brush.getColorCycleDerivedSurface?.(this.layerId);
      derivedSurface?.rebuild(rebasedRead.snapshot, rebasedRead.version);
    }
    if (beforeHasContent && !hasContent) {
      logCCMutation({
        event: 'color-cycle-layer-cleared',
        layerId: this.layerId,
        reason: direction === 'backward' ? 'history-undo-patch' : 'history-redo-patch',
        severity: 'info',
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
      const dirtyRect = clipPatchDirtyRect(patch.roi, this.width, this.height);
      if (latestLayer?.colorCycleData) {
        latest.updateLayer(
          this.layerId,
          {
            colorCycleData: { ...latestLayer.colorCycleData, hasContent },
          },
          dirtyRect ? { dirtyRects: [dirtyRect] } : undefined,
        );
      } else if (dirtyRect) {
        latest.markCompositeSegmentsDirtyByLayerIds([this.layerId], {
          dirtyRectsByLayerId: new Map([[this.layerId, [dirtyRect]]]),
        });
      }
    } catch {}

    useAppStore.setState({ layersNeedRecomposition: true });
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
  const backwardLayer = findSerializedLayer(options.backwardState, options.layerId);
  const forwardPaintHasContent = patchHasNonZero(forwardPatchBytes.paint);
  if (
    forwardPaintHasContent &&
    backwardLayer &&
    !backwardLayer.strokeData &&
    !backwardPatchBytes.paint
  ) {
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
        forwardPaint: forwardPatchBytes.paint
          ? summarizeScalarBuffer(forwardPatchBytes.paint, roi.width, roi.height)
          : null,
        message: 'Skipped CC history delta because undo would rely on a layer shell without stroke data.',
      },
    });
    return null;
  }
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
    beforeDocumentVersion: options.beforeDocumentVersion,
    afterDocumentVersion: options.afterDocumentVersion,
    beforeVersion: options.beforeVersion,
    afterVersion: options.afterVersion,
  });
};
