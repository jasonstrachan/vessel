'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

import { LoadProjectModalBody } from '@/components/modals/LoadProjectModalBody';
import { useDraggableModal } from '@/components/modals/hooks/useDraggableModal';
import { useGlobalProjectDrop } from '@/components/modals/hooks/useGlobalProjectDrop';
import { useProjectDirectoryBrowser } from '@/components/modals/hooks/useProjectDirectoryBrowser';
import { useProjectPreviewLoader } from '@/components/modals/hooks/useProjectPreviewLoader';
import { usePreviewViewportPanZoom } from '@/components/modals/hooks/usePreviewViewportPanZoom';
import type { DirectoryProjectEntry } from '@/components/modals/types';
import {
  FILE_INPUT_ACCEPT_ATTRIBUTE,
  findAcceptableFile,
} from '@/components/modals/utils/projectFileAcceptance';
import {
  LEGACY_PROJECT_FILE_MIME,
  PROJECT_FILE_ACCEPT,
  PROJECT_FILE_MIME,
} from '@/constants/projectFiles';
import { useKeyboardScope } from '@/hooks/useKeyboardScope';
import { useAppStore } from '@/stores/useAppStore';
import Button from '../ui/Button';

interface LoadProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function LoadProjectModal({ isOpen, onClose }: LoadProjectModalProps) {
  useKeyboardScope('modal', isOpen);

  const importProject = useAppStore((state) => state.importProject);
  const toggleModal = useAppStore((state) => state.toggleModal);

  const [shouldRender, setShouldRender] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  const {
    modalDimensions,
    modalPosition,
    isDraggingModal,
    centerModal,
    clampModalToViewport,
    handleModalDragStart,
    resetDrag,
  } = useDraggableModal();

  const fileInputRef = useRef<HTMLInputElement>(null);

  const ensureModalOpenForDrop = useCallback(() => {
    if (!isOpen) {
      toggleModal('loadProject');
    }
  }, [isOpen, toggleModal]);

  const closeModal = useCallback(() => {
    onClose();
  }, [onClose]);

  const {
    isProcessing,
    applyInFlight,
    error,
    warning,
    preview,
    projectData,
    processProjectFile,
    setError,
    confirmLoad,
    reset,
  } = useProjectPreviewLoader({
    importProject,
    closeModal,
  });

  const {
    previewOffset,
    previewScale,
    isPreviewPanning,
    previewWrapperRef,
    resetPreviewViewport,
    handlePreviewPointerDown,
    handlePreviewPointerMove,
    handlePreviewPointerUp,
    handlePreviewDoubleClick,
  } = usePreviewViewportPanZoom({
    preview,
    modalWidth: modalDimensions.width,
    modalHeight: modalDimensions.height,
  });

  const handleDirectoryEntryOpen = useCallback(async (
    entry: DirectoryProjectEntry,
    options?: { autoImport?: boolean },
  ) => {
    try {
      const file = await entry.handle.getFile();
      ensureModalOpenForDrop();
      await processProjectFile(file, { ...options, fileHandle: entry.handle });
    } catch (openError) {
      console.error('[LoadProjectModal] Failed to open file from directory', openError);
      setError(openError instanceof Error ? openError.message : 'Failed to open file from folder');
    }
  }, [ensureModalOpenForDrop, processProjectFile, setError]);

  const {
    directoryHandle,
    directoryEntries,
    selectedEntryIndex,
    isScanningDirectory,
    directoryError,
    pickDirectory,
    openDirectoryHandle,
    refreshDirectory,
    selectEntryAtIndex,
    setSelectedEntryIndexByName,
  } = useProjectDirectoryBrowser({
    isOpen,
    ensureModalOpen: ensureModalOpenForDrop,
    onEntryOpen: handleDirectoryEntryOpen,
  });

  const handleDropProject = useCallback((payload: { kind: 'file'; file: File } | { kind: 'directory'; handle: FileSystemDirectoryHandle }) => {
    if (payload.kind === 'directory') {
      void openDirectoryHandle(payload.handle);
      return;
    }

    ensureModalOpenForDrop();
    setSelectedEntryIndexByName(payload.file.name);
    void processProjectFile(payload.file);
  }, [ensureModalOpenForDrop, openDirectoryHandle, processProjectFile, setSelectedEntryIndexByName]);

  const { dragActive, resetDragState, dropOverlay } = useGlobalProjectDrop({
    onDropProject: handleDropProject,
  });

