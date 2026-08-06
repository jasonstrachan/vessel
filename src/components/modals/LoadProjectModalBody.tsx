import React from 'react';

import type { DirectoryProjectEntry, ProjectPreview } from '@/components/modals/types';
import { PROJECT_FILE_ACCEPT } from '@/constants/projectFiles';
import Button from '../ui/Button';

type LoadProjectModalBodyProps = {
  isProcessing: boolean;
  isInspecting: boolean;
  processingStatus: string | null;
  error: string | null;
  warning: string | null;
  preview: ProjectPreview | null;
  previewOffset: { x: number; y: number };
  previewScale: number;
  isPreviewPanning: boolean;
  previewWrapperRef: React.RefObject<HTMLDivElement | null>;
  handlePreviewPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  handlePreviewPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
  handlePreviewPointerUp: (event: React.PointerEvent<HTMLDivElement>) => void;
  handlePreviewDoubleClick: () => void;
  directoryHandle: FileSystemDirectoryHandle | null;
  directoryEntries: DirectoryProjectEntry[];
  selectedEntryIndex: number | null;
  isScanningDirectory: boolean;
  directoryError: string | null;
  onRefreshDirectory: () => void;
  onSelectEntryAtIndex: (index: number, loadProject?: boolean, autoImport?: boolean) => void;
};

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

const getUniqueMessages = (messages: string[]) => Array.from(new Set(messages.filter(Boolean)));
const DIRECTORY_ROW_HEIGHT = 48;
const DIRECTORY_LIST_OVERSCAN = 4;
const DEFAULT_DIRECTORY_VIEWPORT_HEIGHT = 360;

