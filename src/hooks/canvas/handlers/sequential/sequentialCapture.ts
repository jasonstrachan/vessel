import { isFeatureFlagEnabled } from '@/config/featureFlags';
import type { CustomBrushStrokeData } from '@/hooks/brushEngine/BrushEngineFacade';
import {
  appendSequentialEventPayloadBytes,
  createSequentialPayloadBudgetRuntime,
  estimateSequentialStrokeEventPayloadBytes,
  readSequentialProjectPayloadBytes,
  resetSequentialPayloadBudgetRuntime,
  SEQUENTIAL_PAYLOAD_HARD_LIMIT_BYTES,
  SEQUENTIAL_PAYLOAD_SOFT_LIMIT_BYTES,
} from '@/lib/sequential/SequentialPayloadBudget';
import {
  selectSequentialCaptureActive,
  type AppState,
} from '@/stores/useAppStore';
import {
  BrushShape,
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
  captureWasActive: boolean;
  eventCounter: number;
}

export interface SequentialPayloadNotificationRuntime {
  softWarningShown: boolean;
  hardCapBlockedAtBytes: number | null;
}

const defaultStampCapRuntime: SequentialStampCapRuntime = {
  sessionKey: null,
  tokens: STAMP_BURST_CAPACITY,
  lastTimestampMs: null,
  strokeSegment: 0,
  lastBrushSnapshotKey: null,
  captureWasActive: false,
  eventCounter: 0,
};

const defaultPayloadBudgetRuntime = createSequentialPayloadBudgetRuntime();
const defaultPayloadNotificationRuntime: SequentialPayloadNotificationRuntime = {
  softWarningShown: false,
  hardCapBlockedAtBytes: null,
};

export const createSequentialStampCapRuntime = (): SequentialStampCapRuntime => ({
  sessionKey: null,
  tokens: STAMP_BURST_CAPACITY,
  lastTimestampMs: null,
  strokeSegment: 0,
  lastBrushSnapshotKey: null,
  captureWasActive: false,
  eventCounter: 0,
});

export const createSequentialPayloadNotificationRuntime = (): SequentialPayloadNotificationRuntime => ({
  softWarningShown: false,
  hardCapBlockedAtBytes: null,
});

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

const buildBrushSnapshot = (
  state: AppState,
  customBrushData?: CustomBrushStrokeData
): SequentialBrushSnapshot => {
  const settings = state.tools.brushSettings;
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
  };
};

const buildBrushSnapshotKey = (snapshot: SequentialBrushSnapshot): string =>
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
  ].join('|');

const coerceStamp = (stamp: SequentialStampPoint): SequentialStampPoint | null => {
  if (!Number.isFinite(stamp.x) || !Number.isFinite(stamp.y)) {
    return null;
  }
  return {
    x: stamp.x,
    y: stamp.y,
    pressure: Number.isFinite(stamp.pressure) ? Math.max(0, Math.min(1, stamp.pressure)) : 1,
    rotation: Number.isFinite(stamp.rotation) ? stamp.rotation : 0,
    size: Number.isFinite(stamp.size) ? Math.max(0, stamp.size) : 0,
    alpha: Number.isFinite(stamp.alpha) ? Math.max(0, Math.min(1, stamp.alpha)) : 1,
  };
};

const resolveCaptureLayer = (state: AppState) => {
  if (!selectSequentialCaptureActive(state)) {
    return null;
  }
  const activeLayerId = state.activeLayerId;
  if (!activeLayerId) {
    return null;
  }
  const activeLayer = state.layers.find((layer) => layer.id === activeLayerId);
  if (!activeLayer || activeLayer.layerType !== 'sequential') {
    return null;
  }
  return activeLayer;
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

  const capped: SequentialStampPoint[] = [];
  for (let i = 0; i < stamps.length; i += 1) {
    if (runtime.tokens < 1) {
      break;
    }
    capped.push(stamps[i]);
    runtime.tokens -= 1;
  }
  return capped;
};

