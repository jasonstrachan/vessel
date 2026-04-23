import { CrashRecoveryService } from '../crashRecovery';
import { backgroundStorageService } from '../backgroundStorage';
import { restoreColorCycleBrushes } from '../projectIO';
import { useAppStore } from '@/stores/useAppStore';
import type { Layer, Project } from '@/types';

jest.mock('../backgroundStorage', () => ({
  __esModule: true,
  backgroundStorageService: {
    hasUnsavedWork: jest.fn(),
    getLastAutosavedProjectId: jest.fn(),
    getAutosavedProject: jest.fn(),
    clearAutosave: jest.fn(),
    cleanupOldAutosaves: jest.fn(),
  },
}));

jest.mock('../projectIO', () => ({
  __esModule: true,
  restoreColorCycleBrushes: jest.fn(async (layers) => layers),
}));

jest.mock('@/stores/useAppStore', () => ({
  useAppStore: {
    getState: jest.fn(),
    setState: jest.fn(),
  },
}));

describe('CrashRecoveryService', () => {
  const setProject = jest.fn();
  const setLayers = jest.fn();
  const setActiveLayer = jest.fn();
  const setSelectedLayerIds = jest.fn();
  const setCanvasDimensions = jest.fn();
  const setLayersNeedRecomposition = jest.fn();
  const clearDirtyState = jest.fn();
  const clearHistory = jest.fn();
  const addNotification = jest.fn();

  const baseProject: Project = {
    id: 'project-1',
    name: 'Recovered',
    width: 16,
    height: 16,
    backgroundColor: '#000000',
    layers: [],
    customBrushes: [],
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
    updatedAt: new Date('2025-01-01T00:00:00.000Z'),
  };

  const baseLayers: Layer[] = [{
    id: 'cc-layer-1',
    name: 'CC',
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    locked: false,
    transparencyLocked: false,
    order: 0,
    imageData: null,
    framebuffer: document.createElement('canvas'),
    alignment: {
      horizontal: 'left',
      vertical: 'top',
      positioning: 'anchor',
      offsetPercent: { x: 0, y: 0 },
      offsetPx: { x: 0, y: 0 },
      fit: 'none',
    },
    layerType: 'color-cycle',
    version: 1,
    colorCycleData: {
      canvas: document.createElement('canvas'),
      isAnimating: false,
    },
  }];

  beforeEach(() => {
    jest.clearAllMocks();
    let currentLayers: Layer[] = [];
    setLayers.mockImplementation((layers: Layer[]) => {
      currentLayers = layers;
    });
    (useAppStore.getState as jest.Mock).mockImplementation(() => ({
      setProject,
      setLayers,
      setActiveLayer,
      setSelectedLayerIds,
      setCanvasDimensions,
      setLayersNeedRecomposition,
      clearDirtyState,
      clearHistory,
      addNotification,
      layers: currentLayers,
    }));
  });

  it('rehydrates color-cycle layers through restoreColorCycleBrushes before applying recovery', async () => {
    const service = new CrashRecoveryService();
    const restoredLayers = [{ ...baseLayers[0], id: 'restored-cc-layer' }];
    (restoreColorCycleBrushes as jest.Mock).mockResolvedValue(restoredLayers);

    await service.recoverProject({
      project: baseProject,
      layers: baseLayers,
      lastSaveTime: Date.now(),
    });

    expect(restoreColorCycleBrushes).toHaveBeenCalledWith(baseLayers);
    expect(setLayers).toHaveBeenCalledWith(restoredLayers);
  });

  it('checks background storage for the last autosaved project', async () => {
    const service = new CrashRecoveryService();
    (backgroundStorageService.hasUnsavedWork as jest.Mock).mockResolvedValue(true);
    (backgroundStorageService.getLastAutosavedProjectId as jest.Mock).mockResolvedValue('project-1');
    (backgroundStorageService.getAutosavedProject as jest.Mock).mockResolvedValue({
      project: baseProject,
      layers: baseLayers,
    });

    const result = await service.checkForUnsavedWork();

    expect(result?.project).toEqual(baseProject);
    expect(result?.layers).toEqual(baseLayers);
  });

  it('uses archive-backed autosave payloads returned by background storage during recovery checks', async () => {
    const service = new CrashRecoveryService();
    const archiveBackedProject = {
      ...baseProject,
      updatedAt: new Date('2025-01-03T04:05:06.000Z'),
      layers: baseLayers,
    };
    (backgroundStorageService.hasUnsavedWork as jest.Mock).mockResolvedValue(true);
    (backgroundStorageService.getLastAutosavedProjectId as jest.Mock).mockResolvedValue('project-1');
    (backgroundStorageService.getAutosavedProject as jest.Mock).mockResolvedValue({
      project: archiveBackedProject,
      layers: archiveBackedProject.layers,
    });

    const result = await service.checkForUnsavedWork();

    expect(backgroundStorageService.getAutosavedProject).toHaveBeenCalledWith('project-1');
    expect(result).toEqual({
      project: archiveBackedProject,
      layers: archiveBackedProject.layers,
      lastSaveTime: archiveBackedProject.updatedAt.getTime(),
    });
  });
});
