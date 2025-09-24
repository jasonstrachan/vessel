"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Palette, RGB, RGBA } from 'gifenc';
import { useAppStore } from '../../stores/useAppStore';
import { XIcon } from '../icons/XIcon';
import Input from '../ui/Input';
import Button from '../ui/Button';
import { useKeyboardScope } from '../../hooks/useKeyboardScope';
import { RecolorManager } from '@/lib/colorCycle/RecolorManager';
import { mapToIndexedWithDithering, type DitherMethod } from '@/utils/gifDither';
import { ContainerLayoutControls, LayerAlignmentControls, LayerColorSwatches, LAYER_TAG_CLASS } from '@/components/MinimalLayerList';
import { Eye, EyeOff } from 'lucide-react';
import { createDefaultExportLayout } from '@/utils/layoutDefaults';
import { exportProjectAsWebGL } from '@/utils/export/webglExporter';
import type { Layer, WebGLExportBundleFormat } from '@/types';

type ExportKind = 'png' | 'gif' | 'mp4' | 'webgl';

const BUNDLE_FORMAT_DESCRIPTIONS: Record<WebGLExportBundleFormat, string> = {
  zip: 'Bundles the viewer, runtime, and JSON into a single zip.',
  'single-html': 'Produces a self-contained HTML viewer for instant sharing.',
  json: 'Downloads only the raw TinyBrush JSON bundle.'
};

