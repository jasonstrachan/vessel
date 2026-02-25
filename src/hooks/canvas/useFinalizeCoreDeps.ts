import { useMemo } from 'react';
import {
  createCommitStrokeHistoryDeps as createCommitStrokeHistoryDepsExternal,
} from '@/hooks/canvas/handlers/colorCycle/colorCycleStrokeHistory';
import {
  createFinalizeDeps as createFinalizeDepsExternal,
} from '@/hooks/canvas/handlers/finalizeDeps';
import {
  buildCommitStrokeHistoryDepsArgs,
  buildFinalizeDepsArgs,
} from '@/hooks/canvas/handlers/buildFinalizeCoreDepsArgs';

type CommitStrokeHistoryDepsArgs = Parameters<typeof buildCommitStrokeHistoryDepsArgs>[0];
type FinalizeDepsArgs = Parameters<typeof buildFinalizeDepsArgs>[0];

interface UseFinalizeCoreDepsArgs {
  commitStrokeHistoryDepsArgs: CommitStrokeHistoryDepsArgs;
  finalizeDepsArgs: Omit<FinalizeDepsArgs, 'commitStrokeHistoryDeps'>;
}

export const useFinalizeCoreDeps = ({
  commitStrokeHistoryDepsArgs,
  finalizeDepsArgs,
}: UseFinalizeCoreDepsArgs) => {
  const commitStrokeHistoryDeps = useMemo(
    () =>
      createCommitStrokeHistoryDepsExternal(
        buildCommitStrokeHistoryDepsArgs(commitStrokeHistoryDepsArgs)
      ),
    [commitStrokeHistoryDepsArgs]
  );

  return useMemo(
    () =>
      createFinalizeDepsExternal(
        buildFinalizeDepsArgs({
          ...finalizeDepsArgs,
          commitStrokeHistoryDeps,
        })
      ),
    [finalizeDepsArgs, commitStrokeHistoryDeps]
  );
};
