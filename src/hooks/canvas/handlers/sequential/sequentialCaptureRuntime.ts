import type { CustomBrushStrokeData } from '@/hooks/brushEngine/BrushEngineFacade';
import { createSequentialPayloadBudgetRuntime } from '@/lib/sequential/SequentialPayloadBudget';
import type { AppState } from '@/stores/useAppStore';
import type { BrushSettings, Layer, SequentialBrushSnapshot, SequentialStampPoint, SequentialStrokeEvent } from '@/types';

export const MAX_SEQUENTIAL_STAMPS_PER_SEC = 6000;
const STAMP_BURST_WINDOW_SECONDS = 0.1;
export const STAMP_BURST_CAPACITY = MAX_SEQUENTIAL_STAMPS_PER_SEC * STAMP_BURST_WINDOW_SECONDS;

export interface SequentialStampCapRuntime {
  sessionKey: string | null;
  sessionStartFrameIndex: number | null;
  tokens: number;
  lastTimestampMs: number | null;
  strokeSegment: number;
  lastBrushSnapshotKey: string | null;
  lastResolvedBrushSnapshotKey: string | null;
  lastResolvedBrushSnapshot: SequentialBrushSnapshot | null;
  lastSelectionStartRef?: AppState['selectionStart'];
  lastSelectionEndRef?: AppState['selectionEnd'];
  lastSelectionMaskRef?: AppState['selectionMask'];
  lastSelectionMaskBoundsRef?: AppState['selectionMaskBounds'];
  lastSelectionClip?: SequentialBrushSnapshot['selectionClip'];
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
  selectionClipKeysByLayer: Map<string, Set<string>>;
  lastKnownLayersRef: Layer[] | null;
  lastKnownProjectPayloadBytes: number | null;
  isFlushing: boolean;
  layers: Map<string, BufferedSequentialLayerEvents>;
}

export const defaultStampCapRuntime: SequentialStampCapRuntime = {
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

export const defaultPayloadBudgetRuntime = createSequentialPayloadBudgetRuntime();
export const defaultPayloadNotificationRuntime: SequentialPayloadNotificationRuntime = {
  softWarningShown: false,
  hardCapBlockedAtBytes: null,
};
export const defaultEventBufferRuntime: SequentialEventBufferRuntime = {
  sessionKey: null,
  pendingPayloadBytes: 0,
  selectionClipKeysByLayer: new Map(),
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
  selectionClipKeysByLayer: new Map(),
  lastKnownLayersRef: null,
  lastKnownProjectPayloadBytes: null,
  isFlushing: false,
  layers: new Map<string, BufferedSequentialLayerEvents>(),
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
