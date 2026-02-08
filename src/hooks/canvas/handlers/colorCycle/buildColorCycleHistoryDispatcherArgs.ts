import {
  createColorCycleHistoryDispatchers,
} from '@/hooks/canvas/handlers/colorCycle/colorCycleHistoryDispatchers';

type ColorCycleHistoryDispatcherArgs = Parameters<typeof createColorCycleHistoryDispatchers>[0];

export const buildColorCycleHistoryDispatcherArgs = (
  args: ColorCycleHistoryDispatcherArgs
): ColorCycleHistoryDispatcherArgs => args;
