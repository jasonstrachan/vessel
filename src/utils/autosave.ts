// Autosave service for Vessel
// Implements 2-minute interval autosave with change detection
// Now uses background storage for silent, non-blocking saves

import { useAppStore } from '@/stores/useAppStore';
import type { AppState } from '@/stores/useAppStore';
import { backgroundStorageService } from './backgroundStorage';
import { fileBackupService } from './fileBackupService';
import { devLog } from './devLog';
import {
  waitForAllPendingColorCycleSaves,
  waitForFinalizeQueueIdle,
} from '@/stores/pendingColorCycleSaves';
import { flushPendingToolWork } from '@/utils/toolFlushRegistry';

const autosaveLog = devLog.scope('AUTOSAVE');

type AutosaveConfig = {
  enabled: boolean;
  interval: number;
};

const selectAutosaveConfig = (state: AppState): AutosaveConfig => ({
  enabled: state.autosave.isEnabled,
  interval: state.autosave.interval,
});

const configsEqual = (a: AutosaveConfig, b: AutosaveConfig): boolean =>
  a.enabled === b.enabled && a.interval === b.interval;

class AutosaveService {
  private intervalId: NodeJS.Timeout | null = null;
  private intervalMs: number = 2 * 60 * 1000; // 2 minutes
  private inProgress = false;
  private storeUnsubscribe: (() => void) | null = null;
  private warnedFilePermission = false;

  constructor() {
    if (typeof window !== 'undefined') {
      this.bindStoreSubscription();
    }
  }

  private bindStoreSubscription(): void {
    this.storeUnsubscribe = useAppStore.subscribe((state, prevState) => {
      const next = selectAutosaveConfig(state);
      const prev = selectAutosaveConfig(prevState);

      if (!configsEqual(next, prev)) {
        this.applyConfig(next, prev);
      }
    });

    const initialConfig = selectAutosaveConfig(useAppStore.getState());
    this.applyConfig(initialConfig, { enabled: false, interval: initialConfig.interval });
  }

  private applyConfig(next: AutosaveConfig, prev: AutosaveConfig): void {
    if (!next.enabled) {
      this.stop();
      return;
    }

    const nextIntervalMs = next.interval * 60 * 1000;
    const intervalChanged = this.intervalMs !== nextIntervalMs;
    this.intervalMs = nextIntervalMs;

    if (intervalChanged && this.intervalId) {
      this.stop();
    }

    if (!this.intervalId) {
      this.start();
    }

    if (!prev.enabled && next.enabled) {
      void this.performAutosave();
    }
  }

  start(): void {
    if (this.intervalId || typeof setInterval === 'undefined') {
      return;
    }

    this.intervalId = setInterval(() => {
      void this.performAutosave();
    }, this.intervalMs);

    useAppStore.setState((state) => ({
      autosave: { ...state.autosave, isRunning: true }
    }));
  }

  stop(): void {
    const wasRunning = Boolean(this.intervalId);
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    if (wasRunning) {
      useAppStore.setState((state) => ({
        autosave: { ...state.autosave, isRunning: false }
      }));
    }
  }

  setInterval(minutes: number): void {
    this.intervalMs = minutes * 60 * 1000;
    
    // Restart with new interval if currently running
    if (this.intervalId) {
      this.stop();
      this.start();
    }
  }

