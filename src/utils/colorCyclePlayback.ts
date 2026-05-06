import { ccGroup, ccGroupEnd, ccLog, dumpLayerFlags } from '@/debug/ccDebug';
import { RecolorManager } from '@/lib/colorCycle/RecolorManager';
import {
  getPlaybackRuntimeController,
} from '@/runtime/playback/PlaybackRuntimeController';
import {
  selectColorCyclePlaybackToggleAction,
  selectColorCycleDesiredPlaying,
  selectColorCycleSuspendDepth,
  selectEffectiveColorCyclePlaying,
  useAppStore,
  type CCReason
} from '@/stores/useAppStore';
import { getColorCycleHydrationState } from '@/stores/layerHydration';
import type { Layer } from '@/types';
import { logCCMutation } from '@/utils/colorCycle/ccMutationAudit';
import {
  hasRecoverableColorCycleRuntimeSource,
} from '@/utils/colorCycle/resolveColorCycleRuntimeRestore';

declare global {
  interface Window {
    __ccRafAlive?: boolean;
  }
}

const isRecolorLayer = (layer: Layer) =>
  layer.layerType === 'color-cycle' && layer.colorCycleData?.mode === 'recolor';

const isVisibleBrushColorCycleLayer = (layer: Layer): boolean => (
  layer.layerType === 'color-cycle' &&
  layer.visible !== false &&
  layer.colorCycleData?.mode !== 'recolor'
);

type PlaybackCanonicalSummary = {
  hasContent: boolean;
  paintBytes: number;
  gradientIdBytes: number;
  gradientDefIdBytes: number;
  phaseBytes: number;
  brushState: boolean;
};

const getDocumentStateBufferBytes = (
  layer: Layer,
  key: 'paintRef' | 'gradientIdRef' | 'gradientDefIdRef' | 'phaseRef',
): number => {
  const state = (layer as unknown as {
    state?: Record<string, unknown>;
  }).state;
  const value = state?.[key] as { byteLength?: number } | string | undefined;
  return typeof value === 'object' && typeof value.byteLength === 'number'
    ? value.byteLength
    : 0;
};

const summarizePlaybackCanonicalPayload = (layer: Layer): PlaybackCanonicalSummary | null => {
  if (layer.layerType !== 'color-cycle' || !layer.colorCycleData) {
    return null;
  }
  const data = layer.colorCycleData;
  const documentState = (layer as unknown as {
    state?: {
      hasContent?: boolean;
      paintRef?: unknown;
      gradientIdRef?: unknown;
      gradientDefIdRef?: unknown;
      phaseRef?: unknown;
    };
  }).state;
  return {
    hasContent: Boolean(data.hasContent === true || documentState?.hasContent === true),
    paintBytes: getDocumentStateBufferBytes(layer, 'paintRef'),
    gradientIdBytes: data.gradientIdBuffer?.byteLength ?? getDocumentStateBufferBytes(layer, 'gradientIdRef'),
    gradientDefIdBytes: data.gradientDefIdBuffer?.byteLength ?? getDocumentStateBufferBytes(layer, 'gradientDefIdRef'),
    phaseBytes: data.phaseBuffer?.byteLength ?? getDocumentStateBufferBytes(layer, 'phaseRef'),
    brushState: Boolean(data.brushState),
  };
};

const logPlaybackAuditEvent = (
  event: string,
  layer: Layer,
  reason: CCReason,
  details?: Record<string, unknown>,
): void => {
  const colorCycleData = layer.layerType === 'color-cycle' ? layer.colorCycleData : undefined;
  const brush = colorCycleData?.colorCycleBrush;
  let brushIsPlaying: boolean | null = null;
  try {
    brushIsPlaying = typeof brush?.isPlaying === 'function' ? brush.isPlaying() : null;
  } catch {
    brushIsPlaying = null;
  }
  logCCMutation({
    event,
    severity: event.endsWith('failed') ? 'error' : 'info',
    layerId: layer.id,
    reason,
    details: {
      visible: layer.visible !== false,
      runtimeHydrationState: getColorCycleHydrationState(colorCycleData),
      deferredRuntimeRestore: colorCycleData?.deferredRuntimeRestore ?? null,
      hasRuntimeBrush: Boolean(brush),
      brushIsPlaying,
      canonicalSummary: summarizePlaybackCanonicalPayload(layer),
      ...details,
    },
  });
};

