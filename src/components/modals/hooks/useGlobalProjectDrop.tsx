import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  extractFileFromItems,
  findAcceptableFile,
} from '@/components/modals/utils/projectFileAcceptance';

type UseGlobalProjectDropOptions = {
  onDropProjectFile: (file: File) => void;
};

export function useGlobalProjectDrop({ onDropProjectFile }: UseGlobalProjectDropOptions) {
  const [dragActive, setDragActive] = useState(false);
  const dragDepth = useRef(0);

  const resetDragState = useCallback(() => {
    dragDepth.current = 0;
    setDragActive(false);
  }, []);

  const handleDrop = useCallback((event: DragEvent) => {
    const file = findAcceptableFile(event.dataTransfer?.files ?? null)
      || extractFileFromItems(event.dataTransfer?.items ?? null);
    if (!file) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    resetDragState();
    onDropProjectFile(file);
  }, [onDropProjectFile, resetDragState]);

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
        extractFileFromItems(event.dataTransfer?.items ?? null)
          || findAcceptableFile(event.dataTransfer?.files ?? null),
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
        resetDragState();
      }
    };

    const handleWindowDrop = (event: DragEvent) => {
      const file = findAcceptableFile(event.dataTransfer?.files ?? null)
        || extractFileFromItems(event.dataTransfer?.items ?? null);
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
  }, [handleDrop, resetDragState]);

  const dropOverlay = useMemo(() => {
    if (!dragActive) {
      return null;
    }

    return (
      <div className='fixed inset-0 z-[60] pointer-events-none flex items-center justify-center bg-black/60'>
        <div className='border-2 border-dashed border-[#8AE9FF] bg-[#0A1A1F]/70 text-[#8AE9FF] px-8 py-6 rounded-lg text-lg font-medium'>
          Drop your Vessel project to load
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

