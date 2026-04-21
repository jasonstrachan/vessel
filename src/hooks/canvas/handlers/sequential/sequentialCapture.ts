import { isFeatureFlagEnabled } from '@/config/featureFlags';
import { serializeBuiltinPluginSequentialConfig } from '@/brushes/plugins';
import type { CustomBrushStrokeData } from '@/hooks/brushEngine/BrushEngineFacade';
import {
  createSequentialPayloadBudgetRuntime,
  estimateSequentialStrokeEventPayloadBytes,
  readSequentialProjectPayloadBytes,
  resetSequentialPayloadBudgetRuntime,
  SEQUENTIAL_PAYLOAD_HARD_LIMIT_BYTES,
  SEQUENTIAL_PAYLOAD_SOFT_LIMIT_BYTES,
} from '@/lib/sequential/SequentialPayloadBudget';
import {
  normalizeSequentialDitherPluginConfig,
  normalizeSequentialPluginConfigForReplay,
  serializePluginConfigForKey,
} from '@/lib/sequential/pluginConfig';
import {
  recordSequentialFlushPerf,
  recordSequentialTemporalDistributionPerf,
} from '@/lib/sequential/SequentialPerfCounters';
import {
  selectSequentialCaptureActive,
  type AppState,
} from '@/stores/useAppStore';
import { resolvePressureSizing } from '@/utils/pressureSizing';
import { resolveBrushPressureRange } from '@/utils/pressureSettings';
import { brushRegistry } from '@/brushes/BrushRegistry';
import {
  BrushShape,
  type Layer,
  type BrushSettings,
  type SequentialBrushSnapshot,
  type SequentialStampPoint,
  type SequentialStrokeEvent,
} from '@/types';

export const MAX_SEQUENTIAL_STAMPS_PER_SEC = 6000;
const STAMP_BURST_WINDOW_SECONDS = 0.1;
const STAMP_BURST_CAPACITY = MAX_SEQUENTIAL_STAMPS_PER_SEC * STAMP_BURST_WINDOW_SECONDS;
const MAX_TEMPORAL_DISTRIBUTION_FRAMES = 3;

export interface SequentialStampCapRuntime {
  sessionKey: string | null;
  sessionStartFrameIndex: number | null;
  tokens: number;
  lastTimestampMs: number | null;
  strokeSegment: number;
  lastBrushSnapshotKey: string | null;
  lastResolvedBrushSnapshotKey: string | null;
  lastResolvedBrushSnapshot: SequentialBrushSnapshot | null;
  lastBrushSettingsRef: AppState['tools']['brushSettings'] | null;
  lastToolRef: AppState['tools']['currentTool'] | null;
  lastPluginBrushIdRef?: string | null;
  lastCustomBrushDataRef?: CustomBrushStrokeData;
  lastGradientRef: BrushSettings['colorCycleGradient'] | null | undefined;
  lastGradientSnapshot: SequentialBrushSnapshot['colorCycleGradient'];
  lastGradientKey: string;
  cachedStrokeId: string | null;
  cachedEventIdPrefix: string | null;
  cachedIdSegment: number | null;
  lastCaptureLayersRef: Layer[] | null;
  lastCaptureLayerId: string | null;
  lastResolvedCaptureLayer: Layer | null;
  captureWasActive: boolean;
  eventCounter: number;
  lastAcceptedStamp: SequentialStampPoint | null;
  lastAcceptedStampAtMs: number | null;
  emittedCustomStampHashes: Set<string>;
}

export interface SequentialPayloadNotificationRuntime {
  softWarningShown: boolean;
  hardCapBlockedAtBytes: number | null;
}

interface BufferedSequentialLayerEvents {
  events: SequentialStrokeEvent[];
  byFrame: Map<number, SequentialStrokeEvent[]>;
  frameCount: number;
  fps: number;
  durationMs: number;
}

export interface SequentialEventBufferRuntime {
  sessionKey: string | null;
  pendingPayloadBytes: number;
  lastKnownLayersRef: Layer[] | null;
  lastKnownProjectPayloadBytes: number | null;
  isFlushing: boolean;
  layers: Map<string, BufferedSequentialLayerEvents>;
}

const defaultStampCapRuntime: SequentialStampCapRuntime = {
  sessionKey: null,
  sessionStartFrameIndex: null,
  tokens: STAMP_BURST_CAPACITY,
  lastTimestampMs: null,
  strokeSegment: 0,
  lastBrushSnapshotKey: null,
  lastResolvedBrushSnapshotKey: null,
  lastResolvedBrushSnapshot: null,
  lastBrushSettingsRef: null,
  lastToolRef: null,
  lastPluginBrushIdRef: null,
  lastCustomBrushDataRef: undefined,
  lastGradientRef: undefined,
  lastGradientSnapshot: undefined,
  lastGradientKey: '',
  cachedStrokeId: null,
  cachedEventIdPrefix: null,
  cachedIdSegment: null,
  lastCaptureLayersRef: null,
  lastCaptureLayerId: null,
  lastResolvedCaptureLayer: null,
  captureWasActive: false,
  eventCounter: 0,
  lastAcceptedStamp: null,
  lastAcceptedStampAtMs: null,
  emittedCustomStampHashes: new Set<string>(),
};

const defaultPayloadBudgetRuntime = createSequentialPayloadBudgetRuntime();
const defaultPayloadNotificationRuntime: SequentialPayloadNotificationRuntime = {
  softWarningShown: false,
  hardCapBlockedAtBytes: null,
};
const defaultEventBufferRuntime: SequentialEventBufferRuntime = {
  sessionKey: null,
  pendingPayloadBytes: 0,
  lastKnownLayersRef: null,
  lastKnownProjectPayloadBytes: null,
  isFlushing: false,
  layers: new Map<string, BufferedSequentialLayerEvents>(),
};

export const createSequentialStampCapRuntime = (): SequentialStampCapRuntime => ({
  sessionKey: null,
  sessionStartFrameIndex: null,
  tokens: STAMP_BURST_CAPACITY,
  lastTimestampMs: null,
  strokeSegment: 0,
  lastBrushSnapshotKey: null,
  lastResolvedBrushSnapshotKey: null,
  lastResolvedBrushSnapshot: null,
  lastBrushSettingsRef: null,
  lastToolRef: null,
  lastPluginBrushIdRef: null,
  lastCustomBrushDataRef: undefined,
  lastGradientRef: undefined,
  lastGradientSnapshot: undefined,
  lastGradientKey: '',
  cachedStrokeId: null,
  cachedEventIdPrefix: null,
  cachedIdSegment: null,
  lastCaptureLayersRef: null,
  lastCaptureLayerId: null,
  lastResolvedCaptureLayer: null,
  captureWasActive: false,
  eventCounter: 0,
  lastAcceptedStamp: null,
  lastAcceptedStampAtMs: null,
  emittedCustomStampHashes: new Set<string>(),
});

export const createSequentialPayloadNotificationRuntime = (): SequentialPayloadNotificationRuntime => ({
  softWarningShown: false,
  hardCapBlockedAtBytes: null,
});

