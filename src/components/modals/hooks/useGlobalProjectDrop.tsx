import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  extractFileFromItems,
  findAcceptableFile,
} from '@/components/modals/utils/projectFileAcceptance';

type DroppedDirectoryHandle = FileSystemDirectoryHandle & {
  kind: 'directory';
};

type DroppedProjectPayload =
  | { kind: 'file'; file: File }
  | { kind: 'directory'; handle: DroppedDirectoryHandle };

type FileSystemHandleDropItem = DataTransferItem & {
  getAsFileSystemHandle?: () => Promise<FileSystemHandle | null>;
};

type UseGlobalProjectDropOptions = {
  onDropProject: (payload: DroppedProjectPayload) => void | Promise<void>;
};

const hasPotentialDirectoryPayload = (
  items: DataTransferItemList | null | undefined,
) => {
  if (!items || items.length === 0) {
    return false;
  }

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index] as FileSystemHandleDropItem | null;
    if (!item || item.kind !== 'file' || typeof item.getAsFileSystemHandle !== 'function') {
      continue;
    }

    if (item.getAsFile?.() == null) {
      return true;
    }
  }

  return false;
};

const hasSupportedProjectPayload = (dataTransfer: DataTransfer | null | undefined) => {
  if (!dataTransfer) {
    return false;
  }

  if (findAcceptableFile(dataTransfer.files ?? null)) {
    return true;
  }

  if (extractFileFromItems(dataTransfer.items ?? null)) {
    return true;
  }

  return hasPotentialDirectoryPayload(dataTransfer.items ?? null);
};

const extractDirectoryHandleFromItems = async (
  items: DataTransferItemList | null | undefined,
): Promise<DroppedDirectoryHandle | null> => {
  if (!items || items.length === 0) {
    return null;
  }

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index] as FileSystemHandleDropItem | null;
    if (!item || item.kind !== 'file' || typeof item.getAsFileSystemHandle !== 'function') {
      continue;
    }

    try {
      const handle = await item.getAsFileSystemHandle();
      if (handle?.kind === 'directory') {
        return handle as DroppedDirectoryHandle;
      }
    } catch (error) {
      console.warn('[LoadProjectModal] Failed to inspect dropped handle', error);
    }
  }

  return null;
};

export function useGlobalProjectDrop({ onDropProject }: UseGlobalProjectDropOptions) {
  const [dragActive, setDragActive] = useState(false);
  const dragDepth = useRef(0);

  const resetDragState = useCallback(() => {
    dragDepth.current = 0;
    setDragActive(false);
  }, []);

  const handleDrop = useCallback(async (event: DragEvent) => {
    if (!hasSupportedProjectPayload(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const directoryHandle = await extractDirectoryHandleFromItems(event.dataTransfer?.items ?? null);
    if (directoryHandle) {
      resetDragState();
      void onDropProject({ kind: 'directory', handle: directoryHandle });
      return;
    }

    const file = findAcceptableFile(event.dataTransfer?.files ?? null)
      || extractFileFromItems(event.dataTransfer?.items ?? null);
    if (!file) {
      resetDragState();
      return;
    }

    resetDragState();
    void onDropProject({ kind: 'file', file });
  }, [onDropProject, resetDragState]);

  useEffect(() => {
    const handleDragEnter = (event: DragEvent) => {
      if (!hasSupportedProjectPayload(event.dataTransfer)) {
        return;
      }
      event.preventDefault();
      dragDepth.current += 1;
      setDragActive(true);
    };

    const handleDragOver = (event: DragEvent) => {
      if (!hasSupportedProjectPayload(event.dataTransfer)) {
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
        resetDragState();
      }
    };

    const handleWindowDrop = (event: DragEvent) => {
      if (!hasSupportedProjectPayload(event.dataTransfer)) {
        return;
      }
      void handleDrop(event);
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
  }, [handleDrop, resetDragState]);

  const dropOverlay = useMemo(() => {
    if (!dragActive) {
      return null;
    }

    return (
      <div className='fixed inset-0 z-[60] pointer-events-none flex items-center justify-center bg-black/60'>
        <div className='border-2 border-dashed border-[#8AE9FF] bg-[#0A1A1F]/70 text-[#8AE9FF] px-8 py-6 rounded-lg text-lg font-medium'>
          Drop a Vessel project or folder to load
        </div>
      </div>
    );
  }, [dragActive]);

  return {
    dragActive,
    resetDragState,
    dropOverlay,
  };
}