const logPlaybackCanonicalSummary = (
  event: string,
  layers: Layer[],
  reason: CCReason,
): Map<string, PlaybackCanonicalSummary> => {
  const summaries = new Map<string, PlaybackCanonicalSummary>();
  layers.forEach((layer) => {
    const summary = summarizePlaybackCanonicalPayload(layer);
    if (!summary) {
      return;
    }
    summaries.set(layer.id, summary);
    logPlaybackAuditEvent(event, layer, reason, { canonicalSummary: summary });
  });
  return summaries;
};

const playbackCanonicalSummaryHasDestructiveChange = (
  before: PlaybackCanonicalSummary,
  after: PlaybackCanonicalSummary,
): boolean => (
  (before.hasContent && !after.hasContent) ||
  (before.paintBytes > 0 && after.paintBytes === 0) ||
  (before.gradientIdBytes > 0 && after.gradientIdBytes === 0) ||
  (before.gradientDefIdBytes > 0 && after.gradientDefIdBytes === 0) ||
  (before.phaseBytes > 0 && after.phaseBytes === 0) ||
  (before.brushState && !after.brushState)
);

const logPlaybackCanonicalMutation = (
  before: Map<string, PlaybackCanonicalSummary>,
  layers: Layer[],
  reason: CCReason,
): void => {
  layers.forEach((layer) => {
    const beforeSummary = before.get(layer.id);
    const afterSummary = summarizePlaybackCanonicalPayload(layer);
    if (!beforeSummary || !afterSummary) {
      return;
    }
    if (JSON.stringify(beforeSummary) === JSON.stringify(afterSummary)) {
      return;
    }
    if (!playbackCanonicalSummaryHasDestructiveChange(beforeSummary, afterSummary)) {
      return;
    }
    logCCMutation({
      event: 'cc-playback-canonical-mutated',
      severity: 'error',
      layerId: layer.id,
      reason,
      details: {
        before: beforeSummary,
        after: afterSummary,
      },
    });
  });
};

const hasColorCyclePlaybackWarmupSource = (layer: Layer): boolean => {
  if (layer.layerType !== 'color-cycle' || !layer.colorCycleData) {
    return false;
  }
  const documentState = (layer as unknown as {
    state?: {
      hasContent?: boolean;
      paintRef?: unknown;
      gradientIdRef?: unknown;
      gradientDefIdRef?: unknown;
    };
  }).state;
  const hasRecoverablePayload = hasRecoverableColorCycleRuntimeSource(layer);
  if (layer.colorCycleData.repairStatus?.ok === false) {
    return hasRecoverablePayload;
  }
  return Boolean(
    layer.colorCycleData.hasContent === true ||
    layer.colorCycleData.deferredRuntimeRestore === true ||
    documentState?.hasContent === true ||
    hasRecoverablePayload
  );
};

export const isColorCycleDesired = (): boolean =>
  selectColorCycleDesiredPlaying(useAppStore.getState());

export const isColorCycleEffective = (): boolean =>
  selectEffectiveColorCyclePlaying(useAppStore.getState());

