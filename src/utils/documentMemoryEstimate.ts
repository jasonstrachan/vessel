import {
  COLOR_CYCLE_CANONICAL_BYTES_PER_PIXEL,
  estimateColorCycleCanonicalBufferBytes,
} from '@/lib/colorCycle/document';

const BYTES_PER_MEBIBYTE = 1024 * 1024;
const RGBA_BYTES_PER_PIXEL = 4;

export type DocumentMemoryEstimateAssumptions = {
  bitmapSurfaceCount: number;
  colorCycleLayerCount: number;
  masksPerColorCycleLayer: number;
  maskRepresentationsPerMask: number;
  retainedHistoryCanonicalGenerationCount: number;
  retainedHistoryPatchBytes: number;
  inFlightCanonicalGenerationCount: number;
  compositorSurfaceCount: number;
};

export type DocumentMemoryEstimateBreakdown = {
  bitmapSurfacesBytes: number;
  colorCycleCanonicalBytes: number;
  masksBytes: number;
  historyBytes: number;
  temporaryPublicationBytes: number;
};

export type DocumentMemoryEstimate = {
  width: number;
  height: number;
  pixelCount: number;
  assumptions: DocumentMemoryEstimateAssumptions;
  breakdown: DocumentMemoryEstimateBreakdown;
  totalBytes: number;
  totalMiB: number;
};

export const DEFAULT_DOCUMENT_MEMORY_ESTIMATE_ASSUMPTIONS: Readonly<DocumentMemoryEstimateAssumptions> =
  Object.freeze({
    bitmapSurfaceCount: 3,
    colorCycleLayerCount: 1,
    masksPerColorCycleLayer: 2,
    maskRepresentationsPerMask: 2,
    retainedHistoryCanonicalGenerationCount: 1,
    retainedHistoryPatchBytes: 0,
    inFlightCanonicalGenerationCount: 1,
    compositorSurfaceCount: 1,
  });

const toNonNegativeInteger = (value: number): number => (
  Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
);

const normalizeAssumptions = (
  assumptions: Partial<DocumentMemoryEstimateAssumptions>,
): DocumentMemoryEstimateAssumptions => ({
  bitmapSurfaceCount: toNonNegativeInteger(
    assumptions.bitmapSurfaceCount ?? DEFAULT_DOCUMENT_MEMORY_ESTIMATE_ASSUMPTIONS.bitmapSurfaceCount,
  ),
  colorCycleLayerCount: toNonNegativeInteger(
    assumptions.colorCycleLayerCount ?? DEFAULT_DOCUMENT_MEMORY_ESTIMATE_ASSUMPTIONS.colorCycleLayerCount,
  ),
  masksPerColorCycleLayer: toNonNegativeInteger(
    assumptions.masksPerColorCycleLayer ?? DEFAULT_DOCUMENT_MEMORY_ESTIMATE_ASSUMPTIONS.masksPerColorCycleLayer,
  ),
  maskRepresentationsPerMask: toNonNegativeInteger(
    assumptions.maskRepresentationsPerMask ?? DEFAULT_DOCUMENT_MEMORY_ESTIMATE_ASSUMPTIONS.maskRepresentationsPerMask,
  ),
  retainedHistoryCanonicalGenerationCount: toNonNegativeInteger(
    assumptions.retainedHistoryCanonicalGenerationCount
      ?? DEFAULT_DOCUMENT_MEMORY_ESTIMATE_ASSUMPTIONS.retainedHistoryCanonicalGenerationCount,
  ),
  retainedHistoryPatchBytes: toNonNegativeInteger(
    assumptions.retainedHistoryPatchBytes
      ?? DEFAULT_DOCUMENT_MEMORY_ESTIMATE_ASSUMPTIONS.retainedHistoryPatchBytes,
  ),
  inFlightCanonicalGenerationCount: toNonNegativeInteger(
    assumptions.inFlightCanonicalGenerationCount
      ?? DEFAULT_DOCUMENT_MEMORY_ESTIMATE_ASSUMPTIONS.inFlightCanonicalGenerationCount,
  ),
  compositorSurfaceCount: toNonNegativeInteger(
    assumptions.compositorSurfaceCount ?? DEFAULT_DOCUMENT_MEMORY_ESTIMATE_ASSUMPTIONS.compositorSurfaceCount,
  ),
});

export const estimateDocumentMemoryUsage = (
  width: number,
  height: number,
  assumptionOverrides: Partial<DocumentMemoryEstimateAssumptions> = {},
): DocumentMemoryEstimate => {
  const safeWidth = Math.max(1, toNonNegativeInteger(width));
  const safeHeight = Math.max(1, toNonNegativeInteger(height));
  const pixelCount = safeWidth * safeHeight;
  const assumptions = normalizeAssumptions(assumptionOverrides);
  const bitmapSurfacesBytes = pixelCount * RGBA_BYTES_PER_PIXEL * assumptions.bitmapSurfaceCount;
  const colorCycleCanonicalBytes = estimateColorCycleCanonicalBufferBytes(
    safeWidth,
    safeHeight,
    assumptions.colorCycleLayerCount,
  );
  const masksBytes =
    pixelCount *
    RGBA_BYTES_PER_PIXEL *
    assumptions.colorCycleLayerCount *
    assumptions.masksPerColorCycleLayer *
    assumptions.maskRepresentationsPerMask;
  const historyBytes =
    estimateColorCycleCanonicalBufferBytes(
      safeWidth,
      safeHeight,
      assumptions.retainedHistoryCanonicalGenerationCount,
    ) + assumptions.retainedHistoryPatchBytes;
  const temporaryPublicationBytes =
    estimateColorCycleCanonicalBufferBytes(
      safeWidth,
      safeHeight,
      assumptions.inFlightCanonicalGenerationCount,
    ) + pixelCount * RGBA_BYTES_PER_PIXEL * assumptions.compositorSurfaceCount;
  const breakdown = {
    bitmapSurfacesBytes,
    colorCycleCanonicalBytes,
    masksBytes,
    historyBytes,
    temporaryPublicationBytes,
  };
  const totalBytes = Object.values(breakdown).reduce((total, bytes) => total + bytes, 0);

  return {
    width: safeWidth,
    height: safeHeight,
    pixelCount,
    assumptions,
    breakdown,
    totalBytes,
    totalMiB: Math.round(totalBytes / BYTES_PER_MEBIBYTE),
  };
};

export const describeDocumentMemoryEstimateAssumptions = (
  estimate: DocumentMemoryEstimate,
): string => {
  const { assumptions } = estimate;
  return [
    `${assumptions.bitmapSurfaceCount} RGBA surfaces`,
    `${assumptions.colorCycleLayerCount} resident color-cycle layer`,
    `${COLOR_CYCLE_CANONICAL_BYTES_PER_PIXEL} canonical bytes/pixel`,
    `${assumptions.masksPerColorCycleLayer} masks with ${assumptions.maskRepresentationsPerMask} resident representations each`,
    `${assumptions.retainedHistoryCanonicalGenerationCount} retained history generation`,
    `${assumptions.inFlightCanonicalGenerationCount} in-flight publication generation`,
    `${assumptions.compositorSurfaceCount} compositor surface`,
  ].join('; ');
};
