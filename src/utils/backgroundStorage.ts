// Background storage service using IndexedDB for autosave functionality
// Saves projects silently without user interaction

import type { Project, Layer } from '../types';

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
  private readonly DB_NAME = 'tinybrush-autosave';
  private readonly DB_VERSION = 1;
  private readonly PROJECTS_STORE = 'projects';
  private readonly SESSION_STORE = 'session';
  private db: IDBDatabase | null = null;

  async initialize(): Promise<void> {
    if (typeof window === 'undefined' || !window.indexedDB) {
      // IndexedDB not available
      return;
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

      request.onerror = () => {
        // Failed to open database
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        // Database initialized
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Create projects store for autosaved projects
        if (!db.objectStoreNames.contains(this.PROJECTS_STORE)) {
          const projectStore = db.createObjectStore(this.PROJECTS_STORE, { keyPath: 'projectId' });
          projectStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        // Create session store for recovery tracking
        if (!db.objectStoreNames.contains(this.SESSION_STORE)) {
          db.createObjectStore(this.SESSION_STORE, { keyPath: 'id' });
        }
      };
    });
  }

  async saveProjectInBackground(project: Project, layers: Layer[]): Promise<void> {
    if (!this.db) {
      await this.initialize();
      if (!this.db) {
        throw new Error('IndexedDB not available');
      }
    }

    // Create serializable layers by excluding OffscreenCanvas framebuffer
    const serializableLayers = layers.map(layer => {
      const { framebuffer: _, ...serializableLayer } = layer;
      return serializableLayer;
    });

    // Create serializable project data by excluding layers (they're stored separately)
    const { layers: _layers, ...serializableProject } = project;

    const autosaveRecord: AutosaveRecord = {
      projectId: project.id,
      projectData: { ...serializableProject, layers: [] },
      layerData: serializableLayers,
      timestamp: Date.now(),
      isDirty: false
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.PROJECTS_STORE], 'readwrite');
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
    if (!this.db) {
      await this.initialize();
      if (!this.db) return null;
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.PROJECTS_STORE], 'readonly');
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
          const restoredLayers: Layer[] = result.layerData.map(layer => ({
            ...layer,
            framebuffer: new OffscreenCanvas(result.projectData.width, result.projectData.height)
          }));
          
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
    if (!this.db) {
      await this.initialize();
      if (!this.db) return false;
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.SESSION_STORE], 'readonly');
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
    if (!this.db) {
      await this.initialize();
      if (!this.db) return null;
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.SESSION_STORE], 'readonly');
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
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.PROJECTS_STORE], 'readwrite');
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
    if (!this.db) return;

    const sessionRecord: SessionRecord & { id: string } = {
      id: 'current-session',
      lastProjectId: projectId,
      lastSaveTime: Date.now(),
      hasUnsavedChanges
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.SESSION_STORE], 'readwrite');
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
    if (!this.db) {
      await this.initialize();
      if (!this.db) return [];
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.PROJECTS_STORE], 'readonly');
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
    if (!this.db) return;

    const cutoffTime = Date.now() - maxAge;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.PROJECTS_STORE], 'readwrite');
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

// Export singleton instance
export const backgroundStorageService = new BackgroundStorageService();

// Initialize on import (browser only)
if (typeof window !== 'undefined') {
  backgroundStorageService.initialize().catch(console.error);
}