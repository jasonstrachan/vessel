import { autosaveService } from '../autosave';
import { useAppStore } from '@/stores/useAppStore';
import type { AppState } from '@/stores/useAppStore';
import { backgroundStorageService } from '../backgroundStorage';
import { fileBackupService } from '../fileBackupService';
import {
  waitForAllPendingColorCycleSaves,
  waitForFinalizeQueueIdle,
} from '@/stores/pendingColorCycleSaves';
import { flushPendingToolWork } from '@/utils/toolFlushRegistry';

jest.mock('@/stores/useAppStore', () => {
  type Listener = (state: unknown, prevState: unknown) => void;

  const subscribers: Listener[] = [];
  type AutosaveStoreState = Partial<AppState> & { autosave: AppState['autosave'] };

  let storeState: AutosaveStoreState = {
    autosave: {
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

jest.mock('@/stores/pendingColorCycleSaves', () => ({
  __esModule: true,
  waitForAllPendingColorCycleSaves: jest.fn().mockResolvedValue(undefined),
  waitForFinalizeQueueIdle: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/utils/toolFlushRegistry', () => ({
  __esModule: true,
  flushPendingToolWork: jest.fn().mockResolvedValue(undefined),
}));

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
    dirtyRevision: 1,
    savedRevision: 0,
    isRunning: false,
    isSessionSyncSuspended: false,
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
  clearDirtyStateIfRevision: jest.fn(() => true),
  setSaveStatus: jest.fn(),
  clearSaveStatus: jest.fn(),
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

    jest.spyOn(backgroundStorageService, 'createAutosaveCapture').mockImplementation(
      async (project, _layers, dirtyRevision) => ({
        projectId: project.id,
        projectName: project.name,
        dirtyRevision,
        serializedProject: new Uint8Array([1, 2, 3]),
        timestamp: Date.now(),
      }),
    );
    jest.spyOn(backgroundStorageService, 'saveProjectInBackground').mockImplementation(
      async (capture) => ({
        projectId: capture.projectId,
        dirtyRevision: capture.dirtyRevision,
        savedRevision: capture.dirtyRevision,
        timestamp: capture.timestamp,
        hasUnsavedChanges: false,
      }),
    );
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

    expect(flushPendingToolWork).toHaveBeenCalledTimes(1);
    expect(flushPendingToolWork).toHaveBeenCalledWith({ passiveOnly: true });
    expect(waitForFinalizeQueueIdle).toHaveBeenCalledTimes(1);
    expect(waitForAllPendingColorCycleSaves).toHaveBeenCalledTimes(1);
    expect(backgroundStorageService.createAutosaveCapture).toHaveBeenCalledWith(
      expect.objectContaining({ palette: store.palette, referenceLayerId: store.referenceLayerId }),
      store.layers,
      1,
    );
    expect(backgroundStorageService.saveProjectInBackground).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: store.project.id, dirtyRevision: 1 }),
    );
    expect(store.clearDirtyState).not.toHaveBeenCalled();
    expect(store.clearDirtyStateIfRevision).toHaveBeenCalledWith(
      store.project.id,
      1,
      expect.any(Date),
    );
    expect(backgroundStorageService.updateSession).not.toHaveBeenCalledWith(
      store.project.id,
      false,
    );
  });

  it('does not clear a newer edit that occurs while the background save is pending', async () => {
    const store = getStateMock();
    store.autosave.isEnabled = true;
    let resolveSave: (() => void) | undefined;
    (backgroundStorageService.saveProjectInBackground as jest.Mock).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSave = () => resolve({
          projectId: store.project.id,
          dirtyRevision: 1,
          savedRevision: 1,
          timestamp: Date.now(),
          hasUnsavedChanges: false,
        });
      }),
    );

    const savePromise = autosaveService.triggerAutosave();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(backgroundStorageService.saveProjectInBackground).toHaveBeenCalledTimes(1);

    store.autosave.dirtyRevision = 2;
    store.autosave.hasUnsavedChanges = true;
    resolveSave?.();
    await savePromise;

    expect(store.clearDirtyState).not.toHaveBeenCalled();
    expect(store.clearDirtyStateIfRevision).toHaveBeenCalledWith(
      store.project.id,
      1,
      expect.any(Date),
    );
    expect(store.setSaveStatus).toHaveBeenCalledWith(
      'idle',
      'autosave',
      'Autosaved earlier changes; newer changes pending',
    );
  });

  it('discards archive bytes serialized across two dirty revisions', async () => {
    const store = getStateMock();
    store.autosave.isEnabled = true;
    let resolveCapture: ((capture: {
      projectId: string;
      projectName: string;
      dirtyRevision: number;
      serializedProject: Uint8Array;
      timestamp: number;
    }) => void) | undefined;
    (backgroundStorageService.createAutosaveCapture as jest.Mock).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveCapture = resolve;
      }),
    );

    const savePromise = autosaveService.triggerAutosave();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(backgroundStorageService.createAutosaveCapture).toHaveBeenCalledTimes(1);

    store.autosave.dirtyRevision = 2;
    resolveCapture?.({
      projectId: store.project.id,
      projectName: store.project.name,
      dirtyRevision: 1,
      serializedProject: new Uint8Array([4, 5, 6]),
      timestamp: Date.now(),
    });
    await savePromise;

    expect(backgroundStorageService.saveProjectInBackground).not.toHaveBeenCalled();
    expect(store.clearDirtyStateIfRevision).not.toHaveBeenCalled();
    expect(store.setSaveStatus).toHaveBeenCalledWith(
      'idle',
      'autosave',
      'Changes pending; autosave will retry',
    );
  });

  it('discards a capture when the project is replaced during serialization', async () => {
    const store = getStateMock();
    store.autosave.isEnabled = true;
    let resolveCapture: ((capture: {
      projectId: string;
      projectName: string;
      dirtyRevision: number;
      serializedProject: Uint8Array;
      timestamp: number;
    }) => void) | undefined;
    (backgroundStorageService.createAutosaveCapture as jest.Mock).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveCapture = resolve;
      }),
    );
    const originalProject = store.project;

    const savePromise = autosaveService.triggerAutosave();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    store.project = { ...originalProject, id: 'replacement-project' };
    store.autosave.dirtyRevision = 0;
    resolveCapture?.({
      projectId: originalProject.id,
      projectName: originalProject.name,
      dirtyRevision: 1,
      serializedProject: new Uint8Array([7, 8, 9]),
      timestamp: Date.now(),
    });
    await savePromise;

    expect(backgroundStorageService.saveProjectInBackground).not.toHaveBeenCalled();
    expect(store.clearDirtyStateIfRevision).not.toHaveBeenCalled();
  });

  it('stops completion side effects when the project is replaced during commit', async () => {
    const store = getStateMock();
    store.autosave.isEnabled = true;
    store.autosave.fileBackup.enabled = true;
    store.autosave.fileBackup.fileHandle = { id: 'old-file' } as unknown as FileSystemFileHandle;
    let resolveCommit: ((result: {
      projectId: string;
      dirtyRevision: number;
      savedRevision: number;
      timestamp: number;
      hasUnsavedChanges: boolean;
    }) => void) | undefined;
    (backgroundStorageService.saveProjectInBackground as jest.Mock).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveCommit = resolve;
      }),
    );
    const originalProject = store.project;

    const savePromise = autosaveService.triggerAutosave();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    store.project = { ...originalProject, id: 'replacement-project' };
    resolveCommit?.({
      projectId: originalProject.id,
      dirtyRevision: 1,
      savedRevision: 1,
      timestamp: Date.now(),
      hasUnsavedChanges: false,
    });
    await savePromise;

    expect(store.clearDirtyStateIfRevision).not.toHaveBeenCalled();
    expect(fileBackupService.saveProjectBackup).not.toHaveBeenCalled();
    expect(store.updateFileBackupTime).not.toHaveBeenCalled();
    expect(store.setSaveStatus).toHaveBeenCalledTimes(1);
    expect(store.setSaveStatus).toHaveBeenCalledWith('saving', 'autosave', 'Autosaving...');
  });

  it('skips autosave while a floating paste is active', async () => {
    const store = getStateMock();
    store.autosave.isEnabled = true;
    store.floatingPaste = {
      active: true,
      imageData: new ImageData(1, 1),
      position: { x: 0, y: 0 },
      originalPosition: { x: 0, y: 0 },
      width: 1,
      height: 1,
      displayWidth: 1,
      displayHeight: 1,
      rotation: 0,
      sourceLayerId: 'layer-1',
    };

    await autosaveService.triggerAutosave();

    expect(flushPendingToolWork).toHaveBeenCalledWith({ passiveOnly: true });
    expect(backgroundStorageService.saveProjectInBackground).not.toHaveBeenCalled();
    expect(fileBackupService.saveProjectBackup).not.toHaveBeenCalled();
    expect(store.clearDirtyState).not.toHaveBeenCalled();
    expect(store.clearSaveStatus).toHaveBeenCalledTimes(1);
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

  it('keeps dirty state and reports an error when the commit transaction aborts', async () => {
    const store = getStateMock();
    store.autosave.isEnabled = true;
    (backgroundStorageService.saveProjectInBackground as jest.Mock).mockRejectedValueOnce(
      new DOMException('Quota exceeded', 'QuotaExceededError'),
    );

    await autosaveService.triggerAutosave();

    expect(store.addNotification).toHaveBeenCalledWith({
      type: 'warning',
      title: 'Autosave Issue',
      message: 'Background autosave failed. Unsaved changes remain in this session.',
      timestamp: expect.any(Date),
      duration: 3000
    });
    expect(store.clearDirtyStateIfRevision).not.toHaveBeenCalled();
    expect(store.autosave.hasUnsavedChanges).toBe(true);
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
      'single-file',
      { projectId: 'test-project', revision: 1 },
    );
    expect(store.updateFileBackupTime).toHaveBeenCalled();
  });

  it('completes autosave when file-backup permission is unavailable', async () => {
    const store = getStateMock();
    store.autosave.isEnabled = true;
    store.autosave.fileBackup.enabled = true;
    store.autosave.fileBackup.mode = 'single-file';
    store.autosave.fileBackup.fileHandle = { id: 'fh-2' } as unknown as FileSystemFileHandle;
    (fileBackupService.ensureFileWritePermission as jest.Mock).mockResolvedValueOnce(false);

    await autosaveService.triggerAutosave();

    expect(fileBackupService.saveProjectBackup).not.toHaveBeenCalled();
    expect(store.clearDirtyState).not.toHaveBeenCalled();
    expect(store.clearDirtyStateIfRevision).toHaveBeenCalled();
    expect(store.setSaveStatus).toHaveBeenCalledWith('saving', 'autosave', 'Autosaving...');
    expect(store.setSaveStatus).toHaveBeenCalledWith('saved', 'autosave', 'Autosave complete');
    expect(store.addNotification).toHaveBeenCalledWith({
      type: 'warning',
      title: 'Autosave Permission Needed',
      message: 'Autosave could not update the file because write permission was not granted. Re-open the project or choose a backup file.',
      timestamp: expect.any(Date),
      duration: 5000,
    });
  });

  it('keeps the primary autosave committed but visibly reports a backup-file failure', async () => {
    const store = getStateMock();
    store.autosave.isEnabled = true;
    store.autosave.fileBackup.enabled = true;
    store.autosave.fileBackup.mode = 'single-file';
    store.autosave.fileBackup.fileHandle = { id: 'fh-failure' } as unknown as FileSystemFileHandle;
    (fileBackupService.saveProjectBackup as jest.Mock).mockResolvedValueOnce({
      success: false,
      error: 'Disk is full',
    });

    await autosaveService.triggerAutosave();

    expect(store.clearDirtyStateIfRevision).toHaveBeenCalled();
    expect(store.updateFileBackupTime).not.toHaveBeenCalled();
    expect(store.addNotification).toHaveBeenCalledWith({
      type: 'warning',
      title: 'Backup File Not Updated',
      message: 'Disk is full',
      timestamp: expect.any(Date),
      duration: 5000,
    });
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

    const persistedLayers = (backgroundStorageService.createAutosaveCapture as jest.Mock).mock.calls[0]?.[1];
    expect(Array.isArray(persistedLayers)).toBe(true);
    expect(persistedLayers[0].layerType).toBe('sequential');
    expect(persistedLayers[0].sequentialData).toEqual(store.layers[0].sequentialData);
  });
});
