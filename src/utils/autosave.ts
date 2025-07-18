// Autosave service for TinyBrush
// Implements 2-minute interval autosave with change detection
// Now uses background storage for silent, non-blocking saves

import { useAppStore } from '../stores/useAppStore';
import { backgroundStorageService } from './backgroundStorage';
import { fileBackupService } from './fileBackupService';

class AutosaveService {
  private intervalId: NodeJS.Timeout | null = null;
  private intervalMs: number = 2 * 60 * 1000; // 2 minutes

  start(): void {
    if (this.intervalId) {
      this.stop();
    }

    this.intervalId = setInterval(() => {
      this.performAutosave();
    }, this.intervalMs);

    // Update store to indicate autosave is running
    useAppStore.setState((state) => ({
      autosave: { ...state.autosave, isRunning: true }
    }));
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    // Update store to indicate autosave is stopped
    useAppStore.setState((state) => ({
      autosave: { ...state.autosave, isRunning: false }
    }));
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
    const store = useAppStore.getState();
    
    // Check if autosave is enabled and there are unsaved changes
    if (!store.autosave.isEnabled || !store.autosave.hasUnsavedChanges) {
      return;
    }

    // Check if there's a valid project to save
    if (!store.project) {
      return;
    }

    try {
      // Capture current canvas state to active layer before saving
      await store.captureCanvasToActiveLayer();
      
      // Get fresh state after capture
      const freshState = useAppStore.getState();
      if (!freshState.project) return;

      // Save to background storage (IndexedDB) - silent, non-blocking
      await backgroundStorageService.saveProjectInBackground(
        freshState.project, 
        freshState.layers
      );
      
      // Also save to file if file backup is enabled
      if (freshState.autosave.fileBackup.enabled) {
        const mode = freshState.autosave.fileBackup.mode;
        const hasFile = freshState.autosave.fileBackup.fileHandle;
        const hasDirectory = freshState.autosave.fileBackup.directoryHandle;
        
        if ((mode === 'single-file' && hasFile) || (mode === 'timestamped-files' && hasDirectory)) {
          try {
            // Set the appropriate handle in the service
            if (mode === 'single-file') {
              fileBackupService.setFileHandle(freshState.autosave.fileBackup.fileHandle!);
            } else {
              fileBackupService.setDirectoryHandle(freshState.autosave.fileBackup.directoryHandle!);
            }

            const backupResult = await fileBackupService.saveProjectBackup(
              freshState.project,
              freshState.layers,
              mode
            );
          
            if (backupResult.success) {
              // Update file backup time in store
              const currentState = useAppStore.getState();
              currentState.updateFileBackupTime();
              console.log(`[Autosave] File backup saved: ${backupResult.filename}`);
            } else {
              console.warn(`[Autosave] File backup failed: ${backupResult.error}`);
            }
          } catch (fileError) {
            console.error('[Autosave] File backup error:', fileError);
          }
        }
      }
      
      // Clear dirty state after successful background save
      freshState.clearDirtyState();
      
      console.log(`[Autosave] Project "${freshState.project.name}" saved to background storage`);
    } catch (error) {
      console.error('[Autosave] Failed to save project to background storage:', error);
      
      // Only show notification for critical failures, not for every autosave issue
      // This keeps autosave truly silent unless there's a real problem
      const store = useAppStore.getState();
      store.addNotification({
        type: 'warning',
        title: 'Autosave Issue',
        message: 'Background autosave encountered an issue. Your work is still safe.',
        timestamp: new Date(),
        duration: 3000
      });
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
export const autosaveService = new AutosaveService();

// Hook for React components to use autosave
export function useAutosave() {
  const store = useAppStore();
  
  return {
    isEnabled: store.autosave.isEnabled,
    isRunning: store.autosave.isRunning,
    hasUnsavedChanges: store.autosave.hasUnsavedChanges,
    lastSaveTime: store.autosave.lastSaveTime,
    fileBackup: store.autosave.fileBackup,
    setEnabled: store.setAutosaveEnabled,
    setFileBackupEnabled: store.setFileBackupEnabled,
    setFileBackupMode: store.setFileBackupMode,
    setFileBackupFile: store.setFileBackupFile,
    setFileBackupDirectory: store.setFileBackupDirectory,
    start: () => autosaveService.start(),
    stop: () => autosaveService.stop(),
    setInterval: (minutes: number) => autosaveService.setInterval(minutes),
    triggerNow: () => autosaveService.triggerAutosave()
  };
}