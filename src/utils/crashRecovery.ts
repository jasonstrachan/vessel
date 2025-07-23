// Crash recovery service for TinyBrush
// Detects and recovers unsaved work after browser crashes or unexpected closes

import { backgroundStorageService } from './backgroundStorage';
import { useAppStore } from '../stores/useAppStore';
import type { Project, Layer } from '../types';

interface RecoveryData {
  project: Project;
  layers: Layer[];
  lastSaveTime: number;
}

export class CrashRecoveryService {
  private readonly RECOVERY_KEY = 'tinybrush-recovery';
  
  async checkForUnsavedWork(): Promise<RecoveryData | null> {
    try {
      // Check if there's unsaved work in background storage
      const hasUnsaved = await backgroundStorageService.hasUnsavedWork();
      if (!hasUnsaved) {
        return null;
      }

      // Get the last autosaved project
      const lastProjectId = await backgroundStorageService.getLastAutosavedProjectId();
      if (!lastProjectId) {
        return null;
      }

      // Retrieve the project data
      const recoveryData = await backgroundStorageService.getAutosavedProject(lastProjectId);
      if (!recoveryData) {
        return null;
      }

      return {
        project: recoveryData.project,
        layers: recoveryData.layers,
        lastSaveTime: recoveryData.project.updatedAt?.getTime() || Date.now()
      };
    } catch (error) {
      console.error('[CrashRecovery] Failed to check for unsaved work:', error);
      return null;
    }
  }

  async recoverProject(recoveryData: RecoveryData): Promise<void> {
    const store = useAppStore.getState();
    
    try {
      // Restore the project to the store
      store.setProject(recoveryData.project);
      
      // Update layers and canvas state
      useAppStore.setState({
        layers: recoveryData.layers,
        activeLayerId: recoveryData.layers[0]?.id || null,
        layersNeedRecomposition: true,
        canvas: {
          ...store.canvas,
          canvasWidth: recoveryData.project.width,
          canvasHeight: recoveryData.project.height,
          // Restore view state if available
          zoom: recoveryData.project.viewState?.zoom || store.canvas.zoom,
          panX: recoveryData.project.viewState?.panX || store.canvas.panX,
          panY: recoveryData.project.viewState?.panY || store.canvas.panY
        }
      });

      // Clear the dirty state since we just recovered
      store.clearDirtyState();

      // Clear history for the recovered project
      store.clearHistory();

      console.log(`[CrashRecovery] Successfully recovered project "${recoveryData.project.name}"`);
      
      // Show success notification
      store.addNotification({
        type: 'success',
        title: 'Work Recovered',
        message: `Your unsaved work on "${recoveryData.project.name}" has been recovered.`,
        timestamp: new Date(),
        duration: 5000
      });

    } catch (error) {
      console.error('[CrashRecovery] Failed to recover project:', error);
      
      store.addNotification({
        type: 'error',
        title: 'Recovery Failed',
        message: 'Could not recover your unsaved work. The project may be corrupted.',
        timestamp: new Date(),
        duration: 5000
      });
      
      throw error;
    }
  }

  async dismissRecovery(projectId: string): Promise<void> {
    try {
      // Clear the autosave data since user chose not to recover
      await backgroundStorageService.clearAutosave(projectId);
      console.log('[CrashRecovery] Recovery dismissed, autosave data cleared');
    } catch (error) {
      console.error('[CrashRecovery] Failed to dismiss recovery:', error);
    }
  }

  // Check if we're in a recovery situation on app startup
  async shouldShowRecoveryPrompt(): Promise<boolean> {
    const recoveryData = await this.checkForUnsavedWork();
    
    if (!recoveryData) {
      return false;
    }

    // Only show recovery if the last save was recent (within last 24 hours)
    const timeSinceLastSave = Date.now() - recoveryData.lastSaveTime;
    const maxRecoveryAge = 24 * 60 * 60 * 1000; // 24 hours
    
    return timeSinceLastSave < maxRecoveryAge;
  }

  // Format recovery time for display
  formatRecoveryTime(lastSaveTime: number): string {
    const now = Date.now();
    const timeDiff = now - lastSaveTime;
    
    const minutes = Math.floor(timeDiff / (1000 * 60));
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) {
      return `${days} day${days === 1 ? '' : 's'} ago`;
    } else if (hours > 0) {
      return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    } else if (minutes > 0) {
      return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
    } else {
      return 'just now';
    }
  }

  // Clean up old recovery data on app startup
  async cleanupOldRecoveryData(): Promise<void> {
    try {
      // Clean up autosaves older than 7 days
      await backgroundStorageService.cleanupOldAutosaves();
      console.log('[CrashRecovery] Old recovery data cleaned up');
    } catch (error) {
      console.error('[CrashRecovery] Failed to cleanup old recovery data:', error);
    }
  }
}

// Export singleton instance
export const crashRecoveryService = new CrashRecoveryService();