export const createSequentialEventBufferRuntime = (): SequentialEventBufferRuntime => ({
  sessionKey: null,
  pendingPayloadBytes: 0,
  lastKnownLayersRef: null,
  lastKnownProjectPayloadBytes: null,
  isFlushing: false,
  layers: new Map<string, BufferedSequentialLayerEvents>(),
});

export const flushBufferedSequentialEvents = ({
  state,
  runtime,
}: {
  state: AppState;
  runtime?: SequentialEventBufferRuntime;
}): number => {
  const flushStartMs =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
  const targetRuntime = runtime ?? defaultEventBufferRuntime;
  if (targetRuntime.isFlushing || targetRuntime.layers.size === 0) {
    return 0;
  }

  targetRuntime.isFlushing = true;
  const queuedLayerEntries = Array.from(targetRuntime.layers.entries());
  targetRuntime.layers.clear();
  targetRuntime.pendingPayloadBytes = 0;

  let flushedEventCount = 0;
  try {
    queuedLayerEntries.forEach(([layerId, entry]) => {
      if (entry.events.length === 0) {
        return;
      }
      state.appendSequentialLayerEvents(layerId, entry.events, {
        frameCount: entry.frameCount,
        fps: entry.fps,
        durationMs: entry.durationMs,
      });
      entry.byFrame.clear();
      flushedEventCount += entry.events.length;
    });
  } finally {
    targetRuntime.isFlushing = false;
  }
  const flushDurationMs =
    (typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now()) - flushStartMs;
  recordSequentialFlushPerf({
    events: flushedEventCount,
    durationMs: flushDurationMs,
  });
  return flushedEventCount;
};

export const getBufferedSequentialPendingPayloadBytes = ({
  runtime,
}: {
  runtime?: SequentialEventBufferRuntime;
} = {}): number => {
  const targetRuntime = runtime ?? defaultEventBufferRuntime;
  return Math.max(0, targetRuntime.pendingPayloadBytes);
};

export const getBufferedSequentialLayerFrameEvents = ({
  layerId,
  frameIndex,
  runtime,
}: {
  layerId: string;
  frameIndex: number;
  runtime?: SequentialEventBufferRuntime;
}): ReadonlyArray<SequentialStrokeEvent> => {
  if (!layerId) {
    return [];
  }
  const targetRuntime = runtime ?? defaultEventBufferRuntime;
  const layerEvents = targetRuntime.layers.get(layerId);
  if (!layerEvents) {
    return [];
  }
  const normalizedFrameIndex = Number.isFinite(frameIndex) ? Math.round(frameIndex) : 0;
  return layerEvents.byFrame.get(normalizedFrameIndex) ?? [];
};

const enqueueBufferedSequentialEvent = ({
  layerId,
  event,
  metadata,
  payloadBytes,
  runtime,
}: {
  layerId: string;
  event: SequentialStrokeEvent;
  metadata: { frameCount: number; fps: number; durationMs: number };
  payloadBytes: number;
  runtime: SequentialEventBufferRuntime;
}): void => {
  const existing = runtime.layers.get(layerId);
  if (existing) {
    existing.events.push(event);
    const existingFrameEvents = existing.byFrame.get(event.frameIndex);
    if (existingFrameEvents) {
      existingFrameEvents.push(event);
    } else {
      existing.byFrame.set(event.frameIndex, [event]);
    }
    existing.frameCount = metadata.frameCount;
    existing.fps = metadata.fps;
    existing.durationMs = metadata.durationMs;
  } else {
    runtime.layers.set(layerId, {
      events: [event],
      byFrame: new Map([[event.frameIndex, [event]]]),
      frameCount: metadata.frameCount,
      fps: metadata.fps,
      durationMs: metadata.durationMs,
    });
  }
  runtime.pendingPayloadBytes += payloadBytes;
};

const readCachedProjectPayloadBytes = ({
  state,
  payloadRuntime,
  eventBufferRuntime,
}: {
  state: AppState;
  payloadRuntime: ReturnType<typeof createSequentialPayloadBudgetRuntime>;
  eventBufferRuntime: SequentialEventBufferRuntime;
}): number => {
  if (
    eventBufferRuntime.lastKnownLayersRef === state.layers &&
    Number.isFinite(eventBufferRuntime.lastKnownProjectPayloadBytes)
  ) {
    return Math.max(0, eventBufferRuntime.lastKnownProjectPayloadBytes ?? 0);
  }
  const projectPayloadBytes = readSequentialProjectPayloadBytes({
    layers: state.layers,
    runtime: payloadRuntime,
  });
  eventBufferRuntime.lastKnownLayersRef = state.layers;
  eventBufferRuntime.lastKnownProjectPayloadBytes = projectPayloadBytes;
  return projectPayloadBytes;
};

export const noteSequentialCaptureActivity = ({
  isActive,
  runtime,
}: {
  isActive: boolean;
  runtime?: SequentialStampCapRuntime;
}): void => {
  const targetRuntime = runtime ?? defaultStampCapRuntime;
  if (isActive) {
    return;
  }
  targetRuntime.captureWasActive = false;
  targetRuntime.sessionStartFrameIndex = null;
  targetRuntime.lastBrushSnapshotKey = null;
  targetRuntime.lastAcceptedStamp = null;
  targetRuntime.lastAcceptedStampAtMs = null;
  targetRuntime.emittedCustomStampHashes.clear();
};

const normalizeFrameIndex = (frame: number, frameCount: number): number => {
  const safeFrameCount = Math.max(1, Math.round(frameCount));
  const normalized = Math.round(frame) % safeFrameCount;
  return normalized < 0 ? normalized + safeFrameCount : normalized;
};

const resolveCaptureFrameIndex = ({
  sessionStartMs,
  captureNowMs,
  frameCount,
  fps,
  sessionStartFrameIndex,
}: {
  sessionStartMs: number;
  captureNowMs: number;
  frameCount: number;
  fps: number;
  sessionStartFrameIndex: number;
}): number => {
  const safeFrameCount = Math.max(1, Math.round(frameCount));
  const safeFps = Math.max(1, Math.round(fps));
  const elapsedMs = Math.max(0, captureNowMs - sessionStartMs);
  const elapsedFrames = Math.floor((elapsedMs * safeFps) / 1000);
  return normalizeFrameIndex(sessionStartFrameIndex + elapsedFrames, safeFrameCount);
};

const clamp01 = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }
  return value;
};

