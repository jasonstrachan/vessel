import type { Layer, WebGLExportBundleFormat, WebGLExportGobletVersion } from '@/types';
import type { GobletArtifact } from '@/utils/export/goblet/gobletArtifact';
import type {
  GobletSingleHtmlBreakdown,
  GobletSizeReport,
  WebGLExportLayerStatus,
  WebGLExportProgressPhase,
} from '@/utils/export/goblet/gobletTypes';

export type ExportKind = 'png' | 'gif' | 'mp4' | 'webgl';
export type RasterExportScale = 0.2 | 0.5 | 1 | 2 | 3 | 4;

export type ExportLayerProgressRow = {
  id: string;
  name: string;
  status: WebGLExportLayerStatus;
  message?: string;
  colorCycle?: {
    source?: string;
    payloadPixels?: number;
    nonZeroPaint?: number;
    usedSlots?: number;
    paletteSlots?: number;
    diagnostics?: string[];
  };
};

export type ExportProgressState = {
  isOpen: boolean;
  kind: ExportKind;
  phase: WebGLExportProgressPhase;
  percent: number;
  message: string;
  layers: ExportLayerProgressRow[];
  excludedHiddenLayerCount: number;
  issue?: {
    title: string;
    detailLines: string[];
    repairHint?: string;
  };
  error?: {
    message: string;
    stack?: string;
  };
  sizeReport?: GobletSizeReport;
  artifact?: GobletArtifact;
};

export const BUNDLE_FORMAT_LABELS: Record<WebGLExportBundleFormat, string> = {
  zip: 'smaller Goblet zip',
  'zip-compat': 'compatible Goblet zip',
  'single-html': 'single-file Goblet',
  json: 'Goblet JSON bundle',
};

export const GOBLET_VERSION_LABELS: Record<WebGLExportGobletVersion, string> = {
  goblet1: 'Goblet 1 (legacy)',
  goblet2: 'Goblet 2 (GPU-first)',
};

export const WEBGL_PROGRESS_PHASE_LABELS: Record<WebGLExportProgressPhase, string> = {
  blocked: 'Needs attention',
  preparing: 'Preparing',
  layers: 'Exporting layers',
  packaging: 'Packaging',
  complete: 'Complete',
  failed: 'Failed',
};

export const LAYER_PROGRESS_LABELS: Record<WebGLExportLayerStatus, string> = {
  waiting: 'Waiting',
  exporting: 'Exporting',
  'skipped-hidden': 'Skipped hidden',
  'skipped-empty': 'Skipped empty',
  'hydrating-cc-archive': 'Hydrating CC',
  'building-cc-payload': 'Building CC',
  'validating-cc-payload': 'Validating CC',
  'packing-cc-payload': 'Packing CC',
  exported: 'Exported',
  'static-preview': 'Static preview',
  done: 'Done',
  failed: 'Failed',
  skipped: 'Skipped',
};

export const SINGLE_HTML_BREAKDOWN_ROWS: Array<{
  key: keyof GobletSingleHtmlBreakdown;
  label: string;
}> = [
  { key: 'runtimeBytes', label: 'Runtime' },
  { key: 'ccBufferBytes', label: 'CC buffers' },
  { key: 'maskBytes', label: 'Masks' },
  { key: 'textureBytes', label: 'Textures' },
  { key: 'sequentialFrameBytes', label: 'Sequential frames' },
  { key: 'previewBytes', label: 'Preview' },
  { key: 'fallbackBytes', label: 'Fallback' },
  { key: 'otherBytes', label: 'Other' },
];

export const GIF_FPS_PRESETS = [12, 18, 24] as const;
export const VIDEO_BITRATE_MIN_KBPS = 1000;
export const VIDEO_BITRATE_MAX_KBPS = 20000;

export const WEBGL_VIEWPORT_PRESETS = [
  { value: 'default', label: 'Default' },
  { value: 'embed-fill', label: 'Embed fill' },
  { value: 'embed-fit', label: 'Embed fit' },
  { value: 'fixed', label: 'Fixed canvas' },
] as const;

export type WebglViewportPreset = typeof WEBGL_VIEWPORT_PRESETS[number]['value'];

export const WEBGL_EXPORT_FORMATS: Array<{
  value: WebGLExportBundleFormat;
  label: string;
}> = [
  { value: 'single-html', label: 'Single HTML' },
  { value: 'zip', label: 'Smaller ZIP' },
  { value: 'zip-compat', label: 'Compatible ZIP' },
  { value: 'json', label: 'JSON' },
];

