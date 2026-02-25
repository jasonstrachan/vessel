import {
  startContinuousColorCycleAnimationCore as startContinuousColorCycleAnimationCoreExternal,
} from '@/hooks/canvas/handlers/colorCycle/colorCyclePlayback';
import {
  runStartContinuousColorCycleWithTrace,
  runStopContinuousColorCycleWithTrace,
} from '@/hooks/canvas/handlers/colorCycle/colorCyclePlaybackDebug';

type StartCoreArgs = Parameters<typeof startContinuousColorCycleAnimationCoreExternal>[1];
type StartTraceArgs = Omit<Parameters<typeof runStartContinuousColorCycleWithTrace>[0], 'reason' | 'runStartCore'>;
type StopTraceArgs = Omit<Parameters<typeof runStopContinuousColorCycleWithTrace>[0], 'reason' | 'runStopCore'>;

export const createStartContinuousColorCycleAnimationCore = (
  args: StartCoreArgs
) => {
  return (reason = 'unknown') => {
    startContinuousColorCycleAnimationCoreExternal(reason, args);
  };
};

export const createStartContinuousColorCycleAnimation = ({
  runStartCore,
  traceArgs,
}: {
  runStartCore: (reason?: string) => void;
  traceArgs: StartTraceArgs;
}) => {
  return (reason = 'unknown') => {
    return runStartContinuousColorCycleWithTrace({
      reason,
      ...traceArgs,
      runStartCore,
    });
  };
};

export const createStopContinuousColorCycleAnimation = ({
  runStopCore,
  traceArgs,
}: {
  runStopCore: (reason: string) => void;
  traceArgs: StopTraceArgs;
}) => {
  return (reason = 'unknown') => {
    return runStopContinuousColorCycleWithTrace({
      reason,
      ...traceArgs,
      runStopCore,
    });
  };
};
