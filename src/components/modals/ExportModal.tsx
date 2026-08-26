'use client';

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { XIcon } from '@/components/icons/XIcon';
import {
  canDismissExportProgress,
  ExportProgressView,
} from '@/components/modals/export/ExportProgressView';
import {
  BUNDLE_FORMAT_LABELS,
  bitrateToCompressionPercent,
  buildInitialExportLayerRows,
  clampWebglDesignScalePercent,
  computeBestLoopSuggestion,
  countExcludedHiddenLayers,
  getGobletExportIssueRows,
  getParticipatingExportLayers,
  normalizeWebglHtmlBackgroundColor,
  upsertExportLayerRow,
  WEBGL_PROGRESS_PHASE_LABELS,
  type ExportKind,
  type ExportProgressState,
  type RasterExportScale,
  type WebglViewportPreset,
} from '@/components/modals/export/exportModalModel';
import { ExportSetupView } from '@/components/modals/export/ExportSetupView';
import { useExportFrameProvider } from '@/components/modals/export/useExportFrameProvider';
import { useKeyboardScope } from '@/hooks/useKeyboardScope';
import { getAppStoreState } from '@/stores/appStoreAccess';
import { useAppStore } from '@/stores/useAppStore';
import type { WebGLExportSettings } from '@/types';
import { runExport } from '@/utils/export/exportService';
import type { GobletArtifact } from '@/utils/export/goblet/gobletArtifact';
import type { GobletPublisher } from '@/utils/export/goblet/gobletPublisherRegistry';
import { buildGobletExportSnapshotRequest } from '@/utils/export/goblet/gobletSnapshot';
import type { ExportProgress } from '@/utils/export/types';
import type { DitherMethod } from '@/utils/gifDither';
import { createDefaultExportLayout } from '@/utils/layoutDefaults';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const MODAL_PANEL_CLASS = 'bg-[#2C2C2C] border border-[#2A2A2A]';