const buildTemporalFrameBuckets = ({
  stamps,
  frameCount,
  baseFrameIndex,
  timeSmear,
  forceSplit,
  disableDistribution,
}: {
  stamps: SequentialStampPoint[];
  frameCount: number;
  baseFrameIndex: number;
  timeSmear: number;
  forceSplit?: boolean;
  disableDistribution?: boolean;
}): Array<{ frameIndex: number; stamps: SequentialStampPoint[] }> => {
  if (disableDistribution) {
    return [{ frameIndex: baseFrameIndex, stamps }];
  }
  if (
    !isFeatureFlagEnabled('enableSequentialTemporalDistribution') ||
    frameCount <= 1 ||
    stamps.length <= 1
  ) {
    return [{ frameIndex: baseFrameIndex, stamps }];
  }

  const smearFactor = Number.isFinite(timeSmear) ? Math.max(0.1, timeSmear) : 1;
  if (smearFactor <= 1.01 && !forceSplit) {
    return [{ frameIndex: baseFrameIndex, stamps }];
  }
  const requestedBucketCount = Math.round(smearFactor);
  const baseDensityBucketCount = Math.min(
    MAX_TEMPORAL_DISTRIBUTION_FRAMES,
    stamps.length >= 12 ? 3 : stamps.length >= 6 ? 2 : 1
  );
  const densityBucketCount =
    smearFactor > 1.01
      ? Math.min(
          MAX_TEMPORAL_DISTRIBUTION_FRAMES,
          Math.max(baseDensityBucketCount, Math.floor(stamps.length / 4))
        )
      : baseDensityBucketCount;
  const minimumSmearBucketCount =
    smearFactor > 1.01
      ? Math.min(
          MAX_TEMPORAL_DISTRIBUTION_FRAMES,
          stamps.length >= 8 ? 3 : stamps.length >= 2 ? 2 : 1
        )
      : 1;
  const bucketCount = Math.max(
    1,
    Math.min(
      MAX_TEMPORAL_DISTRIBUTION_FRAMES,
      stamps.length,
      Math.max(requestedBucketCount, densityBucketCount, minimumSmearBucketCount)
    )
  );
  const effectiveBucketCount = forceSplit && stamps.length >= 2
    ? Math.max(2, bucketCount)
    : bucketCount;

  if (effectiveBucketCount <= 1) {
    return [{ frameIndex: baseFrameIndex, stamps }];
  }

  const buckets = Array.from({ length: effectiveBucketCount }, () => [] as SequentialStampPoint[]);
  const maxStampIndex = Math.max(1, stamps.length - 1);
  const spreadStrength = clamp01((smearFactor - 1) / 7);
  const easingStrength = 0.55 * spreadStrength;
  const bucketScale = Math.max(1, effectiveBucketCount - 1);
  for (let i = 0; i < stamps.length; i += 1) {
    const linearProgress = i / maxStampIndex;
    const smoothProgress = linearProgress * linearProgress * (3 - 2 * linearProgress);
    const easedProgress =
      linearProgress * (1 - easingStrength) + smoothProgress * easingStrength;
    const bucketIndex = Math.min(
      effectiveBucketCount - 1,
      Math.round(easedProgress * bucketScale)
    );
    buckets[bucketIndex].push(stamps[i]);
  }

  const distributed: Array<{ frameIndex: number; stamps: SequentialStampPoint[] }> = [];
  for (let i = 0; i < buckets.length; i += 1) {
    const bucketStamps = buckets[i];
    if (bucketStamps.length === 0) {
      continue;
    }
    distributed.push({
      frameIndex: normalizeFrameIndex(baseFrameIndex + i, frameCount),
      stamps: bucketStamps,
    });
  }

  return distributed.length > 0
    ? distributed
    : [{ frameIndex: baseFrameIndex, stamps }];
};

const resolveTemporalDistributionReason = ({
  frameCount,
  stampCount,
  bucketCount,
  smear,
  forceSplit,
}: {
  frameCount: number;
  stampCount: number;
  bucketCount: number;
  smear: number;
  forceSplit: boolean;
}): string => {
  if (!isFeatureFlagEnabled('enableSequentialTemporalDistribution')) {
    return 'flag-disabled';
  }
  if (frameCount <= 1) {
    return 'frame-count-1';
  }
  if (stampCount <= 1) {
    return 'insufficient-stamps';
  }
  if (!Number.isFinite(smear) || smear <= 1.01) {
    if (forceSplit) {
      return 'forced-bridge-split';
    }
    return bucketCount > 1 ? 'density-split' : 'smear-low';
  }
  return bucketCount > 1 ? 'split' : 'bucket-single';
};

const buildBrushSnapshot = ({
  state,
  customBrushData,
  pluginBrushId,
  gradientSnapshot,
}: {
  state: AppState;
  customBrushData?: CustomBrushStrokeData;
  pluginBrushId?: string | null;
  gradientSnapshot?: SequentialBrushSnapshot['colorCycleGradient'];
}): SequentialBrushSnapshot => {
  const settings = state.tools.brushSettings;
  const customStamp = buildSequentialCustomStampSnapshot(customBrushData);
  const pluginConfig = pluginBrushId
    ? brushRegistry.get(pluginBrushId)?.serializeSequentialConfig?.(settings) ??
      serializeBuiltinPluginSequentialConfig(pluginBrushId, settings)
    : null;
  const brushShape = settings.brushShape ?? BrushShape.ROUND;
  const shouldCaptureDitherConfig =
    pluginBrushId === 'dither-brush' ||
    (!pluginBrushId &&
      (settings.ditherEnabled ||
        settings.colorCycleStampDitherEnabled ||
        brushShape === BrushShape.PIXEL_DITHER ||
        brushShape === BrushShape.DITHER_GRADIENT));
  const normalizedPluginConfig = pluginBrushId
    ? normalizeSequentialPluginConfigForReplay({
        pluginBrushId,
        config: pluginConfig,
        brushDitherAlgorithm: settings.ditherAlgorithm,
        brushDitherIntensity: settings.ditherPaletteSpread,
        brushPatternStyle: settings.patternStyle,
        brushDitherBackgroundFill: settings.ditherBackgroundFill,
        fillResolution: settings.fillResolution,
      })
    : shouldCaptureDitherConfig
      ? normalizeSequentialDitherPluginConfig({
          config: pluginConfig,
          brushDitherAlgorithm: settings.ditherAlgorithm,
          brushDitherIntensity: settings.ditherPaletteSpread,
          brushPatternStyle: settings.patternStyle,
          brushDitherBackgroundFill: settings.ditherBackgroundFill,
          fillResolution: settings.fillResolution,
        })
      : pluginConfig;
  const normalizedDitherAlgorithm =
    typeof normalizedPluginConfig?.ditherAlgorithm === 'string'
      ? normalizedPluginConfig.ditherAlgorithm
      : settings.ditherAlgorithm;
  const resolveTipShape = (): NonNullable<SequentialBrushSnapshot['tipShape']> => {
    const pluginMode = pluginBrushId?.trim().toLowerCase();
    const isDitherContext =
      Boolean(settings.ditherEnabled || settings.colorCycleStampDitherEnabled) ||
      pluginMode === 'dither-brush' ||
      brushShape === BrushShape.PIXEL_DITHER ||
      brushShape === BrushShape.DITHER_GRADIENT;
    if (isDitherContext) {
      const ditherTipShape = settings.ditherStrokeTipShape ?? settings.colorCycleStampShape;
      if (ditherTipShape === 'square') {
        return 'square';
      }
      if (ditherTipShape === 'diamond5') {
        return 'diamond5';
      }
      if (ditherTipShape === 'diamond7') {
        return 'diamond7';
      }
      if (ditherTipShape === 'diamond9') {
        return 'diamond9';
      }
      if (ditherTipShape === 'checkered') {
        return 'checkered';
      }
      if (ditherTipShape === 'triangle' || ditherTipShape === 'diamond') {
        return 'triangle';
      }
      if (ditherTipShape === 'round') {
        return 'round';
      }
    }
    switch (brushShape) {
      case BrushShape.SQUARE:
      case BrushShape.MOSAIC:
      case BrushShape.PIXEL_DITHER:
        return 'square';
      case BrushShape.TRIANGLE:
      case BrushShape.COLOR_CYCLE_TRIANGLE:
        return 'triangle';
      default:
        return 'round';
    }
  };
  return {
    tool: state.tools.currentTool,
    brushShape,
    tipShape: resolveTipShape(),
    size: Math.max(1, Number.isFinite(settings.size) ? settings.size : 1),
    opacity: Math.max(0, Math.min(1, Number.isFinite(settings.opacity) ? settings.opacity : 1)),
    blendMode: settings.blendMode,
    rotation: Number.isFinite(settings.rotation) ? settings.rotation : 0,
    spacing: Math.max(0.25, Number.isFinite(settings.spacing) ? settings.spacing : 1),
    color: settings.color || '#000000',
    ...(pluginBrushId ? { pluginBrushId } : {}),
    ...(normalizedPluginConfig ? { pluginConfig: normalizedPluginConfig } : {}),
    customStampId: customBrushData?.cacheKey ?? null,
    customStampHash: customStamp?.hash ?? null,
    customStamp: customStamp
      ? {
          width: customStamp.width,
          height: customStamp.height,
          rgbaBase64: customStamp.rgbaBase64,
          isColorizable: customStamp.isColorizable,
        }
      : null,
    ditherEnabled: Boolean(settings.ditherEnabled || settings.colorCycleStampDitherEnabled),
    ditherAlgorithm: normalizedDitherAlgorithm,
    ditherStrokeTipShape:
      settings.ditherStrokeTipShape ??
      settings.colorCycleStampShape,
    ditherBackgroundFill: settings.ditherBackgroundFill !== false,
    fillResolution: Number.isFinite(settings.fillResolution)
      ? Math.max(1, Math.min(64, Math.round(settings.fillResolution ?? 1)))
      : 1,
    pressureLinkedFillResolution: settings.pressureLinkedFillResolution === true,
    mosaicTilePx: settings.mosaicTilePx,
    mosaicSegmentPx: settings.mosaicSegmentPx,
    mosaicBlocksCount: settings.mosaicBlocksCount,
    mosaicPaletteCount: settings.mosaicPaletteCount,
    mosaicDitherEnabled: settings.mosaicDitherEnabled,
    mosaicSegmentJitter: settings.mosaicSegmentJitter,
    mosaicSeed: settings.mosaicSeed,
    colorCycleGradient: gradientSnapshot,
  };
};

