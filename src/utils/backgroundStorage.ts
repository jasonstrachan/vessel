// Background storage service using IndexedDB for autosave functionality
// Saves projects silently without user interaction

import { debugWarn, logError } from '@/utils/debug';
import type {
  AutosaveRevisionState,
  Project,
  Layer,
  LayerGroup,
  PaletteState,
} from '../types';
import { captureCanvasImageData } from '@/utils/canvas/canvasImage';
import { captureColorCycleCanvasSnapshot } from '@/utils/colorCycleCanvasSnapshot';
import { deserializeProject, serializeProject } from '@/utils/projectIO';

type BackgroundStorageGlobal = typeof globalThis & {
  __vesselBackgroundStorage?: BackgroundStorageService;
};

const sanitizeColorCycleData = (
  colorCycleData: Layer['colorCycleData']
): Layer['colorCycleData'] | undefined => {
  if (!colorCycleData) {
    return colorCycleData;
  }

  const {
    recolorSettings,
    colorCycleBrush,
    canvas,
    eraseMask,
    softEdgeMask,
    ...rest
  } = colorCycleData;
  void colorCycleBrush;

  const sanitized: Layer['colorCycleData'] = {
    ...rest,
    canvasImageData: captureColorCycleCanvasSnapshot({
      canvas,
      existingImageData: rest.canvasImageData,
    }) ?? rest.canvasImageData,
    canvasWidth: rest.canvasWidth ?? canvas?.width,
    canvasHeight: rest.canvasHeight ?? canvas?.height,
    eraseMaskImageData: captureCanvasImageData(eraseMask) ?? rest.eraseMaskImageData,
    softEdgeMaskImageData: captureCanvasImageData(softEdgeMask) ?? rest.softEdgeMaskImageData,
    colorCycleBrush: undefined,
    canvas: undefined
  };

  if (typeof HTMLCanvasElement !== 'undefined' && eraseMask instanceof HTMLCanvasElement) {
    sanitized.eraseMaskVersion = rest.eraseMaskVersion ?? colorCycleData.eraseMaskVersion;
  }
  if (typeof HTMLCanvasElement !== 'undefined' && softEdgeMask instanceof HTMLCanvasElement) {
    sanitized.softEdgeMaskVersion = rest.softEdgeMaskVersion ?? colorCycleData.softEdgeMaskVersion;
  }

  if (recolorSettings) {
    const { colorMap, ...recolorRest } = recolorSettings;
    sanitized.recolorSettings = {
      ...recolorRest,
      colorMap: colorMap ? new Map(colorMap) : undefined
    };
  }

  delete (sanitized as Record<string, unknown>).eraseMask;
  delete (sanitized as Record<string, unknown>).softEdgeMask;

  return sanitized;
};

const createFramebuffer = (width: number, height: number): Layer['framebuffer'] => {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height);
  }

  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  throw new Error('No canvas implementation available to restore framebuffer');
};

type SerializableLayer = Omit<Layer, 'framebuffer'>;

type LegacyAutosaveProject = Project & {
  layerGroups?: LayerGroup[];
  palette?: PaletteState;
  referenceLayerId?: string | null;
};

interface AutosaveArchiveRecord {
  projectId: string;
  format: 'archive';
  serializedProject: Uint8Array;
  timestamp: number;
  isDirty: boolean;
  dirtyRevision?: number;
  savedRevision?: number;
}

interface LegacyAutosaveRecord {
  projectId: string;
  format?: 'legacy';
  projectData: LegacyAutosaveProject;
  layerData: SerializableLayer[];
  timestamp: number;
  isDirty: boolean;
}

type AutosaveRecord = AutosaveArchiveRecord | LegacyAutosaveRecord;

interface SessionRecord extends AutosaveRevisionState {
  id: 'current-session';
  lastProjectId: string;
  lastSaveTime: number;
  hasUnsavedChanges: boolean;
}

export interface BackgroundAutosaveCapture {
  projectId: string;
  projectName: string;
  dirtyRevision: number;
  serializedProject: Uint8Array;
  timestamp: number;
}

export interface BackgroundAutosaveCommitResult extends AutosaveRevisionState {
  projectId: string;
  timestamp: number;
  hasUnsavedChanges: boolean;
}

