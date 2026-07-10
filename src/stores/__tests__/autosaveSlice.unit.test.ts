/* eslint-disable @typescript-eslint/no-explicit-any */
import { createSliceTestStore } from '@/stores/__tests__/sliceTestUtils';

jest.mock('@/history/historyService', () => ({
  __esModule: true,
  setActiveHistoryDocument: jest.fn(),
  default: {
    setMaxEntries: jest.fn(),
  },
}));

jest.mock('@/utils/backgroundStorage', () => ({
  __esModule: true,
  backgroundStorageService: {
    updateSession: jest.fn(() => Promise.resolve()),
    resetSession: jest.fn(() => Promise.resolve()),
  },
}));

const { createAutosaveSlice } = jest.requireActual('@/stores/slices/autosaveSlice') as {
  createAutosaveSlice: (...args: any[]) => any;
};

const mockedHistory = jest.requireMock('@/history/historyService').default as {
  setMaxEntries: jest.Mock;
};
const mockedBackgroundStorage = jest.requireMock('@/utils/backgroundStorage').backgroundStorageService as {
  updateSession: jest.Mock;
  resetSession: jest.Mock;
};

const createTestStore = (overrides: Record<string, any> = {}) => {
  const { slice, getState } = createSliceTestStore(
    (set, get) => (createAutosaveSlice as any)({
      historyManager: mockedHistory,
      backgroundStorageService: mockedBackgroundStorage,
      now: () => new Date(),
    })(set, get),
    {
      history: { maxHistorySize: 50 },
      ...overrides,
    }
  );

  return {
    ...slice,
    getState,
  };
};