const buildBrushSnapshotKey = (
  snapshot: SequentialBrushSnapshot,
  gradientKeyOverride?: string
): string =>
  [
    snapshot.tool,
    snapshot.brushShape,
    snapshot.tipShape ?? '',
    snapshot.size,
    snapshot.opacity,
    snapshot.blendMode,
    snapshot.rotation,
    snapshot.spacing,
    snapshot.color,
    snapshot.pluginBrushId ?? '',
    serializePluginConfigForKey(snapshot.pluginConfig),
    snapshot.customStampId ?? '',
    snapshot.customStampHash ?? '',
    snapshot.ditherEnabled ? '1' : '0',
    snapshot.ditherAlgorithm ?? '',
    snapshot.ditherStrokeTipShape ?? '',
    snapshot.mosaicTilePx ?? '',
    snapshot.mosaicSegmentPx ?? '',
    snapshot.mosaicBlocksCount ?? '',
    snapshot.mosaicPaletteCount ?? '',
    snapshot.mosaicDitherEnabled ? '1' : '0',
    snapshot.mosaicSegmentJitter ?? '',
    snapshot.mosaicSeed ?? '',
    gradientKeyOverride ??
      (snapshot.colorCycleGradient
        ? snapshot.colorCycleGradient
            .map((stop) => `${stop.position}:${stop.color}`)
            .join(',')
        : ''),
  ].join('|');

const bytesToBase64 = (bytes: ArrayLike<number>): string => {
  const byteLength = bytes.length;
  if (byteLength === 0) {
    return '';
  }
  const asUint8 = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(asUint8).toString('base64');
  }
  if (typeof btoa === 'function') {
    let binary = '';
    for (let i = 0; i < asUint8.length; i += 1) {
      binary += String.fromCharCode(asUint8[i]);
    }
    return btoa(binary);
  }
  return '';
};

const fnv1aHashHex = (bytes: ArrayLike<number>): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i += 1) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
};

const customStampSnapshotCache = new Map<
  string,
  { hash: string; width: number; height: number; rgbaBase64: string; isColorizable: boolean }
>();

const buildSequentialCustomStampSnapshot = (
  customBrushData?: CustomBrushStrokeData
):
  | { hash: string; width: number; height: number; rgbaBase64: string; isColorizable: boolean }
  | null => {
  if (!customBrushData?.imageData) {
    return null;
  }

  const imageData = customBrushData.imageData;
  const cacheKey =
    customBrushData.cacheKey ??
    (imageData as ImageData & { __vesselCacheKey?: string }).__vesselCacheKey ??
    null;
  const cached = cacheKey ? customStampSnapshotCache.get(cacheKey) : null;
  if (cached) {
    const nextIsColorizable = Boolean(customBrushData.isColorizable);
    if (cached.isColorizable === nextIsColorizable) {
      return cached;
    }
    return { ...cached, isColorizable: nextIsColorizable };
  }

  const bytes = imageData.data;
  const hash = fnv1aHashHex(bytes);
  const rgbaBase64 = bytesToBase64(bytes);
  const snapshot = {
    hash,
    width: imageData.width,
    height: imageData.height,
    rgbaBase64,
    isColorizable: Boolean(customBrushData.isColorizable),
  };
  if (cacheKey) {
    customStampSnapshotCache.set(cacheKey, snapshot);
    if (customStampSnapshotCache.size > 256) {
      const first = customStampSnapshotCache.keys().next().value;
      if (typeof first === 'string') {
        customStampSnapshotCache.delete(first);
      }
    }
  }
  return snapshot;
};

const coerceStamp = (stamp: SequentialStampPoint): SequentialStampPoint | null => {
  if (!Number.isFinite(stamp.x) || !Number.isFinite(stamp.y)) {
    return null;
  }
  const pressure = Number.isFinite(stamp.pressure) ? Math.max(0, Math.min(1, stamp.pressure)) : 1;
  const rotation = Number.isFinite(stamp.rotation) ? stamp.rotation : 0;
  const size = Number.isFinite(stamp.size) ? Math.max(0, stamp.size) : 0;
  const alpha = Number.isFinite(stamp.alpha) ? Math.max(0, Math.min(1, stamp.alpha)) : 1;
  if (
    pressure === stamp.pressure &&
    rotation === stamp.rotation &&
    size === stamp.size &&
    alpha === stamp.alpha
  ) {
    return stamp;
  }
  return {
    x: stamp.x,
    y: stamp.y,
    pressure,
    rotation,
    size,
    alpha,
  };
};

