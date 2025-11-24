/* eslint-disable @typescript-eslint/no-explicit-any */
import { createAutosaveSlice } from '@/stores/slices/autosaveSlice';

jest.mock('@/history/historyService', () => ({
  __esModule: true,
  default: {
    setMaxEntries: jest.fn(),
  },
}));

const mockedHistory = jest.requireMock('@/history/historyService').default as {
  setMaxEntries: jest.Mock;
};

type MutableState = Record<string, any>;

const createTestStore = (overrides: MutableState = {}) => {
  let state: MutableState = {
    history: { maxHistorySize: 50 },
    ...overrides,
  };

  const set = (updater: any) => {
    const next = typeof updater === 'function' ? updater(state) : updater;
    state = { ...state, ...next };
    return state;
  };

  const get = () => state;
  const slice = (createAutosaveSlice as any)(set, get);
  state = { ...state, ...slice };

  return {
    ...slice,
    getState: () => state,
  };
};

describe('autosave slice', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2025-01-01T00:00:00Z'));
    mockedHistory.setMaxEntries.mockClear();
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
