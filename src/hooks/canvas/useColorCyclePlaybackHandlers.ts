import { useMemo } from 'react';
import {
  createStartContinuousColorCycleAnimationCore,
  createStartContinuousColorCycleAnimation,
} from '@/hooks/canvas/handlers/colorCycle/startContinuousColorCycleCallbacks';
import { useDrawingPlaybackEffects } from '@/hooks/canvas/useDrawingPlaybackEffects';
import { CC_DEBUG } from '@/debug/ccDebug';

type StartCoreArgs = Parameters<typeof createStartContinuousColorCycleAnimationCore>[0];
type StartWrapperArgs = Parameters<typeof createStartContinuousColorCycleAnimation>[0];
type PlaybackArgs = Parameters<typeof useDrawingPlaybackEffects>[0];

export const useColorCyclePlaybackHandlers = ({
  startCoreArgs,
  startWrapperArgs,
  playbackArgs,
}: {
  startCoreArgs: StartCoreArgs;
  startWrapperArgs: Omit<StartWrapperArgs, 'runStartCore'>;
  playbackArgs: Omit<PlaybackArgs, 'startContinuousColorCycleAnimation'>;
}) => {
  const startContinuousColorCycleAnimationCore = useMemo(
    () => createStartContinuousColorCycleAnimationCore(startCoreArgs),
    [startCoreArgs]
  );

  const startContinuousColorCycleAnimation = useMemo(
    () =>
      createStartContinuousColorCycleAnimation({
        ...startWrapperArgs,
        runStartCore: startContinuousColorCycleAnimationCore,
      }),
    [startContinuousColorCycleAnimationCore, startWrapperArgs]
  );

  useDrawingPlaybackEffects({
    ...playbackArgs,
    startContinuousColorCycleAnimation,
  });

  return {
    startContinuousColorCycleAnimation,
    ccDebug: CC_DEBUG,
  };
};