const densifySequentialStampsForSmear = ({
  stamps,
  timeSmear,
}: {
  stamps: SequentialStampPoint[];
  timeSmear: number;
}): SequentialStampPoint[] => {
  const smearFactor = Number.isFinite(timeSmear) ? Math.max(0.1, timeSmear) : 1;
  if (smearFactor <= 1.01 || stamps.length < 2) {
    return stamps;
  }

  const resolveDensifyBudget = (
    from: SequentialStampPoint,
    to: SequentialStampPoint
  ): { segmentPx: number; maxExtraPoints: number } => {
    const avgSize = Math.max(1, (Math.max(0, from.size) + Math.max(0, to.size)) * 0.5);
    if (avgSize >= 64) {
      return { segmentPx: 32, maxExtraPoints: 1 };
    }
    if (avgSize >= 32) {
      return { segmentPx: 20, maxExtraPoints: 2 };
    }
    if (avgSize >= 16) {
      return { segmentPx: 12, maxExtraPoints: 3 };
    }
    return { segmentPx: 8, maxExtraPoints: 4 };
  };

  let totalPointCount = stamps.length;
  for (let i = 1; i < stamps.length; i += 1) {
    const from = stamps[i - 1];
    const to = stamps[i];
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const { segmentPx, maxExtraPoints } = resolveDensifyBudget(from, to);
    totalPointCount += Math.min(
      maxExtraPoints,
      Math.max(0, Math.floor((distance / segmentPx) * (smearFactor - 1)))
    );
  }
  if (totalPointCount <= stamps.length) {
    return stamps;
  }

  const densified = new Array<SequentialStampPoint>(totalPointCount);
  let writeIndex = 0;
  densified[writeIndex] = stamps[0];
  writeIndex += 1;
  for (let i = 1; i < stamps.length; i += 1) {
    const from = stamps[i - 1];
    const to = stamps[i];
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const { segmentPx, maxExtraPoints } = resolveDensifyBudget(from, to);
    const extraPoints = Math.min(
      maxExtraPoints,
      Math.max(0, Math.floor((distance / segmentPx) * (smearFactor - 1)))
    );

    for (let j = 1; j <= extraPoints; j += 1) {
      const t = j / (extraPoints + 1);
      const alphaFalloff = 1 - t * 0.2;
      densified[writeIndex] = {
        x: from.x + dx * t,
        y: from.y + dy * t,
        pressure: from.pressure + (to.pressure - from.pressure) * t,
        rotation: from.rotation + (to.rotation - from.rotation) * t,
        size: from.size + (to.size - from.size) * t,
        alpha: Math.max(0, Math.min(1, (from.alpha + (to.alpha - from.alpha) * t) * alphaFalloff)),
      };
      writeIndex += 1;
    }

    densified[writeIndex] = to;
    writeIndex += 1;
  }

  return writeIndex === densified.length ? densified : densified.slice(0, writeIndex);
};

const normalizeSequentialStamps = (stamps: SequentialStampPoint[]): SequentialStampPoint[] => {
  if (stamps.length === 0) {
    return [];
  }

  let normalized: SequentialStampPoint[] | null = null;
  for (let i = 0; i < stamps.length; i += 1) {
    const coerced = coerceStamp(stamps[i]);
    if (!coerced) {
      if (!normalized) {
        normalized = stamps.slice(0, i);
      }
      continue;
    }
    if (!normalized) {
      if (coerced === stamps[i]) {
        continue;
      }
      normalized = stamps.slice(0, i);
    }
    normalized.push(coerced);
  }
  return normalized ?? stamps;
};

const maybeBridgeSingleStampFromPrevious = ({
  stamps,
  runtime,
  timeSmear,
  nowMs,
}: {
  stamps: SequentialStampPoint[];
  runtime: SequentialStampCapRuntime;
  timeSmear: number;
  nowMs: number;
}): SequentialStampPoint[] => {
  const smearFactor = Number.isFinite(timeSmear) ? Math.max(0.1, timeSmear) : 1;
  if (stamps.length !== 1 || !runtime.lastAcceptedStamp) {
    return stamps;
  }
  const current = stamps[0];
  const previous = runtime.lastAcceptedStamp;
  const dx = current.x - previous.x;
  const dy = current.y - previous.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  if (!Number.isFinite(distance) || distance < 1) {
    return stamps;
  }
  if (smearFactor <= 1.01) {
    // Low-smear mode still benefits from a short bridge on sparse single-point streams.
    const lastAcceptedAtMs = runtime.lastAcceptedStampAtMs;
    const deltaMs = Number.isFinite(lastAcceptedAtMs) ? Math.max(0, nowMs - (lastAcceptedAtMs ?? nowMs)) : Infinity;
    if (deltaMs > 42) {
      return stamps;
    }
    if (distance < 8) {
      return stamps;
    }
    return [previous, current];
  }
  const bridged = densifySequentialStampsForSmear({
    stamps: [previous, current],
    timeSmear,
  });
  if (bridged.length <= 1) {
    return stamps;
  }
  if (bridged.length <= 2) {
    // Keep both points for short bridge segments so temporal bucketing has enough signal.
    return bridged;
  }
  // Drop the previous-anchor point on longer bridges to avoid overweighting stale stamps.
  return bridged.slice(1);
};

const resolveCaptureLayer = (
  state: AppState,
  runtime: SequentialStampCapRuntime
): Layer | null => {
  if (!selectSequentialCaptureActive(state)) {
    return null;
  }
  const activeLayerId = state.activeLayerId;
  if (!activeLayerId) {
    return null;
  }
  if (
    runtime.lastCaptureLayersRef === state.layers &&
    runtime.lastCaptureLayerId === activeLayerId &&
    runtime.lastResolvedCaptureLayer
  ) {
    const cachedLayer = runtime.lastResolvedCaptureLayer;
    if (cachedLayer.layerType === 'sequential' && cachedLayer.id === activeLayerId) {
      return cachedLayer;
    }
  }

  const activeLayer = state.layers.find((layer) => layer.id === activeLayerId);
  if (!activeLayer || activeLayer.layerType !== 'sequential') {
    runtime.lastCaptureLayersRef = state.layers;
    runtime.lastCaptureLayerId = activeLayerId;
    runtime.lastResolvedCaptureLayer = null;
    return null;
  }
  runtime.lastCaptureLayersRef = state.layers;
  runtime.lastCaptureLayerId = activeLayerId;
  runtime.lastResolvedCaptureLayer = activeLayer;
  return activeLayer;
};

