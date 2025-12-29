import { ccGroup, ccGroupEnd, ccLog, dumpLayerFlags } from '@/debug/ccDebug';
import { RecolorManager } from '@/lib/colorCycle/RecolorManager';
import {
  selectColorCycleDesiredPlaying,
  selectColorCycleSuspendDepth,
  selectEffectiveColorCyclePlaying,
  useAppStore,
  type CCReason
} from '@/stores/useAppStore';
import type { Layer } from '@/types';

declare global {
  interface Window {
    __ccRafAlive?: boolean;
  }
}

const isRecolorLayer = (layer: Layer) =>
  layer.layerType === 'color-cycle' && layer.colorCycleData?.mode === 'recolor';

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
  const recolorLayers = layers.filter(isRecolorLayer);
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
      useAppStore.getState().colorCycleRuntimeHandlers?.start?.('store-sync');
      ccLog('kicked colorCycleRuntimeHandlers.start from toggleGlobalColorCyclePlayback', { reason });
    } else {
      useAppStore.getState().colorCycleRuntimeHandlers?.stop?.('store-sync');
      ccLog('invoked colorCycleRuntimeHandlers.stop from toggleGlobalColorCyclePlayback', { reason });
    }
  } catch {}

  await reconcileRecolorPlayback(snapshot.layers, desiredPlaying, reason);

  dumpLayerFlags();
  ccGroupEnd();
};