describe('autosave slice', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2025-01-01T00:00:00Z'));
    mockedHistory.setMaxEntries.mockClear();
    mockedBackgroundStorage.updateSession.mockClear();
    mockedBackgroundStorage.resetSession.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('toggles autosave enabled flag', () => {
    const store = createTestStore();
    expect(store.getState().autosave.isEnabled).toBe(false);

    store.setAutosaveEnabled(true);
    expect(store.getState().autosave.isEnabled).toBe(true);
  });

  it('tracks dirty state with reason and clears it', () => {
    const store = createTestStore({ project: { id: 'project-clear' } });
    store.markAutosaveDirty('layer-updated');

    const dirty = store.getState().autosave;
    expect(dirty.hasUnsavedChanges).toBe(true);
    expect(dirty.lastDirtyReason).toBe('layer-updated');
    expect(dirty.lastDirtyAt).toEqual(new Date('2025-01-01T00:00:00Z'));

    store.clearDirtyState();
    const cleared = store.getState().autosave;
    expect(cleared.hasUnsavedChanges).toBe(false);
    expect(cleared.dirtyRevision).toBe(1);
    expect(cleared.savedRevision).toBe(1);
    expect(cleared.lastDirtyReason).toBeNull();
    expect(cleared.lastDirtyAt).toBeNull();
    expect(mockedBackgroundStorage.resetSession).toHaveBeenCalledWith('project-clear');
  });

  it('can clear placeholder state without discarding persisted recovery metadata', () => {
    const store = createTestStore({ project: { id: 'startup-placeholder' } });
    store.markAutosaveDirty('project-change');

    store.clearDirtyState({ resetSession: false });

    expect(store.getState().autosave).toEqual(expect.objectContaining({
      hasUnsavedChanges: false,
      dirtyRevision: 1,
      savedRevision: 1,
    }));
    expect(mockedBackgroundStorage.resetSession).not.toHaveBeenCalled();
  });

  it('does not reuse a save revision after reloading the same project', () => {
    const store = createTestStore({
      project: { id: 'same-project' },
      paletteDirty: true,
    });
    store.markAutosaveDirty('layer-change');
    const inFlightRevision = store.getState().autosave.dirtyRevision;

    // Loading the same project clears dirty state without changing its ID.
    store.clearDirtyState({ resetSession: false });
    store.markAutosaveDirty('layer-change');

    const didClear = store.clearDirtyStateIfRevision(
      'same-project',
      inFlightRevision,
      new Date('2025-01-01T00:01:00Z'),
    );

    expect(didClear).toBe(false);
    expect(store.getState().autosave).toEqual(expect.objectContaining({
      hasUnsavedChanges: true,
      dirtyRevision: 2,
      savedRevision: 1,
    }));
    expect(store.getState().paletteDirty).toBe(true);
  });

  it('defers session writes while startup initialization is suspended and flushes a real edit on resume', () => {
    const store = createTestStore({ project: { id: 'startup-placeholder' } });

    store.setAutosaveSessionSyncSuspended(true);
    store.markAutosaveDirty('layer-change');
    expect(mockedBackgroundStorage.updateSession).not.toHaveBeenCalled();

    store.setAutosaveSessionSyncSuspended(false);
    expect(mockedBackgroundStorage.updateSession).toHaveBeenCalledTimes(1);
    expect(mockedBackgroundStorage.updateSession).toHaveBeenCalledWith(
      'startup-placeholder',
      true,
      expect.objectContaining({ dirtyRevision: 1, savedRevision: 0 }),
    );
  });

  it('advances the dirty revision for repeated mutations with the same reason', () => {
    const store = createTestStore({
      project: { id: 'project-revisions' },
    });

    store.markAutosaveDirty('layer-change');
    const firstRevision = store.getState().autosave.dirtyRevision;
    store.markAutosaveDirty('layer-change');

    expect(firstRevision).toBe(1);
    expect(store.getState().autosave.dirtyRevision).toBe(2);
    expect(mockedBackgroundStorage.updateSession).toHaveBeenLastCalledWith(
      'project-revisions',
      true,
      expect.objectContaining({ dirtyRevision: 2, savedRevision: 0 }),
    );
  });

  it('does not clear a newer dirty revision when an older save completes', () => {
    const store = createTestStore({
      project: { id: 'project-revisions' },
      paletteDirty: true,
    });
    store.markAutosaveDirty('layer-change');
    const capturedRevision = store.getState().autosave.dirtyRevision;
    store.markAutosaveDirty('layer-change');

    const didClear = store.clearDirtyStateIfRevision(
      'project-revisions',
      capturedRevision,
      new Date('2025-01-01T00:01:00Z'),
    );

    expect(didClear).toBe(false);
    expect(store.getState().autosave).toEqual(expect.objectContaining({
      hasUnsavedChanges: true,
      dirtyRevision: 2,
      savedRevision: 1,
    }));
    expect(store.getState().paletteDirty).toBe(true);
  });

  it('does not clear a replacement project when an older project save completes', () => {
    const store = createTestStore({
      project: { id: 'replacement-project' },
      paletteDirty: true,
    });
    store.markAutosaveDirty('project-change');

    const didClear = store.clearDirtyStateIfRevision(
      'previous-project',
      1,
      new Date('2025-01-01T00:01:00Z'),
    );

    expect(didClear).toBe(false);
    expect(store.getState().autosave.hasUnsavedChanges).toBe(true);
    expect(store.getState().paletteDirty).toBe(true);
  });

  it('sets backup directory/file handles and mode', () => {
    const store = createTestStore();
    const mockDir = { kind: 'directory' } as any;
    store.setFileBackupDirectory(mockDir, '/tmp/project');
    store.setFileBackupMode('timestamped-files');

    const autosave = store.getState().autosave;
    expect(autosave.fileBackup.directoryHandle).toBe(mockDir);
    expect(autosave.fileBackup.backupPath).toBe('/tmp/project');
    expect(autosave.fileBackup.mode).toBe('timestamped-files');
  });

  it('updates backup time and autosave interval', () => {
    const store = createTestStore();
    store.updateFileBackupTime();
    store.setAutosaveInterval(10);

    const autosave = store.getState().autosave;
    expect(autosave.fileBackup.lastBackupTime).toEqual(new Date('2025-01-01T00:00:00Z'));
    expect(autosave.interval).toBe(10);
  });

  it('sets history size and forwards to history manager', () => {
    const store = createTestStore();
    store.setHistorySize(42);

    expect(store.getState().history.maxHistorySize).toBe(42);
    expect(mockedHistory.setMaxEntries).toHaveBeenCalledWith(42);
  });
});