export const WEBGL_DESIGN_SCALE_PRESETS = [50, 100, 200, 300, 400] as const;

export const formatExactBytes = (bytes: number): string => `${bytes.toLocaleString('en-US')} B`;

export const clampWebglDesignScalePercent = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 100;
  }
  return Math.max(25, Math.min(800, Math.round(value)));
};

export const normalizeWebglHtmlBackgroundColor = (value: string): string => {
  const trimmed = value.trim();
  if (/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  return '#000000';
};

export const clampVideoBitrate = (value: number): number => (
  Math.max(VIDEO_BITRATE_MIN_KBPS, Math.min(VIDEO_BITRATE_MAX_KBPS, Math.round(value)))
);

export const bitrateToCompressionPercent = (bitrateKbps: number): number => {
  const normalized = (clampVideoBitrate(bitrateKbps) - VIDEO_BITRATE_MIN_KBPS)
    / (VIDEO_BITRATE_MAX_KBPS - VIDEO_BITRATE_MIN_KBPS);
  return Math.round((1 - normalized) * 100);
};

export const compressionPercentToBitrate = (compressionPercent: number): number => {
  const clamped = Math.max(0, Math.min(100, compressionPercent));
  const normalized = 1 - (clamped / 100);
  return clampVideoBitrate(
    VIDEO_BITRATE_MIN_KBPS + normalized * (VIDEO_BITRATE_MAX_KBPS - VIDEO_BITRATE_MIN_KBPS),
  );
};

export const hasSequentialExportLayers = (layers: Layer[] | undefined): boolean =>
  Array.isArray(layers)
  && layers.some((layer) => layer.layerType === 'sequential' && !!layer.sequentialData);

export interface LoopFrameSuggestion {
  frames: number;
  success: boolean;
  duration: number;
}

export const computeBestLoopSuggestion = ({
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
  const recolorSpeeds = layers
    .filter((layer) => layer.layerType === 'color-cycle'
      && layer.colorCycleData?.mode === 'recolor'
      && layer.colorCycleData?.recolorSettings)
    .map((layer) => layer.colorCycleData!.recolorSettings!.animation.speed || 0.1)
    .filter((speed) => Number.isFinite(speed) && speed > 0);
  const brushSpeeds = layers
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
    const isExact = speeds.every((speed) => {
      const cycles = (speed * frameCount) / safeFps;
      return Math.abs(cycles - Math.round(cycles)) < epsilon;
    });
    if (isExact) {
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
      maxResidual = Math.max(maxResidual, Math.abs(cycles - Math.round(cycles)));
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

export const getParticipatingExportLayers = (
  layers: Layer[],
  includeHiddenLayers: boolean,
): Layer[] => layers.filter((layer) => includeHiddenLayers || layer.visible !== false);

export const countExcludedHiddenLayers = (
  layers: Layer[],
  includeHiddenLayers: boolean,
): number => includeHiddenLayers
  ? 0
  : layers.filter((layer) => layer.visible === false).length;

export const buildInitialExportLayerRows = (
  layers: Layer[],
  includeHiddenLayers: boolean,
): ExportLayerProgressRow[] => getParticipatingExportLayers(layers, includeHiddenLayers)
  .map((layer) => ({
    id: layer.id,
    name: layer.name || layer.id,
    status: 'waiting',
  }));

export const upsertExportLayerRow = (
  rows: ExportLayerProgressRow[],
  next: ExportLayerProgressRow,
): ExportLayerProgressRow[] => {
  const index = rows.findIndex((row) => row.id === next.id);
  if (index < 0) {
    return [...rows, next];
  }
  return rows.map((row, rowIndex) => (
    rowIndex === index ? { ...row, ...next } : row
  ));
};

export const getGobletExportIssueRows = (
  layers: Layer[],
  includeHiddenLayers: boolean,
): ExportLayerProgressRow[] => getParticipatingExportLayers(layers, includeHiddenLayers)
  .filter((layer) => layer.layerType === 'color-cycle'
    && layer.colorCycleData?.repairStatus?.ok === false)
  .map((layer) => ({
    id: layer.id,
    name: layer.name || layer.id,
    status: 'static-preview',
    message: layer.colorCycleData?.repairStatus?.reason ?? 'Missing canonical color-cycle paint',
  }));
