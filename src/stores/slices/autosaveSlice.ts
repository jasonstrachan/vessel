import type { StateCreator } from 'zustand';
import type { AutosaveDirtyReason, AutosaveState } from '@/types';

type AppState = import('../useAppStore').AppState;
type SaveStatus = NonNullable<AutosaveState['saveStatus']>;

export interface AutosaveSliceDeps {
  historyManager: {
    setMaxEntries: (size: number) => void;
  };
  backgroundStorageService: {
    updateSession: (projectId: string, isDirty: boolean) => Promise<unknown>;
  };
  now: () => Date;
}

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
  setSaveStatus: (
    phase: SaveStatus['phase'],
    source: SaveStatus['source'],
    message: string
  ) => void;
  clearSaveStatus: () => void;
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
  saveStatus: {
    phase: 'idle',
    source: null,
    message: null,
    updatedAt: null,
  },
};

export const createAutosaveSlice =
  (deps: AutosaveSliceDeps): StateCreator<AppState, [], [], AutosaveSlice> =>
  (set, get) => ({
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
      set((state) => {
        if (
          state.autosave.hasUnsavedChanges &&
          state.autosave.lastDirtyReason === reason
        ) {
          return state;
        }
        const projectId = get().project?.id;
        if (projectId) {
          void deps.backgroundStorageService.updateSession(projectId, true).catch(() => undefined);
        }

        return {
          autosave: {
            ...state.autosave,
            hasUnsavedChanges: true,
            lastDirtyReason: reason,
            lastDirtyAt: deps.now(),
          },
        };
      }),

    updateFileBackupTime: () =>
      set((state) => ({
        autosave: {
          ...state.autosave,
          fileBackup: { ...state.autosave.fileBackup, lastBackupTime: deps.now() },
        },
      })),

    setAutosaveInterval: (interval) =>
      set((state) => ({
        autosave: { ...state.autosave, interval },
      })),

    setSaveStatus: (phase, source, message) =>
      set((state) => ({
        autosave: {
          ...state.autosave,
          saveStatus: {
            phase,
            source,
            message,
            updatedAt: deps.now(),
          },
        },
      })),

    clearSaveStatus: () =>
      set((state) => ({
        autosave: {
          ...state.autosave,
          saveStatus: {
            phase: 'idle',
            source: null,
            message: null,
            updatedAt: deps.now(),
          },
        },
      })),

    setHistorySize: (size) => {
      deps.historyManager.setMaxEntries(size);
      set((state) => ({
        history: { ...state.history, maxHistorySize: size },
      }));
    },
  });
