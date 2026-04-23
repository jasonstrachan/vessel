import React from 'react';

import type { DirectoryProjectEntry, ProjectPreview } from '@/components/modals/types';
import { PROJECT_FILE_ACCEPT } from '@/constants/projectFiles';
import Button from '../ui/Button';

type LoadProjectModalBodyProps = {
  isProcessing: boolean;
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

export function LoadProjectModalBody({
  isProcessing,
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
            style={{ transform: `translate3d(${previewOffset.x}px, ${previewOffset.y}px, 0)` }}
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
        {warning && (
          <div className='rounded-lg border border-amber-700/60 bg-amber-950/40 p-3 text-amber-200 text-xs flex-shrink-0'>
            {warning}
          </div>
        )}
        {preview?.healthReport && (
          <div className='rounded-lg border border-[#2A2A2A] bg-[#121312] p-4 text-sm flex flex-col gap-2 flex-shrink-0'>
            <div className='flex items-center justify-between gap-3'>
              <div className='text-[#D9D9D9] font-medium'>Project Health</div>
              <div className='text-[#8C8C8C] text-xs'>
                Binary {formatFileSize(preview.healthReport.binaryPayloadBytes)}
              </div>
            </div>
            <div className='grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-[#A5AFA5]'>
              <div>Archive {formatFileSize(preview.healthReport.archiveBytes)}</div>
              <div>Manifest {formatFileSize(preview.healthReport.combinedManifestBytes)}</div>
              <div>Compression {(preview.healthReport.compressionRatio * 100).toFixed(1)}%</div>
              <div>
                Top {preview.healthReport.sectionBreakdown[0]?.name ?? 'n/a'}
              </div>
              <div className='col-span-2'>
                Largest {preview.healthReport.largestLayers[0]?.layerName ?? 'n/a'}
                {preview.healthReport.largestLayers[0]
                  ? ` (${formatFileSize(preview.healthReport.largestLayers[0]?.bytes ?? 0)})`
                  : ''}
              </div>
            </div>
            {preview.healthReport.warnings.length > 0 && (
              <div className='rounded border border-amber-700/40 bg-amber-950/30 p-2'>
                <div className='text-amber-200 text-[11px] uppercase tracking-wide mb-1'>Warnings</div>
                <div className='space-y-1'>
                  {preview.healthReport.warnings.slice(0, 2).map((entry) => (
                    <div key={entry} className='text-amber-100 text-xs'>
                      {entry}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {preview.healthReport.colorCycleDuplicationRiskLayers.length > 0 && (
              <div className='text-amber-300 text-xs'>
                CC duplication risk: {preview.healthReport.colorCycleDuplicationRiskLayers.join(', ')}
              </div>
            )}
            {preview.healthReport.unresolvedColorCycleDefLayers.length > 0 && (
              <div className='text-red-300 text-xs'>
                Unresolved CC defs: {preview.healthReport.unresolvedColorCycleDefLayers.join(', ')}
              </div>
            )}
            {preview.healthReport.recommendations.length > 0 && (
              <div className='rounded border border-[#273127] bg-[#182018] p-2'>
                <div className='text-[#B7D0B7] text-[11px] uppercase tracking-wide mb-1'>Recommendations</div>
                <div className='space-y-1'>
                  {preview.healthReport.recommendations.slice(0, 2).map((entry) => (
                    <div key={entry} className='text-[#9FAF9F] text-xs'>
                      {entry}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
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
        <div className='flex-1 flex flex-col gap-1 overflow-y-auto pr-1'>
          {isScanningDirectory ? (
            <div className='text-[#8C8C8C] text-sm'>Scanning folder...</div>
          ) : directoryEntries.length === 0 ? (
            <div className='text-[#555] text-sm'>
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
                  onClick={() => onSelectEntryAtIndex(index, true)}
                  onDoubleClick={() => onSelectEntryAtIndex(index, true, true)}
                  className={buttonClass}
                >
                  <div className='text-sm truncate'>{entry.name}</div>
                  {entry.lastModified && (
                    <div className={timestampClass}>{new Date(entry.lastModified).toLocaleString()}</div>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
