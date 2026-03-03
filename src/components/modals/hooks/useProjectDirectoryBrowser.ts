import { useCallback, useEffect, useRef, useState } from 'react';

import { hasSupportedExtension } from '@/components/modals/utils/projectFileAcceptance';
import type { DirectoryProjectEntry } from '@/components/modals/types';

type DirectoryPickerOptions = {
  mode?: 'read' | 'readwrite';
  startIn?: FileSystemHandle | string;
};

type FileSystemHandlePermissionDescriptor = {
  mode?: 'read' | 'readwrite';
};

type DirectoryHandleWithPermissions = FileSystemDirectoryHandle & {
  queryPermission?: (descriptor?: FileSystemHandlePermissionDescriptor) => Promise<PermissionState>;
  requestPermission?: (descriptor?: FileSystemHandlePermissionDescriptor) => Promise<PermissionState>;
  entries?: () => AsyncIterableIterator<[string, FileSystemHandle]>;
  values?: () => AsyncIterableIterator<FileSystemHandle>;
};

type UseProjectDirectoryBrowserOptions = {
  isOpen: boolean;
  ensureModalOpen: () => void;
  onEntryOpen: (entry: DirectoryProjectEntry, options?: { autoImport?: boolean }) => Promise<void>;
};

type UseProjectDirectoryBrowserResult = {
  directoryHandle: FileSystemDirectoryHandle | null;
  directoryEntries: DirectoryProjectEntry[];
  selectedEntryIndex: number | null;
  isScanningDirectory: boolean;
  directoryError: string | null;
  pickDirectory: () => Promise<void>;
  refreshDirectory: () => void;
  selectEntryAtIndex: (index: number, loadProject?: boolean, autoImport?: boolean) => void;
  setSelectedEntryIndexByName: (entryName: string | null) => void;
};

const FILE_NAME_COLLATOR = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

const LAST_DIRECTORY_DB_NAME = 'vessel-directory-handles';
const LAST_DIRECTORY_STORE_NAME = 'handles';
const LAST_DIRECTORY_KEY = 'last-directory-handle';
const LAST_DIRECTORY_ENTRY_KEY = 'vessel:last-directory-entry';
const TIMESTAMP_HYDRATION_BATCH_SIZE = 20;
const TIMESTAMP_HYDRATION_PRIORITY_COUNT = 40;

let lastDirectoryHandle: FileSystemDirectoryHandle | null = null;
let lastDirectoryEntries: DirectoryProjectEntry[] = [];
let lastSelectedEntryName: string | null = null;

async function openDirectoryHandleDB(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) {
    return null;
  }

  return await new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(LAST_DIRECTORY_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(LAST_DIRECTORY_STORE_NAME)) {
        db.createObjectStore(LAST_DIRECTORY_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open directory handle store'));
  });
}

async function persistLastDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  try {
    const db = await openDirectoryHandleDB();
    if (!db) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(LAST_DIRECTORY_STORE_NAME, 'readwrite');
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        const error = tx.error ?? new Error('Failed to persist directory handle');
        db.close();
        reject(error);
      };
      const store = tx.objectStore(LAST_DIRECTORY_STORE_NAME);
      store.put(handle, LAST_DIRECTORY_KEY);
    });
  } catch (error) {
    console.warn('[LoadProjectModal] Failed to persist directory handle', error);
  }
}

async function loadPersistedDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openDirectoryHandleDB();
    if (!db) {
      return null;
    }
    return await new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
      const tx = db.transaction(LAST_DIRECTORY_STORE_NAME, 'readonly');
      tx.oncomplete = () => db.close();
      tx.onerror = () => {
        const error = tx.error ?? new Error('Failed to read directory handle');
        db.close();
        reject(error);
      };
      const store = tx.objectStore(LAST_DIRECTORY_STORE_NAME);
      const request = store.get(LAST_DIRECTORY_KEY);
      request.onsuccess = () => {
        resolve((request.result as FileSystemDirectoryHandle | undefined) ?? null);
      };
      request.onerror = () => {
        const error = request.error ?? new Error('Failed to load directory handle');
        db.close();
        reject(error);
      };
    });
  } catch (error) {
    console.warn('[LoadProjectModal] Failed to load persisted directory handle', error);
    return null;
  }
}

const storeLastDirectoryEntryName = (name: string | null) => {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    if (name) {
      window.localStorage.setItem(LAST_DIRECTORY_ENTRY_KEY, name);
    } else {
      window.localStorage.removeItem(LAST_DIRECTORY_ENTRY_KEY);
    }
  } catch (error) {
    console.warn('[LoadProjectModal] Failed to persist directory entry name', error);
  }
};