const resolveBrushSnapshotForCapture = ({
  state,
  customBrushData,
  pluginBrushId,
  runtime,
}: {
  state: AppState;
  customBrushData?: CustomBrushStrokeData;
  pluginBrushId?: string | null;
  runtime: SequentialStampCapRuntime;
}): { brush: SequentialBrushSnapshot; key: string } => {
  const settings = state.tools.brushSettings;
  const tool = state.tools.currentTool;
  if (
    runtime.lastBrushSettingsRef === settings &&
    runtime.lastToolRef === tool &&
    runtime.lastPluginBrushIdRef === (pluginBrushId ?? null) &&
    runtime.lastCustomBrushDataRef === customBrushData &&
    runtime.lastResolvedBrushSnapshot &&
    runtime.lastResolvedBrushSnapshotKey
  ) {
    return {
      brush: runtime.lastResolvedBrushSnapshot,
      key: runtime.lastResolvedBrushSnapshotKey,
    };
  }

  let gradientSnapshot: SequentialBrushSnapshot['colorCycleGradient'];
  let gradientKey = '';
  if (runtime.lastGradientRef === settings.colorCycleGradient) {
    gradientSnapshot = runtime.lastGradientSnapshot;
    gradientKey = runtime.lastGradientKey;
  } else if (Array.isArray(settings.colorCycleGradient) && settings.colorCycleGradient.length > 0) {
    gradientSnapshot = settings.colorCycleGradient.map((stop) => ({
      position: stop.position,
      color: stop.color,
    }));
    gradientKey = gradientSnapshot.map((stop) => `${stop.position}:${stop.color}`).join(',');
    runtime.lastGradientRef = settings.colorCycleGradient;
    runtime.lastGradientSnapshot = gradientSnapshot;
    runtime.lastGradientKey = gradientKey;
  } else {
    gradientSnapshot = undefined;
    gradientKey = '';
    runtime.lastGradientRef = settings.colorCycleGradient;
    runtime.lastGradientSnapshot = undefined;
    runtime.lastGradientKey = '';
  }

  const brush = buildBrushSnapshot({
    state,
    customBrushData,
    pluginBrushId,
    gradientSnapshot,
  });
  const customStampHash = brush.customStampHash ?? null;
  if (customStampHash && brush.customStamp) {
    if (runtime.emittedCustomStampHashes.has(customStampHash)) {
      // Avoid repeating the full RGBA payload for every event.
      // Replay can hydrate the stamp from prior events by hash.
      brush.customStamp = null;
    } else {
      runtime.emittedCustomStampHashes.add(customStampHash);
    }
  }
  const key = buildBrushSnapshotKey(brush, gradientKey);
  runtime.lastBrushSettingsRef = settings;
  runtime.lastToolRef = tool;
  runtime.lastPluginBrushIdRef = pluginBrushId ?? null;
  runtime.lastCustomBrushDataRef = customBrushData;
  runtime.lastResolvedBrushSnapshot = brush;
  runtime.lastResolvedBrushSnapshotKey = key;
  return { brush, key };
};

const formatSequentialEventCounter = (value: number): string => {
  if (value < 10) {
    return `00000${value}`;
  }
  if (value < 100) {
    return `0000${value}`;
  }
  if (value < 1000) {
    return `000${value}`;
  }
  if (value < 10000) {
    return `00${value}`;
  }
  if (value < 100000) {
    return `0${value}`;
  }
  return String(value);
};

const resolveStrokeIdentifiers = ({
  runtime,
  sessionStartMs,
}: {
  runtime: SequentialStampCapRuntime;
  sessionStartMs: number;
}): {
  strokeId: string;
  eventIdPrefix: string;
} => {
  if (
    runtime.cachedIdSegment === runtime.strokeSegment &&
    runtime.cachedStrokeId &&
    runtime.cachedEventIdPrefix
  ) {
    return {
      strokeId: runtime.cachedStrokeId,
      eventIdPrefix: runtime.cachedEventIdPrefix,
    };
  }
  const strokeId = `stroke-${sessionStartMs}-${runtime.strokeSegment}`;
  const eventIdPrefix = `seq-${sessionStartMs}-${runtime.strokeSegment}-`;
  runtime.cachedIdSegment = runtime.strokeSegment;
  runtime.cachedStrokeId = strokeId;
  runtime.cachedEventIdPrefix = eventIdPrefix;
  return { strokeId, eventIdPrefix };
};

export const createFallbackSequentialStamp = (
  point: { x: number; y: number },
  pressure: number,
  brushSettings: BrushSettings
): SequentialStampPoint => {
  const normalizedPressure = Number.isFinite(pressure) ? Math.max(0, Math.min(1, pressure)) : 1;
  const baseSize = Number.isFinite(brushSettings.size) ? Math.max(1, brushSettings.size) : 1;
  const pressureRange = resolveBrushPressureRange(brushSettings);
  const pressureSizing = resolvePressureSizing(baseSize, {
    enabled: pressureRange.enabled,
    minPercent: pressureRange.minPercent,
    maxPercent: pressureRange.maxPercent,
  });

  return {
    x: point.x,
    y: point.y,
    pressure: normalizedPressure,
    rotation: Number.isFinite(brushSettings.rotation) ? brushSettings.rotation : 0,
    size: Math.max(1, Math.round(pressureSizing.sample(normalizedPressure) * 2)),
    alpha: Number.isFinite(brushSettings.opacity)
      ? Math.max(0, Math.min(1, brushSettings.opacity))
      : 1,
  };
};

export const applyDeterministicStampCap = ({
  runtime,
  sessionKey,
  stamps,
  nowMs,
}: {
  runtime: SequentialStampCapRuntime;
  sessionKey: string;
  stamps: SequentialStampPoint[];
  nowMs: number;
}): SequentialStampPoint[] => {
  if (runtime.sessionKey !== sessionKey) {
    runtime.sessionKey = sessionKey;
    runtime.tokens = STAMP_BURST_CAPACITY;
    runtime.lastTimestampMs = nowMs;
  } else {
    const lastTimestampMs = runtime.lastTimestampMs ?? nowMs;
    const deltaMs = Math.max(0, nowMs - lastTimestampMs);
    runtime.tokens = Math.min(
      STAMP_BURST_CAPACITY,
      runtime.tokens + (deltaMs * MAX_SEQUENTIAL_STAMPS_PER_SEC) / 1000
    );
    runtime.lastTimestampMs = nowMs;
  }

  const availableTokens = Math.max(0, Math.floor(runtime.tokens));
  const acceptedCount = Math.min(stamps.length, availableTokens);
  if (acceptedCount <= 0) {
    return [];
  }
  runtime.tokens -= acceptedCount;
  if (acceptedCount >= stamps.length) {
    return stamps;
  }
  return stamps.slice(0, acceptedCount);
};

