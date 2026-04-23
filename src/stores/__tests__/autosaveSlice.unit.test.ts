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
    const store = createTestStore();
    store.markAutosaveDirty('layer-updated');

    const dirty = store.getState().autosave;
    expect(dirty.hasUnsavedChanges).toBe(true);
    expect(dirty.lastDirtyReason).toBe('layer-updated');
    expect(dirty.lastDirtyAt).toEqual(new Date('2025-01-01T00:00:00Z'));

    store.clearDirtyState();
    const cleared = store.getState().autosave;
    expect(cleared.hasUnsavedChanges).toBe(false);
    expect(cleared.lastDirtyReason).toBeNull();
    expect(cleared.lastDirtyAt).toBeNull();
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
