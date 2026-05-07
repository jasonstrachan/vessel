import { getAppStoreState } from '@/stores/appStoreAccess';
import type React from 'react';
import type { AppState } from '@/stores/useAppStore';
import { useAppStore } from '@/stores/useAppStore';
import { flushGradientApply, requestGradientApply } from '@/hooks/brushEngine/ccGradientApplyScheduler';
import type { ForegroundGradientParams } from '@/hooks/canvas/utils/colorCycleHelpers';
import { resolveColorCycleGradientSourceState } from '@/hooks/canvas/handlers/colorCycle/colorCycleGradientSourceContract';
import { setLayerColorCycleGradient, setSharedColorCycleGradient } from '@/utils/colorCycleGradients';
import {
  beginMarkGradientSession,
  getActiveMarkGradientSession,
  cancelMarkGradientSession,
} from '@/hooks/canvas/utils/colorCycleMarkSession';
import { appendCCDebugOverlayEntry } from '@/utils/colorCycle/ccDebugOverlayStore';
import { updateCcSampledSession } from './ccSampling';

const logSampledController = (event: string, payload: Record<string, unknown>): void => {
  if (process.env.NODE_ENV === 'test') {
    return;
  }
  appendCCDebugOverlayEntry('log', `sampled controller: ${event}`, payload);
};

export interface CcGradientSampleCountWriterDeps {
  sampleCountRef: React.MutableRefObject<number>;
  sampleCountLastUpdateRef: React.MutableRefObject<number>;
  storeRef: React.MutableRefObject<AppState>;
  sampleCountWriteMs: number;
}

export const writeCcGradientSampleCountController = (
  nextCount: number,
  now: number,
  force: boolean,
  deps: CcGradientSampleCountWriterDeps
) => {
  const normalized = Math.max(0, Math.round(nextCount));
  const lastCount = deps.sampleCountRef.current;
  const lastUpdateAt = deps.sampleCountLastUpdateRef.current;
  if (force || (normalized !== lastCount && now - lastUpdateAt >= deps.sampleCountWriteMs)) {
    deps.sampleCountRef.current = normalized;
    deps.sampleCountLastUpdateRef.current = now;
    deps.storeRef.current.setCcGradientSampleCount(normalized);
  }
};

interface UpdateCcSampledGradientOptions {
  layerId?: string | null;
  markKind?: 'stroke' | 'shape';
}

export interface UpdateCcSampledGradientDeps {
  storeRef: React.MutableRefObject<AppState>;
  sampleHexAt: (x: number, y: number) => string;
  ccSampledLastUpdateRef: React.MutableRefObject<number>;
  ccSampledRuntimeFlushAtRef: React.MutableRefObject<number>;
  sampledRuntimeFlushThrottleMs: number;
  resolveFgParamsFromState: (state: AppState) => ForegroundGradientParams;
  writeCcGradientSampleCount: (nextCount: number, now: number, force?: boolean) => void;
  ccLog: (message: string, data?: Record<string, unknown>) => void;
}

export const updateCcSampledGradientController = (
  sourcePts: Array<{ x: number; y: number }>,
  options: UpdateCcSampledGradientOptions | undefined,
  deps: UpdateCcSampledGradientDeps
) => {
  const targetLayerId = options?.layerId ?? deps.storeRef.current.activeLayerId;
  const isShapeSampledUpdate = options?.markKind === 'shape';
  if (!targetLayerId) {
    logSampledController('skipped missing layer', {
      sourcePts: sourcePts.length,
      optionLayerId: options?.layerId ?? null,
      activeLayerId: deps.storeRef.current.activeLayerId ?? null,
    });
    deps.ccLog('sampled tick skipped', {
      reason: 'missing-layer',
      sourcePtsLen: sourcePts.length,
      optionLayerId: options?.layerId ?? null,
      activeLayerId: deps.storeRef.current.activeLayerId ?? null,
    });
    return;
  }

  let session = getActiveMarkGradientSession(targetLayerId);
  if (!session) {
    const currentState = deps.storeRef.current;
    const layer = currentState.layers.find((entry) => entry.id === targetLayerId);
    if (layer?.layerType === 'color-cycle' && currentState.tools.ccGradientSource === 'sampled') {
      const resolved = resolveColorCycleGradientSourceState({
        layer,
        brushSettings: currentState.tools.brushSettings,
        fgParams: deps.resolveFgParamsFromState(currentState),
        ccGradientSource: currentState.tools.ccGradientSource,
      });
      const gradientKind =
        currentState.tools.brushSettings.colorCycleFillMode === 'linear' ? 'linear' : 'concentric';
      session = beginMarkGradientSession({
        layerId: targetLayerId,
        markKind: options?.markKind ?? 'stroke',
        gradientKind,
        source: resolved.source,
        stops: resolved.activeStops,
        speedCps: currentState.tools.brushSettings.colorCycleSpeed,
      });
      deps.ccLog('sampled tick session bootstrap', {
        layerId: targetLayerId,
        started: Boolean(session),
        sourcePtsLen: sourcePts.length,
        activeStopsLen: resolved.activeStops.length,
      });
      logSampledController('session bootstrap', {
        layerId: targetLayerId,
        started: Boolean(session),
        sourcePts: sourcePts.length,
        activeStopsLen: resolved.activeStops.length,
        gradientBands: currentState.tools.brushSettings.gradientBands ?? null,
        ditherAlgorithm: currentState.tools.brushSettings.ditherAlgorithm ?? null,
        patternStyle: currentState.tools.brushSettings.patternStyle ?? null,
      });
    }
  }

  if (!session || session.source !== 'sampled') {
    logSampledController('skipped session', {
      reason: !session ? 'missing-session' : 'non-sampled-session',
      layerId: targetLayerId,
      sessionSource: session?.source ?? null,
      sourcePts: sourcePts.length,
      ccGradientSource: deps.storeRef.current.tools.ccGradientSource,
    });
    deps.ccLog('sampled tick skipped', {
      reason: !session ? 'missing-session' : 'non-sampled-session',
      layerId: targetLayerId,
      sessionSource: session?.source ?? null,
      sourcePtsLen: sourcePts.length,
    });
    return;
  }

  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  logSampledController('tick', {
    layerId: targetLayerId,
    markKind: options?.markKind ?? null,
    sourcePts: sourcePts.length,
    previewLen: session.previewStopsStored?.length ?? 0,
    fallbackLen: session.fallbackStopsStored?.length ?? 0,
    frozenLen: session.frozenStopsStored?.length ?? 0,
  });
  deps.ccLog('sampled tick', {
    layerId: targetLayerId,
    markId: session.markId,
    previewLen: session.previewStopsStored?.length ?? 0,
  });
  const result = updateCcSampledSession({
    session,
    sourcePts,
    now,
    lastUpdateRef: deps.ccSampledLastUpdateRef,
    sampleColor: deps.sampleHexAt,
    allowTiny: true,
  });

  if (!result) {
    logSampledController('no sampled result', {
      layerId: targetLayerId,
      sourcePts: sourcePts.length,
      previewLen: session.previewStopsStored?.length ?? 0,
      samplesLen: session.samples?.length ?? 0,
    });
    return;
  }

  logSampledController('sampled result', {
    layerId: targetLayerId,
    sampleCount: result.sampleCount,
    stopCount: result.stops.length,
    uniqueColors: new Set(result.stops.map((stop) => stop.color)).size,
    updated: result.updated,
  });
  deps.writeCcGradientSampleCount(result.sampleCount, now);
  if (result.updated) {
    requestGradientApply(targetLayerId, 'sampled-tick');
    if (!isShapeSampledUpdate && now - deps.ccSampledRuntimeFlushAtRef.current >= deps.sampledRuntimeFlushThrottleMs) {
      deps.ccSampledRuntimeFlushAtRef.current = now;
      flushGradientApply(targetLayerId);
    }
  }
};

