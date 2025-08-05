// File backup settings component for autosave
// Allows users to configure automatic file backup to a selected directory

import React, { useState, useCallback, useEffect } from 'react';
import { useAutosave } from '../../utils/autosave';
import { fileBackupService } from '../../utils/fileBackupService';

interface FileBackupSettingsProps {
  className?: string;
}

export default function FileBackupSettings({ className = '' }: FileBackupSettingsProps) {
  const {
    fileBackup,
    setFileBackupEnabled,
    setFileBackupFile,
    setFileBackupDirectory
  } = useAutosave();

  const [isSelecting, setIsSelecting] = useState(false);
  const [isSupported, setIsSupported] = useState(false);

  useEffect(() => {
    // Check browser support only on client side
    setIsSupported(fileBackupService.isFileBackupSupported());
  }, []);

  const handleToggleFileBackup = useCallback(async () => {
    if (!fileBackup.enabled) {
      // Enabling file backup - check if we need to select file/directory
      if (fileBackup.mode === 'single-file') {
        if (!fileBackup.fileHandle) {
          await handleSelectFile();
        } else {
          // Check if we still have access to the file
          const hasAccess = await fileBackupService.checkFileAccess();
          if (!hasAccess) {
            await handleSelectFile();
          }
        }
      } else {
        if (!fileBackup.directoryHandle) {
          await handleSelectDirectory();
        } else {
          // Check if we still have access to the directory
          const hasAccess = await fileBackupService.checkDirectoryAccess();
          if (!hasAccess) {
            const granted = await fileBackupService.requestDirectoryPermission();
            if (!granted) {
              await handleSelectDirectory();
            }
          }
        }
      }
      setFileBackupEnabled(true);
    } else {
      // Disabling file backup
      setFileBackupEnabled(false);
    }
  }, [fileBackup.enabled, fileBackup.mode, fileBackup.fileHandle, fileBackup.directoryHandle, setFileBackupEnabled]);

  const handleSelectFile = useCallback(async () => {
    if (!isSupported) {
      alert('File backup is not supported in this browser. Please use Chrome or Edge.');
      return;
    }

    setIsSelecting(true);
    try {
      const result = await fileBackupService.selectBackupFile();
      
      if (result.success && result.path) {
        // Get the file handle from the service
        const file = fileBackupService.getBackupFile();
        if (file) {
          setFileBackupFile(file.handle, result.path);
          // File selected: result.path
        }
      } else if (result.error && !result.error.includes('cancelled')) {
        console.error('[FileBackupSettings] File selection failed:', result.error);
        alert(`Failed to select file: ${result.error}`);
      }
    } catch (error) {
      console.error('[FileBackupSettings] File selection error:', error);
      alert('Failed to select backup file. Please try again.');
    } finally {
      setIsSelecting(false);
    }
  }, [setFileBackupFile]);

  const handleSelectDirectory = useCallback(async () => {
    if (!isSupported) {
      alert('File backup is not supported in this browser. Please use Chrome or Edge.');
      return;
    }

    setIsSelecting(true);
    try {
      const result = await fileBackupService.selectBackupDirectory();
      
      if (result.success && result.path) {
        // Get the directory handle from the service
        const directory = fileBackupService.getBackupDirectory();
        if (directory) {
          setFileBackupDirectory(directory.handle, result.path);
          // Directory selected: result.path
        }
      } else if (result.error && !result.error.includes('cancelled')) {
        console.error('[FileBackupSettings] Directory selection failed:', result.error);
        alert(`Failed to select directory: ${result.error}`);
      }
    } catch (error) {
      console.error('[FileBackupSettings] Directory selection error:', error);
      alert('Failed to select backup directory. Please try again.');
    } finally {
      setIsSelecting(false);
    }
  }, [setFileBackupDirectory]);

  const handleClear = useCallback(() => {
    if (fileBackup.mode === 'single-file') {
      setFileBackupFile(null);
      fileBackupService.clearBackupFile();
    } else {
      setFileBackupDirectory(null);
      fileBackupService.clearBackupDirectory();
    }
    setFileBackupEnabled(false);
  }, [fileBackup.mode, setFileBackupFile, setFileBackupDirectory, setFileBackupEnabled]);

  const formatLastBackupTime = (time: Date): string => {
    const now = new Date();
    const diffMs = now.getTime() - time.getTime();
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    
    if (diffMinutes < 1) {
      return 'just now';
    } else if (diffMinutes === 1) {
      return '1 minute ago';
    } else if (diffMinutes < 60) {
      return `${diffMinutes} minutes ago`;
    } else {
      const diffHours = Math.floor(diffMinutes / 60);
      if (diffHours === 1) {
        return '1 hour ago';
      } else {
        return `${diffHours} hours ago`;
      }
    }
  };

  if (!isSupported) {
    return (
      <div className={`bg-[#2a2a2a] border border-[#3a3a3a] rounded-lg p-4 ${className}`}>
        <h3 className="text-white text-sm font-medium mb-2">File Backup</h3>
        <p className="text-gray-400 text-xs">
          File backup requires Chrome or Edge browser with File System Access API support.
        </p>
      </div>
    );
  }

  return (
    <div className={`bg-[#2a2a2a] border border-[#3a3a3a] rounded-lg p-4 ${className}`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-white text-sm font-medium">File Backup</h3>
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={fileBackup.enabled}
            onChange={handleToggleFileBackup}
            className="sr-only peer"
            disabled={isSelecting}
          />
          <div className="w-9 h-5 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
        </label>
      </div>

      <p className="text-gray-400 text-xs mb-3">
        {fileBackup.mode === 'single-file' 
          ? 'Save to one file that gets overwritten with each autosave.'
          : 'Save timestamped files to a selected folder alongside the normal autosave.'
        }
      </p>

      {fileBackup.backupPath ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-300 text-xs">
                {fileBackup.mode === 'single-file' ? 'Backup File:' : 'Backup Folder:'}
              </p>
              <p className="text-white text-xs font-mono">{fileBackup.backupPath}</p>
            </div>
            <button
              onClick={handleClear}
              className="text-red-400 hover:text-red-300 text-xs"
              title={fileBackup.mode === 'single-file' ? 'Clear backup file' : 'Clear backup directory'}
            >
              Clear
            </button>
          </div>

          {fileBackup.lastBackupTime && (
            <p className="text-gray-400 text-xs">
              Last backup: {formatLastBackupTime(fileBackup.lastBackupTime)}
            </p>
          )}
        </div>
      ) : (
        <button
          onClick={fileBackup.mode === 'single-file' ? handleSelectFile : handleSelectDirectory}
          disabled={isSelecting}
          className="w-full px-3 py-2 bg-[#3a3a3a] text-white text-xs rounded hover:bg-[#4a4a4a] transition-colors disabled:opacity-50"
        >
          {isSelecting ? 'Selecting...' : 
           fileBackup.mode === 'single-file' ? 'Choose Autosave File' : 'Select Backup Folder'}
        </button>
      )}

      {fileBackup.enabled && fileBackup.backupPath && (
        <div className="mt-2 p-2 bg-[#1a1a1a] rounded border border-[#3a3a3a]">
          <p className="text-green-300 text-xs">
            ✓ File backup active - autosaves {fileBackup.mode === 'single-file' ? 'overwrite your chosen file' : 'create timestamped .tb files'}
          </p>
        </div>
      )}
    </div>
  );
}