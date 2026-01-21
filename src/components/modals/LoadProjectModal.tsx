'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef, useLayoutEffect } from 'react';
import Button from '../ui/Button';
import { useAppStore } from '@/stores/useAppStore';
import { useKeyboardScope } from '@/hooks/useKeyboardScope';
import {
  PROJECT_FILE_ACCEPT,
  PROJECT_FILE_MIME,
  PROJECT_FILE_MIME_ACCEPT,
  LEGACY_PROJECT_FILE_MIME
} from '@/constants/projectFiles';
import {
  deserializeProject,
  generateProjectThumbnail,
  readProjectManifest
} from '@/utils/projectIO';
import type { Project } from '@/types';

interface LoadProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ProjectPreview {
  projectName: string;
  width: number;
  height: number;
  createdAt?: string;
  modifiedAt?: string;
  thumbnail?: string;
  hasEmbeddedThumbnail: boolean;
  fileName: string;
  fileSize: number;
}

interface DirectoryProjectEntry {
  name: string;
  handle: FileSystemFileHandle;
  lastModified?: number;
}

const PREVIEW_MAX_SCALE = 2;

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

let lastDirectoryHandle: FileSystemDirectoryHandle | null = null;
let lastDirectoryEntries: DirectoryProjectEntry[] = [];
let lastSelectedEntryName: string | null = null;

const LAST_DIRECTORY_DB_NAME = 'vessel-directory-handles';
const LAST_DIRECTORY_STORE_NAME = 'handles';
const LAST_DIRECTORY_KEY = 'last-directory-handle';
const LAST_DIRECTORY_ENTRY_KEY = 'vessel:last-directory-entry';

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

const ACCEPTED_EXTENSIONS = new Set(
  PROJECT_FILE_ACCEPT.map(ext => ext.toLowerCase())
);

const ACCEPTED_MIME_TYPES = new Set(
  PROJECT_FILE_MIME_ACCEPT.map(mime => mime.toLowerCase())
);

const FILE_INPUT_ACCEPT_ATTRIBUTE = [...PROJECT_FILE_ACCEPT, ...PROJECT_FILE_MIME_ACCEPT].join(',');

const formatDimensions = (width: number, height: number) => `${width} × ${height}`;

const formatFileSize = (bytes: number) => {
  if (!Number.isFinite(bytes)) {
    return 'Unknown size';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const isThumbnailEffectivelyBlank = async (thumbnail: string): Promise<boolean> => {
  if (typeof document === 'undefined') {
    return false;
  }
  try {
    const image = new Image();
    const loadPromise = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Failed to load thumbnail'));
    });
    image.src = thumbnail;
    await loadPromise;
    const width = Math.max(1, image.naturalWidth || image.width);
    const height = Math.max(1, image.naturalHeight || image.height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings);
    if (!ctx) {
      return false;
    }
    ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(0, 0, width, height).data;
    const totalPixels = width * height;
    const step = Math.max(4, Math.floor(totalPixels / 4096)) * 4;
    for (let i = 3; i < data.length; i += step) {
      if (data[i] !== 0) {
        return false;
      }
    }
    return true;
  } catch (error) {
    console.warn('[LoadProjectModal] Failed to inspect thumbnail', error);
    return false;
  }
};

const compareEntries = (a: DirectoryProjectEntry, b: DirectoryProjectEntry) => {
  const aTime = a.lastModified ?? 0;
  const bTime = b.lastModified ?? 0;
  if (aTime === bTime) {
    return a.name.localeCompare(b.name);
  }
  return bTime - aTime;
};

const hasSupportedExtension = (fileName: string) => {
  const lower = fileName.toLowerCase();
  for (const ext of ACCEPTED_EXTENSIONS) {
    if (lower.endsWith(ext)) {
      return true;
    }
  }
  return false;
};

const isAcceptableFile = (file: File | null | undefined): file is File => {
  if (!file) {
    return false;
  }
  if (hasSupportedExtension(file.name)) {
    return true;
  }
  const mime = file.type?.toLowerCase() ?? '';
  return mime !== '' && ACCEPTED_MIME_TYPES.has(mime);
};

const extractFileFromItems = (items: DataTransferItemList | null | undefined): File | null => {
  if (!items || items.length === 0) {
    return null;
  }
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item.kind !== 'file') {
      continue;
    }
    const file = item.getAsFile();
    if (isAcceptableFile(file)) {
      return file;
    }
  }
  return null;
};

const findAcceptableFile = (fileList: FileList | null | undefined): File | null => {
  if (!fileList || fileList.length === 0) {
    return null;
  }
  for (const file of Array.from(fileList)) {
    if (isAcceptableFile(file)) {
      return file;
    }
  }
  return null;
};

