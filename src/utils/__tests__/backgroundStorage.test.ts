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
  initialSessionRecord?: StoredSessionRecord,
  options: {
    finish?: 'complete' | 'abort' | 'error';
    failPutStore?: 'projects' | 'session';
    failure?: DOMException;
  } = {},
) => {
  let storedProjectRecord = initialProjectRecord;
  let storedSessionRecord = initialSessionRecord;
  const transactions: Array<{ storeNames: string[]; mode: IDBTransactionMode }> = [];

  return {
    db: {
      transaction: jest.fn((storeNames: string | string[], mode: IDBTransactionMode) => {
        const names = Array.isArray(storeNames) ? storeNames : [storeNames];
        transactions.push({ storeNames: names, mode });
        let pendingProjectRecord = storedProjectRecord;
        let pendingSessionRecord = storedSessionRecord;
        let finishScheduled = false;
        let finished = false;
        const failure = options.failure ?? new DOMException('Transaction failed', 'AbortError');
        const transaction: {
          error: DOMException | null;
          onabort: null | (() => void);
          oncomplete: null | (() => void);
          onerror: null | (() => void);
          abort: jest.Mock;
          objectStore: jest.Mock;
        } = {
          error: null,
          onabort: null,
          oncomplete: null,
          onerror: null,
          abort: jest.fn(),
          objectStore: jest.fn(),
        };
        const finish = (): void => {
          if (finished) return;
          finished = true;
          if (options.finish === 'abort') {
            transaction.error = failure;
            transaction.onabort?.();
            return;
          }
          if (options.finish === 'error') {
            transaction.error = failure;
            transaction.onerror?.();
            transaction.onabort?.();
            return;
          }
          storedProjectRecord = pendingProjectRecord;
          storedSessionRecord = pendingSessionRecord;
          transaction.oncomplete?.();
        };
        const scheduleFinish = (): void => {
          if (finishScheduled) return;
          finishScheduled = true;
          setTimeout(finish, 0);
        };
        transaction.abort.mockImplementation(() => {
          if (finished) return;
          finished = true;
          transaction.error = failure;
          transaction.onabort?.();
        });
        transaction.objectStore.mockImplementation((storeName: string) => ({
          put: jest.fn((record: StoredAutosaveRecord | StoredSessionRecord) => {
            const request: {
              error: DOMException | null;
              onsuccess: null | (() => void);
              onerror: null | (() => void);
            } = {
              error: null,
              onsuccess: null,
              onerror: null,
            };
            queueMicrotask(() => {
              if (options.failPutStore === storeName) {
                request.error = failure;
                request.onerror?.();
                transaction.error = failure;
                transaction.onabort?.();
                finished = true;
                return;
              }
              if (storeName === 'projects') {
                pendingProjectRecord = record as StoredAutosaveRecord;
              } else {
                pendingSessionRecord = record as StoredSessionRecord;
              }
              request.onsuccess?.();
              scheduleFinish();
            });
            return request;
          }),
          get: jest.fn(() => {
            const request: {
              result?: StoredAutosaveRecord | StoredSessionRecord;
              error: DOMException | null;
              onsuccess: null | (() => void);
              onerror: null | (() => void);
            } = {
              result: storeName === 'projects' ? pendingProjectRecord : pendingSessionRecord,
              error: null,
              onsuccess: null,
              onerror: null,
            };
            queueMicrotask(() => {
              request.onsuccess?.();
              scheduleFinish();
            });
            return request;
          }),
        }));
        return transaction;
      }),
    },
    getStoredProjectRecord: () => storedProjectRecord,
    getStoredSessionRecord: () => storedSessionRecord,
    getTransactions: () => transactions,
  };
};

