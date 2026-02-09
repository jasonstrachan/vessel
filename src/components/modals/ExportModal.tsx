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
import { estimateExport, runExport } from '@/utils/export/exportService';
import type { FrameProvider } from '@/utils/export/types';
import type { Layer, WebGLExportBundleFormat, WebGLExportGobletVersion } from '@/types';

type ExportKind = 'png' | 'gif' | 'mp4' | 'webgl';

const BUNDLE_FORMAT_DESCRIPTIONS: Record<WebGLExportBundleFormat, string> = {
  zip: 'Bundles the Goblet viewer shell, runtime, and JSON into a single zip.',
  'single-html': 'Produces a self-contained Goblet page for instant sharing.',
  json: 'Downloads only the raw Goblet metadata JSON bundle.'
};

const BUNDLE_FORMAT_LABELS: Record<WebGLExportBundleFormat, string> = {
  zip: 'Goblet bundle zip',
  'single-html': 'single-file Goblet',
  json: 'Goblet JSON bundle'
};

const GOBLET_VERSION_LABELS: Record<WebGLExportGobletVersion, string> = {
  goblet1: 'Goblet 1 (legacy)',
  goblet2: 'Goblet 2 (GPU-first)'
};

const GOBLET_VERSION_DESCRIPTIONS: Record<WebGLExportGobletVersion, string> = {
  goblet1: 'Legacy runtime. Keeps Goblet v1 semantics and CPU-first playback.',
  goblet2: 'Goblet 2 runtime with per-pixel speed buffers and WebGL2-first playback.'
};

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
  { value: 'fill', label: 'Fill window' },
  { value: 'fixed', label: 'Design size' }
] as const;

type WebglViewportPreset = typeof WEBGL_VIEWPORT_PRESETS[number]['value'];

interface CollapsibleSectionProps {
  id: string;
  title: string;
  summary?: string;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  contentClassName?: string;
}

const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
  id,
  title,
  summary,
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
          {summary && (
            <span className={`${MODAL_TEXT_SECONDARY} text-xs mt-1 block`}>{summary}</span>
          )}
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

const formatLabel = (value: string): string => (
  value.split(/[-_\s]+/).map((part) => (
    part ? part[0].toUpperCase() + part.slice(1) : ''
  )).join(' ')
);

const hasSequentialExportLayers = (layers: Layer[] | undefined): boolean =>
  Array.isArray(layers) && layers.some((layer) => layer.layerType === 'sequential' && !!layer.sequentialData);

