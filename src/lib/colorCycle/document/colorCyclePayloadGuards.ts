import type { LayerColorCycleData } from '@/types';
import { getColorCycleLegacyLayerBuffer } from './legacyLayerBufferAccess';

export const hasCcPayload = (value: unknown): boolean => {
  if (value instanceof ArrayBuffer) {
    return value.byteLength > 0;
  }
  if (ArrayBuffer.isView(value)) {
    return value.byteLength > 0;
  }
  return typeof value === 'string' && value.length > 0;
};

export const bufferHasNonZeroPayload = (value: unknown): boolean => {
  let bytes: Uint8Array | null = null;
  if (value instanceof ArrayBuffer) {
    bytes = new Uint8Array(value);
  } else if (ArrayBuffer.isView(value)) {
    bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (!bytes) {
    return false;
  }
  for (let i = 0; i < bytes.length; i += 1) {
    if (bytes[i] !== 0) {
      return true;
    }
  }
  return false;
};

const serializedOrNonZeroBufferHasPayload = (value: unknown): boolean =>
  (typeof value === 'string' && value.length > 0) || bufferHasNonZeroPayload(value);

export const brushStateHasCcPayload = (brushState: unknown): boolean => {
  const snapshots = (brushState as { layers?: Array<{ strokeData?: Record<string, unknown> }> } | undefined)?.layers;
  return Boolean(snapshots?.some((snapshot) => {
    const strokeData = snapshot.strokeData;
    return Boolean(
      strokeData?.hasContent === true ||
      serializedOrNonZeroBufferHasPayload(strokeData?.paintBuffer) ||
      serializedOrNonZeroBufferHasPayload(strokeData?.gradientIdBuffer) ||
      serializedOrNonZeroBufferHasPayload(strokeData?.gradientDefIdBuffer)
    );
  }));
};

export const brushStateHasRuntimeStrokeBufferAuthority = (brushState: unknown): boolean => {
  const snapshots = (brushState as { layers?: Array<{ strokeData?: Record<string, unknown> }> } | undefined)?.layers;
  return Boolean(snapshots?.some((snapshot) => {
    const strokeData = snapshot.strokeData;
    return strokeData?.paintBuffer !== undefined
      || strokeData?.gradientIdBuffer !== undefined
      || strokeData?.gradientDefIdBuffer !== undefined
      || strokeData?.speedBuffer !== undefined
      || strokeData?.flowBuffer !== undefined
      || strokeData?.phaseBuffer !== undefined;
  }));
};

const hasExportableColorCycleBuffer = (value: unknown): boolean => {
  if (value instanceof ArrayBuffer) {
    return value.byteLength > 0;
  }
  if (ArrayBuffer.isView(value)) {
    return value.byteLength > 0;
  }
  if (typeof value === 'string') {
    return value.length > 0 && !value.startsWith('zip:');
  }
  return false;
};

export const persistedStrokeDataHasExportableColorCycleBuffers = ({
  colorCycleData,
  strokeData,
}: {
  colorCycleData: LayerColorCycleData | undefined;
  strokeData: unknown;
}): boolean => {
  if (!strokeData || typeof strokeData !== 'object') {
    return false;
  }
  const snapshot = strokeData as {
    paintBuffer?: unknown;
    gradientIdBuffer?: unknown;
    gradientDefIdBuffer?: unknown;
  };
  return (
    hasExportableColorCycleBuffer(snapshot.paintBuffer) &&
    (
      hasExportableColorCycleBuffer(snapshot.gradientIdBuffer) ||
      hasExportableColorCycleBuffer(getColorCycleLegacyLayerBuffer(colorCycleData, 'gradientIdBuffer'))
    ) &&
    (
      hasExportableColorCycleBuffer(snapshot.gradientDefIdBuffer) ||
      hasExportableColorCycleBuffer(getColorCycleLegacyLayerBuffer(colorCycleData, 'gradientDefIdBuffer'))
    )
  );
};