export const setSharedColorCycleGradientForShapesController = (
  stops: Array<{ position: number; color: string }> | null,
  deps: {
    storeRef: React.MutableRefObject<AppState>;
    autoSampleForkRef: React.MutableRefObject<boolean>;
  }
) => {
  if (!stops) {
    return;
  }

  const currentState = deps.storeRef.current;
  const activeLayerId = currentState.activeLayerId;
  const activeLayer = currentState.layers.find((layer) => layer.id === activeLayerId);
  if (activeLayer?.layerType === 'color-cycle' && activeLayerId) {
    const allowForegroundOverride = Boolean(currentState.tools.brushSettings.autoSampleGradientRealtime);
    setLayerColorCycleGradient(stops, activeLayerId, {
      fork: deps.autoSampleForkRef.current,
      allowForegroundOverride,
    });
    return;
  }
  setSharedColorCycleGradient(stops, { fork: deps.autoSampleForkRef.current });
};

export const subscribeCcGradientSourceResetController = (deps: {
  storeRef: React.MutableRefObject<AppState>;
  activeLayerIdRef: React.MutableRefObject<string | null>;
  isPointerDownRef: React.MutableRefObject<boolean>;
  resetCcGradientSample: () => void;
  clearBrushSamplingPreview: () => void;
  ccSampledPointsRef: React.MutableRefObject<Array<{ x: number; y: number }>>;
  ccSampledLastUpdateRef: React.MutableRefObject<number>;
  ccGradientSampleCountRef: React.MutableRefObject<number>;
  ccGradientSampleCountLastUpdateRef: React.MutableRefObject<number>;
}) => {
  const selector = (state: AppState) => ({
    source: state.tools.ccGradientSource,
    resetToken: state.ccGradientSampleResetToken,
    activeLayerId: state.activeLayerId,
  });

  const initial = selector(getAppStoreState());
  deps.activeLayerIdRef.current = initial.activeLayerId ?? null;

  return useAppStore.subscribe((state, prevState) => {
    const next = selector(state);
    const prev = prevState ? selector(prevState) : next;
    const sourceChanged = next.source !== prev.source;
    const resetTriggered = next.resetToken !== prev.resetToken;
    const layerChanged = next.activeLayerId !== prev.activeLayerId;

    if (layerChanged && prev.activeLayerId) {
      deps.isPointerDownRef.current = false;
      cancelMarkGradientSession(prev.activeLayerId);
    }

    if (sourceChanged || resetTriggered) {
      if (next.activeLayerId) {
        deps.isPointerDownRef.current = false;
        cancelMarkGradientSession(next.activeLayerId);
      }
      deps.resetCcGradientSample();
      deps.clearBrushSamplingPreview();
      deps.ccSampledPointsRef.current = [];
      deps.ccSampledLastUpdateRef.current = 0;
      try {
        deps.storeRef.current.setCcGradientSampleCount(0);
        deps.ccGradientSampleCountRef.current = 0;
        deps.ccGradientSampleCountLastUpdateRef.current = 0;
      } catch {
        // no-op
      }
    }

    deps.activeLayerIdRef.current = next.activeLayerId ?? null;
  });
};
