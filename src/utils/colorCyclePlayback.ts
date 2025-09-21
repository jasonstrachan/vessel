import { setColorCycleAnimationState } from '@/components/toolbar/BrushControls';
import { RecolorManager } from '@/lib/colorCycle/RecolorManager';
import { useAppStore } from '@/stores/useAppStore';
import type { Layer } from '@/types';

const isRecolorLayer = (layer: Layer) =>
  layer.layerType === 'color-cycle' && layer.colorCycleData?.mode === 'recolor';

const isBrushColorCycleLayer = (layer: Layer) =>
  layer.layerType === 'color-cycle' && layer.colorCycleData?.mode !== 'recolor';

export const toggleGlobalColorCyclePlayback = async (shouldPlay: boolean): Promise<void> => {
  if (typeof window === 'undefined') {
    return;
  }

  // Brush-based color cycle playback (stroke/shape brushes)
  try {
    setColorCycleAnimationState(shouldPlay);
    const handlers = window.colorCycleAnimationHandlers;
    if (handlers) {
      if (shouldPlay) {
        handlers.startContinuousColorCycleAnimation?.();
      } else {
        handlers.stopContinuousColorCycleAnimation?.();
      }
    }
  } catch (error) {
    console.warn('[colorCyclePlayback] Failed to toggle brush animations', error);
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
      manager.playAll();
    } else {
      manager.pause();
    }
  } catch (error) {
    console.warn('[colorCyclePlayback] Failed to toggle recolor animations', error);
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
    console.warn('[colorCyclePlayback] Failed to sync recolor layer state', error);
  }

  // Sync brush layer store flags so rendering loop respects pause/play
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
    });
  } catch (error) {
    console.warn('[colorCyclePlayback] Failed to sync brush layer state', error);
  }
};
