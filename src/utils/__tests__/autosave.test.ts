import { autosaveService } from '../autosave';
import { useAppStore } from '@/stores/useAppStore';
import type { AppState } from '@/stores/useAppStore';
import { backgroundStorageService } from '../backgroundStorage';
import { fileBackupService } from '../fileBackupService';

jest.mock('@/stores/useAppStore', () => {
  type Subscriber = {
    selector: (state: unknown) => unknown;
    listener: (slice: unknown, prevSlice: unknown) => void;
    equalityFn?: (a: unknown, b: unknown) => boolean;
    prev: unknown;
  };

  const subscribers: Subscriber[] = [];
  type AutosaveStoreState = Partial<AppState> & { autosave: AppState['autosave'] };

  let storeState: AutosaveStoreState = {
    autosave: {
      isEnabled: false,
      isRunning: false,
      hasUnsavedChanges: false,
      lastSaveTime: null,
      interval: 2,
      fileBackup: {
        enabled: false,
        mode: 'single-file',
        fileHandle: null,
        directoryHandle: null,
        backupPath: null,
        lastBackupTime: null,
      },
    },
  };

  const getState = jest.fn(() => storeState);
  const setState = jest.fn();

  const subscribe = jest.fn(
    (
      selector: Subscriber['selector'],
      listener: Subscriber['listener'],
      options?: { equalityFn?: Subscriber['equalityFn'] }
    ) => {
      const subscriber: Subscriber = {
        selector,
        listener,
        equalityFn: options?.equalityFn,
        prev: selector(storeState),
      };
      subscribers.push(subscriber);

      return () => {
        const index = subscribers.indexOf(subscriber);
        if (index >= 0) {
          subscribers.splice(index, 1);
        }
      };
    }
  );

  const emitMock = (): void => {
    subscribers.forEach((subscriber) => {
      const nextSlice = subscriber.selector(storeState);
      const equals = subscriber.equalityFn
        ? subscriber.equalityFn(nextSlice, subscriber.prev)
        : Object.is(nextSlice, subscriber.prev);

      if (equals) {
        return;
      }

      const previous = subscriber.prev;
      subscriber.prev = nextSlice;
      subscriber.listener(nextSlice, previous);
    });
  };

  return {
    useAppStore: Object.assign(() => undefined, {
      getState,
      setState,
      subscribe,
      __setMockState(state: AutosaveStoreState) {
        storeState = state;
        subscribers.forEach((subscriber) => {
          subscriber.prev = subscriber.selector(storeState);
        });
      },
      __emitMock() {
        emitMock();
      },
    }),
  };
});

type MockedStoreApi = typeof useAppStore & {
  __setMockState: (state: unknown) => void;
  __emitMock: () => void;
};

const mockedStore = useAppStore as unknown as MockedStoreApi;
const getStateMock = useAppStore.getState as unknown as jest.Mock;
const setStateMock = useAppStore.setState as unknown as jest.Mock;
const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

const createStoreStub = () => ({
  autosave: {
    isEnabled: false,
    hasUnsavedChanges: true,
    isRunning: false,
    lastSaveTime: null,
    interval: 2,
    fileBackup: {
      enabled: false,
      mode: 'single-file' as const,
      fileHandle: null,
      directoryHandle: null,
      backupPath: null,
      lastBackupTime: null,
    },
  },
  project: {
    id: 'test-project',
    name: 'Test Project',
  },
  palette: {
    foregroundColor: '#000000',
    backgroundColor: '#FFFFFF',
    activeSlot: 'foreground' as const,
  },
  layers: [{ id: 'layer-1' }],
  captureCanvasToActiveLayer: jest.fn().mockResolvedValue(undefined),
  clearDirtyState: jest.fn(),
  updateFileBackupTime: jest.fn(),
  addNotification: jest.fn(),
});

