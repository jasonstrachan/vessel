import type { LayerColorCycleData } from '@/types';

export type LegacyColorCycleTopLevelBuffers = {
  gradientIdBuffer?: ArrayBuffer;
  gradientDefIdBuffer?: ArrayBuffer;
  phaseBuffer?: ArrayBuffer;
  smoothPhaseBuffer?: ArrayBuffer;
  smoothFlagsBuffer?: ArrayBuffer;
};

export type LegacyColorCycleTopLevelBufferRefs = {
  gradientIdBuffer?: ArrayBuffer | string;
  gradientDefIdBuffer?: ArrayBuffer | string;
  phaseBuffer?: ArrayBuffer | string;
};

const cloneBuffer = (value: unknown): ArrayBuffer | undefined => (
  value instanceof ArrayBuffer ? value.slice(0) : undefined
);

const cloneBufferRef = (value: unknown): ArrayBuffer | string | undefined => {
  if (value instanceof ArrayBuffer) {
    return value.slice(0);
  }
  return typeof value === 'string' ? value : undefined;
};

export const readLegacyColorCycleTopLevelBuffers = (
  colorCycleData: unknown,
): LegacyColorCycleTopLevelBuffers => {
  const legacyData = colorCycleData as (LegacyColorCycleTopLevelBuffers | undefined);
  return {
    gradientIdBuffer: cloneBuffer(legacyData?.gradientIdBuffer),
    gradientDefIdBuffer: cloneBuffer(legacyData?.gradientDefIdBuffer),
    phaseBuffer: cloneBuffer(legacyData?.phaseBuffer),
  };
};

export const readLegacyColorCycleTopLevelBufferRefs = (
  colorCycleData: unknown,
): LegacyColorCycleTopLevelBufferRefs => {
  const legacyData = colorCycleData as (LegacyColorCycleTopLevelBufferRefs | undefined);
  return {
    gradientIdBuffer: cloneBufferRef(legacyData?.gradientIdBuffer),
    gradientDefIdBuffer: cloneBufferRef(legacyData?.gradientDefIdBuffer),
    phaseBuffer: cloneBufferRef(legacyData?.phaseBuffer),
  };
};

export const readMutableLegacyColorCycleTopLevelBuffers = (
  colorCycleData: unknown,
): LegacyColorCycleTopLevelBuffers => (
  (colorCycleData as LegacyColorCycleTopLevelBuffers | undefined) ?? {}
);

export const hasLegacyColorCycleTopLevelBuffers = (
  colorCycleData: unknown,
): boolean => {
  const legacyData = colorCycleData as (LegacyColorCycleTopLevelBuffers | undefined);
  return Boolean(
    legacyData?.gradientIdBuffer ||
    legacyData?.gradientDefIdBuffer ||
    legacyData?.phaseBuffer,
  );
};

export const deleteLegacyColorCycleTopLevelBuffers = (
  colorCycleData: unknown,
): void => {
  const legacyData = colorCycleData as (LegacyColorCycleTopLevelBuffers | undefined);
  if (!legacyData) {
    return;
  }
  delete legacyData.gradientIdBuffer;
  delete legacyData.gradientDefIdBuffer;
  delete legacyData.phaseBuffer;
  delete legacyData.smoothPhaseBuffer;
  delete legacyData.smoothFlagsBuffer;
};

export const attachLegacyColorCycleTopLevelBuffers = (
  colorCycleData: LayerColorCycleData,
  buffers: LegacyColorCycleTopLevelBuffers,
): LayerColorCycleData & LegacyColorCycleTopLevelBuffers => Object.assign(colorCycleData, buffers);
