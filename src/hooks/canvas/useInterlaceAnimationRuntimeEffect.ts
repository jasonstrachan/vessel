import { useEffect } from 'react';

import { dispatchInterlaceFrameUpdate } from '@/hooks/canvas/handlers/animation/animationRuntime';
import { advanceInterlaceClock, resetInterlaceClock } from '@/lib/interlace/interlaceClock';
import { isInterlaceGroup } from '@/lib/interlace/interlaceSettings';
import { getPlaybackRuntimeController } from '@/runtime/playback/PlaybackRuntimeController';
import { useAppStore } from '@/stores/useAppStore';

export const hasPlayableInterlace = (state: ReturnType<typeof useAppStore.getState>): boolean => {
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
  state: ReturnType<typeof useAppStore.getState>,
): boolean => Boolean(
  state.colorCyclePlayback?.desiredPlaying
  && state.colorCyclePlayback.suspendDepth === 0
  && hasPlayableInterlace(state)
);

export const useInterlaceAnimationRuntimeEffect = (): void => {
  useEffect(() => {
    const controller = getPlaybackRuntimeController();
    let currentProjectId = useAppStore.getState().project?.id ?? null;
    const sync = (state: ReturnType<typeof useAppStore.getState>) => {
      const nextProjectId = state.project?.id ?? null;
      if (nextProjectId !== currentProjectId) {
        currentProjectId = nextProjectId;
        resetInterlaceClock();
      }
      const isPlaying = isInterlacePlaybackActive(state);
      if (isPlaying) controller.sync(state, 'interlace-store-sync');
    };
    const unsubscribe = useAppStore.subscribe(sync);
    sync(useAppStore.getState());
    const unregister = controller.registerAnimationConsumer((_timestampMs, deltaMs) => {
      const state = useAppStore.getState();
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
