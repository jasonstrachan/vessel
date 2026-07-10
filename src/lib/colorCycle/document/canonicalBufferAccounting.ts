import type { ColorCycleLayerDocumentState } from './colorCycleDocumentContract';

export type ColorCycleCanonicalCopyReason =
  | 'boundary-materialization'
  | 'document-baseline'
  | 'document-commit'
  | 'document-constructor'
  | 'document-state-build'
  | 'runtime-snapshot'
  | 'transaction-draft'
  | 'transaction-read';

export type ColorCycleCanonicalCopyMetric = {
  bytes: number;
  generations: number;
};

export type ColorCycleCanonicalCopyMetrics = {
  totalBytes: number;
  totalGenerations: number;
  byReason: Partial<Record<ColorCycleCanonicalCopyReason, ColorCycleCanonicalCopyMetric>>;
};

export type ColorCyclePublicationSample = {
  layerId: string;
  width: number;
  height: number;
  durationMs: number;
  canonicalBytesCopied: number;
};

const EMPTY_METRICS = (): ColorCycleCanonicalCopyMetrics => ({
  totalBytes: 0,
  totalGenerations: 0,
  byReason: {},
});

let metrics = EMPTY_METRICS();
let publicationSamples: ColorCyclePublicationSample[] = [];

const isEnabled = (): boolean => process.env.NODE_ENV !== 'production';

export const isColorCycleCanonicalCopyMetricsEnabled = (): boolean => isEnabled();

const cloneMetric = (metric: ColorCycleCanonicalCopyMetric): ColorCycleCanonicalCopyMetric => ({
  bytes: metric.bytes,
  generations: metric.generations,
});

const publishBrowserMetrics = (): void => {
  if (!isEnabled() || typeof window === 'undefined') {
    return;
  }
  const browserWindow = window as typeof window & {
    __VESSEL_CC_COPY_METRICS__?: ColorCycleCanonicalCopyMetrics;
    __VESSEL_CC_PUBLICATION_SAMPLES__?: ColorCyclePublicationSample[];
  };
  browserWindow.__VESSEL_CC_COPY_METRICS__ = getColorCycleCanonicalCopyMetrics();
  browserWindow.__VESSEL_CC_PUBLICATION_SAMPLES__ = getColorCyclePublicationSamples();
};

export const getColorCycleCanonicalBufferByteLength = (
  state: Pick<
    ColorCycleLayerDocumentState,
    | 'paintBuffer'
    | 'gradientIdBuffer'
    | 'gradientDefIdBuffer'
    | 'speedBuffer'
    | 'flowBuffer'
    | 'phaseBuffer'
  >,
): number => (
  (state.paintBuffer?.byteLength ?? 0) +
  (state.gradientIdBuffer?.byteLength ?? 0) +
  (state.gradientDefIdBuffer?.byteLength ?? 0) +
  (state.speedBuffer?.byteLength ?? 0) +
  (state.flowBuffer?.byteLength ?? 0) +
  (state.phaseBuffer?.byteLength ?? 0)
);

export const recordColorCycleCanonicalBufferCopy = (
  reason: ColorCycleCanonicalCopyReason,
  state: Parameters<typeof getColorCycleCanonicalBufferByteLength>[0],
): void => {
  if (!isEnabled()) {
    return;
  }
  const bytes = getColorCycleCanonicalBufferByteLength(state);
  if (bytes <= 0) {
    return;
  }
  const previous = metrics.byReason[reason] ?? { bytes: 0, generations: 0 };
  metrics.totalBytes += bytes;
  metrics.totalGenerations += 1;
  metrics.byReason[reason] = {
    bytes: previous.bytes + bytes,
    generations: previous.generations + 1,
  };
  publishBrowserMetrics();
};

export const getColorCycleCanonicalCopyMetrics = (): ColorCycleCanonicalCopyMetrics => ({
  totalBytes: metrics.totalBytes,
  totalGenerations: metrics.totalGenerations,
  byReason: Object.fromEntries(
    Object.entries(metrics.byReason).map(([reason, metric]) => [
      reason,
      cloneMetric(metric),
    ]),
  ) as ColorCycleCanonicalCopyMetrics['byReason'],
});

export const resetColorCycleCanonicalCopyMetrics = (): void => {
  metrics = EMPTY_METRICS();
  publicationSamples = [];
  publishBrowserMetrics();
};

export const recordColorCyclePublicationSample = (
  sample: ColorCyclePublicationSample,
): void => {
  if (!isEnabled()) {
    return;
  }
  publicationSamples = [...publicationSamples.slice(-49), { ...sample }];
  publishBrowserMetrics();
};

export const getColorCyclePublicationSamples = (): ColorCyclePublicationSample[] => (
  publicationSamples.map((sample) => ({ ...sample }))
);
