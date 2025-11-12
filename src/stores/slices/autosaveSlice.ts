import type { StateCreator } from 'zustand';
import type { AutosaveDirtyReason, AutosaveState } from '@/types';
import historyManager from '@/history/historyService';

type AppState = import('../useAppStore').AppState;

export interface AutosaveSlice {
  autosave: AutosaveState;
  setAutosaveEnabled: (enabled: boolean) => void;
  setFileBackupEnabled: (enabled: boolean) => void;
  setFileBackupMode: (mode: 'single-file' | 'timestamped-files') => void;
  setFileBackupFile: (handle: FileSystemFileHandle | null, path?: string) => void;
  setFileBackupDirectory: (handle: FileSystemDirectoryHandle | null, path?: string) => void;
  clearDirtyState: () => void;
  markAutosaveDirty: (reason: AutosaveDirtyReason) => void;
  updateFileBackupTime: () => void;
  setAutosaveInterval: (interval: number) => void;
  setHistorySize: (size: number) => void;
}

const defaultAutosaveState: AutosaveState = {
  isEnabled: false,
  isRunning: false,
  hasUnsavedChanges: false,
  lastSaveTime: null,
  interval: 2,
  lastDirtyReason: null,
  lastDirtyAt: null,
  fileBackup: {
    enabled: false,
    mode: 'single-file',
    fileHandle: null,
    directoryHandle: null,
    backupPath: null,
    lastBackupTime: null,
  },
};

export const createAutosaveSlice: StateCreator<AppState, [], [], AutosaveSlice> = (set) => ({
  autosave: defaultAutosaveState,

  setAutosaveEnabled: (enabled) =>
    set((state) => ({
      autosave: { ...state.autosave, isEnabled: enabled },
    })),

  setFileBackupEnabled: (enabled) =>
    set((state) => ({
      autosave: {
        ...state.autosave,
        fileBackup: { ...state.autosave.fileBackup, enabled },
      },
    })),

  setFileBackupMode: (mode) =>
    set((state) => ({
      autosave: {
        ...state.autosave,
        fileBackup: { ...state.autosave.fileBackup, mode },
      },
    })),

  setFileBackupFile: (handle, path) =>
    set((state) => ({
      autosave: {
        ...state.autosave,
        fileBackup: {
          ...state.autosave.fileBackup,
          fileHandle: handle,
          backupPath: path ?? null,
        },
      },
    })),

  setFileBackupDirectory: (handle, path) =>
    set((state) => ({
      autosave: {
        ...state.autosave,
        fileBackup: {
          ...state.autosave.fileBackup,
          directoryHandle: handle,
          backupPath: path ?? null,
        },
      },
    })),

  clearDirtyState: () =>
    set((state) => ({
      autosave: {
        ...state.autosave,
        hasUnsavedChanges: false,
        lastDirtyReason: null,
        lastDirtyAt: null,
      },
    })),

  markAutosaveDirty: (reason) =>
    set((state) => ({
      autosave: {
        ...state.autosave,
        hasUnsavedChanges: true,
        lastDirtyReason: reason,
        lastDirtyAt: new Date(),
      },
    })),

  updateFileBackupTime: () =>
    set((state) => ({
      autosave: {
        ...state.autosave,
        fileBackup: { ...state.autosave.fileBackup, lastBackupTime: new Date() },
      },
    })),

  setAutosaveInterval: (interval) =>
    set((state) => ({
      autosave: { ...state.autosave, interval },
    })),

  setHistorySize: (size) => {
    historyManager.setMaxEntries(size);
    set((state) => ({
      history: { ...state.history, maxHistorySize: size },
    }));
  },
});
