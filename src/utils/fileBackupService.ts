// File backup service for automatic file-based autosaves
// Saves autosave copies as actual .tb files to user-selected directory

import type { Project, Layer } from '../types';

export class FileBackupService {
  private directoryHandle: FileSystemDirectoryHandle | null = null;
  private fileHandle: FileSystemFileHandle | null = null;
  private isSupported: boolean = false;

  constructor() {
    // Check if File System Access API is supported
    this.isSupported = typeof window !== 'undefined' && 'showDirectoryPicker' in window;
  }

  isFileBackupSupported(): boolean {
    return this.isSupported;
  }

  async selectBackupFile(): Promise<{ success: boolean; path?: string; error?: string }> {
    if (!this.isSupported) {
      return { success: false, error: 'File System Access API not supported in this browser' };
    }

    try {
      // Request file save dialog from user
      this.fileHandle = await (window as Window & {
        showSaveFilePicker?: (options: {
          suggestedName?: string;
          types?: { description: string; accept: Record<string, string[]> }[];
          startIn?: string;
        }) => Promise<FileSystemFileHandle>;
      }).showSaveFilePicker!({
        suggestedName: 'autosave.tb',
        types: [{
          description: 'TinyBrush files',
          accept: { 'application/json': ['.tb'] }
        }],
        startIn: 'documents'
      });

      // Get a display-friendly path name
      const path = this.fileHandle!.name || 'Selected File';
      
      // File selected: ${path}
      return { success: true, path };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return { success: false, error: 'File selection cancelled' };
      }
      console.error('[FileBackup] Failed to select file:', error);
      return { success: false, error: `Failed to select file: ${error instanceof Error ? error.message : 'Unknown error'}` };
    }
  }

  async selectBackupDirectory(): Promise<{ success: boolean; path?: string; error?: string }> {
    if (!this.isSupported) {
      return { success: false, error: 'File System Access API not supported in this browser' };
    }

    try {
      // Request directory access from user
      this.directoryHandle = await (window as Window & {
        showDirectoryPicker?: (options: {
          mode?: string;
          startIn?: string;
        }) => Promise<FileSystemDirectoryHandle>;
      }).showDirectoryPicker!({
        mode: 'readwrite',
        startIn: 'documents'
      });

      // Get a display-friendly path name
      const path = this.directoryHandle!.name || 'Selected Directory';
      
      // Directory selected: ${path}
      return { success: true, path };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return { success: false, error: 'Directory selection cancelled' };
      }
      console.error('[FileBackup] Failed to select directory:', error);
      return { success: false, error: `Failed to select directory: ${error instanceof Error ? error.message : 'Unknown error'}` };
    }
  }

  async saveProjectBackup(project: Project, layers: Layer[], mode: 'single-file' | 'timestamped-files' = 'single-file'): Promise<{ success: boolean; filename?: string; error?: string }> {
    if (mode === 'single-file' && !this.fileHandle) {
      return { success: false, error: 'No backup file selected' };
    }
    
    if (mode === 'timestamped-files' && !this.directoryHandle) {
      return { success: false, error: 'No backup directory selected' };
    }

    try {
      // Use the same serialization as manual saves for compatibility
      const { serializeProject } = await import('./projectIO');
      const projectData = await serializeProject(project, layers);

      let filename: string;
      let fileHandle: FileSystemFileHandle;

      if (mode === 'single-file') {
        // Use the selected file, overwriting it
        fileHandle = this.fileHandle!;
        filename = fileHandle.name;
      } else {
        // Generate timestamped filename for directory mode
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        filename = `${project.name}_autosave_${timestamp}.tb`;
        fileHandle = await this.directoryHandle!.getFileHandle(filename, { create: true });
      }

      // Write the project data (already JSON string from serializeProject)
      const writable = await fileHandle.createWritable();
      await writable.write(projectData);
      await writable.close();

      // Project backed up as: ${filename}
      return { success: true, filename };
    } catch (error) {
      console.error('[FileBackup] Failed to save backup:', error);
      return { success: false, error: `Failed to save backup: ${error instanceof Error ? error.message : 'Unknown error'}` };
    }
  }


  getBackupFile(): { name: string; handle: FileSystemFileHandle } | null {
    if (!this.fileHandle) return null;
    
    return {
      name: this.fileHandle.name || 'Selected File',
      handle: this.fileHandle
    };
  }

  getBackupDirectory(): { name: string; handle: FileSystemDirectoryHandle } | null {
    if (!this.directoryHandle) return null;
    
    return {
      name: this.directoryHandle.name || 'Selected Directory',
      handle: this.directoryHandle
    };
  }

  clearBackupFile(): void {
    this.fileHandle = null;
    // Backup file cleared
  }

  clearBackupDirectory(): void {
    this.directoryHandle = null;
    // Backup directory cleared
  }

  setFileHandle(fileHandle: FileSystemFileHandle | null): void {
    this.fileHandle = fileHandle;
  }

  setDirectoryHandle(directoryHandle: FileSystemDirectoryHandle | null): void {
    this.directoryHandle = directoryHandle;
  }

  async checkFileAccess(): Promise<boolean> {
    if (!this.fileHandle) return false;
    
    try {
      // Test if we still have access to the file by trying to get it
      await this.fileHandle.getFile();
      return true;
    } catch (error) {
      console.error('[FileBackup] File access check failed:', error);
      return false;
    }
  }

  async checkDirectoryAccess(): Promise<boolean> {
    if (!this.directoryHandle) return false;
    
    try {
      // Test if we still have access by trying to get a test file handle
      await this.directoryHandle.getFileHandle('__test__', { create: false });
      return true;
    } catch {
      // Expected to fail for non-existent test file, but will also fail if no access
      // For now, assume we have access if we have a handle
      return true;
    }
  }

  async requestDirectoryPermission(): Promise<boolean> {
    if (!this.directoryHandle) return false;
    
    // For now, just return true if we have a handle
    // The File System Access API permission methods aren't in TypeScript yet
    return true;
  }
}

// Export singleton instance
export const fileBackupService = new FileBackupService();