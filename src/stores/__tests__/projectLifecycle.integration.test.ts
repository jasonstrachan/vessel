import JSZip from 'jszip';
import { createDefaultExportLayout, createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import { BrushShape, type CustomBrush, type DisplayFilterConfig, type Layer, type Project } from '@/types';
import { useAppStore } from '@/stores/useAppStore';
import type { AppState } from '@/stores/useAppStore';
import { exportProjectAsPNG, saveProjectToFile } from '@/utils/projectIO';
import { backgroundStorageService } from '@/utils/backgroundStorage';
import { flushPendingToolWork } from '@/utils/toolFlushRegistry';
import { fileBackupService } from '@/utils/fileBackupService';
import {
  waitForAllPendingColorCycleSaves,
  waitForFinalizeQueueIdle,
} from '@/stores/pendingColorCycleSaves';
import {
  attachLegacyColorCycleTopLevelBuffers,
  getColorCycleLegacyLayerBuffer,
  getDerivedSurfaceBuiltFromVersion,
} from '@/lib/colorCycle/document';
import { readTestColorCycleBrushLayerSnapshot } from '@/testing/colorCycleSnapshotTestUtils';

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

jest.mock('@/utils/toolFlushRegistry', () => ({
  __esModule: true as const,
  flushPendingToolWork: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/utils/backgroundStorage', () => ({
  __esModule: true as const,
  backgroundStorageService: {
    getAutosaveRevisionFloor: jest.fn().mockResolvedValue(0),
    updateSession: jest.fn().mockResolvedValue(undefined),
    resetSession: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('@/stores/pendingColorCycleSaves', () => ({
  __esModule: true as const,
  waitForAllPendingColorCycleSaves: jest.fn().mockResolvedValue(undefined),
  waitForFinalizeQueueIdle: jest.fn().mockResolvedValue(undefined),
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
    getSerializedStateBrush: jest.fn(() => mockBrush),
    getSurfaceBrush: jest.fn(() => mockBrush),
    getBrush: jest.fn(() => mockBrush),
    getDocument: jest.fn(() => undefined),
    ensureDocument: jest.fn(() => undefined),
    createBrush: jest.fn(() => mockBrush),
    registerDocument: jest.fn(),
    registerRestoredBrush: jest.fn((layerId: string, brush: unknown) => {
      manager.brushes.set(layerId, brush);
      manager.activeResources.add(layerId);
      manager.activeResources.add(`canvas_${layerId}`);
    }),
    applySettingsToBrushes: jest.fn(),
    deleteBrush: jest.fn(),
    removeColorCycleBrush: jest.fn(),
    transferColorCycleBrush: jest.fn(),
    setCanvasImplementation: jest.fn(),
  };

  return {
    __esModule: true as const,
    getColorCycleBrushManager: () => manager,
    createColorCycleBrushManager: () => manager,
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
    getSerializedStateBrush: jest.Mock;
    getSurfaceBrush: jest.Mock;
    getBrush: jest.Mock;
    getDocument: jest.Mock;
    ensureDocument: jest.Mock;
    createBrush: jest.Mock;
    registerDocument: jest.Mock;
    registerRestoredBrush: jest.Mock;
    applySettingsToBrushes: jest.Mock;
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
    mockManager.getDocument.mockReset().mockReturnValue(undefined);
    mockManager.brushes.clear();
    mockManager.brushMetadata.clear();
    mockManager.activeResources.clear();
    useAppStore.setState((state) => ({
      addNotification: jest.fn(),
      captureCanvasToActiveLayer: jest.fn().mockResolvedValue(undefined),
      paletteDirty: false,
      projectFilename: null,
      projectFileHandle: null,
      floatingPaste: null,
      floatingPasteHistoryContext: null,
      layers: state.layers.length ? state.layers : [],
      autosave: {
        ...state.autosave,
        isEnabled: false,
        isRunning: false,
        isSessionSyncSuspended: false,
        hasUnsavedChanges: false,
        dirtyRevision: 0,
        savedRevision: 0,
        lastSaveTime: null,
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
    }));
  }, 10000);

  it('flushes pending tool work before saving and records saved file metadata', async () => {
    const captureSpy = useAppStore.getState()
      .captureCanvasToActiveLayer as jest.MockedFunction<AppState['captureCanvasToActiveLayer']>;
    const notifySpy = useAppStore.getState().addNotification as jest.Mock;
    captureSpy.mockClear();
    notifySpy.mockClear();
    useAppStore.setState({ currentOffscreenCanvas: document.createElement('canvas') });
    useAppStore.setState((state) => ({
      autosave: {
        ...state.autosave,
        hasUnsavedChanges: true,
      },
    }));

    (saveProjectToFile as jest.Mock).mockResolvedValue({
      fileName: 'poster.vessel',
      fileHandle: { id: 'handle-1' },
    });

    await useAppStore.getState().saveProject('poster.vessel');

    expect(flushPendingToolWork).toHaveBeenCalledTimes(1);
    expect(waitForFinalizeQueueIdle).toHaveBeenCalledTimes(1);
    expect(waitForAllPendingColorCycleSaves).toHaveBeenCalledTimes(1);
    expect(captureSpy).not.toHaveBeenCalled();
    expect(saveProjectToFile).toHaveBeenCalledTimes(1);
    const [projectPayload, preferredName, layersArg] = (saveProjectToFile as jest.Mock).mock.calls[0];
    expect(preferredName).toBe('poster.vessel');
    expect(projectPayload.viewState?.zoom).toBe(useAppStore.getState().canvas.zoom);
    expect(projectPayload.viewState?.displayFilters).toEqual(useAppStore.getState().canvas.displayFilters);
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
    expect(useAppStore.getState().autosave.hasUnsavedChanges).toBe(false);
    expect(backgroundStorageService.updateSession).toHaveBeenCalledWith(
      expect.any(String),
      false,
      expect.objectContaining({
        dirtyRevision: expect.any(Number),
        savedRevision: expect.any(Number),
        lastSaveTime: expect.any(Number),
      }),
    );
    expect(notifySpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success', title: 'Project Saved' })
    );
  });

  it('keeps a newer edit dirty when an older manual save completes', async () => {
    useAppStore.setState((state) => ({
      paletteDirty: true,
      autosave: {
        ...state.autosave,
        hasUnsavedChanges: true,
        dirtyRevision: 1,
        savedRevision: 0,
      },
    }));
    let resolveSave: ((result: {
      fileName: string;
      fileHandle: FileSystemFileHandle | null;
    }) => void) | undefined;
    (saveProjectToFile as jest.Mock).mockReturnValueOnce(new Promise((resolve) => {
      resolveSave = resolve;
    }));

    const savePromise = useAppStore.getState().saveProject('revision-race.vessel');
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(saveProjectToFile).toHaveBeenCalledTimes(1);

    useAppStore.getState().markAutosaveDirty('layer-change');
    resolveSave?.({ fileName: 'revision-race.vessel', fileHandle: null });
    await savePromise;

    const state = useAppStore.getState();
    expect(state.autosave).toEqual(expect.objectContaining({
      hasUnsavedChanges: true,
      dirtyRevision: 2,
      savedRevision: 1,
      saveStatus: expect.objectContaining({
        phase: 'idle',
        message: 'Saved earlier changes; newer changes pending',
      }),
    }));
    expect(state.paletteDirty).toBe(true);
    expect(backgroundStorageService.updateSession).toHaveBeenLastCalledWith(
      state.project?.id,
      true,
      expect.objectContaining({ dirtyRevision: 2, savedRevision: 1 }),
    );
  });

  it('does not let an older save completion replace a newer save target', async () => {
    useAppStore.setState((state) => ({
      autosave: {
        ...state.autosave,
        hasUnsavedChanges: true,
        dirtyRevision: 1,
        savedRevision: 0,
      },
    }));
    let resolveOlderSave: ((result: {
      fileName: string;
      fileHandle: FileSystemFileHandle;
      writeStatus: 'written';
    }) => void) | undefined;
    const olderHandle = { id: 'older-handle' } as unknown as FileSystemFileHandle;
    const newerHandle = { id: 'newer-handle' } as unknown as FileSystemFileHandle;
    (saveProjectToFile as jest.Mock)
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveOlderSave = resolve;
      }))
      .mockResolvedValueOnce({
        fileName: 'newer.vs',
        fileHandle: newerHandle,
        writeStatus: 'written',
      });

    const olderSave = useAppStore.getState().saveProject('older.vs');
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    useAppStore.getState().markAutosaveDirty('layer-change');
    const newerSave = useAppStore.getState().saveProject('newer.vs');
    await newerSave;

    resolveOlderSave?.({
      fileName: 'older.vs',
      fileHandle: olderHandle,
      writeStatus: 'written',
    });
    await olderSave;

    const state = useAppStore.getState();
    expect(state.projectFilename).toBe('newer.vs');
    expect(state.projectFileHandle).toBe(newerHandle);
    expect(fileBackupService.setFileHandle).toHaveBeenCalledTimes(1);
    expect(fileBackupService.setFileHandle).toHaveBeenCalledWith(newerHandle);
  });

  it('does not attach an old save result or clear state after project replacement', async () => {
    const originalProject = useAppStore.getState().project;
    expect(originalProject).not.toBeNull();
    useAppStore.setState((state) => ({
      paletteDirty: true,
      autosave: {
        ...state.autosave,
        hasUnsavedChanges: true,
        dirtyRevision: 1,
        savedRevision: 0,
      },
    }));
    let resolveSave: ((result: {
      fileName: string;
      fileHandle: FileSystemFileHandle | null;
    }) => void) | undefined;
    (saveProjectToFile as jest.Mock).mockReturnValueOnce(new Promise((resolve) => {
      resolveSave = resolve;
    }));

    const savePromise = useAppStore.getState().saveProject('old-project.vessel');
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    useAppStore.setState({
      project: {
        ...originalProject!,
        id: 'replacement-project',
        name: 'Replacement Project',
      },
      projectFilename: null,
      projectFileHandle: null,
    });
    resolveSave?.({
      fileName: 'old-project.vessel',
      fileHandle: { id: 'old-handle' } as unknown as FileSystemFileHandle,
    });
    await savePromise;

    const state = useAppStore.getState();
    expect(state.project?.id).toBe('replacement-project');
    expect(state.projectFilename).toBeNull();
    expect(state.projectFileHandle).toBeNull();
    expect(state.autosave.hasUnsavedChanges).toBe(true);
    expect(state.paletteDirty).toBe(true);
  });

  it('does not capture a replacement project after an older save waits for tool work', async () => {
    const originalProject = useAppStore.getState().project;
    expect(originalProject).not.toBeNull();
    let releaseToolWork: (() => void) | undefined;
    (flushPendingToolWork as jest.Mock).mockReturnValueOnce(new Promise<void>((resolve) => {
      releaseToolWork = resolve;
    }));

    const savePromise = useAppStore.getState().saveProject('old-project.vs');
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    useAppStore.setState({
      project: {
        ...originalProject!,
        id: 'replacement-before-capture',
        name: 'Replacement Before Capture',
      },
    });
    releaseToolWork?.();
    await savePromise;

    expect(saveProjectToFile).not.toHaveBeenCalled();
    expect(useAppStore.getState().project?.id).toBe('replacement-before-capture');
  });

  it('captures live color-cycle canvas pixels before stale compatibility snapshots when saving', async () => {
    const staleSnapshot = new ImageData(new Uint8ClampedArray([0, 0, 0, 255]), 1, 1);
    const liveCanvas = document.createElement('canvas');
    liveCanvas.width = 1;
    liveCanvas.height = 1;
    liveCanvas.getContext('2d')?.putImageData(
      new ImageData(new Uint8ClampedArray([12, 34, 56, 255]), 1, 1),
      0,
      0,
    );
    const layer = makeLayer('layer-cc-save-live', {
      layerType: 'color-cycle',
      imageData: null,
      colorCycleData: {
        canvas: liveCanvas,
        canvasImageData: staleSnapshot,
        canvasWidth: 1,
        canvasHeight: 1,
        mode: 'brush',
      },
    });
    const project: Project = {
      id: 'project-cc-save-live',
      name: 'CC Save Live',
      width: 1,
      height: 1,
      layers: [layer],
      backgroundColor: '#000000',
      createdAt: new Date('2024-04-01'),
      updatedAt: new Date('2024-04-02'),
      customBrushes: [],
      defaultCustomBrushId: null,
      exportLayout: createDefaultExportLayout(),
      palette: {
        foregroundColor: '#ffffff',
        backgroundColor: '#000000',
        activeSlot: 'foreground',
      },
      brushSpecificSettings: {},
    };

    useAppStore.setState({
      project,
      layers: [layer],
      layerGroups: [],
    });
    mockManager.getDocument.mockReturnValue({
      version: 22,
      read: () => ({ version: 22, snapshot: {} }),
    });
    (saveProjectToFile as jest.Mock).mockResolvedValue({
      fileName: 'cc-save-live.vessel',
      fileHandle: null,
    });

    await useAppStore.getState().saveProject('cc-save-live.vessel');

    const [, , layersArg] = (saveProjectToFile as jest.Mock).mock.calls[0] as [Project, string, Layer[]];
    const savedImageData = layersArg[0]?.colorCycleData?.canvasImageData;
    expect(Array.from(savedImageData?.data.slice(0, 4) ?? [])).toEqual([12, 34, 56, 255]);
    expect(getDerivedSurfaceBuiltFromVersion(savedImageData)).toBe(22);
  });

  it('does not resurrect stale color-cycle preview pixels when saving a cleared layer', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const stalePreview = new ImageData(new Uint8ClampedArray([90, 80, 70, 255]), 1, 1);
    const layer = makeLayer('layer-cleared-cc-save', {
      layerType: 'color-cycle',
      imageData: null,
      framebuffer: canvas as unknown as OffscreenCanvas,
      colorCycleData: {
        canvas,
        canvasImageData: stalePreview,
        hasContent: true,
      },
    });
    const project: Project = {
      id: 'project-cleared-cc-save',
      name: 'Cleared CC Save',
      width: 1,
      height: 1,
      layers: [layer],
      backgroundColor: '#000000',
      createdAt: new Date('2024-04-01'),
      updatedAt: new Date('2024-04-02'),
      customBrushes: [],
      defaultCustomBrushId: null,
      exportLayout: createDefaultExportLayout(),
      palette: {
        foregroundColor: '#ffffff',
        backgroundColor: '#000000',
        activeSlot: 'foreground',
      },
      brushSpecificSettings: {},
    };
    const clearedBrush = {
      getColorCycleLayerDocument: jest.fn(() => ({
        read: () => ({
          snapshot: {
            paintBuffer: new ArrayBuffer(0),
            hasContent: false,
          },
          version: 1,
        }),
      })),
      renderDirectToCanvas: jest.fn(),
    };

    mockManager.getSerializedStateBrush.mockReturnValue(clearedBrush);
    mockManager.getSurfaceBrush.mockReturnValue(clearedBrush);
    useAppStore.setState({
      project,
      layers: [layer],
      layerGroups: [],
    });
    (saveProjectToFile as jest.Mock).mockResolvedValue({
      fileName: 'cc-cleared-save.vessel',
      fileHandle: null,
    });

    await useAppStore.getState().saveProject('cc-cleared-save.vessel');

    const [, , layersArg] = (saveProjectToFile as jest.Mock).mock.calls[0] as [Project, string, Layer[]];
    const savedImageData = layersArg[0]?.colorCycleData?.canvasImageData;
    expect(Array.from(savedImageData?.data.slice(0, 4) ?? [])).toEqual([0, 0, 0, 0]);
  });

  it('blocks manual save while a floating paste is active', async () => {
    const layer = makeLayer('layer-active-floating-save-guard');
    const project: Project = {
      id: 'project-active-floating-save-guard',
      name: 'Active Floating Save Guard',
      width: 8,
      height: 8,
      layers: [layer],
      backgroundColor: '#000000',
      createdAt: new Date('2024-04-01'),
      updatedAt: new Date('2024-04-02'),
      customBrushes: [],
      defaultCustomBrushId: null,
      exportLayout: createDefaultExportLayout(),
      palette: {
        foregroundColor: '#ffffff',
        backgroundColor: '#000000',
        activeSlot: 'foreground',
      },
      brushSpecificSettings: {},
    };

    useAppStore.setState({
      project,
      layers: [layer],
      floatingPaste: {
        active: true,
        imageData: new ImageData(1, 1),
        position: { x: 0, y: 0 },
        originalPosition: { x: 0, y: 0 },
        width: 1,
        height: 1,
        displayWidth: 1,
        displayHeight: 1,
        rotation: 0,
        sourceLayerId: layer.id,
      },
    });

    await expect(useAppStore.getState().saveProject('active-floating.vessel')).rejects.toThrow(
      'Finish or cancel the floating selection before saving.'
    );
    expect(saveProjectToFile).not.toHaveBeenCalled();
  });

  it('does not merge composite canvas pixels into the active layer while saving', async () => {
    const layer = makeLayer('layer-save-guard', {
      imageData: new ImageData(new Uint8ClampedArray([12, 34, 56, 255]), 1, 1),
    });
    const project: Project = {
      id: 'project-save-guard',
      name: 'Save Guard',
      width: 1,
      height: 1,
      layers: [layer],
      backgroundColor: '#000000',
      createdAt: new Date('2024-04-01'),
      updatedAt: new Date('2024-04-02'),
      customBrushes: [],
      defaultCustomBrushId: null,
      exportLayout: createDefaultExportLayout(),
      palette: {
        foregroundColor: '#ffffff',
        backgroundColor: '#000000',
        activeSlot: 'foreground',
      },
      brushSpecificSettings: {},
    };

    const compositeCanvas = document.createElement('canvas');
    compositeCanvas.width = 1;
    compositeCanvas.height = 1;
    const compositeCtx = compositeCanvas.getContext('2d');
    compositeCtx?.putImageData(
      new ImageData(new Uint8ClampedArray([200, 10, 10, 255]), 1, 1),
      0,
      0
    );

    useAppStore.setState({
      project,
      layers: [layer],
      activeLayerId: layer.id,
      selectedLayerIds: [layer.id],
      currentOffscreenCanvas: compositeCanvas,
    });

    (saveProjectToFile as jest.Mock).mockResolvedValue({
      fileName: 'save-guard.vessel',
      fileHandle: null,
    });

    await useAppStore.getState().saveProject('save-guard.vessel');

    const savedState = useAppStore.getState();
    const savedLayer = savedState.layers.find((entry) => entry.id === layer.id);
    expect(savedLayer?.imageData?.data[0]).toBe(12);
    expect(savedLayer?.imageData?.data[1]).toBe(34);
    expect(savedLayer?.imageData?.data[2]).toBe(56);
    expect(savedLayer?.imageData?.data[3]).toBe(255);
    expect(savedLayer?.imageData?.data[0]).not.toBe(200);
  });

  it('restores persisted display filters when loading a project', async () => {
    const displayFilters: DisplayFilterConfig[] = [
      { id: 'pixelate', enabled: true, settings: { cellSize: 6 } },
      { id: 'round-pixels', enabled: true, settings: { blurRadius: 2.5, threshold: 0.44, crush: 0.52, preserveColor: 0.84 } },
      { id: 'bloom', enabled: true, settings: { blurRadius: 4, intensity: 0.2 } },
      { id: 'color-grade', enabled: false, settings: { brightness: 0, contrast: 0.1, saturation: 1 } },
      { id: 'lcd-mask', enabled: false, settings: { stripeOpacity: 0.1, scanlineOpacity: 0.02 } },
      {
        id: 'crt',
        enabled: true,
        settings: {
          cellSize: 12,
          scanlineIntensity: 0.08,
          maskIntensity: 0.07,
          barrelDistortion: 0.15,
          chromaticAberration: 2,
          beamFocus: 0.51,
          brightness: 0.5,
          shadowLift: 0.16,
          vignetteIntensity: 0.45,
          flickerIntensity: 0.2,
          signalArtifacts: 0.45,
          bloomIntensity: 1.93,
          bloomRadius: 24,
        },
      },
      {
        id: 'crt-grid',
        enabled: true,
        settings: { lineOpacity: 0.16, lineSpacing: 5, phosphorOpacity: 0.12, scanlineOpacity: 0.18 },
      },
      { id: 'chromatic-aberration', enabled: true, settings: { offset: 1.25, intensity: 0.2 } },
      { id: 'noise', enabled: true, settings: { opacity: 0.08, scale: 2 } },
      { id: 'film-noise', enabled: true, settings: { opacity: 0.16, scale: 1.5, shadowBias: 0.62 } },
    ];

    const loadProjectFromFile = jest.requireMock('@/utils/projectIO').loadProjectFromFile as jest.Mock;
    loadProjectFromFile.mockResolvedValue({
      project: {
        id: 'loaded-project',
        name: 'Loaded',
        width: 16,
        height: 16,
        layers: [makeLayer('loaded-layer')],
        backgroundColor: '#000',
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-02'),
        customBrushes: [],
        defaultCustomBrushId: null,
        exportLayout: createDefaultExportLayout(),
        palette: {
          foregroundColor: '#ffffff',
          backgroundColor: '#000000',
          activeSlot: 'foreground',
        },
        viewState: {
          zoom: 2,
          displayFilters,
        },
      },
      fileName: 'loaded.vessel',
      fileHandle: null,
    });

    await useAppStore.getState().loadProject();

    expect(useAppStore.getState().canvas.zoom).toBe(2);
    expect(useAppStore.getState().canvas.displayFilters).toEqual(displayFilters);
  });

  it('falls back to locally remembered filter settings with all filters disabled when a project has none', async () => {
    localStorage.setItem('vessel-settings', JSON.stringify({
      canvas: {
        displayFilterDefaults: [
          { id: 'pixelate', enabled: true, settings: { cellSize: 9 } },
          { id: 'round-pixels', enabled: true, settings: { blurRadius: 3, threshold: 0.47, crush: 0.58, preserveColor: 0.79 } },
          { id: 'bloom', enabled: true, settings: { blurRadius: 5, intensity: 0.4 } },
          { id: 'crt', enabled: true, settings: { beamFocus: 0.72, vignetteIntensity: 0.3 } },
        ],
      },
    }));

    const loadProjectFromFile = jest.requireMock('@/utils/projectIO').loadProjectFromFile as jest.Mock;
    loadProjectFromFile.mockResolvedValue({
      project: {
        id: 'loaded-project-no-filters',
        name: 'Loaded No Filters',
        width: 16,
        height: 16,
        layers: [makeLayer('loaded-layer')],
        backgroundColor: '#000',
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-02'),
        customBrushes: [],
        defaultCustomBrushId: null,
        exportLayout: createDefaultExportLayout(),
        palette: {
          foregroundColor: '#ffffff',
          backgroundColor: '#000000',
          activeSlot: 'foreground',
        },
        viewState: {
          zoom: 2,
        },
      },
      fileName: 'loaded.vessel',
      fileHandle: null,
    });

    await useAppStore.getState().loadProject();

    expect(useAppStore.getState().canvas.displayFilters.find((filter) => filter.id === 'pixelate')).toEqual({
      id: 'pixelate',
      enabled: false,
      settings: { cellSize: 9 },
    });
    expect(useAppStore.getState().canvas.displayFilters.find((filter) => filter.id === 'bloom')).toEqual({
      id: 'bloom',
      enabled: false,
      settings: { blurRadius: 5, intensity: 0.4 },
    });
    expect(useAppStore.getState().canvas.displayFilters.find((filter) => filter.id === 'round-pixels')).toEqual({
      id: 'round-pixels',
      enabled: false,
      settings: { blurRadius: 3, threshold: 0.47000000000000003, crush: 0.58, preserveColor: 0.79 },
    });
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
    const getAutosaveRevisionFloor = backgroundStorageService
      .getAutosaveRevisionFloor as jest.Mock;
    getAutosaveRevisionFloor.mockResolvedValueOnce(5);
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
    expect(nextState.autosave.hasUnsavedChanges).toBe(false);
    const hydratedRevision = nextState.autosave.dirtyRevision;
    expect(hydratedRevision).toBeGreaterThanOrEqual(5);
    expect(nextState.autosave.savedRevision).toBe(hydratedRevision);
    useAppStore.getState().markAutosaveDirty('layer-change');
    expect(useAppStore.getState().autosave).toEqual(expect.objectContaining({
      dirtyRevision: hydratedRevision + 1,
      savedRevision: hydratedRevision,
      hasUnsavedChanges: true,
    }));
    expect(backgroundStorageService.updateSession).toHaveBeenLastCalledWith(
      'project-import',
      true,
      expect.objectContaining({
        dirtyRevision: hydratedRevision + 1,
        savedRevision: hydratedRevision,
      }),
    );
    expect(mockManager.cleanupOrphanedBrushes).toHaveBeenCalled();
    const cleanupArgs = mockManager.cleanupOrphanedBrushes.mock.calls[0]?.[0];
    expect(cleanupArgs instanceof Set ? cleanupArgs.size : null).toBe(0);
  });

  it('does not let a prepared import replace a newer project', async () => {
    const restoreColorCycleBrushes = jest.requireMock('@/utils/projectIO')
      .restoreColorCycleBrushes as jest.Mock;
    let releaseRestore: ((layers: Layer[]) => void) | undefined;
    restoreColorCycleBrushes.mockReturnValueOnce(new Promise((resolve) => {
      releaseRestore = resolve;
    }));
    const importLayers = [makeLayer('stale-import-layer')];
    const staleProject: Project = {
      id: 'stale-import-project',
      name: 'Stale Import',
      width: 64,
      height: 64,
      layers: importLayers,
      backgroundColor: '#000000',
      createdAt: new Date('2024-04-01'),
      updatedAt: new Date('2024-04-02'),
      customBrushes: [],
      exportLayout: createDefaultExportLayout(),
    };

    const importPromise = useAppStore.getState().importProject(staleProject, {
      fileName: 'stale-import.vs',
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    useAppStore.getState().newProject(32, 32, 'Newer Project');
    const newerProjectId = useAppStore.getState().project?.id;
    releaseRestore?.(importLayers);
    await importPromise;

    expect(useAppStore.getState().project?.id).toBe(newerProjectId);
    expect(useAppStore.getState().project?.name).toBe('Newer Project');
    expect(useAppStore.getState().projectFilename).toBeNull();
  });

  it('clears color-cycle runtime only after imported project layers restore', async () => {
    const restoreColorCycleBrushes = jest.requireMock('@/utils/projectIO').restoreColorCycleBrushes as jest.Mock;
    const colorCycleCanvas = document.createElement('canvas');
    colorCycleCanvas.width = 8;
    colorCycleCanvas.height = 8;
    const project: Project = {
      id: 'project-import-reused-cc-id',
      name: 'Imported Scene With Reused CC ID',
      width: 320,
      height: 180,
      layers: [makeLayer('layer-reused-cc', {
        imageData: null,
        layerType: 'color-cycle',
        colorCycleData: {
          mode: 'brush',
          isAnimating: false,
          canvas: colorCycleCanvas,
          canvasImageData: new ImageData(8, 8),
          canvasWidth: 8,
          canvasHeight: 8,
        },
      })],
      backgroundColor: '#101010',
      createdAt: new Date('2024-04-01'),
      updatedAt: new Date('2024-04-02'),
      customBrushes: [],
      defaultCustomBrushId: null,
      exportLayout: createDefaultExportLayout(),
      palette: {
        foregroundColor: '#ff00ff',
        backgroundColor: '#00ffff',
        activeSlot: 'foreground',
      },
      brushSpecificSettings: {},
    };

    mockManager.brushes.set('layer-reused-cc', mockBrush);

    await useAppStore.getState().importProject(project, { fileName: 'imported-cc.vessel' });

    expect(mockManager.cleanupAll).toHaveBeenCalledTimes(1);
    expect(restoreColorCycleBrushes).toHaveBeenCalled();
    expect(restoreColorCycleBrushes.mock.invocationCallOrder[0]).toBeLessThan(
      mockManager.cleanupAll.mock.invocationCallOrder[0],
    );
  });

  it('keeps existing color-cycle runtime when imported project restore fails', async () => {
    const restoreColorCycleBrushes = jest.requireMock('@/utils/projectIO').restoreColorCycleBrushes as jest.Mock;
    restoreColorCycleBrushes.mockRejectedValueOnce(new Error('corrupt color-cycle archive'));
    const existingLayer = makeLayer('existing-layer');
    useAppStore.setState({
      project: {
        id: 'existing-project',
        name: 'Existing Scene',
        width: 16,
        height: 16,
        layers: [existingLayer],
        backgroundColor: '#000',
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-02'),
        customBrushes: [],
        defaultCustomBrushId: null,
        exportLayout: createDefaultExportLayout(),
      },
      layers: [existingLayer],
      activeLayerId: existingLayer.id,
      selectedLayerIds: [existingLayer.id],
    });

    const colorCycleCanvas = document.createElement('canvas');
    colorCycleCanvas.width = 8;
    colorCycleCanvas.height = 8;
    const project: Project = {
      id: 'project-failed-import',
      name: 'Failed Import',
      width: 320,
      height: 180,
      layers: [makeLayer('layer-failed-import-cc', {
        imageData: null,
        layerType: 'color-cycle',
        colorCycleData: {
          mode: 'brush',
          isAnimating: false,
          canvas: colorCycleCanvas,
          canvasImageData: new ImageData(8, 8),
          canvasWidth: 8,
          canvasHeight: 8,
        },
      })],
      backgroundColor: '#101010',
      createdAt: new Date('2024-04-01'),
      updatedAt: new Date('2024-04-02'),
      customBrushes: [],
      defaultCustomBrushId: null,
      exportLayout: createDefaultExportLayout(),
      palette: {
        foregroundColor: '#ff00ff',
        backgroundColor: '#00ffff',
        activeSlot: 'foreground',
      },
      brushSpecificSettings: {},
    };

    await expect(useAppStore.getState().importProject(project, { fileName: 'bad-cc.vessel' }))
      .rejects.toThrow('corrupt color-cycle archive');

    expect(mockManager.cleanupAll).not.toHaveBeenCalled();
    expect(useAppStore.getState().project?.id).toBe('existing-project');
    expect(useAppStore.getState().layers).toEqual([existingLayer]);
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

  it('keeps imported color-cycle layers non-animating after load', async () => {
    useAppStore.getState().playColorCycle('toolbar');

    const colorCycleCanvas = document.createElement('canvas');
    colorCycleCanvas.width = 8;
    colorCycleCanvas.height = 8;

    const colorCycleLayer = makeLayer('layer-import-cc', {
      imageData: null,
      layerType: 'color-cycle',
      colorCycleData: {
        mode: 'brush',
        isAnimating: false,
        canvas: colorCycleCanvas,
        canvasImageData: new ImageData(8, 8),
        canvasWidth: 8,
        canvasHeight: 8,
      },
    });

    const project: Project = {
      id: 'project-import-cc',
      name: 'Imported CC Scene',
      width: 320,
      height: 180,
      layers: [colorCycleLayer],
      backgroundColor: '#101010',
      createdAt: new Date('2024-04-01'),
      updatedAt: new Date('2024-04-02'),
      customBrushes: [],
      defaultCustomBrushId: null,
      exportLayout: createDefaultExportLayout(),
      palette: {
        foregroundColor: '#ff00ff',
        backgroundColor: '#00ffff',
        activeSlot: 'foreground',
      },
      brushSpecificSettings: {},
    };

    await useAppStore.getState().importProject(project, { fileName: 'imported-cc.vessel' });

    const nextState = useAppStore.getState();
    expect(nextState.layers).toHaveLength(1);
    expect(nextState.layers[0].layerType).toBe('color-cycle');
    expect(nextState.layers[0].colorCycleData?.isAnimating).toBe(false);
    expect(nextState.colorCyclePlayback.desiredPlaying).toBe(false);
  });

  it('keeps heavy CC layers cold when import lacks canonical paint', async () => {
    const actualProjectIO = jest.requireActual('@/utils/projectIO') as typeof import('@/utils/projectIO');
    const restoreColorCycleBrushesMock = jest.requireMock('@/utils/projectIO').restoreColorCycleBrushes as jest.Mock;
    restoreColorCycleBrushesMock.mockImplementation(actualProjectIO.restoreColorCycleBrushes);

    const payloadSize = 2048 * 2048;
    const makeHeavyColorCycleLayer = (id: string, visible: boolean): Layer => makeLayer(id, {
      imageData: null,
      visible,
      layerType: 'color-cycle',
      colorCycleData: attachLegacyColorCycleTopLevelBuffers({
        mode: 'brush',
        isAnimating: false,
        canvas: Object.assign(document.createElement('canvas'), { width: 1, height: 1 }),
        canvasImageData: new ImageData(8, 8),
        canvasWidth: 2048,
        canvasHeight: 2048,
        brushState: {
          cycleSpeed: 0.3,
          fps: 12,
          layers: [{
            layerId: id,
            strokeData: {
              hasContent: true,
              strokeCounter: 1,
              flowBuffer: Buffer.alloc(payloadSize).toString('base64'),
            },
          }],
        },
      }, {
        gradientIdBuffer: new Uint8Array(payloadSize).buffer,
      }),
    });

    const project: Project = {
      id: 'project-import-heavy-cc',
      name: 'Imported Heavy CC Scene',
      width: 320,
      height: 180,
      layers: [
        makeHeavyColorCycleLayer('layer-import-active-cc', true),
        makeHeavyColorCycleLayer('layer-import-visible-cold-cc', true),
        makeHeavyColorCycleLayer('layer-import-hidden-cold-cc', false),
      ],
      backgroundColor: '#101010',
      createdAt: new Date('2024-04-01'),
      updatedAt: new Date('2024-04-02'),
      customBrushes: [],
      defaultCustomBrushId: null,
      exportLayout: createDefaultExportLayout(),
      palette: {
        foregroundColor: '#ff00ff',
        backgroundColor: '#00ffff',
        activeSlot: 'foreground',
      },
      brushSpecificSettings: {},
    };

    try {
      await useAppStore.getState().importProject(project, { fileName: 'imported-heavy-cc.vessel' });

      const nextState = useAppStore.getState();
      expect(nextState.activeLayerId).toBe('layer-import-active-cc');

      const activeLayer = nextState.layers.find((layer) => layer.id === 'layer-import-active-cc');
      const visibleColdLayer = nextState.layers.find((layer) => layer.id === 'layer-import-visible-cold-cc');
      const hiddenColdLayer = nextState.layers.find((layer) => layer.id === 'layer-import-hidden-cold-cc');

      expect(activeLayer?.colorCycleData?.runtimeHydrationState).toBe('cold');
      expect(activeLayer?.colorCycleData?.deferredRuntimeRestore).toBe(false);
      expect(activeLayer?.colorCycleData?.colorCycleBrush).toBeUndefined();
      expect(activeLayer?.colorCycleData?.repairStatus).toEqual(expect.objectContaining({
        ok: false,
        reason: 'missing-paint-buffer',
      }));

      expect(visibleColdLayer?.colorCycleData?.runtimeHydrationState).toBe('cold');
      expect(visibleColdLayer?.colorCycleData?.deferredRuntimeRestore).toBe(true);
      expect(visibleColdLayer?.colorCycleData?.colorCycleBrush).toBeUndefined();

      expect(hiddenColdLayer?.colorCycleData?.runtimeHydrationState).toBe('cold');
      expect(hiddenColdLayer?.colorCycleData?.deferredRuntimeRestore).toBe(true);
      expect(hiddenColdLayer?.colorCycleData?.colorCycleBrush).toBeUndefined();
    } finally {
      restoreColorCycleBrushesMock.mockImplementation(async (layers: Layer[]) => layers);
      useAppStore.setState({
        layers: [],
        activeLayerId: null,
        selectedLayerIds: [],
      });
    }
  });

  it('imports a real zipped CC project payload without flattening restored brush state', async () => {
    const actualProjectIO = jest.requireActual('@/utils/projectIO') as typeof import('@/utils/projectIO');
    const contextProto = (globalThis as unknown as {
      CanvasRenderingContext2D?: { prototype?: { rect?: (...args: number[]) => void } };
    }).CanvasRenderingContext2D?.prototype;
    const originalRect = contextProto?.rect;
    const originalOffscreenCanvas = (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas;
    if (contextProto && typeof contextProto.rect !== 'function') {
      contextProto.rect = () => {};
    }
    (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = class {
      width: number;
      height: number;

      constructor(nextWidth: number, nextHeight: number) {
        this.width = nextWidth;
        this.height = nextHeight;
      }

      getContext() {
        return {
          drawImage: jest.fn(),
          getImageData: jest.fn(() => new ImageData(this.width, this.height)),
          clearRect: jest.fn(),
          putImageData: jest.fn(),
        };
      }
    };
    const base64ToArrayBuffer = (base64: string | undefined): ArrayBuffer => {
      if (!base64) {
        return new ArrayBuffer(0);
      }
      const bytes = Uint8Array.from(Buffer.from(base64, 'base64'));
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    };

    const width = 8;
    const height = 8;
    const paint = new Uint8Array(width * height);
    const gradientId = new Uint8Array(width * height);
    const speed = new Uint8Array(width * height);
    const flow = new Uint8Array(width * height);
    const phase = new Uint8Array(width * height);
    const gradientDefIds = new Uint16Array(width * height);
    paint[0] = 1;
    paint[9] = 2;
    gradientId[0] = 7;
    gradientId[9] = 3;
    speed[0] = 5;
    flow[0] = 4;
    phase[0] = 2;
    gradientDefIds[0] = 12;

    const colorCycleCanvas = document.createElement('canvas');
    colorCycleCanvas.width = width;
    colorCycleCanvas.height = height;

    try {
      const zip = new JSZip();
      zip.file('project.json', JSON.stringify({
        version: '1.1.0',
        metadata: {
          name: 'Real Zipped CC',
          created: '2024-04-01T00:00:00.000Z',
          modified: '2024-04-02T00:00:00.000Z',
          appVersion: '1.0.0',
        },
        project: {
          id: 'project-real-zipped-cc',
          name: 'Real Zipped CC',
          width,
          height,
          backgroundColor: '#101010',
          layers: [{
            id: 'layer-real-zipped-cc',
            name: 'Layer layer-real-zipped-cc',
            visible: true,
            opacity: 1,
            blendMode: 'source-over',
            locked: false,
            transparencyLocked: false,
            order: 0,
            imageDataUrl: '',
            alignment: createDefaultLayerAlignment(),
            layerType: 'color-cycle',
            colorCycleData: {
              canvasImageData: '',
              canvasWidth: width,
              canvasHeight: height,
              mode: 'brush',
              gradient: [
                { position: 0, color: '#000000' },
                { position: 1, color: '#ffffff' },
              ],
              brushState: {
                cycleSpeed: 0.4,
                fps: 24,
                brushSize: 6,
                layers: [{
                  layerId: 'layer-real-zipped-cc',
                  strokeData: {
                    paintBuffer: Buffer.from(paint).toString('base64'),
                    gradientIdBuffer: Buffer.from(gradientId).toString('base64'),
                    gradientDefIdBuffer: Buffer.from(gradientDefIds.buffer).toString('base64'),
                    speedBuffer: Buffer.from(speed).toString('base64'),
                    flowBuffer: Buffer.from(flow).toString('base64'),
                    phaseBuffer: Buffer.from(phase).toString('base64'),
                    hasContent: true,
                    strokeCounter: 3,
                  },
                }],
              },
            },
          }],
          customBrushes: [],
          defaultCustomBrushId: null,
          exportLayout: createDefaultExportLayout(),
          palette: {
            foregroundColor: '#ff00ff',
            backgroundColor: '#00ffff',
            activeSlot: 'foreground',
          },
          brushSpecificSettings: {},
          globalBrushSize: 1,
        },
      }));
      const payload = await zip.generateAsync({ type: 'uint8array' });
      const hydratedProject = await actualProjectIO.deserializeProject(payload);
      const hydratedLayer = hydratedProject.layers[0];
      const persistedBrushState = hydratedLayer?.colorCycleData?.brushState as
        | {
            layers?: Array<{
              strokeData?: {
                paintBuffer?: string;
                gradientIdBuffer?: string;
                gradientDefIdBuffer?: string;
              };
            }>;
          }
        | undefined;
      const persistedSnapshot = persistedBrushState?.layers?.[0];
      const canonicalGradientIdBuffer = getColorCycleLegacyLayerBuffer(
        hydratedLayer?.colorCycleData,
        'gradientIdBuffer',
      );
      const canonicalGradientDefIdBuffer = getColorCycleLegacyLayerBuffer(
        hydratedLayer?.colorCycleData,
        'gradientDefIdBuffer',
      );

      if (hydratedLayer?.colorCycleData) {
        hydratedLayer.colorCycleData.colorCycleBrush = {
          getLayerSnapshot: () => ({
            paintBuffer: base64ToArrayBuffer(persistedSnapshot?.strokeData?.paintBuffer),
            gradientIdBuffer: persistedSnapshot?.strokeData?.gradientIdBuffer
              ? base64ToArrayBuffer(persistedSnapshot.strokeData.gradientIdBuffer)
              : canonicalGradientIdBuffer instanceof ArrayBuffer
                ? canonicalGradientIdBuffer.slice(0)
                : new ArrayBuffer(0),
            gradientDefIdBuffer: persistedSnapshot?.strokeData?.gradientDefIdBuffer
              ? base64ToArrayBuffer(persistedSnapshot.strokeData.gradientDefIdBuffer)
              : canonicalGradientDefIdBuffer instanceof ArrayBuffer
                ? canonicalGradientDefIdBuffer.slice(0)
                : new ArrayBuffer(0),
          }),
        } as unknown as NonNullable<Layer['colorCycleData']>['colorCycleBrush'];
      }

      await useAppStore.getState().importProject(hydratedProject, { fileName: 'real-zipped-cc.vessel' });

      const nextState = useAppStore.getState();
      const importedLayer = nextState.layers[0];
      const importedBrush = importedLayer?.colorCycleData?.colorCycleBrush as
        | {
            getLayerSnapshot?: (layerId: string) => {
              paintBuffer: ArrayBuffer;
              gradientIdBuffer?: ArrayBuffer;
              gradientDefIdBuffer?: ArrayBuffer;
            } | null;
          }
        | undefined;
      const snapshot = readTestColorCycleBrushLayerSnapshot(importedBrush, importedLayer.id);

      expect(nextState.projectFilename).toBe('real-zipped-cc.vessel');
      expect(importedLayer?.layerType).toBe('color-cycle');
      expect(importedLayer?.colorCycleData?.colorCycleBrush).toBeTruthy();
      expect(mockManager.brushes.get(importedLayer.id)).toBe(importedLayer.colorCycleData?.colorCycleBrush);
      expect(snapshot).toBeTruthy();
      expect(Array.from(new Uint8Array(snapshot?.paintBuffer ?? new ArrayBuffer(0)))).toEqual(Array.from(paint));
      expect(Array.from(new Uint8Array(snapshot?.gradientIdBuffer ?? new ArrayBuffer(0)))).toEqual(Array.from(gradientId));
      expect(Array.from(new Uint16Array(snapshot?.gradientDefIdBuffer ?? new ArrayBuffer(0)))).toEqual(Array.from(gradientDefIds));
    } finally {
      if (contextProto) {
        contextProto.rect = originalRect;
      }
      (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = originalOffscreenCanvas;
    }
  }, 10000);

  it('imports sequential layers and preserves sequential capture payload', async () => {
    const sequentialLayer = makeLayer('layer-seq', {
      imageData: null,
      layerType: 'sequential',
      sequentialData: {
        frameCount: 16,
        fps: 8,
        durationMs: 2000,
        events: [
          {
            id: 'seq-event-1',
            layerId: 'layer-seq',
            strokeId: 'stroke-1',
            timestampMs: 120,
            frameIndex: 3,
            brush: {
              tool: 'brush',
              brushShape: BrushShape.ROUND,
              size: 6,
              opacity: 0.75,
              blendMode: 'source-over',
              rotation: 0.1,
              spacing: 1.5,
              color: '#00ff00',
              customStampId: null,
            },
            stamps: [{ x: 4, y: 5, pressure: 1, rotation: 0, size: 6, alpha: 0.75 }],
          },
        ],
      },
    });

    const project: Project = {
      id: 'project-seq-import',
      name: 'Sequential Import',
      width: 320,
      height: 180,
      layers: [sequentialLayer],
      backgroundColor: '#101010',
      createdAt: new Date('2024-04-01'),
      updatedAt: new Date('2024-04-02'),
      customBrushes: [],
      exportLayout: createDefaultExportLayout(),
      palette: {
        foregroundColor: '#111111',
        backgroundColor: '#eeeeee',
        activeSlot: 'foreground',
      },
      brushSpecificSettings: {},
    };

    await useAppStore.getState().importProject(project, { fileName: 'sequential.vessel' });

    const nextState = useAppStore.getState();
    expect(nextState.layers).toHaveLength(1);
    expect(nextState.layers[0].layerType).toBe('sequential');
    expect(nextState.layers[0].sequentialData).toEqual(sequentialLayer.sequentialData);
    expect(nextState.activeLayerId).toBe('layer-seq');
    expect(nextState.projectFilename).toBe('sequential.vessel');
  });

  it('warns and repairs duplicate layer ids during import', async () => {
    const notifySpy = useAppStore.getState().addNotification as jest.Mock;
    notifySpy.mockClear();
    const duplicateId = 'layer-dup';
    const project: Project = {
      id: 'project-duplicate-layer-ids',
      name: 'Duplicate IDs',
      width: 320,
      height: 180,
      layers: [
        makeLayer(duplicateId, { order: 0 }),
        makeLayer(duplicateId, { order: 1 }),
      ],
      backgroundColor: '#101010',
      createdAt: new Date('2024-04-01'),
      updatedAt: new Date('2024-04-02'),
      customBrushes: [],
      exportLayout: createDefaultExportLayout(),
      palette: {
        foregroundColor: '#111111',
        backgroundColor: '#eeeeee',
        activeSlot: 'foreground',
      },
      brushSpecificSettings: {},
    };

    await useAppStore.getState().importProject(project, { fileName: 'duplicate-ids.vessel' });

    const nextState = useAppStore.getState();
    const ids = nextState.layers.map((layer) => layer.id);
    expect(ids).toEqual([duplicateId, `${duplicateId}-1`]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(nextState.activeLayerId).toBe(duplicateId);
    expect(nextState.selectedLayerIds).toEqual([duplicateId]);
    expect(notifySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'warning',
        title: 'Layer IDs Repaired',
      }),
    );
  });

  it('marks autosave dirty and warns when load applies semantic repairs', async () => {
    const notifySpy = useAppStore.getState().addNotification as jest.Mock;
    notifySpy.mockClear();

    const loadProjectFromFile = jest.requireMock('@/utils/projectIO').loadProjectFromFile as jest.Mock;
    loadProjectFromFile.mockResolvedValue({
      project: {
        id: 'loaded-repaired-project',
        name: 'Loaded Repaired',
        width: 16,
        height: 16,
        layers: [makeLayer('loaded-layer')],
        backgroundColor: '#000',
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-02'),
        customBrushes: [],
        defaultCustomBrushId: null,
        exportLayout: createDefaultExportLayout(),
        palette: {
          foregroundColor: '#ffffff',
          backgroundColor: '#000000',
          activeSlot: 'foreground',
        },
      },
      migration: {
        repairs: [{
          layerId: 'loaded-layer',
          code: 'legacy-repair',
          message: 'Promoted legacy data to canonical state',
          semantic: true,
        }],
        shouldMarkDirty: true,
      },
      fileName: 'loaded-repaired.vessel',
      fileHandle: null,
    });

    await useAppStore.getState().loadProject();

    expect(useAppStore.getState().autosave.hasUnsavedChanges).toBe(true);
    expect(useAppStore.getState().autosave.lastDirtyReason).toBe('manual');
    expect(notifySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'warning',
        title: 'Project Repaired On Load',
      }),
    );
  });

  it('does not reattach the source file handle when load repairs legacy data', async () => {
    const notifySpy = useAppStore.getState().addNotification as jest.Mock;
    notifySpy.mockClear();
    const repairedHandle = { name: 'loaded-repaired.vessel' } as FileSystemFileHandle;
    const { loadProjectFromFile } = jest.requireMock('@/utils/projectIO') as {
      loadProjectFromFile: jest.Mock;
    };

    loadProjectFromFile.mockResolvedValueOnce({
      project: {
        id: 'loaded-project-repaired-handle',
        name: 'Loaded Project',
        width: 8,
        height: 8,
        backgroundColor: '#000000',
        layers: [makeLayer('loaded-layer')],
        customBrushes: [],
        defaultCustomBrushId: null,
        exportLayout: createDefaultExportLayout(),
        palette: {
          foregroundColor: '#ffffff',
          backgroundColor: '#000000',
          activeSlot: 'foreground',
        },
      },
      migration: {
        repairs: [{
          layerId: 'loaded-layer',
          code: 'legacy-repair',
          message: 'Promoted legacy data to canonical state',
          semantic: true,
        }],
        shouldMarkDirty: true,
      },
      fileName: 'loaded-repaired.vessel',
      fileHandle: repairedHandle,
    });

    await useAppStore.getState().loadProject();

    const nextState = useAppStore.getState();
    expect(nextState.projectFilename).toBe('loaded-repaired.vessel');
    expect(nextState.projectFileHandle).toBeNull();
    expect(nextState.autosave.fileBackup.fileHandle).toBeNull();
    expect(nextState.autosave.fileBackup.backupPath).toBeNull();
    expect(nextState.autosave.fileBackup.enabled).toBe(false);
    expect(fileBackupService.setFileHandle).not.toHaveBeenCalledWith(repairedHandle);
    expect(fileBackupService.ensureFileWritePermission).not.toHaveBeenCalledWith(repairedHandle);
    expect(notifySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'warning',
        title: 'Project Repaired On Load',
      }),
    );
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

  it('creates a clean default sequential layer when starting a new project', async () => {
    useAppStore.getState().markAutosaveDirty('manual');
    const previousRevision = useAppStore.getState().autosave.dirtyRevision;
    useAppStore.getState().newProject(256, 128, 'New With Seq');
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    const nextState = useAppStore.getState();
    const sequentialLayers = nextState.layers.filter((layer) => layer.layerType === 'sequential');

    expect(nextState.project?.name).toBe('New With Seq');
    expect(sequentialLayers).toHaveLength(1);
    expect(sequentialLayers[0].name).toBe('Animation 1');
    expect(sequentialLayers[0].sequentialData).toEqual({
      frameCount: 12,
      fps: 12,
      durationMs: 1000,
      events: [],
    });
    expect(nextState.autosave.hasUnsavedChanges).toBe(false);
    expect(nextState.autosave.dirtyRevision).toBe(nextState.autosave.savedRevision);
    expect(nextState.autosave.dirtyRevision).toBeGreaterThan(previousRevision);
  });

  it('does not clear a user edit made before deferred new-project initialization', async () => {
    useAppStore.getState().newProject(256, 128, 'New With Early Edit');
    useAppStore.getState().markAutosaveDirty('layer-change');

    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    const autosave = useAppStore.getState().autosave;
    expect(autosave).toEqual(expect.objectContaining({
      hasUnsavedChanges: true,
      lastDirtyReason: 'layer-change',
    }));
    expect(autosave.dirtyRevision).toBeGreaterThan(autosave.savedRevision);
  });

  it('preserves persisted recovery metadata for the automatic startup placeholder', async () => {
    const resetSession = backgroundStorageService.resetSession as jest.Mock;
    const updateSession = backgroundStorageService.updateSession as jest.Mock;
    resetSession.mockClear();
    updateSession.mockClear();

    useAppStore.getState().newProject(
      256,
      128,
      'Startup Placeholder',
      { preserveRecoverySession: true },
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    const autosave = useAppStore.getState().autosave;
    expect(autosave.hasUnsavedChanges).toBe(false);
    expect(autosave.dirtyRevision).toBe(autosave.savedRevision);
    expect(resetSession).not.toHaveBeenCalled();
    expect(updateSession).not.toHaveBeenCalled();
  });
});
