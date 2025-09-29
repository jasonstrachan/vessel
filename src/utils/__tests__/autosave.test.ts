import { autosaveService } from '../autosave';
import { useAppStore } from '../../stores/useAppStore';
import { backgroundStorageService } from '../backgroundStorage';
import { fileBackupService } from '../fileBackupService';

jest.mock('../../stores/useAppStore', () => ({
  useAppStore: {
    getState: jest.fn(),
    setState: jest.fn()
  }
}));

describe('AutosaveService', () => {
  const getStateMock = useAppStore.getState as unknown as jest.Mock;
  const setStateMock = useAppStore.setState as unknown as jest.Mock;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    const storeStub = {
      autosave: {
        isEnabled: true,
        hasUnsavedChanges: true,
        isRunning: false,
        fileBackup: {
          enabled: false,
          mode: 'single-file' as const,
          fileHandle: null,
          directoryHandle: null
        }
      },
      project: {
        id: 'test-project',
        name: 'Test Project'
      },
      layers: [{ id: 'layer-1' }],
      captureCanvasToActiveLayer: jest.fn().mockResolvedValue(undefined),
      clearDirtyState: jest.fn(),
      updateFileBackupTime: jest.fn(),
      addNotification: jest.fn()
    };

    getStateMock.mockReturnValue(storeStub);
    setStateMock.mockImplementation(() => {});

    jest.spyOn(backgroundStorageService, 'saveProjectInBackground').mockResolvedValue(undefined);
    jest.spyOn(fileBackupService, 'saveProjectBackup').mockResolvedValue({ success: true, filename: 'backup.json' });
    jest.spyOn(fileBackupService, 'setFileHandle').mockImplementation(() => {});
    jest.spyOn(fileBackupService, 'setDirectoryHandle').mockImplementation(() => {});

    autosaveService.stop();
  });

  afterEach(() => {
    autosaveService.stop();
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

  it('should perform autosave when conditions are met', async () => {
    const store = getStateMock();

    await autosaveService.triggerAutosave();

    expect(store.captureCanvasToActiveLayer).toHaveBeenCalled();
    expect(backgroundStorageService.saveProjectInBackground).toHaveBeenCalledWith(
      store.project,
      store.layers
    );
    expect(store.clearDirtyState).toHaveBeenCalled();
  });

  it('should not perform autosave when disabled', async () => {
    const store = getStateMock();
    store.autosave.isEnabled = false;

    await autosaveService.triggerAutosave();

    expect(backgroundStorageService.saveProjectInBackground).not.toHaveBeenCalled();
  });

  it('should not perform autosave when no unsaved changes', async () => {
    const store = getStateMock();
    store.autosave.hasUnsavedChanges = false;

    await autosaveService.triggerAutosave();

    expect(backgroundStorageService.saveProjectInBackground).not.toHaveBeenCalled();
  });

  it('should not perform autosave when no project is present', async () => {
    const store = getStateMock();
    store.project = null;

    await autosaveService.triggerAutosave();

    expect(backgroundStorageService.saveProjectInBackground).not.toHaveBeenCalled();
  });

  it('should handle save errors gracefully', async () => {
    const store = getStateMock();
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