export interface SessionRevisionUpdate extends AutosaveRevisionState {
  lastSaveTime?: number;
}

const readRevision = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;

const readAutosaveArchiveRevision = (value: unknown): number | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Partial<AutosaveArchiveRecord>;
  if (record.format !== 'archive') {
    return null;
  }
  const dirtyRevision = readRevision(record.dirtyRevision);
  const savedRevision = readRevision(record.savedRevision);
  if (dirtyRevision === null && savedRevision === null) {
    return null;
  }
  return Math.max(dirtyRevision ?? 0, savedRevision ?? 0);
};

const normalizeSessionRecord = (value: unknown): SessionRecord | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Partial<SessionRecord>;
  if (typeof record.lastProjectId !== 'string') {
    return null;
  }

  const legacyIsDirty = record.hasUnsavedChanges === true;
  const rawSavedRevision = readRevision(record.savedRevision) ?? 0;
  const rawDirtyRevision = readRevision(record.dirtyRevision)
    ?? (legacyIsDirty ? rawSavedRevision + 1 : rawSavedRevision);
  const dirtyRevision = Math.max(rawDirtyRevision, rawSavedRevision);
  const savedRevision = Math.min(rawSavedRevision, dirtyRevision);

  return {
    id: 'current-session',
    lastProjectId: record.lastProjectId,
    lastSaveTime:
      typeof record.lastSaveTime === 'number' && Number.isFinite(record.lastSaveTime)
        ? record.lastSaveTime
        : 0,
    dirtyRevision,
    savedRevision,
    hasUnsavedChanges: dirtyRevision > savedRevision,
  };
};

const transactionFailure = (
  transaction: IDBTransaction,
  fallbackMessage: string,
): DOMException | Error => transaction.error ?? new Error(fallbackMessage);

class BackgroundStorageService {
  private readonly DB_NAME = 'vessel-autosave';
  private readonly DB_VERSION = 1;
  private readonly PROJECTS_STORE = 'projects';
  private readonly SESSION_STORE = 'session';
  private db: IDBDatabase | null = null;
  private initializingPromise: Promise<IDBDatabase | null> | null = null;

  private async ensureDb(): Promise<IDBDatabase | null> {
    if (this.db) {
      return this.db;
    }
    if (typeof window === 'undefined' || !window.indexedDB) {
      return null;
    }
    if (this.initializingPromise) {
      return this.initializingPromise;
    }

    this.initializingPromise = new Promise((resolve) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

      request.onerror = () => {
        logError('[BackgroundStorage] Failed to open database:', request.error);
        this.initializingPromise = null;
        resolve(null);
      };

      request.onsuccess = () => {
        this.db = request.result;
        this.db.onclose = () => {
          this.db = null;
        };
        this.initializingPromise = null;
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        if (!db.objectStoreNames.contains(this.PROJECTS_STORE)) {
          const projectStore = db.createObjectStore(this.PROJECTS_STORE, { keyPath: 'projectId' });
          projectStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        if (!db.objectStoreNames.contains(this.SESSION_STORE)) {
          db.createObjectStore(this.SESSION_STORE, { keyPath: 'id' });
        }
      };
    });

    return this.initializingPromise;
  }

  async initialize(): Promise<void> {
    await this.ensureDb();
  }

  async createAutosaveCapture(
    project: Project,
    layers: Layer[],
    dirtyRevision: number,
  ): Promise<BackgroundAutosaveCapture> {
    const serializedProject = await serializeProject(project, layers);
    return {
      projectId: project.id,
      projectName: project.name,
      dirtyRevision,
      serializedProject: serializedProject.slice(),
      timestamp: Date.now(),
    };
  }

