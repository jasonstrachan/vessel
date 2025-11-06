// Background storage service using IndexedDB for autosave functionality
// Saves projects silently without user interaction

import type { Project, Layer } from '../types';
import { captureCanvasImageData } from '@/utils/canvas/canvasImage';

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
    ...rest
  } = colorCycleData;
  void colorCycleBrush;

  const sanitized: Layer['colorCycleData'] = {
    ...rest,
    canvasImageData: captureCanvasImageData(canvas) ?? rest.canvasImageData,
    canvasWidth: rest.canvasWidth ?? canvas?.width,
    canvasHeight: rest.canvasHeight ?? canvas?.height,
    eraseMaskImageData: captureCanvasImageData(eraseMask) ?? rest.eraseMaskImageData,
    colorCycleBrush: undefined,
    canvas: undefined
  };

  if (typeof HTMLCanvasElement !== 'undefined' && eraseMask instanceof HTMLCanvasElement) {
    sanitized.eraseMaskVersion = rest.eraseMaskVersion ?? colorCycleData.eraseMaskVersion;
  }

  if (recolorSettings) {
    const { colorMap, ...recolorRest } = recolorSettings;
    sanitized.recolorSettings = {
      ...recolorRest,
      colorMap: colorMap ? new Map(colorMap) : undefined
    };
  }

  delete (sanitized as Record<string, unknown>).eraseMask;

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

interface AutosaveRecord {
  projectId: string;
  projectData: Project;
  layerData: SerializableLayer[];
  timestamp: number;
  isDirty: boolean;
}

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
        console.error('[BackgroundStorage] Failed to open database:', request.error);
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

    // Create serializable layers by excluding OffscreenCanvas framebuffer
    const serializableLayers = layers.map(layer => {
      const { framebuffer: _framebuffer, colorCycleData, ...serializableLayer } = layer;
      void _framebuffer;
      return {
        ...serializableLayer,
        colorCycleData: sanitizeColorCycleData(colorCycleData)
      };
    });

    // Create serializable project data by excluding layers (they're stored separately)
    const { layers: _projectLayers, ...serializableProject } = project;
    void _projectLayers;

    const autosaveRecord: AutosaveRecord = {
      projectId: project.id,
      projectData: { ...serializableProject, layers: [] },
      layerData: serializableLayers,
      timestamp: Date.now(),
      isDirty: false
    };

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.PROJECTS_STORE], 'readwrite');
      const store = transaction.objectStore(this.PROJECTS_STORE);
      const request = store.put(autosaveRecord);

      request.onerror = () => {
        console.error('[BackgroundStorage] Failed to save project:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        // Project "${project.name}" saved to IndexedDB
        this.updateSession(project.id, true);
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
        console.error('[BackgroundStorage] Failed to retrieve project:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        const result = request.result as AutosaveRecord | undefined;
        if (result) {
          // Add missing framebuffer property back to layers
          const restoredLayers: Layer[] = result.layerData.map(layer => {
            const framebufferWidth = layer.imageData?.width ?? result.projectData.width;
            const framebufferHeight = layer.imageData?.height ?? result.projectData.height;
            let restoredColorCycleData = layer.colorCycleData;

            if (
              layer.layerType === 'color-cycle' &&
              layer.colorCycleData?.eraseMaskImageData &&
              typeof document !== 'undefined'
            ) {
              try {
                const maskCanvas = document.createElement('canvas');
                maskCanvas.width = layer.colorCycleData.eraseMaskImageData.width;
                maskCanvas.height = layer.colorCycleData.eraseMaskImageData.height;
                const maskCtx = maskCanvas.getContext('2d', {
                  willReadFrequently: true
                } as CanvasRenderingContext2DSettings);
                maskCtx?.putImageData(layer.colorCycleData.eraseMaskImageData, 0, 0);

                restoredColorCycleData = {
                  ...layer.colorCycleData,
                  eraseMask: maskCanvas
                };
              } catch (error) {
                console.warn('[BackgroundStorage] Failed to restore erase mask.', error);
              }
            }

            return {
              ...layer,
              colorCycleData: restoredColorCycleData,
              framebuffer: createFramebuffer(framebufferWidth, framebufferHeight)
            };
          });

          resolve({
            project: result.projectData,
            layers: restoredLayers
          });
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
        console.error('[BackgroundStorage] Failed to check session:', request.error);
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
        console.error('[BackgroundStorage] Failed to get last project:', request.error);
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
        console.error('[BackgroundStorage] Failed to clear autosave:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        // Cleared autosave for project ${projectId}
        this.updateSession(projectId, false);
        resolve();
      };
    });
  }

  private async updateSession(projectId: string, hasUnsavedChanges: boolean): Promise<void> {
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
        console.error('[BackgroundStorage] Failed to update session:', request.error);
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
        console.error('[BackgroundStorage] Failed to get all autosaves:', request.error);
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
        console.error('[BackgroundStorage] Failed to cleanup old autosaves:', request.error);
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