describe('BackgroundStorageService', () => {
  const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    consoleErrorSpy.mockRestore();
  });

  it('persists autosaves as serialized project archives', async () => {
    const dbStub = createDbStub();
    const serializedProject = new Uint8Array([1, 2, 3, 4]);
    (serializeProject as jest.Mock).mockResolvedValue(serializedProject);
    (backgroundStorageService as unknown as { ensureDb: () => Promise<unknown> }).ensureDb =
      jest.fn().mockResolvedValue(dbStub.db);

    const capture = await backgroundStorageService.createAutosaveCapture(
      baseProject,
      [baseLayer],
      3,
    );
    await backgroundStorageService.saveProjectInBackground(capture);

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
        dirtyRevision: 3,
        savedRevision: 3,
      })
    );
    expect(dbStub.getStoredProjectRecord()).not.toEqual(expect.objectContaining({
      projectData: expect.anything(),
      layerData: expect.anything(),
    }));
    expect(dbStub.getStoredSessionRecord()).toEqual(expect.objectContaining({
      lastProjectId: baseProject.id,
      lastSaveTime: capture.timestamp,
      dirtyRevision: 3,
      savedRevision: 3,
      hasUnsavedChanges: false,
    }));
    expect(dbStub.getTransactions()).toContainEqual({
      storeNames: ['projects', 'session'],
      mode: 'readwrite',
    });
  });

  it('rejects when the IndexedDB transaction aborts after the project request succeeds', async () => {
    const abortError = new DOMException('Quota exceeded', 'QuotaExceededError');
    const dbStub = createDbStub(undefined, undefined, {
      finish: 'abort',
      failure: abortError,
    });
    (serializeProject as jest.Mock).mockResolvedValue(new Uint8Array([9, 8, 7]));
    (backgroundStorageService as unknown as { ensureDb: () => Promise<unknown> }).ensureDb =
      jest.fn().mockResolvedValue(dbStub.db);

    const capture = await backgroundStorageService.createAutosaveCapture(
      baseProject,
      [baseLayer],
      1,
    );

    await expect(
      backgroundStorageService.saveProjectInBackground(capture)
    ).rejects.toBe(abortError);
    expect(dbStub.getStoredProjectRecord()).toBeUndefined();
    expect(dbStub.getStoredSessionRecord()).toBeUndefined();
  });

  it('rejects when the transaction errors after both write requests succeed', async () => {
    const transactionError = new DOMException('Storage failure', 'UnknownError');
    const dbStub = createDbStub(undefined, undefined, {
      finish: 'error',
      failure: transactionError,
    });
    (serializeProject as jest.Mock).mockResolvedValue(new Uint8Array([4, 5, 6]));
    (backgroundStorageService as unknown as { ensureDb: () => Promise<unknown> }).ensureDb =
      jest.fn().mockResolvedValue(dbStub.db);
    const capture = await backgroundStorageService.createAutosaveCapture(
      baseProject,
      [baseLayer],
      1,
    );

    await expect(backgroundStorageService.saveProjectInBackground(capture)).rejects.toBe(
      transactionError,
    );
    expect(dbStub.getStoredProjectRecord()).toBeUndefined();
    expect(dbStub.getStoredSessionRecord()).toBeUndefined();
  });

  it('settles once and commits neither store when the session write request fails', async () => {
    const requestError = new DOMException('Session write failed', 'DataError');
    const dbStub = createDbStub(undefined, undefined, {
      failPutStore: 'session',
      failure: requestError,
    });
    (serializeProject as jest.Mock).mockResolvedValue(new Uint8Array([6, 5, 4]));
    (backgroundStorageService as unknown as { ensureDb: () => Promise<unknown> }).ensureDb =
      jest.fn().mockResolvedValue(dbStub.db);
    const capture = await backgroundStorageService.createAutosaveCapture(
      baseProject,
      [baseLayer],
      1,
    );
    const rejectionSpy = jest.fn();

    await backgroundStorageService.saveProjectInBackground(capture).catch(rejectionSpy);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(rejectionSpy).toHaveBeenCalledTimes(1);
    expect(rejectionSpy).toHaveBeenCalledWith(requestError);
    expect(dbStub.getStoredProjectRecord()).toBeUndefined();
    expect(dbStub.getStoredSessionRecord()).toBeUndefined();
  });

  it('preserves a newer dirty session revision while committing an older archive revision', async () => {
    const dbStub = createDbStub(undefined, {
      id: 'current-session',
      lastProjectId: baseProject.id,
      lastSaveTime: 100,
      dirtyRevision: 5,
      savedRevision: 3,
      hasUnsavedChanges: true,
    });
    (serializeProject as jest.Mock).mockResolvedValue(new Uint8Array([3, 3, 3]));
    (backgroundStorageService as unknown as { ensureDb: () => Promise<unknown> }).ensureDb =
      jest.fn().mockResolvedValue(dbStub.db);
    const capture = await backgroundStorageService.createAutosaveCapture(
      baseProject,
      [baseLayer],
      4,
    );

    const result = await backgroundStorageService.saveProjectInBackground(capture);

    expect(result).toEqual(expect.objectContaining({
      dirtyRevision: 5,
      savedRevision: 4,
      hasUnsavedChanges: true,
    }));
    expect(dbStub.getStoredSessionRecord()).toEqual(expect.objectContaining({
      dirtyRevision: 5,
      savedRevision: 4,
      hasUnsavedChanges: true,
    }));
  });

  it('preserves a newer project session while committing an earlier project archive', async () => {
    const newerProjectSession = {
      id: 'current-session',
      lastProjectId: 'project-2',
      lastSaveTime: 200,
      dirtyRevision: 3,
      savedRevision: 1,
      hasUnsavedChanges: true,
    };
    const dbStub = createDbStub(undefined, newerProjectSession);
    (serializeProject as jest.Mock).mockResolvedValue(new Uint8Array([2, 2, 2]));
    (backgroundStorageService as unknown as { ensureDb: () => Promise<unknown> }).ensureDb =
      jest.fn().mockResolvedValue(dbStub.db);
    const capture = await backgroundStorageService.createAutosaveCapture(
      baseProject,
      [baseLayer],
      2,
    );

    const result = await backgroundStorageService.saveProjectInBackground(capture);

    expect(result).toEqual(expect.objectContaining({
      projectId: baseProject.id,
      dirtyRevision: 2,
      savedRevision: 2,
      hasUnsavedChanges: false,
    }));
    expect(dbStub.getStoredProjectRecord()).toEqual(expect.objectContaining({
      projectId: baseProject.id,
      serializedProject: new Uint8Array([2, 2, 2]),
    }));
    expect(dbStub.getStoredSessionRecord()).toEqual(newerProjectSession);
  });

  it('rejects a capture older than the stored autosave archive', async () => {
    const storedProjectRecord = {
      projectId: baseProject.id,
      format: 'archive',
      serializedProject: new Uint8Array([5, 5, 5]),
      timestamp: 500,
      isDirty: false,
      dirtyRevision: 5,
      savedRevision: 5,
    };
    const storedSessionRecord = {
      id: 'current-session',
      lastProjectId: baseProject.id,
      lastSaveTime: 500,
      dirtyRevision: 5,
      savedRevision: 5,
      hasUnsavedChanges: false,
    };
    const dbStub = createDbStub(storedProjectRecord, storedSessionRecord);
    (serializeProject as jest.Mock).mockResolvedValue(new Uint8Array([4, 4, 4]));
    (backgroundStorageService as unknown as { ensureDb: () => Promise<unknown> }).ensureDb =
      jest.fn().mockResolvedValue(dbStub.db);
    const staleCapture = await backgroundStorageService.createAutosaveCapture(
      baseProject,
      [baseLayer],
      4,
    );

    await expect(
      backgroundStorageService.saveProjectInBackground(staleCapture),
    ).rejects.toThrow('older than stored revision 5');

    expect(dbStub.getStoredProjectRecord()).toEqual(storedProjectRecord);
    expect(dbStub.getStoredSessionRecord()).toEqual(storedSessionRecord);
  });

  it.each([
    [true, true],
    [false, false],
  ])('maps a legacy boolean-only session with dirty=%s to a safe revision state', async (
    legacyDirty,
    expectedUnsaved,
  ) => {
    const dbStub = createDbStub(undefined, {
      id: 'current-session',
      lastProjectId: baseProject.id,
      lastSaveTime: 100,
      hasUnsavedChanges: legacyDirty,
    });
    (backgroundStorageService as unknown as { ensureDb: () => Promise<unknown> }).ensureDb =
      jest.fn().mockResolvedValue(dbStub.db);

    await expect(backgroundStorageService.hasUnsavedWork()).resolves.toBe(expectedUnsaved);
  });

  it('resets persisted revision state for an intentional project lifecycle replacement', async () => {
    const dbStub = createDbStub(undefined, {
      id: 'current-session',
      lastProjectId: baseProject.id,
      lastSaveTime: 100,
      dirtyRevision: 8,
      savedRevision: 4,
      hasUnsavedChanges: true,
    });
    (backgroundStorageService as unknown as { ensureDb: () => Promise<unknown> }).ensureDb =
      jest.fn().mockResolvedValue(dbStub.db);

    await backgroundStorageService.resetSession(baseProject.id, 200);

    expect(dbStub.getStoredSessionRecord()).toEqual({
      id: 'current-session',
      lastProjectId: baseProject.id,
      lastSaveTime: 200,
      dirtyRevision: 0,
      savedRevision: 0,
      hasUnsavedChanges: false,
    });
    await expect(backgroundStorageService.hasUnsavedWork()).resolves.toBe(false);
  });

  it('returns the highest persisted revision for a project reload', async () => {
    const dbStub = createDbStub(
      {
        projectId: baseProject.id,
        format: 'archive',
        serializedProject: new Uint8Array([5, 5, 5]),
        timestamp: 500,
        isDirty: false,
        dirtyRevision: 5,
        savedRevision: 5,
      },
      {
        id: 'current-session',
        lastProjectId: baseProject.id,
        lastSaveTime: 500,
        dirtyRevision: 7,
        savedRevision: 5,
        hasUnsavedChanges: true,
      },
    );
    (backgroundStorageService as unknown as { ensureDb: () => Promise<unknown> }).ensureDb =
      jest.fn().mockResolvedValue(dbStub.db);

    const revisionFloor = await backgroundStorageService.getAutosaveRevisionFloor(baseProject.id);

    expect(revisionFloor).toBe(7);
    await backgroundStorageService.saveProjectInBackground({
      projectId: baseProject.id,
      projectName: baseProject.name,
      dirtyRevision: revisionFloor + 1,
      serializedProject: new Uint8Array([8, 8, 8]),
      timestamp: 800,
    });
    expect(dbStub.getStoredProjectRecord()).toEqual(expect.objectContaining({
      dirtyRevision: 8,
      savedRevision: 8,
    }));
  });

  it('keeps a committed archive recoverable when the next revision is only marked dirty', async () => {
    const dbStub = createDbStub();
    const serializedProject = new Uint8Array([7, 7, 7]);
    (serializeProject as jest.Mock).mockResolvedValue(serializedProject);
    (deserializeProject as jest.Mock).mockResolvedValue({ ...baseProject, layers: [baseLayer] });
    (backgroundStorageService as unknown as { ensureDb: () => Promise<unknown> }).ensureDb =
      jest.fn().mockResolvedValue(dbStub.db);
    const capture = await backgroundStorageService.createAutosaveCapture(
      baseProject,
      [baseLayer],
      2,
    );
    await backgroundStorageService.saveProjectInBackground(capture);

    await backgroundStorageService.updateSession(baseProject.id, true, {
      dirtyRevision: 3,
      savedRevision: 2,
    });

    await expect(backgroundStorageService.hasUnsavedWork()).resolves.toBe(true);
    await expect(backgroundStorageService.getAutosavedProject(baseProject.id)).resolves.toEqual({
      project: { ...baseProject, layers: [baseLayer] },
      layers: [baseLayer],
    });
    expect(dbStub.getStoredSessionRecord()).toEqual(expect.objectContaining({
      dirtyRevision: 3,
      savedRevision: 2,
      hasUnsavedChanges: true,
    }));
  });

  it('passes live color-cycle runtime state to the archive serializer before IndexedDB storage', async () => {
    const dbStub = createDbStub();
    const serializedProject = new Uint8Array([5, 6, 7, 8]);
    const canvas = document.createElement('canvas');
    const brush = { serialize: jest.fn() };
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

    const capture = await backgroundStorageService.createAutosaveCapture(
      baseProject,
      [colorCycleLayer],
      1,
    );
    await backgroundStorageService.saveProjectInBackground(capture);

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