  async saveProjectInBackground(
    capture: BackgroundAutosaveCapture,
  ): Promise<BackgroundAutosaveCommitResult> {
    const db = await this.ensureDb();
    if (!db) {
      throw new Error('IndexedDB not available');
    }

    const autosaveRecord: AutosaveArchiveRecord = {
      projectId: capture.projectId,
      format: 'archive',
      serializedProject: capture.serializedProject,
      timestamp: capture.timestamp,
      isDirty: false,
      dirtyRevision: capture.dirtyRevision,
      savedRevision: capture.dirtyRevision,
    };

    return new Promise((resolve, reject) => {
      let settled = false;
      let commitResult: BackgroundAutosaveCommitResult | null = null;
      let abortReason: unknown = null;
      const transaction = db.transaction(
        [this.PROJECTS_STORE, this.SESSION_STORE],
        'readwrite',
      );
      const rejectOnce = (error: unknown): void => {
        if (settled) return;
        settled = true;
        const failure = error ?? new Error('IndexedDB autosave transaction failed');
        logError('[BackgroundStorage] Failed to save project:', failure);
        reject(failure);
      };

      transaction.onerror = () => {
        rejectOnce(transactionFailure(transaction, 'IndexedDB autosave transaction errored'));
      };
      transaction.onabort = () => {
        rejectOnce(
          abortReason ?? transactionFailure(transaction, 'IndexedDB autosave transaction aborted'),
        );
      };
      transaction.oncomplete = () => {
        if (settled) return;
        if (!commitResult) {
          rejectOnce(new Error('IndexedDB autosave completed without revision metadata'));
          return;
        }
        settled = true;
        resolve(commitResult);
      };

      try {
        const projectStore = transaction.objectStore(this.PROJECTS_STORE);
        const sessionStore = transaction.objectStore(this.SESSION_STORE);
        const sessionRequest = sessionStore.get('current-session');

        sessionRequest.onerror = () => rejectOnce(sessionRequest.error);
        sessionRequest.onsuccess = () => {
          const existingProjectRequest = projectStore.get(capture.projectId);
          existingProjectRequest.onerror = () => rejectOnce(existingProjectRequest.error);
          existingProjectRequest.onsuccess = () => {
            const existingArchiveRevision = readAutosaveArchiveRevision(
              existingProjectRequest.result,
            );
            if (
              existingArchiveRevision !== null &&
              existingArchiveRevision > capture.dirtyRevision
            ) {
              abortReason = new Error(
                `Autosave capture revision ${capture.dirtyRevision} is older than stored revision ${existingArchiveRevision}`,
              );
              try {
                transaction.abort();
              } catch {
                rejectOnce(abortReason);
              }
              return;
            }

            const existing = normalizeSessionRecord(sessionRequest.result);
            const sameProject = existing?.lastProjectId === capture.projectId;
            const hasNewerProjectSession = Boolean(existing && !sameProject);
            const previousDirtyRevision = sameProject ? existing.dirtyRevision : 0;
            const previousSavedRevision = sameProject ? existing.savedRevision : 0;
            const dirtyRevision = Math.max(previousDirtyRevision, capture.dirtyRevision);
            const savedRevision = Math.max(previousSavedRevision, capture.dirtyRevision);
            const sessionRecord: SessionRecord = {
              id: 'current-session',
              lastProjectId: capture.projectId,
              lastSaveTime: capture.timestamp,
              dirtyRevision,
              savedRevision,
              hasUnsavedChanges: dirtyRevision > savedRevision,
            };
            commitResult = {
              projectId: capture.projectId,
              timestamp: capture.timestamp,
              dirtyRevision,
              savedRevision,
              hasUnsavedChanges: sessionRecord.hasUnsavedChanges,
            };

            const projectRequest = projectStore.put(autosaveRecord);
            projectRequest.onerror = () => rejectOnce(projectRequest.error);
            if (!hasNewerProjectSession) {
              const sessionWriteRequest = sessionStore.put(sessionRecord);
              sessionWriteRequest.onerror = () => rejectOnce(sessionWriteRequest.error);
            }
          };
        };
      } catch (error) {
        try {
          transaction.abort();
        } catch {
          // The transaction may already be inactive; reject with the source error.
        }
        rejectOnce(error);
      }
    });
  }

