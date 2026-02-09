import { isFeatureFlagEnabled } from '@/config/featureFlags';
import type { CustomBrushStrokeData } from '@/hooks/brushEngine/BrushEngineFacade';
import {
  createSequentialPayloadBudgetRuntime,
  estimateSequentialStrokeEventPayloadBytes,
  readSequentialProjectPayloadBytes,
  resetSequentialPayloadBudgetRuntime,
  SEQUENTIAL_PAYLOAD_HARD_LIMIT_BYTES,
  SEQUENTIAL_PAYLOAD_SOFT_LIMIT_BYTES,
} from '@/lib/sequential/SequentialPayloadBudget';
import { recordSequentialFlushPerf } from '@/lib/sequential/SequentialPerfCounters';
import {
  selectSequentialCaptureActive,
  type AppState,
} from '@/stores/useAppStore';
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

export interface SequentialStampCapRuntime {
  sessionKey: string | null;
  tokens: number;
  lastTimestampMs: number | null;
  strokeSegment: number;
  lastBrushSnapshotKey: string | null;
  lastResolvedBrushSnapshotKey: string | null;
  lastResolvedBrushSnapshot: SequentialBrushSnapshot | null;
  lastBrushSettingsRef: AppState['tools']['brushSettings'] | null;
  lastToolRef: AppState['tools']['currentTool'] | null;
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
}

export interface SequentialPayloadNotificationRuntime {
  softWarningShown: boolean;
  hardCapBlockedAtBytes: number | null;
}

interface BufferedSequentialLayerEvents {
  events: SequentialStrokeEvent[];
  frameCount: number;
  fps: number;
  durationMs: number;
}

export interface SequentialEventBufferRuntime {
  sessionKey: string | null;
  pendingPayloadBytes: number;
  lastKnownLayersRef: Layer[] | null;
  lastKnownProjectPayloadBytes: number | null;
  layers: Map<string, BufferedSequentialLayerEvents>;
}

const defaultStampCapRuntime: SequentialStampCapRuntime = {
  sessionKey: null,
  tokens: STAMP_BURST_CAPACITY,
  lastTimestampMs: null,
  strokeSegment: 0,
  lastBrushSnapshotKey: null,
  lastResolvedBrushSnapshotKey: null,
  lastResolvedBrushSnapshot: null,
  lastBrushSettingsRef: null,
  lastToolRef: null,
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
  layers: new Map<string, BufferedSequentialLayerEvents>(),
};

