import type React from 'react';
import type { AppState } from '@/stores/useAppStore';
import {
  selectColorCycleDesiredPlaying,
  selectEffectiveColorCyclePlaying,
} from '@/stores/useAppStore';

export const syncStrokeStartColorCyclePlayback = ({
  storeRef,
  getColorCycleBrushManager,
  ensureActiveColorCycleGradientSlot,
  continuousColorCycleAnimationActiveRef,
  startingColorCycleAnimationRef,
  startPlaybackRef,
}: {
  storeRef: React.MutableRefObject<AppState>;
  getColorCycleBrushManager: () => {
    getBrush: (layerId: string) => import('@/hooks/brushEngine/ColorCycleBrushMigration').ColorCycleBrushImplementation | null | undefined;
  };
  ensureActiveColorCycleGradientSlot: (
    state: AppState,
    layer: AppState['layers'][number],
    brush?: import('@/hooks/brushEngine/ColorCycleBrushMigration').ColorCycleBrushImplementation | null
  ) => void;
  continuousColorCycleAnimationActiveRef: React.MutableRefObject<boolean>;
  startingColorCycleAnimationRef: React.MutableRefObject<boolean>;
  startPlaybackRef: React.MutableRefObject<((reason?: string) => void) | null>;
}): void => {
  const refreshedState = storeRef.current;
  const refreshedLayer = refreshedState.layers.find((layer) => layer.id === refreshedState.activeLayerId);
  if (refreshedLayer?.layerType === 'color-cycle') {
    const colorCycleBrushManager = getColorCycleBrushManager();
    const colorCycleBrush = (
      typeof refreshedState.getLayerColorCycleBrush === 'function'
        ? refreshedState.getLayerColorCycleBrush(refreshedLayer.id)
        : null
    ) ?? colorCycleBrushManager.getBrush(refreshedLayer.id);
    ensureActiveColorCycleGradientSlot(refreshedState, refreshedLayer, colorCycleBrush);
  }

  const desiredPlaying = selectColorCycleDesiredPlaying(refreshedState);
  const effectivePlaying = selectEffectiveColorCyclePlaying(refreshedState);
  const lastReason = refreshedState.colorCyclePlayback.lastReason;
  if (
    refreshedLayer?.layerType === 'color-cycle' &&
    !desiredPlaying &&
    !effectivePlaying &&
    (lastReason === 'startup' || lastReason === 'auto-start')
  ) {
    refreshedState.playColorCycle('auto-start');
  }

  const postState = storeRef.current;
  const shouldBePlaying = selectEffectiveColorCyclePlaying(postState);
  if (
    shouldBePlaying &&
    !continuousColorCycleAnimationActiveRef.current &&
    !startingColorCycleAnimationRef.current
  ) {
    Promise.resolve().then(() => startPlaybackRef.current?.('stroke-start'));
  }
};
