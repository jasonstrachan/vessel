import { useColorCyclePlaybackHandlers } from '@/hooks/canvas/useColorCyclePlaybackHandlers';
import {
  buildColorCyclePlaybackHandlerArgs,
} from '@/hooks/canvas/handlers/colorCycle/buildColorCyclePlaybackHandlerArgs';

type UseColorCyclePlaybackRuntimeArgs = Parameters<typeof buildColorCyclePlaybackHandlerArgs>[0];

export const useColorCyclePlaybackRuntime = (
  args: UseColorCyclePlaybackRuntimeArgs
) => useColorCyclePlaybackHandlers(buildColorCyclePlaybackHandlerArgs(args));