export function LoadProjectModalBody({
  isProcessing,
  isInspecting,
  processingStatus,
  error,
  warning,
  preview,
  previewOffset,
  previewScale,
  isPreviewPanning,
  previewWrapperRef,
  handlePreviewPointerDown,
  handlePreviewPointerMove,
  handlePreviewPointerUp,
  handlePreviewDoubleClick,
  directoryHandle,
  directoryEntries,
  selectedEntryIndex,
  isScanningDirectory,
  directoryError,
  onRefreshDirectory,
  onSelectEntryAtIndex,
}: LoadProjectModalBodyProps) {
  const directoryListRef = React.useRef<HTMLDivElement | null>(null);
  const [directoryScrollTop, setDirectoryScrollTop] = React.useState(0);
  const [directoryViewportHeight, setDirectoryViewportHeight] = React.useState(
    DEFAULT_DIRECTORY_VIEWPORT_HEIGHT,
  );

  React.useLayoutEffect(() => {
    const list = directoryListRef.current;
    if (!list) {
      return;
    }
    const updateViewportHeight = () => {
      if (list.clientHeight > 0) {
        setDirectoryViewportHeight(list.clientHeight);
      }
    };
    updateViewportHeight();
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(updateViewportHeight);
    observer.observe(list);
    return () => observer.disconnect();
  }, []);

  React.useEffect(() => {
    const list = directoryListRef.current;
    if (!list || selectedEntryIndex === null) {
      return;
    }
    const rowTop = selectedEntryIndex * DIRECTORY_ROW_HEIGHT;
    const rowBottom = rowTop + DIRECTORY_ROW_HEIGHT;
    const viewportTop = list.scrollTop;
    const viewportBottom = viewportTop + list.clientHeight;
    if (rowTop < viewportTop) {
      list.scrollTop = rowTop;
      setDirectoryScrollTop(rowTop);
    } else if (rowBottom > viewportBottom) {
      const nextScrollTop = Math.max(0, rowBottom - list.clientHeight);
      list.scrollTop = nextScrollTop;
      setDirectoryScrollTop(nextScrollTop);
    }
  }, [directoryEntries.length, selectedEntryIndex]);

  const visibleDirectoryStart = Math.max(
    0,
    Math.floor(directoryScrollTop / DIRECTORY_ROW_HEIGHT) - DIRECTORY_LIST_OVERSCAN,
  );
  const visibleDirectoryEnd = Math.min(
    directoryEntries.length,
    Math.ceil((directoryScrollTop + directoryViewportHeight) / DIRECTORY_ROW_HEIGHT)
      + DIRECTORY_LIST_OVERSCAN,
  );
  const visibleDirectoryEntries = directoryEntries.slice(
    visibleDirectoryStart,
    visibleDirectoryEnd,
  );

  let previewPanel: React.ReactNode;
  if (isProcessing && !preview) {
    previewPanel = (
      <div className='flex-1 min-h-0 flex items-center justify-center'>
        <div className='text-[#D9D9D9] text-sm'>Processing project...</div>
      </div>
    );
  } else if (error) {
    previewPanel = (
      <div className='flex-1 min-h-0 flex items-center justify-center'>
        <div className='text-red-400 text-sm text-center max-w-xs'>{error}</div>
      </div>
    );
  } else if (!preview) {
    previewPanel = (
      <div className='flex-1 min-h-0 flex flex-col items-center justify-center border border-dashed border-[#4A4A4A] rounded-lg bg-[#1E1F1E]/50 text-center px-6'>
        <div className='text-[#D9D9D9] text-base font-medium mb-2'>Select or drop a Vessel project</div>
        <div className='text-[#8C8C8C] text-sm'>Supports {PROJECT_FILE_ACCEPT.join(', ')}</div>
      </div>
    );
  } else {
    const checkerboardStyle: React.CSSProperties = {
      backgroundImage:
        'linear-gradient(45deg, rgba(255,255,255,0.06) 25%, transparent 25%),'
        + 'linear-gradient(-45deg, rgba(255,255,255,0.06) 25%, transparent 25%),'
        + 'linear-gradient(45deg, transparent 75%, rgba(255,255,255,0.06) 75%),'
        + 'linear-gradient(-45deg, transparent 75%, rgba(255,255,255,0.06) 75%)',
      backgroundSize: '24px 24px',
      backgroundPosition: '0 0, 0 12px, 12px -12px, -12px 0',
    };

    previewPanel = (
      <div
        ref={previewWrapperRef}
        aria-busy={isProcessing || isInspecting}
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
            className='will-change-transform'
            style={{
              opacity: isProcessing ? 0.35 : 1,
              transform: `translate3d(${previewOffset.x}px, ${previewOffset.y}px, 0)`,
              transition: isProcessing ? 'opacity 120ms ease' : undefined,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={preview.thumbnail}
              alt={`${preview.projectName} preview`}
              style={{
                width: `${preview.width * previewScale}px`,
                height: `${preview.height * previewScale}px`,
                display: 'block',
              }}
              draggable={false}
            />
          </div>
        ) : (
          <div className='absolute inset-0 flex items-center justify-center text-[#8C8C8C] text-sm'>
            No thumbnail available
          </div>
        )}
        {(isProcessing || isInspecting) && (
          <div
            aria-live='polite'
            className='absolute right-3 top-3 border border-[#4A4A4A] bg-[#161716]/95 px-3 py-2 text-xs text-[#D9D9D9] shadow-lg'
          >
            {processingStatus ?? 'Processing project…'}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className='flex flex-1 gap-6 min-h-0 min-w-0'>
      <div className='flex-1 flex flex-col gap-4 min-h-0 min-w-0'>
        {previewPanel}
        <div className='rounded-lg border border-[#2A2A2A] bg-[#161716] p-4 text-sm flex-shrink-0'>
          {preview ? (() => {
            const segments: string[] = [
              `Canvas ${formatDimensions(preview.width, preview.height)}`,
              `File ${preview.fileName} (${formatFileSize(preview.fileSize)})`,
            ];
            if (preview.modifiedAt) {
              segments.push(`Modified ${new Date(preview.modifiedAt).toLocaleDateString()}`);
            }
            if (!preview.hasEmbeddedThumbnail && preview.thumbnail) {
              segments.push('Thumbnail generated from layers');
            }
            return <div className='text-[#D9D9D9] overflow-x-auto whitespace-nowrap'>{segments.join(' • ')}</div>;
          })() : (
            <div className='text-[#8C8C8C] text-sm'>Pick a project to see details and a live preview here.</div>
          )}
        </div>
        {warning && !preview?.healthReport && (
          <div className='rounded-lg border border-amber-700/60 bg-amber-950/40 p-3 text-amber-200 text-xs flex-shrink-0'>
            {warning}
          </div>
        )}
        {preview?.healthReport && (
          (() => {
            const report = preview.healthReport;
            const warningMessages = getUniqueMessages(report.warnings);
            const recommendationMessages = getUniqueMessages(report.recommendations)
              .filter((entry) => !warningMessages.includes(entry));
            const primaryWarning = warning ?? report.primaryWarning ?? warningMessages[0] ?? null;
            const secondaryWarnings = warningMessages.filter((entry) => entry !== primaryWarning);
            const topSection = report.sectionBreakdown[0]?.name ?? 'n/a';
            const largestLayer = report.largestLayers[0];
            const statusLabel = primaryWarning ? 'Needs attention' : 'Ready to load';
            const statusClass = primaryWarning
              ? 'border-amber-700/50 bg-amber-950/30 text-amber-100'
              : 'border-[#314231] bg-[#172017] text-[#B7D0B7]';

            return (
              <div className='rounded-lg border border-[#2A2A2A] bg-[#121312] p-4 text-sm flex flex-col gap-3 flex-shrink-0'>
                <div className='flex items-center justify-between gap-3'>
                  <div className='text-[#D9D9D9] font-medium'>Project Health</div>
                  <div className={`rounded border px-2 py-1 text-xs ${statusClass}`}>
                    {statusLabel}
                  </div>
                </div>

                {primaryWarning && (
                  <div className='rounded border border-amber-700/50 bg-amber-950/30 p-2 text-amber-100 text-xs'>
                    {primaryWarning}
                  </div>
                )}

                <div className='grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-[#A5AFA5]'>
                  <div>Archive {formatFileSize(report.archiveBytes)}</div>
                  <div>Binary {formatFileSize(report.binaryPayloadBytes)}</div>
                  <div>Manifest {formatFileSize(report.combinedManifestBytes)}</div>
                  <div>Compression {(report.compressionRatio * 100).toFixed(1)}%</div>
                  <div>Top {topSection}</div>
                  <div>
                    Largest {largestLayer?.layerName ?? 'n/a'}
                    {largestLayer ? ` (${formatFileSize(largestLayer.bytes)})` : ''}
                  </div>
                </div>

                {(secondaryWarnings.length > 0
                  || report.colorCycleDuplicationRiskLayers.length > 0
                  || report.unresolvedColorCycleDefLayers.length > 0
                  || recommendationMessages.length > 0) && (
                  <div className='rounded border border-[#273127] bg-[#171B17] p-2 text-xs text-[#A5AFA5] space-y-1'>
                    {secondaryWarnings.slice(0, 1).map((entry) => (
                      <div key={entry} className='text-amber-200'>{entry}</div>
                    ))}
                    {report.colorCycleDuplicationRiskLayers.length > 0 && (
                      <div className='text-amber-300'>
                        CC duplication risk: {report.colorCycleDuplicationRiskLayers.join(', ')}
                      </div>
                    )}
                    {report.unresolvedColorCycleDefLayers.length > 0 && (
                      <div className='text-red-300'>
                        Unresolved CC defs: {report.unresolvedColorCycleDefLayers.join(', ')}
                      </div>
                    )}
                    {recommendationMessages.slice(0, 2).map((entry) => (
                      <div key={entry}>{entry}</div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()
        )}
      </div>

      <div className='w-64 flex flex-col text-sm min-h-0'>
        <div className='flex items-center justify-between mb-2 flex-shrink-0'>
          <div className='text-[#8C8C8C] uppercase tracking-wide text-xs'>Folder Files</div>
          <Button
            variant='secondary'
            size='sm'
            onClick={onRefreshDirectory}
            disabled={!directoryHandle || isScanningDirectory}
          >
            Refresh
          </Button>
        </div>
        {directoryError && <div className='text-red-400 text-xs mb-2'>{directoryError}</div>}
        <div
          ref={directoryListRef}
          className='flex-1 overflow-y-auto pr-1'
          onScroll={(event) => setDirectoryScrollTop(event.currentTarget.scrollTop)}
        >
          {isScanningDirectory ? (
            <div className='text-[#8C8C8C] text-sm'>Scanning folder...</div>
          ) : directoryEntries.length === 0 ? (
            <div className='text-[#555] text-sm'>
              {directoryHandle ? 'No project files in this folder.' : 'Pick a folder to browse project files.'}
            </div>
          ) : (
            <div
              className='relative'
              style={{ height: `${directoryEntries.length * DIRECTORY_ROW_HEIGHT}px` }}
            >
              {visibleDirectoryEntries.map((entry, visibleIndex) => {
                const index = visibleDirectoryStart + visibleIndex;
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
                    onClick={() => onSelectEntryAtIndex(index, true)}
                    onDoubleClick={() => onSelectEntryAtIndex(index, true, true)}
                    className={`${buttonClass} absolute left-0 right-0 h-12`}
                    style={{ top: `${index * DIRECTORY_ROW_HEIGHT}px` }}
                  >
                    <div
                      className='text-sm truncate'
                      onDoubleClick={(event) => {
                        event.stopPropagation();
                        onSelectEntryAtIndex(index, true, true);
                      }}
                    >
                      {entry.name}
                    </div>
                    <div className={timestampClass}>
                      {entry.lastModified
                        ? new Date(entry.lastModified).toLocaleString()
                        : <span aria-hidden='true'>&nbsp;</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