export function LoadProjectModal({ isOpen, onClose }: LoadProjectModalProps) {
  useKeyboardScope('modal', isOpen);

  const importProject = useAppStore(state => state.importProject);
  const toggleModal = useAppStore(state => state.toggleModal);

  const [shouldRender, setShouldRender] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const dragDepth = useRef(0);

  const [isProcessing, setIsProcessing] = useState(false);
  const [applyInFlight, setApplyInFlight] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projectData, setProjectData] = useState<ArrayBuffer | null>(null);
  const [cachedProject, setCachedProject] = useState<Project | null>(null);
  const [preview, setPreview] = useState<ProjectPreview | null>(null);
  const [selectedFileHandle, setSelectedFileHandle] = useState<FileSystemFileHandle | null>(null);
  const [directoryHandle, setDirectoryHandle] = useState<FileSystemDirectoryHandle | null>(() => lastDirectoryHandle);
  const [directoryEntries, setDirectoryEntries] = useState<DirectoryProjectEntry[]>(() => lastDirectoryEntries);
  const [isScanningDirectory, setIsScanningDirectory] = useState(false);
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedEntryIndex, setSelectedEntryIndex] = useState<number | null>(() => {
    if (!lastDirectoryEntries.length || !lastSelectedEntryName) {
      return null;
    }
    const idx = lastDirectoryEntries.findIndex(entry => entry.name === lastSelectedEntryName);
    return idx >= 0 ? idx : null;
  });
  const [previewOffset, setPreviewOffset] = useState({ x: 0, y: 0 });
  const [previewScale, setPreviewScale] = useState(1);
  const [isPreviewPanning, setIsPreviewPanning] = useState(false);
  const [modalDimensions, setModalDimensions] = useState({ width: 1120, height: 820 });
  const [modalPosition, setModalPosition] = useState({ x: 0, y: 0 });
  const [isDraggingModal, setIsDraggingModal] = useState(false);
  const directoryEntriesRef = useRef(directoryEntries);
  const selectionRestoredRef = useRef(false);
  const previewWrapperRef = useRef<HTMLDivElement | null>(null);
  const previewOffsetRef = useRef(previewOffset);
  const panStateRef = useRef({
    isPanning: false,
    startX: 0,
    startY: 0,
    baseX: 0,
    baseY: 0,
    pointerId: 0
  });
  const modalDragOffsetRef = useRef({ x: 0, y: 0 });

  const stopPreviewPan = useCallback((pointerId?: number) => {
    const wrapper = previewWrapperRef.current;
    if (pointerId !== undefined && wrapper?.hasPointerCapture(pointerId)) {
      wrapper.releasePointerCapture(pointerId);
    }
    panStateRef.current.isPanning = false;
    setIsPreviewPanning(false);
  }, []);

  const resetState = useCallback(() => {
    stopPreviewPan();
    setIsProcessing(false);
    setApplyInFlight(false);
    setError(null);
    setProjectData(null);
    setCachedProject(null);
    setPreview(null);
    setSelectedFileHandle(null);
    setDirectoryError(null);
    setSelectedEntryIndex(null);
    setPreviewOffset({ x: 0, y: 0 });
    setIsPreviewPanning(false);
    setPreviewScale(1);
  }, [stopPreviewPan]);

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      setTimeout(() => setIsVisible(true), 10);
      if (typeof window !== 'undefined') {
        const width = Math.min(960, window.innerWidth - 32);
        const height = Math.min(Math.round(window.innerHeight * 0.8), window.innerHeight - 32);
        setModalDimensions({ width, height });
        setModalPosition({
          x: Math.max(16, Math.round((window.innerWidth - width) / 2)),
          y: Math.max(16, Math.round((window.innerHeight - height) / 2))
        });
      }
    } else {
      setIsVisible(false);
      setTimeout(() => setShouldRender(false), 200);
      resetState();
      dragDepth.current = 0;
      setDragActive(false);
      selectionRestoredRef.current = false;
      setIsDraggingModal(false);
    }
  }, [isOpen, resetState]);

  useEffect(() => {
    directoryEntriesRef.current = directoryEntries;
  }, [directoryEntries]);

  const computeCenteredOffset = useCallback((container: number, content: number) => {
    if (content <= container) {
      return (container - content) / 2;
    }
    return (container - content) / 2;
  }, []);

  const clampOffset = useCallback((value: number, container: number, content: number) => {
    if (!Number.isFinite(container) || !Number.isFinite(content)) {
      return 0;
    }
    if (content <= container) {
      return (container - content) / 2;
    }
    const min = container - content;
    const max = 0;
    return Math.min(max, Math.max(min, value));
  }, []);

  const centerPreview = useCallback(() => {
    if (!preview?.thumbnail || !previewWrapperRef.current) {
      return;
    }
    const rect = previewWrapperRef.current.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }
    const fitScale = Math.min(
      PREVIEW_MAX_SCALE,
      rect.width / preview.width,
      rect.height / preview.height
    );
    const safeScale = Number.isFinite(fitScale) && fitScale > 0 ? fitScale : PREVIEW_MAX_SCALE;
    setPreviewScale(safeScale);
    const scaledWidth = preview.width * safeScale;
    const scaledHeight = preview.height * safeScale;
    const nextX = clampOffset(
      computeCenteredOffset(rect.width, scaledWidth),
      rect.width,
      scaledWidth
    );
    const nextY = clampOffset(
      computeCenteredOffset(rect.height, scaledHeight),
      rect.height,
      scaledHeight
    );
    setPreviewOffset({ x: nextX, y: nextY });
  }, [clampOffset, computeCenteredOffset, preview]);

  useEffect(() => {
    previewOffsetRef.current = previewOffset;
  }, [previewOffset]);

  useLayoutEffect(() => {
    if (!preview) {
      return;
    }
    let cancelled = false;
    const attemptCenter = () => {
      if (cancelled) {
        return;
      }
      if (isPreviewPanning) {
        return;
      }
      const wrapper = previewWrapperRef.current;
      if (!wrapper) {
        return;
      }
      const rect = wrapper.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        requestAnimationFrame(attemptCenter);
        return;
      }
      centerPreview();
    };
    const frame = requestAnimationFrame(attemptCenter);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [preview, modalDimensions.width, modalDimensions.height, centerPreview, isPreviewPanning]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handleResize = () => {
      if (typeof window === 'undefined') {
        return;
      }
      const width = Math.min(960, window.innerWidth - 32);
      const height = Math.min(Math.round(window.innerHeight * 0.8), window.innerHeight - 32);
      setModalDimensions({ width, height });
      setModalPosition((prev) => {
        const maxX = Math.max(16, window.innerWidth - width - 16);
        const maxY = Math.max(16, window.innerHeight - height - 16);
        return {
          x: Math.min(Math.max(16, prev.x), maxX),
          y: Math.min(Math.max(16, prev.y), maxY)
        };
      });
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isOpen]);

  const closeModal = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleEscape = useCallback((event: KeyboardEvent) => {
    if (event.key === 'Escape' && (isOpen || dragActive)) {
      if (dragActive) {
        setDragActive(false);
        dragDepth.current = 0;
      } else {
        closeModal();
      }
    }
  }, [closeModal, dragActive, isOpen]);

  useEffect(() => {
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [handleEscape]);

  const updateSelectionForEntry = useCallback((entryName: string | null) => {
    if (!entryName) {
      setSelectedEntryIndex(null);
      lastSelectedEntryName = null;
      storeLastDirectoryEntryName(null);
      return;
    }
    const entries = directoryEntriesRef.current;
    const idx = entries.findIndex(entry => entry.name === entryName);
    if (idx >= 0) {
      setSelectedEntryIndex(idx);
      lastSelectedEntryName = entryName;
      storeLastDirectoryEntryName(entryName);
    } else {
      setSelectedEntryIndex(null);
      lastSelectedEntryName = null;
      storeLastDirectoryEntryName(null);
    }
  }, []);

  const processProjectFile = useCallback(async (
    file: File,
    options?: { autoImport?: boolean; fileHandle?: FileSystemFileHandle | null }
  ) => {
    const autoImport = options?.autoImport ?? false;
    setIsProcessing(true);
    setError(null);
    if (autoImport) {
      setApplyInFlight(true);
    }

    try {
      if (file.size === 0) {
        setError('File is empty or incomplete. Autosave may have failed to write the file.');
        setProjectData(null);
        setPreview(null);
        setCachedProject(null);
        return;
      }
      const buffer = await file.arrayBuffer();
      const vesselProject = await readProjectManifest(buffer);
      const { project, metadata } = vesselProject;

      const previewDetails: ProjectPreview = {
        projectName: project.name,
        width: project.width,
        height: project.height,
        createdAt: metadata?.created,
        modifiedAt: metadata?.modified,
        thumbnail: project.thumbnail,
        hasEmbeddedThumbnail: Boolean(project.thumbnail),
        fileName: file.name,
        fileSize: file.size
      };

      setProjectData(buffer);
      setPreview(previewDetails);
      updateSelectionForEntry(file.name);
      setCachedProject(null);
      setSelectedFileHandle(options?.fileHandle ?? null);

      let hydratedProject: Project | null = null;
      const ensureHydratedProject = async (): Promise<Project> => {
        if (!hydratedProject) {
          hydratedProject = await deserializeProject(buffer);
        }
        return hydratedProject;
      };

      const thumbnailIsBlank = project.thumbnail ? await isThumbnailEffectivelyBlank(project.thumbnail) : false;

      if (!project.thumbnail || thumbnailIsBlank) {
        try {
          const hydrated = await ensureHydratedProject();
          const thumbnail = generateProjectThumbnail(
            hydrated,
            hydrated.layers ?? [],
            512
          );
          setCachedProject(hydrated);
          setPreview(prev => prev ? {
            ...prev,
            thumbnail,
            hasEmbeddedThumbnail: false
          } : prev);
        } catch (thumbnailError) {
          console.warn('[LoadProjectModal] Failed to generate thumbnail', thumbnailError);
        }
      } else {
        setCachedProject(null);
      }

      if (autoImport) {
        try {
          const hydrated = await ensureHydratedProject();
          setCachedProject(hydrated);
          await importProject(hydrated, { fileName: file.name, fileHandle: options?.fileHandle ?? null });
          closeModal();
          return;
        } catch (importError) {
          throw importError;
        }
      }
    } catch (err) {
      console.error('[LoadProjectModal] Failed to process project file', err);
      setProjectData(null);
      setPreview(null);
      setCachedProject(null);
      setError(err instanceof Error ? err.message : 'Failed to read project file');
    } finally {
      setIsProcessing(false);
      if (autoImport) {
        setApplyInFlight(false);
      }
    }
  }, [closeModal, importProject, updateSelectionForEntry]);

  const ensureModalOpenForDrop = useCallback(() => {
    if (!isOpen) {
      toggleModal('loadProject');
    }
  }, [isOpen, toggleModal]);

  const handleDrop = useCallback((event: DragEvent) => {
    const file = findAcceptableFile(event.dataTransfer?.files ?? null) ||
      extractFileFromItems(event.dataTransfer?.items ?? null);
    if (!file) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    dragDepth.current = 0;
    setDragActive(false);
    ensureModalOpenForDrop();
    void processProjectFile(file);
  }, [ensureModalOpenForDrop, processProjectFile]);

  useEffect(() => {
    const handleDragEnter = (event: DragEvent) => {
      const hasFile = Boolean(extractFileFromItems(event.dataTransfer?.items ?? null));
      if (!hasFile) {
        return;
      }
      event.preventDefault();
      dragDepth.current += 1;
      setDragActive(true);
    };

    const handleDragOver = (event: DragEvent) => {
      const hasFile = Boolean(
        extractFileFromItems(event.dataTransfer?.items ?? null) ||
        findAcceptableFile(event.dataTransfer?.files ?? null)
      );
      if (!hasFile) {
        return;
      }
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'copy';
      }
    };

    const handleDragLeave = () => {
      if (dragDepth.current > 0) {
        dragDepth.current -= 1;
      }
      if (dragDepth.current <= 0) {
        setDragActive(false);
        dragDepth.current = 0;
      }
    };

    const handleWindowDrop = (event: DragEvent) => {
      const file = findAcceptableFile(event.dataTransfer?.files ?? null) ||
        extractFileFromItems(event.dataTransfer?.items ?? null);
      if (!file) {
        return;
      }
      handleDrop(event);
    };

    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('drop', handleWindowDrop);

    return () => {
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('drop', handleWindowDrop);
    };
  }, [handleDrop]);

  const handleFileInputChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = findAcceptableFile(event.target.files);
    if (file) {
      void processProjectFile(file);
    }
    event.target.value = '';
  }, [processProjectFile]);

  const handleSelectFile = useCallback(async () => {
    if ('showOpenFilePicker' in window) {
      try {
        const [handle] = await (window as Window & {
          showOpenFilePicker?: (options: {
            types?: { description: string; accept: Record<string, string[]> }[];
            multiple?: boolean;
          }) => Promise<FileSystemFileHandle[]>;
        }).showOpenFilePicker!({
          types: [{
            description: 'Vessel Project Files',
            accept: {
              [PROJECT_FILE_MIME]: PROJECT_FILE_ACCEPT,
              [LEGACY_PROJECT_FILE_MIME]: PROJECT_FILE_ACCEPT
            }
          }],
          multiple: false
        });
        const file = await handle.getFile();
        ensureModalOpenForDrop();
        void processProjectFile(file, { fileHandle: handle });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
        console.warn('[LoadProjectModal] showOpenFilePicker failed, falling back', error);
      }
    }

    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  }, [ensureModalOpenForDrop, processProjectFile]);

  const scanDirectoryForProjects = useCallback(async (handle: FileSystemDirectoryHandle) => {
    setDirectoryError(null);
    setIsScanningDirectory(true);
    selectionRestoredRef.current = false;
    try {
      const nextEntries: DirectoryProjectEntry[] = [];
      const iteratorSource = handle as DirectoryHandleWithPermissions;

      if (typeof iteratorSource.entries === 'function') {
        for await (const [name, entry] of iteratorSource.entries()!) {
          if (entry.kind !== 'file') {
            continue;
          }
          if (!hasSupportedExtension(name)) {
            continue;
          }
          const fileHandle = entry as FileSystemFileHandle;
          let lastModified: number | undefined;
          try {
            const file = await fileHandle.getFile();
            if (file.size === 0) {
              continue;
            }
            lastModified = file.lastModified;
          } catch (err) {
            console.warn('[LoadProjectModal] Unable to inspect file timestamp', err);
          }
          nextEntries.push({ name, handle: fileHandle, lastModified });
        }
      } else if (typeof iteratorSource.values === 'function') {
        for await (const entry of iteratorSource.values()!) {
          const name = entry.name;
          if (entry.kind !== 'file') {
            continue;
          }
          if (!hasSupportedExtension(name)) {
            continue;
          }
          const fileHandle = entry as FileSystemFileHandle;
          let lastModified: number | undefined;
          try {
            const file = await fileHandle.getFile();
            if (file.size === 0) {
              continue;
            }
            lastModified = file.lastModified;
          } catch (err) {
            console.warn('[LoadProjectModal] Unable to inspect file timestamp', err);
          }
          nextEntries.push({ name, handle: fileHandle, lastModified });
        }
      } else {
        console.warn('[LoadProjectModal] Directory handle does not support iteration');
      }

      nextEntries.sort(compareEntries);
      directoryEntriesRef.current = nextEntries;
      setDirectoryEntries(nextEntries);
      setDirectoryHandle(handle);
      lastDirectoryHandle = handle;
      lastDirectoryEntries = nextEntries;

      if (nextEntries.length === 0) {
        setDirectoryError('No Vessel project files found in this folder.');
        updateSelectionForEntry(null);
        selectionRestoredRef.current = true;
      } else {
        setDirectoryError(null);
        const storedEntryName = lastSelectedEntryName ?? readStoredDirectoryEntryName();
        const hasStoredEntry = storedEntryName ? nextEntries.some(entry => entry.name === storedEntryName) : false;

        if (hasStoredEntry && storedEntryName) {
          updateSelectionForEntry(storedEntryName);
          selectionRestoredRef.current = true;
        } else {
          const firstEntryName = nextEntries[0]?.name ?? null;
          if (firstEntryName) {
            updateSelectionForEntry(firstEntryName);
            selectionRestoredRef.current = true;
          }
        }
      }

      void persistLastDirectoryHandle(handle);
    } catch (err) {
      console.error('[LoadProjectModal] Failed to read directory', err);
      directoryEntriesRef.current = [];
      setDirectoryEntries([]);
      setDirectoryError(err instanceof Error ? err.message : 'Failed to read folder');
      lastDirectoryEntries = [];
      updateSelectionForEntry(null);
      selectionRestoredRef.current = true;
    } finally {
      setIsScanningDirectory(false);
    }
  }, [updateSelectionForEntry]);

  const handlePickDirectory = useCallback(async () => {
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
      ensureModalOpenForDrop();
      await scanDirectoryForProjects(handle);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }
      console.error('[LoadProjectModal] showDirectoryPicker failed', error);
      setDirectoryError(error instanceof Error ? error.message : 'Failed to open folder');
    }
  }, [ensureModalOpenForDrop, scanDirectoryForProjects]);

  const handleRefreshDirectory = useCallback(() => {
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

        if (cancelled) {
          return;
        }

        await scanDirectoryForProjects(handle);

        if (cancelled) {
          return;
        }

        const storedEntryName = readStoredDirectoryEntryName();
        if (storedEntryName) {
          updateSelectionForEntry(storedEntryName);
          selectionRestoredRef.current = true;
        }
      } catch (error) {
        console.warn('[LoadProjectModal] Failed to restore last directory handle', error);
      }
    };

    void restoreLastDirectory();

    return () => {
      cancelled = true;
    };
  }, [directoryHandle, isOpen, scanDirectoryForProjects, updateSelectionForEntry]);

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
      if (cancelled || !hasPermission) {
        return;
      }
      await scanDirectoryForProjects(directoryHandle);
    })();
    return () => {
      cancelled = true;
    };
  }, [directoryEntries.length, directoryHandle, isOpen, scanDirectoryForProjects]);

  const handleDirectoryEntrySelect = useCallback(async (entry: DirectoryProjectEntry, options?: { autoImport?: boolean }) => {
    try {
      const file = await entry.handle.getFile();
      ensureModalOpenForDrop();
      void processProjectFile(file, { ...options, fileHandle: entry.handle });
    } catch (error) {
      console.error('[LoadProjectModal] Failed to open file from directory', error);
      setDirectoryError(error instanceof Error ? error.message : 'Failed to open file from folder');
    }
  }, [ensureModalOpenForDrop, processProjectFile]);

  const selectEntryAtIndex = useCallback((index: number, loadProject: boolean = true, autoImport: boolean = false) => {
    const entries = directoryEntriesRef.current;
    if (index < 0 || index >= entries.length) {
      return;
    }
    const entry = entries[index];
    updateSelectionForEntry(entry.name);
    if (loadProject) {
      void handleDirectoryEntrySelect(entry, { autoImport });
    }
  }, [handleDirectoryEntrySelect, updateSelectionForEntry]);

  const handlePreviewPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!preview?.thumbnail) {
      return;
    }
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    const wrapper = previewWrapperRef.current;
    if (!wrapper) {
      return;
    }
    wrapper.setPointerCapture(event.pointerId);
    panStateRef.current = {
      isPanning: true,
      startX: event.clientX,
      startY: event.clientY,
      baseX: previewOffsetRef.current.x,
      baseY: previewOffsetRef.current.y,
      pointerId: event.pointerId
    };
    setIsPreviewPanning(true);
  }, [preview]);

  const handlePreviewPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!panStateRef.current.isPanning) {
      return;
    }
    event.preventDefault();
    const dx = event.clientX - panStateRef.current.startX;
    const dy = event.clientY - panStateRef.current.startY;
    const wrapper = previewWrapperRef.current;
    if (!wrapper || !preview) {
      return;
    }
    const rect = wrapper.getBoundingClientRect();
    const scaledWidth = preview.width * previewScale;
    const scaledHeight = preview.height * previewScale;
    setPreviewOffset({
      x: clampOffset(panStateRef.current.baseX + dx, rect.width, scaledWidth),
      y: clampOffset(panStateRef.current.baseY + dy, rect.height, scaledHeight)
    });
  }, [clampOffset, preview, previewScale]);

  const handlePreviewPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!panStateRef.current.isPanning) {
      return;
    }
    stopPreviewPan(event.pointerId);
  }, [stopPreviewPan]);

  const handlePreviewDoubleClick = useCallback(() => {
    centerPreview();
  }, [centerPreview]);

  const selectedFileName = preview?.fileName ?? null;

  const handleModalDragStart = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!isOpen) {
      return;
    }
    event.preventDefault();
    modalDragOffsetRef.current = {
      x: event.clientX - modalPosition.x,
      y: event.clientY - modalPosition.y
    };
    setIsDraggingModal(true);
  }, [isOpen, modalPosition.x, modalPosition.y]);

  useEffect(() => {
    if (!isDraggingModal) {
      return;
    }
    const handleMouseMove = (event: MouseEvent) => {
      const width = modalDimensions.width;
      const height = modalDimensions.height;
      const maxX = Math.max(16, window.innerWidth - width - 16);
      const maxY = Math.max(16, window.innerHeight - height - 16);
      const nextX = Math.min(Math.max(16, event.clientX - modalDragOffsetRef.current.x), maxX);
      const nextY = Math.min(Math.max(16, event.clientY - modalDragOffsetRef.current.y), maxY);
      setModalPosition({ x: nextX, y: nextY });
    };
    const handleMouseUp = () => {
      setIsDraggingModal(false);
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingModal, modalDimensions.height, modalDimensions.width]);

  const handleConfirm = useCallback(async () => {
    if (!projectData || applyInFlight) {
      return;
    }
    setApplyInFlight(true);
    setError(null);

    try {
      const project = cachedProject ?? await deserializeProject(projectData);
      await importProject(project, { fileName: selectedFileName, fileHandle: selectedFileHandle });
      closeModal();
    } catch (err) {
      console.error('[LoadProjectModal] Failed to import project', err);
      setError(err instanceof Error ? err.message : 'Failed to load project');
    } finally {
      setApplyInFlight(false);
    }
  }, [applyInFlight, cachedProject, closeModal, importProject, projectData, selectedFileName, selectedFileHandle]);

  const dropOverlay = useMemo(() => {
    if (!dragActive) {
      return null;
    }

    return (
      <div className="fixed inset-0 z-[60] pointer-events-none flex items-center justify-center bg-black/60">
        <div className="border-2 border-dashed border-[#8AE9FF] bg-[#0A1A1F]/70 text-[#8AE9FF] px-8 py-6 rounded-lg text-lg font-medium">
          Drop your Vessel project to load
        </div>
      </div>
    );
  }, [dragActive]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handleKeyNavigation = (event: KeyboardEvent) => {
      if (!directoryEntriesRef.current.length) {
        return;
      }
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      if (tagName === 'input' || tagName === 'textarea' || target?.isContentEditable) {
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const currentIndex = selectedEntryIndex ?? (event.key === 'ArrowDown' ? -1 : directoryEntriesRef.current.length);
        const nextIndex = event.key === 'ArrowDown'
          ? Math.min(directoryEntriesRef.current.length - 1, currentIndex + 1)
          : Math.max(0, currentIndex - 1);
        selectEntryAtIndex(nextIndex, true);
      } else if (event.key === 'Home') {
        event.preventDefault();
        selectEntryAtIndex(0, true);
      } else if (event.key === 'End') {
        event.preventDefault();
        selectEntryAtIndex(directoryEntriesRef.current.length - 1, true);
      }
    };

    window.addEventListener('keydown', handleKeyNavigation);
    return () => window.removeEventListener('keydown', handleKeyNavigation);
  }, [isOpen, selectEntryAtIndex, selectedEntryIndex]);

  const renderPreview = () => {
    let previewPanel: React.ReactNode;
    if (isProcessing && !preview) {
      previewPanel = (
        <div className="flex-1 min-h-0 flex items-center justify-center">
          <div className="text-[#D9D9D9] text-sm">Processing project…</div>
        </div>
      );
    } else if (error) {
      previewPanel = (
        <div className="flex-1 min-h-0 flex items-center justify-center">
          <div className="text-red-400 text-sm text-center max-w-xs">
            {error}
          </div>
        </div>
      );
    } else if (!preview) {
      previewPanel = (
        <div className="flex-1 min-h-0 flex flex-col items-center justify-center border border-dashed border-[#4A4A4A] rounded-lg bg-[#1E1F1E]/50 text-center px-6">
          <div className="text-[#D9D9D9] text-base font-medium mb-2">
            Select or drop a Vessel project
          </div>
          <div className="text-[#8C8C8C] text-sm">
            Supports {Array.from(ACCEPTED_EXTENSIONS).join(', ')}
          </div>
        </div>
      );
    } else {
      const checkerboardStyle: React.CSSProperties = {
        backgroundImage:
          'linear-gradient(45deg, rgba(255,255,255,0.06) 25%, transparent 25%),' +
          'linear-gradient(-45deg, rgba(255,255,255,0.06) 25%, transparent 25%),' +
          'linear-gradient(45deg, transparent 75%, rgba(255,255,255,0.06) 75%),' +
          'linear-gradient(-45deg, transparent 75%, rgba(255,255,255,0.06) 75%)',
        backgroundSize: '24px 24px',
        backgroundPosition: '0 0, 0 12px, 12px -12px, -12px 0',
      };

      previewPanel = (
        <div
          ref={previewWrapperRef}
          className={`flex-1 min-h-0 rounded-lg border border-[#3A3A3A] bg-[#101110] overflow-hidden relative ${preview.thumbnail ? (isPreviewPanning ? 'cursor-grabbing' : 'cursor-grab') : ''}`}
          style={{
            ...(preview?.thumbnail ? { touchAction: 'none' } : undefined),
            ...checkerboardStyle,
          }}
          onPointerDown={preview?.thumbnail ? handlePreviewPointerDown : undefined}
          onPointerMove={preview?.thumbnail ? handlePreviewPointerMove : undefined}
          onPointerUp={preview?.thumbnail ? handlePreviewPointerUp : undefined}
          onPointerCancel={preview?.thumbnail ? handlePreviewPointerUp : undefined}
          onPointerLeave={preview?.thumbnail ? handlePreviewPointerUp : undefined}
          onDoubleClick={preview?.thumbnail ? handlePreviewDoubleClick : undefined}
          >
          {preview.thumbnail ? (
            <div
              className="will-change-transform"
              style={{ transform: `translate3d(${previewOffset.x}px, ${previewOffset.y}px, 0)` }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={preview.thumbnail}
                alt={`${preview.projectName} preview`}
                style={{
                  width: `${preview.width * previewScale}px`,
                  height: `${preview.height * previewScale}px`,
                  display: 'block'
                }}
                draggable={false}
              />
            </div>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-[#8C8C8C] text-sm">
              No thumbnail available
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="flex flex-1 gap-6 min-h-0 min-w-0">
        <div className="flex-1 flex flex-col gap-4 min-h-0 min-w-0">
          {previewPanel}
          <div className="rounded-lg border border-[#2A2A2A] bg-[#161716] p-4 text-sm flex-shrink-0">
            {preview ? (() => {
              const segments: string[] = [
                `Canvas ${formatDimensions(preview.width, preview.height)}`,
                `File ${preview.fileName} (${formatFileSize(preview.fileSize)})`
              ];
              if (preview.modifiedAt) {
                segments.push(`Modified ${new Date(preview.modifiedAt).toLocaleDateString()}`);
              }
              if (!preview.hasEmbeddedThumbnail && preview.thumbnail) {
                segments.push('Thumbnail generated from layers');
              }
              const metadataLine = segments.join(' • ');
              return (
                <div className="text-[#D9D9D9] overflow-x-auto whitespace-nowrap">{metadataLine}</div>
              );
            })() : (
              <div className="text-[#8C8C8C] text-sm">
                Pick a project to see details and a live preview here.
              </div>
            )}
          </div>
        </div>
        <div className="w-64 flex flex-col text-sm min-h-0">
          <div className="flex items-center justify-between mb-2 flex-shrink-0">
            <div className="text-[#8C8C8C] uppercase tracking-wide text-xs">Folder Files</div>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleRefreshDirectory}
              disabled={!directoryHandle || isScanningDirectory}
            >
              Refresh
            </Button>
          </div>
          {directoryError && (
            <div className="text-red-400 text-xs mb-2">{directoryError}</div>
          )}
          <div className="flex-1 flex flex-col gap-1 overflow-y-auto pr-1">
            {isScanningDirectory ? (
              <div className="text-[#8C8C8C] text-sm">Scanning folder…</div>
            ) : directoryEntries.length === 0 ? (
              <div className="text-[#555] text-sm">
                {directoryHandle ? 'No project files in this folder.' : 'Pick a folder to browse project files.'}
              </div>
            ) : (
              directoryEntries.map((entry, index) => {
                const isSelected = selectedEntryIndex === index;
                const buttonClass = `text-left px-2 py-1 rounded border transition-colors ${
                  isSelected
                    ? 'border-[#0A1A1F] bg-[#F2F2F2] text-[#0A1A1F]'
                    : 'border-transparent hover:bg-[#242424] text-[#D9D9D9]'
                }`;
                const timestampClass = isSelected ? 'text-[#3A3A3A] text-[11px]' : 'text-[#8C8C8C] text-[11px]';

                return (
                  <button
                    key={entry.name}
                    onClick={() => selectEntryAtIndex(index, true)}
                    onDoubleClick={() => selectEntryAtIndex(index, true, true)}
                    className={buttonClass}
                  >
                    <div className="text-sm truncate">{entry.name}</div>
                    {entry.lastModified && (
                      <div className={timestampClass}>
                        {new Date(entry.lastModified).toLocaleString()}
                      </div>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      </div>
    );
  };

  if (!shouldRender && !dragActive) {
    return null;
  }

  return (
    <>
      {dropOverlay}
      {shouldRender && (
        <div
          className={`fixed inset-0 z-50 transition-opacity duration-200 ${isVisible ? 'opacity-100' : 'opacity-0'}`}
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.45)' }}
          onClick={closeModal}
        >
          <div
            className="fixed bg-[#1A1A1A] border border-[#333] rounded-lg shadow-2xl flex h-full flex-col"
            style={{
              width: modalDimensions.width,
              height: modalDimensions.height,
              left: modalPosition.x,
              top: modalPosition.y
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="flex items-center justify-between px-6 py-4 border-b border-[#2A2A2A]"
              onMouseDown={handleModalDragStart}
              style={{ cursor: isDraggingModal ? 'grabbing' : 'grab' }}
            >
              <h2 className="text-[#D9D9D9] text-lg font-semibold">Load Project</h2>
              <Button variant="secondary" size="sm" onClick={closeModal}>
                Close
              </Button>
            </div>
            <div className="p-6 flex-1 min-h-0 flex flex-col gap-4 overflow-hidden">
              <div className="flex gap-3 items-center flex-wrap">
                <Button onClick={handleSelectFile} disabled={isProcessing || applyInFlight}>
                  Browse Files
                </Button>
                <Button
                  variant="secondary"
                  onClick={handlePickDirectory}
                  disabled={isScanningDirectory}
                >
                  Browse Folder
                </Button>
                <div className="text-[#8C8C8C] text-sm">
                  or drag & drop a project anywhere in the app
                </div>
              </div>
              <div className="flex-1 min-h-0 flex">
                {renderPreview()}
              </div>
            </div>
            <div className="px-6 py-4 border-t border-[#2A2A2A] flex justify-end gap-3">
              <Button
                variant="secondary"
                onClick={closeModal}
                disabled={applyInFlight}
              >
                Cancel
              </Button>
              <Button
                onClick={handleConfirm}
                disabled={!projectData || isProcessing || applyInFlight}
              >
                {applyInFlight ? 'Loading…' : 'Load Project'}
              </Button>
            </div>
          </div>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept={FILE_INPUT_ACCEPT_ATTRIBUTE}
        className="hidden"
        onChange={handleFileInputChange}
      />
    </>
  );
}

export default LoadProjectModal;