export const captureSequentialStampsForActiveLayer = ({
  state,
  stamps,
  customBrushData,
  runtime,
  payloadRuntime,
  notificationRuntime,
  payloadLimits,
  nowMs,
}: {
  state: AppState;
  stamps: SequentialStampPoint[];
  customBrushData?: CustomBrushStrokeData;
  runtime?: SequentialStampCapRuntime;
  payloadRuntime?: ReturnType<typeof createSequentialPayloadBudgetRuntime>;
  notificationRuntime?: SequentialPayloadNotificationRuntime;
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

  const activeLayer = resolveCaptureLayer(state);
  if (!activeLayer) {
    capRuntime.captureWasActive = false;
    return 0;
  }

  const normalizedStamps = stamps
    .map(coerceStamp)
    .filter((stamp): stamp is SequentialStampPoint => Boolean(stamp));
  if (normalizedStamps.length === 0) {
    capRuntime.captureWasActive = true;
    return 0;
  }

  const captureNowMs = Number.isFinite(nowMs) ? Number(nowMs) : Date.now();
  const sessionStartMs = state.sequentialRecord.sessionStartMs ?? captureNowMs;
  const sessionKey = `${activeLayer.id}:${sessionStartMs}`;
  if (capRuntime.sessionKey !== sessionKey) {
    capRuntime.strokeSegment = 0;
    capRuntime.lastBrushSnapshotKey = null;
    capRuntime.eventCounter = 0;
  } else if (!capRuntime.captureWasActive) {
    capRuntime.strokeSegment += 1;
    capRuntime.lastBrushSnapshotKey = null;
  }
  const cappedStamps = applyDeterministicStampCap({
    runtime: capRuntime,
    sessionKey,
    stamps: normalizedStamps,
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
  const brush = buildBrushSnapshot(state, customBrushData);
  const brushSnapshotKey = buildBrushSnapshotKey(brush);
  if (
    capRuntime.lastBrushSnapshotKey !== null &&
    capRuntime.lastBrushSnapshotKey !== brushSnapshotKey
  ) {
    capRuntime.strokeSegment += 1;
  }
  capRuntime.lastBrushSnapshotKey = brushSnapshotKey;
  capRuntime.captureWasActive = true;
  const strokeId = `stroke-${sessionStartMs}-${capRuntime.strokeSegment}`;
  const sequentialPayloadRuntime = payloadRuntime ?? defaultPayloadBudgetRuntime;
  const payloadNotificationRuntime = notificationRuntime ?? defaultPayloadNotificationRuntime;
  const softLimitBytes = Math.max(
    0,
    Math.round(payloadLimits?.softLimitBytes ?? SEQUENTIAL_PAYLOAD_SOFT_LIMIT_BYTES)
  );
  const hardLimitBytes = Math.max(
    softLimitBytes + 1,
    Math.round(payloadLimits?.hardLimitBytes ?? SEQUENTIAL_PAYLOAD_HARD_LIMIT_BYTES)
  );
  const currentProjectPayloadBytes = readSequentialProjectPayloadBytes({
    layers: state.layers,
    runtime: sequentialPayloadRuntime,
  });
  if (currentProjectPayloadBytes < softLimitBytes) {
    payloadNotificationRuntime.softWarningShown = false;
  }
  if (
    payloadNotificationRuntime.hardCapBlockedAtBytes !== null &&
    payloadNotificationRuntime.hardCapBlockedAtBytes !== currentProjectPayloadBytes
  ) {
    payloadNotificationRuntime.hardCapBlockedAtBytes = null;
  }

  const event: SequentialStrokeEvent = {
    id: `seq-${sessionStartMs}-${capRuntime.strokeSegment}-${String(capRuntime.eventCounter).padStart(6, '0')}`,
    layerId: activeLayer.id,
    strokeId,
    timestampMs,
    frameIndex,
    brush,
    stamps: cappedStamps,
  };
  const projectedPayloadBytes =
    currentProjectPayloadBytes + estimateSequentialStrokeEventPayloadBytes(event);

  if (projectedPayloadBytes > hardLimitBytes) {
    if (payloadNotificationRuntime.hardCapBlockedAtBytes !== currentProjectPayloadBytes) {
      state.addNotification({
        type: 'error',
        title: 'Sequential Capture Paused',
        message:
          'Sequential event payload hit the 96 MB safety cap. Trim recorded events or layer data, then continue capture.',
        timestamp: new Date(),
      });
    }
    payloadNotificationRuntime.hardCapBlockedAtBytes = currentProjectPayloadBytes;
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

  state.appendSequentialLayerEvent(activeLayer.id, event, {
    frameCount,
    fps,
    durationMs,
  });
  appendSequentialEventPayloadBytes({
    layerId: activeLayer.id,
    event,
    runtime: sequentialPayloadRuntime,
  });
  payloadNotificationRuntime.hardCapBlockedAtBytes = null;
  capRuntime.eventCounter += 1;

  return cappedStamps.length;
};

export const __TESTING__ = {
  STAMP_BURST_CAPACITY,
  defaultStampCapRuntime,
  resetDefaultRuntime: () => {
    defaultStampCapRuntime.sessionKey = null;
    defaultStampCapRuntime.tokens = STAMP_BURST_CAPACITY;
    defaultStampCapRuntime.lastTimestampMs = null;
    defaultStampCapRuntime.strokeSegment = 0;
    defaultStampCapRuntime.lastBrushSnapshotKey = null;
    defaultStampCapRuntime.captureWasActive = false;
    defaultStampCapRuntime.eventCounter = 0;
    resetSequentialPayloadBudgetRuntime(defaultPayloadBudgetRuntime);
    defaultPayloadNotificationRuntime.softWarningShown = false;
    defaultPayloadNotificationRuntime.hardCapBlockedAtBytes = null;
  },
  SEQUENTIAL_PAYLOAD_SOFT_LIMIT_BYTES,
  SEQUENTIAL_PAYLOAD_HARD_LIMIT_BYTES,
};
