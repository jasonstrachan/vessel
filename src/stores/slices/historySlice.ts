import type { StateCreator } from 'zustand';
import historyManager from '@/history/historyService';
import { createHistoryService } from '@/stores/helpers/historyLifecycle';
import type { CanvasSnapshot, HistoryState } from '@/types';

type AppState = import('../useAppStore').AppState;
type CCReason = import('../useAppStore').CCReason;

export interface HistorySlice {
  history: HistoryState;
  undo: () => Promise<CanvasSnapshot | null>;
  redo: () => Promise<CanvasSnapshot | null>;
  canUndo: () => boolean;
  canRedo: () => boolean;
  clearHistory: () => void;
  setHistorySize: (size: number) => void;
}

export const defaultHistoryState: HistoryState = {
  undoStack: [],
  redoStack: [],
  maxHistorySize: 50,
  isCapturing: false,
};

export interface HistorySliceOptions {
  runWithColorCycleSuspended: <T>(
    reason: CCReason,
    fn: () => T | Promise<T>
  ) => Promise<T>;
}

export const createHistorySlice =
  (
    options: HistorySliceOptions
  ): StateCreator<AppState, [], [], HistorySlice> =>
  (set, get) => {
    const historyService = createHistoryService({
      set,
      get,
      runWithColorCycleSuspended: options.runWithColorCycleSuspended,
    });

    return {
      history: defaultHistoryState,
      undo: historyService.undo,
      redo: historyService.redo,
      canUndo: historyService.canUndo,
      canRedo: historyService.canRedo,
      clearHistory: historyService.clearHistory,
      setHistorySize: (size) => {
        historyManager.setMaxEntries(size);
        set((state) => ({
          history: { ...state.history, maxHistorySize: size },
        }));
      },
    };
  };