const readStoredDirectoryEntryName = (): string | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return window.localStorage.getItem(LAST_DIRECTORY_ENTRY_KEY);
  } catch (error) {
    console.warn('[LoadProjectModal] Failed to read directory entry name', error);
    return null;
  }
};

const compareEntries = (a: DirectoryProjectEntry, b: DirectoryProjectEntry) => {
  const aStartsWithDigit = /^\d/.test(a.name.trimStart());
  const bStartsWithDigit = /^\d/.test(b.name.trimStart());

  if (aStartsWithDigit !== bStartsWithDigit) {
    return aStartsWithDigit ? 1 : -1;
  }

  const aNameWithoutExtension = a.name.replace(/\.[^/.]+$/, '');
  const bNameWithoutExtension = b.name.replace(/\.[^/.]+$/, '');
  const byStemName = FILE_NAME_COLLATOR.compare(bNameWithoutExtension, aNameWithoutExtension);
  if (byStemName !== 0) {
    return byStemName;
  }

  return FILE_NAME_COLLATOR.compare(b.name, a.name);
};

export const sortDirectoryProjectEntries = (entries: DirectoryProjectEntry[]): DirectoryProjectEntry[] => {
  return [...entries].sort(compareEntries);
};

const yieldToBrowser = async () => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
};

