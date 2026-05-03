// Background storage service using IndexedDB for autosave functionality
// Saves projects silently without user interaction

import { debugWarn, logError } from '@/utils/debug';
import type { Project, Layer, LayerGroup, PaletteState } from '../types';
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

interface SessionRecord {
  lastProjectId: string;
  lastSaveTime: number;
  hasUnsavedChanges: boolean;
}

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

  async saveProjectInBackground(project: Project, layers: Layer[]): Promise<void> {
    const db = await this.ensureDb();
    if (!db) {
      throw new Error('IndexedDB not available');
    }

    const serializedProject = await serializeProject(project, layers);

    const autosaveRecord: AutosaveArchiveRecord = {
      projectId: project.id,
      format: 'archive',
      serializedProject,
      timestamp: Date.now(),
      isDirty: false
    };

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.PROJECTS_STORE], 'readwrite');
      const store = transaction.objectStore(this.PROJECTS_STORE);
      const request = store.put(autosaveRecord);

      request.onerror = () => {
        logError('[BackgroundStorage] Failed to save project:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        // Project "${project.name}" saved to IndexedDB
        void this.updateSession(project.id, false);
        resolve();
      };
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
        const session = request.result as SessionRecord | undefined;
        resolve(session?.hasUnsavedChanges || false);
      };
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
        const session = request.result as SessionRecord | undefined;
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

  async updateSession(projectId: string, hasUnsavedChanges: boolean): Promise<void> {
    const db = await this.ensureDb();
    if (!db) return;

    const sessionRecord: SessionRecord & { id: string } = {
      id: 'current-session',
      lastProjectId: projectId,
      lastSaveTime: Date.now(),
      hasUnsavedChanges
    };

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.SESSION_STORE], 'readwrite');
      const store = transaction.objectStore(this.SESSION_STORE);
      const request = store.put(sessionRecord);

      request.onerror = () => {
        logError('[BackgroundStorage] Failed to update session:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        resolve();
      };
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