const reconcileRecolorPlayback = async (
  layers: Layer[],
  targetPlaying: boolean,
  reason: CCReason
): Promise<void> => {
  const manager = RecolorManager.getInstance();
  const recolorLayers = layers.filter(layer => isRecolorLayer(layer) && layer.visible);
  const layerIds = recolorLayers.map(layer => layer.id);

  try {
    if (targetPlaying) {
      await Promise.all(recolorLayers.map(layer => manager.registerExistingLayer(layer)));
      ccLog('Recolor registered', { count: recolorLayers.length, reason });
      manager.playAll();
      const maybeRenderOnce = (manager as { renderOnce?: () => void }).renderOnce;
      if (typeof maybeRenderOnce === 'function') {
        maybeRenderOnce.call(manager);
        ccLog('Recolor first-frame nudged', { reason });
      }
    } else {
      manager.pause();
      ccLog('Recolor paused', { reason });
    }
  } catch (error) {
    ccLog('Recolor toggle error', { error, reason });
  }

  if (layerIds.length === 0) {
    return;
  }

  try {
    const { layers: currentLayers, updateLayer } = useAppStore.getState();
    layerIds.forEach(layerId => {
      const current = currentLayers.find(layer => layer.id === layerId);
      const colorCycleData = current?.colorCycleData;
      const recolorSettings = colorCycleData?.recolorSettings;
      if (!colorCycleData || !recolorSettings?.animation) {
        return;
      }

      if (recolorSettings.animation.isPlaying === targetPlaying) {
        return;
      }

      updateLayer(layerId, {
        colorCycleData: {
          ...colorCycleData,
          recolorSettings: {
            ...recolorSettings,
            animation: {
              ...recolorSettings.animation,
              isPlaying: targetPlaying
            }
          }
        }
      });
    });
  } catch (error) {
    ccLog('Recolor state sync error', { error, reason });
  }
};

