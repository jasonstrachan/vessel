import historyManager from '@/history/historyService';
import { createUiShapeDelta } from '@/history/deltas/uiShapeDelta';
import type { UiShape } from '@/types';
import { logError } from '@/utils/debug';

export const isUiShapeHistoryReplaying = (): boolean => historyManager.isReplaying;

export const commitUiShapeHistory = ({
  before,
  after,
  label,
  coalesceKey,
}: {
  before: readonly UiShape[];
  after: readonly UiShape[];
  label: string;
  coalesceKey?: string;
}): void => {
  if (historyManager.isReplaying) return;
  const delta = createUiShapeDelta({ before, after });
  if (!delta) return;
  try {
    const transaction = historyManager.begin(
      'shape-commit',
      { operation: 'ui-shape' },
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
    logError('[history] Failed to record UI Shape change', error);
  }
};
