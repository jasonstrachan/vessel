import { backgroundStorageService } from '@/utils/backgroundStorage';
import { deserializeProject, serializeProject } from '@/utils/projectIO';
import type { Layer, Project } from '@/types';

jest.mock('@/utils/projectIO', () => ({
  __esModule: true,
  serializeProject: jest.fn(),
  deserializeProject: jest.fn(),
}));

type StoredAutosaveRecord = Record<string, unknown> | undefined;
type StoredSessionRecord = Record<string, unknown> | undefined;

const baseProject: Project = {
  id: 'project-1',
  name: 'Archive Project',
  width: 16,
  height: 16,
  backgroundColor: '#000000',
  layers: [],
  customBrushes: [],
  createdAt: new Date('2025-01-01T00:00:00.000Z'),
  updatedAt: new Date('2025-01-02T00:00:00.000Z'),
};

const baseLayer: Layer = {
  id: 'layer-1',
  name: 'Layer 1',
  visible: true,
  opacity: 1,
  blendMode: 'source-over',
  locked: false,
  transparencyLocked: false,
  order: 0,
  imageData: new ImageData(2, 2),
  framebuffer: document.createElement('canvas'),
  alignment: {
    horizontal: 'left',
    vertical: 'top',
    positioning: 'anchor',
    offsetPercent: { x: 0, y: 0 },
    offsetPx: { x: 0, y: 0 },
    fit: 'none',
  },
  layerType: 'normal',
};

const createDbStub = (
  initialProjectRecord?: StoredAutosaveRecord,
  initialSessionRecord?: StoredSessionRecord
) => {
  let storedProjectRecord = initialProjectRecord;
  let storedSessionRecord = initialSessionRecord;

  return {
    db: {
      transaction: jest.fn(() => ({
        objectStore: jest.fn((storeName: string) => ({
          put: jest.fn((record: StoredAutosaveRecord | StoredSessionRecord) => {
            if (storeName === 'projects') {
              storedProjectRecord = record as StoredAutosaveRecord;
            } else {
              storedSessionRecord = record as StoredSessionRecord;
            }
            const request: {
              error?: unknown;
              onsuccess: null | (() => void);
              onerror: null | (() => void);
            } = {
              onsuccess: null,
              onerror: null,
            };
            queueMicrotask(() => request.onsuccess?.());
            return request;
          }),
          get: jest.fn(() => {
            const request: {
              result?: StoredAutosaveRecord | StoredSessionRecord;
              error?: unknown;
              onsuccess: null | (() => void);
              onerror: null | (() => void);
            } = {
              result: storeName === 'projects' ? storedProjectRecord : storedSessionRecord,
              onsuccess: null,
              onerror: null,
            };
            queueMicrotask(() => request.onsuccess?.());
            return request;
          }),
        })),
      })),
    },
    getStoredProjectRecord: () => storedProjectRecord,
    getStoredSessionRecord: () => storedSessionRecord,
  };
};

describe('BackgroundStorageService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('persists autosaves as serialized project archives', async () => {
    const dbStub = createDbStub();
    const serializedProject = new Uint8Array([1, 2, 3, 4]);
    (serializeProject as jest.Mock).mockResolvedValue(serializedProject);
    (backgroundStorageService as unknown as { ensureDb: () => Promise<unknown> }).ensureDb =
      jest.fn().mockResolvedValue(dbStub.db);

    await backgroundStorageService.saveProjectInBackground(baseProject, [baseLayer]);

    expect(serializeProject).toHaveBeenCalledWith(baseProject, [
      expect.objectContaining({
        id: baseLayer.id,
        layerType: baseLayer.layerType,
      }),
    ]);
    expect(dbStub.getStoredProjectRecord()).toEqual(
      expect.objectContaining({
        projectId: baseProject.id,
        format: 'archive',
        serializedProject,
      })
    );
    expect(dbStub.getStoredProjectRecord()).not.toEqual(expect.objectContaining({
      projectData: expect.anything(),
      layerData: expect.anything(),
    }));
    expect(dbStub.getStoredSessionRecord()).toEqual(expect.objectContaining({
      lastProjectId: baseProject.id,
    }));
  });

  it('passes live color-cycle runtime state to the archive serializer before IndexedDB storage', async () => {
    const dbStub = createDbStub();
    const serializedProject = new Uint8Array([5, 6, 7, 8]);
    const canvas = document.createElement('canvas');
    const brush = { getFullState: jest.fn() };
    const colorCycleLayer: Layer = {
      ...baseLayer,
      id: 'layer-cc-autosave-live',
      layerType: 'color-cycle',
      colorCycleData: {
        canvas,
        colorCycleBrush: brush as unknown as NonNullable<Layer['colorCycleData']>['colorCycleBrush'],
        canvasImageData: new ImageData(2, 2),
        canvasWidth: 2,
        canvasHeight: 2,
        mode: 'brush',
      },
    };
    (serializeProject as jest.Mock).mockResolvedValue(serializedProject);
    (backgroundStorageService as unknown as { ensureDb: () => Promise<unknown> }).ensureDb =
      jest.fn().mockResolvedValue(dbStub.db);

    await backgroundStorageService.saveProjectInBackground(baseProject, [colorCycleLayer]);

    expect(serializeProject).toHaveBeenCalledWith(baseProject, [colorCycleLayer]);
  });

  it('restores archive-backed autosaves through deserializeProject', async () => {
    const serializedProject = new Uint8Array([7, 8, 9]);
    const restoredProject = {
      ...baseProject,
      layers: [baseLayer],
    };
    const dbStub = createDbStub({
      projectId: baseProject.id,
      format: 'archive',
      serializedProject,
      timestamp: Date.now(),
      isDirty: false,
    });
    (deserializeProject as jest.Mock).mockResolvedValue(restoredProject);
    (backgroundStorageService as unknown as { ensureDb: () => Promise<unknown> }).ensureDb =
      jest.fn().mockResolvedValue(dbStub.db);

    const result = await backgroundStorageService.getAutosavedProject(baseProject.id);

    expect(deserializeProject).toHaveBeenCalledWith(serializedProject);
    expect(result).toEqual({
      project: restoredProject,
      layers: restoredProject.layers,
    });
  });

  it('keeps reading legacy raw autosave records for backward compatibility', async () => {
    const legacyProject = {
      ...baseProject,
      palette: {
        foregroundColor: '#ffffff',
        backgroundColor: '#000000',
        activeSlot: 'foreground' as const,
      },
      referenceLayerId: null,
    };
    const dbStub = createDbStub({
      projectId: legacyProject.id,
      projectData: legacyProject,
      layerData: [
        {
          ...baseLayer,
          framebuffer: undefined,
        },
      ],
      timestamp: Date.now(),
      isDirty: false,
    });
    (backgroundStorageService as unknown as { ensureDb: () => Promise<unknown> }).ensureDb =
      jest.fn().mockResolvedValue(dbStub.db);

    const result = await backgroundStorageService.getAutosavedProject(legacyProject.id);

    expect(deserializeProject).not.toHaveBeenCalled();
    expect(result?.project).toEqual(legacyProject);
    expect(result?.layers[0]).toEqual(expect.objectContaining({
      id: baseLayer.id,
      framebuffer: expect.anything(),
    }));
  });
});