export const ExportModal: React.FC<ExportModalProps> = ({ isOpen, onClose }) => {
  useKeyboardScope('modal', isOpen);

  const project = useAppStore((state) => state.project);
  const layerGroups = useAppStore((state) => state.layerGroups);
  const compositeLayersToCanvas = useAppStore((state) => state.compositeLayersToCanvas);
  const compositeLayersToCanvasSync = useAppStore((state) => state.compositeLayersToCanvasSync);
  const layers = useAppStore((state) => state.layers);
  const addNotification = useAppStore((state) => state.addNotification);
  const toggleModal = useAppStore((state) => state.toggleModal);
  const webglExportSettings = useAppStore((state) => state.webglExportSettings);
  const updateWebglExportSettings = useAppStore((state) => state.updateWebglExportSettings);

  const [isVisible, setIsVisible] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 24 });
  const [isDragging, setIsDragging] = useState(false);
  const dragOffsetRef = useRef({ x: 0, y: 0 });

  const [exportKind, setExportKind] = useState<ExportKind>('webgl');
  const [scale, setScale] = useState<RasterExportScale>(1);
  const [pngIncludeBackground, setPngIncludeBackground] = useState(true);
  const [pngQuality, setPngQuality] = useState(1);
  const [gifFps, setGifFps] = useState(12);
  const [gifDuration, setGifDuration] = useState(3);
  const [gifRepeat, setGifRepeat] = useState(0);
  const [gifAutoFrames, setGifAutoFrames] = useState(true);
  const [gifDitherMethod, setGifDitherMethod] = useState<DitherMethod>('none');
  const [gifDitherStrength, setGifDitherStrength] = useState(1);
  const [gifFrameStep, setGifFrameStep] = useState<1 | 2 | 3 | 4>(1);
  const [gifMaxColors, setGifMaxColors] = useState<4 | 8 | 16 | 32 | 64 | 128 | 256>(128);
  const [gifAutoColors, setGifAutoColors] = useState(true);
  const [videoFps, setVideoFps] = useState(30);
  const [videoDuration, setVideoDuration] = useState(3);
  const [videoAutoFrames, setVideoAutoFrames] = useState(true);
  const [videoMime, setVideoMime] = useState<'video/mp4' | 'video/webm'>('video/webm');
  const [videoBitrate, setVideoBitrate] = useState(6000);
  const [webglFps, setWebglFps] = useState(60);
  const [webglDuration, setWebglDuration] = useState(3);
  const [webglAutoFrames, setWebglAutoFrames] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [progressState, setProgressState] = useState<ExportProgressState | null>(null);
  const [publishingPublisherId, setPublishingPublisherId] = useState<string | null>(null);
  const exportAbortRef = useRef<AbortController | null>(null);
  const continueAnywayRef = useRef(false);

  const closeExportModal = useCallback(() => {
    setProgressState(null);
    onClose();
  }, [onClose]);

  const webglIncludeHidden = webglExportSettings.includeHiddenLayers;
  const webglBundleFormat = webglExportSettings.bundleFormat;
  const webglHtmlTitle = webglExportSettings.htmlTitle?.trim() || 'Goblet';
  const webglHtmlBackgroundColor = normalizeWebglHtmlBackgroundColor(
    webglExportSettings.htmlBackgroundColor ?? '#000000',
  );
  const webglViewportPreset: WebglViewportPreset = webglExportSettings.viewportPreset === 'embed-fill'
    ? 'embed-fill'
    : webglExportSettings.viewportPreset === 'embed-fit'
      ? 'embed-fit'
      : webglExportSettings.viewportPreset === 'fixed'
        ? 'fixed'
        : 'default';
  const webglDesignScalePercent = clampWebglDesignScalePercent(
    webglExportSettings.designScalePercent ?? 100,
  );
  const resolvedWebglSettings: WebGLExportSettings = {
    ...webglExportSettings,
    htmlTitle: webglHtmlTitle,
    htmlBackgroundColor: webglHtmlBackgroundColor,
    viewportPreset: webglViewportPreset,
    designScalePercent: webglDesignScalePercent,
  };

  const visibleLayerCount = useMemo(
    () => layers.filter((layer) => layer.visible !== false).length,
    [layers],
  );
  const hiddenLayerCount = layers.length - visibleLayerCount;
  const participatingLayers = useMemo(
    () => getParticipatingExportLayers(layers, webglIncludeHidden),
    [layers, webglIncludeHidden],
  );
  const participatingLayerCount = participatingLayers.length;
  const excludedHiddenLayerCount = countExcludedHiddenLayers(layers, webglIncludeHidden);

  const scaleOptions = useMemo(() => (
    exportKind === 'gif' || exportKind === 'mp4'
      ? [
        { value: 0.2 as const, label: '20%' },
        { value: 0.5 as const, label: '50%' },
        { value: 1 as const, label: '1x' },
        { value: 2 as const, label: '2x' },
        { value: 3 as const, label: '3x' },
        { value: 4 as const, label: '4x' },
      ]
      : [
        { value: 1 as const, label: '1x' },
        { value: 2 as const, label: '2x' },
        { value: 3 as const, label: '3x' },
        { value: 4 as const, label: '4x' },
      ]
  ), [exportKind]);

  useEffect(() => {
    let visibilityTimer: ReturnType<typeof setTimeout> | null = null;
    if (isOpen) {
      setShouldRender(true);
      const modalWidth = 580;
      setPosition({
        x: Math.max(16, Math.round((window.innerWidth - modalWidth) / 2)),
        y: 24,
      });
      visibilityTimer = setTimeout(() => setIsVisible(true), 10);
    } else {
      setIsVisible(false);
      exportAbortRef.current?.abort();
      exportAbortRef.current = null;
      setProgressState(null);
      visibilityTimer = setTimeout(() => setShouldRender(false), 300);
    }
    return () => {
      if (visibilityTimer !== null) {
        clearTimeout(visibilityTimer);
      }
    };
  }, [isOpen]);

  const isProgressDismissible = progressState
    ? canDismissExportProgress(progressState, publishingPublisherId)
    : false;
  const canCloseModal = !isExporting
    && publishingPublisherId === null
    && (!progressState || isProgressDismissible || progressState.phase === 'blocked');

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isOpen && canCloseModal) {
        closeExportModal();
      }
    };
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
    }
    return () => document.removeEventListener('keydown', handleEscape);
  }, [canCloseModal, closeExportModal, isOpen]);

  const handleDragStart = (event: React.MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button')) {
      return;
    }
    event.preventDefault();
    setIsDragging(true);
    dragOffsetRef.current = {
      x: event.clientX - position.x,
      y: event.clientY - position.y,
    };
  };

  useEffect(() => {
    if (!isDragging) {
      return;
    }
    const handleMove = (event: MouseEvent) => {
      setPosition({
        x: Math.min(window.innerWidth - 60, Math.max(8, event.clientX - dragOffsetRef.current.x)),
        y: Math.min(window.innerHeight - 60, Math.max(8, event.clientY - dragOffsetRef.current.y)),
      });
    };
    const handleUp = () => setIsDragging(false);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [isDragging]);

  useEffect(() => {
    if (isOpen) {
      setGifAutoFrames(true);
    }
  }, [isOpen]);

  useEffect(() => {
    if (exportKind === 'webgl' && scale !== 1) {
      setScale(1);
    } else if (exportKind === 'png' && scale < 1) {
      setScale(1);
    }
  }, [exportKind, scale]);

  const getBrushCycleSpeed = () => {
    try {
      return getAppStoreState().tools?.brushSettings?.colorCycleSpeed ?? 0.1;
    } catch {
      return 0.1;
    }
  };

  const gifFrameSuggestion = useMemo(() => computeBestLoopSuggestion({
    fps: Math.max(1, Math.floor(gifFps / Math.max(1, gifFrameStep))),
    durationSeconds: gifDuration,
    layers,
    brushCycleSpeed: getBrushCycleSpeed(),
  }), [gifDuration, gifFps, gifFrameStep, layers]);

  const webglFrameSuggestion = useMemo(() => computeBestLoopSuggestion({
    fps: webglFps,
    durationSeconds: webglDuration,
    layers,
    brushCycleSpeed: getBrushCycleSpeed(),
  }), [layers, webglDuration, webglFps]);

  const videoFrameSuggestion = useMemo(() => computeBestLoopSuggestion({
    fps: videoFps,
    durationSeconds: videoDuration,
    layers,
    brushCycleSpeed: getBrushCycleSpeed(),
  }), [layers, videoDuration, videoFps]);

  const resolvedWebglViewport = useMemo(() => {
    const fallbackWidth = Math.max(1, Math.round(project?.width ?? 1024));
    const fallbackHeight = Math.max(1, Math.round(project?.height ?? 1024));
    if (webglViewportPreset !== 'fixed') {
      return { designWidth: fallbackWidth, designHeight: fallbackHeight };
    }
    const factor = webglDesignScalePercent / 100;
    return {
      designWidth: Math.max(1, Math.round(fallbackWidth * factor)),
      designHeight: Math.max(1, Math.round(fallbackHeight * factor)),
    };
  }, [project?.height, project?.width, webglDesignScalePercent, webglViewportPreset]);

  const videoEffectiveDuration = videoAutoFrames
    ? videoFrameSuggestion.duration
    : Math.max(1, videoDuration);
  const webglTotalFrames = webglAutoFrames
    ? webglFrameSuggestion.frames
    : Math.max(1, Math.round(webglDuration * Math.max(1, Math.floor(webglFps))));
  const webglEffectiveDuration = webglAutoFrames
    ? webglFrameSuggestion.duration
    : Math.max(0.5, webglDuration);

  const filenameBase = useMemo(() => {
    const sourceName = exportKind === 'webgl'
      ? webglHtmlTitle
      : project?.name?.trim() || 'Vessel';
    const sanitized = sourceName
      .replace(/\s+/g, '_')
      .replace(/[^A-Za-z0-9._-]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '');
    return sanitized || 'Vessel';
  }, [exportKind, project?.name, webglHtmlTitle]);

  const frameProvider = useExportFrameProvider({
    width: project?.width || 1,
    height: project?.height || 1,
    compositeLayersToCanvas,
  });

  const webglPreflightError = useMemo(() => {
    if (layers.length === 0) {
      return 'No layers available to export.';
    }
    if (!webglIncludeHidden && visibleLayerCount === 0) {
      return 'No visible layers. Enable hidden layers or unhide at least one layer.';
    }
    return null;
  }, [layers.length, visibleLayerCount, webglIncludeHidden]);

  const downloadBlob = useCallback((blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }, []);

  const updateExportProgress = useCallback((nextProgress: ExportProgress) => {
    setProgressState((current) => {
      if (!current) {
        return current;
      }
      if (!nextProgress.webgl) {
        return {
          ...current,
          percent: nextProgress.percent,
          message: nextProgress.message ?? current.message,
          phase: nextProgress.percent >= 100 ? 'complete' : current.phase,
        };
      }

      const { webgl } = nextProgress;
      const isParticipatingLayer = webgl.layer
        ? current.layers.some((layer) => layer.id === webgl.layer!.id)
        : false;
      return {
        ...current,
        phase: webgl.phase,
        percent: webgl.percent,
        message: webgl.message ?? current.message,
        error: webgl.error ?? current.error,
        layers: webgl.layer && isParticipatingLayer
          ? upsertExportLayerRow(current.layers, {
            id: webgl.layer.id,
            name: webgl.layer.name,
            status: webgl.layer.status,
            message: webgl.layer.message,
            colorCycle: webgl.layer.colorCycle,
          })
          : current.layers,
      };
    });
  }, []);

  const handleExport = async () => {
    if (!project) {
      return;
    }
    if (exportKind === 'webgl' && webglPreflightError) {
      addNotification({
        type: 'error',
        title: 'Export blocked by preflight',
        message: webglPreflightError,
        timestamp: new Date(),
        duration: 5000,
      });
      return;
    }

    const shouldContinueAnyway = continueAnywayRef.current;
    continueAnywayRef.current = false;
    if (exportKind === 'webgl' && !shouldContinueAnyway) {
      const issueRows = getGobletExportIssueRows(layers, webglIncludeHidden);
      if (issueRows.length > 0) {
        const initialRows = buildInitialExportLayerRows(layers, webglIncludeHidden);
        setProgressState({
          isOpen: true,
          kind: exportKind,
          phase: 'blocked',
          percent: 0,
          message: 'Goblet export stopped before starting.',
          layers: issueRows.reduce(
            (rows, issueRow) => upsertExportLayerRow(rows, issueRow),
            initialRows,
          ),
          excludedHiddenLayerCount,
          issue: {
            title: `Goblet export found ${issueRows.length} layer issue${issueRows.length === 1 ? '' : 's'}.`,
            detailLines: issueRows.map((row) => `${row.name}: ${row.message ?? 'Static preview only'}`),
            repairHint: 'Repair opens the Load Project repair flow. It needs the original project file to save a repaired copy.',
          },
        });
        return;
      }
    }

    setIsExporting(true);
    setProgressState({
      isOpen: true,
      kind: exportKind,
      phase: 'preparing',
      percent: 0,
      message: exportKind === 'webgl' ? 'Preparing Goblet export...' : 'Preparing export...',
      layers: exportKind === 'webgl'
        ? buildInitialExportLayerRows(layers, webglIncludeHidden)
        : [],
      excludedHiddenLayerCount: exportKind === 'webgl' ? excludedHiddenLayerCount : 0,
    });
    const controller = new AbortController();
    exportAbortRef.current = controller;

    try {
      const exportSnapshotState = getAppStoreState();
      const request = exportKind === 'png'
        ? {
          kind: 'png' as const,
          filenameBase,
          scale,
          frameProvider,
          options: {
            quality: pngQuality,
            includeBackground: pngIncludeBackground,
            backgroundColor: project.backgroundColor,
          },
        }
        : exportKind === 'gif'
          ? {
            kind: 'gif' as const,
            filenameBase,
            scale,
            frameProvider,
            options: {
              fps: gifFps,
              durationSeconds: gifDuration,
              repeat: gifRepeat,
              autoFrames: gifAutoFrames,
              suggestedTotalFrames: gifFrameSuggestion.frames,
              frameStep: gifFrameStep,
              ditherMethod: gifDitherMethod,
              ditherStrength: gifDitherStrength,
              maxColors: gifMaxColors,
              autoColors: gifAutoColors,
            },
          }
          : exportKind === 'webgl'
            ? {
              kind: 'webgl' as const,
              filenameBase,
              options: {
                request: buildGobletExportSnapshotRequest({
                  project: { ...project, layerGroups },
                  layers: participatingLayers,
                  layout: project.exportLayout ?? createDefaultExportLayout(),
                  viewport: {
                    designWidth: resolvedWebglViewport.designWidth,
                    designHeight: resolvedWebglViewport.designHeight,
                    mode: webglViewportPreset === 'default' ? 'fit' : 'fixed',
                  },
                  fps: Math.max(1, Math.floor(webglFps)),
                  totalFrames: webglTotalFrames,
                  durationSeconds: webglEffectiveDuration,
                  perfectLoop: webglAutoFrames,
                  includeHiddenLayers: webglIncludeHidden,
                  embedCanvasFallback: webglExportSettings.embedCanvasFallback,
                  minify: webglExportSettings.minifyOutput,
                  pixelPerfectStack: webglViewportPreset === 'fixed',
                  filenameBase,
                  bundleFormat: webglBundleFormat,
                  gobletVersion: webglExportSettings.gobletVersion,
                  enableGobletDiagnostics: webglExportSettings.enableGobletDiagnostics,
                  compositeLayersToCanvas,
                  compositeLayersToCanvasSync,
                  viewportPreset: webglViewportPreset,
                  htmlTitle: webglHtmlTitle,
                  htmlBackgroundColor: webglHtmlBackgroundColor,
                  onSizeReport: (sizeReport) => {
                    if (webglBundleFormat === 'single-html' && sizeReport.format === 'single-html') {
                      setProgressState((current) => current ? { ...current, sizeReport } : current);
                    }
                  },
                }, {
                  transparencyBackgroundMode: exportSnapshotState.canvas.transparencyBackgroundMode,
                  displayFilters: exportSnapshotState.canvas.displayFilters,
                  colorCyclePlaybackSpeedScale: exportSnapshotState.colorCyclePlayback?.playbackSpeedScale,
                  colorCycleLayerSpeedScale: exportSnapshotState.tools?.brushSettings?.colorCycleLayerSpeedScale,
                  colorCycleToolSpeed: exportSnapshotState.tools?.brushSettings?.colorCycleSpeed,
                }),
                bundleFormat: webglBundleFormat,
                gobletVersion: webglExportSettings.gobletVersion,
                htmlTitle: webglHtmlTitle,
                htmlBackgroundColor: webglHtmlBackgroundColor,
              },
            }
            : {
              kind: 'video' as const,
              filenameBase,
              scale,
              frameProvider,
              options: {
                fps: videoFps,
                durationSeconds: videoEffectiveDuration,
                mimeType: videoMime,
                bitrateKbps: videoBitrate,
              },
            };

      const result = await runExport(request, updateExportProgress, controller.signal);
      if (result.kind === 'webgl') {
        setProgressState((current) => current ? {
          ...current,
          phase: 'complete',
          percent: 100,
          message: 'Goblet ready to preview, download, or publish',
          sizeReport: result.artifact.sizeReport,
          artifact: result.artifact,
        } : current);
        addNotification({
          type: 'success',
          title: 'Goblet ready',
          message: `Built ${result.metadata.layers.length} layer${result.metadata.layers.length === 1 ? '' : 's'} as ${BUNDLE_FORMAT_LABELS[webglBundleFormat]}`,
          timestamp: new Date(),
          duration: 5000,
        });
      } else {
        setProgressState((current) => current ? {
          ...current,
          phase: 'complete',
          percent: 100,
          message: 'Export complete',
        } : current);
        if (result.kind === 'video' && videoMime === 'video/mp4' && !result.mimeType.includes('mp4')) {
          addNotification({
            type: 'warning',
            title: 'Exported as WebM',
            message: 'This browser does not support MP4 recording with MediaRecorder. Saved as WebM instead.',
            timestamp: new Date(),
            duration: 5000,
          });
        }
        downloadBlob(result.blob, result.filename);
      }
    } catch (caughtError) {
      const error = caughtError instanceof Error
        ? { message: caughtError.message, stack: caughtError.stack }
        : { message: 'Unknown error' };
      setProgressState((current) => current ? {
        ...current,
        phase: 'failed',
        percent: 100,
        message: error.message,
        error,
        sizeReport: undefined,
      } : {
        isOpen: true,
        kind: exportKind,
        phase: 'failed',
        percent: 100,
        message: error.message,
        layers: exportKind === 'webgl'
          ? buildInitialExportLayerRows(layers, webglIncludeHidden)
          : [],
        excludedHiddenLayerCount: exportKind === 'webgl' ? excludedHiddenLayerCount : 0,
        error,
      });
      addNotification({
        type: 'error',
        title: 'Export failed',
        message: error.message,
        timestamp: new Date(),
        duration: 5000,
      });
    } finally {
      setIsExporting(false);
      exportAbortRef.current = null;
    }
  };

  const continueBlockedExport = () => {
    continueAnywayRef.current = true;
    setProgressState(null);
    void handleExport();
  };

  const openRepairFlow = () => {
    setProgressState(null);
    onClose();
    toggleModal('loadProject');
  };

  const publishGoblet = async (publisher: GobletPublisher, artifact: GobletArtifact) => {
    if (!project || publishingPublisherId) {
      return;
    }
    setPublishingPublisherId(publisher.id);
    try {
      const result = await publisher.publish(artifact, {
        projectId: project.id,
        projectName: project.name,
      });
      addNotification({
        type: 'success',
        title: `Published to ${publisher.label}`,
        message: result.url ? `${result.message} ${result.url}` : result.message,
        timestamp: new Date(),
        duration: 8000,
      });
    } catch (error) {
      addNotification({
        type: 'error',
        title: `Publish to ${publisher.label} failed`,
        message: error instanceof Error ? error.message : 'Unknown publish error',
        timestamp: new Date(),
        duration: 8000,
      });
    } finally {
      setPublishingPublisherId(null);
    }
  };

  if (!shouldRender) {
    return null;
  }

  const title = progressState
    ? progressState.phase === 'complete'
      ? progressState.kind === 'webgl' ? 'Goblet ready' : 'Export complete'
      : progressState.phase === 'failed'
        ? 'Export failed'
        : progressState.phase === 'blocked'
          ? 'Export needs attention'
          : 'Exporting'
    : 'Export';
  const subtitle = progressState
    ? `${progressState.kind === 'webgl' ? 'Goblet' : progressState.kind.toUpperCase()} · ${WEBGL_PROGRESS_PHASE_LABELS[progressState.phase]}`
    : null;

  return (
    <div
      className={`fixed inset-0 z-50 transition-opacity duration-300 ${isVisible ? 'opacity-100' : 'opacity-0'}`}
      data-testid="export-modal-backdrop"
      onClick={() => {
        if (canCloseModal) {
          closeExportModal();
        }
      }}
    >
      <div
        className={`${MODAL_PANEL_CLASS} fixed flex w-[580px] max-w-[calc(100vw-32px)] flex-col overflow-hidden shadow-xl`}
        style={{
          left: position.x,
          top: position.y,
          maxHeight: 'calc(100vh - 48px)',
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-modal-title"
        aria-describedby={subtitle ? 'export-modal-subtitle' : undefined}
        onClick={(event) => event.stopPropagation()}
      >
        <div
          className="flex shrink-0 cursor-move items-center justify-between border-b border-[#424242] px-6 py-3"
          onMouseDown={handleDragStart}
        >
          <div>
            <h2 id="export-modal-title" className="text-lg font-semibold tracking-tight text-[#F0F0F0]">
              {title}
            </h2>
            {subtitle && (
              <p id="export-modal-subtitle" className="text-xs text-[#9C9C9C]">{subtitle}</p>
            )}
          </div>
          {canCloseModal && (
            <button
              type="button"
              onClick={closeExportModal}
              className="p-1 text-[#9C9C9C] transition-colors hover:text-white"
              aria-label="Close export"
            >
              <XIcon className="h-5 w-5" />
            </button>
          )}
        </div>

        {progressState ? (
          <ExportProgressView
            state={progressState}
            publishingPublisherId={publishingPublisherId}
            onBack={() => setProgressState(null)}
            onCancel={() => exportAbortRef.current?.abort()}
            onClose={closeExportModal}
            onContinueAnyway={continueBlockedExport}
            onRepair={openRepairFlow}
            onDownload={(artifact) => downloadBlob(artifact.blob, artifact.filename)}
            onPublish={(publisher, artifact) => { void publishGoblet(publisher, artifact); }}
          />
        ) : (
          <ExportSetupView
            isExporting={isExporting}
            exportKind={exportKind}
            scale={scale}
            scaleOptions={scaleOptions}
            filenameBase={filenameBase}
            png={{ includeBackground: pngIncludeBackground, quality: pngQuality }}
            gif={{
              fps: gifFps,
              duration: gifDuration,
              repeat: gifRepeat,
              autoFrames: gifAutoFrames,
              ditherMethod: gifDitherMethod,
              ditherStrength: gifDitherStrength,
              frameStep: gifFrameStep,
              maxColors: gifMaxColors,
              autoColors: gifAutoColors,
            }}
            video={{
              fps: videoFps,
              duration: videoDuration,
              autoFrames: videoAutoFrames,
              mime: videoMime,
              bitrate: videoBitrate,
              compressionPercent: bitrateToCompressionPercent(videoBitrate),
            }}
            goblet={{
              settings: resolvedWebglSettings,
              viewportPreset: webglViewportPreset,
              designScalePercent: webglDesignScalePercent,
              fps: webglFps,
              duration: webglDuration,
              autoFrames: webglAutoFrames,
              visibleLayerCount,
              hiddenLayerCount,
              participatingLayerCount,
              projectBackgroundColor: project?.backgroundColor,
            }}
            onExportKindChange={setExportKind}
            onScaleChange={setScale}
            onPngChange={(patch) => {
              if (typeof patch.includeBackground === 'boolean') {
                setPngIncludeBackground(patch.includeBackground);
              }
              if (typeof patch.quality === 'number') {
                setPngQuality(patch.quality);
              }
            }}
            onGifChange={(patch) => {
              if (typeof patch.fps === 'number') setGifFps(patch.fps);
              if (typeof patch.duration === 'number') setGifDuration(patch.duration);
              if (typeof patch.repeat === 'number') setGifRepeat(patch.repeat);
              if (typeof patch.autoFrames === 'boolean') setGifAutoFrames(patch.autoFrames);
              if (patch.ditherMethod) setGifDitherMethod(patch.ditherMethod);
              if (typeof patch.ditherStrength === 'number') setGifDitherStrength(patch.ditherStrength);
              if (patch.frameStep) setGifFrameStep(patch.frameStep);
              if (patch.maxColors) setGifMaxColors(patch.maxColors);
              if (typeof patch.autoColors === 'boolean') setGifAutoColors(patch.autoColors);
            }}
            onVideoChange={(patch) => {
              if (typeof patch.fps === 'number') setVideoFps(patch.fps);
              if (typeof patch.duration === 'number') setVideoDuration(patch.duration);
              if (typeof patch.autoFrames === 'boolean') setVideoAutoFrames(patch.autoFrames);
              if (patch.mime) setVideoMime(patch.mime);
              if (typeof patch.bitrate === 'number') setVideoBitrate(patch.bitrate);
            }}
            onGobletAnimationChange={(patch) => {
              if (typeof patch.fps === 'number') setWebglFps(patch.fps);
              if (typeof patch.duration === 'number') setWebglDuration(patch.duration);
              if (typeof patch.autoFrames === 'boolean') setWebglAutoFrames(patch.autoFrames);
            }}
            onGobletSettingsChange={updateWebglExportSettings}
            onClose={closeExportModal}
            onExport={() => { void handleExport(); }}
          />
        )}
      </div>
    </div>
  );
};

export default ExportModal;
