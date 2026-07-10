import type { HistoryDelta, HistoryDirection } from '@/history/actionTypes';

/** Applies a prepared delta in isolated delta tests without exposing a legacy replay API. */
export const replayDeltaForTest = async (
  delta: HistoryDelta,
  direction: HistoryDirection,
): Promise<void> => {
  const prepared = await delta.prepare(direction);
  await prepared.apply();
};
