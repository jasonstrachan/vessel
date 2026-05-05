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

const hasBufferLikePayload = (value: unknown): boolean => {
  if (value instanceof ArrayBuffer) {
    return value.byteLength > 0;
  }
  if (ArrayBuffer.isView(value)) {
    return value.byteLength > 0;
  }
  return typeof value === 'string' && value.length > 0;
};

const brushStateHasPlaybackPayload = (brushState: unknown): boolean => {
  const snapshots = (brushState as {
    layers?: Array<{
      strokeData?: {
        hasContent?: boolean;
        paintBuffer?: unknown;
        gradientIdBuffer?: unknown;
        gradientDefIdBuffer?: unknown;
      };
    }>;
  } | undefined)?.layers;
  return Boolean(snapshots?.some((snapshot) => {
    const strokeData = snapshot.strokeData;
    return Boolean(
      strokeData?.hasContent === true ||
      hasBufferLikePayload(strokeData?.paintBuffer) ||
      hasBufferLikePayload(strokeData?.gradientIdBuffer) ||
      hasBufferLikePayload(strokeData?.gradientDefIdBuffer)
    );
  }));
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
  return Boolean(
    layer.colorCycleData.hasContent === true ||
    layer.colorCycleData.deferredRuntimeRestore === true ||
    documentState?.hasContent === true ||
    hasBufferLikePayload(documentState?.paintRef) ||
    hasBufferLikePayload(documentState?.gradientIdRef) ||
    hasBufferLikePayload(documentState?.gradientDefIdRef) ||
    brushStateHasPlaybackPayload(layer.colorCycleData.brushState)
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
      const warmed = await ensureRuntime(layer.id, {
        target: state.activeLayerId === layer.id ? 'active' : 'warm',
      });
      if (!warmed) {
        logCCMutation({
          event: 'cc-playback-warmup-skipped',
          severity: 'warn',
          layerId: layer.id,
          reason,
          details: {
            hydrationState: getColorCycleHydrationState(layer.colorCycleData),
            deferredRuntimeRestore: layer.colorCycleData?.deferredRuntimeRestore ?? null,
            hasRuntimeBrush: Boolean(layer.colorCycleData?.colorCycleBrush),
          },
        });
      }
      return warmed;
    } catch (error) {
      logCCMutation({
        event: 'cc-playback-warmup-failed',
        severity: 'error',
        layerId: layer.id,
        reason,
        details: {
          message: error instanceof Error ? error.message : String(error),
          hydrationState: getColorCycleHydrationState(layer.colorCycleData),
          deferredRuntimeRestore: layer.colorCycleData?.deferredRuntimeRestore ?? null,
          hasRuntimeBrush: Boolean(layer.colorCycleData?.colorCycleBrush),
        },
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
        return;
      }
      const playbackController = getPlaybackRuntimeController();
      playbackController.requestColorCycleRuntimeStart(currentState, 'store-sync');
      playbackController.sync(currentState, 'store-sync');
      ccLog('synced playback controller start from toggleGlobalColorCyclePlayback', { reason });
    } else {
      useAppStore.getState().colorCycleRuntimeHandlers?.stop?.('store-sync');
      ccLog('invoked colorCycleRuntimeHandlers.stop from toggleGlobalColorCyclePlayback', { reason });
    }
  } catch {}

  await reconcileRecolorPlayback(snapshot.layers, desiredPlaying, reason);

  dumpLayerFlags();
  ccGroupEnd();
};

export const toggleToolbarColorCyclePlayback = async (): Promise<void> => {
  const snapshot = useAppStore.getState();
  const action = selectColorCyclePlaybackToggleAction(snapshot);
  logCCMutation({
    event: 'color-cycle-playback-toggle',
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