  async getAutosavedProject(projectId: string): Promise<{ project: Project; layers: Layer[] } | null> {
    const db = await this.ensureDb();
    if (!db) return null;

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.PROJECTS_STORE], 'readonly');
      const store = transaction.objectStore(this.PROJECTS_STORE);
      const request = store.get(projectId);

      request.onerror = () => {
        logError('[BackgroundStorage] Failed to retrieve project:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        const result = request.result as AutosaveRecord | undefined;
        if (result) {
          void this.resolveAutosavedProject(result).then(resolve).catch(reject);
        } else {
          resolve(null);
        }
      };
    });
  }

  async hasUnsavedWork(): Promise<boolean> {
    const db = await this.ensureDb();
    if (!db) return false;

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.SESSION_STORE], 'readonly');
      const store = transaction.objectStore(this.SESSION_STORE);
      const request = store.get('current-session');

      request.onerror = () => {
        logError('[BackgroundStorage] Failed to check session:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        const session = normalizeSessionRecord(request.result);
        resolve(session ? session.dirtyRevision > session.savedRevision : false);
      };
    });
  }

  /**
   * Returns the highest revision already associated with a project. Callers use
   * this when loading a project so their in-memory revision counter continues
   * from the persisted autosave instead of restarting at zero after a reload.
   */
  async getAutosaveRevisionFloor(projectId: string): Promise<number> {
    const db = await this.ensureDb();
    if (!db) return 0;

    return new Promise((resolve, reject) => {
      let settled = false;
      let archiveRevision = 0;
      let sessionRevision = 0;
      const transaction = db.transaction(
        [this.PROJECTS_STORE, this.SESSION_STORE],
        'readonly',
      );
      const rejectOnce = (error: unknown): void => {
        if (settled) return;
        settled = true;
        reject(error ?? new Error('IndexedDB autosave revision lookup failed'));
      };

      transaction.onerror = () => {
        rejectOnce(transactionFailure(transaction, 'IndexedDB autosave revision lookup errored'));
      };
      transaction.onabort = () => {
        rejectOnce(transactionFailure(transaction, 'IndexedDB autosave revision lookup aborted'));
      };
      transaction.oncomplete = () => {
        if (settled) return;
        settled = true;
        resolve(Math.max(archiveRevision, sessionRevision));
      };

      try {
        const projectRequest = transaction
          .objectStore(this.PROJECTS_STORE)
          .get(projectId);
        const sessionRequest = transaction
          .objectStore(this.SESSION_STORE)
          .get('current-session');

        projectRequest.onerror = () => rejectOnce(projectRequest.error);
        projectRequest.onsuccess = () => {
          archiveRevision = readAutosaveArchiveRevision(projectRequest.result) ?? 0;
        };
        sessionRequest.onerror = () => rejectOnce(sessionRequest.error);
        sessionRequest.onsuccess = () => {
          const session = normalizeSessionRecord(sessionRequest.result);
          sessionRevision = session?.lastProjectId === projectId ? session.dirtyRevision : 0;
        };
      } catch (error) {
        try {
          transaction.abort();
        } catch {
          // The transaction may already be inactive; reject with the source error.
        }
        rejectOnce(error);
      }
    });
  }

  async getLastAutosavedProjectId(): Promise<string | null> {
    const db = await this.ensureDb();
    if (!db) return null;

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.SESSION_STORE], 'readonly');
      const store = transaction.objectStore(this.SESSION_STORE);
      const request = store.get('current-session');

      request.onerror = () => {
        logError('[BackgroundStorage] Failed to get last project:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        const session = normalizeSessionRecord(request.result);
        resolve(session?.lastProjectId || null);
      };
    });
  }

  async clearAutosave(projectId: string): Promise<void> {
    const db = await this.ensureDb();
    if (!db) return;

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.PROJECTS_STORE], 'readwrite');
      const store = transaction.objectStore(this.PROJECTS_STORE);
      const request = store.delete(projectId);

      request.onerror = () => {
        logError('[BackgroundStorage] Failed to clear autosave:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        // Cleared autosave for project ${projectId}
        this.updateSession(projectId, false);
        resolve();
      };
    });
  }

  async updateSession(
    projectId: string,
    hasUnsavedChanges: boolean,
    revisions?: SessionRevisionUpdate,
  ): Promise<void> {
    const db = await this.ensureDb();
    if (!db) return;

    return new Promise((resolve, reject) => {
      let settled = false;
      const transaction = db.transaction([this.SESSION_STORE], 'readwrite');
      const rejectOnce = (error: unknown): void => {
        if (settled) return;
        settled = true;
        const failure = error ?? new Error('IndexedDB session transaction failed');
        logError('[BackgroundStorage] Failed to update session:', failure);
        reject(failure);
      };
      transaction.onerror = () => {
        rejectOnce(transactionFailure(transaction, 'IndexedDB session transaction errored'));
      };
      transaction.onabort = () => {
        rejectOnce(transactionFailure(transaction, 'IndexedDB session transaction aborted'));
      };
      transaction.oncomplete = () => {
        if (settled) return;
        settled = true;
        resolve();
      };

      try {
        const store = transaction.objectStore(this.SESSION_STORE);
        const readRequest = store.get('current-session');
        readRequest.onerror = () => rejectOnce(readRequest.error);
        readRequest.onsuccess = () => {
          const existing = normalizeSessionRecord(readRequest.result);
          const sameProject = existing?.lastProjectId === projectId;
          const baseDirtyRevision = sameProject ? existing.dirtyRevision : 0;
          const baseSavedRevision = sameProject ? existing.savedRevision : 0;
          const requestedDirtyRevision = revisions?.dirtyRevision ?? 0;
          const requestedSavedRevision = revisions?.savedRevision ?? 0;
          const dirtyRevision = revisions
            ? Math.max(baseDirtyRevision, requestedDirtyRevision)
            : hasUnsavedChanges
              ? baseDirtyRevision + 1
              : baseDirtyRevision;
          const savedRevision = revisions
            ? Math.max(baseSavedRevision, requestedSavedRevision)
            : hasUnsavedChanges
              ? baseSavedRevision
              : dirtyRevision;
          const sessionRecord: SessionRecord = {
            id: 'current-session',
            lastProjectId: projectId,
            lastSaveTime:
              revisions?.lastSaveTime
              ?? (hasUnsavedChanges ? existing?.lastSaveTime ?? 0 : Date.now()),
            dirtyRevision,
            savedRevision: Math.min(savedRevision, dirtyRevision),
            hasUnsavedChanges: dirtyRevision > savedRevision,
          };
          const writeRequest = store.put(sessionRecord);
          writeRequest.onerror = () => rejectOnce(writeRequest.error);
        };
      } catch (error) {
        try {
          transaction.abort();
        } catch {
          // The transaction may already be inactive; reject with the source error.
        }
        rejectOnce(error);
      }
    });
  }

  async resetSession(projectId: string, lastSaveTime = Date.now()): Promise<void> {
    const db = await this.ensureDb();
    if (!db) return;

    const sessionRecord: SessionRecord = {
      id: 'current-session',
      lastProjectId: projectId,
      lastSaveTime,
      dirtyRevision: 0,
      savedRevision: 0,
      hasUnsavedChanges: false,
    };

    return new Promise((resolve, reject) => {
      let settled = false;
      const transaction = db.transaction([this.SESSION_STORE], 'readwrite');
      const rejectOnce = (error: unknown): void => {
        if (settled) return;
        settled = true;
        const failure = error ?? new Error('IndexedDB session reset failed');
        logError('[BackgroundStorage] Failed to reset session:', failure);
        reject(failure);
      };
      transaction.onerror = () => {
        rejectOnce(transactionFailure(transaction, 'IndexedDB session reset errored'));
      };
      transaction.onabort = () => {
        rejectOnce(transactionFailure(transaction, 'IndexedDB session reset aborted'));
      };
      transaction.oncomplete = () => {
        if (settled) return;
        settled = true;
        resolve();
      };

      try {
        const request = transaction.objectStore(this.SESSION_STORE).put(sessionRecord);
        request.onerror = () => rejectOnce(request.error);
      } catch (error) {
        try {
          transaction.abort();
        } catch {
          // The transaction may already be inactive; reject with the source error.
        }
        rejectOnce(error);
      }
    });
  }

  async getAllAutosaves(): Promise<AutosaveRecord[]> {
    const db = await this.ensureDb();
    if (!db) return [];

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.PROJECTS_STORE], 'readonly');
      const store = transaction.objectStore(this.PROJECTS_STORE);
      const request = store.getAll();

      request.onerror = () => {
        logError('[BackgroundStorage] Failed to get all autosaves:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        resolve(request.result as AutosaveRecord[]);
      };
    });
  }

  async cleanupOldAutosaves(maxAge: number = 7 * 24 * 60 * 60 * 1000): Promise<void> {
    const db = await this.ensureDb();
    if (!db) return;

    const cutoffTime = Date.now() - maxAge;

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.PROJECTS_STORE], 'readwrite');
      const store = transaction.objectStore(this.PROJECTS_STORE);
      const index = store.index('timestamp');
      const request = index.openCursor(IDBKeyRange.upperBound(cutoffTime));

      request.onerror = () => {
        logError('[BackgroundStorage] Failed to cleanup old autosaves:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else {
          // Cleanup completed
          resolve();
        }
      };
    });
  }

  private prepareLayersForArchivePersistence(layers: Layer[]): Layer[] {
    return layers.map((layer) => {
      const { framebuffer: _framebuffer, colorCycleData, ...serializableLayer } = layer;
      void _framebuffer;
      return {
        ...serializableLayer,
        framebuffer: undefined as unknown as Layer['framebuffer'],
        colorCycleData: sanitizeColorCycleData(colorCycleData),
      };
    });
  }

  private async resolveAutosavedProject(
    result: AutosaveRecord
  ): Promise<{ project: Project; layers: Layer[] } | null> {
    if (result.format === 'archive') {
      const restoredProject = await deserializeProject(result.serializedProject);
      return {
        project: restoredProject,
        layers: restoredProject.layers,
      };
    }

    return this.restoreLegacyAutosave(result.projectData, result.layerData);
  }

  private restoreLegacyAutosave(
    projectData: LegacyAutosaveProject,
    layerData: SerializableLayer[]
  ): { project: Project; layers: Layer[] } {
    const restoredLayers: Layer[] = layerData.map((layer) => {
      const framebufferWidth = layer.imageData?.width ?? projectData.width;
      const framebufferHeight = layer.imageData?.height ?? projectData.height;
      let restoredColorCycleData = layer.colorCycleData;

      if (
        layer.layerType === 'color-cycle' &&
        (layer.colorCycleData?.eraseMaskImageData || layer.colorCycleData?.softEdgeMaskImageData) &&
        typeof document !== 'undefined'
      ) {
        try {
          const eraseMaskCanvas = layer.colorCycleData.eraseMaskImageData
            ? document.createElement('canvas')
            : undefined;
          if (eraseMaskCanvas && layer.colorCycleData.eraseMaskImageData) {
            eraseMaskCanvas.width = layer.colorCycleData.eraseMaskImageData.width;
            eraseMaskCanvas.height = layer.colorCycleData.eraseMaskImageData.height;
            eraseMaskCanvas.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings)
              ?.putImageData(layer.colorCycleData.eraseMaskImageData, 0, 0);
          }
          const softEdgeMaskCanvas = layer.colorCycleData.softEdgeMaskImageData
            ? document.createElement('canvas')
            : undefined;
          if (softEdgeMaskCanvas && layer.colorCycleData.softEdgeMaskImageData) {
            softEdgeMaskCanvas.width = layer.colorCycleData.softEdgeMaskImageData.width;
            softEdgeMaskCanvas.height = layer.colorCycleData.softEdgeMaskImageData.height;
            softEdgeMaskCanvas.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings)
              ?.putImageData(layer.colorCycleData.softEdgeMaskImageData, 0, 0);
          }
          restoredColorCycleData = {
            ...layer.colorCycleData,
            eraseMask: eraseMaskCanvas,
            softEdgeMask: softEdgeMaskCanvas
          };
        } catch (error) {
          debugWarn('raw-console', '[BackgroundStorage] Failed to restore color cycle masks.', error);
        }
      }

      return {
        ...layer,
        colorCycleData: restoredColorCycleData,
        framebuffer: createFramebuffer(framebufferWidth, framebufferHeight)
      };
    });

    return {
      project: projectData,
      layers: restoredLayers
    };
  }
}

const backgroundStorageGlobal = globalThis as BackgroundStorageGlobal;
if (!backgroundStorageGlobal.__vesselBackgroundStorage) {
  backgroundStorageGlobal.__vesselBackgroundStorage = new BackgroundStorageService();
}

// Export singleton instance
export const backgroundStorageService = backgroundStorageGlobal.__vesselBackgroundStorage;

// Initialize lazily on first browser import
if (typeof window !== 'undefined') {
  backgroundStorageService.initialize().catch(console.error);
}