const warmVisibleBrushColorCycleLayersForPlayback = async (
  layers: Layer[],
  reason: CCReason,
): Promise<boolean> => {
  const targets = layers.filter((layer) => (
    isVisibleBrushColorCycleLayer(layer) &&
    !layer.colorCycleData?.colorCycleBrush &&
    hasColorCyclePlaybackWarmupSource(layer)
  ));
  if (targets.length === 0) {
    return true;
  }

  const state = useAppStore.getState();
  const ensureRuntime = state.ensureColorCycleLayerRuntime;
  if (typeof ensureRuntime !== 'function') {
    return false;
  }

  const results = await Promise.all(targets.map(async (layer) => {
    try {
      logPlaybackAuditEvent('cc-playback-warmup-started', layer, reason);
      const warmed = await ensureRuntime(layer.id, {
        target: state.activeLayerId === layer.id ? 'active' : 'warm',
      });
      const latestLayer = useAppStore.getState().layers.find((candidate) => candidate.id === layer.id) ?? layer;
      if (!warmed) {
        logPlaybackAuditEvent('cc-playback-warmup-failed', latestLayer, reason, {
          warmed,
        });
        logPlaybackAuditEvent('cc-playback-warmup-skipped', latestLayer, reason, { warmed });
        return false;
      }
      logPlaybackAuditEvent('cc-playback-warmup-complete', latestLayer, reason, { warmed });
      return warmed;
    } catch (error) {
      logPlaybackAuditEvent('cc-playback-warmup-failed', layer, reason, {
        message: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }));
  return results.every(Boolean);
};

export const toggleGlobalColorCyclePlayback = async (
  shouldPlay: boolean,
  reason: CCReason
): Promise<void> => {
  if (typeof window === 'undefined') {
    return;
  }

  ccGroup('toggleGlobalColorCyclePlayback()', { shouldPlay, reason });

  const layersBeforeToggle = useAppStore.getState().layers;
  const beforeCanonicalSummaries = logPlaybackCanonicalSummary(
    'cc-playback-canonical-summary-before',
    layersBeforeToggle,
    reason,
  );
  layersBeforeToggle
    .filter((layer) => layer.layerType === 'color-cycle')
    .forEach((layer) => {
      logPlaybackAuditEvent('cc-playback-toggle-requested', layer, reason, { shouldPlay });
    });
  const finishPlaybackAudit = (): void => {
    const layersAfterToggle = useAppStore.getState().layers;
    logPlaybackCanonicalSummary(
      'cc-playback-canonical-summary-after',
      layersAfterToggle,
      reason,
    );
    logPlaybackCanonicalMutation(beforeCanonicalSummaries, layersAfterToggle, reason);
  };

  const { playColorCycle, pauseColorCycle } = useAppStore.getState();
  if (shouldPlay) {
    playColorCycle(reason);
  } else {
    pauseColorCycle(reason);
  }

  const snapshot = useAppStore.getState();
  const desiredPlaying = selectColorCycleDesiredPlaying(snapshot);
  const effectivePlaying = selectEffectiveColorCyclePlaying(snapshot);
  const suspendDepth = selectColorCycleSuspendDepth(snapshot);

  ccLog('colorCyclePlayback state synced', {
    desiredPlaying,
    effectivePlaying,
    suspendDepth,
    reason
  });

  try {
    if (shouldPlay) {
      const warmupReady = await warmVisibleBrushColorCycleLayersForPlayback(
        useAppStore.getState().layers,
        reason,
      );
      if (!warmupReady) {
        useAppStore.getState().pauseColorCycle(reason);
        useAppStore.getState().colorCycleRuntimeHandlers?.stop?.('store-sync');
        ccLog('blocked playback start because CC warmup failed', { reason });
        dumpLayerFlags();
        ccGroupEnd();
        finishPlaybackAudit();
        return;
      }
      const currentState = useAppStore.getState();
      if (!selectColorCycleDesiredPlaying(currentState) || !selectEffectiveColorCyclePlaying(currentState)) {
        currentState.colorCycleRuntimeHandlers?.stop?.('store-sync');
        ccLog('blocked playback start because desired playback changed during warmup', {
          reason,
          desiredPlaying: selectColorCycleDesiredPlaying(currentState),
          effectivePlaying: selectEffectiveColorCyclePlaying(currentState),
          suspendDepth: selectColorCycleSuspendDepth(currentState),
        });
        dumpLayerFlags();
        ccGroupEnd();
        finishPlaybackAudit();
        return;
      }
      const playbackController = getPlaybackRuntimeController();
      playbackController.requestColorCycleRuntimeStart(currentState, 'store-sync');
      useAppStore.getState().layers
        .filter((layer) => layer.layerType === 'color-cycle')
        .forEach((layer) => {
          logPlaybackAuditEvent('cc-playback-runtime-started', layer, reason);
        });
      playbackController.sync(currentState, 'store-sync');
      ccLog('synced playback controller start from toggleGlobalColorCyclePlayback', { reason });
    } else {
      useAppStore.getState().colorCycleRuntimeHandlers?.stop?.('store-sync');
      useAppStore.getState().layers
        .filter((layer) => layer.layerType === 'color-cycle')
        .forEach((layer) => {
          logPlaybackAuditEvent('cc-playback-runtime-stopped', layer, reason);
        });
      ccLog('invoked colorCycleRuntimeHandlers.stop from toggleGlobalColorCyclePlayback', { reason });
    }
  } catch {}

  await reconcileRecolorPlayback(snapshot.layers, desiredPlaying, reason);

  finishPlaybackAudit();

  dumpLayerFlags();
  ccGroupEnd();
};

export const toggleToolbarColorCyclePlayback = async (): Promise<void> => {
  const snapshot = useAppStore.getState();
  const action = selectColorCyclePlaybackToggleAction(snapshot);
  logCCMutation({
    event: 'cc-playback-toggle-requested',
    severity: 'info',
    layerId: snapshot.activeLayerId ?? 'global',
    reason: 'toolbar',
    details: {
      action,
      desiredPlayingBefore: snapshot.colorCyclePlayback.desiredPlaying,
      suspendDepthBefore: snapshot.colorCyclePlayback.suspendDepth,
      activeLayerId: snapshot.activeLayerId,
      activeLayerType: snapshot.layers.find((layer) => layer.id === snapshot.activeLayerId)?.layerType ?? null,
      selectionStart: snapshot.selectionStart,
      selectionEnd: snapshot.selectionEnd,
      selectionMaskBounds: snapshot.selectionMaskBounds,
      selectionLastAction: snapshot.selectionLastAction,
    },
  });

  if (action === 'pause') {
    await toggleGlobalColorCyclePlayback(false, 'toolbar');
    return;
  }

  if (snapshot.colorCyclePlayback.suspendDepth > 0) {
    snapshot.forceResumeColorCycle('toolbar');
  }

  await toggleGlobalColorCyclePlayback(true, 'toolbar');
};