  private async performAutosave(): Promise<void> {
    if (this.inProgress) {
      autosaveLog.debug('Autosave already running; skipping overlapping invocation.');
      return;
    }

    const store = useAppStore.getState();

    // Check if autosave is enabled and there are unsaved changes
    if (!store.autosave.isEnabled || !store.autosave.hasUnsavedChanges) {
      return;
    }

    // Check if there's a valid project to save
    if (!store.project) {
      return;
    }
    if (store.layers.length === 0) {
      return;
    }

    this.inProgress = true;
    store.setSaveStatus('saving', 'autosave', 'Autosaving...');

    try {
      await flushPendingToolWork({ passiveOnly: true });
      await waitForFinalizeQueueIdle();
      await waitForAllPendingColorCycleSaves();

      autosaveLog.debug('Autosave capture setup', {
        activeLayerId: store.activeLayerId ?? store.layers[0]?.id ?? null,
        activeLayerType:
          store.layers.find((layer) => layer.id === (store.activeLayerId ?? store.layers[0]?.id))
            ?.layerType ?? null,
        hasOffscreen: Boolean(store.currentOffscreenCanvas),
        isHistoryCapturing: store.history?.isCapturing,
        projectFilename: store.projectFilename ?? null,
        fileBackupEnabled: store.autosave.fileBackup.enabled,
        fileBackupPath: store.autosave.fileBackup.backupPath ?? null,
        fileHandleName: store.autosave.fileBackup.fileHandle?.name ?? null,
      });

      // Get fresh state after capture
      const freshState = useAppStore.getState();
      if (!freshState.project) {
        freshState.clearSaveStatus();
        return;
      }

      // Save to background storage (IndexedDB) - silent, non-blocking
      const projectForBackground = {
        ...freshState.project,
        layerGroups: freshState.layerGroups,
        palette: freshState.palette,
        referenceLayerId: freshState.referenceLayerId ?? null
      };
      await backgroundStorageService.saveProjectInBackground(
        projectForBackground,
        freshState.layers
      );
      autosaveLog.debug('Autosave background save complete', {
        projectId: freshState.project.id,
      });
      
      // Also save to file if file backup is enabled
      if (freshState.autosave.fileBackup.enabled) {
        const mode = freshState.autosave.fileBackup.mode;
        const hasFile = freshState.autosave.fileBackup.fileHandle;
        const hasDirectory = freshState.autosave.fileBackup.directoryHandle;
        autosaveLog.debug('Autosave file backup check', {
          mode,
          hasFile: Boolean(hasFile),
          hasDirectory: Boolean(hasDirectory),
        });
        
        if ((mode === 'single-file' && hasFile) || (mode === 'timestamped-files' && hasDirectory)) {
          try {
            // Set the appropriate handle in the service
            if (mode === 'single-file') {
              fileBackupService.setFileHandle(freshState.autosave.fileBackup.fileHandle!);
            } else {
              fileBackupService.setDirectoryHandle(freshState.autosave.fileBackup.directoryHandle!);
            }

            const hasPermission =
              mode === 'single-file'
                ? await fileBackupService.ensureFileWritePermission(
                    freshState.autosave.fileBackup.fileHandle
                  )
                : await fileBackupService.ensureDirectoryWritePermission(
                    freshState.autosave.fileBackup.directoryHandle
                  );

            autosaveLog.debug('Autosave file permission', {
              mode,
              hasPermission,
            });

            if (!hasPermission) {
              if (!this.warnedFilePermission) {
                this.warnedFilePermission = true;
                const store = useAppStore.getState();
                store.addNotification({
                  type: 'warning',
                  title: 'Autosave Permission Needed',
                  message: 'Autosave could not update the file because write permission was not granted. Re-open the project or choose a backup file.',
                  timestamp: new Date(),
                  duration: 5000
                });
              }
              autosaveLog.warn('Skipping autosave file backup because write permission is unavailable.', {
                mode,
              });
            } else {
              const backupProject = {
                ...freshState.project,
                layerGroups: freshState.layerGroups,
                palette: freshState.palette,
                referenceLayerId: freshState.referenceLayerId ?? null,
              };

              const backupResult = await fileBackupService.saveProjectBackup(
                backupProject,
                freshState.layers,
                mode
              );
              autosaveLog.debug('Autosave file backup result', {
                success: backupResult.success,
                filename: backupResult.filename,
                error: backupResult.error,
              });
            
              if (backupResult.success) {
                // Update file backup time in store
                const currentState = useAppStore.getState();
                currentState.updateFileBackupTime();
                // File backup saved: ${backupResult.filename}
              }
              // File backup failed: ${backupResult.error}
            }
          } catch (error) {
            autosaveLog.error('Failed to write file backup during autosave.', error, { mode });
          }
        }
      }
      
      // Clear dirty state after successful background save
      freshState.clearDirtyState();
      const savedAt = new Date();
      useAppStore.setState((state) => ({
        autosave: {
          ...state.autosave,
          lastSaveTime: savedAt,
        },
      }));
      useAppStore.setState({ paletteDirty: false });
      void backgroundStorageService.updateSession(freshState.project.id, false).catch(() => undefined);
      freshState.setSaveStatus('saved', 'autosave', 'Autosave complete');
      
      // Project "${freshState.project.name}" saved to background storage
    } catch (error) {
      autosaveLog.error('Background autosave failed.', error);
      const latestState = useAppStore.getState();
      latestState.setSaveStatus('error', 'autosave', 'Autosave issue');

      // Only show notification for critical failures, not for every autosave issue
      // This keeps autosave truly silent unless there's a real problem
      latestState.addNotification({
        type: 'warning',
        title: 'Autosave Issue',
        message: 'Background autosave encountered an issue. Your work is still safe.',
        timestamp: new Date(),
        duration: 3000
      });
    } finally {
      this.inProgress = false;
    }
  }

  // Manual trigger for autosave (useful for testing)
  async triggerAutosave(): Promise<void> {
    await this.performAutosave();
  }

  // Check if autosave is currently running
  isRunning(): boolean {
    return this.intervalId !== null;
  }
}

// Export singleton instance
type AutosaveGlobal = typeof globalThis & { __vesselAutosaveService?: AutosaveService };
const autosaveGlobal = globalThis as AutosaveGlobal;
if (!autosaveGlobal.__vesselAutosaveService) {
  autosaveGlobal.__vesselAutosaveService = new AutosaveService();
}
export const autosaveService = autosaveGlobal.__vesselAutosaveService;

// Hook for React components to use autosave
export function useAutosave() {
  const isEnabled = useAppStore(state => state.autosave.isEnabled);
  const isRunning = useAppStore(state => state.autosave.isRunning);
  const hasUnsavedChanges = useAppStore(state => state.autosave.hasUnsavedChanges);
  const lastSaveTime = useAppStore(state => state.autosave.lastSaveTime);
  const fileBackup = useAppStore(state => state.autosave.fileBackup);
  const setAutosaveEnabled = useAppStore(state => state.setAutosaveEnabled);
  const setFileBackupEnabled = useAppStore(state => state.setFileBackupEnabled);
  const setFileBackupMode = useAppStore(state => state.setFileBackupMode);
  const setFileBackupFile = useAppStore(state => state.setFileBackupFile);
  const setFileBackupDirectory = useAppStore(state => state.setFileBackupDirectory);
  
  return {
    isEnabled,
    isRunning,
    hasUnsavedChanges,
    lastSaveTime,
    fileBackup,
    setEnabled: setAutosaveEnabled,
    setFileBackupEnabled,
    setFileBackupMode,
    setFileBackupFile,
    setFileBackupDirectory,
    start: () => autosaveService.start(),
    stop: () => autosaveService.stop(),
    setInterval: (minutes: number) => autosaveService.setInterval(minutes),
    triggerNow: () => autosaveService.triggerAutosave()
  };
}
