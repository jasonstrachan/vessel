"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { XIcon } from '../icons/XIcon';
import Input from '../ui/Input';
import Button from '../ui/Button';
import { useKeyboardScope } from '../../hooks/useKeyboardScope';
import { RecolorManager } from '@/lib/colorCycle/RecolorManager';
import type { DitherMethod } from '@/utils/gifDither';
import { LayerAlignmentControls } from '@/components/panels/AlignmentPanel';
import { LayerColorSwatches, LAYER_TAG_CLASS } from '@/components/MinimalLayerList';
import { Eye, EyeOff } from 'lucide-react';
import { createDefaultExportLayout } from '@/utils/layoutDefaults';
import { runExport } from '@/utils/export/exportService';
import type { FrameProvider } from '@/utils/export/types';
import type { Layer, WebGLExportBundleFormat, WebGLExportGobletVersion } from '@/types';

type ExportKind = 'png' | 'gif' | 'mp4' | 'webgl';
type RasterExportScale = 0.2 | 0.5 | 1 | 2 | 3 | 4;

const BUNDLE_FORMAT_LABELS: Record<WebGLExportBundleFormat, string> = {
  zip: 'Goblet bundle zip',
  'single-html': 'single-file Goblet',
  json: 'Goblet JSON bundle'
};

const GOBLET_VERSION_LABELS: Record<WebGLExportGobletVersion, string> = {
  goblet1: 'Goblet 1 (legacy)',
  goblet2: 'Goblet 2 (GPU-first)'
};
const GIF_FPS_PRESETS = [12, 18, 24] as const;
const VIDEO_BITRATE_MIN_KBPS = 1000;
const VIDEO_BITRATE_MAX_KBPS = 20000;

const MODAL_PANEL_CLASS = 'bg-[#2C2C2C] border border-[#2A2A2A]';
const MODAL_SURFACE_CLASS = 'border-t border-[#424242] pt-4';
const MODAL_TEXT_PRIMARY = 'text-[#E5E5E5]';
const MODAL_TEXT_SECONDARY = 'text-[#9C9C9C]';
const TOGGLE_BASE_CLASS = 'px-3 py-2 text-sm font-medium border border-[#424242] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#D9D9D9] focus-visible:ring-offset-0 disabled:opacity-50 disabled:cursor-not-allowed';
const TOGGLE_ACTIVE_CLASS = 'bg-[#D9D9D9] border-[#D9D9D9] text-[#1B1B1B]';
const TOGGLE_INACTIVE_CLASS = 'bg-[#1F1F1F] text-[#D4D4D4] hover:bg-[#2A2A2A] hover:text-white';
const INLINE_FIELD_CLASS = 'bg-[#4a4a4a] border border-[#343434] text-sm text-[#E5E5E5] px-3 py-2 focus:outline-none focus:ring-1 focus:ring-[#D9D9D9] disabled:text-[#5C5C5C] disabled:bg-[#151515]';
const INPUT_OVERRIDE_CLASS = '!bg-[#4a4a4a] !border-[#343434] !text-[#E5E5E5] !px-3 !py-2 !h-9 focus:!border-[#D9D9D9] focus:!ring-0 focus:!outline-none disabled:!text-[#5C5C5C] disabled:!bg-[#151515]';

const WEBGL_VIEWPORT_PRESETS = [
  { value: 'default', label: 'Default export' },
  { value: 'embed-fill', label: 'Embed fill' },
  { value: 'embed-fit', label: 'Embed fit' },
  { value: 'fixed', label: 'Fixed canvas' }
] as const;

type WebglViewportPreset = typeof WEBGL_VIEWPORT_PRESETS[number]['value'];

const WEBGL_DESIGN_SCALE_PRESETS = [50, 100, 200, 300, 400] as const;

const clampWebglDesignScalePercent = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 100;
  }
  return Math.max(25, Math.min(800, Math.round(value)));
};

const normalizeWebglHtmlBackgroundColor = (value: string): string => {
  const trimmed = value.trim();
  if (/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  return '#000000';
};

const clampVideoBitrate = (value: number): number => (
  Math.max(VIDEO_BITRATE_MIN_KBPS, Math.min(VIDEO_BITRATE_MAX_KBPS, Math.round(value)))
);

const bitrateToCompressionPercent = (bitrateKbps: number): number => {
  const normalized = (clampVideoBitrate(bitrateKbps) - VIDEO_BITRATE_MIN_KBPS)
    / (VIDEO_BITRATE_MAX_KBPS - VIDEO_BITRATE_MIN_KBPS);
  return Math.round((1 - normalized) * 100);
};

const compressionPercentToBitrate = (compressionPercent: number): number => {
  const clamped = Math.max(0, Math.min(100, compressionPercent));
  const normalized = 1 - (clamped / 100);
  return clampVideoBitrate(
    VIDEO_BITRATE_MIN_KBPS + normalized * (VIDEO_BITRATE_MAX_KBPS - VIDEO_BITRATE_MIN_KBPS)
  );
};

const hasSequentialExportLayers = (layers: Layer[] | undefined): boolean =>
  Array.isArray(layers) && layers.some((layer) => layer.layerType === 'sequential' && !!layer.sequentialData);

interface LoopFrameSuggestion {
  frames: number;
  success: boolean;
  duration: number;
}

const computeBestLoopSuggestion = ({
  fps,
  durationSeconds,
  layers,
  brushCycleSpeed,
}: {
  fps: number;
  durationSeconds: number;
  layers: Layer[];
  brushCycleSpeed: number;
}): LoopFrameSuggestion => {
  const safeFps = Math.max(1, Math.floor(fps));
  const targetFrames = Math.max(1, Math.round(durationSeconds * safeFps));
  const recolorSpeeds: number[] = layers
    .filter((layer) => layer.layerType === 'color-cycle' && layer.colorCycleData?.mode === 'recolor' && layer.colorCycleData?.recolorSettings)
    .map((layer) => layer.colorCycleData!.recolorSettings!.animation.speed || 0.1)
    .filter((speed) => Number.isFinite(speed) && speed > 0);
  const brushSpeeds: number[] = layers
    .filter((layer) => layer.layerType === 'color-cycle' && layer.colorCycleData?.mode !== 'recolor')
    .map(() => brushCycleSpeed)
    .filter((speed) => Number.isFinite(speed) && speed > 0);
  const speeds = [...recolorSpeeds, ...brushSpeeds];

  if (speeds.length === 0) {
    return { frames: targetFrames, success: false, duration: targetFrames / safeFps };
  }

  const minFrames = 8;
  const maxFrames = Math.max(minFrames, Math.round(safeFps * 20));
  const epsilon = 1e-3;

  for (let frameCount = minFrames; frameCount <= maxFrames; frameCount++) {
    let exact = true;
    for (const speed of speeds) {
      const cycles = (speed * frameCount) / safeFps;
      const residual = Math.abs(cycles - Math.round(cycles));
      if (residual >= epsilon) {
        exact = false;
        break;
      }
    }
    if (exact) {
      return { frames: frameCount, success: true, duration: frameCount / safeFps };
    }
  }

  const searchRadius = Math.max(50, Math.round(targetFrames * 0.5));
  const start = Math.max(minFrames, targetFrames - searchRadius);
  const end = Math.min(maxFrames, targetFrames + searchRadius);
  let bestFrames = targetFrames;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let frameCount = start; frameCount <= end; frameCount++) {
    let maxResidual = 0;
    for (const speed of speeds) {
      const cycles = (speed * frameCount) / safeFps;
      const residual = Math.abs(cycles - Math.round(cycles));
      if (residual > maxResidual) {
        maxResidual = residual;
      }
      if (maxResidual > bestScore) {
        break;
      }
    }
    const distance = Math.abs(frameCount - targetFrames) / Math.max(1, targetFrames);
    const score = maxResidual + distance * 1e-3;
    if (score < bestScore) {
      bestScore = score;
      bestFrames = frameCount;
    }
  }

  return { frames: bestFrames, success: false, duration: bestFrames / safeFps };
};

