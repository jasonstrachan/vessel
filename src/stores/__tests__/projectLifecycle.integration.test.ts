import { createDefaultExportLayout, createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import type { CustomBrush, Layer, Project } from '@/types';
import { useAppStore } from '@/stores/useAppStore';
import type { AppState } from '@/stores/useAppStore';
import { exportProjectAsPNG, saveProjectToFile } from '@/utils/projectIO';

jest.mock('@/utils/projectIO', () => ({
  __esModule: true as const,
  restoreColorCycleBrushes: jest.fn(async (layers) => layers),
  saveProjectToFile: jest.fn(),
  loadProjectFromFile: jest.fn(),
  exportProjectAsPNG: jest.fn(),
}));

jest.mock('@/utils/fileBackupService', () => ({
  __esModule: true as const,
  fileBackupService: {
    setFileHandle: jest.fn(),
    ensureFileWritePermission: jest.fn().mockResolvedValue(true),
  },
}));

const mockBrush = {
  setLayerId: jest.fn(),
  isUsingWebGL: jest.fn(() => false),
};

jest.mock('@/stores/colorCycleBrushManager', () => {
  const manager = {
    brushes: new Map<string, unknown>(),
    brushMetadata: new Map<string, unknown>(),
    activeResources: new Set<string>(),
    initColorCycleForLayer: jest.fn(() => true),
    setActiveState: jest.fn(),
    cleanupOrphanedBrushes: jest.fn(),
    cleanupInactive: jest.fn(),
    cleanupAll: jest.fn(),
    validateColorCycleBrush: jest.fn(() => true),
    getLayerColorCycleBrush: jest.fn(() => mockBrush),
    getBrush: jest.fn(() => mockBrush),
    createBrush: jest.fn(() => mockBrush),
    updateBrush: jest.fn(),
    deleteBrush: jest.fn(),
    removeColorCycleBrush: jest.fn(),
    transferColorCycleBrush: jest.fn(),
    setCanvasImplementation: jest.fn(),
  };

  return {
    __esModule: true as const,
    getColorCycleBrushManager: () => manager,
    setLayerIdGetter: jest.fn(),
    setColorCycleStoreStateGetter: jest.fn(),
    __mockManager: manager,
  };
});

const { __mockManager: mockManager } = jest.requireMock('@/stores/colorCycleBrushManager') as {
  __mockManager: {
    brushes: Map<string, unknown>;
    brushMetadata: Map<string, unknown>;
    activeResources: Set<string>;
    initColorCycleForLayer: jest.Mock;
    setActiveState: jest.Mock;
    cleanupOrphanedBrushes: jest.Mock;
    cleanupInactive: jest.Mock;
    cleanupAll: jest.Mock;
    validateColorCycleBrush: jest.Mock;
    getLayerColorCycleBrush: jest.Mock;
    getBrush: jest.Mock;
    createBrush: jest.Mock;
    updateBrush: jest.Mock;
    deleteBrush: jest.Mock;
    removeColorCycleBrush: jest.Mock;
    transferColorCycleBrush: jest.Mock;
    setCanvasImplementation: jest.Mock;
  };
};

const makeLayer = (id: string, overrides: Partial<Layer> = {}): Layer => ({
  id,
  name: `Layer ${id}`,
  visible: true,
  opacity: 1,
  blendMode: 'source-over',
  locked: false,
  transparencyLocked: false,
  order: 0,
  imageData: new ImageData(8, 8),
  framebuffer: {
    width: 8,
    height: 8,
    getContext: jest.fn(() => ({
      drawImage: jest.fn(),
      getImageData: jest.fn(() => new ImageData(8, 8)),
      clearRect: jest.fn(),
      putImageData: jest.fn(),
    })),
  } as unknown as OffscreenCanvas,
  alignment: createDefaultLayerAlignment(),
  layerType: 'normal',
  ...overrides,
});

const makeCustomBrush = (id: string): CustomBrush => ({
  id,
  name: `Brush ${id}`,
  imageData: new ImageData(4, 4),
  thumbnail: '',
  width: 4,
  height: 4,
  createdAt: Date.now(),
  naturalWidth: 4,
  naturalHeight: 4,
  maxDimension: 4,
});

describe('project slice lifecycle flows', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockManager.brushes.clear();
    mockManager.brushMetadata.clear();
    mockManager.activeResources.clear();
    useAppStore.setState((state) => ({
      addNotification: jest.fn(),
      captureCanvasToActiveLayer: jest.fn().mockResolvedValue(undefined),
      paletteDirty: false,
      projectFilename: null,
      projectFileHandle: null,
      layers: state.layers.length ? state.layers : [],
      autosave: {
        ...state.autosave,
        isEnabled: false,
        isRunning: false,
        hasUnsavedChanges: false,
        lastSaveTime: null,
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
      },
    }));
  });

  it('captures the active layer before saving and records saved file metadata', async () => {
    const captureSpy = useAppStore.getState()
      .captureCanvasToActiveLayer as jest.MockedFunction<AppState['captureCanvasToActiveLayer']>;
    const notifySpy = useAppStore.getState().addNotification as jest.Mock;
    captureSpy.mockClear();
    notifySpy.mockClear();
    useAppStore.setState({ currentOffscreenCanvas: document.createElement('canvas') });

    (saveProjectToFile as jest.Mock).mockResolvedValue({
      fileName: 'poster.vessel',
      fileHandle: { id: 'handle-1' },
    });

    await useAppStore.getState().saveProject('poster.vessel');

    expect(captureSpy).toHaveBeenCalledTimes(1);
    expect(saveProjectToFile).toHaveBeenCalledTimes(1);
    const [projectPayload, preferredName, layersArg] = (saveProjectToFile as jest.Mock).mock.calls[0];
    expect(preferredName).toBe('poster.vessel');
    expect(projectPayload.viewState?.zoom).toBe(useAppStore.getState().canvas.zoom);
    expect(Array.isArray(layersArg)).toBe(true);
    expect(useAppStore.getState().projectFilename).toBe('poster.vessel');
    expect(useAppStore.getState().projectFileHandle).toEqual({ id: 'handle-1' });
    expect(useAppStore.getState().autosave.fileBackup).toEqual({
      enabled: true,
      mode: 'single-file',
      fileHandle: { id: 'handle-1' },
      directoryHandle: null,
      backupPath: 'poster.vessel',
      lastBackupTime: null,
    });
    expect(notifySpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success', title: 'Project Saved' })
    );
  });

  it('forces a save dialog when requested even if a file handle exists', async () => {
    useAppStore.setState((state) => ({
      projectFilename: 'existing.vessel',
      projectFileHandle: { id: 'handle-existing' } as unknown as FileSystemFileHandle,
      autosave: {
        ...state.autosave,
        fileBackup: {
          ...state.autosave.fileBackup,
          fileHandle: { id: 'handle-existing' } as unknown as FileSystemFileHandle,
        },
      },
    }));

    (saveProjectToFile as jest.Mock).mockResolvedValue({
      fileName: 'new-file.vessel',
      fileHandle: { id: 'handle-new' },
    });

    await useAppStore.getState().saveProject({ forceDialog: true });

    const [, , , existingHandleArg] = (saveProjectToFile as jest.Mock).mock.calls[0];
    expect(existingHandleArg).toBeNull();
    expect(useAppStore.getState().projectFilename).toBe('new-file.vessel');
    expect(useAppStore.getState().projectFileHandle).toEqual({ id: 'handle-new' });
  });

  it('imports a project payload via helper and resets file metadata', async () => {
    const layers = [makeLayer('layer-import')];
    const project: Project = {
      id: 'project-import',
      name: 'Imported Scene',
      width: 320,
      height: 180,
      layers,
      backgroundColor: '#101010',
      createdAt: new Date('2024-04-01'),
      updatedAt: new Date('2024-04-02'),
      customBrushes: [makeCustomBrush('brush-1')],
      defaultCustomBrushId: 'brush-1',
      exportLayout: createDefaultExportLayout(),
      palette: {
        foregroundColor: '#ff00ff',
        backgroundColor: '#00ffff',
        activeSlot: 'foreground',
      },
      brushSpecificSettings: {},
    };

    await useAppStore.getState().importProject(project, { fileName: 'imported.vessel' });

    const nextState = useAppStore.getState();
    expect(nextState.project?.id).toBe('project-import');
    expect(nextState.layers).toHaveLength(1);
    expect(nextState.activeLayerId).toBe('layer-import');
    expect(nextState.selectedLayerIds).toEqual(['layer-import']);
    expect(nextState.palette.foregroundColor).toBe('#ff00ff');
    expect(nextState.projectFilename).toBe('imported.vessel');
    expect(nextState.projectFileHandle).toBeNull();
    expect(nextState.autosave.fileBackup).toEqual({
      enabled: false,
      mode: 'single-file',
      fileHandle: null,
      directoryHandle: null,
      backupPath: null,
      lastBackupTime: null,
    });
    expect(mockManager.cleanupOrphanedBrushes).toHaveBeenCalled();
    const cleanupArgs = mockManager.cleanupOrphanedBrushes.mock.calls[0]?.[0];
    expect(cleanupArgs instanceof Set ? cleanupArgs.size : null).toBe(0);
  });

  it('imports a project payload and binds file handle for autosave', async () => {
    const layers = [makeLayer('layer-import-handle')];
    const project: Project = {
      id: 'project-import-handle',
      name: 'Imported Scene With Handle',
      width: 320,
      height: 180,
      layers,
      backgroundColor: '#101010',
      createdAt: new Date('2024-04-01'),
      updatedAt: new Date('2024-04-02'),
      customBrushes: [makeCustomBrush('brush-2')],
      defaultCustomBrushId: 'brush-2',
      exportLayout: createDefaultExportLayout(),
      palette: {
        foregroundColor: '#ff00ff',
        backgroundColor: '#00ffff',
        activeSlot: 'foreground',
      },
      brushSpecificSettings: {},
    };

    const fileHandle = { name: 'imported.vessel' } as FileSystemFileHandle;

    await useAppStore.getState().importProject(project, {
      fileName: 'imported.vessel',
      fileHandle,
    });

    const nextState = useAppStore.getState();
    expect(nextState.projectFilename).toBe('imported.vessel');
    expect(nextState.projectFileHandle).toBe(fileHandle);
    expect(nextState.autosave.fileBackup).toEqual({
      enabled: true,
      mode: 'single-file',
      fileHandle,
      directoryHandle: null,
      backupPath: 'imported.vessel',
      lastBackupTime: null,
    });
  });

  it('exports the current project as PNG and emits a success notification', async () => {
    const notifySpy = useAppStore.getState().addNotification as jest.Mock;
    notifySpy.mockClear();
    (exportProjectAsPNG as jest.Mock).mockResolvedValue(undefined);

    await useAppStore.getState().exportProject('png', { quality: 0.8, scale: 2 });

    expect(exportProjectAsPNG).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Array),
      expect.objectContaining({ quality: 0.8, scale: 2 })
    );
    expect(notifySpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success', title: 'Export Complete' })
    );
  });
});
