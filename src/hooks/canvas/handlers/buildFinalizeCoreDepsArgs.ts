import {
  createCommitStrokeHistoryDeps as createCommitStrokeHistoryDepsExternal,
} from '@/hooks/canvas/handlers/colorCycle/colorCycleStrokeHistory';
import {
  createFinalizeDeps as createFinalizeDepsExternal,
} from '@/hooks/canvas/handlers/finalizeDeps';

type CommitStrokeHistoryDepsArgs =
  Parameters<typeof createCommitStrokeHistoryDepsExternal>[0];
type FinalizeDepsArgs = Parameters<typeof createFinalizeDepsExternal>[0];

export const buildCommitStrokeHistoryDepsArgs = (
  args: CommitStrokeHistoryDepsArgs
): CommitStrokeHistoryDepsArgs => args;

export const buildFinalizeDepsArgs = (
  args: FinalizeDepsArgs
): FinalizeDepsArgs => args;
