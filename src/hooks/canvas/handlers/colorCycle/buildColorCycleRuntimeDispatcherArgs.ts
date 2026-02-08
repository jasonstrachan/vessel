import {
  createColorCycleRuntimeDispatchers,
} from '@/hooks/canvas/handlers/colorCycle/colorCycleRuntimeDispatchers';
import {
  dispatchColorCycleFrameUpdate,
} from '@/hooks/canvas/handlers/colorCycle/scheduleRecompose';

type ColorCycleRuntimeDispatcherArgs = Parameters<typeof createColorCycleRuntimeDispatchers>[0];
type BuildColorCycleRuntimeDispatcherArgsInput = Omit<ColorCycleRuntimeDispatcherArgs, 'dispatchFrameUpdate'>;

export const buildColorCycleRuntimeDispatcherArgs = (
  args: BuildColorCycleRuntimeDispatcherArgsInput
): ColorCycleRuntimeDispatcherArgs => {
  return {
    ...args,
    dispatchFrameUpdate: () => {
      dispatchColorCycleFrameUpdate();
    },
  };
};