interface CollapsibleSectionProps {
  id: string;
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  contentClassName?: string;
}

const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
  id,
  title,
  isOpen,
  onToggle,
  children,
  contentClassName = ''
}) => {
  const contentClasses = ['px-6 pb-4', contentClassName].filter(Boolean).join(' ');

  return (
    <div className={`${MODAL_SURFACE_CLASS}`}>
      <button
        type="button"
        className="w-full flex items-center justify-between gap-3 px-6 py-3 text-left"
        aria-expanded={isOpen}
        aria-controls={`${id}-content`}
        onClick={onToggle}
      >
        <div className="flex-1">
          <span className={`${MODAL_TEXT_PRIMARY} text-base font-semibold block`}>{title}</span>
        </div>
        <svg
          className={`w-4 h-4 text-[#9C9C9C] transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`}
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M6 9l6 6 6-6"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <div id={`${id}-content`} className={isOpen ? contentClasses : 'hidden'}>
        {children}
      </div>
    </div>
  );
};

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ExportModal: React.FC<ExportModalProps> = ({ isOpen, onClose }) => {
  // Suspend global/canvas shortcuts while modal is open
  useKeyboardScope('modal', isOpen);

  const project = useAppStore((s) => s.project);
  const compositeLayersToCanvas = useAppStore((s) => s.compositeLayersToCanvas);
  const compositeLayersToCanvasSync = useAppStore((s) => s.compositeLayersToCanvasSync);
  const layers = useAppStore((s) => s.layers);
  const activeLayerId = useAppStore((s) => s.activeLayerId);
  const setActiveLayer = useAppStore((s) => s.setActiveLayer);
  const addNotification = useAppStore((s) => s.addNotification);
  const webglExportSettings = useAppStore((s) => s.webglExportSettings);
  const updateWebglExportSettings = useAppStore((s) => s.updateWebglExportSettings);

  const [isVisible, setIsVisible] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);
  // Draggable position (px)
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragOffset = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const [exportKind, setExportKind] = useState<ExportKind>('webgl');
  const [scale, setScale] = useState<RasterExportScale>(1);

  const [layerAlignmentOpen, setLayerAlignmentOpen] = useState(false);

  // PNG options
  const [pngIncludeBg, setPngIncludeBg] = useState(true);
  const [pngQuality, setPngQuality] = useState(1);

  // GIF options
  const [gifFps, setGifFps] = useState(12);
  const [gifDuration, setGifDuration] = useState(3);
  const [gifRepeat, setGifRepeat] = useState(0); // 0 = forever
  const [gifAutoFrames, setGifAutoFrames] = useState(true);
  const [gifDitherMethod, setGifDitherMethod] = useState<DitherMethod>('none');
  const [gifDitherStrength, setGifDitherStrength] = useState(1);
  const [gifFrameStep, setGifFrameStep] = useState<1 | 2 | 3 | 4>(1); // Capture every Nth frame
  const [gifMaxColors, setGifMaxColors] = useState<4 | 8 | 16 | 32 | 64 | 128 | 256>(128);
  const [gifAutoColors, setGifAutoColors] = useState(true);

  // Video options
  const [videoFps, setVideoFps] = useState(30);
  const [videoDuration, setVideoDuration] = useState(3);
  const [videoAutoFrames, setVideoAutoFrames] = useState(true);
  const [videoMime, setVideoMime] = useState<'video/mp4' | 'video/webm'>('video/webm');
  const [videoBitrate, setVideoBitrate] = useState(6000); // kbps

  // WebGL options
  const [webglFps, setWebglFps] = useState(60);
  const [webglDuration, setWebglDuration] = useState(3);
  const [webglAutoFrames, setWebglAutoFrames] = useState(true);
  const webglIncludeHidden = webglExportSettings.includeHiddenLayers;
  const webglEmbedFallback = webglExportSettings.embedCanvasFallback;
  const webglMinify = webglExportSettings.minifyOutput;
  const webglBundleFormat = webglExportSettings.bundleFormat;
  const webglGobletVersion = webglExportSettings.gobletVersion;
  const webglEnableDiagnostics = webglExportSettings.enableGobletDiagnostics;
  const webglHtmlTitle = webglExportSettings.htmlTitle ?? 'Goblet';
  const webglHtmlBackgroundColor = normalizeWebglHtmlBackgroundColor(webglExportSettings.htmlBackgroundColor ?? '#000000');
  const webglViewportPreset: WebglViewportPreset = webglExportSettings.viewportPreset === 'embed-fill'
    ? 'embed-fill'
    : webglExportSettings.viewportPreset === 'embed-fit'
      ? 'embed-fit'
    : webglExportSettings.viewportPreset === 'fixed'
      ? 'fixed'
      : 'default';
  const webglDesignScalePercent = clampWebglDesignScalePercent(webglExportSettings.designScalePercent ?? 100);

  const applyGoblet2SingleHtmlProductionPreset = useCallback(() => {
    updateWebglExportSettings({
      gobletVersion: 'goblet2',
      bundleFormat: 'single-html',
      minifyOutput: true,
      enableGobletDiagnostics: false,
      embedCanvasFallback: false,
      includeHiddenLayers: false,
      htmlTitle: (webglHtmlTitle || 'Goblet').trim() || 'Goblet',
    });
  }, [updateWebglExportSettings, webglHtmlTitle]);

  const webglPreflightError = useMemo<string | null>(() => {
    const visibleLayers = layers.filter((layer) => layer.visible !== false);

    if (layers.length === 0) {
      return 'No layers available to export.';
    }

    if (!webglIncludeHidden && visibleLayers.length === 0) {
      return 'No visible layers. Enable hidden layers or unhide at least one layer.';
    }
    return null;
  }, [layers, webglIncludeHidden]);

  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const exportAbortRef = useRef<AbortController | null>(null);
  const scaleOptions = exportKind === 'gif' || exportKind === 'mp4'
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
    ];

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      // Initial position: center horizontally with a fixed top margin so the modal stays within the viewport
      const modalWidth = 580; // matches class w-[580px]
      const x = Math.max(16, Math.round((window.innerWidth - modalWidth) / 2));
      setPos({ x, y: 24 });
      setTimeout(() => setIsVisible(true), 10);
    } else {
      setIsVisible(false);
      setTimeout(() => setShouldRender(false), 300);
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      setLayerAlignmentOpen(false);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isOpen && !isExporting) {
        onClose();
      }
    };
    if (isOpen) document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, isExporting, onClose]);

  // Drag handlers (title bar)
  const onDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
    dragOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
  };
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const nx = Math.min(window.innerWidth - 60, Math.max(8, e.clientX - dragOffset.current.x));
      const ny = Math.min(window.innerHeight - 60, Math.max(8, e.clientY - dragOffset.current.y));
      setPos({ x: nx, y: ny });
    };
    const onUp = () => setDragging(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging, pos.x, pos.y]);

  // Initialize GIF options when modal opens
  useEffect(() => {
    if (!isOpen) return;
    try {
      // Default auto-detect ON by default when opening
      setGifAutoFrames(true);
    } catch {}
  }, [isOpen]);

  useEffect(() => {
    if (exportKind === 'webgl' && scale !== 1) {
      setScale(1);
      return;
    }

    if (exportKind === 'png' && scale < 1) {
      setScale(1);
    }
  }, [exportKind, scale]);

  // Compute suggested frames/duration for a perfect loop based on animation speeds
  // Strategy:
  // 1) Try to find the SHORTEST perfect loop (minimal frames) within a sane bound (<= 20s)
  // 2) If none found, pick the closest to user target with best residuals
  const autoFrameSuggestion = useMemo(() => {
    try {
      const fps = Math.max(1, Math.floor(gifFps / Math.max(1, gifFrameStep)));
      const targetFrames = Math.max(1, Math.round(gifDuration * fps));
      const store = useAppStore.getState();
      const recolorSpeeds: number[] = layers
        .filter(l => l.layerType === 'color-cycle' && l.colorCycleData?.mode === 'recolor' && l.colorCycleData?.recolorSettings)
        .map(l => l.colorCycleData!.recolorSettings!.animation.speed || 0.1)
        .filter(s => Number.isFinite(s) && s > 0);
      // Gather per-layer speeds for brush-mode CC layers (fallback to current UI speed if undefined)
      const brushSpeeds: number[] = layers
        .filter(l => l.layerType === 'color-cycle' && (l.colorCycleData?.mode !== 'recolor'))
        .map(() => (store.tools?.brushSettings?.colorCycleSpeed ?? 0.1))
        .filter(s => Number.isFinite(s) && s > 0);
      const speeds = [...recolorSpeeds, ...brushSpeeds];

      // No animated speeds detected – fall back to user's target
      if (speeds.length === 0) {
        return { frames: targetFrames, success: false, duration: targetFrames / fps };
      }

      const minFrames = 8;
      const maxFrames = Math.max(minFrames, Math.round(fps * 20)); // cap search at 20s
      const EPS = 1e-3;

      // Phase 1: shortest perfect loop search
      for (let f = minFrames; f <= maxFrames; f++) {
        let ok = true;
        for (const s of speeds) {
          const cycles = (s * f) / fps; // cycles completed by this speed in f frames
          const residual = Math.abs(cycles - Math.round(cycles));
          if (residual >= EPS) { ok = false; break; }
        }
        if (ok) {
          return { frames: f, success: true, duration: f / fps };
        }
      }

      // Phase 2: best fit near user's target (closest + smallest residual)
      const searchRadius = Math.max(50, Math.round(targetFrames * 0.5));
      const start = Math.max(minFrames, targetFrames - searchRadius);
      const end = Math.min(maxFrames, targetFrames + searchRadius);
      let best = targetFrames;
      let bestScore = Number.POSITIVE_INFINITY;
      for (let f = start; f <= end; f++) {
        let maxResidual = 0;
        for (const s of speeds) {
          const cycles = (s * f) / fps;
          const residual = Math.abs(cycles - Math.round(cycles));
          if (residual > maxResidual) maxResidual = residual;
          if (maxResidual > bestScore) break;
        }
        // Combine residual quality with distance from target (very small weight on distance)
        const dist = Math.abs(f - targetFrames) / Math.max(1, targetFrames);
        const score = maxResidual + dist * 1e-3;
        if (score < bestScore) {
          bestScore = score;
          best = f;
        }
      }
      return { frames: best, success: false, duration: best / fps };
    } catch {
      const fps = Math.max(1, Math.floor(gifFps / Math.max(1, gifFrameStep)));
      const fallbackFrames = Math.max(1, Math.round(gifDuration * fps));
      return { frames: fallbackFrames, success: false, duration: fallbackFrames / fps };
    }
  }, [gifDuration, gifFps, gifFrameStep, layers]);

  const resolvedWebglViewport = useMemo(() => {
    const fallbackWidth = Math.max(1, Math.round(project?.width ?? 1024));
    const fallbackHeight = Math.max(1, Math.round(project?.height ?? 1024));
    const scalePercent = clampWebglDesignScalePercent(webglDesignScalePercent);

    if (webglViewportPreset !== 'fixed') {
      return {
        designWidth: fallbackWidth,
        designHeight: fallbackHeight,
        scalePercent: 100
      };
    }

    const factor = scalePercent / 100;
    return {
      designWidth: Math.max(1, Math.round(fallbackWidth * factor)),
      designHeight: Math.max(1, Math.round(fallbackHeight * factor)),
      scalePercent
    };
  }, [project?.height, project?.width, webglDesignScalePercent, webglViewportPreset]);

  const webglFrameSuggestion = useMemo(() => {
    try {
      const store = useAppStore.getState();
      return computeBestLoopSuggestion({
        fps: webglFps,
        durationSeconds: webglDuration,
        layers,
        brushCycleSpeed: store.tools?.brushSettings?.colorCycleSpeed ?? 0.1,
      });
    } catch {
      const fps = Math.max(1, Math.floor(webglFps));
      const fallbackFrames = Math.max(1, Math.round(webglDuration * fps));
      return { frames: fallbackFrames, success: false, duration: fallbackFrames / fps };
    }
  }, [layers, webglDuration, webglFps]);

  const videoFrameSuggestion = useMemo(() => {
    try {
      const store = useAppStore.getState();
      return computeBestLoopSuggestion({
        fps: videoFps,
        durationSeconds: videoDuration,
        layers,
        brushCycleSpeed: store.tools?.brushSettings?.colorCycleSpeed ?? 0.1,
      });
    } catch {
      const fps = Math.max(1, Math.floor(videoFps));
      const fallbackFrames = Math.max(1, Math.round(videoDuration * fps));
      return { frames: fallbackFrames, success: false, duration: fallbackFrames / fps };
    }
  }, [layers, videoDuration, videoFps]);

  const videoEffectiveDuration = useMemo(() => (
    videoAutoFrames ? videoFrameSuggestion.duration : Math.max(1, videoDuration)
  ), [videoAutoFrames, videoDuration, videoFrameSuggestion.duration]);

  const videoCompressionPercent = useMemo(
    () => bitrateToCompressionPercent(videoBitrate),
    [videoBitrate]
  );

  const webglTotalFrames = useMemo(() => {
    const fps = Math.max(1, Math.floor(webglFps));
    if (webglAutoFrames) {
      return webglFrameSuggestion.frames;
    }
    return Math.max(1, Math.round(webglDuration * fps));
  }, [webglAutoFrames, webglDuration, webglFps, webglFrameSuggestion.frames]);

  const webglEffectiveDuration = useMemo(() => (
    webglAutoFrames ? webglFrameSuggestion.duration : Math.max(0.5, webglDuration)
  ), [webglAutoFrames, webglDuration, webglFrameSuggestion.duration]);

  const orderedLayers = useMemo(() => layers.slice().reverse(), [layers]);

  const getColorCycleGradient = useCallback((layer: Layer) => {
    const gradient = layer.colorCycleData?.gradient ?? layer.colorCycleData?.recolorSettings?.gradient;
    if (gradient && gradient.length > 0) {
      const stops = gradient
        .map((stop) => `${stop.color} ${stop.position * 100}%`)
        .join(', ');
      return `linear-gradient(90deg, ${stops})`;
    }
    return '#555';
  }, []);

  const renderLayerPreview = useCallback((layer: Layer) => {
    if (layer.layerType === 'color-cycle') {
      return (
        <div
          className="flex-1 h-4 rounded mr-1"
          style={{
            background: getColorCycleGradient(layer),
            minWidth: '30px',
            opacity: layer.visible ? 1 : 0.5
          }}
          title={`${layer.name}${layer.colorCycleData?.gradient ? ` – ${layer.colorCycleData.gradient.length} stops` : ''}`}
        />
      );
    }

    if (layer.layerType === 'normal') {
          return <LayerColorSwatches layer={layer} visible={layer.visible} />;
    }

    return (
      <span className="text-[#D9D9D9] text-xs flex-1 truncate" title={layer.name}>
        {layer.name}
      </span>
    );
  }, [getColorCycleGradient]);

  const filenameBase = useMemo(() => {
    const sourceName = exportKind === 'webgl'
      ? (webglHtmlTitle?.trim() || 'Goblet')
      : (project?.name?.trim() || 'Vessel');
    const sanitized = sourceName
      .replace(/\s+/g, '_')
      .replace(/[^A-Za-z0-9._-]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '');
    return sanitized || 'Vessel';
  }, [exportKind, project?.name, webglHtmlTitle]);

  const frameProvider = useMemo<FrameProvider>(() => ({
    getDimensions: () => ({
      width: project?.width || 1,
      height: project?.height || 1
    }),
    compositeToCanvas: (canvas) => {
      if (compositeLayersToCanvas) {
        compositeLayersToCanvas(canvas);
      }
    },
    beginAnimationSession: ({ fps, kind }) => {
      const setSequentialExportFrame = (frame: number) => {
        try {
          const rawStore = useAppStore as unknown as {
            setState?: (updater: (state: unknown) => unknown) => void;
            getState: () => unknown;
          };
          if (typeof rawStore.setState === 'function') {
            rawStore.setState((state: unknown) => {
              const typedState = state as {
                sequentialRecord?: { currentFrame?: number };
              };
              if (!typedState?.sequentialRecord) {
                return state;
              }
              return {
                ...typedState,
                sequentialRecord: {
                  ...typedState.sequentialRecord,
                  currentFrame: frame,
                },
              };
            });
            return;
          }
        } catch {
          // fallback below
        }

        try {
          const fallbackStore = useAppStore.getState() as {
            setSequentialFrame?: (nextFrame: number) => void;
          };
          fallbackStore.setSequentialFrame?.(frame);
        } catch {
          // no-op
        }
      };

      const recolorManager = RecolorManager.getInstance();
      const originalStates: Array<{ layerId: string; wasPlaying: boolean; wasAnimating: boolean }> = [];
      const initialStore = useAppStore.getState() as {
        layers?: Layer[];
        sequentialRecord?: { currentFrame?: number };
        setSequentialFrame?: (frame: number) => void;
      };
      const initialSequentialFrame = (
        hasSequentialExportLayers(initialStore.layers) &&
        typeof initialStore.setSequentialFrame === 'function'
      )
        ? initialStore.sequentialRecord?.currentFrame ?? 0
        : null;

      if (kind !== 'estimate') {
        try {
          const store = useAppStore.getState();
          for (const layer of store.layers) {
            if (layer.layerType === 'color-cycle' && layer.colorCycleData) {
              const brush = store.getLayerColorCycleBrush(layer.id);
              const wasPlaying = !!(brush && brush.isPlaying && brush.isPlaying());
              const wasAnimating = !!layer.colorCycleData.isAnimating;
              originalStates.push({ layerId: layer.id, wasPlaying, wasAnimating });
              if (!wasAnimating) {
                store.updateLayer(layer.id, {
                  colorCycleData: {
                    ...layer.colorCycleData,
                    isAnimating: true
                  }
                });
              }
              if (brush) {
                try {
                  brush.setFPS(fps);
                } catch {}
                if (brush.setPlaying) brush.setPlaying(false);
              }
            }
          }
          if (kind === 'gif') {
            try { recolorManager.setFPS(fps); } catch {}
          }
        } catch {}
      }

      const stepFrame = ({ frameIndex, totalFrames, useAbsolutePhase }: { frameIndex: number; totalFrames: number; useAbsolutePhase: boolean }) => {
        if (initialSequentialFrame !== null) {
          setSequentialExportFrame(frameIndex);
        }

        try {
          const store = useAppStore.getState();
          const phase = useAbsolutePhase ? (frameIndex / totalFrames) : null;
          for (const layer of store.layers) {
            if (layer.layerType === 'color-cycle' && layer.colorCycleData?.mode === 'recolor') {
              if (useAbsolutePhase && phase !== null) {
                recolorManager.setPhase(layer, phase);
              } else {
                recolorManager.updateAnimation(layer);
              }
            }
          }
          for (const layer of store.layers) {
            if (layer.layerType === 'color-cycle' && layer.colorCycleData && layer.colorCycleData.mode !== 'recolor') {
              const brush = store.getLayerColorCycleBrush(layer.id);
              if (!brush) continue;
              if (useAbsolutePhase && phase !== null) {
                brush.setPhase(phase);
              } else {
                brush.updateAnimation();
              }
            }
          }
        } catch {}
      };

      const advanceFrame = () => {
        try {
          const store = useAppStore.getState();
          for (const layer of store.layers) {
            if (layer.layerType === 'color-cycle' && layer.colorCycleData?.mode === 'recolor') {
              recolorManager.updateAnimation(layer);
            }
          }
        } catch {}
      };

      const finish = () => {
        if (initialSequentialFrame !== null) {
          setSequentialExportFrame(initialSequentialFrame);
        }

        if (kind === 'estimate') return;
        try {
          const store = useAppStore.getState();
          for (const st of originalStates) {
            const layer = store.layers.find((l) => l.id === st.layerId);
            if (!layer) continue;
            if (!st.wasAnimating && layer.colorCycleData) {
              store.updateLayer(layer.id, {
                colorCycleData: {
                  ...layer.colorCycleData,
                  isAnimating: false
                }
              });
            }
            const brush = store.getLayerColorCycleBrush(layer.id);
            try {
              const fps0 = store.tools?.brushSettings?.colorCycleFPS || 30;
              if (brush) {
                brush.setFPS(fps0);
              }
            } catch {}
            if (brush && brush.setPlaying) brush.setPlaying(st.wasPlaying);
          }
        } catch {}
      };

      return { stepFrame, advanceFrame, finish };
    }
  }), [compositeLayersToCanvas, project?.height, project?.width]);

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExport = async () => {
    if (!project) return;
    if (exportKind === 'webgl' && webglPreflightError) {
      addNotification({
        type: 'error',
        title: 'Export blocked by preflight',
        message: webglPreflightError,
        timestamp: new Date(),
        duration: 5000
      });
      return;
    }
    setIsExporting(true);
    setProgress(0);
    const controller = new AbortController();
    exportAbortRef.current = controller;
    try {
      const request = exportKind === 'png'
        ? {
          kind: 'png' as const,
          filenameBase,
          scale,
          frameProvider,
          options: {
            quality: pngQuality,
            includeBackground: pngIncludeBg,
            backgroundColor: project.backgroundColor,
          }
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
              suggestedTotalFrames: autoFrameSuggestion.frames,
              frameStep: gifFrameStep,
              ditherMethod: gifDitherMethod,
              ditherStrength: gifDitherStrength,
              maxColors: gifMaxColors,
              autoColors: gifAutoColors,
            }
          }
          : exportKind === 'webgl'
            ? {
              kind: 'webgl' as const,
              filenameBase,
              options: {
                request: {
                  project,
                  layers,
                  layout: project.exportLayout ?? createDefaultExportLayout(),
                  viewport: {
                    designWidth: resolvedWebglViewport.designWidth,
                    designHeight: resolvedWebglViewport.designHeight,
                    mode: (
                      webglViewportPreset === 'fixed'
                        ? 'fixed'
                        : webglViewportPreset === 'embed-fill' || webglViewportPreset === 'embed-fit'
                          ? 'fixed'
                          : 'fit'
                    ) as 'fit' | 'fixed'
                  },
                  fps: Math.max(1, Math.floor(webglFps)),
                  totalFrames: webglTotalFrames,
                  durationSeconds: webglEffectiveDuration,
                  perfectLoop: webglAutoFrames,
                  includeHiddenLayers: webglIncludeHidden,
                  embedCanvasFallback: webglEmbedFallback,
                  minify: webglMinify,
                  pixelPerfectStack: webglViewportPreset === 'fixed',
                  filenameBase,
                  bundleFormat: webglBundleFormat,
                  gobletVersion: webglGobletVersion,
                  enableGobletDiagnostics: webglEnableDiagnostics,
                  compositeLayersToCanvas,
                  compositeLayersToCanvasSync,
                  viewportPreset: webglViewportPreset,
                  htmlTitle: webglHtmlTitle,
                  htmlBackgroundColor: webglHtmlBackgroundColor
                },
                bundleFormat: webglBundleFormat,
                gobletVersion: webglGobletVersion,
                htmlTitle: webglHtmlTitle,
                htmlBackgroundColor: webglHtmlBackgroundColor
              }
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
                bitrateKbps: videoBitrate
              }
            };

      const result = await runExport(request, (progress) => setProgress(progress.percent), controller.signal);

      if (result.kind === 'webgl') {
        addNotification({
          type: 'success',
          title: 'Goblet bundle saved',
          message: `Exported ${result.metadata.layers.length} layer${result.metadata.layers.length === 1 ? '' : 's'} to ${BUNDLE_FORMAT_LABELS[webglBundleFormat]}`,
          timestamp: new Date(),
          duration: 5000
        });
      } else {
        if (result.kind === 'video' && videoMime === 'video/mp4' && !result.mimeType.includes('mp4')) {
          addNotification({
            type: 'warning',
            title: 'Exported as WebM',
            message: 'This browser does not support MP4 recording with MediaRecorder. Saved as WebM instead.',
            timestamp: new Date(),
            duration: 5000
          });
        }
        downloadBlob(result.blob, result.filename);
      }
      onClose();
    } catch (e) {
      addNotification({
        type: 'error',
        title: 'Export failed',
        message: e instanceof Error ? e.message : 'Unknown error',
        timestamp: new Date(),
        duration: 5000
      });
    } finally {
      setIsExporting(false);
      setProgress(0);
      exportAbortRef.current = null;
    }
  };

  if (!shouldRender) return null;

  return (
    <div
      className={`fixed inset-0 z-50 ${isVisible ? 'opacity-100' : 'opacity-0'} transition-opacity duration-300`}
      onClick={() => { if (!isExporting) onClose(); }}
    >
      <div
        className={`${MODAL_PANEL_CLASS} w-[580px] max-w-full mx-4 shadow-xl flex flex-col overflow-hidden`}
        style={{ position: 'fixed', left: pos.x, top: pos.y, maxHeight: 'calc(100vh - 48px)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-6 pt-4 pb-3 border-b border-[#2A2A2A] cursor-move shrink-0"
          onMouseDown={onDragStart}
        >
          <h2 className="text-[#F0F0F0] text-lg font-semibold tracking-tight">Export</h2>
          <button
            onClick={() => { if (!isExporting) onClose(); }}
            className="text-[#9C9C9C] hover:text-white transition-colors p-1"
            disabled={isExporting}
          >
            <XIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-6 p-6 pt-4 flex-1 overflow-y-auto text-sm text-[#E0E0E0]">
          {/* Type & Scale */}
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-3">
              <label className={`${MODAL_TEXT_PRIMARY} text-sm font-semibold uppercase tracking-[0.08em]`}>Type</label>
              <div className="flex flex-wrap gap-2">
                {(['webgl','gif','mp4','png'] as ExportKind[]).map((kind) => (
                  <button
                    key={kind}
                    onClick={() => setExportKind(kind)}
                    className={`${TOGGLE_BASE_CLASS} ${exportKind === kind ? TOGGLE_ACTIVE_CLASS : TOGGLE_INACTIVE_CLASS}`}
                    disabled={isExporting}
                  >
                    {kind === 'png' ? 'PNG' : kind === 'gif' ? 'GIF' : kind === 'mp4' ? 'Video' : 'Goblet'}
                  </button>
                ))}
              </div>
            </div>
            {exportKind !== 'webgl' && (
              <div className="flex items-center gap-3">
                <label className={`${MODAL_TEXT_PRIMARY} text-sm font-semibold uppercase tracking-[0.08em]`}>Scale</label>
                <div className="flex flex-wrap gap-2">
                  {scaleOptions.map(({ value, label }) => (
                    <button
                      key={value}
                      onClick={() => setScale(value)}
                      className={`${TOGGLE_BASE_CLASS} ${scale === value ? TOGGLE_ACTIVE_CLASS : TOGGLE_INACTIVE_CLASS}`}
                      disabled={isExporting}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* PNG Options */}
          {exportKind === 'png' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-base text-[#888]">Include Background</label>
                <input type="checkbox" checked={pngIncludeBg} onChange={(e) => setPngIncludeBg(e.target.checked)} />
              </div>
              <div className="flex items-center justify-between">
                <label className="text-base text-[#888]">Quality</label>
                <input
                  type="range"
                  min={0.1}
                  max={1}
                  step={0.05}
                  value={pngQuality}
                  onChange={(e) => setPngQuality(parseFloat(e.target.value))}
                  className="slider w-48"
                  style={{
                    '--slider-track-gradient': 'linear-gradient(to right, rgba(217,217,217,0.2), rgba(217,217,217,0.6))',
                    '--ascii-thumb-size': '14px',
                    '--slider-progress': `${((pngQuality - 0.1) / 0.9) * 100}%`
                  } as React.CSSProperties & { '--slider-progress': string }}
                />
              </div>
            </div>
          )}

          {/* GIF Options */}
          {exportKind === 'gif' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-base text-[#888]">FPS</label>
                <div className="flex items-center gap-2">
                  <div className="flex flex-wrap gap-2">
                    {GIF_FPS_PRESETS.map((value) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setGifFps(value)}
                        className={`${TOGGLE_BASE_CLASS} px-2 py-1 text-xs ${gifFps === value ? TOGGLE_ACTIVE_CLASS : TOGGLE_INACTIVE_CLASS}`}
                        disabled={isExporting}
                      >
                        {value}
                      </button>
                    ))}
                  </div>
                  <Input type="number" min={1} max={60} value={gifFps} onChange={(e) => setGifFps(Math.max(1, Math.min(60, parseInt(e.target.value)||1)))} className="w-24 text-right" />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <label className="text-base text-[#888]">Duration (s)</label>
                <Input
                  type="number"
                  min={1}
                  max={20}
                  value={gifDuration}
                  onChange={(e) => setGifDuration(Math.max(1, Math.min(20, parseInt(e.target.value)||1)))}
                  className="w-24 text-right"
                  disabled={gifAutoFrames}
                />
              </div>
              <div className="flex items-center justify-between">
                <label className="text-base text-[#888]">Repeat</label>
                <select
                  className="bg-[#4a4a4a] text-[#E5E5E5] px-3 py-1 border border-[#343434] text-base"
                  value={gifRepeat}
                  onChange={(e) => setGifRepeat(parseInt(e.target.value))}
                >
                  <option value={0}>Forever</option>
                  <option value={-1}>Once</option>
                  <option value={1}>1 time</option>
                  <option value={2}>2 times</option>
                </select>
              </div>
              <div className="flex items-center justify-between">
                <label className="text-base text-[#888]">Perfect Loop</label>
                <input
                  type="checkbox"
                  checked={gifAutoFrames}
                  onChange={(e) => {
                    const v = e.target.checked;
                    setGifAutoFrames(v);
                  }}
                />
              </div>
              <div className="flex items-center justify-between">
                <label className="text-base text-[#888]">Dithering</label>
                <select
                  className="bg-[#4a4a4a] text-[#E5E5E5] px-3 py-1 border border-[#343434] text-base"
                  value={gifDitherMethod}
                  onChange={(e) => setGifDitherMethod(e.target.value as DitherMethod)}
                >
                  <option value="none">None</option>
                  <option value="floyd-steinberg">Floyd–Steinberg</option>
                  <option value="ordered-4x4">Ordered (Bayer 4×4)</option>
                </select>
              </div>
              <div className="flex items-center justify-between">
                <label className="text-base text-[#888]">Dither Strength</label>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={gifDitherStrength}
                  onChange={(e) => setGifDitherStrength(parseFloat(e.target.value))}
                  className="slider w-48"
                  style={{
                    '--slider-track-gradient': 'linear-gradient(to right, rgba(217,217,217,0.2), rgba(217,217,217,0.6))',
                    '--ascii-thumb-size': '14px',
                    '--slider-progress': `${gifDitherStrength * 100}%`
                  } as React.CSSProperties & { '--slider-progress': string }}
                  disabled={gifDitherMethod === 'none'}
                />
              </div>
              <div className="flex items-center justify-between">
                <label className="text-base text-[#888]">Palette Size</label>
                <select
                  className="bg-[#4a4a4a] text-[#E5E5E5] px-3 py-1 border border-[#343434] text-base"
                  value={gifAutoColors ? 'auto' : String(gifMaxColors)}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === 'auto') {
                      setGifAutoColors(true);
                    } else {
                      setGifAutoColors(false);
                      setGifMaxColors(parseInt(v, 10) as 4 | 8 | 16 | 32 | 64 | 128 | 256);
                    }
                  }}
                >
                  <option value="auto">Auto</option>
                  <option value={4}>4</option>
                  <option value={8}>8</option>
                  <option value={16}>16</option>
                  <option value={32}>32</option>
                  <option value={64}>64</option>
                  <option value={128}>128</option>
                  <option value={256}>256</option>
                </select>
              </div>
              <div className="flex items-center justify-between">
                <label className="text-base text-[#888]">Frame Step</label>
                <select
                  className="bg-[#4a4a4a] text-[#E5E5E5] px-3 py-1 border border-[#343434] text-base"
                  value={gifFrameStep}
                  onChange={(e) => setGifFrameStep(Math.max(1, Math.min(4, parseInt(e.target.value))) as 1|2|3|4)}
                >
                  <option value={1}>1 (every frame)</option>
                  <option value={2}>2 (every other)</option>
                  <option value={3}>3</option>
                  <option value={4}>4</option>
                </select>
              </div>
            </div>
          )}

          {exportKind === 'webgl' && (
            <div className="space-y-5">
              <CollapsibleSection
                id="export-layer-alignment"
                title="Layer alignment"
                isOpen={layerAlignmentOpen}
                onToggle={() => setLayerAlignmentOpen((prev) => !prev)}
                contentClassName="space-y-4"
              >
                <LayerAlignmentControls
                  density="comfortable"
                  appearance="plain"
                  defaultExpanded
                  className="p-0 bg-transparent space-y-4"
                />
                <div className="border border-[#424242] overflow-hidden divide-y divide-[#424242]">
                  {orderedLayers.length === 0 && (
                    <div className="px-4 py-3 text-sm text-[#9C9C9C]">No layers available</div>
                  )}
                  {orderedLayers.map((layer) => {
                    const isActiveLayer = layer.id === activeLayerId;
                    return (
                      <button
                        key={layer.id}
                        type="button"
                        onClick={() => setActiveLayer(layer.id)}
                        className={`w-full text-left transition-colors ${isActiveLayer ? 'bg-[#4A4A4A] text-white' : 'hover:bg-[#353535] text-[#E0E0E0]'}`}
                        disabled={isExporting}
                      >
                        <div className="flex items-center h-7 px-2">
                          <div className={`w-4 h-4 mr-2 flex items-center justify-center ${layer.visible ? 'text-[#D9D9D9]' : 'text-[#666]'}`}>
                            {layer.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                          </div>
                          {renderLayerPreview(layer)}
                          {layer.layerType === 'color-cycle' ? (
                            <div className="ml-1 flex items-center gap-1">
                              <span className={LAYER_TAG_CLASS}>CC</span>
                              <span className={LAYER_TAG_CLASS}>
                                {layer.colorCycleData?.mode === 'recolor' ? 'Recolor' : 'Brush'}
                              </span>
                            </div>
                          ) : (
                            <div className="ml-1 flex items-center gap-1">
                              <span className={LAYER_TAG_CLASS}>Layer</span>
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </CollapsibleSection>

              <div className={`${MODAL_SURFACE_CLASS} p-4 space-y-4`}>
                <div>
                  <h3 className={`${MODAL_TEXT_PRIMARY} text-base font-semibold mb-3`}>Viewport preset</h3>
                  <div className="flex flex-wrap gap-2">
                    {WEBGL_VIEWPORT_PRESETS.map((preset) => (
                      <button
                        key={preset.value}
                        type="button"
                        onClick={() => updateWebglExportSettings({ viewportPreset: preset.value })}
                        className={`${TOGGLE_BASE_CLASS} ${webglViewportPreset === preset.value ? TOGGLE_ACTIVE_CLASS : TOGGLE_INACTIVE_CLASS}`}
                        disabled={isExporting}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                  <p className={`${MODAL_TEXT_SECONDARY} text-xs mt-3`}>
                    {webglViewportPreset === 'embed-fill'
                      ? 'Fills the host container using the larger viewport ratio. Cropping is allowed to avoid gutters.'
                      : webglViewportPreset === 'embed-fit'
                        ? 'Fits to the shorter viewport edge using the smaller ratio. Full composition stays visible.'
                      : webglViewportPreset === 'fixed'
                        ? 'Keeps a fixed non-responsive design canvas for pixel-perfect standalone exports.'
                        : 'Preserves the full composition with fit-style scaling for standalone-safe playback.'}
                  </p>
                </div>
                {webglViewportPreset === 'fixed' && (
                  <div className="space-y-2">
                    <label className="flex items-center justify-between gap-3">
                      <span className={`${MODAL_TEXT_PRIMARY} text-sm font-medium`}>Design scale (%)</span>
                      <Input
                        type="number"
                        min={25}
                        max={800}
                        step={1}
                        value={webglDesignScalePercent}
                        onChange={(event) => {
                          const parsed = parseInt(event.target.value, 10);
                          updateWebglExportSettings({
                            designScalePercent: clampWebglDesignScalePercent(parsed)
                          });
                        }}
                        className={`${INPUT_OVERRIDE_CLASS} w-24 text-right`}
                        disabled={isExporting}
                      />
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {WEBGL_DESIGN_SCALE_PRESETS.map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => updateWebglExportSettings({ designScalePercent: preset })}
                          className={`${TOGGLE_BASE_CLASS} ${webglDesignScalePercent === preset ? TOGGLE_ACTIVE_CLASS : TOGGLE_INACTIVE_CLASS}`}
                          disabled={isExporting}
                        >
                          {preset}%
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="flex flex-col gap-2">
                    <span className={`${MODAL_TEXT_PRIMARY} text-sm font-medium`}>FPS</span>
                    <Input
                      type="number"
                      min={1}
                      max={120}
                      value={webglFps}
                      onChange={(event) => setWebglFps(Math.max(1, Math.min(120, parseInt(event.target.value) || 1)))}
                      className={`${INPUT_OVERRIDE_CLASS} w-full text-right`}
                      disabled={isExporting}
                    />
                  </label>
                  <label className="flex flex-col gap-2">
                    <span className={`${MODAL_TEXT_PRIMARY} text-sm font-medium`}>Duration (s)</span>
                    <Input
                      type="number"
                      min={0.5}
                      step={0.5}
                      value={webglDuration}
                      onChange={(event) => setWebglDuration(Math.max(0.5, parseFloat(event.target.value) || 0.5))}
                      className={`${INPUT_OVERRIDE_CLASS} w-full text-right`}
                      disabled={isExporting || webglAutoFrames}
                    />
                  </label>
                </div>

                <div className="flex flex-col gap-2">
                  <label className="flex items-center justify-between gap-3 text-sm text-[#E0E0E0]">
                    <span className="font-medium">Perfect loop</span>
                    <input
                      type="checkbox"
                      className="accent-[#D9D9D9]"
                      checked={webglAutoFrames}
                      onChange={(event) => setWebglAutoFrames(event.target.checked)}
                      disabled={isExporting}
                    />
                  </label>
                </div>
              </div>

              <div className={`${MODAL_SURFACE_CLASS} p-4 space-y-4`}>
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <h3 className={`${MODAL_TEXT_PRIMARY} text-base font-semibold`}>Export preset</h3>
                  <button
                    type="button"
                    onClick={applyGoblet2SingleHtmlProductionPreset}
                    className={`${TOGGLE_BASE_CLASS} ${TOGGLE_INACTIVE_CLASS}`}
                    disabled={isExporting}
                  >
                    Apply Goblet2 Single-HTML (Production)
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="flex items-center justify-between gap-3 text-sm text-[#E0E0E0]">
                    <span>Include hidden layers</span>
                    <input
                      type="checkbox"
                      className="accent-[#D9D9D9]"
                      checked={webglIncludeHidden}
                      onChange={(event) => updateWebglExportSettings({ includeHiddenLayers: event.target.checked })}
                      disabled={isExporting}
                    />
                  </label>
                  <label className="flex items-center justify-between gap-3 text-sm text-[#E0E0E0]">
                    <span>Embed Canvas2D fallback</span>
                    <input
                      type="checkbox"
                      className="accent-[#D9D9D9]"
                      checked={webglEmbedFallback}
                      onChange={(event) => updateWebglExportSettings({ embedCanvasFallback: event.target.checked })}
                      disabled={isExporting}
                    />
                  </label>
                  <label className="flex items-center justify-between gap-3 text-sm text-[#E0E0E0]">
                    <span>Minify bundle output</span>
                    <input
                      type="checkbox"
                      className="accent-[#D9D9D9]"
                      checked={webglMinify}
                      onChange={(event) => updateWebglExportSettings({ minifyOutput: event.target.checked })}
                      disabled={isExporting}
                    />
                  </label>
                  <label className="flex items-center justify-between gap-3 text-sm text-[#E0E0E0]">
                    <span>Embed diagnostics helpers</span>
                    <input
                      type="checkbox"
                      className="accent-[#D9D9D9]"
                      checked={webglEnableDiagnostics}
                      onChange={(event) => updateWebglExportSettings({ enableGobletDiagnostics: event.target.checked })}
                      disabled={isExporting}
                    />
                  </label>
                </div>
                <div className="flex flex-col gap-2">
                  <label className={`${MODAL_TEXT_PRIMARY} text-sm font-medium`}>Packaging</label>
                  <select
                    className={INLINE_FIELD_CLASS}
                    value={webglBundleFormat}
                    onChange={(event) => updateWebglExportSettings({ bundleFormat: event.target.value as WebGLExportBundleFormat })}
                    disabled={isExporting}
                  >
                    <option value="zip">Goblet bundle (HTML + runtime + JSON)</option>
                    <option value="single-html">Single Goblet HTML (self-contained)</option>
                    <option value="json">Goblet JSON only</option>
                  </select>
                  <div className="flex flex-col gap-2 pt-1">
                    <label className={`${MODAL_TEXT_PRIMARY} text-sm font-medium`}>Goblet runtime</label>
                    <select
                      className={INLINE_FIELD_CLASS}
                      value={webglGobletVersion}
                      onChange={(event) => updateWebglExportSettings({ gobletVersion: event.target.value as WebGLExportGobletVersion })}
                      disabled={isExporting}
                    >
                      <option value="goblet1">{GOBLET_VERSION_LABELS.goblet1}</option>
                      <option value="goblet2">{GOBLET_VERSION_LABELS.goblet2}</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className={`${MODAL_TEXT_PRIMARY} text-sm font-medium`} htmlFor="goblet-html-title">
                      HTML title
                    </label>
                    <Input
                      id="goblet-html-title"
                      type="text"
                      maxLength={120}
                      value={webglHtmlTitle}
                      onChange={(event) => updateWebglExportSettings({ htmlTitle: event.target.value })}
                      placeholder="Goblet"
                      className={INPUT_OVERRIDE_CLASS}
                      disabled={isExporting}
                    />
                  </div>
                  <div className="flex flex-col gap-2 pt-1">
                    <label className={`${MODAL_TEXT_PRIMARY} text-sm font-medium`}>Background colors</label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                      <div className="flex items-center justify-between gap-3 rounded border border-[#343434] bg-[#1F1F1F] px-3 py-2">
                        <span className={MODAL_TEXT_SECONDARY}>Artwork</span>
                        <div className="flex items-center gap-2">
                          <span
                            className="h-5 w-5 border border-[#555]"
                            style={{
                              background: project?.backgroundColor === 'transparent'
                                ? 'repeating-conic-gradient(#666 0% 25%, #333 0% 50%) 50% / 8px 8px'
                                : (project?.backgroundColor || 'transparent')
                            }}
                            aria-hidden="true"
                          />
                        </div>
                      </div>
                      <label className="flex items-center justify-between gap-3 rounded border border-[#343434] bg-[#1F1F1F] px-3 py-2">
                        <span className={MODAL_TEXT_SECONDARY}>Index shell</span>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={webglHtmlBackgroundColor}
                            onChange={(event) => updateWebglExportSettings({ htmlBackgroundColor: event.target.value })}
                            className="h-6 w-8 cursor-pointer border border-[#555] bg-transparent p-0"
                            disabled={isExporting}
                            aria-label="Goblet HTML shell background color"
                          />
                        </div>
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Video Options */}
{exportKind === 'mp4' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-base text-[#888]">FPS</label>
                <Input type="number" min={1} max={60} value={videoFps} onChange={(e) => setVideoFps(Math.max(1, Math.min(60, parseInt(e.target.value)||1)))} className="w-24 text-right" />
              </div>
              <div className="flex items-center justify-between">
                <label className="text-base text-[#888]">Duration (s)</label>
                <Input
                  type="number"
                  min={1}
                  max={60}
                  step={0.5}
                  value={videoDuration}
                  onChange={(e) => setVideoDuration(Math.max(1, Math.min(60, parseFloat(e.target.value) || 1)))}
                  className="w-24 text-right"
                  disabled={videoAutoFrames}
                />
              </div>
              <div className="flex flex-col gap-2">
                <label className="flex items-center justify-between gap-3 text-sm text-[#E0E0E0]">
                  <span className="font-medium">Perfect loop (best guess)</span>
                  <input
                    type="checkbox"
                    className="accent-[#D9D9D9]"
                    checked={videoAutoFrames}
                    onChange={(event) => setVideoAutoFrames(event.target.checked)}
                    disabled={isExporting}
                  />
                </label>
              </div>
              <div className="flex items-center justify-between">
                <label className="text-base text-[#888]">Format</label>
                <select
                  className="bg-[#4a4a4a] text-[#E5E5E5] px-3 py-1 border border-[#343434] text-base"
                  value={videoMime}
                  onChange={(e) => setVideoMime(e.target.value as 'video/mp4' | 'video/webm')}
                >
                  <option value="video/webm">WebM</option>
                  <option value="video/mp4">MP4 (best-effort)</option>
                </select>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-4">
                  <label className="text-base text-[#888]">Compression</label>
                  <div className="text-right leading-tight">
                    <div className="text-sm text-[#E5E5E5]">{videoCompressionPercent}%</div>
                    <div className="text-xs text-[#888]">{videoBitrate.toLocaleString()} kbps</div>
                  </div>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={videoCompressionPercent}
                  onChange={(e) => setVideoBitrate(compressionPercentToBitrate(parseInt(e.target.value, 10) || 0))}
                  className="slider w-full"
                  style={{
                    '--slider-track-gradient': 'linear-gradient(to right, rgba(217,217,217,0.2), rgba(217,217,217,0.6))',
                    '--ascii-thumb-size': '14px',
                    '--slider-progress': `${videoCompressionPercent}%`
                  } as React.CSSProperties & { '--slider-progress': string }}
                  disabled={isExporting}
                  aria-label="Video compression"
                />
                <div className="flex items-center justify-between text-xs text-[#777]">
                  <span>Lower compression / higher quality</span>
                  <span>Higher compression / smaller file</span>
                </div>
              </div>
            </div>
          )}

          {/* Progress */}
          {isExporting && (
            <div className="w-full bg-[#353535] h-2 overflow-hidden">
              <div className="bg-[#D9D9D9] h-full transition-all" style={{ width: `${progress}%` }} />
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2">
            {isExporting ? (
              <Button variant="secondary" onClick={() => { exportAbortRef.current?.abort(); }}>
                Cancel
              </Button>
            ) : (
              <>
                <Button variant="secondary" onClick={onClose}>Close</Button>
                <Button variant="primary" onClick={handleExport}>Export</Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ExportModal;
