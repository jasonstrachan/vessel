import {
  createCommitStrokeHistoryIfNeededDispatcher,
  type CommitStrokeHistoryDeps,
} from '@/hooks/canvas/handlers/colorCycle/colorCycleStrokeHistory';
import type { RunFinalizePostCommitDeps } from '@/hooks/canvas/handlers/finalizePostCommit';

export const createFinalizePostCommitDeps = ({
  clearFinalizeOverlayIfNeeded,
  commitStrokeHistoryDeps,
}: {
  clearFinalizeOverlayIfNeeded: RunFinalizePostCommitDeps['clearFinalizeOverlayIfNeeded'];
  commitStrokeHistoryDeps: CommitStrokeHistoryDeps;
}): RunFinalizePostCommitDeps => ({
  clearFinalizeOverlayIfNeeded,
  commitStrokeHistoryIfNeeded: createCommitStrokeHistoryIfNeededDispatcher(commitStrokeHistoryDeps),
});
