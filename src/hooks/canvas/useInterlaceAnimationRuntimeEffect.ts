import { useEffect } from 'react';

import { dispatchInterlaceFrameUpdate } from '@/hooks/canvas/handlers/animation/animationRuntime';
import { advanceInterlaceClock, resetInterlaceClock } from '@/lib/interlace/interlaceClock';
import { isInterlaceGroup } from '@/lib/interlace/interlaceSettings';
import { getPlaybackRuntimeController } from '@/runtime/playback/PlaybackRuntimeController';
import { getAppStoreState } from '@/stores/appStoreAccess';
import { useAppStore, type AppState } from '@/stores/useAppStore';

export const hasPlayableInterlace = (state: AppState): boolean => {
  const visibleLayerCountByGroupId = new Map<string, number>();
  (state.layers ?? []).forEach((layer) => {
    if (layer.visible && layer.layerType !== 'sequential' && layer.groupId) {
      visibleLayerCountByGroupId.set(
        layer.groupId,
        (visibleLayerCountByGroupId.get(layer.groupId) ?? 0) + 1,
      );
    }
  });
  return (state.layerGroups ?? []).some((group) => (
    isInterlaceGroup(group)
    && !(state.hiddenLayerGroupIds ?? []).includes(group.id)
    && (visibleLayerCountByGroupId.get(group.id) ?? 0) >= 2
  ));
};

export const isInterlacePlaybackActive = (
  state: AppState,
): boolean => Boolean(
  state.colorCyclePlayback?.desiredPlaying
  && state.colorCyclePlayback.suspendDepth === 0
  && hasPlayableInterlace(state)
);

export const useInterlaceAnimationRuntimeEffect = (): void => {
  useEffect(() => {
    const controller = getPlaybackRuntimeController();
    let currentProjectId = getAppStoreState().project?.id ?? null;
    const sync = (state: AppState) => {
      const nextProjectId = state.project?.id ?? null;
      if (nextProjectId !== currentProjectId) {
        currentProjectId = nextProjectId;
        resetInterlaceClock();
      }
      const isPlaying = isInterlacePlaybackActive(state);
      if (isPlaying) controller.sync(state, 'interlace-store-sync');
    };
    const unsubscribe = useAppStore.subscribe(sync);
    sync(getAppStoreState());
    const unregister = controller.registerAnimationConsumer((_timestampMs, deltaMs) => {
      const state = getAppStoreState();
      const playback = state.colorCyclePlayback;
      if (!isInterlacePlaybackActive(state)) {
        return;
      }
      advanceInterlaceClock((deltaMs / 1000) * playback.playbackSpeedScale);
      dispatchInterlaceFrameUpdate();
    });
    return () => {
      unsubscribe();
      unregister();
    };
  }, []);
};