interface SequentialExportRiskSummary {
  frameBudget: number;
  estimatedBytes: number;
  bundleFormat: WebGLExportBundleFormat;
}

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ExportModal: React.FC<ExportModalProps> = ({ isOpen, onClose }) => {
  // Suspend global/canvas shortcuts while modal is open
  useKeyboardScope('modal', isOpen);

  const project = useAppStore((s) => s.project);
  const compositeLayersToCanvas = useAppStore((s) => s.compositeLayersToCanvas);
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
  const [scale, setScale] = useState<1 | 2 | 3 | 4>(1);

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
  // Live readout of palette size used during export (informational)
  const [gifPaletteCount, setGifPaletteCount] = useState<number | null>(null);

  // Video options
  const [videoFps, setVideoFps] = useState(30);
  const [videoDuration, setVideoDuration] = useState(3);
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
  const [webglViewportPreset, setWebglViewportPreset] = useState<WebglViewportPreset>('fill');
  const hasSequentialLayers = useMemo(
    () => hasSequentialExportLayers(layers),
    [layers]
  );
  const sequentialExportRisk = useMemo<SequentialExportRiskSummary | null>(() => {
    if (!hasSequentialLayers) {
      return null;
    }

    const frameBudget = layers.reduce((sum, layer) => {
      if (layer.layerType !== 'sequential' || !layer.sequentialData) {
        return sum;
      }
      const frames = Math.max(1, Math.round(layer.sequentialData.frameCount || 1));
      return sum + frames;
    }, 0);
    const width = Math.max(1, Math.round(project?.width ?? 1));
    const height = Math.max(1, Math.round(project?.height ?? 1));
    const rawBytes = frameBudget * width * height * 4;
    const textureCompressionRatio = webglMinify ? 0.16 : 0.19;
    const formatMultiplier = webglBundleFormat === 'single-html'
      ? 1.2
      : (webglBundleFormat === 'zip' ? 0.72 : 1);
    const estimatedBytes = Math.round(rawBytes * textureCompressionRatio * formatMultiplier);
    return {
      frameBudget,
      estimatedBytes,
      bundleFormat: webglBundleFormat,
    };
  }, [hasSequentialLayers, layers, project?.height, project?.width, webglBundleFormat, webglMinify]);

  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const exportAbortRef = useRef<AbortController | null>(null);
  // Estimation (pre-export)
  const [isEstimating, setIsEstimating] = useState(false);
  const [gifEstimatedPalette, setGifEstimatedPalette] = useState<number | null>(null);
  const [gifEstimatedSize, setGifEstimatedSize] = useState<number | null>(null);
  const estimateAbortRef = useRef<AbortController | null>(null);

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
    const fallbackWidth = project?.width ?? 1024;
    const fallbackHeight = project?.height ?? 1024;
    return { designWidth: fallbackWidth, designHeight: fallbackHeight };
  }, [project?.height, project?.width]);

  const webglFrameSuggestion = useMemo(() => {
    try {
      const fps = Math.max(1, Math.floor(webglFps));
      const targetFrames = Math.max(1, Math.round(webglDuration * fps));
      const store = useAppStore.getState();
      const recolorSpeeds: number[] = layers
        .filter(l => l.layerType === 'color-cycle' && l.colorCycleData?.mode === 'recolor' && l.colorCycleData?.recolorSettings)
        .map(l => l.colorCycleData!.recolorSettings!.animation.speed || 0.1)
        .filter(s => Number.isFinite(s) && s > 0);
      const brushSpeeds: number[] = layers
        .filter(l => l.layerType === 'color-cycle' && (l.colorCycleData?.mode !== 'recolor'))
        .map(() => (store.tools?.brushSettings?.colorCycleSpeed ?? 0.1))
        .filter(s => Number.isFinite(s) && s > 0);
      const speeds = [...recolorSpeeds, ...brushSpeeds];

      if (speeds.length === 0) {
        return { frames: targetFrames, success: false, duration: targetFrames / fps };
      }

      const minFrames = 8;
      const maxFrames = Math.max(minFrames, Math.round(fps * 20));
      const EPS = 1e-3;

      for (let f = minFrames; f <= maxFrames; f++) {
        let ok = true;
        for (const s of speeds) {
          const cycles = (s * f) / fps;
          const residual = Math.abs(cycles - Math.round(cycles));
          if (residual >= EPS) { ok = false; break; }
        }
        if (ok) {
          return { frames: f, success: true, duration: f / fps };
        }
      }

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
        const dist = Math.abs(f - targetFrames) / Math.max(1, targetFrames);
        const score = maxResidual + dist * 1e-3;
        if (score < bestScore) {
          bestScore = score;
          best = f;
        }
      }
      return { frames: best, success: false, duration: best / fps };
    } catch {
      const fps = Math.max(1, Math.floor(webglFps));
      const fallbackFrames = Math.max(1, Math.round(webglDuration * fps));
      return { frames: fallbackFrames, success: false, duration: fallbackFrames / fps };
    }
  }, [layers, webglDuration, webglFps]);

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

  const layerAlignmentSummary = useMemo(() => orderedLayers.map(layer => ({
    id: layer.id,
    name: layer.name,
    visible: layer.visible,
    fit: layer.alignment.fit,
    horizontal: layer.alignment.horizontal,
    vertical: layer.alignment.vertical,
    offset: {
      x: layer.alignment.offsetPx?.x ?? 0,
      y: layer.alignment.offsetPx?.y ?? 0
    },
    isActive: layer.id === activeLayerId,
    kind: layer.layerType
  })), [activeLayerId, orderedLayers]);

  const activeLayerSummary = useMemo(() => {
    if (layerAlignmentSummary.length === 0) {
      return 'No layers available';
    }
    const activeLayer = layerAlignmentSummary.find((layer) => layer.isActive);
    if (!activeLayer) {
      return 'Select a layer to adjust alignment';
    }
    const alignment = [
      formatLabel(activeLayer.fit),
      `${formatLabel(activeLayer.horizontal)} / ${formatLabel(activeLayer.vertical)}`
    ];
    if (activeLayer.offset.x || activeLayer.offset.y) {
      alignment.push(`Offset ${activeLayer.offset.x}, ${activeLayer.offset.y}`);
    }
    if (!activeLayer.visible) {
      alignment.push('Hidden');
    }
    return alignment.join(' • ');
  }, [layerAlignmentSummary]);

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

  // Estimate palette size and approximate file size before export
  useEffect(() => {
    if (!isOpen || exportKind !== 'gif') return;
    if (isExporting) return;
    setIsEstimating(true);
    setGifEstimatedPalette(null);
    setGifEstimatedSize(null);

    const handle = setTimeout(async () => {
      const controller = new AbortController();
      estimateAbortRef.current = controller;
      try {
        const result = await estimateExport({
          kind: 'gif',
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
        }, controller.signal);
        if (controller.signal.aborted) return;
        setGifEstimatedPalette(result.paletteSize);
        setGifEstimatedSize(result.estimatedBytes);
      } catch {
        // ignore
      } finally {
        if (estimateAbortRef.current === controller) {
          setIsEstimating(false);
        }
      }
    }, 250);

    return () => {
      clearTimeout(handle);
      estimateAbortRef.current?.abort();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, exportKind, gifFps, gifDuration, gifRepeat, gifAutoFrames, gifDitherMethod, gifDitherStrength, gifFrameStep, gifMaxColors, gifAutoColors, scale, project?.width, project?.height, autoFrameSuggestion.frames]);

  const formatBytes = (bytes: number): string => {
    if (!Number.isFinite(bytes) || bytes < 0) return '—';
    const units = ['B', 'KB', 'MB', 'GB'];
    let v = bytes;
    let u = 0;
    while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
    return `${v.toFixed(u === 0 ? 0 : v < 10 ? 2 : 1)} ${units[u]}`;
  };

  const formatMegabytes = (bytes: number): string =>
    `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

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
    setIsExporting(true);
    setProgress(0);
    setGifPaletteCount(null);
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
                    designWidth: project?.width ?? 1024,
                    designHeight: project?.height ?? 1024,
                    mode: (webglViewportPreset === 'fill' ? 'fill' : 'fixed') as 'fill' | 'fixed'
                  },
                  fps: Math.max(1, Math.floor(webglFps)),
                  totalFrames: webglTotalFrames,
                  durationSeconds: webglEffectiveDuration,
                  perfectLoop: webglAutoFrames,
                  includeHiddenLayers: webglIncludeHidden,
                  embedCanvasFallback: webglEmbedFallback,
                  minify: webglMinify,
                  filenameBase,
                  bundleFormat: webglBundleFormat,
                  gobletVersion: webglGobletVersion,
                  enableGobletDiagnostics: webglEnableDiagnostics,
                  compositeLayersToCanvas,
                  htmlTitle: webglHtmlTitle
                },
                bundleFormat: webglBundleFormat,
                gobletVersion: webglGobletVersion,
                htmlTitle: webglHtmlTitle
              }
            }
            : {
              kind: 'video' as const,
              filenameBase,
              scale,
              frameProvider,
              options: {
                fps: videoFps,
                durationSeconds: videoDuration,
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
        if (result.kind === 'gif') {
          setGifPaletteCount(result.paletteSize);
        }
        downloadBlob(result.blob, result.filename);
      }
      onClose();
    } catch (e) {
      alert(`Export failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
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
                  {[1,2,3,4].map((value) => (
                    <button
                      key={value}
                      onClick={() => setScale(value as 1|2|3|4)}
                      className={`${TOGGLE_BASE_CLASS} ${scale === value ? TOGGLE_ACTIVE_CLASS : TOGGLE_INACTIVE_CLASS}`}
                      disabled={isExporting}
                    >
                      {value}x
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
                <Input type="number" min={1} max={60} value={gifFps} onChange={(e) => setGifFps(Math.max(1, Math.min(60, parseInt(e.target.value)||1)))} className="w-24 text-right" />
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
              {/* Estimates */}
              <div className="text-xs text-[#aaa] flex flex-col gap-1">
                <div>
                  Palette (est): {isEstimating ? 'estimating…' : (gifEstimatedPalette ?? '—')} colors
                </div>
                <div>
                  Est. size: {gifEstimatedSize !== null ? formatBytes(gifEstimatedSize) : (isEstimating ? 'estimating…' : '—')}
                </div>
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
              {gifAutoFrames && (
                <div className="text-xs text-[#aaa] flex flex-col gap-1">
                  <div>Frames: {autoFrameSuggestion.frames} {autoFrameSuggestion.success ? '(perfect)' : '(closest)'} · FPS: {Math.max(1, Math.floor(gifFps / Math.max(1, gifFrameStep)))}</div>
                  <div>Resulting duration: {autoFrameSuggestion.duration.toFixed(2)}s</div>
                </div>
              )}
              {gifPaletteCount !== null && (
                <div className="text-xs text-[#aaa]">Palette: {gifPaletteCount} colors</div>
              )}
              <div className="text-xs text-[#aaa]">Tip: Lower FPS or increase Frame Step to reduce frames. Fewer palette colors and disabling dithering can significantly shrink file size. For long/high-res animations, prefer Video.</div>
            </div>
          )}

          {exportKind === 'webgl' && (
            <div className="space-y-5">
              <CollapsibleSection
                id="export-layer-alignment"
                title="Layer alignment"
                summary={activeLayerSummary}
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
                        onClick={() => setWebglViewportPreset(preset.value)}
                        className={`${TOGGLE_BASE_CLASS} ${webglViewportPreset === preset.value ? TOGGLE_ACTIVE_CLASS : TOGGLE_INACTIVE_CLASS}`}
                        disabled={isExporting}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                  <p className={`${MODAL_TEXT_SECONDARY} text-xs mt-3`}>
                  Using {resolvedWebglViewport.designWidth} × {resolvedWebglViewport.designHeight} px
                  </p>
                </div>

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
                  <span className={`${MODAL_TEXT_SECONDARY} text-xs`}>
                    {webglAutoFrames
                      ? `${webglFrameSuggestion.frames} frames (${webglFrameSuggestion.success ? 'exact' : 'approx'})`
                      : `${webglTotalFrames} frames`}
                  </span>
                  <span className={`${MODAL_TEXT_SECONDARY} text-xs`}>
                    Playback duration: {webglEffectiveDuration.toFixed(2)}s
                  </span>
                </div>
              </div>

              <div className={`${MODAL_SURFACE_CLASS} p-4 space-y-4`}>
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
                <p className={`${MODAL_TEXT_SECONDARY} text-xs`}>
                  Diagnostics helpers log Goblet runtime state to the console and expose `vesselGobletSetDiagnostics(true)` at runtime.
                  Disable for production hand-offs.
                </p>
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
                  <p className={`${MODAL_TEXT_SECONDARY} text-xs`}>
                    {BUNDLE_FORMAT_DESCRIPTIONS[webglBundleFormat]}
                  </p>
                  {hasSequentialLayers && sequentialExportRisk && (
                    <p className={`${MODAL_TEXT_SECONDARY} text-xs`}>
                      Current sequential estimate: {formatMegabytes(sequentialExportRisk.estimatedBytes)} ({sequentialExportRisk.bundleFormat}, {webglMinify ? 'minified' : 'not minified'}).
                    </p>
                  )}
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
                    <p className={`${MODAL_TEXT_SECONDARY} text-xs`}>
                      {GOBLET_VERSION_DESCRIPTIONS[webglGobletVersion]}
                    </p>
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
                    <p className={`${MODAL_TEXT_SECONDARY} text-xs`}>
                      Used as the document title for Goblet HTML exports{webglBundleFormat === 'json' ? ' (JSON-only downloads ignore this value).' : '.'}
                    </p>
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
                <Input type="number" min={1} max={60} value={videoDuration} onChange={(e) => setVideoDuration(Math.max(1, Math.min(60, parseInt(e.target.value)||1)))} className="w-24 text-right" />
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
              <div className="flex items-center justify-between">
                <label className="text-base text-[#888]">Bitrate (kbps)</label>
                <Input type="number" min={1000} max={20000} value={videoBitrate} onChange={(e) => setVideoBitrate(Math.max(1000, Math.min(20000, parseInt(e.target.value)||6000)))} className="w-24 text-right" />
              </div>
              <div className="text-xs text-[#aaa]">Note: Many browsers only support WebM in MediaRecorder. MP4 will fallback to WebM if unsupported.</div>
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
