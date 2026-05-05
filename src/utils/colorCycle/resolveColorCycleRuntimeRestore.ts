import type { Layer } from '@/types';
import type { GradientSeamProfile } from '@/lib/colorCycle/gradientSeamProfile';

export type CcRuntimeStrokeSnapshot = {
  paintBuffer: ArrayBuffer;
  gradientIdBuffer?: ArrayBuffer;
  gradientDefIdBuffer?: ArrayBuffer;
  speedBuffer?: ArrayBuffer;
  flowBuffer?: ArrayBuffer;
  phaseBuffer?: ArrayBuffer;
  hasContent: boolean;
  strokeCounter: number;
};

export type CcRuntimeAnimatorIndexSnapshot = {
  width: number;
  height: number;
  data: ArrayBuffer;
  gradientIdData?: ArrayBuffer;
  speedData?: ArrayBuffer;
  flowData?: ArrayBuffer;
  phaseData?: ArrayBuffer;
  gradientStops?: Array<{ position: number; color: string }>;
  gradientDefs?: Array<{ id: string; name?: string; currentSlot: number }>;
  slotPalettes?: Array<{
    slot: number;
    stops: Array<{ position: number; color: string }>;
    seamProfile?: GradientSeamProfile;
  }>;
  activeGradientId?: string;
  paintSlot?: number;
  legacyRemap?: { from: number; to: number };
};

export type CcRuntimeLayerSnapshot = {
  layerId: string;
  snapshot: CcRuntimeStrokeSnapshot;
  animatorIndex?: CcRuntimeAnimatorIndexSnapshot;
};

export type CcRuntimeRestoreAction =
  | { kind: 'apply'; snapshot: CcRuntimeStrokeSnapshot; animatorIndex?: CcRuntimeAnimatorIndexSnapshot }
  | { kind: 'recover-from-canonical'; snapshot: CcRuntimeStrokeSnapshot; animatorIndex?: CcRuntimeAnimatorIndexSnapshot }
  | { kind: 'allow-empty' }
  | { kind: 'block'; reason: 'canonical-paint-without-recoverable-snapshot' };

type SerializedBrushStateLike = {
  layers?: Array<{
    layerId?: string;
    strokeData?: Record<string, unknown>;
    animator?: {
      indexBuffer?: Record<string, unknown>;
      gradient?: { gradientStops?: Array<{ position: number; color: string }> };
    };
    gradientDefs?: Array<{ id: string; name?: string; currentSlot: number }>;
    slotPalettes?: Array<{
      slot: number;
      stops: Array<{ position: number; color: string }>;
      seamProfile?: GradientSeamProfile;
    }>;
    paintSlot?: number;
    legacyRemap?: { from: number; to: number };
    activeGradientId?: string;
  }>;
};

export const decodeBase64ArrayBuffer = (value: string): ArrayBuffer | undefined => {
  if (!value || value.startsWith('zip:')) {
    return undefined;
  }
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes.buffer;
  } catch {
    return undefined;
  }
};

export const normalizeCcPayloadArrayBuffer = (value: unknown): ArrayBuffer | undefined => {
  if (value instanceof ArrayBuffer) {
    return value.byteLength > 0 ? value.slice(0) : undefined;
  }
  if (ArrayBuffer.isView(value)) {
    if (value.byteLength === 0) {
      return undefined;
    }
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return bytes.slice().buffer;
  }
  if (typeof value === 'string') {
    const decoded = decodeBase64ArrayBuffer(value);
    return decoded && decoded.byteLength > 0 ? decoded : undefined;
  }
  return undefined;
};

export const ccPayloadHasNonZeroByte = (value: unknown): boolean => {
  const buffer = normalizeCcPayloadArrayBuffer(value);
  if (!buffer) {
    return false;
  }
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] !== 0) {
      return true;
    }
  }
  return false;
};

export const ccSnapshotHasPaintPayload = (
  snapshot: { paintBuffer?: ArrayBuffer; hasContent?: boolean } | ArrayBuffer | null | undefined,
): boolean => {
  if (snapshot instanceof ArrayBuffer) {
    return snapshot.byteLength > 0;
  }
  if (snapshot?.hasContent === true) {
    return true;
  }
  return ccPayloadHasNonZeroByte(snapshot?.paintBuffer);
};

export const brushStateHasColorCyclePaintPayload = (
  brushState: unknown,
  targetLayerId?: string,
): boolean => {
  const snapshots = (brushState as SerializedBrushStateLike | undefined)?.layers;
  return Boolean(snapshots?.some((snapshot) => {
    if (targetLayerId && snapshot.layerId !== targetLayerId) {
      return false;
    }
    const strokeData = snapshot.strokeData;
    return Boolean(
      strokeData?.hasContent === true ||
      ccPayloadHasNonZeroByte(strokeData?.paintBuffer)
    );
  }));
};

