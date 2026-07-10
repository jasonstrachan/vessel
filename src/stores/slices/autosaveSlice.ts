import type { StateCreator } from 'zustand';
import type { AutosaveDirtyReason, AutosaveState } from '@/types';

type AppState = import('../useAppStore').AppState;
type SaveStatus = NonNullable<AutosaveState['saveStatus']>;

export interface AutosaveSliceDeps {
  historyManager: {
    setMaxEntries: (size: number) => void;
  };
  backgroundStorageService: {
    updateSession: (
      projectId: string,
      isDirty: boolean,
      revisions?: { dirtyRevision: number; savedRevision: number; lastSaveTime?: number }
    ) => Promise<unknown>;
    resetSession: (projectId: string, lastSaveTime?: number) => Promise<unknown>;
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
  setAutosaveSessionSyncSuspended: (suspended: boolean) => void;
  clearDirtyState: (options?: { resetSession?: boolean }) => void;
  clearDirtyStateIfRevision: (
    projectId: string,
    expectedRevision: number,
    savedAt: Date
  ) => boolean;
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
  isSessionSyncSuspended: false,
  hasUnsavedChanges: false,
  dirtyRevision: 0,
  savedRevision: 0,
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

    setAutosaveSessionSyncSuspended: (suspended) => {
      const wasSuspended = get().autosave.isSessionSyncSuspended;
      set((state) => ({
        autosave: {
          ...state.autosave,
          isSessionSyncSuspended: suspended,
        },
      }));

      if (wasSuspended && !suspended) {
        const state = get();
        if (state.project?.id && state.autosave.hasUnsavedChanges) {
          void deps.backgroundStorageService.updateSession(
            state.project.id,
            true,
            {
              dirtyRevision: state.autosave.dirtyRevision,
              savedRevision: state.autosave.savedRevision,
            },
          ).catch(() => undefined);
        }
      }
    },

    clearDirtyState: (options) => {
      set((state) => ({
        autosave: {
          ...state.autosave,
          hasUnsavedChanges: false,
          // Keep the token monotonic so an in-flight save from an earlier
          // same-project instance cannot acknowledge a later edit.
          savedRevision: state.autosave.dirtyRevision,
          lastDirtyReason: null,
          lastDirtyAt: null,
        },
      }));
      const projectId = get().project?.id;
      if (projectId && options?.resetSession !== false) {
        void deps.backgroundStorageService.resetSession(projectId).catch(() => undefined);
      }
    },

    clearDirtyStateIfRevision: (projectId, expectedRevision, savedAt) => {
      let didClear = false;
      set((state) => {
        if (
          state.project?.id !== projectId ||
          expectedRevision > state.autosave.dirtyRevision
        ) {
          return state;
        }

        const savedRevision = Math.max(
          state.autosave.savedRevision,
          expectedRevision,
        );
        const isCurrentRevision = state.autosave.dirtyRevision === expectedRevision;
        didClear = isCurrentRevision;

        return {
          ...(isCurrentRevision ? { paletteDirty: false } : {}),
          autosave: {
            ...state.autosave,
            hasUnsavedChanges: state.autosave.dirtyRevision > savedRevision,
            savedRevision,
            lastSaveTime: savedAt,
            ...(isCurrentRevision
              ? {
                  lastDirtyReason: null,
                  lastDirtyAt: null,
                }
              : {}),
          },
        };
      });
      return didClear;
    },

    markAutosaveDirty: (reason) => {
      set((state) => {
        const dirtyRevision = state.autosave.dirtyRevision + 1;
        return {
          autosave: {
            ...state.autosave,
            hasUnsavedChanges: true,
            dirtyRevision,
            lastDirtyReason: reason,
            lastDirtyAt: deps.now(),
          },
        };
      });

      const revisionState = get();
      if (
        revisionState.project?.id &&
        !revisionState.autosave.isSessionSyncSuspended
      ) {
        void deps.backgroundStorageService.updateSession(
          revisionState.project.id,
          true,
          {
            dirtyRevision: revisionState.autosave.dirtyRevision,
            savedRevision: revisionState.autosave.savedRevision,
          },
        ).catch(() => undefined);
      }
    },

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
