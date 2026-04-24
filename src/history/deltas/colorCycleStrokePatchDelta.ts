import type { ColorCycleBrushCanvas2D } from '@/hooks/brushEngine/ColorCycleBrushCanvas2D';
import { getColorCycleBrushManager, getColorCycleStoreState } from '@/stores/colorCycleBrushManager';
import { useAppStore } from '@/stores/useAppStore';
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

type PaintPatch = {
  roi: { x: number; y: number; width: number; height: number };
  blobId: string;
  encoding: PatchEncoding;
  approxBytes: number;
};

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

const extractPaintBuffer = (
  state: ColorCycleBrushState | null,
  layerId: string,
  expectedSize: number
): Uint8Array | null => {
  if (!state?.layers) {
    return null;
  }
  const layer = state.layers.find((candidate: ColorCycleSerializedLayer) => candidate.layerId === layerId);
  const buffer = (
    layer?.strokeData?.paintBuffer ??
    layer?.data?.indexBuffer?.data
  ) as ArrayBuffer | ArrayBufferView | undefined;
  if (!buffer) {
    return null;
  }
  const bytes =
    buffer instanceof ArrayBuffer
      ? new Uint8Array(buffer)
      : ArrayBuffer.isView(buffer)
        ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
        : null;
  if (!bytes || bytes.length < expectedSize) {
    return null;
  }
  return bytes;
};

const extractGradientIdBuffer = (
  state: ColorCycleBrushState | null,
  layerId: string,
  expectedSize: number
): Uint8Array | null => {
  if (!state?.layers) {
    return null;
  }
  const layer = state.layers.find((candidate: ColorCycleSerializedLayer) => candidate.layerId === layerId);
  const buffer = (
    layer?.strokeData?.gradientIdBuffer ??
    layer?.data?.indexBuffer?.gradientId
  ) as ArrayBuffer | ArrayBufferView | undefined;
  if (!buffer) {
    return null;
  }
  const bytes =
    buffer instanceof ArrayBuffer
      ? new Uint8Array(buffer)
      : ArrayBuffer.isView(buffer)
        ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
        : null;
  if (!bytes || bytes.length < expectedSize) {
    return null;
  }
  return bytes;
};

const extractGradientDefIdBuffer = (
  state: ColorCycleBrushState | null,
  layerId: string,
  expectedSize: number
): Uint16Array | null => {
  if (!state?.layers) {
    return null;
  }
  const layer = state.layers.find((candidate: ColorCycleSerializedLayer) => candidate.layerId === layerId);
  const buffer = layer?.strokeData?.gradientDefIdBuffer as ArrayBuffer | ArrayBufferView | undefined;
  if (!buffer) {
    return null;
  }
  const values =
    buffer instanceof ArrayBuffer
      ? new Uint16Array(buffer)
      : ArrayBuffer.isView(buffer)
        ? new Uint16Array(buffer.buffer, buffer.byteOffset, Math.floor(buffer.byteLength / Uint16Array.BYTES_PER_ELEMENT))
        : null;
  if (!values || values.length < expectedSize) {
    return null;
  }
  return values;
};

const extractSpeedBuffer = (
  state: ColorCycleBrushState | null,
  layerId: string,
  expectedSize: number
): Uint8Array | null => {
  if (!state?.layers) {
    return null;
  }
  const layer = state.layers.find((candidate: ColorCycleSerializedLayer) => candidate.layerId === layerId);
  const buffer = (
    layer?.strokeData?.speedBuffer ??
    layer?.data?.indexBuffer?.speedData
  ) as ArrayBuffer | ArrayBufferView | undefined;
  if (!buffer) {
    return null;
  }
  const bytes =
    buffer instanceof ArrayBuffer
      ? new Uint8Array(buffer)
      : ArrayBuffer.isView(buffer)
        ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
        : null;
  if (!bytes || bytes.length < expectedSize) {
    return null;
  }
  return bytes;
};