export const captureSequentialStampsForActiveLayer = ({
  state,
  stamps,
  customBrushData,
  pluginBrushId,
  runtime,
  payloadRuntime,
  notificationRuntime,
  eventBufferRuntime,
  payloadLimits,
  nowMs,
}: {
  state: AppState;
  stamps: SequentialStampPoint[];
  customBrushData?: CustomBrushStrokeData;
  pluginBrushId?: string | null;
  runtime?: SequentialStampCapRuntime;
  payloadRuntime?: ReturnType<typeof createSequentialPayloadBudgetRuntime>;
  notificationRuntime?: SequentialPayloadNotificationRuntime;
  eventBufferRuntime?: SequentialEventBufferRuntime;
  payloadLimits?: {
    softLimitBytes?: number;
    hardLimitBytes?: number;
  };
  nowMs?: number;
}): number => {
  const capRuntime = runtime ?? defaultStampCapRuntime;

  if (!isFeatureFlagEnabled('enableSequentialRecordMode')) {
    capRuntime.captureWasActive = false;
    return 0;
  }

  const activeLayer = resolveCaptureLayer(state, capRuntime);
  if (!activeLayer) {
    capRuntime.captureWasActive = false;
    return 0;
  }

  const normalizedStamps = normalizeSequentialStamps(stamps);
  if (normalizedStamps.length === 0) {
    capRuntime.captureWasActive = true;
    return 0;
  }
  const captureNowMs = Number.isFinite(nowMs) ? Number(nowMs) : Date.now();
  const bridgedStamps = maybeBridgeSingleStampFromPrevious({
    stamps: normalizedStamps,
    runtime: capRuntime,
    timeSmear: state.sequentialRecord.timeSmear,
    nowMs: captureNowMs,
  });
  const forceTemporalSplit = bridgedStamps !== normalizedStamps && bridgedStamps.length >= 2;
  const smearedStamps = densifySequentialStampsForSmear({
    stamps: bridgedStamps,
    timeSmear: state.sequentialRecord.timeSmear,
  });

  const sessionStartMs = state.sequentialRecord.sessionStartMs ?? captureNowMs;
  const sessionKey = `${activeLayer.id}:${sessionStartMs}`;
  if (capRuntime.sessionKey !== sessionKey) {
    capRuntime.sessionStartFrameIndex = null;
    capRuntime.strokeSegment = 0;
    capRuntime.lastBrushSnapshotKey = null;
    capRuntime.lastResolvedBrushSnapshotKey = null;
    capRuntime.lastResolvedBrushSnapshot = null;
    capRuntime.lastBrushSettingsRef = null;
    capRuntime.lastToolRef = null;
    capRuntime.lastPluginBrushIdRef = null;
    capRuntime.lastCustomBrushDataRef = undefined;
    capRuntime.lastGradientRef = undefined;
    capRuntime.lastGradientSnapshot = undefined;
    capRuntime.lastGradientKey = '';
    capRuntime.cachedStrokeId = null;
    capRuntime.cachedEventIdPrefix = null;
    capRuntime.cachedIdSegment = null;
    capRuntime.lastCaptureLayersRef = null;
    capRuntime.lastCaptureLayerId = null;
    capRuntime.lastResolvedCaptureLayer = null;
    capRuntime.eventCounter = 0;
    capRuntime.lastAcceptedStamp = null;
    capRuntime.lastAcceptedStampAtMs = null;
    capRuntime.emittedCustomStampHashes.clear();
  } else if (!capRuntime.captureWasActive) {
    capRuntime.strokeSegment += 1;
    capRuntime.lastBrushSnapshotKey = null;
    capRuntime.lastAcceptedStamp = null;
    capRuntime.lastAcceptedStampAtMs = null;
  }
  const cappedStamps = applyDeterministicStampCap({
    runtime: capRuntime,
    sessionKey,
    stamps: smearedStamps,
    nowMs: captureNowMs,
  });
  if (cappedStamps.length === 0) {
    return 0;
  }

  const frameCount = Math.max(
    1,
    Math.round(activeLayer.sequentialData?.frameCount ?? state.sequentialRecord.frameCount)
  );
  const fps = Math.max(1, Math.round(activeLayer.sequentialData?.fps ?? state.sequentialRecord.fps));
  const durationMs = Math.round((frameCount * 1000) / fps);
  const sessionStartFrameIndex =
    capRuntime.sessionStartFrameIndex ?? normalizeFrameIndex(state.sequentialRecord.currentFrame, frameCount);
  if (capRuntime.sessionStartFrameIndex == null) {
    capRuntime.sessionStartFrameIndex = sessionStartFrameIndex;
  }
  const frameIndex = resolveCaptureFrameIndex({
    sessionStartMs,
    captureNowMs,
    frameCount,
    fps,
    sessionStartFrameIndex,
  });
  const timestampMs = Math.max(0, Math.round(captureNowMs - sessionStartMs));
  const { brush, key: brushSnapshotKey } = resolveBrushSnapshotForCapture({
    state,
    customBrushData,
    pluginBrushId,
    runtime: capRuntime,
  });
  if (
    capRuntime.lastBrushSnapshotKey !== null &&
    capRuntime.lastBrushSnapshotKey !== brushSnapshotKey
  ) {
    capRuntime.strokeSegment += 1;
  }
  capRuntime.lastBrushSnapshotKey = brushSnapshotKey;
  capRuntime.captureWasActive = true;
  const { strokeId, eventIdPrefix } = resolveStrokeIdentifiers({
    runtime: capRuntime,
    sessionStartMs,
  });
  const sequentialPayloadRuntime = payloadRuntime ?? defaultPayloadBudgetRuntime;
  const payloadNotificationRuntime = notificationRuntime ?? defaultPayloadNotificationRuntime;
  const captureEventBufferRuntime = eventBufferRuntime ?? defaultEventBufferRuntime;
  if (
    captureEventBufferRuntime.sessionKey !== null &&
    captureEventBufferRuntime.sessionKey !== sessionKey
  ) {
    const pendingBytesBeforeFlush = captureEventBufferRuntime.pendingPayloadBytes;
    flushBufferedSequentialEvents({ state, runtime: captureEventBufferRuntime });
    const baselineProjectPayloadBytes =
      Number.isFinite(captureEventBufferRuntime.lastKnownProjectPayloadBytes)
        ? Math.max(0, captureEventBufferRuntime.lastKnownProjectPayloadBytes ?? 0)
        : readSequentialProjectPayloadBytes({
            layers: state.layers,
            runtime: sequentialPayloadRuntime,
          });
    captureEventBufferRuntime.lastKnownLayersRef = state.layers;
    captureEventBufferRuntime.lastKnownProjectPayloadBytes =
      baselineProjectPayloadBytes + pendingBytesBeforeFlush;
  }
  captureEventBufferRuntime.sessionKey = sessionKey;
  const softLimitBytes = Math.max(
    0,
    Math.round(payloadLimits?.softLimitBytes ?? SEQUENTIAL_PAYLOAD_SOFT_LIMIT_BYTES)
  );
  const hardLimitBytes = Math.max(
    softLimitBytes + 1,
    Math.round(payloadLimits?.hardLimitBytes ?? SEQUENTIAL_PAYLOAD_HARD_LIMIT_BYTES)
  );
  const currentProjectPayloadBytes = readCachedProjectPayloadBytes({
    state,
    payloadRuntime: sequentialPayloadRuntime,
    eventBufferRuntime: captureEventBufferRuntime,
  });
  const currentBufferedPayloadBytes = captureEventBufferRuntime.pendingPayloadBytes;
  const currentTotalPayloadBytes = currentProjectPayloadBytes + currentBufferedPayloadBytes;
  if (currentTotalPayloadBytes < softLimitBytes) {
    payloadNotificationRuntime.softWarningShown = false;
  }
  if (
    payloadNotificationRuntime.hardCapBlockedAtBytes !== null &&
    payloadNotificationRuntime.hardCapBlockedAtBytes !== currentTotalPayloadBytes
  ) {
    payloadNotificationRuntime.hardCapBlockedAtBytes = null;
  }

  const baseEvent: SequentialStrokeEvent = {
    id: '',
    layerId: activeLayer.id,
    strokeId,
    timestampMs,
    frameIndex,
    brush,
    stamps: cappedStamps,
  };
  const distributedFrameBuckets = buildTemporalFrameBuckets({
    stamps: cappedStamps,
    frameCount,
    baseFrameIndex: frameIndex,
    timeSmear: state.sequentialRecord.timeSmear,
    forceSplit: forceTemporalSplit,
    disableDistribution: Boolean(brush.customStampHash || brush.customStamp),
  });
  const distributedEvents: SequentialStrokeEvent[] = [];
  const distributedEventPayloadBytes: number[] = [];
  let distributedPayloadBytesTotal = 0;
  for (let i = 0; i < distributedFrameBuckets.length; i += 1) {
    const bucket = distributedFrameBuckets[i];
    const candidateEvent: SequentialStrokeEvent = {
      ...baseEvent,
      id: `${eventIdPrefix}${formatSequentialEventCounter(capRuntime.eventCounter + i)}`,
      timestampMs: timestampMs + i,
      frameIndex: bucket.frameIndex,
      stamps: bucket.stamps,
    };
    const candidateEventBytes = estimateSequentialStrokeEventPayloadBytes(candidateEvent);
    distributedEvents.push(candidateEvent);
    distributedEventPayloadBytes.push(candidateEventBytes);
    distributedPayloadBytesTotal += candidateEventBytes;
  }
  const projectedPayloadBytes = currentTotalPayloadBytes + distributedPayloadBytesTotal;
  if (distributedEvents.length > 0) {
    const smear = state.sequentialRecord.timeSmear;
    recordSequentialTemporalDistributionPerf({
      events: distributedEvents.length,
      buckets: distributedFrameBuckets.length,
      splitCapture: distributedFrameBuckets.length > 1,
      reason: resolveTemporalDistributionReason({
        frameCount,
        stampCount: cappedStamps.length,
        bucketCount: distributedFrameBuckets.length,
        smear,
        forceSplit: forceTemporalSplit,
      }),
      smear,
      inputStamps: cappedStamps.length,
    });
  }

  if (projectedPayloadBytes > hardLimitBytes) {
    if (payloadNotificationRuntime.hardCapBlockedAtBytes !== currentTotalPayloadBytes) {
      state.addNotification({
        type: 'error',
        title: 'Sequential Capture Paused',
        message:
          'Sequential event payload hit the 96 MB safety cap. Trim recorded events or layer data, then continue capture.',
        timestamp: new Date(),
      });
    }
    payloadNotificationRuntime.hardCapBlockedAtBytes = currentTotalPayloadBytes;
    return 0;
  }

  if (projectedPayloadBytes > softLimitBytes && !payloadNotificationRuntime.softWarningShown) {
    state.addNotification({
      type: 'warning',
      title: 'Large Sequential Payload',
      message:
        'Sequential event payload exceeded 32 MB. Autosave/export may slow down as recordings grow.',
      timestamp: new Date(),
      duration: 7000,
    });
    payloadNotificationRuntime.softWarningShown = true;
  }

  for (let i = 0; i < distributedEvents.length; i += 1) {
    enqueueBufferedSequentialEvent({
      layerId: activeLayer.id,
      event: distributedEvents[i],
      metadata: {
        frameCount,
        fps,
        durationMs,
      },
      payloadBytes: distributedEventPayloadBytes[i],
      runtime: captureEventBufferRuntime,
    });
  }
  payloadNotificationRuntime.hardCapBlockedAtBytes = null;
  capRuntime.eventCounter += distributedEvents.length;
  const lastAcceptedStamp = cappedStamps[cappedStamps.length - 1];
  if (lastAcceptedStamp) {
    capRuntime.lastAcceptedStamp = lastAcceptedStamp;
    capRuntime.lastAcceptedStampAtMs = captureNowMs;
  }

  return cappedStamps.length;
};

