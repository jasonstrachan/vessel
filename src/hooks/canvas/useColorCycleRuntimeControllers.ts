import { useMemo } from 'react';
import {
  createPauseAllBrushCCAnimationsDispatcher,
} from '@/hooks/canvas/handlers/colorCycle/colorCycleInteraction';
import {
  buildPauseAllBrushCCAnimationsArgs,
} from '@/hooks/canvas/handlers/colorCycle/buildPauseAllBrushCCAnimationsArgs';
import {
  createColorCycleRuntimeDispatchers,
} from '@/hooks/canvas/handlers/colorCycle/colorCycleRuntimeDispatchers';
import {
  buildColorCycleRuntimeDispatcherArgs,
} from '@/hooks/canvas/handlers/colorCycle/buildColorCycleRuntimeDispatcherArgs';
import {
  createStopContinuousColorCycleAnimation,
} from '@/hooks/canvas/handlers/colorCycle/startContinuousColorCycleCallbacks';

type PauseAllBrushArgs = Parameters<typeof buildPauseAllBrushCCAnimationsArgs>[0];
type RuntimeDispatchersArgs = Omit<
  Parameters<typeof buildColorCycleRuntimeDispatcherArgs>[0],
  'pauseAllBrushCCAnimationsNow'
>;
type StopAnimationArgs = Omit<
  Parameters<typeof createStopContinuousColorCycleAnimation>[0],
  'runStopCore'
>;

interface UseColorCycleRuntimeControllersArgs {
  pauseAllBrushArgs: PauseAllBrushArgs;
  runtimeDispatchersArgs: RuntimeDispatchersArgs;
  stopAnimationArgs: StopAnimationArgs;
}

export const useColorCycleRuntimeControllers = ({
  pauseAllBrushArgs,
  runtimeDispatchersArgs,
  stopAnimationArgs,
}: UseColorCycleRuntimeControllersArgs) => {
  const pauseAllBrushCCAnimationsNow = useMemo(
    () =>
      createPauseAllBrushCCAnimationsDispatcher(
        buildPauseAllBrushCCAnimationsArgs(pauseAllBrushArgs)
      ),
    [pauseAllBrushArgs]
  );

  const runtimeDispatchers = useMemo(
    () =>
      createColorCycleRuntimeDispatchers(
        buildColorCycleRuntimeDispatcherArgs({
          ...runtimeDispatchersArgs,
          pauseAllBrushCCAnimationsNow,
        })
      ),
    [runtimeDispatchersArgs, pauseAllBrushCCAnimationsNow]
  );

  const stopContinuousColorCycleAnimation = useMemo(
    () =>
      createStopContinuousColorCycleAnimation({
        ...stopAnimationArgs,
        runStopCore: runtimeDispatchers.stopContinuousColorCycleAnimationCore,
      }),
    [runtimeDispatchers.stopContinuousColorCycleAnimationCore, stopAnimationArgs]
  );

  return {
    pauseAllBrushCCAnimationsNow,
    ...runtimeDispatchers,
    stopContinuousColorCycleAnimation,
  };
};