  useEffect(() => {
    if (preview) {
      resetPreviewViewport();
    }
  }, [preview, resetPreviewViewport]);

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      setTimeout(() => setIsVisible(true), 10);
      centerModal();
    } else {
      setIsVisible(false);
      setTimeout(() => setShouldRender(false), 200);
      reset();
      resetDragState();
      resetDrag();
    }
  }, [centerModal, isOpen, reset, resetDrag, resetDragState]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    clampModalToViewport();
    window.addEventListener('resize', clampModalToViewport);
    return () => window.removeEventListener('resize', clampModalToViewport);
  }, [clampModalToViewport, isOpen]);

  const handleEscape = useCallback((event: KeyboardEvent) => {
    if (event.key === 'Escape' && (isOpen || dragActive)) {
      if (dragActive) {
        resetDragState();
      } else {
        closeModal();
      }
    }
  }, [closeModal, dragActive, isOpen, resetDragState]);

  useEffect(() => {
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [handleEscape]);

  const handleFileInputChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = findAcceptableFile(event.target.files);
    if (file) {
      setSelectedEntryIndexByName(file.name);
      void processProjectFile(file);
    }
    event.target.value = '';
  }, [processProjectFile, setSelectedEntryIndexByName]);

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
              [LEGACY_PROJECT_FILE_MIME]: PROJECT_FILE_ACCEPT,
            },
          }],
          multiple: false,
        });
        const file = await handle.getFile();
        ensureModalOpenForDrop();
        setSelectedEntryIndexByName(file.name);
        void processProjectFile(file, { fileHandle: handle });
        return;
      } catch (pickerError) {
        if (pickerError instanceof DOMException && pickerError.name === 'AbortError') {
          return;
        }
        console.warn('[LoadProjectModal] showOpenFilePicker failed, falling back', pickerError);
      }
    }

    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  }, [ensureModalOpenForDrop, processProjectFile, setSelectedEntryIndexByName]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyNavigation = (event: KeyboardEvent) => {
      if (!directoryEntries.length) {
        return;
      }
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      if (tagName === 'input' || tagName === 'textarea' || target?.isContentEditable) {
        return;
      }

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const currentIndex = selectedEntryIndex ?? (event.key === 'ArrowDown' ? -1 : directoryEntries.length);
        const nextIndex = event.key === 'ArrowDown'
          ? Math.min(directoryEntries.length - 1, currentIndex + 1)
          : Math.max(0, currentIndex - 1);
        selectEntryAtIndex(nextIndex, true);
      } else if (event.key === 'Home') {
        event.preventDefault();
        selectEntryAtIndex(0, true);
      } else if (event.key === 'End') {
        event.preventDefault();
        selectEntryAtIndex(directoryEntries.length - 1, true);
      }
    };

    window.addEventListener('keydown', handleKeyNavigation);
    return () => window.removeEventListener('keydown', handleKeyNavigation);
  }, [directoryEntries, isOpen, selectEntryAtIndex, selectedEntryIndex]);

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
              top: modalPosition.y,
            }}
            onClick={(event) => event.stopPropagation()}
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
                <Button variant="secondary" onClick={pickDirectory} disabled={isScanningDirectory}>
                  Browse Folder
                </Button>
                <div className="text-[#8C8C8C] text-sm">or drag & drop a project file or folder anywhere in the app</div>
              </div>
              <div className="flex-1 min-h-0 flex">
                <LoadProjectModalBody
                  isProcessing={isProcessing}
                  error={error}
                  warning={warning}
                  preview={preview}
                  previewOffset={previewOffset}
                  previewScale={previewScale}
                  isPreviewPanning={isPreviewPanning}
                  previewWrapperRef={previewWrapperRef}
                  handlePreviewPointerDown={handlePreviewPointerDown}
                  handlePreviewPointerMove={handlePreviewPointerMove}
                  handlePreviewPointerUp={handlePreviewPointerUp}
                  handlePreviewDoubleClick={handlePreviewDoubleClick}
                  directoryHandle={directoryHandle}
                  directoryEntries={directoryEntries}
                  selectedEntryIndex={selectedEntryIndex}
                  isScanningDirectory={isScanningDirectory}
                  directoryError={directoryError}
                  onRefreshDirectory={refreshDirectory}
                  onSelectEntryAtIndex={selectEntryAtIndex}
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-[#2A2A2A] flex justify-end gap-3">
              <Button variant="secondary" onClick={closeModal} disabled={applyInFlight}>
                Cancel
              </Button>
              <Button onClick={confirmLoad} disabled={!projectData || isProcessing || applyInFlight}>
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