export function useProjectDirectoryBrowser({
  isOpen,
  ensureModalOpen,
  onEntryOpen,
}: UseProjectDirectoryBrowserOptions): UseProjectDirectoryBrowserResult {
  const [directoryHandle, setDirectoryHandle] = useState<FileSystemDirectoryHandle | null>(() => lastDirectoryHandle);
  const [directoryEntries, setDirectoryEntries] = useState<DirectoryProjectEntry[]>(() => lastDirectoryEntries);
  const [isScanningDirectory, setIsScanningDirectory] = useState(false);
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  const [selectedEntryIndex, setSelectedEntryIndex] = useState<number | null>(() => {
    if (!lastDirectoryEntries.length || !lastSelectedEntryName) {
      return null;
    }
    const idx = lastDirectoryEntries.findIndex((entry) => entry.name === lastSelectedEntryName);
    return idx >= 0 ? idx : null;
  });

  const directoryEntriesRef = useRef(directoryEntries);
  const scanVersionRef = useRef(0);
  const timestampAbortRef = useRef<AbortController | null>(null);
  const wasOpenRef = useRef(isOpen);

  useEffect(() => {
    directoryEntriesRef.current = directoryEntries;
  }, [directoryEntries]);

  const setSelectedEntryIndexByName = useCallback((entryName: string | null) => {
    if (!entryName) {
      setSelectedEntryIndex(null);
      lastSelectedEntryName = null;
      storeLastDirectoryEntryName(null);
      return;
    }
    const entries = directoryEntriesRef.current;
    const idx = entries.findIndex((entry) => entry.name === entryName);
    if (idx >= 0) {
      setSelectedEntryIndex(idx);
      lastSelectedEntryName = entryName;
      storeLastDirectoryEntryName(entryName);
      return;
    }

    setSelectedEntryIndex(null);
    lastSelectedEntryName = null;
    storeLastDirectoryEntryName(null);
  }, []);

  const hydrateEntryTimestamps = useCallback(async (
    scanVersion: number,
    entriesSnapshot: DirectoryProjectEntry[],
    selectedName: string | null,
    signal: AbortSignal,
  ) => {
    const preferredIndexes = new Set<number>();
    if (selectedName) {
      const selectedIdx = entriesSnapshot.findIndex((entry) => entry.name === selectedName);
      if (selectedIdx >= 0) {
        preferredIndexes.add(selectedIdx);
      }
    }
    for (let idx = 0; idx < Math.min(TIMESTAMP_HYDRATION_PRIORITY_COUNT, entriesSnapshot.length); idx += 1) {
      preferredIndexes.add(idx);
    }

    const orderedIndexes = [
      ...Array.from(preferredIndexes),
      ...entriesSnapshot.map((_, idx) => idx).filter((idx) => !preferredIndexes.has(idx)),
    ];

    for (let orderIndex = 0; orderIndex < orderedIndexes.length; orderIndex += 1) {
      if (signal.aborted || scanVersion !== scanVersionRef.current) {
        return;
      }

      const index = orderedIndexes[orderIndex];
      const entry = entriesSnapshot[index];
      if (!entry) {
        continue;
      }

      try {
        const file = await entry.handle.getFile();
        if (signal.aborted || scanVersion !== scanVersionRef.current) {
          return;
        }

        if (file.size === 0) {
          setDirectoryEntries((prev) => {
            if (scanVersion !== scanVersionRef.current) {
              return prev;
            }
            const existingIndex = prev.findIndex((candidate) => candidate.name === entry.name);
            if (existingIndex < 0) {
              return prev;
            }
            const next = [...prev];
            next.splice(existingIndex, 1);
            directoryEntriesRef.current = next;
            lastDirectoryEntries = next;
            return next;
          });
          continue;
        }

        setDirectoryEntries((prev) => {
          if (scanVersion !== scanVersionRef.current) {
            return prev;
          }
          const existingIndex = prev.findIndex((candidate) => candidate.name === entry.name);
          if (existingIndex < 0) {
            return prev;
          }
          const existing = prev[existingIndex];
          if (!existing || existing.lastModified === file.lastModified) {
            return prev;
          }
          const next = [...prev];
          next[existingIndex] = { ...existing, lastModified: file.lastModified };
          const sorted = sortDirectoryProjectEntries(next);
          directoryEntriesRef.current = sorted;
          lastDirectoryEntries = sorted;
          return sorted;
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
        console.warn('[LoadProjectModal] Unable to inspect file timestamp', error);
      }

      if ((orderIndex + 1) % TIMESTAMP_HYDRATION_BATCH_SIZE === 0) {
        await yieldToBrowser();
      }
    }
  }, []);

  const scanDirectoryForProjects = useCallback(async (handle: FileSystemDirectoryHandle) => {
    const scanVersion = scanVersionRef.current + 1;
    scanVersionRef.current = scanVersion;
    timestampAbortRef.current?.abort();

    setDirectoryError(null);
    setIsScanningDirectory(true);
    try {
      const nextEntries: DirectoryProjectEntry[] = [];
      const iteratorSource = handle as DirectoryHandleWithPermissions;

      if (typeof iteratorSource.entries === 'function') {
        for await (const [name, entry] of iteratorSource.entries()) {
          if (entry.kind !== 'file' || !hasSupportedExtension(name)) {
            continue;
          }
          nextEntries.push({ name, handle: entry as FileSystemFileHandle });
        }
      } else if (typeof iteratorSource.values === 'function') {
        for await (const entry of iteratorSource.values()) {
          const name = entry.name;
          if (entry.kind !== 'file' || !hasSupportedExtension(name)) {
            continue;
          }
          nextEntries.push({ name, handle: entry as FileSystemFileHandle });
        }
      } else {
        console.warn('[LoadProjectModal] Directory handle does not support iteration');
      }

      if (scanVersion !== scanVersionRef.current) {
        return;
      }

      const sortedEntries = sortDirectoryProjectEntries(nextEntries);
      directoryEntriesRef.current = sortedEntries;
      setDirectoryEntries(sortedEntries);
      setDirectoryHandle(handle);
      lastDirectoryHandle = handle;
      lastDirectoryEntries = sortedEntries;

      if (sortedEntries.length === 0) {
        setDirectoryError('No Vessel project files found in this folder.');
        setSelectedEntryIndexByName(null);
      } else {
        setDirectoryError(null);
        const storedEntryName = lastSelectedEntryName ?? readStoredDirectoryEntryName();
        const hasStoredEntry = storedEntryName
          ? sortedEntries.some((entry) => entry.name === storedEntryName)
          : false;
        if (hasStoredEntry && storedEntryName) {
          setSelectedEntryIndexByName(storedEntryName);
        } else {
          setSelectedEntryIndexByName(sortedEntries[0]?.name ?? null);
        }

        const abortController = new AbortController();
        timestampAbortRef.current = abortController;
        void hydrateEntryTimestamps(
          scanVersion,
          sortedEntries,
          storedEntryName ?? sortedEntries[0]?.name ?? null,
          abortController.signal,
        );
      }

      void persistLastDirectoryHandle(handle);
    } catch (error) {
      if (scanVersion !== scanVersionRef.current) {
        return;
      }
      console.error('[LoadProjectModal] Failed to read directory', error);
      directoryEntriesRef.current = [];
      setDirectoryEntries([]);
      setDirectoryError(error instanceof Error ? error.message : 'Failed to read folder');
      lastDirectoryEntries = [];
      setSelectedEntryIndexByName(null);
    } finally {
      if (scanVersion === scanVersionRef.current) {
        setIsScanningDirectory(false);
      }
    }
  }, [hydrateEntryTimestamps, setSelectedEntryIndexByName]);

  const pickDirectory = useCallback(async () => {
    if (!('showDirectoryPicker' in window)) {
      setDirectoryError('Your browser does not support folder access. Use the file picker or drag & drop instead.');
      return;
    }
    try {
      const handle = await (window as Window & {
        showDirectoryPicker?: (options?: DirectoryPickerOptions) => Promise<FileSystemDirectoryHandle>;
      }).showDirectoryPicker?.();
      if (!handle) {
        return;
      }
      ensureModalOpen();
      await scanDirectoryForProjects(handle);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }
      console.error('[LoadProjectModal] showDirectoryPicker failed', error);
      setDirectoryError(error instanceof Error ? error.message : 'Failed to open folder');
    }
  }, [ensureModalOpen, scanDirectoryForProjects]);

  const refreshDirectory = useCallback(() => {
    if (directoryHandle) {
      void scanDirectoryForProjects(directoryHandle);
    }
  }, [directoryHandle, scanDirectoryForProjects]);

  useEffect(() => {
    if (!isOpen || directoryHandle) {
      return;
    }

    let cancelled = false;
    const restoreLastDirectory = async () => {
      try {
        let handle = lastDirectoryHandle;
        if (!handle) {
          handle = await loadPersistedDirectoryHandle();
        }
        if (!handle || cancelled) {
          return;
        }

        const handleWithPerms = handle as DirectoryHandleWithPermissions;
        if (handleWithPerms.queryPermission) {
          try {
            let status = await handleWithPerms.queryPermission({ mode: 'read' });
            if (status === 'prompt' && handleWithPerms.requestPermission) {
              status = await handleWithPerms.requestPermission({ mode: 'read' });
            }
            if (status !== 'granted') {
              return;
            }
          } catch (error) {
            console.warn('[LoadProjectModal] Failed to confirm directory permission', error);
          }
        }
        if (!cancelled) {
          await scanDirectoryForProjects(handle);
        }
      } catch (error) {
        console.warn('[LoadProjectModal] Failed to restore last directory handle', error);
      }
    };

    void restoreLastDirectory();
    return () => {
      cancelled = true;
    };
  }, [directoryHandle, isOpen, scanDirectoryForProjects]);

  useEffect(() => {
    if (!isOpen || !directoryHandle) {
      return;
    }
    if (directoryEntries.length > 0) {
      return;
    }

    let cancelled = false;
    const handleWithPerms = directoryHandle as DirectoryHandleWithPermissions;
    void (async () => {
      let hasPermission = true;
      if (handleWithPerms.queryPermission) {
        try {
          const status = await handleWithPerms.queryPermission({ mode: 'read' });
          if (status === 'prompt' && handleWithPerms.requestPermission) {
            const requestStatus = await handleWithPerms.requestPermission({ mode: 'read' });
            hasPermission = requestStatus === 'granted';
          } else {
            hasPermission = status === 'granted';
          }
        } catch (error) {
          console.warn('[LoadProjectModal] Failed to query directory permission', error);
          hasPermission = true;
        }
      }
      if (!cancelled && hasPermission) {
        await scanDirectoryForProjects(directoryHandle);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [directoryEntries.length, directoryHandle, isOpen, scanDirectoryForProjects]);

  useEffect(() => {
    const wasOpen = wasOpenRef.current;
    wasOpenRef.current = isOpen;

    if (!isOpen || wasOpen || !directoryHandle) {
      return;
    }

    void scanDirectoryForProjects(directoryHandle);
  }, [directoryHandle, isOpen, scanDirectoryForProjects]);

  useEffect(() => {
    return () => {
      timestampAbortRef.current?.abort();
    };
  }, []);

  const selectEntryAtIndex = useCallback((index: number, loadProject: boolean = true, autoImport: boolean = false) => {
    const entries = directoryEntriesRef.current;
    if (index < 0 || index >= entries.length) {
      return;
    }
    const entry = entries[index];
    setSelectedEntryIndexByName(entry.name);
    if (loadProject) {
      void onEntryOpen(entry, { autoImport });
    }
  }, [onEntryOpen, setSelectedEntryIndexByName]);

  return {
    directoryHandle,
    directoryEntries,
    selectedEntryIndex,
    isScanningDirectory,
    directoryError,
    pickDirectory,
    refreshDirectory,
    selectEntryAtIndex,
    setSelectedEntryIndexByName,
  };
}