describe('AutosaveService', () => {

  beforeEach(() => {
    jest.clearAllMocks();

    const storeStub = createStoreStub();
    mockedStore.__setMockState(storeStub);
    mockedStore.__emitMock();
    setStateMock.mockImplementation(() => {});

    jest.spyOn(backgroundStorageService, 'saveProjectInBackground').mockResolvedValue(undefined);
    jest.spyOn(fileBackupService, 'saveProjectBackup').mockResolvedValue({ success: true, filename: 'backup.json' });
    jest.spyOn(fileBackupService, 'setFileHandle').mockImplementation(() => {});
    jest.spyOn(fileBackupService, 'setDirectoryHandle').mockImplementation(() => {});

    autosaveService.stop();
  });

  afterEach(() => {
    autosaveService.stop();
    consoleErrorSpy.mockClear();
  });

  afterAll(() => {
    consoleErrorSpy.mockRestore();
  });

  it('should start autosave service', () => {
    autosaveService.start();

    expect(setStateMock).toHaveBeenCalledWith(expect.any(Function));
    expect(autosaveService.isRunning()).toBe(true);
  });

  it('should stop autosave service', () => {
    autosaveService.start();
    autosaveService.stop();

    expect(autosaveService.isRunning()).toBe(false);
  });

  it('should change interval and remain running when restarted', () => {
    autosaveService.setInterval(5);
    autosaveService.start();
    expect(autosaveService.isRunning()).toBe(true);
  });

  it('automatically starts when the store enables autosave', () => {
    const store = getStateMock();
    expect(autosaveService.isRunning()).toBe(false);
    store.autosave.isEnabled = true;
    mockedStore.__emitMock();
    expect(autosaveService.isRunning()).toBe(true);
  });

  it('stops when the store disables autosave', () => {
    const store = getStateMock();
    store.autosave.isEnabled = true;
    mockedStore.__emitMock();
    expect(autosaveService.isRunning()).toBe(true);
    store.autosave.isEnabled = false;
    mockedStore.__emitMock();
    expect(autosaveService.isRunning()).toBe(false);
  });

  it('should perform autosave when conditions are met', async () => {
    const store = getStateMock();
    store.autosave.isEnabled = true;

    await autosaveService.triggerAutosave();

    expect(store.captureCanvasToActiveLayer).toHaveBeenCalled();
    expect(backgroundStorageService.saveProjectInBackground).toHaveBeenCalledWith(
      expect.objectContaining({ palette: store.palette }),
      store.layers
    );
    expect(store.clearDirtyState).toHaveBeenCalled();
    const lastSaveCall = setStateMock.mock.calls.find(([arg]) => typeof arg === 'function');
    expect(lastSaveCall).toBeDefined();
    const updated = lastSaveCall?.[0]({
      autosave: { lastSaveTime: null },
    });
    expect(updated?.autosave.lastSaveTime).toBeInstanceOf(Date);
    expect(setStateMock).toHaveBeenCalledWith({ paletteDirty: false });
  });

  it('should not perform autosave when disabled', async () => {
    const store = getStateMock();
    store.autosave.isEnabled = false;

    await autosaveService.triggerAutosave();

    expect(backgroundStorageService.saveProjectInBackground).not.toHaveBeenCalled();
  });

  it('should not perform autosave when no unsaved changes', async () => {
    const store = getStateMock();
    store.autosave.isEnabled = true;
    store.autosave.hasUnsavedChanges = false;

    await autosaveService.triggerAutosave();

    expect(backgroundStorageService.saveProjectInBackground).not.toHaveBeenCalled();
  });

  it('should not perform autosave when no project is present', async () => {
    const store = getStateMock();
    store.autosave.isEnabled = true;
    store.project = null;

    await autosaveService.triggerAutosave();

    expect(backgroundStorageService.saveProjectInBackground).not.toHaveBeenCalled();
  });

  it('should handle save errors gracefully', async () => {
    const store = getStateMock();
    store.autosave.isEnabled = true;
    (backgroundStorageService.saveProjectInBackground as jest.Mock).mockRejectedValueOnce(new Error('Save failed'));

    await autosaveService.triggerAutosave();

    expect(store.addNotification).toHaveBeenCalledWith({
      type: 'warning',
      title: 'Autosave Issue',
      message: 'Background autosave encountered an issue. Your work is still safe.',
      timestamp: expect.any(Date),
      duration: 3000
    });
  });
});
