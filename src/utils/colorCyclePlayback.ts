import { setColorCycleAnimationState } from '@/components/toolbar/BrushControls';
import { ccGroup, ccGroupEnd, ccLog, dumpLayerFlags } from '@/debug/ccDebug';
import { RecolorManager } from '@/lib/colorCycle/RecolorManager';
import { useAppStore } from '@/stores/useAppStore';
import type { Layer } from '@/types';

declare global {
  interface Window {
    __ccRafAlive?: boolean;
  }
}

const isRecolorLayer = (layer: Layer) =>
  layer.layerType === 'color-cycle' && layer.colorCycleData?.mode === 'recolor';

const isBrushColorCycleLayer = (layer: Layer) =>
  layer.layerType === 'color-cycle' && layer.colorCycleData?.mode !== 'recolor';

export let __ccPlayingFlag = false;

export const markCCPlayingState = (value: boolean) => {
  __ccPlayingFlag = value;
};

export const toggleGlobalColorCyclePlayback = async (
  shouldPlay: boolean,
  reason: string = 'ui'
): Promise<void> => {
  if (typeof window === 'undefined') {
    return;
  }

  ccGroup('toggleGlobalColorCyclePlayback()', { shouldPlay, reason });
  let anyAnimating = false;
  try {
    const state = useAppStore.getState();
    anyAnimating = state.layers.some(
      layer => layer.layerType === 'color-cycle' && !!layer.colorCycleData?.isAnimating
    );
  } catch {}

  const rafAlive = !!window.__ccRafAlive;

  if (__ccPlayingFlag === shouldPlay) {
    const worldMatches = shouldPlay ? (anyAnimating && rafAlive) : true;
    if (worldMatches) {
      ccLog('toggleGlobalColorCyclePlayback no-op (validated)', {
        shouldPlay,
        reason,
        anyAnimating,
        rafAlive
      });
      dumpLayerFlags();
      ccGroupEnd();
      return;
    }

    ccLog('toggleGlobalColorCyclePlayback stale state detected', {
      shouldPlay,
      reason,
      anyAnimating,
      rafAlive
    });
  }

  markCCPlayingState(shouldPlay);
  dumpLayerFlags();

  // Pre-sync brush layer flags so the first animation frame reflects the target state
  try {
    const { layers, updateLayer } = useAppStore.getState();
    layers.filter(isBrushColorCycleLayer).forEach(layer => {
      const colorCycleData = layer.colorCycleData;
      if (!colorCycleData || colorCycleData.isAnimating === shouldPlay) {
        return;
      }

      updateLayer(layer.id, {
        colorCycleData: {
          ...colorCycleData,
          isAnimating: shouldPlay
        }
      });
      ccLog('set brush isAnimating', {
        id: layer.id.slice(-6),
        shouldPlay,
        reason
      });
    });
  } catch (error) {
    ccLog('brush flag sync error', { error, reason });
  }

  // Brush-based color cycle playback (stroke/shape brushes)
  try {
    setColorCycleAnimationState(shouldPlay);
    ccLog('dispatch', {
      event: shouldPlay ? 'cc:request-start-raf' : 'cc:request-stop-raf',
      reason
    });
    try {
      window.dispatchEvent(
        new CustomEvent(shouldPlay ? 'cc:request-start-raf' : 'cc:request-stop-raf', {
          detail: { reason }
        })
      );
    } catch {
      // Event dispatch best-effort.
    }
    const handlers = window.colorCycleAnimationHandlers;
    if (handlers) {
      if (shouldPlay) {
        handlers.startContinuousColorCycleAnimation?.(reason);
      } else {
        handlers.stopContinuousColorCycleAnimation?.(reason);
      }
    }
  } catch (error) {
    ccLog('brush toggle error', { error, reason });
  }

  // Recolor layers playback
  let recolorLayerIds: string[] = [];
  const manager = RecolorManager.getInstance();
  try {
    const snapshot = useAppStore.getState();
    const recolorLayers = snapshot.layers.filter(isRecolorLayer);
    recolorLayerIds = recolorLayers.map(layer => layer.id);

    if (shouldPlay) {
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

  // Sync recolor layer metadata so Zustand subscribers stay accurate
  try {
    const { layers, updateLayer } = useAppStore.getState();
    recolorLayerIds.forEach(layerId => {
      const current = layers.find(layer => layer.id === layerId);
      const colorCycleData = current?.colorCycleData;
      const recolorSettings = colorCycleData?.recolorSettings;
      if (!colorCycleData || !recolorSettings?.animation) {
        return;
      }

      if (recolorSettings.animation.isPlaying === shouldPlay) {
        return;
      }

      updateLayer(layerId, {
        colorCycleData: {
          ...colorCycleData,
          recolorSettings: {
            ...recolorSettings,
            animation: {
              ...recolorSettings.animation,
              isPlaying: shouldPlay
            }
          }
        }
      });
    });
  } catch (error) {
    ccLog('Recolor state sync error', { error, reason });
  }

  dumpLayerFlags();
  ccGroupEnd();
};