export const createSequentialStampCapRuntime = (): SequentialStampCapRuntime => ({
  sessionKey: null,
  tokens: STAMP_BURST_CAPACITY,
  lastTimestampMs: null,
  strokeSegment: 0,
  lastBrushSnapshotKey: null,
  lastResolvedBrushSnapshotKey: null,
  lastResolvedBrushSnapshot: null,
  lastBrushSettingsRef: null,
  lastToolRef: null,
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
  if (targetRuntime.layers.size === 0) {
    return 0;
  }

  let flushedEventCount = 0;
  targetRuntime.layers.forEach((entry, layerId) => {
    if (entry.events.length === 0) {
      return;
    }
    state.appendSequentialLayerEvents(layerId, entry.events, {
      frameCount: entry.frameCount,
      fps: entry.fps,
      durationMs: entry.durationMs,
    });
    flushedEventCount += entry.events.length;
  });

  targetRuntime.layers.clear();
  targetRuntime.pendingPayloadBytes = 0;
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
    existing.frameCount = metadata.frameCount;
    existing.fps = metadata.fps;
    existing.durationMs = metadata.durationMs;
  } else {
    runtime.layers.set(layerId, {
      events: [event],
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
  targetRuntime.lastBrushSnapshotKey = null;
};

const normalizeFrameIndex = (frame: number, frameCount: number): number => {
  const safeFrameCount = Math.max(1, Math.round(frameCount));
  const normalized = Math.round(frame) % safeFrameCount;
  return normalized < 0 ? normalized + safeFrameCount : normalized;
};

const buildBrushSnapshot = ({
  state,
  customBrushData,
  gradientSnapshot,
}: {
  state: AppState;
  customBrushData?: CustomBrushStrokeData;
  gradientSnapshot?: SequentialBrushSnapshot['colorCycleGradient'];
}): SequentialBrushSnapshot => {
  const settings = state.tools.brushSettings;
  const customStamp = buildSequentialCustomStampSnapshot(customBrushData);
  return {
    tool: state.tools.currentTool,
    brushShape: settings.brushShape ?? BrushShape.ROUND,
    size: Math.max(1, Number.isFinite(settings.size) ? settings.size : 1),
    opacity: Math.max(0, Math.min(1, Number.isFinite(settings.opacity) ? settings.opacity : 1)),
    blendMode: settings.blendMode,
    rotation: Number.isFinite(settings.rotation) ? settings.rotation : 0,
    spacing: Math.max(0.25, Number.isFinite(settings.spacing) ? settings.spacing : 1),
    color: settings.color || '#000000',
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
    ditherAlgorithm: settings.ditherAlgorithm,
    ditherStrokeTipShape:
      settings.ditherStrokeTipShape ??
      settings.colorCycleStampShape,
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
    snapshot.size,
    snapshot.opacity,
    snapshot.blendMode,
    snapshot.rotation,
    snapshot.spacing,
    snapshot.color,
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

const customStampSnapshotCache = new WeakMap<
  ImageData,
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
  const cached = customStampSnapshotCache.get(imageData);
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
  customStampSnapshotCache.set(imageData, snapshot);
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

  let totalPointCount = stamps.length;
  for (let i = 1; i < stamps.length; i += 1) {
    const from = stamps[i - 1];
    const to = stamps[i];
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    totalPointCount += Math.min(
      4,
      Math.max(0, Math.floor((distance / 8) * (smearFactor - 1)))
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
    const extraPoints = Math.min(
      4,
      Math.max(0, Math.floor((distance / 8) * (smearFactor - 1)))
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
  runtime,
}: {
  state: AppState;
  customBrushData?: CustomBrushStrokeData;
  runtime: SequentialStampCapRuntime;
}): { brush: SequentialBrushSnapshot; key: string } => {
  const settings = state.tools.brushSettings;
  const tool = state.tools.currentTool;
  if (
    runtime.lastBrushSettingsRef === settings &&
    runtime.lastToolRef === tool &&
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
    gradientSnapshot,
  });
  const key = buildBrushSnapshotKey(brush, gradientKey);
  runtime.lastBrushSettingsRef = settings;
  runtime.lastToolRef = tool;
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
): SequentialStampPoint => ({
  x: point.x,
  y: point.y,
  pressure: Number.isFinite(pressure) ? Math.max(0, Math.min(1, pressure)) : 1,
  rotation: Number.isFinite(brushSettings.rotation) ? brushSettings.rotation : 0,
  size: Number.isFinite(brushSettings.size) ? Math.max(0, brushSettings.size) : 1,
  alpha: Number.isFinite(brushSettings.opacity)
    ? Math.max(0, Math.min(1, brushSettings.opacity))
    : 1,
});

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
  const smearedStamps = densifySequentialStampsForSmear({
    stamps: normalizedStamps,
    timeSmear: state.sequentialRecord.timeSmear,
  });

  const captureNowMs = Number.isFinite(nowMs) ? Number(nowMs) : Date.now();
  const sessionStartMs = state.sequentialRecord.sessionStartMs ?? captureNowMs;
  const sessionKey = `${activeLayer.id}:${sessionStartMs}`;
  if (capRuntime.sessionKey !== sessionKey) {
    capRuntime.strokeSegment = 0;
    capRuntime.lastBrushSnapshotKey = null;
    capRuntime.lastResolvedBrushSnapshotKey = null;
    capRuntime.lastResolvedBrushSnapshot = null;
    capRuntime.lastBrushSettingsRef = null;
    capRuntime.lastToolRef = null;
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
  } else if (!capRuntime.captureWasActive) {
    capRuntime.strokeSegment += 1;
    capRuntime.lastBrushSnapshotKey = null;
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
  const frameIndex = normalizeFrameIndex(state.sequentialRecord.currentFrame, frameCount);
  const timestampMs = Math.max(0, Math.round(captureNowMs - sessionStartMs));
  const { brush, key: brushSnapshotKey } = resolveBrushSnapshotForCapture({
    state,
    customBrushData,
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

  const event: SequentialStrokeEvent = {
    id: `${eventIdPrefix}${formatSequentialEventCounter(capRuntime.eventCounter)}`,
    layerId: activeLayer.id,
    strokeId,
    timestampMs,
    frameIndex,
    brush,
    stamps: cappedStamps,
  };
  const eventPayloadBytes = estimateSequentialStrokeEventPayloadBytes(event);
  const projectedPayloadBytes = currentTotalPayloadBytes + eventPayloadBytes;

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

  enqueueBufferedSequentialEvent({
    layerId: activeLayer.id,
    event,
    metadata: {
      frameCount,
      fps,
      durationMs,
    },
    payloadBytes: eventPayloadBytes,
    runtime: captureEventBufferRuntime,
  });
  payloadNotificationRuntime.hardCapBlockedAtBytes = null;
  capRuntime.eventCounter += 1;

  return cappedStamps.length;
};

export const __TESTING__ = {
  STAMP_BURST_CAPACITY,
  defaultStampCapRuntime,
  defaultEventBufferRuntime,
  resetDefaultRuntime: () => {
    defaultStampCapRuntime.sessionKey = null;
    defaultStampCapRuntime.tokens = STAMP_BURST_CAPACITY;
    defaultStampCapRuntime.lastTimestampMs = null;
    defaultStampCapRuntime.strokeSegment = 0;
    defaultStampCapRuntime.lastBrushSnapshotKey = null;
    defaultStampCapRuntime.lastResolvedBrushSnapshotKey = null;
    defaultStampCapRuntime.lastResolvedBrushSnapshot = null;
    defaultStampCapRuntime.lastBrushSettingsRef = null;
    defaultStampCapRuntime.lastToolRef = null;
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
    defaultEventBufferRuntime.sessionKey = null;
    defaultEventBufferRuntime.pendingPayloadBytes = 0;
    defaultEventBufferRuntime.lastKnownLayersRef = null;
    defaultEventBufferRuntime.lastKnownProjectPayloadBytes = null;
    defaultEventBufferRuntime.layers.clear();
    resetSequentialPayloadBudgetRuntime(defaultPayloadBudgetRuntime);
    defaultPayloadNotificationRuntime.softWarningShown = false;
    defaultPayloadNotificationRuntime.hardCapBlockedAtBytes = null;
  },
  SEQUENTIAL_PAYLOAD_SOFT_LIMIT_BYTES,
  SEQUENTIAL_PAYLOAD_HARD_LIMIT_BYTES,
};
