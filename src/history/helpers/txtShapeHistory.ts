import historyManager from '@/history/historyService';
import { createTxtShapeDelta } from '@/history/deltas/txtShapeDelta';
import type { TxtShape } from '@/types';
import { logError } from '@/utils/debug';

interface CommitTxtShapeHistoryOptions {
  before: readonly TxtShape[];
  after: readonly TxtShape[];
  label: string;
  coalesceKey?: string;
}

export const isTxtShapeHistoryReplaying = (): boolean => historyManager.isReplaying;

export const commitTxtShapeHistory = ({
  before,
  after,
  label,
  coalesceKey,
}: CommitTxtShapeHistoryOptions): void => {
  if (historyManager.isReplaying) return;

  const delta = createTxtShapeDelta({ before, after });
  if (!delta) return;

  try {
    const transaction = historyManager.begin(
      'shape-commit',
      { operation: 'txt-shape' },
      undefined,
      coalesceKey
        ? {
            coalesce: {
              key: coalesceKey,
              maxIntervalMs: 500,
              mergeLabel: true,
            },
          }
        : undefined,
    );
    transaction.push(delta);
    transaction.commit(label);
  } catch (error) {
    logError('[history] Failed to record TXT Shape change', error);
  }
};