const BUNDLE_FORMAT_LABELS: Record<WebGLExportBundleFormat, string> = {
  zip: 'viewer bundle zip',
  'single-html': 'single-file viewer',
  json: 'JSON bundle'
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
  { value: 'project', label: 'Project' },
  { value: 'square', label: 'Square' },
  { value: 'widescreen', label: 'Widescreen' },
  { value: 'custom', label: 'Custom' }
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

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ExportModal: React.FC<ExportModalProps> = ({ isOpen, onClose }) => {
  // Normalize a loose number[][] palette to a gifenc Palette (RGB[] or RGBA[])
  const toGifPalette = (p: number[][]): Palette => {
    if (p.length === 0) return [] as RGB[];
    const hasAlpha = p.some((c) => c.length >= 4);
    if (hasAlpha) {
      return p.map((c) => [c[0] | 0, c[1] | 0, c[2] | 0, (c[3] ?? 255) | 0] as RGBA) as RGBA[];
    }
    return p.map((c) => [c[0] | 0, c[1] | 0, c[2] | 0] as RGB) as RGB[];
  };

  const toRgbaEntries = (entries: number[][]): number[][] => (
    entries.map((entry) => (
      entry.length === 4 ? entry.slice(0, 4) : [entry[0], entry[1], entry[2], 255]
    ))
  );
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

  const [containerLayoutOpen, setContainerLayoutOpen] = useState(false);
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
  const webglEnableDiagnostics = webglExportSettings.enableViewerDiagnostics;
  const [webglViewportPreset, setWebglViewportPreset] = useState<WebglViewportPreset>('project');
  const [webglCustomViewport, setWebglCustomViewport] = useState<{ width: number; height: number }>(() => ({
    width: project?.width ?? 1024,
    height: project?.height ?? 1024
  }));

  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const cancelRef = useRef<{ cancelled: boolean }>({ cancelled: false });
  // Estimation (pre-export)
  const [isEstimating, setIsEstimating] = useState(false);
  const [gifEstimatedPalette, setGifEstimatedPalette] = useState<number | null>(null);
  const [gifEstimatedSize, setGifEstimatedSize] = useState<number | null>(null);
  const estimateCancelRef = useRef<{ cancelled: boolean }>({ cancelled: false });

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
      setContainerLayoutOpen(false);
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
        .map(l => (l.colorCycleData?.brushSpeed ?? store.tools?.brushSettings?.colorCycleSpeed ?? 0.1))
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
    switch (webglViewportPreset) {
      case 'project':
        return { width: fallbackWidth, height: fallbackHeight };
      case 'square': {
        const side = Math.max(fallbackWidth, fallbackHeight);
        return { width: side, height: side };
      }
      case 'widescreen':
        return { width: 1920, height: 1080 };
      case 'custom':
      default:
        return {
          width: Math.max(1, Math.round(webglCustomViewport.width)),
          height: Math.max(1, Math.round(webglCustomViewport.height))
        };
    }
  }, [project?.height, project?.width, webglCustomViewport.height, webglCustomViewport.width, webglViewportPreset]);

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
        .map(l => (l.colorCycleData?.brushSpeed ?? store.tools?.brushSettings?.colorCycleSpeed ?? 0.1))
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

  const containerLayoutSummary = useMemo(() => {
    const layout = project?.exportLayout ?? createDefaultExportLayout();
    const parts = [
      formatLabel(layout.flow),
      `${formatLabel(layout.justify)} / ${formatLabel(layout.align)}`,
      layout.wrap ? 'Wrap on' : 'Wrap off'
    ];
    if (layout.gap) {
      parts.push(`Gap ${layout.gap}px`);
    }
    if (layout.sizeMode === 'fixed') {
      parts.push(`Fixed ${layout.width ?? 0}×${layout.height ?? 0}`);
    } else if (layout.sizeMode === 'hug') {
      parts.push('Hug content');
    } else {
      parts.push('Fill viewport');
    }
    return parts.join(' • ');
  }, [project?.exportLayout]);

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

  const handleCustomViewportChange = useCallback((dimension: 'width' | 'height', raw: string) => {
    if (raw === '') {
      setWebglCustomViewport(prev => ({ ...prev, [dimension]: 1 }));
      return;
    }
    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) {
      return;
    }
    setWebglCustomViewport(prev => ({
      ...prev,
      [dimension]: Math.max(1, Math.round(numeric))
    }));
  }, []);

  const filenameBase = useMemo(() => {
    const name = project?.name || 'TinyBrush';
    return name.replace(/\s+/g, '_');
  }, [project?.name]);

  const composeBaseCanvas = (): HTMLCanvasElement => {
    const base = document.createElement('canvas');
    const w = project?.width || 1;
    const h = project?.height || 1;
    base.width = w;
    base.height = h;
    if (compositeLayersToCanvas) {
      compositeLayersToCanvas(base);
    }
    return base;
  };

  // Estimate palette size and approximate file size before export
  useEffect(() => {
    if (!isOpen || exportKind !== 'gif') return;
    if (isExporting) return;
    estimateCancelRef.current.cancelled = false;
    setIsEstimating(true);
    setGifEstimatedPalette(null);
    setGifEstimatedSize(null);

    const handle = setTimeout(async () => {
      try {
        const { GIFEncoder, quantize, applyPalette } = await import('gifenc/dist/gifenc.esm.js');
        const fps = Math.max(1, Math.floor(gifFps / Math.max(1, gifFrameStep)));
        const total = Math.max(1, Math.round((gifAutoFrames ? autoFrameSuggestion.duration : gifDuration) * fps));
        const sampleFrames = Math.max(1, Math.min(3, total));
        const sampleIndices = new Set<number>();
        if (sampleFrames === 1) sampleIndices.add(0);
        else if (sampleFrames === 2) { sampleIndices.add(0); sampleIndices.add(total - 1); }
        else { sampleIndices.add(0); sampleIndices.add(Math.floor(total / 2)); sampleIndices.add(total - 1); }

        // Canvases
        const base = document.createElement('canvas');
        base.width = project?.width || 1;
        base.height = project?.height || 1;
        const scaledW = Math.max(1, Math.floor(base.width * scale));
        const scaledH = Math.max(1, Math.floor(base.height * scale));
        const scaled = document.createElement('canvas');
        scaled.width = scaledW; scaled.height = scaledH;
        const sctx = scaled.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
        if (!sctx) throw new Error('No 2D context for estimate');

        const frames: ImageData[] = [];
        const usedRGB = new Set<number>();
        let usesTransparency = false;
        const ALPHA_THRESHOLD = 16;

        const recolorManager = RecolorManager.getInstance();
        const advanceRecolor = () => {
          try {
            const store = useAppStore.getState();
            for (const layer of store.layers) {
              if (layer.layerType === 'color-cycle' && layer.colorCycleData?.mode === 'recolor') {
                recolorManager.updateAnimation(layer);
              }
            }
          } catch {}
        };

        let captured = 0;
        for (let i = 0; i < total; i++) {
          if (estimateCancelRef.current.cancelled) return;
          if (sampleIndices.has(i)) {
            const store2 = useAppStore.getState();
            const useAbsolutePhase = gifAutoFrames; // Always drive by absolute phase when Perfect Loop is enabled
            const phase = useAbsolutePhase ? (i / total) : null;
            // Advance recolor-mode layers deterministically for estimates
            try {
              for (const layer of store2.layers) {
                if (layer.layerType === 'color-cycle' && layer.colorCycleData?.mode === 'recolor') {
                  if (useAbsolutePhase && phase !== null) {
                    recolorManager.setPhase(layer, phase);
                  } else {
                    recolorManager.updateAnimation(layer);
                  }
                }
              }
            } catch {}
            // Advance brush-mode layers deterministically for estimates
            try {
              for (const layer of store2.layers) {
                if (layer.layerType === 'color-cycle' && layer.colorCycleData && layer.colorCycleData.mode !== 'recolor') {
                  const brush = store2.getLayerColorCycleBrush(layer.id);
                  if (brush) {
                    if (useAbsolutePhase && phase !== null) {
                      brush.setPhase(phase);
                    } else {
                      brush.updateAnimation();
                    }
                  }
                }
              }
            } catch {}
            compositeLayersToCanvas(base);
            sctx.imageSmoothingEnabled = true;
            sctx.imageSmoothingQuality = 'high';
            sctx.drawImage(base, 0, 0, scaledW, scaledH);
            const img = sctx.getImageData(0, 0, scaledW, scaledH);
            frames.push(img);
            const data = img.data;
            for (let p = 0; p < data.length; p += 4) {
              const a = data[p + 3];
              if (a <= ALPHA_THRESHOLD) { usesTransparency = true; continue; }
              usedRGB.add((data[p] << 16) | (data[p + 1] << 8) | data[p + 2]);
            }
            captured++;
            if (captured >= sampleFrames) break;
          }
          advanceRecolor();
        }

        // Palette build (estimated)
        const needTransparentSlot = usesTransparency;
        const manualTarget = gifMaxColors;
        const targetSize = gifAutoColors ? 256 : manualTarget;
        let palette: number[][] = [];
        const candidateCount = usedRGB.size + (needTransparentSlot ? 1 : 0);
        if (gifAutoColors && candidateCount <= 256) {
          if (needTransparentSlot) palette.push([0, 0, 0, 0]);
          for (const rgb of usedRGB) {
            const r = (rgb >> 16) & 255; const g = (rgb >> 8) & 255; const b = rgb & 255;
            palette.push([r, g, b, 255]);
          }
        } else {
          const target = needTransparentSlot ? targetSize - 1 : targetSize;
          const targetSamples = 120_000;
          const totalPix = frames.reduce((acc, f) => acc + (f.width * f.height), 0);
          const stride = Math.max(1, Math.floor(totalPix / targetSamples));
          const approxLen = frames.reduce((acc, f) => acc + Math.ceil((f.data.length) / stride), 0);
          const buf = new Uint8Array(approxLen);
          let w = 0;
          for (const f of frames) {
            const arr = f.data;
            for (let i = 0; i < arr.length; i += 4 * stride) {
              const a = arr[i + 3]; if (a <= ALPHA_THRESHOLD) continue;
              if (w + 4 > buf.length) break;
              buf[w++] = arr[i]; buf[w++] = arr[i + 1]; buf[w++] = arr[i + 2]; buf[w++] = a;
            }
          }
          const sampleBuf = w ? buf.slice(0, w) : new Uint8Array([0,0,0,255]);
          const q = quantize(sampleBuf, Math.max(1, target), { format: 'rgb565' }) as number[][];
          const quantizedPalette = toRgbaEntries(q);
          palette = needTransparentSlot ? [[0, 0, 0, 0], ...quantizedPalette] : quantizedPalette;
          // If user selected a manual size, force exact palette length
          if (!gifAutoColors) {
            const desired = targetSize;
            if (palette.length < desired) {
              const fill = palette.find((c) => c.length < 4 || c[3] !== 0) || [0, 0, 0, 255];
              while (palette.length < desired) {
                const f = fill.length === 3 ? [fill[0], fill[1], fill[2], 255] : fill.slice(0, 4);
                palette.push(f);
              }
            } else if (palette.length > desired) {
              palette = palette.slice(0, desired);
            }
          }
        }
        setGifEstimatedPalette(palette.length);

        // Size estimate
        try {
          const enc = GIFEncoder();
          const tIndex = palette.findIndex((c) => (c.length >= 4 && c[3] === 0));
          for (const img of frames) {
            let index: Uint8Array;
            if (gifDitherMethod === 'none') {
              index = applyPalette(img.data, toGifPalette(palette));
              if (tIndex >= 0) {
                for (let p = 0, px = 0; p < img.data.length; p += 4, px++) {
                  if (img.data[p + 3] <= 16) index[px] = tIndex;
                }
              }
            } else {
              index = mapToIndexedWithDithering(
                img.data, scaledW, scaledH, palette,
                { method: gifDitherMethod, strength: gifDitherStrength, alphaThreshold: 16 }
              );
            }
            enc.writeFrame(index, scaledW, scaledH, {
              palette: toGifPalette(palette),
              delay: Math.round(1000 / fps),
              repeat: gifRepeat,
              transparentIndex: tIndex >= 0 ? tIndex : undefined,
            });
          }
          enc.finish();
          const size = enc.bytes().length;
          const est = Math.max(1, Math.round(size * (total / Math.max(1, frames.length))));
          setGifEstimatedSize(est);
        } catch {
          setGifEstimatedSize(null);
        }
      } catch {
        // ignore
      } finally {
        setIsEstimating(false);
      }
    }, 250);

    const cancelToken = estimateCancelRef.current;
    return () => {
      cancelToken.cancelled = true;
      clearTimeout(handle);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, exportKind, gifFps, gifDuration, gifRepeat, gifAutoFrames, gifDitherMethod, gifDitherStrength, gifFrameStep, gifMaxColors, gifAutoColors, scale, project?.width, project?.height, autoFrameSuggestion.duration]);

  const formatBytes = (bytes: number): string => {
    if (!Number.isFinite(bytes) || bytes < 0) return '—';
    const units = ['B', 'KB', 'MB', 'GB'];
    let v = bytes;
    let u = 0;
    while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
    return `${v.toFixed(u === 0 ? 0 : v < 10 ? 2 : 1)} ${units[u]}`;
  };

  const drawScaled = (src: HTMLCanvasElement, scaleFactor: number): HTMLCanvasElement => {
    if (scaleFactor === 1) return src;
    const dst = document.createElement('canvas');
    dst.width = Math.max(1, Math.floor(src.width * scaleFactor));
    dst.height = Math.max(1, Math.floor(src.height * scaleFactor));
    const dctx = dst.getContext('2d', { colorSpace: 'srgb' });
    if (!dctx) return src;
    dctx.imageSmoothingEnabled = true;
    dctx.imageSmoothingQuality = 'high';
    dctx.drawImage(src, 0, 0, dst.width, dst.height);
    return dst;
  };

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

  async function exportPNG() {
    const base = composeBaseCanvas();
    const scaled = drawScaled(base, scale);
    const includeBg = pngIncludeBg;

    // If background should be transparent off, paint background color on a copy
    let finalCanvas = scaled;
    if (includeBg && project?.backgroundColor && project.backgroundColor !== 'transparent') {
      const withBg = document.createElement('canvas');
      withBg.width = scaled.width;
      withBg.height = scaled.height;
      const bgctx = withBg.getContext('2d', { colorSpace: 'srgb' });
      if (bgctx) {
        bgctx.fillStyle = project.backgroundColor;
        bgctx.fillRect(0, 0, withBg.width, withBg.height);
        bgctx.drawImage(scaled, 0, 0);
        finalCanvas = withBg;
      }
    }
    const quality = Math.max(0.1, Math.min(1, pngQuality));
    return new Promise<void>((resolve, reject) => {
      finalCanvas.toBlob(
        (blob) => {
          if (!blob) return reject(new Error('Failed to create PNG'));
          downloadBlob(blob, `${filenameBase}@${scale}x.png`);
          resolve();
        },
        'image/png',
        quality
      );
    });
  }

  async function exportGIF() {
    const effectiveFps = Math.max(1, Math.floor(gifFps / Math.max(1, gifFrameStep)));
    let totalFrames = Math.max(1, Math.round(gifDuration * effectiveFps));
    cancelRef.current.cancelled = false;
    setProgress(0);
    setGifPaletteCount(null);

    // Dynamically import gifenc (ESM build) to avoid dev chunk 404s
    // Prefer explicit ESM path for reliable bundling
    const { GIFEncoder, quantize, applyPalette } = await import('gifenc/dist/gifenc.esm.js');

    // We'll render to base size then scale for encoding
    const base = document.createElement('canvas');
    base.width = project?.width || 1;
    base.height = project?.height || 1;
    const scaledW = Math.max(1, Math.floor(base.width * scale));
    const scaledH = Math.max(1, Math.floor(base.height * scale));
    const scaled = document.createElement('canvas');
    scaled.width = scaledW;
    scaled.height = scaledH;
    const sctx = scaled.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
    if (!sctx) throw new Error('No canvas context for GIF export');

    const gif = GIFEncoder();

    // If requested and color-cycling exists, adjust frames for a perfect loop
    try {
      const st0 = useAppStore.getState();
      const hasAnyCC = st0.layers.some(l => l.layerType === 'color-cycle');
      const useAutoFrames = gifAutoFrames && hasAnyCC;
      if (useAutoFrames) {
        totalFrames = autoFrameSuggestion.frames;
      }
    } catch {}

    // Prepare recolor animation (if any recolor-mode layers)
    const recolorManager = RecolorManager.getInstance();
    try { recolorManager.setFPS(effectiveFps); } catch {}

    // Attempt to ensure color-cycle layers are animating during export
    const originalStates: Array<{ layerId: string; wasPlaying: boolean; wasAnimating: boolean }> = [];
    try {
      const store = useAppStore.getState();
      for (const layer of store.layers) {
        if (layer.layerType === 'color-cycle' && layer.colorCycleData) {
          const brush = store.getLayerColorCycleBrush(layer.id);
          const wasPlaying = !!(brush && brush.isPlaying && brush.isPlaying());
          const wasAnimating = !!layer.colorCycleData.isAnimating;
          originalStates.push({ layerId: layer.id, wasPlaying, wasAnimating });
          // Ensure recolor-mode layers advance deterministically
          if (!wasAnimating) {
            store.updateLayer(layer.id, {
              colorCycleData: {
                ...layer.colorCycleData,
                isAnimating: true
              }
            });
          }
          // Sync brush FPS and pause internal RAF; we'll step it manually per captured frame
          try {
            if (brush) {
              brush.setFPS(effectiveFps);
            }
          } catch {}
          if (brush && brush.setPlaying) brush.setPlaying(false);
        }
      }
    } catch {}

    // First pass: capture frames and discover all colors used across the animation
    // This ensures we include every color actually used, no more, no less (<=256 limit)
    const frames: ImageData[] = [];
    const usedRGB = new Set<number>();
    let usesTransparency = false;
    const ALPHA_THRESHOLD = 16;

    for (let i = 0; i < totalFrames; i++) {
      if (cancelRef.current.cancelled) break;
      const store = useAppStore.getState();
      const useAbsolutePhase = gifAutoFrames; // Always drive by absolute phase when Perfect Loop is enabled
      const phase = useAbsolutePhase ? (i / totalFrames) : null;
      // Advance recolor-mode layers (absolute phase when perfect loop found)
      try {
        for (const layer of store.layers) {
          if (layer.layerType === 'color-cycle' && layer.colorCycleData?.mode === 'recolor') {
            if (useAbsolutePhase && phase !== null) {
              recolorManager.setPhase(layer, phase);
            } else {
              recolorManager.updateAnimation(layer);
            }
          }
        }
      } catch {}

      // Drive brush-mode CC layers (absolute phase when Perfect Loop is enabled)
      try {
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

      // Composite current frame
      compositeLayersToCanvas(base);
      // Scale draw
      sctx.imageSmoothingEnabled = true;
      sctx.imageSmoothingQuality = 'high';
      sctx.drawImage(base, 0, 0, scaledW, scaledH);

      const frame = sctx.getImageData(0, 0, scaledW, scaledH);
      frames.push(frame);

      // Accumulate unique RGB colors (ignore fully/mostly transparent)
      const data = frame.data;
      for (let p = 0; p < data.length; p += 4) {
        const a = data[p + 3];
        if (a <= ALPHA_THRESHOLD) { usesTransparency = true; continue; }
        const r = data[p];
        const g = data[p + 1];
        const b = data[p + 2];
        usedRGB.add((r << 16) | (g << 8) | b);
        // Early bail if clearly over the GIF limit (keep scanning for progress but don't rely on exact set size)
        if (usedRGB.size > 512) {
          // No need to track beyond this for performance; palette will be quantized later
          // but we still record frames for the second pass
          // Do nothing extra here
        }
      }

      setProgress(Math.round((((i + 1) / totalFrames) * 100) * 0.5)); // 0-50% during analysis pass
      // Step time – allow animations to advance roughly per frame
      await new Promise((r) => setTimeout(r, Math.max(0, Math.floor(1000 / effectiveFps))));
    }

    // Build the final palette
    let fixedPalette: number[][] = [];
    const needTransparentSlot = usesTransparency;
    const colorCountCandidate = usedRGB.size + (needTransparentSlot ? 1 : 0);
    const MAX_GIF_COLORS = 256;

    const buildSampleBuffer = (): Uint8Array => {
      // Build a sampling buffer across frames to feed into quantize()
      // Aim for up to ~500k samples to keep perf reasonable
      const targetSamples = 500_000;
      const totalPixels = frames.reduce((acc, f) => acc + (f.width * f.height), 0);
      const stride = Math.max(1, Math.floor(totalPixels / targetSamples));
      const totalRGBA = frames.reduce((acc, f) => acc + f.data.length, 0);
      const approxLen = Math.ceil(totalRGBA / stride);
      const sample = new Uint8Array(approxLen);
      let w = 0;
      for (let fi = 0; fi < frames.length; fi++) {
        const arr = frames[fi].data;
        for (let i = 0; i < arr.length; i += 4 * stride) {
          const a = arr[i + 3];
          if (a <= ALPHA_THRESHOLD) continue; // skip transparent when sampling
          if (w + 4 > sample.length) break;
          sample[w++] = arr[i];
          sample[w++] = arr[i + 1];
          sample[w++] = arr[i + 2];
          sample[w++] = a;
        }
      }
      if (w === 0) {
        // Fallback: sample from discovered unique colors (opaque)
        const count = Math.max(1, usedRGB.size);
        const fallback = new Uint8Array(count * 4);
        let o = 0;
        if (usedRGB.size > 0) {
          for (const rgb of usedRGB) {
            if (o + 4 > fallback.length) break;
            fallback[o++] = (rgb >> 16) & 255;
            fallback[o++] = (rgb >> 8) & 255;
            fallback[o++] = rgb & 255;
            fallback[o++] = 255;
          }
        } else {
          // Last resort: a single black opaque pixel
          fallback[0] = 0; fallback[1] = 0; fallback[2] = 0; fallback[3] = 255;
        }
        return fallback;
      }
      // Important: create a copy so underlying ArrayBuffer length equals w (multiple of 4)
      // Some libs create Uint32 views over buffer length; subarray's backing buffer may be misaligned.
      return sample.slice(0, w);
    };

    if (gifAutoColors) {
      if (colorCountCandidate <= MAX_GIF_COLORS) {
        // Exact palette: include every color used, plus transparent index if needed
        if (needTransparentSlot) fixedPalette.push([0, 0, 0, 0]);
        for (const rgb of usedRGB) {
          const r = (rgb >> 16) & 255;
          const g = (rgb >> 8) & 255;
          const b = rgb & 255;
          fixedPalette.push([r, g, b, 255]);
        }
        setGifPaletteCount(fixedPalette.length);
      } else {
        // Too many colors for GIF; quantize across all frames to 256
        const sample = buildSampleBuffer();
        const target = needTransparentSlot ? MAX_GIF_COLORS - 1 : MAX_GIF_COLORS;
        const q = quantize(sample, target, { format: 'rgb565' }) as number[][];
        const quantizedPalette = toRgbaEntries(q);
        fixedPalette = needTransparentSlot ? [[0, 0, 0, 0], ...quantizedPalette] : quantizedPalette;
        setGifPaletteCount(fixedPalette.length);
      }
    } else {
      // Manual size selected: quantize across all frames to requested size
      const sample = buildSampleBuffer();
      const target = needTransparentSlot ? gifMaxColors - 1 : gifMaxColors;
      const q = quantize(sample, target, { format: 'rgb565' }) as number[][];
      const quantizedPalette = toRgbaEntries(q);
      fixedPalette = needTransparentSlot ? [[0, 0, 0, 0], ...quantizedPalette] : quantizedPalette;
      // Force exact palette length to the user-selected size
      const desired = gifMaxColors;
      if (fixedPalette.length < desired) {
        const fill = fixedPalette.find((c) => c.length < 4 || c[3] !== 0) || [0, 0, 0, 255];
        while (fixedPalette.length < desired) {
          const f = fill.length === 3 ? [fill[0], fill[1], fill[2], 255] : fill.slice(0, 4);
          fixedPalette.push(f);
        }
      } else if (fixedPalette.length > desired) {
        fixedPalette = fixedPalette.slice(0, desired);
      }
      setGifPaletteCount(fixedPalette.length);
    }

    const transparentIndex = fixedPalette.findIndex((c) => (c.length >= 4 && c[3] === 0));

    // Second pass: map frames with the fixed palette and write to GIF
    for (let i = 0; i < frames.length; i++) {
      if (cancelRef.current.cancelled) break;
      const frame = frames[i];
      let index: Uint8Array;
      if (gifDitherMethod === 'none') {
        index = applyPalette(frame.data, toGifPalette(fixedPalette));
        // Ensure transparent pixels are mapped to transparent index explicitly
        if (transparentIndex >= 0) {
          const data = frame.data;
          for (let p = 0, px = 0; p < data.length; p += 4, px++) {
            if (data[p + 3] <= ALPHA_THRESHOLD) index[px] = transparentIndex;
          }
        }
      } else {
        index = mapToIndexedWithDithering(
          frame.data,
          scaledW,
          scaledH,
          fixedPalette,
          { method: gifDitherMethod, strength: gifDitherStrength, alphaThreshold: ALPHA_THRESHOLD }
        );
      }
      gif.writeFrame(index, scaledW, scaledH, { 
        palette: toGifPalette(fixedPalette), 
        delay: Math.round(1000 / effectiveFps), 
        repeat: gifRepeat,
        transparentIndex: transparentIndex >= 0 ? transparentIndex : undefined,
      });
      setProgress(50 + Math.round(((i + 1) / frames.length) * 50));
      await new Promise((r) => setTimeout(r, 0));
    }

    // Restore animation states
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
        // Restore brush FPS to configured setting
        try {
          const fps0 = store.tools?.brushSettings?.colorCycleFPS || 30;
          if (brush) {
            brush.setFPS(fps0);
          }
        } catch {}
        if (brush && brush.setPlaying) brush.setPlaying(st.wasPlaying);
      }
    } catch {}

    gif.finish();
    const bytes = gif.bytes();
    // Ensure BlobPart is ArrayBuffer-backed to satisfy TS DOM lib types
    const bytesCopy = new Uint8Array(bytes.length);
    bytesCopy.set(bytes);
    const blob = new Blob([bytesCopy], { type: 'image/gif' });
    downloadBlob(blob, `${filenameBase}@${scale}x.gif`);
  }

  async function exportWebGL() {
    if (!project) {
      throw new Error('No project available for export');
    }

    const layoutConfig = project.exportLayout ?? createDefaultExportLayout();
    const fps = Math.max(1, Math.floor(webglFps));

    const metadata = await exportProjectAsWebGL({
      project,
      layers,
      layout: layoutConfig,
      viewport: resolvedWebglViewport,
      fps,
      totalFrames: webglTotalFrames,
      durationSeconds: webglEffectiveDuration,
      perfectLoop: webglAutoFrames,
      includeHiddenLayers: webglIncludeHidden,
      embedCanvasFallback: webglEmbedFallback,
      minify: webglMinify,
      filenameBase,
      bundleFormat: webglBundleFormat,
      enableViewerDiagnostics: webglEnableDiagnostics,
      compositeLayersToCanvas
    });

    setProgress(100);
    addNotification({
      type: 'success',
      title: 'WebGL bundle saved',
      message: `Exported ${metadata.layers.length} layer${metadata.layers.length === 1 ? '' : 's'} to ${BUNDLE_FORMAT_LABELS[webglBundleFormat]}`,
      timestamp: new Date(),
      duration: 5000
    });
  }

  async function exportVideo() {
    // Prepare canvases
    const base = document.createElement('canvas');
    base.width = project?.width || 1;
    base.height = project?.height || 1;
    const scaled = document.createElement('canvas');
    scaled.width = Math.max(1, Math.floor(base.width * scale));
    scaled.height = Math.max(1, Math.floor(base.height * scale));
    const sctx = scaled.getContext('2d', { colorSpace: 'srgb' });
    if (!sctx) throw new Error('No canvas context for video export');

    // Choose a supported mime type
    const preferredTypes = [
      videoMime + ';codecs=avc1.42E01E', // mp4 (may fail in many browsers)
      videoMime,
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm'
    ];
    let mime: string | undefined;
    const mediaRecorderCtor = (window as typeof window & { MediaRecorder?: typeof MediaRecorder }).MediaRecorder;
    for (const t of preferredTypes) {
      if (mediaRecorderCtor && typeof mediaRecorderCtor.isTypeSupported === 'function' && mediaRecorderCtor.isTypeSupported(t)) {
        mime = t;
        break;
      }
    }
    if (!mime) mime = 'video/webm;codecs=vp8';

    const stream = typeof scaled.captureStream === 'function' ? scaled.captureStream(videoFps) : null;
    if (!stream) throw new Error('Canvas captureStream not supported');

    const chunks: BlobPart[] = [];
    const recorder = new MediaRecorder(stream, {
      mimeType: mime,
      videoBitsPerSecond: Math.max(1000, videoBitrate * 1000),
    } as MediaRecorderOptions);

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    const totalFrames = Math.max(1, Math.round(videoDuration * videoFps));
    cancelRef.current.cancelled = false;
    setProgress(0);

    // Try to ensure animations are running
    const originalStates: Array<{ layerId: string; wasPlaying: boolean; wasAnimating: boolean }> = [];
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
          // Sync brush FPS to video FPS during export
          try {
            if (brush) {
              brush.setFPS(videoFps);
            }
          } catch {}
          // Let MediaRecorder loop drive timing; pause internal RAF for determinism
          if (brush && brush.setPlaying) brush.setPlaying(false);
        }
      }
    } catch {}

    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      recorder.start();
      let frame = 0;
      const interval = Math.max(0, Math.floor(1000 / videoFps));
      const tick = async () => {
        if (cancelRef.current.cancelled || frame >= totalFrames) {
          recorder.stop();
          return;
        }
        // Advance recolor-mode layers one step
        try {
          const rm = RecolorManager.getInstance();
          const store = useAppStore.getState();
          for (const layer of store.layers) {
            if (layer.layerType === 'color-cycle' && layer.colorCycleData?.mode === 'recolor') {
              rm.updateAnimation(layer);
            }
          }
        } catch {}

        // Drive brush-mode CC layers exactly one step per captured frame
        try {
          const store = useAppStore.getState();
          for (const layer of store.layers) {
            if (layer.layerType === 'color-cycle' && layer.colorCycleData && layer.colorCycleData.mode !== 'recolor') {
              const brush = store.getLayerColorCycleBrush(layer.id);
              if (brush) {
                brush.updateAnimation();
              }
            }
          }
        } catch {}

        // Render current frame
        compositeLayersToCanvas(base);
        sctx.imageSmoothingEnabled = true;
        sctx.imageSmoothingQuality = 'high';
        sctx.drawImage(base, 0, 0, scaled.width, scaled.height);
        frame++;
        setProgress(Math.round((frame / totalFrames) * 100));
        setTimeout(tick, interval);
      };
      setTimeout(tick, 0);
    });

    // Restore animation states
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
        // Restore brush FPS to configured setting
        try {
          const fps0 = store.tools?.brushSettings?.colorCycleFPS || 30;
          if (brush) {
            brush.setFPS(fps0);
          }
        } catch {}
        if (brush && brush.setPlaying) brush.setPlaying(st.wasPlaying);
      }
    } catch {}

    const blob = new Blob(chunks, { type: recorder.mimeType });
    const ext = blob.type.includes('webm') ? 'webm' : 'mp4';
    downloadBlob(blob, `${filenameBase}@${scale}x.${ext}`);
  }

  const handleExport = async () => {
    if (!project) return;
    setIsExporting(true);
    cancelRef.current.cancelled = false;
    setProgress(0);
    try {
      if (exportKind === 'png') await exportPNG();
      else if (exportKind === 'gif') await exportGIF();
      else if (exportKind === 'webgl') await exportWebGL();
      else await exportVideo();
      onClose();
    } catch (e) {
      alert(`Export failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
    } finally {
      setIsExporting(false);
      setProgress(0);
      cancelRef.current.cancelled = false;
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
                    {kind === 'png' ? 'PNG' : kind === 'gif' ? 'GIF' : kind === 'mp4' ? 'Video' : 'WebGL'}
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
                  className="w-48"
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
                  className="w-48"
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
                id="export-container-layout"
                title="Container layout"
                summary={containerLayoutSummary}
                isOpen={containerLayoutOpen}
                onToggle={() => setContainerLayoutOpen((prev) => !prev)}
                contentClassName="space-y-4"
              >
                <ContainerLayoutControls
                  density="comfortable"
                  appearance="plain"
                  defaultExpanded
                  className="border-none p-0 bg-transparent space-y-4"
                />
              </CollapsibleSection>

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
                  {webglViewportPreset === 'custom' && (
                    <div className="mt-4 grid grid-cols-2 gap-3">
                    <label className="flex flex-col gap-2 text-sm text-[#B0B0B0]">
                        <span>Width</span>
                        <Input
                          type="number"
                          min={1}
                          value={webglCustomViewport.width}
                          onChange={(event) => handleCustomViewportChange('width', event.target.value)}
                          className={`${INPUT_OVERRIDE_CLASS} w-full text-right`}
                          disabled={isExporting}
                        />
                      </label>
                      <label className="flex flex-col gap-2 text-sm text-[#B0B0B0]">
                        <span>Height</span>
                        <Input
                          type="number"
                          min={1}
                          value={webglCustomViewport.height}
                          onChange={(event) => handleCustomViewportChange('height', event.target.value)}
                          className={`${INPUT_OVERRIDE_CLASS} w-full text-right`}
                          disabled={isExporting}
                        />
                      </label>
                    </div>
                  )}
                  <p className={`${MODAL_TEXT_SECONDARY} text-xs mt-3`}>
                    Using {resolvedWebglViewport.width} × {resolvedWebglViewport.height} px
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
                      onChange={(event) => updateWebglExportSettings({ enableViewerDiagnostics: event.target.checked })}
                      disabled={isExporting}
                    />
                  </label>
                </div>
                <p className={`${MODAL_TEXT_SECONDARY} text-xs`}>
                  Diagnostics helpers log viewer state to the console and expose `tinybrushViewerSetDiagnostics(true)` at runtime.
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
                    <option value="zip">Viewer zip (HTML + runtime + JSON)</option>
                    <option value="single-html">Single HTML (self-contained)</option>
                    <option value="json">Raw JSON only</option>
                  </select>
                  <p className={`${MODAL_TEXT_SECONDARY} text-xs`}>
                    {BUNDLE_FORMAT_DESCRIPTIONS[webglBundleFormat]}
                  </p>
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
              <Button variant="secondary" onClick={() => { cancelRef.current.cancelled = true; }}>
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