export const __TESTING__ = {
  STAMP_BURST_CAPACITY,
  defaultStampCapRuntime,
  defaultEventBufferRuntime,
  resetDefaultRuntime: () => {
    defaultStampCapRuntime.sessionKey = null;
    defaultStampCapRuntime.sessionStartFrameIndex = null;
    defaultStampCapRuntime.tokens = STAMP_BURST_CAPACITY;
    defaultStampCapRuntime.lastTimestampMs = null;
    defaultStampCapRuntime.strokeSegment = 0;
    defaultStampCapRuntime.lastBrushSnapshotKey = null;
    defaultStampCapRuntime.lastResolvedBrushSnapshotKey = null;
    defaultStampCapRuntime.lastResolvedBrushSnapshot = null;
    defaultStampCapRuntime.lastBrushSettingsRef = null;
    defaultStampCapRuntime.lastToolRef = null;
    defaultStampCapRuntime.lastPluginBrushIdRef = null;
    defaultStampCapRuntime.lastCustomBrushDataRef = undefined;
    defaultStampCapRuntime.lastGradientRef = undefined;
    defaultStampCapRuntime.lastGradientSnapshot = undefined;
    defaultStampCapRuntime.lastGradientKey = '';
    defaultStampCapRuntime.cachedStrokeId = null;
    defaultStampCapRuntime.cachedEventIdPrefix = null;
    defaultStampCapRuntime.cachedIdSegment = null;
    defaultStampCapRuntime.lastCaptureLayersRef = null;
    defaultStampCapRuntime.lastCaptureLayerId = null;
    defaultStampCapRuntime.lastResolvedCaptureLayer = null;
    defaultStampCapRuntime.captureWasActive = false;
    defaultStampCapRuntime.eventCounter = 0;
    defaultStampCapRuntime.lastAcceptedStamp = null;
    defaultStampCapRuntime.lastAcceptedStampAtMs = null;
    defaultStampCapRuntime.emittedCustomStampHashes.clear();
    defaultEventBufferRuntime.sessionKey = null;
    defaultEventBufferRuntime.pendingPayloadBytes = 0;
    defaultEventBufferRuntime.lastKnownLayersRef = null;
    defaultEventBufferRuntime.lastKnownProjectPayloadBytes = null;
    defaultEventBufferRuntime.isFlushing = false;
    defaultEventBufferRuntime.layers.clear();
    resetSequentialPayloadBudgetRuntime(defaultPayloadBudgetRuntime);
    defaultPayloadNotificationRuntime.softWarningShown = false;
    defaultPayloadNotificationRuntime.hardCapBlockedAtBytes = null;
  },
  SEQUENTIAL_PAYLOAD_SOFT_LIMIT_BYTES,
  SEQUENTIAL_PAYLOAD_HARD_LIMIT_BYTES,
};
