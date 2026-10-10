import historyManager from '@/history/historyService';
import type { HistoryActionId } from '@/history/actionTypes';
import {
  canUseSequentialAppendDelta,
  createSequentialAppendFrameDelta,
  createSequentialFrameDelta,
  cloneSequentialLayerData,
} from '@/history/deltas/sequentialFrameDelta';
import { mapCanvasActionToHistoryId } from '@/history/helpers/actions';
import type { CanvasSnapshot, SequentialLayerData } from '@/types';
import { useAppStore } from '@/stores/useAppStore';
import { enqueueHistoryFinalizeTask } from '@/stores/pendingColorCycleSaves';

type SequentialHistoryCoalesce = {
  key: string;
  maxIntervalMs?: number;
  mergeLabel?: boolean;
  pointerSession?: {
    pointerId: number | string;
    startedAt: number;
    endedAt?: number;
  };
};

export interface SequentialLayerHistoryPayload {
  layerId: string;
  beforeSequentialData: SequentialLayerData;
  afterSequentialData: SequentialLayerData;
  actionType: CanvasSnapshot['actionType'];
  description: string;
  tool: string;
  coalesce?: SequentialHistoryCoalesce;
}

const markUnsavedChanges = (): void => {
  const state = useAppStore.getState();
  if (typeof state.markAutosaveDirty === 'function') {
    state.markAutosaveDirty('history-change');
  }
};

const resolveSequentialHistoryAction = (actionType: CanvasSnapshot['actionType']): HistoryActionId => {
  const mapped = mapCanvasActionToHistoryId(actionType);
  if (mapped === 'brush-stroke' || mapped === 'eraser-stroke') {
    return 'sequential-stroke';
  }
  return mapped;
};

const sequentialDataEquals = (a: SequentialLayerData, b: SequentialLayerData): boolean => {
  if (
    a.frameCount !== b.frameCount ||
    a.fps !== b.fps ||
    a.durationMs !== b.durationMs ||
    a.events.length !== b.events.length
  ) {
    return false;
  }
  for (let i = 0; i < a.events.length; i += 1) {
    if (a.events[i]?.id !== b.events[i]?.id) {
      return false;
    }
  }
  return true;
};

export const commitSequentialLayerHistory = async ({
  layerId,
  beforeSequentialData,
  afterSequentialData,
  actionType,
  description,
  tool,
  coalesce,
}: SequentialLayerHistoryPayload): Promise<void> => {
  if (sequentialDataEquals(beforeSequentialData, afterSequentialData)) {
    return;
  }

  const before = cloneSequentialLayerData(beforeSequentialData);
  const after = cloneSequentialLayerData(afterSequentialData);
  const capturedCoalesce = coalesce
    ? {
        ...coalesce,
        pointerSession: coalesce.pointerSession ? { ...coalesce.pointerSession } : undefined,
      }
    : undefined;
  const historyId = resolveSequentialHistoryAction(actionType);
  const meta: Record<string, unknown> = {
    layerId,
    tool,
    mode: 'sequential',
  };

  if (capturedCoalesce) {
    meta.coalesceKey = capturedCoalesce.key;
    if (capturedCoalesce.pointerSession) {
      meta.pointerSession = {
        pointerId: capturedCoalesce.pointerSession.pointerId,
        startedAt: capturedCoalesce.pointerSession.startedAt,
        endedAt: capturedCoalesce.pointerSession.endedAt,
      };
    }
  }

  await enqueueHistoryFinalizeTask(async () => {
    const txn = historyManager.begin(
      historyId,
      meta,
      undefined,
      capturedCoalesce
        ? {
            coalesce: {
              key: capturedCoalesce.key,
              maxIntervalMs: capturedCoalesce.maxIntervalMs,
              mergeLabel: capturedCoalesce.mergeLabel,
            },
          }
        : undefined
    );

    const createDelta = canUseSequentialAppendDelta(before, after)
      ? createSequentialAppendFrameDelta
      : createSequentialFrameDelta;

    txn.push(createDelta({ layerId, before, after }));
    txn.commit(description);
    markUnsavedChanges();
  });
};
