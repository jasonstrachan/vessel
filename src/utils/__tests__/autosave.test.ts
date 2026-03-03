import { autosaveService } from '../autosave';
import { useAppStore } from '@/stores/useAppStore';
import type { AppState } from '@/stores/useAppStore';
import { backgroundStorageService } from '../backgroundStorage';
import { fileBackupService } from '../fileBackupService';

jest.mock('@/stores/useAppStore', () => {
  type Listener = (state: unknown, prevState: unknown) => void;

  const subscribers: Listener[] = [];
  type AutosaveStoreState = Partial<AppState> & { autosave: AppState['autosave'] };

  let storeState: AutosaveStoreState = {
    autosave: {
      isEnabled: false,
      isRunning: false,
      hasUnsavedChanges: false,
      lastSaveTime: null,
      interval: 2,
      lastDirtyReason: null,
      lastDirtyAt: null,
      saveStatus: {
        phase: 'idle',
        source: null,
        message: null,
        updatedAt: null,
      },
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

  let lastEmittedState: AutosaveStoreState = JSON.parse(JSON.stringify(storeState));

  const getState = jest.fn(() => storeState);
  const setState = jest.fn();

  const subscribe = jest.fn((listener: Listener) => {
    subscribers.push(listener);
    return () => {
      const index = subscribers.indexOf(listener);
      if (index >= 0) {
        subscribers.splice(index, 1);
      }
    };
  });

  const emitMock = (): void => {
    const prev = lastEmittedState;
    subscribers.forEach((listener) => {
      listener(storeState, prev);
    });
    lastEmittedState = JSON.parse(JSON.stringify(storeState));
  };

  return {
    useAppStore: Object.assign(() => undefined, {
      getState,
      setState,
      subscribe,
      __setMockState(state: AutosaveStoreState) {
        storeState = state;
        lastEmittedState = JSON.parse(JSON.stringify(state));
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
    lastDirtyReason: null,
    lastDirtyAt: null,
    saveStatus: {
      phase: 'idle' as const,
      source: null,
      message: null,
      updatedAt: null,
    },
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
    width: 64,
    height: 64,
  },
  palette: {
    foregroundColor: '#000000',
    backgroundColor: '#FFFFFF',
    activeSlot: 'foreground' as const,
  },
  referenceLayerId: 'layer-1',
  layers: [{ id: 'layer-1', layerType: 'normal' as const }],
  activeLayerId: 'layer-1',
  history: { isCapturing: false },
  currentOffscreenCanvas: null as HTMLCanvasElement | null,
  compositeLayersToCanvas: jest.fn(),
  captureCanvasToActiveLayer: jest.fn().mockResolvedValue(undefined),
  clearDirtyState: jest.fn(),
  setSaveStatus: jest.fn(),
  markAutosaveDirty: jest.fn(),
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
    jest.spyOn(backgroundStorageService, 'updateSession').mockResolvedValue(undefined);
    jest.spyOn(fileBackupService, 'saveProjectBackup').mockResolvedValue({ success: true, filename: 'backup.json' });
    jest.spyOn(fileBackupService, 'setFileHandle').mockImplementation(() => {});
    jest.spyOn(fileBackupService, 'setDirectoryHandle').mockImplementation(() => {});
    jest.spyOn(fileBackupService, 'ensureFileWritePermission').mockResolvedValue(true);
    jest.spyOn(fileBackupService, 'ensureDirectoryWritePermission').mockResolvedValue(true);

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

    expect(backgroundStorageService.saveProjectInBackground).toHaveBeenCalledWith(
      expect.objectContaining({ palette: store.palette, referenceLayerId: store.referenceLayerId }),
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
    expect(backgroundStorageService.updateSession).toHaveBeenCalledWith(store.project.id, false);
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

  it('writes file-backup when enabled with a file handle', async () => {
    const store = getStateMock();
    store.autosave.isEnabled = true;
    store.autosave.fileBackup.enabled = true;
    store.autosave.fileBackup.mode = 'single-file';
    store.autosave.fileBackup.fileHandle = { id: 'fh-1' } as unknown as FileSystemFileHandle;

    await autosaveService.triggerAutosave();

    expect(fileBackupService.setFileHandle).toHaveBeenCalledWith(store.autosave.fileBackup.fileHandle);
    expect(fileBackupService.setDirectoryHandle).not.toHaveBeenCalled();
    expect(fileBackupService.saveProjectBackup).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'test-project',
        palette: store.palette,
        referenceLayerId: store.referenceLayerId,
      }),
      store.layers,
      'single-file'
    );
    expect(store.updateFileBackupTime).toHaveBeenCalled();
  });

  it('forwards sequential layer payloads to background autosave persistence', async () => {
    const store = getStateMock();
    store.autosave.isEnabled = true;
    store.layers = [
      {
        id: 'layer-seq',
        layerType: 'sequential',
        sequentialData: {
          frameCount: 12,
          fps: 12,
          durationMs: 1000,
          events: [
            {
              id: 'seq-event-1',
              layerId: 'layer-seq',
              strokeId: 'stroke-1',
              timestampMs: 100,
              frameIndex: 2,
              brush: {
                tool: 'brush',
                brushShape: 'round',
                size: 8,
                opacity: 0.8,
                blendMode: 'source-over',
                rotation: 0,
                spacing: 1,
                color: '#ff0000',
                customStampId: null,
              },
              stamps: [{ x: 4, y: 5, pressure: 1, rotation: 0, size: 8, alpha: 0.8 }],
            },
          ],
        },
      },
    ];

    await autosaveService.triggerAutosave();

    const persistedLayers = (backgroundStorageService.saveProjectInBackground as jest.Mock).mock.calls[0]?.[1];
    expect(Array.isArray(persistedLayers)).toBe(true);
    expect(persistedLayers[0].layerType).toBe('sequential');
    expect(persistedLayers[0].sequentialData).toEqual(store.layers[0].sequentialData);
  });
});