export const extractCanonicalBrushStateLayerSnapshot = (
  layer: Layer,
): CcRuntimeLayerSnapshot | null => {
  if (layer.layerType !== 'color-cycle' || !layer.colorCycleData) {
    return null;
  }
  const brushState = layer.colorCycleData.brushState as SerializedBrushStateLike | undefined;
  const serializedSnapshot = brushState?.layers?.find((snapshot) => snapshot.layerId === layer.id);
  const strokeData = serializedSnapshot?.strokeData;
  if (!strokeData) {
    return null;
  }
  const paintBuffer = normalizeCcPayloadArrayBuffer(strokeData.paintBuffer);
  const hasContent = strokeData.hasContent === true;
  if (!paintBuffer || (!hasContent && !ccPayloadHasNonZeroByte(paintBuffer))) {
    return null;
  }
  const gradientIdBuffer = normalizeCcPayloadArrayBuffer(strokeData.gradientIdBuffer)
    ?? (layer.colorCycleData.gradientIdBuffer instanceof ArrayBuffer
      ? layer.colorCycleData.gradientIdBuffer.slice(0)
      : undefined);
  const gradientDefIdBuffer = normalizeCcPayloadArrayBuffer(strokeData.gradientDefIdBuffer)
    ?? (layer.colorCycleData.gradientDefIdBuffer instanceof ArrayBuffer
      ? layer.colorCycleData.gradientDefIdBuffer.slice(0)
      : undefined);
  const animatorIndexBuffer = serializedSnapshot?.animator?.indexBuffer;
  const animatorData = normalizeCcPayloadArrayBuffer(animatorIndexBuffer?.data);
  return {
    layerId: layer.id,
    snapshot: {
      paintBuffer,
      gradientIdBuffer,
      gradientDefIdBuffer,
      speedBuffer: normalizeCcPayloadArrayBuffer(strokeData.speedBuffer),
      flowBuffer: normalizeCcPayloadArrayBuffer(strokeData.flowBuffer),
      phaseBuffer: normalizeCcPayloadArrayBuffer(strokeData.phaseBuffer),
      hasContent: true,
      strokeCounter: typeof strokeData.strokeCounter === 'number' ? strokeData.strokeCounter : 0,
    },
    animatorIndex: animatorData
      ? {
          width: typeof animatorIndexBuffer?.width === 'number' ? animatorIndexBuffer.width : 0,
          height: typeof animatorIndexBuffer?.height === 'number' ? animatorIndexBuffer.height : 0,
          data: animatorData,
          gradientIdData: normalizeCcPayloadArrayBuffer(animatorIndexBuffer?.gradientId),
          speedData: normalizeCcPayloadArrayBuffer(animatorIndexBuffer?.speedData),
          flowData: normalizeCcPayloadArrayBuffer(animatorIndexBuffer?.flowData),
          phaseData: normalizeCcPayloadArrayBuffer(animatorIndexBuffer?.phaseData),
          gradientStops: serializedSnapshot.animator?.gradient?.gradientStops,
          gradientDefs: serializedSnapshot.gradientDefs,
          slotPalettes: serializedSnapshot.slotPalettes,
          paintSlot: serializedSnapshot.paintSlot,
          legacyRemap: serializedSnapshot.legacyRemap,
          activeGradientId: serializedSnapshot.activeGradientId,
        }
      : undefined,
  };
};

export const layerHasCanonicalColorCyclePaintPayload = (layer: Layer | undefined): boolean => {
  if (!layer || layer.layerType !== 'color-cycle' || !layer.colorCycleData) {
    return false;
  }
  const documentState = (layer as unknown as {
    state?: {
      hasContent?: boolean;
      paintRef?: unknown;
    };
  }).state;
  return Boolean(
    documentState?.hasContent === true ||
    ccPayloadHasNonZeroByte(documentState?.paintRef) ||
    layer.colorCycleData.hasContent === true ||
    brushStateHasColorCyclePaintPayload(layer.colorCycleData.brushState, layer.id) ||
    layer.colorCycleData.repairStatus?.ok === false
  );
};

export const resolveColorCycleRuntimeRestore = (params: {
  layer: Layer;
  incomingSnapshot?: { paintBuffer?: ArrayBuffer; hasContent?: boolean } | ArrayBuffer | null;
  projectLoadRestore: boolean;
}): CcRuntimeRestoreAction => {
  if (!params.projectLoadRestore) {
    return ccSnapshotHasPaintPayload(params.incomingSnapshot)
      ? { kind: 'apply', snapshot: params.incomingSnapshot as CcRuntimeStrokeSnapshot }
      : { kind: 'allow-empty' };
  }
  if (ccSnapshotHasPaintPayload(params.incomingSnapshot)) {
    return { kind: 'apply', snapshot: params.incomingSnapshot as CcRuntimeStrokeSnapshot };
  }
  if (!layerHasCanonicalColorCyclePaintPayload(params.layer)) {
    return { kind: 'allow-empty' };
  }
  const canonical = extractCanonicalBrushStateLayerSnapshot(params.layer);
  if (canonical) {
    return {
      kind: 'recover-from-canonical',
      snapshot: canonical.snapshot,
      animatorIndex: canonical.animatorIndex,
    };
  }
  return { kind: 'block', reason: 'canonical-paint-without-recoverable-snapshot' };
};