const extractFlowBuffer = (
  state: ColorCycleBrushState | null,
  layerId: string,
  expectedSize: number
): Uint8Array | null => {
  if (!state?.layers) {
    return null;
  }
  const layer = state.layers.find((candidate: ColorCycleSerializedLayer) => candidate.layerId === layerId);
  const buffer = (
    layer?.strokeData?.flowBuffer ??
    layer?.data?.indexBuffer?.flowData
  ) as ArrayBuffer | ArrayBufferView | undefined;
  if (!buffer) {
    return null;
  }
  const bytes =
    buffer instanceof ArrayBuffer
      ? new Uint8Array(buffer)
      : ArrayBuffer.isView(buffer)
        ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
        : null;
  if (!bytes || bytes.length < expectedSize) {
    return null;
  }
  return bytes;
};

const extractPhaseBuffer = (
  state: ColorCycleBrushState | null,
  layerId: string,
  expectedSize: number
): Uint8Array | null => {
  if (!state?.layers) {
    return null;
  }
  const layer = state.layers.find((candidate: ColorCycleSerializedLayer) => candidate.layerId === layerId);
  const buffer = (
    layer?.strokeData?.phaseBuffer ??
    layer?.data?.indexBuffer?.phaseData
  ) as ArrayBuffer | ArrayBufferView | undefined;
  if (!buffer) {
    return null;
  }
  const bytes =
    buffer instanceof ArrayBuffer
      ? new Uint8Array(buffer)
      : ArrayBuffer.isView(buffer)
        ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
        : null;
  if (!bytes || bytes.length < expectedSize) {
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

const extractRoiPatchU16 = (
  source: Uint16Array,
  width: number,
  height: number,
  roi: { x: number; y: number; width: number; height: number }
): Uint8Array => {
  const output = new Uint16Array(roi.width * roi.height);
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
  return new Uint8Array(output.buffer);
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

class ColorCycleStrokePatchDelta implements HistoryDelta {
  readonly _tag = 'color-cycle-stroke-patch';
  readonly approxBytes?: number;

  readonly layerId: string;
  private readonly width: number;
  private readonly height: number;
  private readonly roi: { x: number; y: number; width: number; height: number };
  private readonly forwardPaint: PaintPatch | null;
  private readonly backwardPaint: PaintPatch | null;
  private readonly forwardGradientId: PaintPatch | null;
  private readonly backwardGradientId: PaintPatch | null;
  private readonly forwardGradientDefId: PaintPatch | null;
  private readonly backwardGradientDefId: PaintPatch | null;
  private readonly forwardSpeed: PaintPatch | null;
  private readonly backwardSpeed: PaintPatch | null;
  private readonly forwardFlow: PaintPatch | null;
  private readonly backwardFlow: PaintPatch | null;
  private readonly forwardPhase: PaintPatch | null;
  private readonly backwardPhase: PaintPatch | null;

  constructor(options: {
    layerId: string;
    width: number;
    height: number;
    roi: { x: number; y: number; width: number; height: number };
    forwardPaint: PaintPatch | null;
    backwardPaint: PaintPatch | null;
    forwardGradientId: PaintPatch | null;
    backwardGradientId: PaintPatch | null;
    forwardGradientDefId: PaintPatch | null;
    backwardGradientDefId: PaintPatch | null;
    forwardSpeed: PaintPatch | null;
    backwardSpeed: PaintPatch | null;
    forwardFlow: PaintPatch | null;
    backwardFlow: PaintPatch | null;
    forwardPhase: PaintPatch | null;
    backwardPhase: PaintPatch | null;
  }) {
    this.layerId = options.layerId;
    this.width = options.width;
    this.height = options.height;
    this.roi = options.roi;
    this.forwardPaint = options.forwardPaint;
    this.backwardPaint = options.backwardPaint;
    this.forwardGradientId = options.forwardGradientId;
    this.backwardGradientId = options.backwardGradientId;
    this.forwardGradientDefId = options.forwardGradientDefId;
    this.backwardGradientDefId = options.backwardGradientDefId;
    this.forwardSpeed = options.forwardSpeed;
    this.backwardSpeed = options.backwardSpeed;
    this.forwardFlow = options.forwardFlow;
    this.backwardFlow = options.backwardFlow;
    this.forwardPhase = options.forwardPhase;
    this.backwardPhase = options.backwardPhase;
    this.approxBytes =
      (options.forwardPaint?.approxBytes ?? 0) +
      (options.backwardPaint?.approxBytes ?? 0) +
      (options.forwardGradientId?.approxBytes ?? 0) +
      (options.backwardGradientId?.approxBytes ?? 0) +
      (options.forwardGradientDefId?.approxBytes ?? 0) +
      (options.backwardGradientDefId?.approxBytes ?? 0) +
      (options.forwardSpeed?.approxBytes ?? 0) +
      (options.backwardSpeed?.approxBytes ?? 0) +
      (options.forwardFlow?.approxBytes ?? 0) +
      (options.backwardFlow?.approxBytes ?? 0) +
      (options.forwardPhase?.approxBytes ?? 0) +
      (options.backwardPhase?.approxBytes ?? 0);
  }

  async apply(direction: HistoryDirection): Promise<void> {
    const patch = direction === 'forward' ? this.forwardPaint : this.backwardPaint;
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

    const stored = await readBlob(patch.blobId);
    if (!stored) {
      return;
    }
    const decoded =
      patch.encoding === 'rle' ? decodeRLE(stored.data) : stored.data;
    const gradientPatch = direction === 'forward' ? this.forwardGradientId : this.backwardGradientId;
    const gradientDefPatch = direction === 'forward' ? this.forwardGradientDefId : this.backwardGradientDefId;
    const speedPatch = direction === 'forward' ? this.forwardSpeed : this.backwardSpeed;
    const flowPatch = direction === 'forward' ? this.forwardFlow : this.backwardFlow;
    const phasePatch = direction === 'forward' ? this.forwardPhase : this.backwardPhase;
    const decodeOptionalPatch = async (source: PaintPatch | null): Promise<Uint8Array | undefined> => {
      if (!source) {
        return undefined;
      }
      const blob = await readBlob(source.blobId);
      if (!blob) {
        return undefined;
      }
      return source.encoding === 'rle' ? decodeRLE(blob.data) : blob.data;
    };
    const [gradientIdBytes, gradientDefIdBytes, speedBytes, flowBytes, phaseBytes] = await Promise.all([
      decodeOptionalPatch(gradientPatch),
      decodeOptionalPatch(gradientDefPatch),
      decodeOptionalPatch(speedPatch),
      decodeOptionalPatch(flowPatch),
      decodeOptionalPatch(phasePatch),
    ]);

    const hasContent = brush.applyPaintPatch(this.layerId, patch.roi, decoded, {
      gradientIdBytes,
      gradientDefIdBytes,
      speedBytes,
      flowBytes,
      phaseBytes,
    });

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
    const blobs = [
      this.forwardPaint,
      this.backwardPaint,
      this.forwardGradientId,
      this.backwardGradientId,
      this.forwardGradientDefId,
      this.backwardGradientDefId,
      this.forwardSpeed,
      this.backwardSpeed,
      this.forwardFlow,
      this.backwardFlow,
      this.forwardPhase,
      this.backwardPhase,
    ];
    for (const patch of blobs) {
      if (patch) {
        releaseBlob(patch.blobId);
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

  const expectedSize = width * height;
  const forwardBuffer = extractPaintBuffer(options.forwardState, options.layerId, expectedSize);
  const backwardBuffer = extractPaintBuffer(options.backwardState, options.layerId, expectedSize);
  const forwardGradientIdBuffer = extractGradientIdBuffer(options.forwardState, options.layerId, expectedSize);
  const backwardGradientIdBuffer = extractGradientIdBuffer(options.backwardState, options.layerId, expectedSize);
  const forwardGradientDefIdBuffer = extractGradientDefIdBuffer(options.forwardState, options.layerId, expectedSize);
  const backwardGradientDefIdBuffer = extractGradientDefIdBuffer(options.backwardState, options.layerId, expectedSize);
  const forwardSpeedBuffer = extractSpeedBuffer(options.forwardState, options.layerId, expectedSize);
  const backwardSpeedBuffer = extractSpeedBuffer(options.backwardState, options.layerId, expectedSize);
  const forwardFlowBuffer = extractFlowBuffer(options.forwardState, options.layerId, expectedSize);
  const backwardFlowBuffer = extractFlowBuffer(options.backwardState, options.layerId, expectedSize);
  const forwardPhaseBuffer = extractPhaseBuffer(options.forwardState, options.layerId, expectedSize);
  const backwardPhaseBuffer = extractPhaseBuffer(options.backwardState, options.layerId, expectedSize);
  if (!forwardBuffer && !backwardBuffer) {
    return null;
  }

  const forwardPatchBytes = forwardBuffer ? extractRoiPatch(forwardBuffer, width, height, roi) : null;
  const backwardPatchBytes = backwardBuffer
    ? extractRoiPatch(backwardBuffer, width, height, roi)
    : forwardPatchBytes
      ? new Uint8Array(roi.width * roi.height)
      : null;
  const forwardGradientIdBytes = forwardGradientIdBuffer
    ? extractRoiPatch(forwardGradientIdBuffer, width, height, roi)
    : null;
  const backwardGradientIdBytes = backwardGradientIdBuffer
    ? extractRoiPatch(backwardGradientIdBuffer, width, height, roi)
    : forwardGradientIdBytes
      ? new Uint8Array(roi.width * roi.height)
    : null;
  const forwardGradientDefIdBytes = forwardGradientDefIdBuffer
    ? extractRoiPatchU16(forwardGradientDefIdBuffer, width, height, roi)
    : null;
  const backwardGradientDefIdBytes = backwardGradientDefIdBuffer
    ? extractRoiPatchU16(backwardGradientDefIdBuffer, width, height, roi)
    : forwardGradientDefIdBytes
      ? new Uint8Array(roi.width * roi.height * Uint16Array.BYTES_PER_ELEMENT)
    : null;
  const forwardSpeedBytes = forwardSpeedBuffer ? extractRoiPatch(forwardSpeedBuffer, width, height, roi) : null;
  const backwardSpeedBytes = backwardSpeedBuffer
    ? extractRoiPatch(backwardSpeedBuffer, width, height, roi)
    : forwardSpeedBytes
      ? new Uint8Array(roi.width * roi.height)
      : null;
  const forwardFlowBytes = forwardFlowBuffer ? extractRoiPatch(forwardFlowBuffer, width, height, roi) : null;
  const backwardFlowBytes = backwardFlowBuffer
    ? extractRoiPatch(backwardFlowBuffer, width, height, roi)
    : forwardFlowBytes
      ? new Uint8Array(roi.width * roi.height)
      : null;
  const forwardPhaseBytes = forwardPhaseBuffer ? extractRoiPatch(forwardPhaseBuffer, width, height, roi) : null;
  const backwardPhaseBytes = backwardPhaseBuffer
    ? extractRoiPatch(backwardPhaseBuffer, width, height, roi)
    : forwardPhaseBytes
      ? new Uint8Array(roi.width * roi.height)
      : null;

  if (forwardPatchBytes && backwardPatchBytes && patchesEqual(forwardPatchBytes, backwardPatchBytes)) {
    const gradientEqual =
      (!forwardGradientIdBytes && !backwardGradientIdBytes) ||
      (forwardGradientIdBytes && backwardGradientIdBytes && patchesEqual(forwardGradientIdBytes, backwardGradientIdBytes));
    const speedEqual =
      (!forwardSpeedBytes && !backwardSpeedBytes) ||
      (forwardSpeedBytes && backwardSpeedBytes && patchesEqual(forwardSpeedBytes, backwardSpeedBytes));
    const flowEqual =
      (!forwardFlowBytes && !backwardFlowBytes) ||
      (forwardFlowBytes && backwardFlowBytes && patchesEqual(forwardFlowBytes, backwardFlowBytes));
    const gradientDefEqual =
      (!forwardGradientDefIdBytes && !backwardGradientDefIdBytes) ||
      (forwardGradientDefIdBytes && backwardGradientDefIdBytes && patchesEqual(forwardGradientDefIdBytes, backwardGradientDefIdBytes));
    const phaseEqual =
      (!forwardPhaseBytes && !backwardPhaseBytes) ||
      (forwardPhaseBytes && backwardPhaseBytes && patchesEqual(forwardPhaseBytes, backwardPhaseBytes));
    if (gradientEqual && gradientDefEqual && speedEqual && flowEqual && phaseEqual) return null;
  }

  const forwardPaint = forwardPatchBytes ? await encodePatchData(forwardPatchBytes) : null;
  const backwardPaint = backwardPatchBytes ? await encodePatchData(backwardPatchBytes) : null;
  const forwardGradientId = forwardGradientIdBytes ? await encodePatchData(forwardGradientIdBytes) : null;
  const backwardGradientId = backwardGradientIdBytes ? await encodePatchData(backwardGradientIdBytes) : null;
  const forwardGradientDefId = forwardGradientDefIdBytes ? await encodePatchData(forwardGradientDefIdBytes) : null;
  const backwardGradientDefId = backwardGradientDefIdBytes ? await encodePatchData(backwardGradientDefIdBytes) : null;
  const forwardSpeed = forwardSpeedBytes ? await encodePatchData(forwardSpeedBytes) : null;
  const backwardSpeed = backwardSpeedBytes ? await encodePatchData(backwardSpeedBytes) : null;
  const forwardFlow = forwardFlowBytes ? await encodePatchData(forwardFlowBytes) : null;
  const backwardFlow = backwardFlowBytes ? await encodePatchData(backwardFlowBytes) : null;
  const forwardPhase = forwardPhaseBytes ? await encodePatchData(forwardPhaseBytes) : null;
  const backwardPhase = backwardPhaseBytes ? await encodePatchData(backwardPhaseBytes) : null;

  if (!forwardPaint && !backwardPaint) {
    return null;
  }

  return new ColorCycleStrokePatchDelta({
    layerId: options.layerId,
    width,
    height,
    roi,
    forwardPaint: forwardPaint
      ? { ...forwardPaint, roi }
      : null,
    backwardPaint: backwardPaint
      ? { ...backwardPaint, roi }
      : null,
    forwardGradientId: forwardGradientId ? { ...forwardGradientId, roi } : null,
    backwardGradientId: backwardGradientId ? { ...backwardGradientId, roi } : null,
    forwardGradientDefId: forwardGradientDefId ? { ...forwardGradientDefId, roi } : null,
    backwardGradientDefId: backwardGradientDefId ? { ...backwardGradientDefId, roi } : null,
    forwardSpeed: forwardSpeed ? { ...forwardSpeed, roi } : null,
    backwardSpeed: backwardSpeed ? { ...backwardSpeed, roi } : null,
    forwardFlow: forwardFlow ? { ...forwardFlow, roi } : null,
    backwardFlow: backwardFlow ? { ...backwardFlow, roi } : null,
    forwardPhase: forwardPhase ? { ...forwardPhase, roi } : null,
    backwardPhase: backwardPhase ? { ...backwardPhase, roi } : null,
  });
};
