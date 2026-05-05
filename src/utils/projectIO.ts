// Project input/output utilities for Vessel
// Handles serialization, deserialization, and file operations

import { debugLog, debugWarn, logError } from '@/utils/debug';
import type {
  Project,
  Layer,
  LayerGroup,
  SequentialLayerData,
  SequentialStrokeEvent,
  CustomBrush,
  BrushSettings,
  LayerAlignmentSettings,
  ExportContainerLayout,
  PaletteState
} from '@/types';
import JSZip from 'jszip';
import { gunzipSync } from 'fflate';
import { cloneExportLayout, cloneLayerAlignment, normalizePalette } from '@/utils/layoutDefaults';
import { applyCanvasShapeMask, normalizeCanvasShape } from '@/utils/canvasShape';
import { captureCanvasImageData } from '@/utils/canvas/canvasImage';
import { flushGradientApply, requestGradientApply } from '@/hooks/brushEngine/ccGradientApplyScheduler';
import {
  deserializeCustomBrushColorCycle,
  serializeCustomBrushColorCycle,
  type SerializedCustomBrushColorCycle,
} from '@/utils/customBrushColorCycle';
import { cloneDisplayFilters, sanitizeDisplayFilters } from '@/lib/displayFilters';
import {
  decodeSequentialChunksToEvents,
  encodeSequentialEventsToChunks,
  type SerializedSequentialStrokeChunkV1,
} from '@/lib/sequential/SequentialStrokeChunk';
import { resolveLayerColorCycleBaseSpeed } from '@/utils/colorCycleLayerSpeed';
import { createDevDebugOverlayLogger } from '@/utils/dev/debugOverlayStore';
import {
  materializeRestoredColorCycleSurface,
  type ColorCycleRuntimeBrush,
} from '@/lib/colorCycle/materializeColorCycleLayer';
import {
  normalizeColorCycleLayerDocumentState,
} from '@/lib/colorCycle/documentState';
import {
  captureColorCyclePersistenceSnapshot,
  type ColorCyclePersistenceDocumentState,
  type DeferredColorCycleArchiveRuntime,
  type PersistedColorCycleBrushState as PersistenceBrushState,
} from '@/lib/colorCycle/persistence';
import {
  logCCMutation,
  summarizeColorCycleLayer,
  summarizeSerializedColorCycleLayer,
} from '@/utils/colorCycle/ccMutationAudit';
import {
  ccPayloadHasNonZeroByte,
  hasRecoverableColorCycleRuntimeSource,
} from '@/utils/colorCycle/resolveColorCycleRuntimeRestore';
import { repairLegacyColorCycleLayer, type ColorCycleLegacyRepairResult } from '@/lib/colorCycle/legacyRepair';
import {
  PROJECT_ARCHIVE_MANIFEST_VERSION,
  collectArchiveBinaryRefs,
  fnv1aHash,
  inferBinaryManifestDType,
  isArchiveBinaryRef as isPersistedArchiveBinaryRef,
  normalizePersistedLayerType,
  validateStrictColorCyclePersistedSurface,
  type BinaryManifestEntry,
  type PersistedProjectBinaryManifest,
  type VesselProjectArchive,
} from '@/utils/projectPersistence';
import {
  migrateLegacyProjectLayers,
  type ProjectLegacyMigrationSummary,
} from '@/utils/projectLegacyMigration';
import { getColorCycleHydrationState, setColorCycleHydrationState } from '@/stores/layerHydration';
import {
  LEGACY_PROJECT_FILE_EXTENSION,
  LEGACY_PROJECT_FILE_MIME,
  PROJECT_FILE_ACCEPT,
  PROJECT_FILE_EXTENSION,
  PROJECT_FILE_MIME,
  PROJECT_FILE_MIME_ACCEPT
} from '@/constants/projectFiles';
// Vessel project file format version
const PROJECT_VERSION = '1.1.0';
const MAX_PROJECT_ARCHIVE_BYTES = 512 * 1024 * 1024;
const MAX_PROJECT_DIMENSION = 16384;
const MAX_PROJECT_PIXELS = 64 * 1024 * 1024;
const MAX_PROJECT_LAYERS = 512;
const MAX_PROJECT_CUSTOM_BRUSHES = 512;

const LEGACY_FLOW_SLOT_MASK = 63;
const LEGACY_EDITOR_SLOT = 63;
const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder();
const ccWarmRestoreDebug = createDevDebugOverlayLogger('cc-warm-restore');

const describeBufferForDebug = (buffer: unknown): { bytes: number; nonZeroSample: number } | null => {
  if (!(buffer instanceof ArrayBuffer)) {
    return null;
  }
  const bytes = new Uint8Array(buffer);
  const sampleLength = Math.min(bytes.length, 64);
  let nonZeroSample = 0;
  for (let i = 0; i < sampleLength; i += 1) {
    if (bytes[i] !== 0) {
      nonZeroSample += 1;
    }
  }
  return { bytes: buffer.byteLength, nonZeroSample };
};

const parseVersionTuple = (version: string): [number, number, number] | null => {
  const parts = version.split('.').map((part) => Number(part));
  if (parts.length < 1) {
    return null;
  }
  const [major = 0, minor = 0, patch = 0] = parts;
  if (![major, minor, patch].every((value) => Number.isFinite(value))) {
    return null;
  }
  return [major, minor, patch];
};

const isVersionLessThan = (version: string, target: [number, number, number]): boolean => {
  const parsed = parseVersionTuple(version);
  if (!parsed) {
    return true;
  }
  for (let i = 0; i < target.length; i += 1) {
    if (parsed[i] < target[i]) return true;
    if (parsed[i] > target[i]) return false;
  }
  return false;
};

const normalizeLegacySlot = (slot: number): number => {
  const raw = slot & LEGACY_FLOW_SLOT_MASK;
  return raw === LEGACY_EDITOR_SLOT ? 0 : raw;
};

const migrateLegacyColorCycleEncoding = (layers: Layer[], version: string) => {
  if (!isVersionLessThan(version, [1, 1, 0])) {
    return;
  }
  for (const layer of layers) {
    if (layer.layerType !== 'color-cycle' || !layer.colorCycleData) {
      continue;
    }
    const data = layer.colorCycleData;
    let hadEditorSlot = false;

    if (data.gradientIdBuffer) {
      const view = new Uint8Array(data.gradientIdBuffer);
      for (let i = 0; i < view.length; i += 1) {
        let raw = view[i] & LEGACY_FLOW_SLOT_MASK;
        if (raw === LEGACY_EDITOR_SLOT) {
          raw = 0;
          hadEditorSlot = true;
        }
        view[i] = raw;
      }
    }

    const remapSlot = (value?: number) => {
      if (typeof value !== 'number') {
        return value;
      }
      const remapped = normalizeLegacySlot(value);
      if (remapped !== value && value === LEGACY_EDITOR_SLOT) {
        hadEditorSlot = true;
      }
      return remapped;
    };

    if (data.gradientDefs) {
      data.gradientDefs = data.gradientDefs.map((entry) => ({
        ...entry,
        currentSlot: normalizeLegacySlot(entry.currentSlot),
      }));
    }
    if (data.slotPalettes) {
      data.slotPalettes = data.slotPalettes.map((entry) => ({
        ...entry,
        slot: normalizeLegacySlot(entry.slot),
      }));
    }
    if (data.gradientDefStore) {
      data.gradientDefStore = data.gradientDefStore.map((entry) => ({
        ...entry,
        slot: typeof entry.slot === 'number' ? normalizeLegacySlot(entry.slot) : entry.slot,
      }));
    }
    if (data.fgDerivedGradients) {
      data.fgDerivedGradients = data.fgDerivedGradients.map((entry) => ({
        ...entry,
        slot: normalizeLegacySlot(entry.slot),
      }));
    }
    if (data.derivedGradients) {
      data.derivedGradients = data.derivedGradients.map((entry) => ({
        ...entry,
        slot: normalizeLegacySlot(entry.slot),
      }));
    }

    data.paintSlot = remapSlot(data.paintSlot);
    data.fgActiveSlot = remapSlot(data.fgActiveSlot);
    data.legacyRemap = undefined;

    if (hadEditorSlot) {
      debugWarn('raw-console', '[projectIO] Legacy editor slot remapped during load', {
        layerId: layer.id,
      });
    }
  }
};

const toFiniteNumber = (value: unknown, fallback: number): number => {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
};

const sanitizeSequentialLayerData = (
  data: SerializedSequentialLayerData | SequentialLayerData | undefined
): SequentialLayerData => {
  const frameCount = Math.max(1, Math.round(toFiniteNumber(data?.frameCount, 12)));
  const fps = Math.max(1, Math.round(toFiniteNumber(data?.fps, 12)));
  const durationMs = Math.max(1, Math.round(toFiniteNumber(data?.durationMs, Math.round((frameCount * 1000) / fps))));
  let events = Array.isArray(data?.events) ? data.events : [];
  const serializedChunkData =
    data && typeof data === 'object' && 'chunks' in data
      ? (data as SerializedSequentialLayerData)
      : null;
  if (events.length === 0 && Array.isArray(serializedChunkData?.chunks) && serializedChunkData.chunks.length > 0) {
    try {
      events = decodeSequentialChunksToEvents({
        chunks: serializedChunkData.chunks,
        brushSnapshots: serializedChunkData.brushSnapshots,
      });
    } catch (error) {
      debugWarn('raw-console', '[projectIO] Failed to decode sequential chunks, falling back to empty events:', error);
      events = [];
    }
  }

  return {
    frameCount,
    fps,
    durationMs,
    events,
  };
};

export type ProjectFileData = string | ArrayBuffer | Uint8Array | Blob;

export type ColorCycleDiagnosticStatus =
  | 'canonical-valid'
  | 'repaired-on-import'
  | 'static-preview-only'
  | 'repair-failed';

export type ColorCycleRepairWarning = {
  layerId: string;
  layerName: string;
  status: ColorCycleDiagnosticStatus;
  diagnostics: ColorCycleDiagnosticStatus[];
  reason?: NonNullable<NonNullable<Layer['colorCycleData']>['repairStatus']>['reason'];
  notes: string[];
};

export interface DeserializedProjectResult {
  project: Project;
  migration: ProjectLegacyMigrationSummary;
  colorCycleRepairWarnings?: ColorCycleRepairWarning[];
}

const PROJECT_ARCHIVE_ENTRY = 'project.json';
const PROJECT_PREVIEW_ARCHIVE_ENTRY = 'manifest.json';
const DEFAULT_PROJECT_THUMBNAIL_SIZE = 1024;
const DEFAULT_PROJECT_PREVIEW_THUMBNAIL_SIZE = 256;
const ARCHIVE_BINARY_REF_PREFIX = 'zip:';

function isZipBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 4) {
    return false;
  }
  return bytes[0] === 0x50 && bytes[1] === 0x4b;
}

function isGzipBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 2) {
    return false;
  }
  return bytes[0] === 0x1f && bytes[1] === 0x8b;
}

function binaryStringToUint8Array(payload: string): Uint8Array {
  const bytes = new Uint8Array(payload.length);
  for (let i = 0; i < payload.length; i += 1) {
    bytes[i] = payload.charCodeAt(i) & 0xff;
  }
  return bytes;
}

async function decodeProjectData(input: ProjectFileData): Promise<string> {
  if (typeof input === 'string') {
    return input;
  }

  let bytes: Uint8Array;

  if (typeof ArrayBuffer !== 'undefined' && input instanceof ArrayBuffer) {
    bytes = new Uint8Array(input);
  } else if (typeof Uint8Array !== 'undefined' && input instanceof Uint8Array) {
    bytes = input;
  } else if (typeof Blob !== 'undefined' && input instanceof Blob) {
    const buffer = await input.arrayBuffer();
    bytes = new Uint8Array(buffer);
  } else {
    throw new Error('Unsupported project data input');
  }

  if (bytes.byteLength > MAX_PROJECT_ARCHIVE_BYTES) {
    throw new Error('Project file is too large to open safely');
  }

  if (isZipBytes(bytes)) {
    const zip = await JSZip.loadAsync(bytes);
    const primaryEntry = zip.file(PROJECT_ARCHIVE_ENTRY);
    let entry = Array.isArray(primaryEntry) ? primaryEntry[0] ?? null : primaryEntry;

    if (!entry) {
      const fallbackEntries = zip.file(/\.json$/);
      if (Array.isArray(fallbackEntries)) {
        entry = fallbackEntries.find(candidate => candidate.name === PROJECT_ARCHIVE_ENTRY) ?? fallbackEntries[0] ?? null;
      } else {
        entry = fallbackEntries;
      }
    }

    if (!entry) {
      throw new Error('Project archive is missing project.json');
    }

    const manifestBytes = await entry.async('uint8array');
    return new TextDecoder().decode(manifestBytes);
  }

  if (isGzipBytes(bytes)) {
    const decompressed = gunzipSync(bytes);
    return new TextDecoder().decode(decompressed);
  }

  return new TextDecoder().decode(bytes);
}

function ensureProjectFilename(name: string): string {
  const normalized = name.trim();
  if (!normalized) {
    return `untitled${PROJECT_FILE_EXTENSION}`;
  }

  const lower = normalized.toLowerCase();
  if (
    lower.endsWith(PROJECT_FILE_EXTENSION) ||
    lower.endsWith(LEGACY_PROJECT_FILE_EXTENSION)
  ) {
    return normalized;
  }

  return `${normalized}${PROJECT_FILE_EXTENSION}`;
}

export interface VesselProject {
  version: string;
  manifestVersion?: number;
  metadata: {
    name: string;
    created: string;
    modified: string;
    appVersion: string;
  };
  project: {
    id: string;
    name: string;
    width: number;
    height: number;
    backgroundColor: string;
    layers: SerializedLayer[];
    layerGroups?: LayerGroup[];
    customBrushes: SerializedCustomBrush[];
    defaultCustomBrushId?: string | null;
    thumbnail?: string;
    brushSpecificSettings?: Record<string, unknown>;
    globalBrushSize?: number;
    referenceLayerId?: string | null;
    exportLayout?: ExportContainerLayout;
    palette?: PaletteState;
    canvasShape?: Project['canvasShape'];
    viewState?: Project['viewState'];
  };
  binaries?: {
    entries: BinaryManifestEntry[];
  };
}

export interface VesselProjectPreview {
  version: string;
  manifestVersion?: number;
  metadata: {
    name: string;
    created: string;
    modified: string;
    appVersion: string;
  };
  project: {
    id: string;
    name: string;
    width: number;
    height: number;
    thumbnail?: string;
  };
  preview?: {
    dataUrl: string;
    width: number;
    height: number;
    encoding: string;
  };
}

export interface ProjectSizeReportSection {
  name: string;
  bytes: number;
}

export interface ProjectSizeReportLayer {
  layerId: string;
  layerName: string;
  layerType: 'normal' | 'color-cycle' | 'sequential' | 'unknown';
  bytes: number;
  dominantSection: string;
  dominantSectionBytes: number;
}

export interface ProjectSaveSizeReport {
  projectManifestBytes: number;
  previewManifestBytes: number;
  combinedManifestBytes: number;
  archiveBytes: number;
  compressionRatio: number;
  binaryPayloadBytes: number;
  colorCycleDuplicationRiskLayers: string[];
  unresolvedColorCycleDefLayers: string[];
  staticPreviewColorCycleLayers?: string[];
  sectionBreakdown: ProjectSizeReportSection[];
  largestLayers: ProjectSizeReportLayer[];
  recommendations: string[];
}

export interface ProjectHealthReport extends ProjectSaveSizeReport {
  warnings: string[];
  primaryWarning: string | null;
}

export type ProjectArchiveRefKind =
  | 'canonical-color-cycle'
  | 'optional-color-cycle'
  | 'raster'
  | 'sequential'
  | 'unknown';

export interface ProjectArchiveRefIssue {
  path: string;
  kind: ProjectArchiveRefKind;
  layerId?: string;
  layerName?: string;
  layerType?: string;
  locations: string[];
  missingManifestEntry: boolean;
  missingArchivePayload: boolean;
}

export interface ProjectArchiveRefAnalysis {
  issues: ProjectArchiveRefIssue[];
  missingCanonicalColorCycleRefs: ProjectArchiveRefIssue[];
  missingOptionalColorCycleRefs: ProjectArchiveRefIssue[];
  canRepairDanglingColorCycleRefs: boolean;
}

export interface ProjectArchiveRepairReport {
  repairedAt: string;
  repairedLayerIds: string[];
  removedRefs: Array<{
    layerId: string;
    layerName?: string;
    path: string;
    locations: string[];
    kind: ProjectArchiveRefKind;
  }>;
  warning: string;
}

export interface ProjectArchiveRepairResult {
  archiveData: Uint8Array;
  report: ProjectArchiveRepairReport;
}

type ArchiveBinaryEntry = {
  path: string;
  bytes: Uint8Array;
  data?: string | Uint8Array;
  width?: number;
  height?: number;
  logicalByteLength?: number;
  encoding?: BinaryManifestEntry['encoding'];
  crop?: BinaryManifestEntry['crop'];
};

type ArchiveBinaryManifestIndex = Map<string, BinaryManifestEntry>;

type SerializedRasterLayerStateV1 = {
  version: 1;
  dimensions: {
    width: number;
    height: number;
  };
  imageRef: string;
};

type SerializedSequentialLayerStateV1 = {
  version: 1;
  frameCount: number;
  fps: number;
  durationMs: number;
  encoding: 'chunked-events-v1';
  chunksRef: string;
  brushSnapshotsRef?: string;
};

type SerializedColorCycleLayerStateV1 = {
  version: 1;
  dimensions: {
    width: number;
    height: number;
  };
  mode?: 'brush' | 'recolor';
  gradientDefs?: SerializedColorCycleLayerData['gradientDefs'];
  slotPalettes?: SerializedColorCycleLayerData['slotPalettes'];
  gradientDefStore?: SerializedColorCycleLayerData['gradientDefStore'];
  nextGradientDefId?: number;
  fgActiveSlot?: number;
  activeGradientId?: string;
  paintSlot?: number;
  layerBaseSpeedCps?: number;
  brushSpeed?: number;
  controllerSpeedCps?: number;
  flowMode?: 'forward' | 'reverse' | 'pingpong';
  paintRef?: string;
  gradientIdRef?: string;
  gradientDefIdRef?: string;
  speedRef?: string;
  flowRef?: string;
  phaseRef?: string;
  hasContent?: boolean;
  strokeCounter?: number;
  dither?: {
    enabled?: boolean;
    strength?: number;
    pixelSize?: number;
    perceptual?: boolean;
    stampShape?: PersistedColorCycleBrushState['stampShape'];
    stampDitherEnabled?: boolean;
    stampDitherPixelSize?: number;
    stampDitherAlgorithm?: BrushSettings['ditherAlgorithm'];
    stampDitherPatternStyle?: BrushSettings['patternStyle'];
    stampDitherBgFill?: boolean;
    stampDitherClears?: boolean;
    stampDitherPressureLinked?: boolean;
    pxlEdgeEnabled?: boolean;
  };
};

type SerializedLayerState =
  | SerializedRasterLayerStateV1
  | SerializedSequentialLayerStateV1
  | SerializedColorCycleLayerStateV1;

type SerializedColorCycleStateSource = {
  mode?: SerializedColorCycleLayerStateV1['mode'];
  gradientDefs?: SerializedColorCycleLayerStateV1['gradientDefs'];
  slotPalettes?: SerializedColorCycleLayerStateV1['slotPalettes'];
  gradientDefStore?: SerializedColorCycleLayerStateV1['gradientDefStore'];
  nextGradientDefId?: SerializedColorCycleLayerStateV1['nextGradientDefId'];
  fgActiveSlot?: SerializedColorCycleLayerStateV1['fgActiveSlot'];
  activeGradientId?: SerializedColorCycleLayerStateV1['activeGradientId'];
  layerBaseSpeedCps?: SerializedColorCycleLayerStateV1['layerBaseSpeedCps'];
  brushSpeed?: SerializedColorCycleLayerStateV1['brushSpeed'];
  controllerSpeedCps?: SerializedColorCycleLayerStateV1['controllerSpeedCps'];
  flowMode?: SerializedColorCycleLayerStateV1['flowMode'];
  paintRef?: string;
  gradientIdRef?: string;
  gradientDefIdRef?: string;
  currentLayerSnapshot?: PersistedColorCycleBrushState['layers'][number];
  dither?: SerializedColorCycleLayerStateV1['dither'];
};

const COLOR_CYCLE_STATE_SOURCE = Symbol('colorCycleStateSource');

interface SerializedLayer {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  blendMode: string;
  locked: boolean;
  transparencyLocked?: boolean;
  order: number;
  imageDataUrl: string; // Base64 encoded ImageData
  layerType?: 'normal' | 'color-cycle' | 'colorCycle' | 'sequential';
  alignment?: LayerAlignmentSettings;
  groupId?: string;
  state?: SerializedLayerState;
  colorCycleData?: SerializedColorCycleLayerData;
  sequentialData?: SerializedSequentialLayerData;
  [COLOR_CYCLE_STATE_SOURCE]?: SerializedColorCycleStateSource;
}

type SerializedSequentialLayerData = {
  frameCount: number;
  fps: number;
  durationMs: number;
  events?: SequentialLayerData['events'] | null;
  chunks?: SerializedSequentialStrokeChunkV1[];
  brushSnapshots?: Record<string, SequentialStrokeEvent['brush']>;
};

type SerializedColorMapEntry = [number, number];

interface SerializedAnimatorSnapshot {
  indexBuffer: {
    width: number;
    height: number;
    data?: string; // base64 encoded Uint8Array
    gradientId?: string; // base64 encoded Uint8Array
    speedData?: string; // base64 encoded Uint8Array
    flowData?: string; // base64 encoded Uint8Array
    phaseData?: string; // base64 encoded Uint8Array
    palette: string[];
  };
  gradient: {
    gradientStops: Array<{ position: number; color: string }>;
    paletteSize?: number;
  };
  animation: {
    offset: number;
    stats: {
      targetFPS: number;
      actualFPS: number;
      frameCount: number;
      totalTime: number;
      averageFrameTime: number;
      isAnimating: boolean;
    };
  };
}

interface SerializedStrokeSnapshot {
  paintBuffer?: string; // base64 encoded ArrayBuffer
  gradientIdBuffer?: string; // base64 encoded ArrayBuffer
  gradientDefIdBuffer?: string; // base64 encoded ArrayBuffer (Uint16)
  speedBuffer?: string; // base64 encoded ArrayBuffer
  flowBuffer?: string; // base64 encoded ArrayBuffer
  phaseBuffer?: string; // base64 encoded ArrayBuffer
  hasContent?: boolean;
  strokeCounter?: number;
}

interface SerializedBrushLayerSnapshot {
  layerId: string;
  canonicalPaint?: boolean;
  schemaVersion?: number;
  dimensions?: { width: number; height: number };
  capturedAtStrokeCounter?: number;
  strokeData?: SerializedStrokeSnapshot;
  animator?: SerializedAnimatorSnapshot;
  gradientDefs?: Array<{ id: string; name?: string; currentSlot: number }>;
  slotPalettes?: Array<{ slot: number; stops: Array<{ position: number; color: string }> }>;
  gradientDefStore?: Array<{
    id: number;
    kind: 'linear' | 'concentric';
    stops: Array<{ position: number; color: string }>;
    hash: string;
    source: 'manual' | 'fg' | 'sampled';
    seamProfile?: 'hard' | 'soft';
    createdAtMs: number;
    slot?: number;
    speedCps?: number;
  }>;
  nextGradientDefId?: number;
  paintSlot?: number;
  legacyRemap?: { from: number; to: number };
  fgActiveSlot?: number;
  fgDerivedKey?: string;
  fgDerivedGradients?: Array<{
    key: string;
    slot: number;
    spec: {
      mode: 'fg-derived';
      baseColor: string;
      lightness: number;
      variance: number;
      hueShift?: number;
      saturationShift?: number;
      opacity?: number;
      bands: number;
      algoVersion: number;
      key: string;
    };
  }>;
  derivedGradients?: Array<{
    key: string;
    slot: number;
    spec: {
      mode: 'fg-derived';
      baseColor: string;
      lightness: number;
      variance: number;
      hueShift?: number;
      saturationShift?: number;
      opacity?: number;
      bands: number;
      algoVersion: number;
      key: string;
    };
  }>;
  activeGradientId?: string;
}

interface PersistedColorCycleBrushState {
  canonicalPaint?: boolean;
  schemaVersion?: number;
  dimensionsByLayerId?: Record<string, { width: number; height: number }>;
  cycleSpeed?: number;
  fps?: number;
  brushSize?: number;
  ditherEnabled?: boolean;
  ditherStrength?: number;
  ditherPixelSize?: number;
  perceptualDither?: boolean;
  stampShape?: 'square' | 'round' | 'triangle' | 'diamond' | 'diamond5' | 'diamond7' | 'diamond9' | 'checkered';
  stampDitherEnabled?: boolean;
  stampDitherPixelSize?: number;
  stampDitherAlgorithm?: BrushSettings['ditherAlgorithm'];
  stampDitherPatternStyle?: BrushSettings['patternStyle'];
  stampDitherBgFill?: boolean;
  stampDitherClears?: boolean;
  stampDitherPressureLinked?: boolean;
  pxlEdgeEnabled?: boolean;
  layers: SerializedBrushLayerSnapshot[];
}

interface SerializedColorCycleRecolorSettings {
  quantizationMode: 'rgb332' | 'oklab-median-cut';
  ditherMode: 'off' | 'bayer4' | 'bayer8';
  animation: {
    speed: number;
    fps: number;
    ticksPerFrame: number;
    isPlaying: boolean;
    currentTick: number;
    flowDirection: 'forward' | 'reverse' | 'pingpong' | 'bounce';
  };
  cycleColors: number;
  gradient: Array<{ position: number; color: string }>;
  mappingMode?: 'banded' | 'continuous';
  flowMapping?: 'palette' | 'directional' | 'luminance';
  directionAngle?: number;
  bandWidthPx?: number;
  currentLOD?: 'full' | 'half' | 'quarter';
  indexBuffer?: string; // base64 encoded Uint8Array
  palette?: number[];
  indexPhaseMap?: string; // base64 encoded Uint8Array
  phaseMap?: string; // base64 encoded Uint8Array
  colorMap?: SerializedColorMapEntry[];
  originalImageData?: string; // Same raw JSON data URL format as layer imageData
}

interface SerializedColorCycleLayerData {
  gradient?: Array<{ position: number; color: string }>;
  gradientDefs?: Array<{ id: string; name?: string; currentSlot: number }>;
  slotPalettes?: Array<{ slot: number; stops: Array<{ position: number; color: string }> }>;
  gradientDefStore?: Array<{
    id: number;
    kind: 'linear' | 'concentric';
    stops: Array<{ position: number; color: string }>;
    hash: string;
    source: 'manual' | 'fg' | 'sampled';
    seamProfile?: 'hard' | 'soft';
    createdAtMs: number;
    slot?: number;
    speedCps?: number;
  }>;
  nextGradientDefId?: number;
  fgActiveSlot?: number;
  fgDerivedKey?: string;
  fgDerivedGradients?: Array<{
    key: string;
    slot: number;
    spec: {
      mode: 'fg-derived';
      baseColor: string;
      lightness: number;
      variance: number;
      hueShift?: number;
      saturationShift?: number;
      opacity?: number;
      bands: number;
      algoVersion: number;
      key: string;
    };
  }>;
  derivedGradients?: Array<{
    key: string;
    slot: number;
    spec: {
      mode: 'fg-derived';
      baseColor: string;
      lightness: number;
      variance: number;
      bands: number;
      algoVersion: number;
      key: string;
    };
  }>;
  activeGradientId?: string;
  gradientIdBuffer?: string;
  gradientDefIdBuffer?: string;
  isAnimating?: boolean;
  mode?: 'brush' | 'recolor';
  layerBaseSpeedCps?: number;
  brushSpeed?: number;
  controllerSpeedCps?: number;
  flowMode?: 'forward' | 'reverse' | 'pingpong';
  recolorSettings?: SerializedColorCycleRecolorSettings;
  brushState?: PersistedColorCycleBrushState;
  canvasImageData?: string;
  canvasWidth?: number;
  canvasHeight?: number;
  eraseMaskImageData?: string;
  eraseMaskVersion?: number;
  softEdgeMaskImageData?: string;
  softEdgeMaskEnabled?: boolean;
  softEdgeMaskVersion?: number;
  repairStatus?: NonNullable<NonNullable<Layer['colorCycleData']>['repairStatus']>;
  // Legacy fallback data retained for backward compatibility
  webGLState?: {
    gradients: Array<{ gradientStops: Array<{ position: number; color: string }> }>;
    animationState: { cycleOffset: number; speed: number; fps: number; isPaused: boolean };
    layerSnapshots: Array<{ layerId: string; data: string }>; // Base64 encoded ArrayBuffer
  };
}

interface SerializedCustomBrush {
  id: string;
  name: string;
  width: number;
  height: number;
  imageDataUrl: string; // Base64 encoded ImageData
  thumbnail: string;
  createdAt: number;
  naturalWidth?: number;
  naturalHeight?: number;
  maxDimension?: number;
  colorCycle?: SerializedCustomBrushColorCycle;
}

interface ColorCycleBrushState {
  layers?: Array<{
    layerId: string;
    data: {
      indexBuffer: {
        width: number;
        height: number;
        data: Uint8Array;
        gradientId?: Uint8Array;
        speedData?: Uint8Array;
        flowData?: Uint8Array;
        phaseData?: Uint8Array;
        palette: string[];
      };
      gradient: {
        gradientStops: Array<{ position: number; color: string }>;
        paletteSize?: number;
      };
      animation: {
        offset: number;
        stats: {
          targetFPS: number;
          actualFPS: number;
          frameCount: number;
          totalTime: number;
          averageFrameTime: number;
          isAnimating: boolean;
        };
      };
    };
    strokeData?: {
      hasContent?: boolean;
      strokeCounter?: number;
      paintBuffer: ArrayBuffer;
      gradientIdBuffer?: ArrayBuffer;
      gradientDefIdBuffer?: ArrayBuffer;
      speedBuffer?: ArrayBuffer;
      flowBuffer?: ArrayBuffer;
      phaseBuffer?: ArrayBuffer;
    };
    gradientDefs?: Array<{ id: string; name?: string; currentSlot: number }>;
    slotPalettes?: Array<{ slot: number; stops: Array<{ position: number; color: string }> }>;
    gradientDefStore?: Array<{
      id: number;
      kind: 'linear' | 'concentric';
      stops: Array<{ position: number; color: string }>;
      hash: string;
      source: 'manual' | 'fg' | 'sampled';
      seamProfile?: 'hard' | 'soft';
      createdAtMs: number;
      slot?: number;
      speedCps?: number;
    }>;
    nextGradientDefId?: number;
    fgActiveSlot?: number;
    fgDerivedKey?: string;
    fgDerivedGradients?: Array<{
      key: string;
      slot: number;
      spec: {
        mode: 'fg-derived';
        baseColor: string;
        lightness: number;
        variance: number;
        hueShift?: number;
        saturationShift?: number;
        opacity?: number;
        bands: number;
        algoVersion: number;
        key: string;
      };
    }>;
    derivedGradients?: Array<{
      key: string;
      slot: number;
      spec: {
        mode: 'fg-derived';
        baseColor: string;
        lightness: number;
        variance: number;
        hueShift?: number;
        saturationShift?: number;
        opacity?: number;
        bands: number;
        algoVersion: number;
        key: string;
      };
    }>;
    activeGradientId?: string;
  }>;
  cycleSpeed?: number;
  fps?: number;
  brushSize?: number;
  ditherEnabled?: boolean;
  ditherStrength?: number;
  ditherPixelSize?: number;
  perceptualDither?: boolean;
  stampShape?: 'square' | 'round' | 'triangle' | 'diamond' | 'diamond5' | 'diamond7' | 'diamond9' | 'checkered';
  stampDitherEnabled?: boolean;
  stampDitherPixelSize?: number;
  stampDitherAlgorithm?: BrushSettings['ditherAlgorithm'];
  stampDitherPatternStyle?: BrushSettings['patternStyle'];
  stampDitherBgFill?: boolean;
  stampDitherClears?: boolean;
  stampDitherPressureLinked?: boolean;
  pxlEdgeEnabled?: boolean;
}

type SerializedColorCycleWebGLState = NonNullable<SerializedLayer['colorCycleData']>['webGLState'];

const savedWebGLStates = new WeakMap<Layer, SerializedColorCycleWebGLState | undefined>();
const savedBrushStates = new WeakMap<Layer, PersistedColorCycleBrushState | undefined>();
const savedWebGLStatesById = new Map<string, SerializedColorCycleWebGLState | undefined>();
const savedBrushStatesById = new Map<string, PersistedColorCycleBrushState | undefined>();

const setSavedColorCycleWebGLState = (
  layer: Layer,
  state: SerializedColorCycleWebGLState | undefined,
): void => {
  savedWebGLStates.set(layer, state);
  savedWebGLStatesById.set(layer.id, state);
};

const getSavedColorCycleWebGLState = (
  layer: Layer,
): SerializedColorCycleWebGLState | undefined => (
  savedWebGLStates.get(layer) ?? savedWebGLStatesById.get(layer.id)
);

const deleteSavedColorCycleWebGLState = (layer: Layer): void => {
  savedWebGLStates.delete(layer);
  savedWebGLStatesById.delete(layer.id);
};

const setSavedColorCycleBrushState = (
  layer: Layer,
  state: PersistedColorCycleBrushState | undefined,
): void => {
  savedBrushStates.set(layer, state);
  savedBrushStatesById.set(layer.id, state);
};

const getSavedColorCycleBrushState = (
  layer: Layer,
): PersistedColorCycleBrushState | undefined => (
  savedBrushStates.get(layer) ?? savedBrushStatesById.get(layer.id)
);

const deleteSavedColorCycleBrushState = (layer: Layer): void => {
  savedBrushStates.delete(layer);
  savedBrushStatesById.delete(layer.id);
};

type CanonicalRepairBrushState = Omit<PersistedColorCycleBrushState, 'layers'> & {
  layers: Array<Omit<SerializedBrushLayerSnapshot, 'strokeData'> & {
    strokeData?: {
      hasContent?: boolean;
      strokeCounter?: number;
      paintBuffer?: ArrayBuffer;
      gradientIdBuffer?: ArrayBuffer;
      gradientDefIdBuffer?: ArrayBuffer;
      speedBuffer?: ArrayBuffer;
      flowBuffer?: ArrayBuffer;
      phaseBuffer?: ArrayBuffer;
    };
  }>;
};

const cloneBuffer = (buffer: ArrayBuffer | undefined): ArrayBuffer | undefined => (
  buffer ? buffer.slice(0) : undefined
);

const writeColorCycleRepairState = (
  layer: Layer,
  repair: Extract<ColorCycleLegacyRepairResult, { ok: true }>,
): void => {
  const colorCycleData = layer.colorCycleData;
  if (!colorCycleData) {
    return;
  }

  const existingSavedBrushState = getSavedColorCycleBrushState(layer)
    ?? (colorCycleData.brushState as PersistedColorCycleBrushState | undefined);
  const existingSnapshot = getSerializedBrushSnapshotForLayer(existingSavedBrushState, layer.id);
  const { state } = repair;

  colorCycleData.gradientIdBuffer = cloneBuffer(state.gradientIdBuffer);
  colorCycleData.gradientDefIdBuffer = cloneBuffer(state.gradientDefIdBuffer);
  colorCycleData.phaseBuffer = cloneBuffer(state.phaseBuffer);
  colorCycleData.gradientDefs = state.gradientDefs ?? colorCycleData.gradientDefs;
  colorCycleData.slotPalettes = state.slotPalettes ?? colorCycleData.slotPalettes;
  colorCycleData.gradientDefStore = state.gradientDefStore ?? colorCycleData.gradientDefStore;
  colorCycleData.activeGradientId = state.activeGradientId ?? colorCycleData.activeGradientId;
  colorCycleData.paintSlot = state.paintSlot ?? colorCycleData.paintSlot;
  colorCycleData.fgActiveSlot = state.fgActiveSlot ?? colorCycleData.fgActiveSlot;
  colorCycleData.layerBaseSpeedCps = state.layerBaseSpeedCps ?? colorCycleData.layerBaseSpeedCps;
  colorCycleData.flowMode = state.flowMode ?? colorCycleData.flowMode;
  colorCycleData.hasContent = state.hasContent;
  delete colorCycleData.repairStatus;

  const canonicalBrushState: CanonicalRepairBrushState = {
    ...(existingSavedBrushState ?? { layers: [] }),
    canonicalPaint: true,
    schemaVersion: 1,
    dimensionsByLayerId: {
      ...(existingSavedBrushState?.dimensionsByLayerId ?? {}),
      [layer.id]: {
        width: state.width,
        height: state.height,
      },
    },
    layers: [{
      ...(existingSnapshot ?? { layerId: layer.id }),
      layerId: layer.id,
      canonicalPaint: true,
      schemaVersion: 1,
      dimensions: {
        width: state.width,
        height: state.height,
      },
      strokeData: {
        hasContent: state.hasContent,
        strokeCounter: existingSnapshot?.strokeData?.strokeCounter,
        paintBuffer: cloneBuffer(state.paintBuffer),
        gradientIdBuffer: cloneBuffer(state.gradientIdBuffer),
        gradientDefIdBuffer: cloneBuffer(state.gradientDefIdBuffer),
        speedBuffer: cloneBuffer(state.speedBuffer),
        flowBuffer: cloneBuffer(state.flowBuffer),
        phaseBuffer: cloneBuffer(state.phaseBuffer),
      },
      gradientDefs: state.gradientDefs ?? existingSnapshot?.gradientDefs,
      slotPalettes: state.slotPalettes ?? existingSnapshot?.slotPalettes,
      gradientDefStore: state.gradientDefStore ?? existingSnapshot?.gradientDefStore,
      paintSlot: state.paintSlot ?? existingSnapshot?.paintSlot,
      fgActiveSlot: state.fgActiveSlot ?? existingSnapshot?.fgActiveSlot,
      activeGradientId: state.activeGradientId ?? existingSnapshot?.activeGradientId,
    }],
  };

  const serializedBrushState: PersistedColorCycleBrushState = {
    ...(existingSavedBrushState ?? { layers: [] }),
    canonicalPaint: true,
    schemaVersion: 1,
    dimensionsByLayerId: canonicalBrushState.dimensionsByLayerId,
    layers: canonicalBrushState.layers.map((snapshot) => ({
      ...snapshot,
      strokeData: snapshot.strokeData
        ? {
            hasContent: snapshot.strokeData.hasContent,
            strokeCounter: snapshot.strokeData.strokeCounter,
            paintBuffer: snapshot.strokeData.paintBuffer
              ? arrayBufferToBase64(snapshot.strokeData.paintBuffer)
              : undefined,
            gradientIdBuffer: snapshot.strokeData.gradientIdBuffer
              ? arrayBufferToBase64(snapshot.strokeData.gradientIdBuffer)
              : undefined,
            gradientDefIdBuffer: snapshot.strokeData.gradientDefIdBuffer
              ? arrayBufferToBase64(snapshot.strokeData.gradientDefIdBuffer)
              : undefined,
            speedBuffer: snapshot.strokeData.speedBuffer
              ? arrayBufferToBase64(snapshot.strokeData.speedBuffer)
              : undefined,
            flowBuffer: snapshot.strokeData.flowBuffer
              ? arrayBufferToBase64(snapshot.strokeData.flowBuffer)
              : undefined,
            phaseBuffer: snapshot.strokeData.phaseBuffer
              ? arrayBufferToBase64(snapshot.strokeData.phaseBuffer)
              : undefined,
          }
        : undefined,
    })),
  };

  if (existingSavedBrushState) {
    existingSavedBrushState.layers = serializedBrushState.layers;
  }
  colorCycleData.brushState = canonicalBrushState;
  setSavedColorCycleBrushState(layer, serializedBrushState);
};

const hasLegacyColorCycleRepairCandidateData = (layer: Layer): boolean => {
  const colorCycleData = layer.colorCycleData;
  if (!colorCycleData) {
    return false;
  }
  const savedBrushState = getSavedColorCycleBrushState(layer)
    ?? (colorCycleData.brushState as PersistedColorCycleBrushState | undefined);
  return Boolean(
    colorCycleData.gradientIdBuffer ||
    colorCycleData.gradientDefIdBuffer ||
    savedBrushState?.layers?.some((snapshot) => Boolean(snapshot.strokeData)),
  );
};

const hasSavedColorCyclePaintBuffer = (layer: Layer): boolean => {
  const colorCycleData = layer.colorCycleData;
  if (!colorCycleData) {
    return false;
  }
  const savedBrushState = getSavedColorCycleBrushState(layer)
    ?? (colorCycleData.brushState as PersistedColorCycleBrushState | undefined);
  const snapshot = getSerializedBrushSnapshotForLayer(savedBrushState, layer.id);
  return Boolean(snapshot?.strokeData?.paintBuffer);
};

type ColorCycleImportRepairClassification =
  | 'canonical'
  | 'repairable-legacy'
  | 'preview-only'
  | 'metadata-only-empty'
  | 'empty';

const classifyColorCycleImportRepairState = (layer: Layer): ColorCycleImportRepairClassification => {
  if (hasSavedColorCyclePaintBuffer(layer)) {
    return 'canonical';
  }
  if (hasLegacyColorCycleRepairCandidateData(layer)) {
    return 'repairable-legacy';
  }
  const preview = layer.colorCycleData?.canvasImageData ?? null;
  if (preview && imageDataHasVisiblePixels(preview)) {
    return 'preview-only';
  }
  const savedBrushState = getSavedColorCycleBrushState(layer)
    ?? (layer.colorCycleData?.brushState as PersistedColorCycleBrushState | undefined);
  if (savedBrushState && typeof savedBrushState === 'object') {
    return 'metadata-only-empty';
  }
  return 'empty';
};

const prepareColorCycleRepairBindingsFromSavedSnapshot = (layer: Layer): void => {
  const colorCycleData = layer.colorCycleData;
  if (!colorCycleData) {
    return;
  }
  const savedBrushState = getSavedColorCycleBrushState(layer)
    ?? (colorCycleData.brushState as PersistedColorCycleBrushState | undefined);
  const snapshot = getSerializedBrushSnapshotForLayer(savedBrushState, layer.id);
  if (!colorCycleData.gradientIdBuffer && snapshot?.strokeData?.gradientIdBuffer) {
    colorCycleData.gradientIdBuffer = base64ToArrayBufferIfHydrated(snapshot.strokeData.gradientIdBuffer);
  }
  if (!colorCycleData.gradientDefIdBuffer && snapshot?.strokeData?.gradientDefIdBuffer) {
    colorCycleData.gradientDefIdBuffer = base64ToArrayBufferIfHydrated(snapshot.strokeData.gradientDefIdBuffer);
  }
};

const withColorCycleDiagnosticNotes = (
  notes: string[],
  diagnostics: ColorCycleDiagnosticStatus[],
): string[] => {
  const next = [...notes];
  for (const diagnostic of diagnostics) {
    const note = `diagnostic:${diagnostic}`;
    if (!next.includes(note)) {
      next.push(note);
    }
  }
  return next;
};

const applyLegacyColorCycleImportRepair = async (layers: Layer[]): Promise<ColorCycleRepairWarning[]> => {
  const warnings: ColorCycleRepairWarning[] = [];

  for (const layer of layers) {
    if (layer.layerType !== 'color-cycle' || layer.colorCycleData?.mode === 'recolor' || !layer.colorCycleData) {
      continue;
    }
    const importClassification = classifyColorCycleImportRepairState(layer);
    if (importClassification === 'canonical') {
      continue;
    }
    if (layer.colorCycleData.repairStatus?.ok === false) {
      continue;
    }

    await hydrateLazyColorCycleArchiveRuntime(layer);
    prepareColorCycleRepairBindingsFromSavedSnapshot(layer);
    const repair = repairLegacyColorCycleLayer(layer);
    if (repair.ok) {
      if (repair.repaired) {
        writeColorCycleRepairState(layer, repair);
      }
      if (repair.repaired || repair.repairNotes.length > 0) {
        const diagnostics: ColorCycleDiagnosticStatus[] = ['repaired-on-import', 'canonical-valid'];
        warnings.push({
          layerId: layer.id,
          layerName: layer.name,
          status: 'repaired-on-import',
          diagnostics,
          notes: withColorCycleDiagnosticNotes(repair.repairNotes, diagnostics),
        });
      }
      continue;
    }

    if (importClassification !== 'repairable-legacy' && importClassification !== 'preview-only') {
      continue;
    }
    const hasRepairCandidateData = importClassification === 'repairable-legacy';

    layer.colorCycleData.runtimeHydrationState = 'cold';
    layer.colorCycleData.deferredRuntimeRestore = false;
    const diagnostics: ColorCycleDiagnosticStatus[] = ['static-preview-only', 'repair-failed'];
    layer.colorCycleData.repairStatus = {
      ok: false,
      reason: repair.reason,
      notes: withColorCycleDiagnosticNotes([
        hasRepairCandidateData
          ? 'legacy-color-cycle-import-repair-failed'
          : 'color-cycle-import-missing-canonical-payload',
      ], diagnostics),
    };
    warnings.push({
      layerId: layer.id,
      layerName: layer.name,
      status: 'static-preview-only',
      diagnostics,
      reason: repair.reason,
      notes: withColorCycleDiagnosticNotes([
        hasRepairCandidateData
          ? 'legacy-color-cycle-import-repair-failed'
          : 'color-cycle-import-missing-canonical-payload',
      ], diagnostics),
    });
  }

  return warnings;
};

const toFastPathMetadataBrushState = (
  brushState: PersistedColorCycleBrushState
): PersistedColorCycleBrushState => ({
  canonicalPaint: brushState.canonicalPaint,
  schemaVersion: brushState.schemaVersion,
  dimensionsByLayerId: brushState.dimensionsByLayerId,
  cycleSpeed: brushState.cycleSpeed,
  fps: brushState.fps,
  brushSize: brushState.brushSize,
  ditherEnabled: brushState.ditherEnabled,
  ditherStrength: brushState.ditherStrength,
  ditherPixelSize: brushState.ditherPixelSize,
  perceptualDither: brushState.perceptualDither,
  stampShape: brushState.stampShape,
  stampDitherEnabled: brushState.stampDitherEnabled,
  stampDitherPixelSize: brushState.stampDitherPixelSize,
  stampDitherAlgorithm: brushState.stampDitherAlgorithm,
  stampDitherPatternStyle: brushState.stampDitherPatternStyle,
  stampDitherBgFill: brushState.stampDitherBgFill,
  stampDitherClears: brushState.stampDitherClears,
  stampDitherPressureLinked: brushState.stampDitherPressureLinked,
  pxlEdgeEnabled: brushState.pxlEdgeEnabled,
  layers: brushState.layers.map((layer) => ({
    layerId: layer.layerId,
    canonicalPaint: layer.canonicalPaint,
    schemaVersion: layer.schemaVersion,
    dimensions: layer.dimensions,
    capturedAtStrokeCounter: layer.capturedAtStrokeCounter,
    strokeData: layer.strokeData
      ? {
          hasContent: layer.strokeData.hasContent,
          strokeCounter: layer.strokeData.strokeCounter,
        }
      : undefined,
    gradientDefs: layer.gradientDefs,
    slotPalettes: layer.slotPalettes,
    gradientDefStore: layer.gradientDefStore,
    nextGradientDefId: layer.nextGradientDefId,
    paintSlot: layer.paintSlot,
    legacyRemap: layer.legacyRemap,
    fgActiveSlot: layer.fgActiveSlot,
    fgDerivedKey: layer.fgDerivedKey,
    fgDerivedGradients: layer.fgDerivedGradients,
    derivedGradients: layer.derivedGradients,
    activeGradientId: layer.activeGradientId,
    animator: layer.animator
      ? {
          indexBuffer: {
            width: layer.animator.indexBuffer.width,
            height: layer.animator.indexBuffer.height,
            data: undefined,
            gradientId: undefined,
            speedData: undefined,
            flowData: undefined,
            phaseData: undefined,
            palette: layer.animator.indexBuffer.palette,
          },
          gradient: layer.animator.gradient,
          animation: layer.animator.animation,
        }
      : undefined,
  })),
});

function imageDataHasVisiblePixels(imageData: ImageData | null | undefined): boolean {
  if (!imageData) return false;
  const { data } = imageData;
  const length = data.length;
  // Sample every 4th pixel by default, but bail fast if we find anything opaque
  for (let i = 3; i < length; i += 16) {
    if (data[i] > 0) {
      return true;
    }
  }
  // If coarse sampling did not find anything, perform a final sparse check to avoid false negatives
  for (let i = 3; i < length; i += Math.max(4, Math.floor(length / 4096))) {
    if (data[i] > 0) {
      return true;
    }
  }
  return false;
}

// Convert ImageData to a base64 encoded PNG data URL. Falls back to the
// previous raw-pixel format if no canvas APIs are available.
async function imageDataToDataUrl(imageData: ImageData): Promise<string> {
  const encodeWithOffscreenCanvas = async (): Promise<string> => {
    if (typeof OffscreenCanvas === 'undefined') {
      throw new Error('OffscreenCanvas unavailable');
    }

    const canvas = new OffscreenCanvas(imageData.width, imageData.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      throw new Error('Failed to acquire OffscreenCanvas context');
    }

    ctx.putImageData(imageData, 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const buffer = await blob.arrayBuffer();
    return `data:image/png;base64,${arrayBufferToBase64(buffer)}`;
  };

  const encodeWithDOMCanvas = (): string => {
    if (typeof document === 'undefined') {
      throw new Error('DOM unavailable');
    }

    const canvas = document.createElement('canvas');
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      throw new Error('Failed to acquire 2D context');
    }

    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL('image/png');
  };

  try {
    return await encodeWithOffscreenCanvas();
  } catch (error) {
    if (typeof process !== 'undefined' && process.env.NODE_ENV === 'development') {
      debugWarn('raw-console', '[projectIO] Falling back to DOM canvas encoding:', error);
    }
  }

  try {
    return encodeWithDOMCanvas();
  } catch (error) {
    debugWarn('raw-console', '[projectIO] Falling back to raw image serialization:', error);
  }

  return encodeImageDataAsRawDataUrl(imageData);
}

function encodeImageDataAsRawDataUrl(imageData: ImageData): string {
  const rawData = {
    width: imageData.width,
    height: imageData.height,
    dataBase64: bytesToBase64(
      new Uint8Array(
        imageData.data.buffer,
        imageData.data.byteOffset,
        imageData.data.byteLength
      )
    )
  };

  const jsonString = JSON.stringify(rawData);
  const base64 = btoa(jsonString);
  return `data:application/json;base64,${base64}`;
}

// Convert base64 raw pixel data back to ImageData (lossless)
function dataUrlToImageData(dataUrl: string): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    try {
      // Check if this is raw pixel data format
      if (dataUrl.startsWith('data:application/json;base64,')) {
        const base64 = dataUrl.substring('data:application/json;base64,'.length);
        const jsonString = atob(base64);
        const rawData = JSON.parse(jsonString);

        // Recreate ImageData from raw pixel data
        if (Array.isArray(rawData.data)) {
          // Legacy format: data array of numbers
          const imageData = new ImageData(
            new Uint8ClampedArray(rawData.data),
            rawData.width,
            rawData.height
          );
          resolve(imageData);
          return;
        }

        if (typeof rawData.dataBase64 === 'string') {
          const bytes = base64ToUint8Array(rawData.dataBase64);
          if (!bytes) {
            reject(new Error('Failed to decode image bytes'));
            return;
          }

          const imageData = new ImageData(
            new Uint8ClampedArray(bytes),
            rawData.width,
            rawData.height
          );
          resolve(imageData);
          return;
        }

        reject(new Error('Unsupported raw image payload'));
        return;
      }

      // Fallback: handle old PNG format for backward compatibility
      if (dataUrl.startsWith('data:image/png;base64,')) {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
          if (!ctx) {
            reject(new Error('Failed to get canvas context'));
            return;
          }

          ctx.drawImage(img, 0, 0);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          resolve(imageData);
        };
        img.onerror = () => reject(new Error('Failed to load image data'));
        img.src = dataUrl;
        return;
      }

      reject(new Error('Unsupported data format'));
    } catch (error) {
      reject(error);
    }
  });
}

// Helper to convert base64 to ArrayBuffer
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function base64ToArrayBufferIfHydrated(base64: string | undefined): ArrayBuffer | undefined {
  if (!base64 || isArchiveBinaryRef(base64)) {
    return undefined;
  }
  return base64ToArrayBuffer(base64);
}

function bytesToBase64(bytes: Uint8Array): string {
  if (bytes.length === 0) {
    return '';
  }

  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  return bytesToBase64(new Uint8Array(buffer));
}

function typedArrayToBase64(view: ArrayBufferView): string {
  return bytesToBase64(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
}

function isArchiveBinaryRef(value: string | undefined): boolean {
  return isPersistedArchiveBinaryRef(value);
}

function toArchiveBinaryRef(path: string): string {
  return `${ARCHIVE_BINARY_REF_PREFIX}${path}`;
}

function fromArchiveBinaryRef(value: string): string {
  return value.slice(ARCHIVE_BINARY_REF_PREFIX.length);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function base64ToUint8Array(base64?: string): Uint8Array | undefined {
  if (!base64) {
    return undefined;
  }
  return new Uint8Array(base64ToArrayBuffer(base64));
}

const getBytesPerColorCyclePixel = (path: string): number => (
  inferBinaryManifestDType(path) === 'uint16' ? 2 : 1
);

const findNonZeroBufferBounds = (
  bytes: Uint8Array,
  dimensions: { width?: number; height?: number } | undefined,
  bytesPerPixel: number,
): BinaryManifestEntry['crop'] | null | undefined => {
  const width = dimensions?.width;
  const height = dimensions?.height;
  if (!width || !height || bytes.byteLength !== width * height * bytesPerPixel) {
    return undefined;
  }

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width * bytesPerPixel;
    for (let x = 0; x < width; x += 1) {
      const offset = rowOffset + x * bytesPerPixel;
      let hasValue = false;
      for (let byteIndex = 0; byteIndex < bytesPerPixel; byteIndex += 1) {
        if (bytes[offset + byteIndex] !== 0) {
          hasValue = true;
          break;
        }
      }
      if (!hasValue) {
        continue;
      }
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < 0 || maxY < 0) {
    return null;
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
};

const cropBufferToBounds = (
  bytes: Uint8Array,
  sourceWidth: number,
  crop: NonNullable<BinaryManifestEntry['crop']>,
  bytesPerPixel: number,
): Uint8Array => {
  const rowBytes = crop.width * bytesPerPixel;
  const cropped = new Uint8Array(rowBytes * crop.height);
  for (let row = 0; row < crop.height; row += 1) {
    const sourceStart = ((crop.y + row) * sourceWidth + crop.x) * bytesPerPixel;
    cropped.set(bytes.subarray(sourceStart, sourceStart + rowBytes), row * rowBytes);
  }
  return cropped;
};

const expandSparseRectBuffer = (
  bytes: Uint8Array,
  manifestEntry: BinaryManifestEntry,
): Uint8Array => {
  const { crop, width, height } = manifestEntry;
  if (manifestEntry.encoding !== 'sparse-rect-v1' || !crop || !width || !height) {
    return bytes;
  }
  const bytesPerPixel = getBytesPerColorCyclePixel(manifestEntry.path);
  const expectedCroppedBytes = crop.width * crop.height * bytesPerPixel;
  if (bytes.byteLength !== expectedCroppedBytes) {
    throw new Error(`Project archive sparse binary length mismatch for ${manifestEntry.path}`);
  }
  const expandedByteLength = manifestEntry.logicalByteLength ?? width * height * bytesPerPixel;
  const expanded = new Uint8Array(expandedByteLength);
  const rowBytes = crop.width * bytesPerPixel;
  for (let row = 0; row < crop.height; row += 1) {
    const sourceStart = row * rowBytes;
    const targetStart = ((crop.y + row) * width + crop.x) * bytesPerPixel;
    expanded.set(bytes.subarray(sourceStart, sourceStart + rowBytes), targetStart);
  }
  return expanded;
};

const externalizeBase64Buffer = (
  base64: string | undefined,
  path: string,
  entries: ArchiveBinaryEntry[],
  dimensions?: { width?: number; height?: number },
  options?: { preserveAllZero?: boolean },
): string | undefined => {
  if (!base64 || isArchiveBinaryRef(base64)) {
    return base64;
  }
  const bytes = base64ToUint8Array(base64);
  if (!bytes) {
    return base64;
  }
  const bytesPerPixel = getBytesPerColorCyclePixel(path);
  const bounds = findNonZeroBufferBounds(bytes, dimensions, bytesPerPixel);
  if (bounds === null) {
    if (!options?.preserveAllZero) {
      return undefined;
    }
    entries.push({ path, bytes, width: dimensions?.width, height: dimensions?.height });
    return toArchiveBinaryRef(path);
  }
  if (bounds && dimensions?.width && dimensions?.height) {
    const cropped = cropBufferToBounds(bytes, dimensions.width, bounds, bytesPerPixel);
    if (cropped.byteLength < bytes.byteLength) {
      entries.push({
        path,
        bytes: cropped,
        width: dimensions.width,
        height: dimensions.height,
        logicalByteLength: bytes.byteLength,
        encoding: 'sparse-rect-v1',
        crop: bounds,
      });
      return toArchiveBinaryRef(path);
    }
  }
  entries.push({ path, bytes, width: dimensions?.width, height: dimensions?.height });
  return toArchiveBinaryRef(path);
};

const externalizeArchiveTextValue = (
  text: string | undefined,
  path: string,
  entries: ArchiveBinaryEntry[],
): string | undefined => {
  if (!text || isArchiveBinaryRef(text)) {
    return text;
  }
  entries.push({
    path,
    bytes: utf8Encoder.encode(text),
    data: text,
  });
  return toArchiveBinaryRef(path);
};

const readRawVerifiedArchiveEntryBytes = async (
  entryPath: string,
  zip: JSZip,
  binaryManifest: ArchiveBinaryManifestIndex,
): Promise<Uint8Array> => {
  const entry = zip.file(entryPath);
  const normalizedEntry = Array.isArray(entry) ? entry[0] ?? null : entry;
  if (!normalizedEntry) {
    throw new Error(`Project archive is missing ${entryPath}`);
  }
  const manifestEntry = binaryManifest.get(entryPath);
  if (!manifestEntry) {
    throw new Error(`Project archive manifest is missing binary entry ${entryPath}`);
  }
  const bytes = await normalizedEntry.async('uint8array');
  if (bytes.byteLength !== manifestEntry.byteLength) {
    throw new Error(`Project archive binary length mismatch for ${entryPath}`);
  }
  if (fnv1aHash(bytes) !== manifestEntry.checksum) {
    throw new Error(`Project archive binary checksum mismatch for ${entryPath}`);
  }
  return bytes;
};

const copyDeferredArchiveBinaryRefs = async (
  layer: SerializedLayer,
  entries: ArchiveBinaryEntry[],
): Promise<void> => {
  const runtime = getLazyColorCycleArchiveRuntimeByLayerId(layer.id);
  if (!runtime) {
    return;
  }

  const existingPaths = new Set(entries.map((entry) => entry.path));
  const archiveRefs = collectArchiveBinaryRefs(layer);
  for (const path of archiveRefs) {
    if (existingPaths.has(path)) {
      continue;
    }
    const manifestEntry = runtime.binaryManifest.get(path);
    if (!manifestEntry) {
      continue;
    }
    const bytes = await readRawVerifiedArchiveEntryBytes(path, runtime.archiveZip, runtime.binaryManifest);
    entries.push({
      path,
      bytes,
      width: manifestEntry.width,
      height: manifestEntry.height,
      logicalByteLength: manifestEntry.logicalByteLength,
      encoding: manifestEntry.encoding,
      crop: manifestEntry.crop,
    });
    existingPaths.add(path);
  }
};

const collectLayerArchiveBinaryEntries = (
  layer: SerializedLayer,
  entries: ArchiveBinaryEntry[],
  fallbackWidth: number,
  fallbackHeight: number,
): void => {
  const normalizedLayerType = normalizePersistedLayerType(layer.layerType);
  if (normalizedLayerType === 'normal' && layer.state && 'imageRef' in layer.state) {
    const rasterImagePath = fromArchiveBinaryRef(layer.state.imageRef);
    entries.push({
      path: rasterImagePath,
      bytes: utf8Encoder.encode(layer.imageDataUrl),
      data: layer.imageDataUrl,
      width: layer.state.dimensions.width,
      height: layer.state.dimensions.height,
    });
    layer.imageDataUrl = '';
    return;
  }

  if (normalizedLayerType === 'sequential' && layer.state && 'chunksRef' in layer.state) {
    const sequentialData = layer.sequentialData;
    const chunksPath = fromArchiveBinaryRef(layer.state.chunksRef);
    entries.push({
      path: chunksPath,
      bytes: utf8Encoder.encode(JSON.stringify(sequentialData?.chunks ?? [])),
      data: JSON.stringify(sequentialData?.chunks ?? []),
    });
    if (layer.state.brushSnapshotsRef) {
      const brushSnapshotsJson = JSON.stringify(sequentialData?.brushSnapshots ?? {});
      entries.push({
        path: fromArchiveBinaryRef(layer.state.brushSnapshotsRef),
        bytes: utf8Encoder.encode(brushSnapshotsJson),
        data: brushSnapshotsJson,
      });
    }
    layer.sequentialData = undefined;
    return;
  }

  const colorCycleData = layer.colorCycleData;
  if (!colorCycleData) {
    return;
  }
  const stateSource = layer[COLOR_CYCLE_STATE_SOURCE] ?? {} as SerializedColorCycleStateSource;
  const canvasDimensions = resolveColorCycleCanvasDimensions(
    {
      canvasImageData: undefined,
      canvasWidth: colorCycleData.canvasWidth,
      canvasHeight: colorCycleData.canvasHeight,
      canvas: null,
    },
    fallbackWidth,
    fallbackHeight,
  );

  stateSource.gradientIdRef = externalizeBase64Buffer(
    stateSource.gradientIdRef,
    `buffers/color-cycle/${layer.id}/gradient-id.bin`,
    entries,
    canvasDimensions,
    { preserveAllZero: true },
  );
  stateSource.gradientDefIdRef = externalizeBase64Buffer(
    stateSource.gradientDefIdRef,
    `buffers/color-cycle/${layer.id}/gradient-def-id.bin`,
    entries,
    canvasDimensions,
    { preserveAllZero: true },
  );

  const currentSnapshot = stateSource?.currentLayerSnapshot;
  if (currentSnapshot?.strokeData) {
    currentSnapshot.strokeData.paintBuffer = externalizeBase64Buffer(
      currentSnapshot.strokeData.paintBuffer,
      `buffers/color-cycle/${layer.id}/paint.bin`,
      entries,
      canvasDimensions,
      { preserveAllZero: true },
    );
    currentSnapshot.strokeData.speedBuffer = externalizeBase64Buffer(
      currentSnapshot.strokeData.speedBuffer,
      `buffers/color-cycle/${layer.id}/speed.bin`,
      entries,
      canvasDimensions,
      { preserveAllZero: true },
    );
    currentSnapshot.strokeData.flowBuffer = externalizeBase64Buffer(
      currentSnapshot.strokeData.flowBuffer,
      `buffers/color-cycle/${layer.id}/flow.bin`,
      entries,
      canvasDimensions,
      { preserveAllZero: true },
    );
    currentSnapshot.strokeData.phaseBuffer = externalizeBase64Buffer(
      currentSnapshot.strokeData.phaseBuffer,
      `buffers/color-cycle/${layer.id}/phase.bin`,
      entries,
      canvasDimensions,
      { preserveAllZero: true },
    );
  }

  colorCycleData.canvasImageData = externalizeArchiveTextValue(
    colorCycleData.canvasImageData,
    `buffers/color-cycle/${layer.id}/canvas-image.txt`,
    entries,
  );
  colorCycleData.eraseMaskImageData = externalizeArchiveTextValue(
    colorCycleData.eraseMaskImageData,
    `buffers/color-cycle/${layer.id}/erase-mask.txt`,
    entries,
  );
  colorCycleData.softEdgeMaskImageData = externalizeArchiveTextValue(
    colorCycleData.softEdgeMaskImageData,
    `buffers/color-cycle/${layer.id}/soft-edge-mask.txt`,
    entries,
  );
  if (colorCycleData.recolorSettings) {
    colorCycleData.recolorSettings.indexBuffer = externalizeBase64Buffer(
      colorCycleData.recolorSettings.indexBuffer,
      `buffers/color-cycle/${layer.id}/recolor-index.bin`,
      entries,
      canvasDimensions,
    );
    colorCycleData.recolorSettings.indexPhaseMap = externalizeBase64Buffer(
      colorCycleData.recolorSettings.indexPhaseMap,
      `buffers/color-cycle/${layer.id}/recolor-index-phase.bin`,
      entries,
      canvasDimensions,
    );
    colorCycleData.recolorSettings.phaseMap = externalizeBase64Buffer(
      colorCycleData.recolorSettings.phaseMap,
      `buffers/color-cycle/${layer.id}/recolor-phase.bin`,
      entries,
      canvasDimensions,
    );
    colorCycleData.recolorSettings.originalImageData = externalizeArchiveTextValue(
      colorCycleData.recolorSettings.originalImageData,
      `buffers/color-cycle/${layer.id}/recolor-original-image.txt`,
      entries,
    );
  }

  layer.state = buildSerializedColorCycleLayerState(layer, fallbackWidth, fallbackHeight, stateSource);
  delete colorCycleData.gradientDefs;
  delete colorCycleData.slotPalettes;
  delete colorCycleData.gradientDefStore;
  delete colorCycleData.nextGradientDefId;
  delete colorCycleData.fgActiveSlot;
  delete colorCycleData.activeGradientId;
  delete colorCycleData.gradientIdBuffer;
  delete colorCycleData.gradientDefIdBuffer;
  delete colorCycleData.isAnimating;
  delete colorCycleData.mode;
  delete colorCycleData.layerBaseSpeedCps;
  delete colorCycleData.brushSpeed;
  delete colorCycleData.controllerSpeedCps;
  delete colorCycleData.flowMode;
  delete layer[COLOR_CYCLE_STATE_SOURCE];
};

const buildArchiveBinaryManifest = (
  archiveBinaryEntries: ArchiveBinaryEntry[],
): BinaryManifestEntry[] => archiveBinaryEntries.map((entry) => ({
  version: 1,
  path: entry.path,
  checksum: fnv1aHash(entry.bytes),
  byteLength: entry.bytes.byteLength,
  logicalByteLength: entry.logicalByteLength,
  dtype: inferBinaryManifestDType(entry.path),
  width: entry.width,
  height: entry.height,
  encoding: entry.encoding,
  crop: entry.crop,
  compression: 'deflate',
}));

type ArchiveRefLocation = {
  path: string;
  location: string;
  layer?: SerializedLayer;
};

const collectArchiveRefLocationsFromValue = (
  value: unknown,
  location: string,
  refs: ArchiveRefLocation[],
  layer?: SerializedLayer,
): void => {
  if (isPersistedArchiveBinaryRef(value)) {
    refs.push({
      path: value.slice(ARCHIVE_BINARY_REF_PREFIX.length),
      location,
      layer,
    });
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      collectArchiveRefLocationsFromValue(entry, `${location}[${index}]`, refs, layer);
    });
    return;
  }

  if (!value || typeof value !== 'object') {
    return;
  }

  Object.entries(value).forEach(([key, entry]) => {
    collectArchiveRefLocationsFromValue(entry, `${location}.${key}`, refs, layer);
  });
};

const collectArchiveRefLocations = (layers: SerializedLayer[]): ArchiveRefLocation[] => {
  const refs: ArchiveRefLocation[] = [];
  layers.forEach((layer, index) => {
    collectArchiveRefLocationsFromValue(layer, `project.layers[${index}]`, refs, layer);
  });
  return refs;
};

const classifyArchiveRefPath = (path: string): ProjectArchiveRefKind => {
  if (path.startsWith('buffers/color-cycle/')) {
    if (isOptionalColorCycleArchivePath(path)) {
      return 'optional-color-cycle';
    }
    if (
      path.endsWith('/paint.bin') ||
      path.endsWith('/speed.bin') ||
      path.endsWith('/flow.bin') ||
      path.endsWith('/phase.bin') ||
      path.endsWith('/gradient-id.bin') ||
      path.endsWith('/gradient-def-id.bin')
    ) {
      return 'canonical-color-cycle';
    }
  }
  if (path.startsWith('buffers/raster/')) {
    return 'raster';
  }
  if (path.startsWith('buffers/sequential/')) {
    return 'sequential';
  }
  return 'unknown';
};

const analyzeVesselProjectArchiveRefs = (
  vesselProject: VesselProject,
  options: {
    binaryPaths: Set<string>;
    payloadPaths?: Set<string>;
  },
): ProjectArchiveRefAnalysis => {
  const grouped = new Map<string, ProjectArchiveRefIssue>();
  collectArchiveRefLocations(vesselProject.project.layers).forEach((ref) => {
    const missingManifestEntry = !options.binaryPaths.has(ref.path);
    const missingArchivePayload = options.payloadPaths
      ? !options.payloadPaths.has(ref.path)
      : false;
    if (!missingManifestEntry && !missingArchivePayload) {
      return;
    }

    const existing = grouped.get(ref.path);
    if (existing) {
      existing.locations.push(ref.location);
      existing.missingManifestEntry ||= missingManifestEntry;
      existing.missingArchivePayload ||= missingArchivePayload;
      return;
    }

    grouped.set(ref.path, {
      path: ref.path,
      kind: classifyArchiveRefPath(ref.path),
      layerId: ref.layer?.id,
      layerName: ref.layer?.name,
      layerType: ref.layer?.layerType,
      locations: [ref.location],
      missingManifestEntry,
      missingArchivePayload,
    });
  });

  const issues = Array.from(grouped.values());
  const missingCanonicalColorCycleRefs = issues.filter((issue) => issue.kind === 'canonical-color-cycle');
  const missingOptionalColorCycleRefs = issues.filter((issue) => issue.kind === 'optional-color-cycle');
  return {
    issues,
    missingCanonicalColorCycleRefs,
    missingOptionalColorCycleRefs,
    canRepairDanglingColorCycleRefs: missingCanonicalColorCycleRefs.length > 0,
  };
};

export const analyzeProjectArchiveRefs = async (
  projectData: ProjectFileData,
): Promise<ProjectArchiveRefAnalysis> => {
  const projectBytes = await toProjectDataBytes(projectData);
  let archiveZip: JSZip | null = null;
  let projectJson: string;

  if (projectBytes && isZipBytes(projectBytes)) {
    archiveZip = await JSZip.loadAsync(projectBytes);
    const projectEntry = archiveZip.file(PROJECT_ARCHIVE_ENTRY);
    const normalizedProjectEntry = Array.isArray(projectEntry) ? projectEntry[0] ?? null : projectEntry;
    if (!normalizedProjectEntry) {
      throw new Error('Project archive is missing project.json');
    }
    projectJson = utf8Decoder.decode(await normalizedProjectEntry.async('uint8array'));
  } else {
    projectJson = await decodeProjectData(projectData);
  }

  const vesselProject = parseVesselProjectJsonRaw(projectJson);
  const binaryPaths = new Set((vesselProject.binaries?.entries ?? []).map((entry) => entry.path));
  const payloadPaths = archiveZip
    ? new Set(Object.keys(archiveZip.files).filter((path) => !archiveZip!.files[path]?.dir))
    : undefined;
  return analyzeVesselProjectArchiveRefs(vesselProject, { binaryPaths, payloadPaths });
};

const summarizeSerializedLayerArchiveRefState = (
  layer: SerializedLayer | undefined,
): Record<string, unknown> | null => {
  if (!layer) {
    return null;
  }

  const state = layer.state && 'dimensions' in layer.state
    ? layer.state as SerializedColorCycleLayerStateV1
    : undefined;
  const brushSnapshot = getSerializedBrushSnapshotForLayer(
    layer.colorCycleData?.brushState as PersistedColorCycleBrushState | undefined,
    layer.id,
  );
  return {
    id: layer.id,
    name: layer.name,
    layerType: layer.layerType,
    state: state
      ? {
          hasContent: state.hasContent,
          paintSlot: state.paintSlot,
          strokeCounter: state.strokeCounter,
          paintRef: state.paintRef,
          gradientIdRef: state.gradientIdRef,
          gradientDefIdRef: state.gradientDefIdRef,
          speedRef: state.speedRef,
          flowRef: state.flowRef,
          phaseRef: state.phaseRef,
          gradientDefStoreCount: state.gradientDefStore?.length ?? 0,
          slotPaletteCount: state.slotPalettes?.length ?? 0,
        }
      : null,
    brushState: brushSnapshot
      ? {
          hasContent: brushSnapshot.strokeData?.hasContent,
          paintSlot: brushSnapshot.paintSlot,
          strokeCounter: brushSnapshot.strokeData?.strokeCounter,
          paintBuffer: brushSnapshot.strokeData?.paintBuffer,
          gradientIdBuffer: brushSnapshot.strokeData?.gradientIdBuffer,
          gradientDefIdBuffer: brushSnapshot.strokeData?.gradientDefIdBuffer,
          speedBuffer: brushSnapshot.strokeData?.speedBuffer,
          flowBuffer: brushSnapshot.strokeData?.flowBuffer,
          phaseBuffer: brushSnapshot.strokeData?.phaseBuffer,
        }
      : null,
  };
};

const assertSerializedArchiveRefsComplete = (
  vesselProject: VesselProject,
  archiveBinaryEntries: ArchiveBinaryEntry[],
): void => {
  const binaryPaths = new Set((vesselProject.binaries?.entries ?? []).map((entry) => entry.path));
  const payloadPaths = new Set(archiveBinaryEntries.map((entry) => entry.path));
  const analysis = analyzeVesselProjectArchiveRefs(vesselProject, { binaryPaths, payloadPaths });
  if (analysis.issues.length === 0) {
    return;
  }

  const first = analysis.issues[0];
  const layer = first.layerId
    ? vesselProject.project.layers.find((candidate) => candidate.id === first.layerId)
    : undefined;
  const colorCycleState = layer?.state && 'dimensions' in layer.state
    ? layer.state as SerializedColorCycleLayerStateV1
    : undefined;
  logCCMutation({
    event: 'project-save-dangling-archive-ref',
    layerId: first.layerId ?? 'unknown',
    reason: 'serializeProject',
    severity: 'error',
    before: layer?.layerType === 'color-cycle'
      ? summarizeSerializedColorCycleLayer({
          layerId: layer.id,
          hasContent: colorCycleState?.hasContent,
          gradientDefStoreCount: colorCycleState?.gradientDefStore?.length,
          slotPaletteCount: colorCycleState?.slotPalettes?.length,
        })
      : null,
    after: null,
    details: {
      firstIssue: first,
      issueCount: analysis.issues.length,
      issues: analysis.issues.slice(0, 12),
      manifestEntryCount: binaryPaths.size,
      payloadEntryCount: payloadPaths.size,
      archiveBinaryEntryCount: archiveBinaryEntries.length,
      serializedLayer: summarizeSerializedLayerArchiveRefState(layer),
    },
  });
  throw new Error(
    `Project save produced dangling archive ref ${first.path} at ${first.locations.join(', ')}`
  );
};

const buildSerializedColorCycleLayerState = (
  layer: SerializedLayer,
  fallbackWidth: number,
  fallbackHeight: number,
  stateSource?: SerializedColorCycleStateSource,
): SerializedColorCycleLayerStateV1 | undefined => {
  const colorCycleData = layer.colorCycleData;
  if (!colorCycleData) {
    return undefined;
  }

  const { width, height } = resolveColorCycleCanvasDimensions(
    {
      canvasImageData: undefined,
      canvasWidth: colorCycleData.canvasWidth,
      canvasHeight: colorCycleData.canvasHeight,
      canvas: null,
    },
    fallbackWidth,
    fallbackHeight,
  );
  const currentSnapshot = stateSource?.currentLayerSnapshot;

  return {
    version: 1,
    dimensions: { width, height },
    mode: stateSource?.mode,
    gradientDefs: stateSource?.gradientDefs,
    slotPalettes: stateSource?.slotPalettes,
    gradientDefStore: stateSource?.gradientDefStore,
    nextGradientDefId: stateSource?.nextGradientDefId,
    fgActiveSlot: stateSource?.fgActiveSlot,
    activeGradientId: stateSource?.activeGradientId,
    paintSlot: currentSnapshot?.paintSlot,
    layerBaseSpeedCps: stateSource?.layerBaseSpeedCps,
    brushSpeed: stateSource?.brushSpeed,
    controllerSpeedCps: stateSource?.controllerSpeedCps,
    flowMode: stateSource?.flowMode,
    paintRef: currentSnapshot?.strokeData?.paintBuffer,
    gradientIdRef: stateSource?.gradientIdRef,
    gradientDefIdRef: stateSource?.gradientDefIdRef,
    speedRef: currentSnapshot?.strokeData?.speedBuffer,
    flowRef: currentSnapshot?.strokeData?.flowBuffer,
    phaseRef: currentSnapshot?.strokeData?.phaseBuffer,
    hasContent: currentSnapshot?.strokeData?.hasContent,
    strokeCounter: currentSnapshot?.strokeData?.strokeCounter,
    dither: stateSource?.dither,
  };
};

const resolveColorCycleCanvasDimensions = (
  colorCycleData: {
    canvasImageData?: ImageData;
    canvasWidth?: number;
    canvasHeight?: number;
    canvas?: { width?: number; height?: number } | null;
  } | undefined,
  fallbackWidth: number,
  fallbackHeight: number,
): { width: number; height: number } => {
  const width =
    colorCycleData?.canvasImageData?.width ??
    colorCycleData?.canvas?.width ??
    colorCycleData?.canvasWidth ??
    fallbackWidth;
  const height =
    colorCycleData?.canvasImageData?.height ??
    colorCycleData?.canvas?.height ??
    colorCycleData?.canvasHeight ??
    fallbackHeight;

  return {
    width: Math.max(1, Math.floor(width || fallbackWidth || 1)),
    height: Math.max(1, Math.floor(height || fallbackHeight || 1)),
  };
};

const getSerializedBrushSnapshotForLayer = (
  brushState: PersistedColorCycleBrushState | undefined,
  layerId: string,
): PersistedColorCycleBrushState['layers'][number] | undefined => {
  if (!brushState?.layers?.length) {
    return undefined;
  }
  return brushState.layers.find((snapshot) => snapshot.layerId === layerId);
};

const buildColorCycleStateSource = (
  brushState: PersistedColorCycleBrushState | undefined,
  layerId: string,
): SerializedColorCycleStateSource => ({
  currentLayerSnapshot: getSerializedBrushSnapshotForLayer(brushState, layerId),
  dither: brushState
    ? {
        enabled: brushState.ditherEnabled,
        strength: brushState.ditherStrength,
        pixelSize: brushState.ditherPixelSize,
        perceptual: brushState.perceptualDither,
        stampShape: brushState.stampShape,
        stampDitherEnabled: brushState.stampDitherEnabled,
        stampDitherPixelSize: brushState.stampDitherPixelSize,
        stampDitherAlgorithm: brushState.stampDitherAlgorithm,
        stampDitherPatternStyle: brushState.stampDitherPatternStyle,
        stampDitherBgFill: brushState.stampDitherBgFill,
        stampDitherClears: brushState.stampDitherClears,
        stampDitherPressureLinked: brushState.stampDitherPressureLinked,
        pxlEdgeEnabled: brushState.pxlEdgeEnabled,
      }
    : undefined,
});

const applyColorCycleDocumentStateToSerializedSource = (
  source: SerializedColorCycleStateSource,
  documentState: ColorCyclePersistenceDocumentState,
): SerializedColorCycleStateSource => {
  const encodeBufferRef = (value: ArrayBuffer | string | undefined): string | undefined => {
    if (!value) {
      return undefined;
    }
    return typeof value === 'string' ? value : arrayBufferToBase64(value);
  };
  const shouldWriteSnapshot = Boolean(
    source.currentLayerSnapshot ||
    documentState.paintBuffer ||
    documentState.speedBuffer ||
    documentState.flowBuffer ||
    documentState.phaseBuffer,
  );
  const currentLayerSnapshot: SerializedBrushLayerSnapshot | undefined = shouldWriteSnapshot
    ? {
        ...(source.currentLayerSnapshot ?? { layerId: documentState.layerId }),
        layerId: documentState.layerId,
        canonicalPaint: true,
        schemaVersion: 1,
        dimensions: { width: documentState.width, height: documentState.height },
        strokeData: {
          ...(source.currentLayerSnapshot?.strokeData ?? {}),
          paintBuffer: encodeBufferRef(documentState.paintBuffer) ?? source.currentLayerSnapshot?.strokeData?.paintBuffer,
          speedBuffer: encodeBufferRef(documentState.speedBuffer) ?? source.currentLayerSnapshot?.strokeData?.speedBuffer,
          flowBuffer: encodeBufferRef(documentState.flowBuffer) ?? source.currentLayerSnapshot?.strokeData?.flowBuffer,
          phaseBuffer: encodeBufferRef(documentState.phaseBuffer) ?? source.currentLayerSnapshot?.strokeData?.phaseBuffer,
          hasContent: documentState.hasContent,
          strokeCounter: source.currentLayerSnapshot?.strokeData?.strokeCounter,
        },
        gradientDefs: documentState.gradientDefs ?? source.currentLayerSnapshot?.gradientDefs,
        slotPalettes: documentState.slotPalettes ?? source.currentLayerSnapshot?.slotPalettes,
        gradientDefStore: documentState.gradientDefStore ?? source.currentLayerSnapshot?.gradientDefStore,
        paintSlot: documentState.paintSlot ?? source.currentLayerSnapshot?.paintSlot,
        fgActiveSlot: documentState.fgActiveSlot ?? source.currentLayerSnapshot?.fgActiveSlot,
      }
    : undefined;

  return {
    ...source,
    gradientDefs: documentState.gradientDefs ?? source.gradientDefs,
    slotPalettes: documentState.slotPalettes ?? source.slotPalettes,
    gradientDefStore: documentState.gradientDefStore ?? source.gradientDefStore,
    fgActiveSlot: documentState.fgActiveSlot ?? source.fgActiveSlot,
    activeGradientId: documentState.activeGradientId ?? source.activeGradientId,
    layerBaseSpeedCps: documentState.layerBaseSpeedCps ?? source.layerBaseSpeedCps,
    flowMode: documentState.flowMode ?? source.flowMode,
    gradientIdRef: encodeBufferRef(documentState.gradientIdBuffer) ?? source.gradientIdRef,
    gradientDefIdRef: encodeBufferRef(documentState.gradientDefIdBuffer) ?? source.gradientDefIdRef,
    currentLayerSnapshot,
  };
};

const buildSerializedColorCycleCanonicalState = (
  colorCycleData: NonNullable<Layer['colorCycleData']>,
): Omit<SerializedColorCycleStateSource, 'currentLayerSnapshot' | 'dither'> => ({
  mode: colorCycleData.mode,
  gradientDefs: colorCycleData.gradientDefs
    ? colorCycleData.gradientDefs.map((entry) => ({
        id: entry.id,
        name: entry.name,
        currentSlot: entry.currentSlot,
      }))
    : undefined,
  slotPalettes: colorCycleData.slotPalettes
    ? colorCycleData.slotPalettes.map((entry) => ({
        slot: entry.slot,
        stops: entry.stops.map((stop) => ({ position: stop.position, color: stop.color })),
      }))
    : undefined,
  gradientDefStore: colorCycleData.gradientDefStore
    ? colorCycleData.gradientDefStore.map((entry) => ({
        id: entry.id,
        kind: entry.kind,
        stops: entry.stops.map((stop) => ({ position: stop.position, color: stop.color })),
        hash: entry.hash,
        source: entry.source,
        seamProfile: entry.seamProfile,
        createdAtMs: entry.createdAtMs,
        slot: entry.slot,
        speedCps: entry.speedCps,
      }))
    : undefined,
  nextGradientDefId: colorCycleData.nextGradientDefId,
  fgActiveSlot: colorCycleData.fgActiveSlot,
  activeGradientId: colorCycleData.activeGradientId,
  layerBaseSpeedCps: colorCycleData.layerBaseSpeedCps,
  brushSpeed: colorCycleData.brushSpeed,
  controllerSpeedCps: colorCycleData.controllerSpeedCps,
  flowMode: colorCycleData.flowMode,
  gradientIdRef: colorCycleData.gradientIdBuffer
    ? arrayBufferToBase64(colorCycleData.gradientIdBuffer)
    : undefined,
  gradientDefIdRef: colorCycleData.gradientDefIdBuffer
    ? arrayBufferToBase64(colorCycleData.gradientDefIdBuffer)
    : undefined,
});

const cloneSerializedGradientStops = (
  stops: Array<{ position: number; color: string }> | undefined,
): Array<{ position: number; color: string }> | undefined => (
  stops?.map((stop) => ({ position: stop.position, color: stop.color }))
);

const shouldPersistLegacyColorCycleGradient = (
  colorCycleData: Pick<
    NonNullable<Layer['colorCycleData']>,
    'slotPalettes' | 'gradientDefStore' | 'recolorSettings'
  >,
): boolean => {
  if (Array.isArray(colorCycleData.slotPalettes) && colorCycleData.slotPalettes.length > 0) {
    return false;
  }
  if (Array.isArray(colorCycleData.gradientDefStore) && colorCycleData.gradientDefStore.length > 0) {
    return false;
  }
  if (Array.isArray(colorCycleData.recolorSettings?.gradient) && colorCycleData.recolorSettings.gradient.length > 0) {
    return false;
  }
  return true;
};

const resolveSerializedColorCycleGradientFallback = (
  data: Pick<
    SerializedColorCycleLayerData,
    'gradient'
    | 'gradientDefs'
    | 'slotPalettes'
    | 'gradientDefStore'
    | 'activeGradientId'
    | 'fgActiveSlot'
    | 'recolorSettings'
  >,
): Array<{ position: number; color: string }> | undefined => {
  if (Array.isArray(data.gradient) && data.gradient.length > 0) {
    return cloneSerializedGradientStops(data.gradient);
  }

  const recolorGradient = data.recolorSettings?.gradient;
  if (Array.isArray(recolorGradient) && recolorGradient.length > 0) {
    return cloneSerializedGradientStops(recolorGradient);
  }

  const slotPalettes = data.slotPalettes ?? [];
  if (data.activeGradientId && Array.isArray(data.gradientDefs)) {
    const activeDef = data.gradientDefs.find((entry) => entry.id === data.activeGradientId);
    if (activeDef) {
      const matchingPalette = slotPalettes.find((entry) => entry.slot === activeDef.currentSlot);
      if (matchingPalette?.stops?.length) {
        return cloneSerializedGradientStops(matchingPalette.stops);
      }
    }
  }

  if (typeof data.fgActiveSlot === 'number') {
    const fgPalette = slotPalettes.find((entry) => entry.slot === data.fgActiveSlot);
    if (fgPalette?.stops?.length) {
      return cloneSerializedGradientStops(fgPalette.stops);
    }
  }

  if (slotPalettes[0]?.stops?.length) {
    return cloneSerializedGradientStops(slotPalettes[0].stops);
  }

  if (data.gradientDefStore?.[0]?.stops?.length) {
    return cloneSerializedGradientStops(data.gradientDefStore[0].stops);
  }

  return undefined;
};

const collectUsedDefIdsFromBase64Buffer = (base64: string | undefined): Set<number> => {
  const used = new Set<number>();
  if (!base64 || isArchiveBinaryRef(base64)) {
    return used;
  }
  const bytes = base64ToUint8Array(base64);
  if (!bytes || bytes.byteLength < Uint16Array.BYTES_PER_ELEMENT) {
    return used;
  }
  const view = new Uint16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / Uint16Array.BYTES_PER_ELEMENT));
  for (let i = 0; i < view.length; i += 1) {
    const id = view[i];
    if (id !== 0) {
      used.add(id);
    }
  }
  return used;
};

const serializedStrokeDataHasResolvableDefs = (
  strokeData: SerializedStrokeSnapshot | undefined,
  gradientDefStore: SerializedColorCycleLayerData['gradientDefStore'],
): boolean => {
  const usedDefIds = collectUsedDefIdsFromBase64Buffer(strokeData?.gradientDefIdBuffer);
  if (usedDefIds.size === 0) {
    return true;
  }
  const availableDefs = new Set((gradientDefStore ?? []).map((entry) => entry.id));
  for (const defId of usedDefIds) {
    if (!availableDefs.has(defId)) {
      return false;
    }
  }
  return true;
};

const isCompatibleColorCycleSnapshot = (
  snapshot: PersistedColorCycleBrushState['layers'][number] | undefined,
  width: number,
  height: number,
): boolean => {
  if (!snapshot) {
    return true;
  }

  const expectedPixels = width * height;
  const expectedDefBytes = expectedPixels * Uint16Array.BYTES_PER_ELEMENT;
  const strokeData = snapshot.strokeData;
  const animatorIndex = snapshot.animator?.indexBuffer;

  const matchesExpected = (base64Value: string | undefined, expectedBytes: number): boolean => {
    if (!base64Value) {
      return true;
    }
    const bytes = base64ToUint8Array(base64Value);
    return bytes !== undefined && bytes.byteLength === expectedBytes;
  };

  if (!matchesExpected(strokeData?.paintBuffer, expectedPixels)) {
    return false;
  }
  if (!matchesExpected(strokeData?.gradientIdBuffer, expectedPixels)) {
    return false;
  }
  if (!matchesExpected(strokeData?.speedBuffer, expectedPixels)) {
    return false;
  }
  if (!matchesExpected(strokeData?.flowBuffer, expectedPixels)) {
    return false;
  }
  if (!matchesExpected(strokeData?.phaseBuffer, expectedPixels)) {
    return false;
  }
  if (!matchesExpected(strokeData?.gradientDefIdBuffer, expectedDefBytes)) {
    return false;
  }

  if (animatorIndex) {
    if (animatorIndex.width !== width || animatorIndex.height !== height) {
      return false;
    }
    if (!matchesExpected(animatorIndex.data, expectedPixels)) {
      return false;
    }
    if (!matchesExpected(animatorIndex.gradientId, expectedPixels)) {
      return false;
    }
    if (!matchesExpected(animatorIndex.speedData, expectedPixels)) {
      return false;
    }
    if (!matchesExpected(animatorIndex.flowData, expectedPixels)) {
      return false;
    }
    if (!matchesExpected(animatorIndex.phaseData, expectedPixels)) {
      return false;
    }
  }

  return true;
};

const OVERSIZED_CC_BRUSH_STATE_BASE64_THRESHOLD = 32 * 1024 * 1024;
const DEFERRED_CC_RUNTIME_PAYLOAD_THRESHOLD = 8 * 1024 * 1024;

const estimateSerializedBrushStatePayloadSize = (
  brushState: PersistedColorCycleBrushState | undefined
): number => {
  const snapshots = brushState?.layers ?? [];
  let total = 0;
  for (const snapshot of snapshots) {
    total += snapshot.strokeData?.paintBuffer?.length ?? 0;
    total += snapshot.strokeData?.gradientIdBuffer?.length ?? 0;
    total += snapshot.strokeData?.gradientDefIdBuffer?.length ?? 0;
    total += snapshot.strokeData?.speedBuffer?.length ?? 0;
    total += snapshot.strokeData?.flowBuffer?.length ?? 0;
    total += snapshot.strokeData?.phaseBuffer?.length ?? 0;
    total += snapshot.animator?.indexBuffer.data?.length ?? 0;
    total += snapshot.animator?.indexBuffer.gradientId?.length ?? 0;
    total += snapshot.animator?.indexBuffer.speedData?.length ?? 0;
    total += snapshot.animator?.indexBuffer.flowData?.length ?? 0;
    total += snapshot.animator?.indexBuffer.phaseData?.length ?? 0;
  }
  return total;
};

const estimatePersistedColorCycleRuntimePayloadBytes = (
  layer: Layer,
): number => {
  const colorCycleData = layer.colorCycleData;
  if (!colorCycleData) {
    return 0;
  }
  let total = estimateSerializedBrushStatePayloadSize(colorCycleData.brushState as PersistedColorCycleBrushState | undefined);
  total += colorCycleData.gradientIdBuffer?.byteLength ?? 0;
  total += colorCycleData.gradientDefIdBuffer?.byteLength ?? 0;
  return total;
};

type RestoreColorCycleBrushesOptions = {
  lazy?: boolean;
  activeLayerId?: string | null;
};

type DeserializeProjectOptions = {
  lazyColorCycleRuntime?: boolean;
  activeLayerId?: string | null;
};

type LazyColorCycleArchiveRuntime = {
  archiveZip: JSZip;
  binaryManifest: ArchiveBinaryManifestIndex;
  cache: Map<string, string>;
  paintRef?: string;
  speedRef?: string;
  flowRef?: string;
  phaseRef?: string;
  gradientIdRef?: string;
  gradientDefIdRef?: string;
  brushState?: PersistedColorCycleBrushState;
};

const lazyColorCycleArchiveRuntimes = new WeakMap<Layer, LazyColorCycleArchiveRuntime>();
const lazyColorCycleArchiveRuntimesById = new Map<string, LazyColorCycleArchiveRuntime>();

const setLazyColorCycleArchiveRuntime = (
  layer: Layer,
  runtime: LazyColorCycleArchiveRuntime,
): void => {
  lazyColorCycleArchiveRuntimes.set(layer, runtime);
  lazyColorCycleArchiveRuntimesById.set(layer.id, runtime);
};

const getLazyColorCycleArchiveRuntime = (
  layer: Layer,
): LazyColorCycleArchiveRuntime | undefined => (
  lazyColorCycleArchiveRuntimes.get(layer) ?? lazyColorCycleArchiveRuntimesById.get(layer.id)
);

const getLazyColorCycleArchiveRuntimeByLayerId = (
  layerId: string,
): LazyColorCycleArchiveRuntime | undefined => lazyColorCycleArchiveRuntimesById.get(layerId);

const deleteLazyColorCycleArchiveRuntime = (layer: Layer): void => {
  lazyColorCycleArchiveRuntimes.delete(layer);
  lazyColorCycleArchiveRuntimesById.delete(layer.id);
};

const estimateColorCycleArchiveRuntimeBytes = (
  layer: SerializedLayer,
  binaryManifest: ArchiveBinaryManifestIndex,
): number => {
  if (normalizePersistedLayerType(layer.layerType) !== 'color-cycle') {
    return 0;
  }

  let total = 0;
  collectArchiveBinaryRefs(layer).forEach((path) => {
    const entry = binaryManifest.get(path);
    const isRuntimeBinary = path.startsWith(`buffers/color-cycle/${layer.id}/`)
      && !path.endsWith('canvas-image.txt')
      && !path.endsWith('erase-mask.txt')
      && !path.endsWith('recolor-original-image.txt');
    if (!isRuntimeBinary) {
      return;
    }
    total += entry?.logicalByteLength ?? entry?.byteLength ?? 0;
  });
  return total;
};

const shouldDeferSerializedColorCycleRuntimeHydration = (
  layer: SerializedLayer,
  binaryManifest: ArchiveBinaryManifestIndex,
  options?: DeserializeProjectOptions,
): boolean => (
  Boolean(options?.lazyColorCycleRuntime)
  && normalizePersistedLayerType(layer.layerType) === 'color-cycle'
  && layer.id !== options?.activeLayerId
  && estimateColorCycleArchiveRuntimeBytes(layer, binaryManifest) >= DEFERRED_CC_RUNTIME_PAYLOAD_THRESHOLD
);

const shouldDeferColorCycleRuntimeRestore = (
  layer: Layer,
  options?: RestoreColorCycleBrushesOptions,
): boolean => {
  if (!options?.lazy || layer.layerType !== 'color-cycle' || !layer.colorCycleData) {
    return false;
  }
  if (layer.id === options.activeLayerId) {
    return false;
  }
  if (layer.colorCycleData.isAnimating) {
    return false;
  }
  if (getLazyColorCycleArchiveRuntime(layer)) {
    return true;
  }
  // Persisted canvas/canvasImageData remain available for document rendering,
  // so heavy non-active CC runtimes can stay cold until selection/playback
  // actually needs the live brush runtime.
  return estimatePersistedColorCycleRuntimePayloadBytes(layer) >= DEFERRED_CC_RUNTIME_PAYLOAD_THRESHOLD;
};

const hydratePersistedBrushStateArchiveRefs = async (
  brushState: PersistedColorCycleBrushState | undefined,
  runtime: LazyColorCycleArchiveRuntime,
  layerId: string,
): Promise<PersistedColorCycleBrushState | undefined> => {
  if (!brushState?.layers?.length) {
    return brushState;
  }

  const hydratedLayers = await Promise.all(brushState.layers.map(async (snapshot) => {
    if (!snapshot.strokeData && !snapshot.animator?.indexBuffer) {
      return snapshot;
    }

    const strokeData = snapshot.strokeData
      ? {
          ...snapshot.strokeData,
          paintBuffer: await hydrateArchiveBinaryRef(snapshot.strokeData.paintBuffer, runtime.archiveZip, runtime.binaryManifest, runtime.cache),
          gradientIdBuffer: await hydrateArchiveBinaryRef(snapshot.strokeData.gradientIdBuffer, runtime.archiveZip, runtime.binaryManifest, runtime.cache),
          gradientDefIdBuffer: await hydrateArchiveBinaryRef(snapshot.strokeData.gradientDefIdBuffer, runtime.archiveZip, runtime.binaryManifest, runtime.cache),
          speedBuffer: await hydrateArchiveBinaryRef(snapshot.strokeData.speedBuffer, runtime.archiveZip, runtime.binaryManifest, runtime.cache),
          flowBuffer: await hydrateArchiveBinaryRef(snapshot.strokeData.flowBuffer, runtime.archiveZip, runtime.binaryManifest, runtime.cache),
          phaseBuffer: await hydrateArchiveBinaryRef(snapshot.strokeData.phaseBuffer, runtime.archiveZip, runtime.binaryManifest, runtime.cache),
        }
      : undefined;

    const animator = snapshot.animator?.indexBuffer
      ? {
          ...snapshot.animator,
          indexBuffer: {
            ...snapshot.animator.indexBuffer,
            data: await hydrateArchiveBinaryRef(snapshot.animator.indexBuffer.data, runtime.archiveZip, runtime.binaryManifest, runtime.cache),
            gradientId: await hydrateArchiveBinaryRef(snapshot.animator.indexBuffer.gradientId, runtime.archiveZip, runtime.binaryManifest, runtime.cache),
            speedData: await hydrateArchiveBinaryRef(snapshot.animator.indexBuffer.speedData, runtime.archiveZip, runtime.binaryManifest, runtime.cache),
            flowData: await hydrateArchiveBinaryRef(snapshot.animator.indexBuffer.flowData, runtime.archiveZip, runtime.binaryManifest, runtime.cache),
            phaseData: await hydrateArchiveBinaryRef(snapshot.animator.indexBuffer.phaseData, runtime.archiveZip, runtime.binaryManifest, runtime.cache),
          },
        }
      : snapshot.animator;

    return {
      ...snapshot,
      strokeData,
      animator,
    };
  }));

  const nextBrushState = {
    ...brushState,
    layers: hydratedLayers,
  };

  const targetSnapshot = nextBrushState.layers.find((snapshot) => snapshot.layerId === layerId);
  if (!targetSnapshot) {
    return nextBrushState;
  }

  const strokeData = targetSnapshot.strokeData ?? {};
  strokeData.paintBuffer ??= await hydrateArchiveBinaryRef(runtime.paintRef, runtime.archiveZip, runtime.binaryManifest, runtime.cache);
  strokeData.gradientIdBuffer ??= await hydrateArchiveBinaryRef(runtime.gradientIdRef, runtime.archiveZip, runtime.binaryManifest, runtime.cache);
  strokeData.gradientDefIdBuffer ??= await hydrateArchiveBinaryRef(runtime.gradientDefIdRef, runtime.archiveZip, runtime.binaryManifest, runtime.cache);
  strokeData.speedBuffer ??= await hydrateArchiveBinaryRef(runtime.speedRef, runtime.archiveZip, runtime.binaryManifest, runtime.cache);
  strokeData.flowBuffer ??= await hydrateArchiveBinaryRef(runtime.flowRef, runtime.archiveZip, runtime.binaryManifest, runtime.cache);
  strokeData.phaseBuffer ??= await hydrateArchiveBinaryRef(runtime.phaseRef, runtime.archiveZip, runtime.binaryManifest, runtime.cache);
  targetSnapshot.strokeData = strokeData;

  return nextBrushState;
};

const hydrateLazyColorCycleArchiveRuntime = async (layer: Layer): Promise<void> => {
  const runtime = getLazyColorCycleArchiveRuntime(layer);
  if (!runtime || !layer.colorCycleData) {
    return;
  }

  const [
    gradientIdBase64,
    gradientDefIdBase64,
    hydratedBrushState,
  ] = await Promise.all([
    hydrateArchiveBinaryRef(
      runtime.gradientIdRef,
      runtime.archiveZip,
      runtime.binaryManifest,
      runtime.cache,
    ),
    hydrateArchiveBinaryRef(
      runtime.gradientDefIdRef,
      runtime.archiveZip,
      runtime.binaryManifest,
      runtime.cache,
    ),
    hydratePersistedBrushStateArchiveRefs(runtime.brushState, runtime, layer.id),
  ]);

  const gradientIdBuffer = gradientIdBase64
    ? base64ToArrayBuffer(gradientIdBase64)
    : undefined;
  const gradientDefIdBuffer = gradientDefIdBase64
    ? base64ToArrayBuffer(gradientDefIdBase64)
    : undefined;

  layer.colorCycleData.gradientIdBuffer = gradientIdBuffer;
  layer.colorCycleData.gradientDefIdBuffer = gradientDefIdBuffer;
  if (hydratedBrushState) {
    layer.colorCycleData.brushState = hydratedBrushState;
    setSavedColorCycleBrushState(layer, hydratedBrushState);
  }
  deleteLazyColorCycleArchiveRuntime(layer);
};

const isPrimaryColorCyclePayloadFailure = (reason: string): boolean => (
  reason === 'missing-canonical-paint' ||
  reason === 'missing-gradient-bindings' ||
  reason === 'missing-motion-buffers' ||
  reason === 'missing-archive-ref'
);

type ColorCycleRepairStatusReason = NonNullable<NonNullable<Layer['colorCycleData']>['repairStatus']>['reason'];

const toRepairStatusReasonForPrimaryPayloadFailure = (reason: string): ColorCycleRepairStatusReason => {
  if (reason === 'missing-gradient-bindings' || reason === 'missing-motion-buffers') {
    return reason;
  }
  return 'missing-paint-buffer';
};

const applyLegacyColorCycleBrushSettingsFallback = (
  layers: Layer[],
  brushSpecificSettings: Record<string, Partial<BrushSettings>> | undefined,
): void => {
  const fallback = brushSpecificSettings?.['color-cycle-stroke'];
  if (!fallback) {
    return;
  }

  for (const layer of layers) {
    if (layer.layerType !== 'color-cycle' || !layer.colorCycleData) {
      continue;
    }

    const brushState = (
      layer.colorCycleData.brushState && typeof layer.colorCycleData.brushState === 'object'
        ? layer.colorCycleData.brushState
        : { layers: [] }
    ) as PersistedColorCycleBrushState;

    brushState.stampShape ??= fallback.colorCycleStampShape ?? fallback.ditherStrokeTipShape;
    brushState.stampDitherEnabled ??= fallback.colorCycleStampDitherEnabled;
    brushState.stampDitherPixelSize ??= fallback.colorCycleStampDitherPixelSize;
    brushState.stampDitherAlgorithm ??= fallback.ditherAlgorithm;
    brushState.stampDitherPatternStyle ??= fallback.patternStyle;
    brushState.stampDitherBgFill ??= fallback.colorCycleStampDitherBgFill;
    brushState.stampDitherClears ??= fallback.colorCycleStampDitherClears;
    brushState.stampDitherPressureLinked ??= fallback.colorCycleStampDitherPressureLinked;
    brushState.pxlEdgeEnabled ??= fallback.pxlEdge;

    layer.colorCycleData.brushState = brushState;
  }
};

const snapshotHasRichColorCycleMetadata = (
  snapshot: PersistedColorCycleBrushState['layers'][number] | undefined
): boolean => {
  if (!snapshot) {
    return false;
  }

  return Boolean(
    snapshot.slotPalettes?.length ||
    snapshot.gradientDefs?.length ||
    snapshot.gradientDefStore?.length ||
    snapshot.fgDerivedGradients?.length ||
    snapshot.derivedGradients?.length ||
    snapshot.activeGradientId ||
    typeof snapshot.paintSlot === 'number' ||
    Boolean(snapshot.legacyRemap) ||
    snapshot.fgDerivedKey ||
    typeof snapshot.fgActiveSlot === 'number' ||
    typeof snapshot.nextGradientDefId === 'number'
  );
};

const snapshotLooksLikeDuplicatedLegacyPayload = (
  snapshot: PersistedColorCycleBrushState['layers'][number] | undefined
): boolean => {
  if (!snapshot) {
    return false;
  }

  return Boolean(
    snapshot.strokeData?.paintBuffer &&
    snapshot.animator?.indexBuffer.data
  );
};


const resolveLayerImageDataForSave = (layer: Layer): ImageData | null => {
  const layerImageData = layer.imageData ?? null;
  const framebufferImageData = captureCanvasImageData(layer.framebuffer ?? null) ?? null;

  if (framebufferImageData) {
    const framebufferHasPixels = imageDataHasVisiblePixels(framebufferImageData);
    const layerHasPixels = imageDataHasVisiblePixels(layerImageData);

    if (framebufferHasPixels || !layerHasPixels) {
      return framebufferImageData;
    }
  }

  return layerImageData;
};

const resolveColorCycleCanvasImageDataForSave = async (
  layer: Layer
): Promise<ImageData | undefined> => {
  const colorCycleData = layer.colorCycleData;
  if (!colorCycleData) {
    return undefined;
  }

  const persistedCanvasImageData = colorCycleData.canvasImageData;
  const liveCanvasImageData = captureCanvasImageData(colorCycleData.canvas ?? null) ?? undefined;

  if (imageDataHasVisiblePixels(liveCanvasImageData)) {
    return liveCanvasImageData;
  }

  if (imageDataHasVisiblePixels(persistedCanvasImageData)) {
    return persistedCanvasImageData;
  }

  const brush = colorCycleData.colorCycleBrush as
    | { renderDirectToCanvas?: (canvas: HTMLCanvasElement, layerId: string) => void }
    | undefined;
  if (!brush?.renderDirectToCanvas || typeof document === 'undefined') {
    return undefined;
  }

  const { width, height } = resolveColorCycleCanvasDimensions(
    colorCycleData,
    layer.imageData?.width ?? (layer.framebuffer as { width?: number } | null)?.width ?? 1,
    layer.imageData?.height ?? (layer.framebuffer as { height?: number } | null)?.height ?? 1,
  );

  const renderCanvas = document.createElement('canvas');
  renderCanvas.width = Math.max(1, width);
  renderCanvas.height = Math.max(1, height);

  try {
    brush.renderDirectToCanvas(renderCanvas, layer.id);
  } catch (error) {
    debugWarn('raw-console', '[projectIO] Failed to render color cycle canvas for save:', error);
    return liveCanvasImageData ?? persistedCanvasImageData ?? undefined;
  }

  const renderedImageData = captureCanvasImageData(renderCanvas) ?? undefined;
  if (imageDataHasVisiblePixels(renderedImageData)) {
    return renderedImageData;
  }

  return liveCanvasImageData ?? persistedCanvasImageData ?? renderedImageData;
};

// Serialize a layer for saving
async function serializeLayer(layer: Layer): Promise<SerializedLayer> {
  let imageDataUrl = '';
  const imageDataForSave = resolveLayerImageDataForSave(layer);
  if (imageDataForSave) {
    try {
      imageDataUrl = await imageDataToDataUrl(imageDataForSave);
    } catch (error) {
      debugWarn('raw-console', '[projectIO] Failed to encode layer imageData, falling back to empty payload:', error);
    }
  }

  const serialized: SerializedLayer = {
    id: layer.id,
    name: layer.name,
    visible: layer.visible,
    opacity: layer.opacity,
    blendMode: layer.blendMode,
    locked: layer.locked,
    transparencyLocked: layer.transparencyLocked === true,
    order: layer.order,
    imageDataUrl,
    layerType: layer.layerType,
    alignment: cloneLayerAlignment(layer.alignment),
    groupId: layer.groupId,
  };

  if (layer.layerType === 'normal') {
    serialized.state = {
      version: 1,
      dimensions: {
        width: Math.max(1, imageDataForSave?.width ?? layer.framebuffer.width ?? 1),
        height: Math.max(1, imageDataForSave?.height ?? layer.framebuffer.height ?? 1),
      },
      imageRef: toArchiveBinaryRef(`buffers/raster/${layer.id}/image.json`),
    };
  }

  // Serialize color cycle data if present
  if (layer.layerType === 'color-cycle') {
    const sourceColorCycleData = layer.colorCycleData || {};
    const lazyRuntime = getLazyColorCycleArchiveRuntime(layer);
    const snapshot = captureColorCyclePersistenceSnapshot(layer, {
      projectWidth: layer.imageData?.width ?? (layer.framebuffer as { width?: number } | null)?.width ?? 1,
      projectHeight: layer.imageData?.height ?? (layer.framebuffer as { height?: number } | null)?.height ?? 1,
      requirePaint: sourceColorCycleData.mode !== 'recolor',
      mode: 'canonical-save',
      runtimeBrush: sourceColorCycleData.colorCycleBrush as { getFullState?: () => unknown; serialize?: () => unknown } | undefined,
      serializeRuntimeBrushState: (state, layerId) => (
        serializeBrushStateForCanonicalSave(state as ColorCycleBrushState, layerId) as PersistenceBrushState | undefined
      ),
      deferredRuntime: lazyRuntime
        ? {
            brushState: lazyRuntime.brushState as DeferredColorCycleArchiveRuntime['brushState'],
            paintRef: lazyRuntime.paintRef,
            speedRef: lazyRuntime.speedRef,
            flowRef: lazyRuntime.flowRef,
            phaseRef: lazyRuntime.phaseRef,
            gradientIdRef: lazyRuntime.gradientIdRef,
            gradientDefIdRef: lazyRuntime.gradientDefIdRef,
          }
        : undefined,
      diagnostics: (diagnostic) => {
        debugLog('raw-console', '[projectIO] color cycle persistence snapshot diagnostic', {
          layerId: layer.id,
          ...diagnostic,
        });
      },
    });
    const primaryPayloadFailure = !snapshot.ok && isPrimaryColorCyclePayloadFailure(snapshot.reason);
    const brushStateForSave =
      snapshot.ok
        ? snapshot.brushState as PersistedColorCycleBrushState
        : primaryPayloadFailure
          ? undefined
          : (sourceColorCycleData.brushState as PersistedColorCycleBrushState | undefined) ?? lazyRuntime?.brushState;
    let colorCycleStateSource: SerializedColorCycleStateSource = {
      ...buildSerializedColorCycleCanonicalState(sourceColorCycleData),
      ...buildColorCycleStateSource(
        brushStateForSave,
        layer.id,
      ),
    };
    if (primaryPayloadFailure) {
      colorCycleStateSource.gradientIdRef = undefined;
      colorCycleStateSource.gradientDefIdRef = undefined;
      colorCycleStateSource.currentLayerSnapshot = undefined;
    }
    if (lazyRuntime && !primaryPayloadFailure) {
      colorCycleStateSource = {
        ...colorCycleStateSource,
        gradientIdRef: colorCycleStateSource.gradientIdRef ?? lazyRuntime.gradientIdRef,
        gradientDefIdRef: colorCycleStateSource.gradientDefIdRef ?? lazyRuntime.gradientDefIdRef,
      };
    }
    if (snapshot.ok) {
      colorCycleStateSource = applyColorCycleDocumentStateToSerializedSource(
        colorCycleStateSource,
        snapshot.documentState,
      );
    } else {
      if (primaryPayloadFailure) {
        logCCMutation({
          event: 'cc-save-primary-payload-drop-blocked',
          layerId: layer.id,
          reason: 'serializeLayer',
          severity: 'error',
          before: summarizeColorCycleLayer(layer),
          after: summarizeColorCycleLayer(layer),
          details: {
            snapshotReason: snapshot.reason,
            damageKind: snapshot.damageKind ?? null,
            diagnostics: snapshot.diagnostics,
          },
        });
      }
      debugWarn('raw-console', '[projectIO] Skipping canonical color cycle document state during save:', {
        layerId: layer.id,
        reason: snapshot.reason,
        damageKind: snapshot.damageKind,
      });
    }
    const canvasImageData = await resolveColorCycleCanvasImageDataForSave(layer);
    const eraseMaskImageData = sourceColorCycleData.eraseMaskImageData ?? captureCanvasImageData(sourceColorCycleData.eraseMask ?? null);
    const softEdgeMaskImageData = sourceColorCycleData.softEdgeMaskImageData ?? captureCanvasImageData(sourceColorCycleData.softEdgeMask ?? null);
    const colorCycleData = {
      ...sourceColorCycleData,
      brushState: snapshot.ok ? snapshot.brushState : sourceColorCycleData.brushState,
      canvasImageData: canvasImageData ?? sourceColorCycleData.canvasImageData,
      eraseMaskImageData: eraseMaskImageData ?? sourceColorCycleData.eraseMaskImageData,
      softEdgeMaskImageData: softEdgeMaskImageData ?? sourceColorCycleData.softEdgeMaskImageData,
    };
    const serializedColorCycle: SerializedColorCycleLayerData = {
      gradient: shouldPersistLegacyColorCycleGradient(colorCycleData)
        ? cloneSerializedGradientStops(colorCycleData.gradient)
        : undefined,
    };

    if (colorCycleData.canvasImageData) {
      try {
        serializedColorCycle.canvasImageData = await imageDataToDataUrl(colorCycleData.canvasImageData);
      } catch (error) {
        debugWarn('raw-console', '[projectIO] Failed to serialize color cycle canvas image data:', error);
      }
    }

    if (colorCycleData.eraseMaskImageData) {
      try {
        serializedColorCycle.eraseMaskImageData = await imageDataToDataUrl(colorCycleData.eraseMaskImageData);
      } catch (error) {
        debugWarn('raw-console', '[projectIO] Failed to serialize color cycle erase mask:', error);
      }
    }

    if (typeof colorCycleData.eraseMaskVersion === 'number') {
      serializedColorCycle.eraseMaskVersion = colorCycleData.eraseMaskVersion;
    }

    if (colorCycleData.softEdgeMaskImageData) {
      try {
        serializedColorCycle.softEdgeMaskImageData = await imageDataToDataUrl(colorCycleData.softEdgeMaskImageData);
      } catch (error) {
        debugWarn('raw-console', '[projectIO] Failed to serialize color cycle soft edge mask:', error);
      }
    }

    if (typeof colorCycleData.softEdgeMaskVersion === 'number') {
      serializedColorCycle.softEdgeMaskVersion = colorCycleData.softEdgeMaskVersion;
    }

    if (typeof colorCycleData.softEdgeMaskEnabled === 'boolean') {
      serializedColorCycle.softEdgeMaskEnabled = colorCycleData.softEdgeMaskEnabled;
    }

    if (colorCycleData.repairStatus?.ok === false) {
      serializedColorCycle.repairStatus = {
        ok: false,
        reason: colorCycleData.repairStatus.reason,
        notes: colorCycleData.repairStatus.notes
          ? [...colorCycleData.repairStatus.notes]
          : undefined,
      };
    }

    if (colorCycleData.recolorSettings) {
      const recolor = colorCycleData.recolorSettings;
      const serializedRecolor: SerializedColorCycleRecolorSettings = {
        quantizationMode: recolor.quantizationMode,
        ditherMode: recolor.ditherMode,
        animation: { ...recolor.animation },
        cycleColors: recolor.cycleColors,
        gradient: recolor.gradient,
        mappingMode: recolor.mappingMode,
        flowMapping: recolor.flowMapping,
        directionAngle: recolor.directionAngle,
        bandWidthPx: recolor.bandWidthPx,
        currentLOD: recolor.currentLOD
      };

      if (recolor.indexBuffer) {
        serializedRecolor.indexBuffer = typedArrayToBase64(recolor.indexBuffer);
      }
      if (recolor.palette) {
        serializedRecolor.palette = Array.from(recolor.palette);
      }
      if (recolor.indexPhaseMap) {
        serializedRecolor.indexPhaseMap = typedArrayToBase64(recolor.indexPhaseMap);
      }
      if (recolor.phaseMap) {
        serializedRecolor.phaseMap = typedArrayToBase64(recolor.phaseMap);
      }
      if (recolor.colorMap) {
        serializedRecolor.colorMap = Array.from(recolor.colorMap.entries());
      }
      if (recolor.originalImageData) {
        try {
          serializedRecolor.originalImageData = await imageDataToDataUrl(recolor.originalImageData);
        } catch {
        }
      }

      serializedColorCycle.recolorSettings = serializedRecolor;
    }

    // Avoid duplicating the same raster payload in both layer.imageDataUrl and
    // colorCycleData snapshots when we already have restorable CC pixel state.
    const hasColorCyclePixelSnapshot = Boolean(serializedColorCycle.canvasImageData);
    const hasBrushSnapshotData = Boolean(colorCycleStateSource?.currentLayerSnapshot);
    if (hasColorCyclePixelSnapshot || hasBrushSnapshotData) {
      serialized.imageDataUrl = '';
    }

    serialized.colorCycleData = serializedColorCycle;
    serialized[COLOR_CYCLE_STATE_SOURCE] = colorCycleStateSource;
  }

  if (layer.layerType === 'sequential') {
    const sanitized = sanitizeSequentialLayerData(layer.sequentialData);
    const encoded = encodeSequentialEventsToChunks({
      layerId: layer.id,
      fps: sanitized.fps,
      frameCount: sanitized.frameCount,
      events: sanitized.events,
    });
    serialized.sequentialData = {
      ...sanitized,
      chunks: encoded.chunks,
      brushSnapshots: encoded.brushSnapshots,
    };
    serialized.state = {
      version: 1,
      frameCount: sanitized.frameCount,
      fps: sanitized.fps,
      durationMs: sanitized.durationMs,
      encoding: 'chunked-events-v1',
      chunksRef: toArchiveBinaryRef(`buffers/sequential/${layer.id}/chunks.json`),
      brushSnapshotsRef: encoded.brushSnapshots
        ? toArchiveBinaryRef(`buffers/sequential/${layer.id}/brush-snapshots.json`)
        : undefined,
    };
  }

  return serialized;
}

function serializeBrushStateForCanonicalSave(
  state: ColorCycleBrushState | undefined,
  layerId: string,
): PersistedColorCycleBrushState | undefined {
  if (!state) {
    return undefined;
  }

  const sourceLayer = (state.layers ?? []).find((layer) => layer.layerId === layerId);
  if (!sourceLayer) {
    return {
      canonicalPaint: true,
      schemaVersion: 1,
      ditherEnabled: state.ditherEnabled,
      ditherStrength: state.ditherStrength,
      ditherPixelSize: state.ditherPixelSize,
      perceptualDither: state.perceptualDither,
      stampShape: state.stampShape,
      stampDitherEnabled: state.stampDitherEnabled,
      stampDitherPixelSize: state.stampDitherPixelSize,
      stampDitherAlgorithm: state.stampDitherAlgorithm,
      stampDitherPatternStyle: state.stampDitherPatternStyle,
      stampDitherBgFill: state.stampDitherBgFill,
      stampDitherClears: state.stampDitherClears,
      stampDitherPressureLinked: state.stampDitherPressureLinked,
      pxlEdgeEnabled: state.pxlEdgeEnabled,
      layers: [],
    };
  }

  const layerWithPaletteMeta = sourceLayer as typeof sourceLayer & {
    paintSlot?: number;
  };

  return {
    canonicalPaint: true,
    schemaVersion: 1,
    ditherEnabled: state.ditherEnabled,
    ditherStrength: state.ditherStrength,
    ditherPixelSize: state.ditherPixelSize,
    perceptualDither: state.perceptualDither,
    stampShape: state.stampShape,
    stampDitherEnabled: state.stampDitherEnabled,
    stampDitherPixelSize: state.stampDitherPixelSize,
    stampDitherAlgorithm: state.stampDitherAlgorithm,
    stampDitherPatternStyle: state.stampDitherPatternStyle,
    stampDitherBgFill: state.stampDitherBgFill,
    stampDitherClears: state.stampDitherClears,
    stampDitherPressureLinked: state.stampDitherPressureLinked,
    pxlEdgeEnabled: state.pxlEdgeEnabled,
    layers: [{
      layerId: sourceLayer.layerId,
      canonicalPaint: true,
      schemaVersion: 1,
      paintSlot: layerWithPaletteMeta.paintSlot,
      activeGradientId: sourceLayer.activeGradientId,
      strokeData: sourceLayer.strokeData
        ? {
            hasContent: sourceLayer.strokeData.hasContent,
            strokeCounter: sourceLayer.strokeData.strokeCounter,
            paintBuffer: sourceLayer.strokeData.paintBuffer
              ? arrayBufferToBase64(sourceLayer.strokeData.paintBuffer)
              : undefined,
            gradientIdBuffer: sourceLayer.strokeData.gradientIdBuffer
              ? arrayBufferToBase64(sourceLayer.strokeData.gradientIdBuffer)
              : undefined,
            gradientDefIdBuffer: sourceLayer.strokeData.gradientDefIdBuffer
              ? arrayBufferToBase64(sourceLayer.strokeData.gradientDefIdBuffer)
              : undefined,
            speedBuffer: sourceLayer.strokeData.speedBuffer
              ? arrayBufferToBase64(sourceLayer.strokeData.speedBuffer)
              : undefined,
            flowBuffer: sourceLayer.strokeData.flowBuffer
              ? arrayBufferToBase64(sourceLayer.strokeData.flowBuffer)
              : undefined,
            phaseBuffer: sourceLayer.strokeData.phaseBuffer
              ? arrayBufferToBase64(sourceLayer.strokeData.phaseBuffer)
              : undefined,
          }
        : undefined,
    }],
  };
}

// Deserialize a layer from saved data
async function deserializeLayer(serializedLayer: SerializedLayer, projectWidth: number, projectHeight: number): Promise<Layer> {

  let imageData: ImageData | null = null;
  if (serializedLayer.imageDataUrl) {
    try {
      imageData = await dataUrlToImageData(serializedLayer.imageDataUrl);
    } catch {
    }
  } else {
  }

  // Create framebuffer with project dimensions
  const framebuffer = new OffscreenCanvas(projectWidth, projectHeight);

  const rawLayerType = serializedLayer.layerType === 'colorCycle'
    ? 'color-cycle'
    : serializedLayer.layerType;

  const layer: Layer = {
    id: serializedLayer.id,
    name: serializedLayer.name,
    visible: serializedLayer.visible,
    opacity: serializedLayer.opacity,
    blendMode: serializedLayer.blendMode as GlobalCompositeOperation,
    locked: serializedLayer.locked,
    transparencyLocked: serializedLayer.transparencyLocked === true,
    order: serializedLayer.order,
    imageData,
    framebuffer,
    alignment: cloneLayerAlignment(serializedLayer.alignment),
    groupId: serializedLayer.groupId,
    layerType: rawLayerType || (
      debugWarn('raw-console', '🟡 Layer missing layerType during load, defaulting to normal:', serializedLayer.id?.substring(0, 20)),
      'normal' as const
    ),
    version: Date.now()
  };

  if (layer.layerType === 'sequential') {
    layer.sequentialData = sanitizeSequentialLayerData(serializedLayer.sequentialData);
  }

  if (imageData) {
    try {
      const fbCtx = framebuffer.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings) as (CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null);
      fbCtx?.clearRect(0, 0, framebuffer.width, framebuffer.height);
      fbCtx?.putImageData(imageData, 0, 0);
    } catch (error) {
      debugWarn('raw-console', '[projectIO] Failed to hydrate layer framebuffer from image data during load:', error);
    }
  }

  // Restore color cycle data if present (including legacy files without layerType set)
  if (serializedLayer.colorCycleData) {
    // Create canvas for color cycle rendering
    const colorCycleCanvas = document.createElement('canvas');
    const serializedCanvasWidth = serializedLayer.colorCycleData.canvasWidth;
    const serializedCanvasHeight = serializedLayer.colorCycleData.canvasHeight;
    const canvasWidth = projectWidth;
    const canvasHeight = projectHeight;
    if (
      typeof serializedCanvasWidth === 'number' &&
      typeof serializedCanvasHeight === 'number' &&
      (serializedCanvasWidth !== projectWidth || serializedCanvasHeight !== projectHeight)
    ) {
      debugWarn('raw-console', '[projectIO] Coercing mismatched color cycle canvas dimensions to project size during load', {
        layerId: serializedLayer.id,
        serializedCanvasWidth,
        serializedCanvasHeight,
        projectWidth,
        projectHeight,
      });
    }
    colorCycleCanvas.width = Math.max(1, canvasWidth);
    colorCycleCanvas.height = Math.max(1, canvasHeight);

    const serializedBrushState = serializedLayer.colorCycleData.brushState;
    const serializedBrushSnapshot = getSerializedBrushSnapshotForLayer(
      serializedBrushState,
      serializedLayer.id,
    );
    const serializedStrokeData = serializedBrushSnapshot?.strokeData;
    const shouldPreferBrushSnapshotBuffers = Boolean(
      serializedStrokeData && !(
        estimateSerializedBrushStatePayloadSize(serializedBrushState) > OVERSIZED_CC_BRUSH_STATE_BASE64_THRESHOLD &&
        snapshotLooksLikeDuplicatedLegacyPayload(serializedBrushSnapshot) &&
        !snapshotHasRichColorCycleMetadata(serializedBrushSnapshot)
      ) &&
      serializedStrokeDataHasResolvableDefs(serializedStrokeData, serializedLayer.colorCycleData.gradientDefStore)
    );

    const baseColorCycleData: NonNullable<Layer['colorCycleData']> = {
      gradient: resolveSerializedColorCycleGradientFallback(serializedLayer.colorCycleData),
      gradientDefs: serializedLayer.colorCycleData.gradientDefs,
      slotPalettes: serializedLayer.colorCycleData.slotPalettes,
      fgActiveSlot: serializedLayer.colorCycleData.fgActiveSlot,
      fgDerivedKey: serializedLayer.colorCycleData.fgDerivedKey,
      fgDerivedGradients: (serializedLayer.colorCycleData.fgDerivedGradients ?? serializedLayer.colorCycleData.derivedGradients)
        ? (serializedLayer.colorCycleData.fgDerivedGradients ?? serializedLayer.colorCycleData.derivedGradients)?.map((entry) => ({
            key: entry.key,
            slot: entry.slot,
            spec: { ...entry.spec },
          }))
        : undefined,
      activeGradientId: serializedLayer.colorCycleData.activeGradientId,
      gradientIdBuffer: shouldPreferBrushSnapshotBuffers && serializedStrokeData?.gradientIdBuffer
        ? base64ToArrayBufferIfHydrated(serializedStrokeData.gradientIdBuffer)
        : serializedLayer.colorCycleData.gradientIdBuffer
          ? base64ToArrayBufferIfHydrated(serializedLayer.colorCycleData.gradientIdBuffer)
          : undefined,
      gradientDefIdBuffer: shouldPreferBrushSnapshotBuffers && serializedStrokeData?.gradientDefIdBuffer
        ? base64ToArrayBufferIfHydrated(serializedStrokeData.gradientDefIdBuffer)
        : serializedLayer.colorCycleData.gradientDefIdBuffer
          ? base64ToArrayBufferIfHydrated(serializedLayer.colorCycleData.gradientDefIdBuffer)
          : undefined,
      gradientDefStore: serializedLayer.colorCycleData.gradientDefStore
        ? serializedLayer.colorCycleData.gradientDefStore.map((entry) => ({
            id: entry.id,
            kind: entry.kind,
            stops: entry.stops.map((stop) => ({ position: stop.position, color: stop.color })),
            hash: entry.hash,
            source: entry.source,
            seamProfile: entry.seamProfile,
            createdAtMs: entry.createdAtMs,
            slot: entry.slot,
            speedCps: entry.speedCps,
          }))
        : undefined,
      nextGradientDefId: serializedLayer.colorCycleData.nextGradientDefId,
      // isAnimating is runtime-only; reset on load to avoid stuck playback state.
      isAnimating: false,
      mode: serializedLayer.colorCycleData.mode,
      brushSpeed: serializedLayer.colorCycleData.brushSpeed,
      controllerSpeedCps: serializedLayer.colorCycleData.controllerSpeedCps,
      layerBaseSpeedCps: serializedLayer.colorCycleData.layerBaseSpeedCps,
      flowMode: serializedLayer.colorCycleData.flowMode,
      brushState: serializedLayer.colorCycleData.brushState,
      repairStatus: serializedLayer.colorCycleData.repairStatus
        ? {
            ok: false,
            reason: serializedLayer.colorCycleData.repairStatus.reason,
            notes: serializedLayer.colorCycleData.repairStatus.notes
              ? [...serializedLayer.colorCycleData.repairStatus.notes]
              : undefined,
          }
        : undefined,
      canvas: colorCycleCanvas
      // Note: colorCycleBrush will be restored later when the layer is added to the project
    };

    if (serializedLayer.colorCycleData.recolorSettings) {
      try {
        baseColorCycleData.recolorSettings = await deserializeRecolorSettings(serializedLayer.colorCycleData.recolorSettings);
      } catch (error) {
        logError('[projectIO] Failed to restore color cycle recolor settings:', error);
      }
    }

    if (serializedLayer.colorCycleData.canvasImageData) {
      try {
        const imageData = await dataUrlToImageData(serializedLayer.colorCycleData.canvasImageData);
        baseColorCycleData.canvasImageData = imageData;
        const ctx = colorCycleCanvas.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings);
        ctx?.putImageData(imageData, 0, 0);
      } catch (error) {
        debugWarn('raw-console', '[projectIO] Failed to restore color cycle canvas image data:', error);
      }
    }

    if (serializedLayer.colorCycleData.eraseMaskImageData) {
      try {
        const eraseMaskData = await dataUrlToImageData(serializedLayer.colorCycleData.eraseMaskImageData);
        const maskCanvas = document.createElement('canvas');
        maskCanvas.width = eraseMaskData.width;
        maskCanvas.height = eraseMaskData.height;
        const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings);
        maskCtx?.putImageData(eraseMaskData, 0, 0);
        baseColorCycleData.eraseMask = maskCanvas;
        baseColorCycleData.eraseMaskImageData = eraseMaskData;
        baseColorCycleData.eraseMaskVersion = serializedLayer.colorCycleData.eraseMaskVersion ?? 0;
      } catch (error) {
        debugWarn('raw-console', '[projectIO] Failed to restore color cycle erase mask:', error);
      }
    }

    if (serializedLayer.colorCycleData.softEdgeMaskImageData) {
      try {
        const softEdgeMaskData = await dataUrlToImageData(serializedLayer.colorCycleData.softEdgeMaskImageData);
        const maskCanvas = document.createElement('canvas');
        maskCanvas.width = softEdgeMaskData.width;
        maskCanvas.height = softEdgeMaskData.height;
        const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings);
        maskCtx?.putImageData(softEdgeMaskData, 0, 0);
        baseColorCycleData.softEdgeMask = maskCanvas;
        baseColorCycleData.softEdgeMaskImageData = softEdgeMaskData;
        baseColorCycleData.softEdgeMaskEnabled = serializedLayer.colorCycleData.softEdgeMaskEnabled ?? true;
        baseColorCycleData.softEdgeMaskVersion = serializedLayer.colorCycleData.softEdgeMaskVersion ?? 0;
      } catch (error) {
        debugWarn('raw-console', '[projectIO] Failed to restore color cycle soft edge mask:', error);
      }
    }

    layer.layerType = 'color-cycle';
    layer.colorCycleData = baseColorCycleData;

    // Store WebGL state for later restoration
    if (serializedLayer.colorCycleData.webGLState) {
      setSavedColorCycleWebGLState(layer, serializedLayer.colorCycleData.webGLState);
    }

    if (serializedLayer.colorCycleData.brushState) {
      setSavedColorCycleBrushState(layer, serializedLayer.colorCycleData.brushState);
    }
  }

  return layer;
}

async function deserializeRecolorSettings(serialized: SerializedColorCycleRecolorSettings) {
  const settings: NonNullable<NonNullable<Layer['colorCycleData']>['recolorSettings']> = {
    quantizationMode: serialized.quantizationMode,
    ditherMode: serialized.ditherMode,
    animation: { ...serialized.animation },
    cycleColors: serialized.cycleColors,
    gradient: serialized.gradient,
    mappingMode: serialized.mappingMode,
    flowMapping: serialized.flowMapping,
    directionAngle: serialized.directionAngle,
    bandWidthPx: serialized.bandWidthPx,
    currentLOD: serialized.currentLOD ?? 'full'
  };

  const indexBuffer = base64ToUint8Array(serialized.indexBuffer);
  if (indexBuffer) {
    settings.indexBuffer = indexBuffer;
  }

  const palette = serialized.palette;
  if (palette && palette.length > 0) {
    settings.palette = new Uint32Array(palette);
  }

  const indexPhaseMap = base64ToUint8Array(serialized.indexPhaseMap);
  if (indexPhaseMap) {
    settings.indexPhaseMap = indexPhaseMap;
  }

  const phaseMap = base64ToUint8Array(serialized.phaseMap);
  if (phaseMap) {
    settings.phaseMap = phaseMap;
  }

  if (serialized.colorMap) {
    settings.colorMap = new Map(serialized.colorMap);
  }

  if (serialized.originalImageData) {
    try {
      settings.originalImageData = await dataUrlToImageData(serialized.originalImageData);
    } catch (error) {
      debugWarn('raw-console', '[projectIO] Failed to restore original recolor image data:', error);
    }
  }

  return settings;
}

// Serialize a custom brush for saving
async function serializeCustomBrush(brush: CustomBrush): Promise<SerializedCustomBrush> {
  const naturalWidth = brush.naturalWidth ?? brush.width;
  const naturalHeight = brush.naturalHeight ?? brush.height;
  const maxDimension = brush.maxDimension ?? Math.max(naturalWidth, naturalHeight);

  return {
    id: brush.id,
    name: brush.name,
    width: brush.width,
    height: brush.height,
    imageDataUrl: await imageDataToDataUrl(brush.imageData),
    thumbnail: brush.thumbnail,
    createdAt: brush.createdAt,
    naturalWidth,
    naturalHeight,
    maxDimension,
    colorCycle: serializeCustomBrushColorCycle(brush.colorCycle),
  };
}

// Deserialize a custom brush from saved data
async function deserializeCustomBrush(serializedBrush: SerializedCustomBrush): Promise<CustomBrush> {

  const imageData = await dataUrlToImageData(serializedBrush.imageDataUrl);

  const naturalWidth = serializedBrush.naturalWidth ?? serializedBrush.width;
  const naturalHeight = serializedBrush.naturalHeight ?? serializedBrush.height;
  const maxDimension = serializedBrush.maxDimension ?? Math.max(naturalWidth, naturalHeight);

  return {
    id: serializedBrush.id,
    name: serializedBrush.name,
    width: serializedBrush.width,
    height: serializedBrush.height,
    imageData,
    thumbnail: serializedBrush.thumbnail,
    createdAt: serializedBrush.createdAt,
    naturalWidth,
    naturalHeight,
    maxDimension,
    colorCycle: deserializeCustomBrushColorCycle(serializedBrush.colorCycle),
  };
}

// Generate thumbnail from project layers
export function generateProjectThumbnail(
  project: Project,
  layers: Layer[],
  maxSize: number = DEFAULT_PROJECT_THUMBNAIL_SIZE,
  mimeType: 'image/png' | 'image/webp' = 'image/png',
): string {
  const fullCanvas = document.createElement('canvas');
  fullCanvas.width = project.width;
  fullCanvas.height = project.height;
  const fullCtx = fullCanvas.getContext('2d', { colorSpace: 'srgb' });
  if (!fullCtx) return '';

  fullCtx.imageSmoothingEnabled = true;
  fullCtx.imageSmoothingQuality = 'high';

  fullCtx.fillStyle = project.backgroundColor;
  fullCtx.fillRect(0, 0, project.width, project.height);

  const sortedLayers = [...layers].sort((a, b) => a.order - b.order);
  for (const layer of sortedLayers) {
    if (!layer.visible) continue;

    fullCtx.globalAlpha = layer.opacity;
    fullCtx.globalCompositeOperation = layer.blendMode;

    const drawImageData = (imageData: ImageData) => {
      const layerCanvas = document.createElement('canvas');
      layerCanvas.width = imageData.width;
      layerCanvas.height = imageData.height;
      const layerCtx = layerCanvas.getContext('2d', { colorSpace: 'srgb' });
      if (layerCtx) {
        layerCtx.putImageData(imageData, 0, 0);
        fullCtx.drawImage(layerCanvas, 0, 0);
      }
    };

    if (layer.layerType !== 'color-cycle') {
      const resolvedImageData = resolveLayerImageDataForSave(layer);
      if (resolvedImageData) {
        drawImageData(resolvedImageData);
        continue;
      }
    }

    if (layer.layerType === 'color-cycle' && layer.colorCycleData) {
      const { colorCycleData } = layer;
      if (colorCycleData.canvasImageData) {
        drawImageData(colorCycleData.canvasImageData);
        continue;
      }

      if (colorCycleData.canvas) {
        fullCtx.drawImage(colorCycleData.canvas, 0, 0);
      }
    }
  }

  const shape = normalizeCanvasShape(project.canvasShape, project.width, project.height);
  applyCanvasShapeMask(fullCtx, shape);

  const thumbCanvas = document.createElement('canvas');
  const aspectRatio = project.width / project.height;

  if (aspectRatio > 1) {
    thumbCanvas.width = maxSize;
    thumbCanvas.height = Math.round(maxSize / aspectRatio);
  } else {
    thumbCanvas.width = Math.round(maxSize * aspectRatio);
    thumbCanvas.height = maxSize;
  }

  const thumbCtx = thumbCanvas.getContext('2d', { colorSpace: 'srgb' });
  if (!thumbCtx) return '';

  thumbCtx.imageSmoothingEnabled = true;
  thumbCtx.imageSmoothingQuality = 'high';
  thumbCtx.drawImage(
    fullCanvas,
    0,
    0,
    fullCanvas.width,
    fullCanvas.height,
    0,
    0,
    thumbCanvas.width,
    thumbCanvas.height
  );

  try {
    const encoded = thumbCanvas.toDataURL(mimeType, 0.8);
    if (mimeType === 'image/webp' && !encoded.startsWith('data:image/webp')) {
      try {
        return thumbCanvas.toDataURL('image/png', 0.8);
      } catch {
        return '';
      }
    }
    return encoded;
  } catch {
    try {
      return thumbCanvas.toDataURL('image/png', 0.8);
    } catch {
      return '';
    }
  }
}

const getThumbnailDimensions = (width: number, height: number, maxSize: number) => {
  const aspectRatio = width / height;
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) {
    return { width: maxSize, height: maxSize };
  }
  if (aspectRatio > 1) {
    return { width: maxSize, height: Math.round(maxSize / aspectRatio) };
  }
  return { width: Math.round(maxSize * aspectRatio), height: maxSize };
};

const byteCountForString = (value: string): number => utf8Encoder.encode(value).byteLength;

const byteCountForJson = (value: unknown): number => byteCountForString(JSON.stringify(value));

const normalizeLayerType = (value: SerializedLayer['layerType']): ProjectSizeReportLayer['layerType'] => {
  if (value === 'color-cycle' || value === 'colorCycle') {
    return 'color-cycle';
  }
  if (value === 'sequential') {
    return 'sequential';
  }
  if (value === 'normal') {
    return 'normal';
  }
  return 'unknown';
};

const MB = 1024 * 1024;

const layerHasColorCycleDuplicationRisk = (layer: SerializedLayer): boolean => {
  if (!layer.colorCycleData) {
    return false;
  }

  const state = layer.state && 'dimensions' in layer.state ? layer.state as SerializedColorCycleLayerStateV1 : undefined;
  const brushLayers = layer.colorCycleData.brushState?.layers ?? [];
  const hasSnapshotPrimaryBuffers = brushLayers.some((snapshot) => (
    Boolean(snapshot.strokeData?.paintBuffer)
    || Boolean(snapshot.strokeData?.gradientIdBuffer)
    || Boolean(snapshot.strokeData?.gradientDefIdBuffer)
  ));

  const stateOwnsPrimaryBuffers = Boolean(state?.paintRef || state?.gradientIdRef || state?.gradientDefIdRef);
  const legacyOwnsPrimaryBuffers = Boolean(layer.colorCycleData.gradientIdBuffer || layer.colorCycleData.gradientDefIdBuffer);

  return hasSnapshotPrimaryBuffers || (stateOwnsPrimaryBuffers && legacyOwnsPrimaryBuffers);
};

const layerHasUnresolvedColorCycleDefs = (layer: SerializedLayer): boolean => {
  if (!layer.colorCycleData) {
    return false;
  }

  const state = layer.state && 'dimensions' in layer.state ? layer.state as SerializedColorCycleLayerStateV1 : undefined;
  const gradientDefStore = state?.gradientDefStore ?? layer.colorCycleData.gradientDefStore;
  const snapshot = getSerializedBrushSnapshotForLayer(layer.colorCycleData.brushState, layer.id);
  return !serializedStrokeDataHasResolvableDefs(snapshot?.strokeData, gradientDefStore);
};

const buildProjectSizeRecommendations = (report: ProjectSaveSizeReport): string[] => {
  const recommendations: string[] = [];
  const findSection = (name: string) => report.sectionBreakdown.find((section) => section.name === name)?.bytes ?? 0;

  const layersBytes = findSection('layers');
  const customBrushesBytes = findSection('customBrushes');
  const previewImageBytes = findSection('previewImage');
  const binaryPayloadBytes = report.binaryPayloadBytes;
  const combinedBytes = Math.max(1, report.combinedManifestBytes);

  if (layersBytes / combinedBytes >= 0.65) {
    recommendations.push('Layers dominate file size. Merge/archive finished layers and remove hidden layers you no longer need.');
  }

  const largestLayer = report.largestLayers[0];
  if (largestLayer && largestLayer.dominantSection === 'imageDataUrl' && largestLayer.dominantSectionBytes >= 8 * MB) {
    recommendations.push('Largest layer is mostly bitmap pixels. Reduce canvas dimensions or split work into smaller files.');
  }
  if (largestLayer && largestLayer.dominantSection === 'colorCycleData' && largestLayer.dominantSectionBytes >= 8 * MB) {
    recommendations.push('Color-cycle data is heavy. Clear stale masks/snapshots or bake effects before saving a snapshot copy.');
  }
  if (largestLayer && largestLayer.dominantSection === 'sequentialData' && largestLayer.dominantSectionBytes >= 8 * MB) {
    recommendations.push('Sequential data is large. Trim event history/frame count before archiving.');
  }

  if (customBrushesBytes >= 16 * MB) {
    recommendations.push('Custom brush payload is large. Remove unused custom brushes or move them to a reusable preset pack.');
  }

  if (previewImageBytes >= 2 * MB) {
    recommendations.push('Embedded preview is large. Regenerating a smaller preview image can reduce save size.');
  }

  if (binaryPayloadBytes >= 32 * MB) {
    recommendations.push('Binary payload is heavy. Large raster or color-cycle buffers will still cost memory and playback time after load.');
  }

  if (report.colorCycleDuplicationRiskLayers.length > 0) {
    recommendations.push('Color-cycle duplication risk detected. Re-save with the current format or run repair before archival sharing.');
  }

  if ((report.staticPreviewColorCycleLayers ?? []).length > 0) {
    recommendations.push('Some color-cycle layers are static-preview only. Keep the original source archive if animated playback matters.');
  }

  if (report.unresolvedColorCycleDefLayers.length > 0) {
    recommendations.push('Color-cycle layers reference unresolved gradient defs. Repair these layers before relying on archival playback.');
  }

  if (report.compressionRatio >= 0.85) {
    recommendations.push('Archive compression is low; base64 image payloads are likely dominating. Prefer fewer/lower-resolution raster layers.');
  }

  if (recommendations.length === 0) {
    recommendations.push('File size is within expected bounds for current content. Keep layer count and bitmap dimensions in check as projects grow.');
  }

  return recommendations;
};

const buildProjectHealthWarnings = (report: ProjectSaveSizeReport): string[] => {
  const warnings: string[] = [];
  const largestLayer = report.largestLayers[0] ?? null;

  if (report.unresolvedColorCycleDefLayers.length > 0) {
    warnings.push('This project has unresolved color-cycle defs. Repair these layers before relying on playback or archival sharing.');
  }

  if (report.colorCycleDuplicationRiskLayers.length > 0) {
    warnings.push('This project contains legacy duplicated color-cycle state. Re-save or repair it before archival sharing.');
  }

  if ((report.staticPreviewColorCycleLayers ?? []).length > 0) {
    warnings.push('This project contains color-cycle layers with missing canonical paint. They will reopen as static previews, not healthy animated layers.');
  }

  if (report.binaryPayloadBytes >= 32 * MB) {
    warnings.push('This project has a very large binary payload. Non-active heavy runtimes will stay cold on load, and activating them may still take longer.');
  }

  if (
    largestLayer
    && largestLayer.layerType === 'color-cycle'
    && largestLayer.dominantSection === 'colorCycleData'
    && largestLayer.dominantSectionBytes >= 8 * MB
  ) {
    warnings.push('This project contains heavy color-cycle runtime data. Load will prefer active-layer hydration, but switching into large inactive layers may restore more slowly.');
  }

  return warnings;
};

const finalizeProjectHealthReport = (report: ProjectSaveSizeReport): ProjectHealthReport => {
  const warnings = buildProjectHealthWarnings(report);
  return {
    ...report,
    warnings,
    primaryWarning: warnings[0] ?? null,
  };
};

export const getProjectHealthWarning = (report: Pick<ProjectHealthReport, 'primaryWarning'> | null | undefined): string | null =>
  report?.primaryWarning ?? null;

const buildProjectSaveSizeReport = (
  vesselProject: VesselProject,
  previewManifest: VesselProjectPreview,
  projectJson: string,
  previewJson: string,
  archiveBytes: number,
): ProjectHealthReport => {
  const binaryPayloadBytes = (vesselProject.binaries?.entries ?? []).reduce(
    (total, entry) => total + entry.byteLength,
    0,
  );
  const projectEnvelopeBytes = byteCountForJson({
    ...vesselProject,
    project: {
      ...vesselProject.project,
      layers: [],
      customBrushes: [],
    },
  });

  const layerRows = vesselProject.project.layers.map((layer) => {
    const layerBytes = byteCountForJson(layer);
    const sectionCandidates: ProjectSizeReportSection[] = [
      { name: 'imageDataUrl', bytes: layer.imageDataUrl ? byteCountForString(layer.imageDataUrl) : 0 },
      { name: 'colorCycleData', bytes: layer.colorCycleData ? byteCountForJson(layer.colorCycleData) : 0 },
      { name: 'sequentialData', bytes: layer.sequentialData ? byteCountForJson(layer.sequentialData) : 0 },
    ];
    const dominant = sectionCandidates.reduce((best, candidate) => (
      candidate.bytes > best.bytes ? candidate : best
    ), { name: 'layerMetadata', bytes: 0 });

    return {
      layer: {
        layerId: layer.id,
        layerName: layer.name,
        layerType: normalizeLayerType(layer.layerType),
        bytes: layerBytes,
        dominantSection: dominant.name,
        dominantSectionBytes: dominant.bytes,
      } satisfies ProjectSizeReportLayer,
      bytes: layerBytes,
    };
  });
  const colorCycleDuplicationRiskLayers = vesselProject.project.layers
    .filter((layer) => layerHasColorCycleDuplicationRisk(layer))
    .map((layer) => layer.id);
  const unresolvedColorCycleDefLayers = vesselProject.project.layers
    .filter((layer) => layerHasUnresolvedColorCycleDefs(layer))
    .map((layer) => layer.id);
  const staticPreviewColorCycleLayers = vesselProject.project.layers
    .filter((layer) => layer.colorCycleData?.repairStatus?.ok === false)
    .map((layer) => layer.id);

  const layersBytes = layerRows.reduce((total, row) => total + row.bytes, 0);
  const customBrushesBytes = vesselProject.project.customBrushes.reduce((total, brush) => total + byteCountForJson(brush), 0);
  const previewImageBytes = previewManifest.preview?.dataUrl ? byteCountForString(previewManifest.preview.dataUrl) : 0;
  const projectManifestBytes = byteCountForString(projectJson);
  const previewManifestBytes = byteCountForString(previewJson);
  const combinedManifestBytes = projectManifestBytes + previewManifestBytes;

  const report: ProjectSaveSizeReport = {
    projectManifestBytes,
    previewManifestBytes,
    combinedManifestBytes,
    archiveBytes,
    compressionRatio: archiveBytes / Math.max(1, combinedManifestBytes),
    binaryPayloadBytes,
    colorCycleDuplicationRiskLayers,
    unresolvedColorCycleDefLayers,
    staticPreviewColorCycleLayers,
    sectionBreakdown: [
      { name: 'projectEnvelope', bytes: projectEnvelopeBytes },
      { name: 'layers', bytes: layersBytes },
      { name: 'customBrushes', bytes: customBrushesBytes },
      { name: 'previewImage', bytes: previewImageBytes },
      { name: 'binaryPayload', bytes: binaryPayloadBytes },
    ].sort((a, b) => b.bytes - a.bytes),
    largestLayers: layerRows
      .map((row) => row.layer)
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 5),
    recommendations: [],
  };
  report.recommendations = buildProjectSizeRecommendations(report);
  return finalizeProjectHealthReport(report);
};

type SerializedProjectArtifacts = {
  archiveData: Uint8Array;
  projectJson: string;
  previewJson: string;
  report: ProjectHealthReport;
};

const buildSerializedProjectArtifacts = async (
  project: Project,
  layers?: Layer[],
): Promise<SerializedProjectArtifacts> => {
  // Use the passed layers parameter, falling back to project.layers if not provided
  const layersToSerialize = layers || project.layers || [];
  const serializedLayers = await Promise.all(layersToSerialize.map((layer) => serializeLayer(layer)));
  const serializedCustomBrushes = await Promise.all(project.customBrushes.map((brush) => serializeCustomBrush(brush)));

  let previewThumbnail = '';
  let previewEncoding: 'image/png' | 'image/webp' = 'image/png';
  if (layers) {
    previewThumbnail = generateProjectThumbnail(
      project,
      layers,
      DEFAULT_PROJECT_PREVIEW_THUMBNAIL_SIZE,
      'image/webp',
    );
    previewEncoding = previewThumbnail.startsWith('data:image/webp') ? 'image/webp' : 'image/png';
  }

  const vesselProject: VesselProject = {
    version: PROJECT_VERSION,
    manifestVersion: PROJECT_ARCHIVE_MANIFEST_VERSION,
    metadata: {
      name: project.name,
      created: project.createdAt.toISOString(),
      modified: new Date().toISOString(),
      appVersion: '1.0.0', // Could be pulled from package.json
    },
    project: {
      id: project.id,
      name: project.name,
      width: project.width,
      height: project.height,
      backgroundColor: project.backgroundColor,
      layers: serializedLayers,
      layerGroups: project.layerGroups,
      customBrushes: serializedCustomBrushes,
      defaultCustomBrushId: project.defaultCustomBrushId ?? null,
      brushSpecificSettings: project.brushSpecificSettings,
      globalBrushSize: project.globalBrushSize,
      referenceLayerId: project.referenceLayerId ?? null,
      exportLayout: cloneExportLayout(project.exportLayout),
      palette: normalizePalette(project.palette),
      canvasShape: project.canvasShape,
      viewState: project.viewState
        ? {
            zoom: project.viewState.zoom,
            displayFilters: cloneDisplayFilters(project.viewState.displayFilters),
          }
        : undefined,
    },
  };

  const previewManifest: VesselProjectPreview = {
    version: PROJECT_VERSION,
    manifestVersion: 2,
    metadata: vesselProject.metadata,
    project: {
      id: vesselProject.project.id,
      name: vesselProject.project.name,
      width: vesselProject.project.width,
      height: vesselProject.project.height,
    },
    preview: previewThumbnail
      ? {
          dataUrl: previewThumbnail,
          ...getThumbnailDimensions(project.width, project.height, DEFAULT_PROJECT_PREVIEW_THUMBNAIL_SIZE),
          encoding: previewEncoding,
        }
      : undefined,
  };

  const archiveBinaryEntries: ArchiveBinaryEntry[] = [];
  for (const layer of vesselProject.project.layers) {
    collectLayerArchiveBinaryEntries(layer, archiveBinaryEntries, project.width, project.height);
    await copyDeferredArchiveBinaryRefs(layer, archiveBinaryEntries);
  }
  vesselProject.binaries = {
    entries: buildArchiveBinaryManifest(archiveBinaryEntries),
  };
  assertSerializedArchiveRefsComplete(vesselProject, archiveBinaryEntries);

  const projectJson = JSON.stringify(vesselProject);
  const previewJson = JSON.stringify(previewManifest);
  const zip = new JSZip();
  zip.file(PROJECT_ARCHIVE_ENTRY, projectJson);
  zip.file(PROJECT_PREVIEW_ARCHIVE_ENTRY, previewJson);
  archiveBinaryEntries.forEach((entry) => {
    zip.file(entry.path, entry.data ?? entry.bytes);
  });

  const archiveData = await zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });

  const report = buildProjectSaveSizeReport(
    vesselProject,
    previewManifest,
    projectJson,
    previewJson,
    archiveData.byteLength,
  );

  return {
    archiveData,
    projectJson,
    previewJson,
    report,
  };
};

export async function getProjectSaveSizeReport(project: Project, layers?: Layer[]): Promise<ProjectHealthReport> {
  const artifacts = await buildSerializedProjectArtifacts(project, layers);
  return artifacts.report;
}

export async function getProjectHealthReport(project: Project, layers?: Layer[]): Promise<ProjectHealthReport> {
  return getProjectSaveSizeReport(project, layers);
}

// Serialize a project for saving
export async function serializeProject(project: Project, layers?: Layer[]): Promise<Uint8Array> {
  const artifacts = await buildSerializedProjectArtifacts(project, layers);
  return artifacts.archiveData;
}

const isSafeIntegerInRange = (value: unknown, min: number, max: number): value is number => {
  return typeof value === 'number'
    && Number.isFinite(value)
    && Number.isInteger(value)
    && value >= min
    && value <= max;
};

const VALID_BINARY_MANIFEST_DTYPES = new Set(['uint8', 'uint16', 'rgba8', 'json', 'unknown']);
const VALID_BINARY_MANIFEST_COMPRESSIONS = new Set(['deflate', 'stored']);
const BINARY_MANIFEST_CHECKSUM_PATTERN = /^[0-9a-f]{8}$/i;

const validateProjectDimensions = (width: unknown, height: unknown, label: string): void => {
  if (!isSafeIntegerInRange(width, 1, MAX_PROJECT_DIMENSION) || !isSafeIntegerInRange(height, 1, MAX_PROJECT_DIMENSION)) {
    throw new Error(`Invalid ${label}`);
  }
  const safeWidth = width;
  const safeHeight = height;
  if (safeWidth * safeHeight > MAX_PROJECT_PIXELS) {
    throw new Error(`Invalid ${label}`);
  }
};

const validateBinaryManifestEntry = (entry: BinaryManifestEntry): void => {
  if (
    !entry
    || typeof entry.path !== 'string'
    || !entry.path
    || typeof entry.checksum !== 'string'
    || !BINARY_MANIFEST_CHECKSUM_PATTERN.test(entry.checksum)
    || !isSafeIntegerInRange(entry.byteLength, 0, MAX_PROJECT_ARCHIVE_BYTES)
    || entry.version !== 1
    || !VALID_BINARY_MANIFEST_DTYPES.has(entry.dtype)
    || !VALID_BINARY_MANIFEST_COMPRESSIONS.has(entry.compression)
  ) {
    throw new Error('Invalid Vessel project binary manifest');
  }

  if (entry.width !== undefined || entry.height !== undefined) {
    validateProjectDimensions(entry.width, entry.height, 'binary manifest dimensions');
  }

  if (entry.logicalByteLength !== undefined && !isSafeIntegerInRange(entry.logicalByteLength, entry.byteLength, MAX_PROJECT_ARCHIVE_BYTES)) {
    throw new Error('Invalid Vessel project binary manifest');
  }

  if (entry.encoding !== undefined && entry.encoding !== 'raw' && entry.encoding !== 'sparse-rect-v1') {
    throw new Error('Invalid Vessel project binary manifest');
  }

  if (entry.encoding === 'sparse-rect-v1') {
    if (!entry.crop || entry.width === undefined || entry.height === undefined) {
      throw new Error('Invalid Vessel project binary manifest');
    }
    const expectedLogicalByteLength = entry.width * entry.height * getBytesPerColorCyclePixel(entry.path);
    if (entry.logicalByteLength !== expectedLogicalByteLength) {
      throw new Error('Invalid Vessel project binary manifest');
    }
    const { x, y, width, height } = entry.crop;
    if (
      !isSafeIntegerInRange(x, 0, entry.width - 1)
      || !isSafeIntegerInRange(y, 0, entry.height - 1)
      || !isSafeIntegerInRange(width, 1, entry.width)
      || !isSafeIntegerInRange(height, 1, entry.height)
      || x + width > entry.width
      || y + height > entry.height
    ) {
      throw new Error('Invalid Vessel project binary manifest');
    }
  } else if (entry.crop) {
    throw new Error('Invalid Vessel project binary manifest');
  }
};

const validateLayerEnvelope = (layer: SerializedLayer, binaryPaths: Set<string>): void => {
  if (!layer || typeof layer !== 'object' || typeof layer.id !== 'string' || !layer.id) {
    throw new Error('Invalid Vessel project layer');
  }

  const normalizedLayerType = normalizePersistedLayerType(layer.layerType);
  const isImplicitLegacyColorCycle = layer.layerType === undefined && Boolean(layer.colorCycleData) && !layer.sequentialData;
  const isImplicitLegacySequential = layer.layerType === undefined && Boolean(layer.sequentialData) && !layer.colorCycleData;
  if (normalizedLayerType === 'color-cycle') {
    if (!layer.colorCycleData || layer.sequentialData) {
      throw new Error(`Invalid Vessel project layer envelope for ${layer.id}`);
    }
    if (layer.state && !('dimensions' in layer.state)) {
      throw new Error(`Invalid Vessel project layer state for ${layer.id}`);
    }
  } else if (normalizedLayerType === 'sequential') {
    if (!layer.sequentialData || layer.colorCycleData) {
      if (!layer.state || !('chunksRef' in layer.state) || layer.colorCycleData) {
        throw new Error(`Invalid Vessel project layer envelope for ${layer.id}`);
      }
    }
  } else if (!isImplicitLegacyColorCycle && !isImplicitLegacySequential && (layer.colorCycleData || layer.sequentialData)) {
    throw new Error(`Invalid Vessel project layer envelope for ${layer.id}`);
  }

  if (normalizedLayerType === 'normal' && layer.state) {
    if (!('imageRef' in layer.state)) {
      throw new Error(`Invalid Vessel project layer state for ${layer.id}`);
    }
    validateProjectDimensions(layer.state.dimensions.width, layer.state.dimensions.height, 'raster layer dimensions');
    if (layer.imageDataUrl) {
      throw new Error(`Dual-authority raster layer payload detected for ${layer.id}`);
    }
  }

  if (normalizedLayerType === 'sequential' && layer.state && 'chunksRef' in layer.state) {
    if (layer.sequentialData) {
      throw new Error(`Dual-authority sequential layer payload detected for ${layer.id}`);
    }
    if (layer.state.encoding !== 'chunked-events-v1') {
      throw new Error(`Invalid Vessel project sequential state for ${layer.id}`);
    }
  }

  if (normalizedLayerType === 'color-cycle' && layer.state && 'dimensions' in layer.state) {
    const colorCycleState = layer.state as SerializedColorCycleLayerStateV1;
    validateProjectDimensions(layer.state.dimensions.width, layer.state.dimensions.height, 'color-cycle layer dimensions');
    validateStrictColorCyclePersistedSurface(layer.id, colorCycleState, layer.colorCycleData);
  }

  const archiveRefs = collectArchiveBinaryRefs(layer);
  archiveRefs.forEach((path) => {
    if (!binaryPaths.has(path)) {
      throw new Error(`Project archive manifest is missing binary entry ${path}`);
    }
  });
};

const validateSerializedProjectEnvelope = (vesselProject: VesselProject): void => {
  const archive = vesselProject as VesselProjectArchive;
  const serializedProject = vesselProject.project;
  validateProjectDimensions(serializedProject.width, serializedProject.height, 'project dimensions');

  if (!Array.isArray(serializedProject.layers)) {
    throw new Error('Invalid Vessel project file');
  }
  if (serializedProject.layers.length > MAX_PROJECT_LAYERS) {
    throw new Error('Project has too many layers');
  }

  if (!Array.isArray(serializedProject.customBrushes)) {
    throw new Error('Invalid Vessel project file');
  }
  if (serializedProject.customBrushes.length > MAX_PROJECT_CUSTOM_BRUSHES) {
    throw new Error('Project has too many custom brushes');
  }

  const binaryEntries = archive.binaries?.entries ?? [];
  if (archive.binaries && !Array.isArray(binaryEntries)) {
    throw new Error('Invalid Vessel project binary manifest');
  }
  const binaryPaths = new Set<string>();
  binaryEntries.forEach((entry) => {
    validateBinaryManifestEntry(entry);
    if (binaryPaths.has(entry.path)) {
      throw new Error(`Duplicate project binary manifest entry ${entry.path}`);
    }
    binaryPaths.add(entry.path);
  });

  serializedProject.layers.forEach((layer) => validateLayerEnvelope(layer, binaryPaths));
};

const parseVesselProjectJsonRaw = (json: string): VesselProject => {
  let sanitized = json;
  if (sanitized.length > 0 && sanitized.charCodeAt(0) === 0xfeff) {
    sanitized = sanitized.slice(1);
  }
  sanitized = sanitized.trimStart();
  const NULL_CHAR = '\0';
  if (sanitized.includes(NULL_CHAR)) {
    sanitized = sanitized.split(NULL_CHAR).join('');
  }

  let vesselProject: VesselProject;

  try {
    vesselProject = JSON.parse(sanitized) as VesselProject;
  } catch (error) {
    const preview = sanitized.slice(0, 80);
    const charCodes = Array.from(preview).map((ch) => ch.charCodeAt(0));
    logError('[projectIO] Failed to parse project manifest', { error, preview, charCodes });
    throw new Error('Invalid project file format');
  }

  if (!vesselProject.version || !vesselProject.project) {
    throw new Error('Invalid Vessel project file');
  }

  return vesselProject;
};

const buildRepairedArchiveBinaryManifest = async (
  vesselProject: VesselProject,
  archiveZip: JSZip,
): Promise<PersistedProjectBinaryManifest | undefined> => {
  const binaryEntries = vesselProject.binaries?.entries ?? [];
  const knownPaths = new Set<string>();
  binaryEntries.forEach((entry) => {
    validateBinaryManifestEntry(entry);
    if (knownPaths.has(entry.path)) {
      throw new Error(`Duplicate project binary manifest entry ${entry.path}`);
    }
    knownPaths.add(entry.path);
  });

  const repairedEntries = [...binaryEntries];
  let didRepair = false;
  for (const path of collectArchiveBinaryRefs(vesselProject.project.layers)) {
    if (knownPaths.has(path)) {
      continue;
    }
    const entry = archiveZip.file(path);
    const normalizedEntry = Array.isArray(entry) ? entry[0] ?? null : entry;
    if (!normalizedEntry) {
      continue;
    }
    const bytes = await normalizedEntry.async('uint8array');
    repairedEntries.push({
      version: 1,
      path,
      checksum: fnv1aHash(bytes),
      byteLength: bytes.byteLength,
      dtype: inferBinaryManifestDType(path),
      compression: 'deflate',
    });
    knownPaths.add(path);
    didRepair = true;
  }

  return didRepair ? { entries: repairedEntries } : vesselProject.binaries;
};

const OPTIONAL_COLOR_CYCLE_ARCHIVE_SUFFIXES = [
  'canvas-image.txt',
  'erase-mask.txt',
  'recolor-index.bin',
  'recolor-index-phase.bin',
  'recolor-phase.bin',
  'recolor-original-image.txt',
  'animator-index.bin',
  'animator-gradient-id.bin',
  'animator-speed.bin',
  'animator-flow.bin',
  'animator-phase.bin',
] as const;

const isOptionalColorCycleArchivePath = (path: string): boolean => (
  path.startsWith('buffers/color-cycle/')
  && OPTIONAL_COLOR_CYCLE_ARCHIVE_SUFFIXES.some((suffix) => path.endsWith(suffix))
);

const removeDanglingColorCycleArchiveRefs = (
  layer: SerializedLayer,
  missingPaths: Set<string>,
): void => {
  if (normalizePersistedLayerType(layer.layerType) !== 'color-cycle' || missingPaths.size === 0) {
    return;
  }

  const isMissingRef = (value: unknown): value is string => (
    typeof value === 'string'
    && isPersistedArchiveBinaryRef(value)
    && missingPaths.has(value.slice(ARCHIVE_BINARY_REF_PREFIX.length))
  );

  if (layer.state && 'dimensions' in layer.state) {
    const colorCycleState = layer.state as SerializedColorCycleLayerStateV1;
    if (isMissingRef(colorCycleState.paintRef)) {
      colorCycleState.paintRef = undefined;
    }
    if (isMissingRef(colorCycleState.speedRef)) {
      colorCycleState.speedRef = undefined;
    }
    if (isMissingRef(colorCycleState.flowRef)) {
      colorCycleState.flowRef = undefined;
    }
    if (isMissingRef(colorCycleState.phaseRef)) {
      colorCycleState.phaseRef = undefined;
    }
    if (isMissingRef(colorCycleState.gradientIdRef)) {
      colorCycleState.gradientIdRef = undefined;
    }
    if (isMissingRef(colorCycleState.gradientDefIdRef)) {
      colorCycleState.gradientDefIdRef = undefined;
    }
  }

  const colorCycleData = layer.colorCycleData;
  if (!colorCycleData) {
    return;
  }

  if (isMissingRef(colorCycleData.gradientIdBuffer)) {
    colorCycleData.gradientIdBuffer = undefined;
  }
  if (isMissingRef(colorCycleData.gradientDefIdBuffer)) {
    colorCycleData.gradientDefIdBuffer = undefined;
  }
  if (isMissingRef(colorCycleData.canvasImageData)) {
    colorCycleData.canvasImageData = undefined;
  }
  if (isMissingRef(colorCycleData.eraseMaskImageData)) {
    colorCycleData.eraseMaskImageData = undefined;
  }
  if (isMissingRef(colorCycleData.softEdgeMaskImageData)) {
    colorCycleData.softEdgeMaskImageData = undefined;
  }
  if (colorCycleData.recolorSettings) {
    if (isMissingRef(colorCycleData.recolorSettings.indexBuffer)) {
      colorCycleData.recolorSettings.indexBuffer = undefined;
    }
    if (isMissingRef(colorCycleData.recolorSettings.indexPhaseMap)) {
      colorCycleData.recolorSettings.indexPhaseMap = undefined;
    }
    if (isMissingRef(colorCycleData.recolorSettings.phaseMap)) {
      colorCycleData.recolorSettings.phaseMap = undefined;
    }
    if (isMissingRef(colorCycleData.recolorSettings.originalImageData)) {
      colorCycleData.recolorSettings.originalImageData = undefined;
    }
  }

  colorCycleData.brushState?.layers?.forEach((snapshot) => {
    if (snapshot.strokeData) {
      if (isMissingRef(snapshot.strokeData.paintBuffer)) {
        snapshot.strokeData.paintBuffer = undefined;
      }
      if (isMissingRef(snapshot.strokeData.speedBuffer)) {
        snapshot.strokeData.speedBuffer = undefined;
      }
      if (isMissingRef(snapshot.strokeData.flowBuffer)) {
        snapshot.strokeData.flowBuffer = undefined;
      }
      if (isMissingRef(snapshot.strokeData.phaseBuffer)) {
        snapshot.strokeData.phaseBuffer = undefined;
      }
      if (isMissingRef(snapshot.strokeData.gradientIdBuffer)) {
        snapshot.strokeData.gradientIdBuffer = undefined;
      }
      if (isMissingRef(snapshot.strokeData.gradientDefIdBuffer)) {
        snapshot.strokeData.gradientDefIdBuffer = undefined;
      }
    }
    if (snapshot.animator?.indexBuffer) {
      if (isMissingRef(snapshot.animator.indexBuffer.data)) {
        snapshot.animator.indexBuffer.data = undefined;
      }
      if (isMissingRef(snapshot.animator.indexBuffer.gradientId)) {
        snapshot.animator.indexBuffer.gradientId = undefined;
      }
      if (isMissingRef(snapshot.animator.indexBuffer.speedData)) {
        snapshot.animator.indexBuffer.speedData = undefined;
      }
      if (isMissingRef(snapshot.animator.indexBuffer.flowData)) {
        snapshot.animator.indexBuffer.flowData = undefined;
      }
      if (isMissingRef(snapshot.animator.indexBuffer.phaseData)) {
        snapshot.animator.indexBuffer.phaseData = undefined;
      }
    }
  });
};

const sanitizeDanglingColorCycleArchiveRefs = (
  vesselProject: VesselProject,
  archiveZip: JSZip,
): void => {
  vesselProject.project.layers.forEach((layer) => {
    const missingPaths = new Set<string>();
    collectArchiveBinaryRefs(layer).forEach((path) => {
      if (isOptionalColorCycleArchivePath(path) && !archiveZip.file(path)) {
        missingPaths.add(path);
      }
    });
    removeDanglingColorCycleArchiveRefs(layer, missingPaths);
  });
};

const applyExplicitDanglingColorCycleRepair = (
  vesselProject: VesselProject,
  issues: ProjectArchiveRefIssue[],
): ProjectArchiveRepairReport => {
  const repairedAt = new Date().toISOString();
  const canonicalIssues = issues.filter((issue) => issue.kind === 'canonical-color-cycle');
  const missingPathsByLayerId = new Map<string, Set<string>>();
  canonicalIssues.forEach((issue) => {
    if (!issue.layerId) {
      return;
    }
    const paths = missingPathsByLayerId.get(issue.layerId) ?? new Set<string>();
    paths.add(issue.path);
    missingPathsByLayerId.set(issue.layerId, paths);
  });

  const repairedLayerIds: string[] = [];
  vesselProject.project.layers.forEach((layer) => {
    const missingPaths = missingPathsByLayerId.get(layer.id);
    if (!missingPaths?.size || normalizePersistedLayerType(layer.layerType) !== 'color-cycle') {
      return;
    }

    removeDanglingColorCycleArchiveRefs(layer, missingPaths);
    if (layer.state && 'dimensions' in layer.state) {
      const colorCycleState = layer.state as SerializedColorCycleLayerStateV1;
      if (!colorCycleState.paintRef) {
        colorCycleState.hasContent = false;
      }
    }
    layer.colorCycleData ??= {};
    layer.colorCycleData.repairStatus = {
      ok: false,
      reason: 'missing-paint-buffer',
      notes: [
        'Explicit repair removed dangling canonical color-cycle archive refs.',
        'Layer can reopen from compatibility preview only; canonical animated paint data was missing.',
      ],
    };
    repairedLayerIds.push(layer.id);
  });

  return {
    repairedAt,
    repairedLayerIds,
    removedRefs: canonicalIssues.map((issue) => ({
      layerId: issue.layerId ?? 'unknown',
      layerName: issue.layerName,
      path: issue.path,
      locations: [...issue.locations],
      kind: issue.kind,
    })),
    warning: 'Repaired archive removed dangling canonical color-cycle refs. Affected layers are preview-only/static until repainted.',
  };
};

export async function repairDanglingColorCycleArchiveRefs(
  projectData: ProjectFileData,
): Promise<ProjectArchiveRepairResult> {
  const projectBytes = await toProjectDataBytes(projectData);
  if (!projectBytes || !isZipBytes(projectBytes)) {
    throw new Error('Dangling color-cycle archive repair requires a .vs zip archive');
  }

  const archiveZip = await JSZip.loadAsync(projectBytes);
  const projectEntry = archiveZip.file(PROJECT_ARCHIVE_ENTRY);
  const normalizedProjectEntry = Array.isArray(projectEntry) ? projectEntry[0] ?? null : projectEntry;
  if (!normalizedProjectEntry) {
    throw new Error('Project archive is missing project.json');
  }

  const projectJson = utf8Decoder.decode(await normalizedProjectEntry.async('uint8array'));
  const vesselProject = parseVesselProjectJsonRaw(projectJson);
  vesselProject.binaries = await buildRepairedArchiveBinaryManifest(vesselProject, archiveZip);
  sanitizeDanglingColorCycleArchiveRefs(vesselProject, archiveZip);

  const binaryPaths = new Set((vesselProject.binaries?.entries ?? []).map((entry) => entry.path));
  const payloadPaths = new Set(Object.keys(archiveZip.files).filter((path) => !archiveZip.files[path]?.dir));
  const analysis = analyzeVesselProjectArchiveRefs(vesselProject, { binaryPaths, payloadPaths });
  if (analysis.missingCanonicalColorCycleRefs.length === 0) {
    throw new Error('No dangling canonical color-cycle archive refs were found to repair');
  }

  const report = applyExplicitDanglingColorCycleRepair(
    vesselProject,
    analysis.missingCanonicalColorCycleRefs,
  );
  vesselProject.metadata.modified = report.repairedAt;

  validateSerializedProjectEnvelope(vesselProject);
  archiveZip.file(PROJECT_ARCHIVE_ENTRY, JSON.stringify(vesselProject));
  archiveZip.file(PROJECT_PREVIEW_ARCHIVE_ENTRY, JSON.stringify({
    version: vesselProject.version,
    manifestVersion: PROJECT_ARCHIVE_MANIFEST_VERSION,
    metadata: vesselProject.metadata,
    project: {
      id: vesselProject.project.id,
      name: vesselProject.project.name,
      width: vesselProject.project.width,
      height: vesselProject.project.height,
      thumbnail: vesselProject.project.thumbnail,
    },
  } satisfies VesselProjectPreview));

  const archiveData = await archiveZip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });

  return {
    archiveData,
    report,
  };
}

async function parseVesselProjectJson(
  json: string,
  options?: {
    archiveZip?: JSZip | null;
  },
): Promise<VesselProject> {
  const vesselProject = parseVesselProjectJsonRaw(json);
  if (options?.archiveZip) {
    vesselProject.binaries = await buildRepairedArchiveBinaryManifest(vesselProject, options.archiveZip);
    sanitizeDanglingColorCycleArchiveRefs(vesselProject, options.archiveZip);
  }
  validateSerializedProjectEnvelope(vesselProject);

  return vesselProject;
}

function toProjectPreview(vesselProject: VesselProject): VesselProjectPreview {
  return {
    version: vesselProject.version,
    metadata: vesselProject.metadata,
    project: {
      id: vesselProject.project.id,
      name: vesselProject.project.name,
      width: vesselProject.project.width,
      height: vesselProject.project.height,
      thumbnail: vesselProject.project.thumbnail,
    },
  };
}

function normalizeVesselProjectPreview(previewManifest: VesselProjectPreview): VesselProjectPreview {
  const normalizedThumbnail = previewManifest.project.thumbnail ?? previewManifest.preview?.dataUrl;
  return {
    ...previewManifest,
    project: {
      ...previewManifest.project,
      thumbnail: normalizedThumbnail,
    },
  };
}

function parseVesselProjectPreviewJson(json: string): VesselProjectPreview {
  let sanitized = json;
  if (sanitized.length > 0 && sanitized.charCodeAt(0) === 0xfeff) {
    sanitized = sanitized.slice(1);
  }
  sanitized = sanitized.trimStart();
  const NULL_CHAR = '\0';
  if (sanitized.includes(NULL_CHAR)) {
    sanitized = sanitized.split(NULL_CHAR).join('');
  }

  let previewManifest: VesselProjectPreview;
  try {
    previewManifest = JSON.parse(sanitized) as VesselProjectPreview;
  } catch (error) {
    const preview = sanitized.slice(0, 80);
    const charCodes = Array.from(preview).map((ch) => ch.charCodeAt(0));
    logError('[projectIO] Failed to parse project preview manifest', { error, preview, charCodes });
    throw new Error('Invalid project preview format');
  }

  if (
    !previewManifest.version ||
    !previewManifest.metadata ||
    !previewManifest.project ||
    typeof previewManifest.project.id !== 'string' ||
    typeof previewManifest.project.name !== 'string' ||
    typeof previewManifest.project.width !== 'number' ||
    typeof previewManifest.project.height !== 'number'
  ) {
    throw new Error('Invalid Vessel project preview');
  }

  validateProjectDimensions(
    previewManifest.project.width,
    previewManifest.project.height,
    'project preview dimensions'
  );

  if (previewManifest.preview) {
    const { preview } = previewManifest;
    if (
      typeof preview.dataUrl !== 'string'
      || typeof preview.width !== 'number'
      || typeof preview.height !== 'number'
      || typeof preview.encoding !== 'string'
    ) {
      throw new Error('Invalid Vessel project preview');
    }
    validateProjectDimensions(preview.width, preview.height, 'preview thumbnail dimensions');
  }

  return normalizeVesselProjectPreview(previewManifest);
}

export async function readProjectPreviewManifest(projectData: ProjectFileData): Promise<VesselProjectPreview> {
  if (typeof projectData !== 'string') {
    let bytes: Uint8Array;
    if (typeof ArrayBuffer !== 'undefined' && projectData instanceof ArrayBuffer) {
      bytes = new Uint8Array(projectData);
    } else if (typeof Uint8Array !== 'undefined' && projectData instanceof Uint8Array) {
      bytes = projectData;
    } else if (typeof Blob !== 'undefined' && projectData instanceof Blob) {
      const buffer = await projectData.arrayBuffer();
      bytes = new Uint8Array(buffer);
    } else {
      throw new Error('Unsupported project data input');
    }

    if (isZipBytes(bytes)) {
      const zip = await JSZip.loadAsync(bytes);
      const previewEntry = zip.file(PROJECT_PREVIEW_ARCHIVE_ENTRY);
      const normalizedPreviewEntry = Array.isArray(previewEntry) ? previewEntry[0] ?? null : previewEntry;
      if (normalizedPreviewEntry) {
        try {
          const previewJson = await normalizedPreviewEntry.async('string');
          return parseVesselProjectPreviewJson(previewJson);
        } catch (error) {
          debugWarn('raw-console', '[projectIO] Failed to read project preview archive entry; falling back to project manifest', error);
        }
      }

      const projectEntry = zip.file(PROJECT_ARCHIVE_ENTRY);
      const normalizedProjectEntry = Array.isArray(projectEntry) ? projectEntry[0] ?? null : projectEntry;
      if (!normalizedProjectEntry) {
        throw new Error('Project archive is missing project.json');
      }
      const projectJson = utf8Decoder.decode(await normalizedProjectEntry.async('uint8array'));
      return toProjectPreview(await parseVesselProjectJson(projectJson, { archiveZip: zip }));
    }
  }

  return toProjectPreview(await readProjectManifest(projectData));
}

export async function readProjectHealthReport(projectData: ProjectFileData): Promise<ProjectHealthReport> {
  const projectBytes = await toProjectDataBytes(projectData);
  let archiveBytes = 0;
  let archiveZip: JSZip | null = null;
  let projectJson: string;
  let previewJson: string | null = null;

  if (projectBytes && isZipBytes(projectBytes)) {
    archiveBytes = projectBytes.byteLength;
    archiveZip = await JSZip.loadAsync(projectBytes);
    const projectEntry = archiveZip.file(PROJECT_ARCHIVE_ENTRY);
    const normalizedProjectEntry = Array.isArray(projectEntry) ? projectEntry[0] ?? null : projectEntry;
    if (!normalizedProjectEntry) {
      throw new Error('Project archive is missing project.json');
    }
    projectJson = utf8Decoder.decode(await normalizedProjectEntry.async('uint8array'));
    const previewEntry = archiveZip.file(PROJECT_PREVIEW_ARCHIVE_ENTRY);
    const normalizedPreviewEntry = Array.isArray(previewEntry) ? previewEntry[0] ?? null : previewEntry;
    previewJson = normalizedPreviewEntry ? await normalizedPreviewEntry.async('string') : null;
  } else {
    projectJson = await decodeProjectData(projectData);
    archiveBytes = projectBytes?.byteLength ?? byteCountForString(projectJson);
  }

  const vesselProject = await parseVesselProjectJson(projectJson, { archiveZip });
  const previewManifest = previewJson
    ? parseVesselProjectPreviewJson(previewJson)
    : toProjectPreview(vesselProject);

  return buildProjectSaveSizeReport(
    vesselProject,
    previewManifest,
    projectJson,
    previewJson ?? JSON.stringify(previewManifest),
    archiveBytes,
  );
}

export async function readProjectManifest(projectData: ProjectFileData): Promise<VesselProject> {
  const projectBytes = await toProjectDataBytes(projectData);
  let archiveZip: JSZip | null = null;
  let projectJson: string;

  if (projectBytes && isZipBytes(projectBytes)) {
    archiveZip = await JSZip.loadAsync(projectBytes);
    const projectEntry = archiveZip.file(PROJECT_ARCHIVE_ENTRY);
    const normalizedProjectEntry = Array.isArray(projectEntry) ? projectEntry[0] ?? null : projectEntry;
    if (!normalizedProjectEntry) {
      throw new Error('Project archive is missing project.json');
    }
    projectJson = utf8Decoder.decode(await normalizedProjectEntry.async('uint8array'));
  } else {
    projectJson = await decodeProjectData(projectData);
  }

  try {
    return await parseVesselProjectJson(projectJson, { archiveZip });
  } catch (error) {
    const trimmed = projectJson.trimStart();
    const firstChar = trimmed.charCodeAt(0);
    const secondChar = trimmed.charCodeAt(1);

    // Fallback: the caller might have provided a stringified binary (e.g. via File.text())
    // or base64 payload. Attempt to recover once before surfacing the error.
    if (firstChar === 0x50 && secondChar === 0x4b) {
      // Starts with 'PK' – likely raw zip bytes interpreted as a string.
      projectJson = await decodeProjectData(binaryStringToUint8Array(projectJson));
      return parseVesselProjectJson(projectJson);
    }

    if (firstChar === 0x1f && secondChar === 0x8b) {
      // Starts with gzip magic bytes interpreted as a string.
      projectJson = await decodeProjectData(binaryStringToUint8Array(projectJson));
      return parseVesselProjectJson(projectJson);
    }

    if (trimmed.startsWith('UEs') || trimmed.startsWith('H4sI')) {
      try {
        const binary = base64ToArrayBuffer(trimmed.replace(/\s+/g, ''));
        if (binary) {
          projectJson = await decodeProjectData(binary);
          return parseVesselProjectJson(projectJson);
        }
      } catch (base64Error) {
        debugWarn('raw-console', '[projectIO] Base64 project manifest decode failed', base64Error);
      }
    }

    throw error;
  }
}

const toProjectDataBytes = async (projectData: ProjectFileData): Promise<Uint8Array | null> => {
  if (typeof projectData === 'string') {
    return null;
  }
  if (typeof ArrayBuffer !== 'undefined' && projectData instanceof ArrayBuffer) {
    return new Uint8Array(projectData);
  }
  if (typeof Uint8Array !== 'undefined' && projectData instanceof Uint8Array) {
    return projectData;
  }
  if (typeof Blob !== 'undefined' && projectData instanceof Blob) {
    const buffer = await projectData.arrayBuffer();
    return new Uint8Array(buffer);
  }
  throw new Error('Unsupported project data input');
};

const readVerifiedArchiveEntryBytes = async (
  entryPath: string,
  zip: JSZip,
  binaryManifest: ArchiveBinaryManifestIndex,
): Promise<Uint8Array> => {
  const entry = zip.file(entryPath);
  const normalizedEntry = Array.isArray(entry) ? entry[0] ?? null : entry;
  if (!normalizedEntry) {
    throw new Error(`Project archive is missing ${entryPath}`);
  }
  const manifestEntry = binaryManifest.get(entryPath);
  if (!manifestEntry) {
    throw new Error(`Project archive manifest is missing binary entry ${entryPath}`);
  }
  const bytes = await normalizedEntry.async('uint8array');
  if (bytes.byteLength !== manifestEntry.byteLength) {
    throw new Error(`Project archive binary length mismatch for ${entryPath}`);
  }
  if (fnv1aHash(bytes) !== manifestEntry.checksum) {
    throw new Error(`Project archive binary checksum mismatch for ${entryPath}`);
  }
  return expandSparseRectBuffer(bytes, manifestEntry);
};

const hydrateArchiveBinaryRef = async (
  value: string | undefined,
  zip: JSZip | null,
  binaryManifest: ArchiveBinaryManifestIndex,
  cache: Map<string, string>,
): Promise<string | undefined> => {
  if (!value || !isArchiveBinaryRef(value) || !zip) {
    return value;
  }
  const entryPath = fromArchiveBinaryRef(value);
  const cached = cache.get(entryPath);
  if (typeof cached === 'string') {
    return cached;
  }
  const bytes = await readVerifiedArchiveEntryBytes(entryPath, zip, binaryManifest);
  const hydrated = bytesToBase64(bytes);
  cache.set(entryPath, hydrated);
  return hydrated;
};

const hydrateArchiveTextRef = async (
  value: string | undefined,
  zip: JSZip | null,
  binaryManifest: ArchiveBinaryManifestIndex,
  cache: Map<string, string>,
): Promise<string | undefined> => {
  if (!value || !isArchiveBinaryRef(value) || !zip) {
    return value;
  }
  const entryPath = fromArchiveBinaryRef(value);
  const cached = cache.get(entryPath);
  if (typeof cached === 'string') {
    return cached;
  }
  const bytes = await readVerifiedArchiveEntryBytes(entryPath, zip, binaryManifest);
  const hydrated = new TextDecoder().decode(bytes);
  cache.set(entryPath, hydrated);
  return hydrated;
};

const hydrateSerializedLayerArchiveRefs = async (
  layer: SerializedLayer,
  zip: JSZip | null,
  binaryManifest: ArchiveBinaryManifestIndex,
  cache: Map<string, string>,
  options?: {
    deferColorCycleRuntimeBuffers?: boolean;
  },
): Promise<void> => {
  if (layer.state && 'imageRef' in layer.state && !layer.imageDataUrl) {
    layer.imageDataUrl = (await hydrateArchiveTextRef(layer.state.imageRef, zip, binaryManifest, cache)) ?? '';
  }

  if (layer.state && 'chunksRef' in layer.state && !layer.sequentialData) {
    const chunksJson = await hydrateArchiveTextRef(layer.state.chunksRef, zip, binaryManifest, cache);
    const brushSnapshotsJson = layer.state.brushSnapshotsRef
      ? await hydrateArchiveTextRef(layer.state.brushSnapshotsRef, zip, binaryManifest, cache)
      : undefined;
    layer.sequentialData = {
      frameCount: layer.state.frameCount,
      fps: layer.state.fps,
      durationMs: layer.state.durationMs,
      chunks: chunksJson ? JSON.parse(chunksJson) as SerializedSequentialStrokeChunkV1[] : [],
      brushSnapshots: brushSnapshotsJson
        ? JSON.parse(brushSnapshotsJson) as Record<string, SequentialStrokeEvent['brush']>
        : undefined,
    };
  }

  if (layer.state && 'dimensions' in layer.state && !('imageRef' in layer.state) && !('chunksRef' in layer.state)) {
    const colorCycleData = layer.colorCycleData ?? {};
    const deferRuntimeBuffers = Boolean(options?.deferColorCycleRuntimeBuffers);
    colorCycleData.canvasWidth ??= layer.state.dimensions.width;
    colorCycleData.canvasHeight ??= layer.state.dimensions.height;
    colorCycleData.gradientDefs ??= layer.state.gradientDefs;
    colorCycleData.slotPalettes ??= layer.state.slotPalettes;
    colorCycleData.gradientDefStore ??= layer.state.gradientDefStore;
    colorCycleData.nextGradientDefId ??= layer.state.nextGradientDefId;
    colorCycleData.fgActiveSlot ??= layer.state.fgActiveSlot;
    colorCycleData.activeGradientId ??= layer.state.activeGradientId;
    colorCycleData.mode ??= layer.state.mode;
    colorCycleData.layerBaseSpeedCps ??= layer.state.layerBaseSpeedCps;
    colorCycleData.brushSpeed ??= layer.state.brushSpeed;
    colorCycleData.controllerSpeedCps ??= layer.state.controllerSpeedCps;
    colorCycleData.flowMode ??= layer.state.flowMode;
    const metadataBrushState = (
      colorCycleData.brushState && typeof colorCycleData.brushState === 'object'
        ? colorCycleData.brushState
        : {
            layers: [],
          }
    ) as PersistedColorCycleBrushState;
    metadataBrushState.canonicalPaint = true;
    metadataBrushState.schemaVersion = 1;
    metadataBrushState.dimensionsByLayerId = {
      ...(metadataBrushState.dimensionsByLayerId ?? {}),
      [layer.id]: {
        width: layer.state.dimensions.width,
        height: layer.state.dimensions.height,
      },
    };
    if (!deferRuntimeBuffers && !colorCycleData.gradientIdBuffer) {
      colorCycleData.gradientIdBuffer = await hydrateArchiveBinaryRef(layer.state.gradientIdRef, zip, binaryManifest, cache);
    }
    if (!deferRuntimeBuffers && !colorCycleData.gradientDefIdBuffer) {
      colorCycleData.gradientDefIdBuffer = await hydrateArchiveBinaryRef(layer.state.gradientDefIdRef, zip, binaryManifest, cache);
    }
    const currentLayerSnapshot = getSerializedBrushSnapshotForLayer(metadataBrushState, layer.id) ?? {
      layerId: layer.id,
    };
    currentLayerSnapshot.canonicalPaint = true;
    currentLayerSnapshot.schemaVersion = 1;
    currentLayerSnapshot.dimensions = {
      width: layer.state.dimensions.width,
      height: layer.state.dimensions.height,
    };
    const currentLayerStrokeData = currentLayerSnapshot.strokeData ?? {};
    currentLayerStrokeData.paintBuffer = deferRuntimeBuffers
      ? layer.state.paintRef
      : await hydrateArchiveBinaryRef(layer.state.paintRef, zip, binaryManifest, cache);
    currentLayerSnapshot.paintSlot ??= layer.state.paintSlot;
    currentLayerSnapshot.activeGradientId ??= layer.state.activeGradientId;
    currentLayerStrokeData.hasContent ??= layer.state.hasContent;
    currentLayerStrokeData.strokeCounter ??= layer.state.strokeCounter;
    currentLayerStrokeData.speedBuffer = deferRuntimeBuffers
      ? layer.state.speedRef
      : await hydrateArchiveBinaryRef(layer.state.speedRef, zip, binaryManifest, cache);
    currentLayerStrokeData.flowBuffer = deferRuntimeBuffers
      ? layer.state.flowRef
      : await hydrateArchiveBinaryRef(layer.state.flowRef, zip, binaryManifest, cache);
    currentLayerStrokeData.phaseBuffer = deferRuntimeBuffers
      ? layer.state.phaseRef
      : await hydrateArchiveBinaryRef(layer.state.phaseRef, zip, binaryManifest, cache);
    if (
      currentLayerStrokeData.paintBuffer
      || currentLayerStrokeData.speedBuffer
      || currentLayerStrokeData.flowBuffer
      || currentLayerStrokeData.phaseBuffer
      || currentLayerStrokeData.hasContent !== undefined
      || currentLayerStrokeData.strokeCounter !== undefined
    ) {
      currentLayerSnapshot.strokeData = currentLayerStrokeData;
    }
    if (!metadataBrushState.layers.some((snapshot) => snapshot.layerId === layer.id)) {
      metadataBrushState.layers.push(currentLayerSnapshot);
    }
    if (layer.state.dither) {
      metadataBrushState.ditherEnabled = layer.state.dither.enabled;
      metadataBrushState.ditherStrength = layer.state.dither.strength;
      metadataBrushState.ditherPixelSize = layer.state.dither.pixelSize;
      metadataBrushState.perceptualDither = layer.state.dither.perceptual;
      metadataBrushState.stampShape = layer.state.dither.stampShape;
      metadataBrushState.stampDitherEnabled = layer.state.dither.stampDitherEnabled;
      metadataBrushState.stampDitherPixelSize = layer.state.dither.stampDitherPixelSize;
      metadataBrushState.stampDitherAlgorithm = layer.state.dither.stampDitherAlgorithm;
      metadataBrushState.stampDitherPatternStyle = layer.state.dither.stampDitherPatternStyle;
      metadataBrushState.stampDitherBgFill = layer.state.dither.stampDitherBgFill;
      metadataBrushState.stampDitherClears = layer.state.dither.stampDitherClears;
      metadataBrushState.stampDitherPressureLinked = layer.state.dither.stampDitherPressureLinked;
      metadataBrushState.pxlEdgeEnabled = layer.state.dither.pxlEdgeEnabled;
    }
    colorCycleData.brushState = metadataBrushState;
    layer.colorCycleData = colorCycleData;
  }

  const colorCycleData = layer.colorCycleData;
  if (!colorCycleData || !zip) {
    return;
  }

  colorCycleData.canvasImageData = (await hydrateArchiveTextRef(colorCycleData.canvasImageData, zip, binaryManifest, cache)) ?? colorCycleData.canvasImageData;
  colorCycleData.eraseMaskImageData = (await hydrateArchiveTextRef(colorCycleData.eraseMaskImageData, zip, binaryManifest, cache)) ?? colorCycleData.eraseMaskImageData;
  colorCycleData.softEdgeMaskImageData = (await hydrateArchiveTextRef(colorCycleData.softEdgeMaskImageData, zip, binaryManifest, cache)) ?? colorCycleData.softEdgeMaskImageData;
  if (colorCycleData.recolorSettings) {
    colorCycleData.recolorSettings.indexBuffer =
      await hydrateArchiveBinaryRef(colorCycleData.recolorSettings.indexBuffer, zip, binaryManifest, cache);
    colorCycleData.recolorSettings.indexPhaseMap =
      await hydrateArchiveBinaryRef(colorCycleData.recolorSettings.indexPhaseMap, zip, binaryManifest, cache);
    colorCycleData.recolorSettings.phaseMap =
      await hydrateArchiveBinaryRef(colorCycleData.recolorSettings.phaseMap, zip, binaryManifest, cache);
    colorCycleData.recolorSettings.originalImageData =
      (await hydrateArchiveTextRef(colorCycleData.recolorSettings.originalImageData, zip, binaryManifest, cache))
      ?? colorCycleData.recolorSettings.originalImageData;
  }

  if (!options?.deferColorCycleRuntimeBuffers) {
    colorCycleData.gradientIdBuffer = await hydrateArchiveBinaryRef(colorCycleData.gradientIdBuffer, zip, binaryManifest, cache);
    colorCycleData.gradientDefIdBuffer = await hydrateArchiveBinaryRef(colorCycleData.gradientDefIdBuffer, zip, binaryManifest, cache);
  }

  if (!options?.deferColorCycleRuntimeBuffers && colorCycleData.brushState?.layers?.length) {
    for (const snapshot of colorCycleData.brushState.layers) {
      if (snapshot.strokeData) {
        snapshot.strokeData.paintBuffer = await hydrateArchiveBinaryRef(snapshot.strokeData.paintBuffer, zip, binaryManifest, cache);
        snapshot.strokeData.gradientIdBuffer = await hydrateArchiveBinaryRef(snapshot.strokeData.gradientIdBuffer, zip, binaryManifest, cache);
        snapshot.strokeData.gradientDefIdBuffer = await hydrateArchiveBinaryRef(snapshot.strokeData.gradientDefIdBuffer, zip, binaryManifest, cache);
        snapshot.strokeData.speedBuffer = await hydrateArchiveBinaryRef(snapshot.strokeData.speedBuffer, zip, binaryManifest, cache);
        snapshot.strokeData.flowBuffer = await hydrateArchiveBinaryRef(snapshot.strokeData.flowBuffer, zip, binaryManifest, cache);
        snapshot.strokeData.phaseBuffer = await hydrateArchiveBinaryRef(snapshot.strokeData.phaseBuffer, zip, binaryManifest, cache);
      }
      if (snapshot.animator?.indexBuffer) {
        snapshot.animator.indexBuffer.data = await hydrateArchiveBinaryRef(snapshot.animator.indexBuffer.data, zip, binaryManifest, cache);
        snapshot.animator.indexBuffer.gradientId = await hydrateArchiveBinaryRef(snapshot.animator.indexBuffer.gradientId, zip, binaryManifest, cache);
        snapshot.animator.indexBuffer.speedData = await hydrateArchiveBinaryRef(snapshot.animator.indexBuffer.speedData, zip, binaryManifest, cache);
        snapshot.animator.indexBuffer.flowData = await hydrateArchiveBinaryRef(snapshot.animator.indexBuffer.flowData, zip, binaryManifest, cache);
        snapshot.animator.indexBuffer.phaseData = await hydrateArchiveBinaryRef(snapshot.animator.indexBuffer.phaseData, zip, binaryManifest, cache);
      }
    }
  }
};

// Deserialize a project from saved data
export async function deserializeProjectWithReport(
  projectData: ProjectFileData,
  options?: DeserializeProjectOptions,
): Promise<DeserializedProjectResult> {
  const projectBytes = await toProjectDataBytes(projectData);
  let archiveZip: JSZip | null = null;
  let projectJson: string;
  if (projectBytes && isZipBytes(projectBytes)) {
    archiveZip = await JSZip.loadAsync(projectBytes);
    const projectEntry = archiveZip.file(PROJECT_ARCHIVE_ENTRY);
    const normalizedProjectEntry = Array.isArray(projectEntry) ? projectEntry[0] ?? null : projectEntry;
    if (!normalizedProjectEntry) {
      throw new Error('Project archive is missing project.json');
    }
    projectJson = utf8Decoder.decode(await normalizedProjectEntry.async('uint8array'));
  } else {
    projectJson = await decodeProjectData(projectData);
  }
  const vesselProject = await parseVesselProjectJson(projectJson, { archiveZip });
  const serializedProject = vesselProject.project;
  const migration = migrateLegacyProjectLayers(serializedProject.layers, {
    projectWidth: serializedProject.width,
    projectHeight: serializedProject.height,
  });

  // Deserialize layers
  const archiveCache = new Map<string, string>();
  const binaryManifest = new Map(
    (vesselProject.binaries?.entries ?? []).map((entry) => [entry.path, entry] as const)
  );
  const activeLayerId = options?.activeLayerId ?? migration.layers[0]?.id ?? null;
  const layers = await Promise.all(
    migration.layers.map(async (layer) => {
      const deferColorCycleRuntimeBuffers = shouldDeferSerializedColorCycleRuntimeHydration(
        layer,
        binaryManifest,
        {
          ...options,
          activeLayerId,
        },
      );
      await hydrateSerializedLayerArchiveRefs(layer, archiveZip, binaryManifest, archiveCache, {
        deferColorCycleRuntimeBuffers,
      });
      const deserializedLayer = await deserializeLayer(layer, serializedProject.width, serializedProject.height);
      if (
        deferColorCycleRuntimeBuffers
        && archiveZip
        && layer.state
        && 'dimensions' in layer.state
        && !('imageRef' in layer.state)
      ) {
        const colorCycleState = layer.state as SerializedColorCycleLayerStateV1;
        setLazyColorCycleArchiveRuntime(deserializedLayer, {
          archiveZip,
          binaryManifest,
          cache: archiveCache,
          paintRef: colorCycleState.paintRef,
          speedRef: colorCycleState.speedRef,
          flowRef: colorCycleState.flowRef,
          phaseRef: colorCycleState.phaseRef,
          gradientIdRef: colorCycleState.gradientIdRef,
          gradientDefIdRef: colorCycleState.gradientDefIdRef,
          brushState: layer.colorCycleData?.brushState,
        });
      }
      return deserializedLayer;
    })
  );
  migrateLegacyColorCycleEncoding(layers, vesselProject.version);
  const colorCycleRepairWarnings = await applyLegacyColorCycleImportRepair(layers);

  // Deserialize custom brushes

  const customBrushes = await Promise.all(
    serializedProject.customBrushes.map(deserializeCustomBrush)
  );

  applyLegacyColorCycleBrushSettingsFallback(
    layers,
    serializedProject.brushSpecificSettings as Record<string, Partial<BrushSettings>> | undefined,
  );

  const serializedDefaultId = serializedProject.defaultCustomBrushId ?? null;
  const defaultCustomBrushId =
    serializedDefaultId && customBrushes.some((brush) => brush.id === serializedDefaultId)
      ? serializedDefaultId
      : null;


  return {
    migration: migration.summary,
    colorCycleRepairWarnings,
    project: {
    id: serializedProject.id,
    name: serializedProject.name,
    width: serializedProject.width,
    height: serializedProject.height,
    backgroundColor: serializedProject.backgroundColor,
    layers,
    layerGroups: serializedProject.layerGroups ?? [],
    customBrushes,
    defaultCustomBrushId,
    createdAt: new Date(vesselProject.metadata.created),
    updatedAt: new Date(vesselProject.metadata.modified),
    brushSpecificSettings: serializedProject.brushSpecificSettings as Record<string, Partial<BrushSettings>> | undefined,
    globalBrushSize: serializedProject.globalBrushSize,
    referenceLayerId: serializedProject.referenceLayerId ?? null,
    exportLayout: cloneExportLayout(serializedProject.exportLayout),
    palette: normalizePalette(serializedProject.palette),
    canvasShape: serializedProject.canvasShape,
    viewState: serializedProject.viewState
      ? {
          zoom: toFiniteNumber(serializedProject.viewState.zoom, 1),
          displayFilters: sanitizeDisplayFilters(serializedProject.viewState.displayFilters),
        }
      : undefined,
    },
  };
}

export async function deserializeProject(
  projectData: ProjectFileData,
  options?: DeserializeProjectOptions,
): Promise<Project> {
  const result = await deserializeProjectWithReport(projectData, options);
  return result.project;
}

// Save project to file using File System Access API with fallback
export async function saveProjectToFile(
  project: Project,
  filename?: string | null,
  layers?: Layer[],
  existingHandle?: FileSystemFileHandle | null
): Promise<{ fileName: string; fileHandle: FileSystemFileHandle | null }> {
  const fileName = ensureProjectFilename((filename ?? project.name) || '');
  let projectData: Uint8Array | null = null;

  const ensureProjectData = async (): Promise<Uint8Array> => {
    if (!projectData) {
      const artifacts = await buildSerializedProjectArtifacts(project, layers);
      projectData = artifacts.archiveData;
    }
    return projectData;
  };

  const writeToHandle = async (handle: FileSystemFileHandle): Promise<void> => {
    const writable = await handle.createWritable();
    try {
      const data = await ensureProjectData();
      const buffer = toArrayBuffer(data);
      await writable.write({ type: 'write', position: 0, data: buffer });
      await writable.truncate(buffer.byteLength);
      await writable.close();
    } catch (error) {
      try {
        await writable.abort();
      } catch {
        // best effort cleanup
      }
      throw error;
    }
  };

  if (existingHandle) {
    try {
      await writeToHandle(existingHandle);
      return { fileName: existingHandle.name ?? fileName, fileHandle: existingHandle };
    } catch {
      // Permission revoked or handle invalid; fall back to picker/download
    }
  }

  let pickedHandle: FileSystemFileHandle | null = null;

  if ('showSaveFilePicker' in window) {
    try {
      pickedHandle = await (window as Window & {
        showSaveFilePicker?: (options: {
          suggestedName?: string;
          types?: { description: string; accept: Record<string, string[]> }[];
        }) => Promise<FileSystemFileHandle>;
      }).showSaveFilePicker!({
        suggestedName: fileName,
        types: [{
          description: 'Vessel Project Files',
          accept: { [PROJECT_FILE_MIME]: PROJECT_FILE_ACCEPT }
        }]
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw error;
      }
    }
  }

  if (pickedHandle) {
    await writeToHandle(pickedHandle);
    return { fileName: pickedHandle.name ?? fileName, fileHandle: pickedHandle };
  }

  const finalData = await ensureProjectData();
  const finalBuffer = toArrayBuffer(finalData);
  const blob = new Blob([finalBuffer], { type: PROJECT_FILE_MIME });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  return { fileName, fileHandle: null };
}

// Load project from file
export async function loadProjectFromFile(): Promise<{
  project: Project;
  migration?: ProjectLegacyMigrationSummary;
  fileName?: string;
  fileHandle?: FileSystemFileHandle | null;
}> {
  // Check if File System Access API is supported
  if ('showOpenFilePicker' in window) {
    try {
      const [fileHandle] = await (window as Window & {
        showOpenFilePicker?: (options: {
          types?: { description: string; accept: Record<string, string[]> }[];
          multiple?: boolean;
        }) => Promise<FileSystemFileHandle[]>;
      }).showOpenFilePicker!({
        types: [{
          description: 'Vessel Project Files',
          accept: {
            [PROJECT_FILE_MIME]: PROJECT_FILE_ACCEPT,
            [LEGACY_PROJECT_FILE_MIME]: PROJECT_FILE_ACCEPT
          }
        }],
        multiple: false
      });

      const file = await fileHandle.getFile();
      const projectData = await file.arrayBuffer();
      const result = await deserializeProjectWithReport(projectData, {
        lazyColorCycleRuntime: true,
      });
      debugLog('raw-console', '[projectIO] loadProjectFromFile: using File System Access handle', {
        fileName: file.name,
        handleName: fileHandle.name,
      });
      return { project: result.project, migration: result.migration, fileName: file.name, fileHandle };
    } catch {
      // User cancelled or API not supported, fall back to file input
    }
  }

  // Fallback: create file input
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = [...PROJECT_FILE_ACCEPT, ...PROJECT_FILE_MIME_ACCEPT].join(',');

    input.onchange = async (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) {
        reject(new Error('No file selected'));
        return;
      }

      try {
        const projectData = await file.arrayBuffer();
        const result = await deserializeProjectWithReport(projectData, {
          lazyColorCycleRuntime: true,
        });
        debugLog('raw-console', '[projectIO] loadProjectFromFile: using file input fallback', {
          fileName: file.name,
        });
        resolve({ project: result.project, migration: result.migration, fileName: file.name, fileHandle: null });
      } catch (error) {
        reject(error);
      }
    };

    input.click();
  });
}

// Restore color cycle brushes after project load

type CreateColorCycleBrushForRestore = typeof import('../hooks/brushEngine/ColorCycleBrushMigration')['createColorCycleBrush'];

type ColorCycleRestoreMaterializationResult = {
  brush: ColorCycleRuntimeBrush | null;
  materialized: boolean;
  reason?: string;
};

const restoreColorCycleLayerRuntimeForMaterialization = async (
  layer: Layer,
  createColorCycleBrush: CreateColorCycleBrushForRestore,
  canSeedFromPersistedBuffers: (
    colorCycleBrush: {
      applyLayerSnapshot?: (
        layerId: string,
        snapshot: {
          paintBuffer: ArrayBuffer;
          gradientIdBuffer?: ArrayBuffer;
          gradientDefIdBuffer?: ArrayBuffer;
          hasContent: boolean;
          strokeCounter: number;
        },
      ) => void;
    },
    colorCycleData: NonNullable<Layer['colorCycleData']>,
  ) => boolean,
): Promise<ColorCycleRestoreMaterializationResult> => {
      const colorCycleData = layer.colorCycleData;
      if (!colorCycleData) {
        return { brush: null, materialized: false, reason: 'missing-color-cycle-data' };
      }
      const savedBrushState = getSavedColorCycleBrushState(layer);
      if (savedBrushState) {
        ccWarmRestoreDebug.log('brush-state-found', {
          layerId: layer.id,
          snapshotCount: savedBrushState.layers?.length ?? 0,
          cycleSpeed: savedBrushState.cycleSpeed,
          fps: savedBrushState.fps,
        });
        const canvasWidth = colorCycleData.canvas?.width ?? 0;
        const canvasHeight = colorCycleData.canvas?.height ?? 0;
        const hasDimensionMismatch = Boolean(
          canvasWidth > 0 &&
          canvasHeight > 0 &&
          savedBrushState.layers?.some((snapshot) => !isCompatibleColorCycleSnapshot(snapshot, canvasWidth, canvasHeight))
        );
        if (hasDimensionMismatch) {
          debugWarn('raw-console', '[projectIO] Dropping incompatible color cycle brushState during load', {
            layerId: layer.id,
            canvasWidth,
            canvasHeight,
          });
          ccWarmRestoreDebug.warn('brush-state-dropped-dimension-mismatch', {
            layerId: layer.id,
            canvasWidth,
            canvasHeight,
          });
          deleteSavedColorCycleBrushState(layer);
        } else {
        try {
          const colorCycleBrush = createColorCycleBrush(colorCycleData.canvas!);
          const shouldUseOversizedFastPath =
            estimateSerializedBrushStatePayloadSize(savedBrushState) > OVERSIZED_CC_BRUSH_STATE_BASE64_THRESHOLD &&
            canSeedFromPersistedBuffers(
              colorCycleBrush as {
                applyLayerSnapshot?: (
                  layerId: string,
                  snapshot: {
                    paintBuffer: ArrayBuffer;
                    gradientIdBuffer?: ArrayBuffer;
                    gradientDefIdBuffer?: ArrayBuffer;
                    hasContent: boolean;
                    strokeCounter: number;
                  },
                ) => void;
              },
              colorCycleData,
            ) &&
            (savedBrushState.layers ?? []).every((snapshot) => (
              snapshotLooksLikeDuplicatedLegacyPayload(snapshot) &&
              !snapshotHasRichColorCycleMetadata(snapshot)
            ));

          if (shouldUseOversizedFastPath) {
            ccWarmRestoreDebug.log('oversized-fast-path', {
              layerId: layer.id,
              snapshotCount: savedBrushState.layers?.length ?? 0,
            });
            colorCycleData.brushState = toFastPathMetadataBrushState(savedBrushState);
            deleteSavedColorCycleBrushState(layer);
          }
          const layerSnapshots = (savedBrushState.layers ?? []).map(snapshot => {
            const fallbackGradientIdBuffer = snapshot.layerId === layer.id
              ? colorCycleData.gradientIdBuffer
              : undefined;
            const fallbackGradientDefIdBuffer = snapshot.layerId === layer.id
              ? colorCycleData.gradientDefIdBuffer
              : undefined;
            const paintBuffer = snapshot.strokeData?.paintBuffer
              ? base64ToArrayBuffer(snapshot.strokeData.paintBuffer)
              : undefined;
            const gradientIdBuffer = snapshot.strokeData?.gradientIdBuffer
              ? base64ToArrayBuffer(snapshot.strokeData.gradientIdBuffer)
              : fallbackGradientIdBuffer instanceof ArrayBuffer
                ? fallbackGradientIdBuffer.slice(0)
              : undefined;
            const gradientDefIdBuffer = snapshot.strokeData?.gradientDefIdBuffer
              ? base64ToArrayBuffer(snapshot.strokeData.gradientDefIdBuffer)
              : fallbackGradientDefIdBuffer instanceof ArrayBuffer
                ? fallbackGradientDefIdBuffer.slice(0)
              : undefined;
            const speedBuffer = snapshot.strokeData?.speedBuffer
              ? base64ToArrayBuffer(snapshot.strokeData.speedBuffer)
              : undefined;
            const flowBuffer = snapshot.strokeData?.flowBuffer
              ? base64ToArrayBuffer(snapshot.strokeData.flowBuffer)
              : undefined;
            const phaseBuffer = snapshot.strokeData?.phaseBuffer
              ? base64ToArrayBuffer(snapshot.strokeData.phaseBuffer)
              : undefined;
            const animatorIndex = snapshot.animator
              ? {
                  width: snapshot.animator.indexBuffer.width,
                  height: snapshot.animator.indexBuffer.height,
                  data: snapshot.animator.indexBuffer.data
                    ? base64ToArrayBuffer(snapshot.animator.indexBuffer.data)
                    : new ArrayBuffer(0),
                  gradientIdData: snapshot.animator.indexBuffer.gradientId
                    ? base64ToArrayBuffer(snapshot.animator.indexBuffer.gradientId)
                    : undefined,
                  speedData: snapshot.animator.indexBuffer.speedData
                    ? base64ToArrayBuffer(snapshot.animator.indexBuffer.speedData)
                    : undefined,
                  flowData: snapshot.animator.indexBuffer.flowData
                    ? base64ToArrayBuffer(snapshot.animator.indexBuffer.flowData)
                    : undefined,
                  phaseData: snapshot.animator.indexBuffer.phaseData
                    ? base64ToArrayBuffer(snapshot.animator.indexBuffer.phaseData)
                    : undefined,
                  gradientStops: snapshot.animator.gradient.gradientStops,
                  gradientDefs: snapshot.gradientDefs,
                  slotPalettes: snapshot.slotPalettes,
                  paintSlot: snapshot.paintSlot,
                  legacyRemap: snapshot.legacyRemap,
                  activeGradientId: snapshot.activeGradientId,
                }
              : undefined;

            return {
              layerId: snapshot.layerId,
              paintBuffer,
              gradientIdBuffer,
              gradientDefIdBuffer,
              speedBuffer,
              flowBuffer,
              phaseBuffer,
              hasContent: snapshot.strokeData?.hasContent,
              strokeCounter: snapshot.strokeData?.strokeCounter,
              animatorIndex
            };
          });
          const hasSpeedBuffer = layerSnapshots.some((snapshot) => (
            (snapshot.speedBuffer && snapshot.speedBuffer.byteLength > 0)
            || (snapshot.animatorIndex?.speedData && snapshot.animatorIndex.speedData.byteLength > 0)
            || (snapshot.flowBuffer && snapshot.flowBuffer.byteLength > 0)
            || (snapshot.animatorIndex?.flowData && snapshot.animatorIndex.flowData.byteLength > 0)
          ));
          ccWarmRestoreDebug.log('snapshots-prepared', {
            layerId: layer.id,
            snapshotCount: layerSnapshots.length,
            hasSpeedBuffer,
            snapshots: layerSnapshots.map((snapshot) => ({
              layerId: snapshot.layerId,
              paintBuffer: describeBufferForDebug(snapshot.paintBuffer),
              gradientIdBuffer: describeBufferForDebug(snapshot.gradientIdBuffer),
              gradientDefIdBuffer: describeBufferForDebug(snapshot.gradientDefIdBuffer),
              hasContent: snapshot.hasContent,
              strokeCounter: snapshot.strokeCounter,
              hasAnimatorIndex: Boolean(snapshot.animatorIndex),
            })),
          });

          const currentLayerSnapshot = layerSnapshots.find((snapshot) => snapshot.layerId === layer.id);
          if (
            currentLayerSnapshot &&
            !currentLayerSnapshot.paintBuffer &&
            (
              currentLayerSnapshot.hasContent === true ||
              Boolean(currentLayerSnapshot.gradientIdBuffer) ||
              Boolean(currentLayerSnapshot.gradientDefIdBuffer)
            )
          ) {
            ccWarmRestoreDebug.warn('missing-paint-buffer-skip-runtime-restore', {
              layerId: layer.id,
              hasContent: currentLayerSnapshot.hasContent,
              gradientIdBuffer: describeBufferForDebug(currentLayerSnapshot.gradientIdBuffer),
              gradientDefIdBuffer: describeBufferForDebug(currentLayerSnapshot.gradientDefIdBuffer),
            });
            return { brush: null, materialized: false, reason: 'missing-paint-buffer' };
          }

          colorCycleBrush.restoreFullState({
            cycleSpeed: savedBrushState.cycleSpeed,
            fps: savedBrushState.fps,
            brushSize: savedBrushState.brushSize,
            ditherEnabled: savedBrushState.ditherEnabled,
            ditherStrength: savedBrushState.ditherStrength,
            ditherPixelSize: savedBrushState.ditherPixelSize,
            perceptualDither: savedBrushState.perceptualDither,
            stampShape: savedBrushState.stampShape,
            stampDitherEnabled: savedBrushState.stampDitherEnabled,
            stampDitherPixelSize: savedBrushState.stampDitherPixelSize,
            stampDitherAlgorithm: savedBrushState.stampDitherAlgorithm,
            stampDitherPatternStyle: savedBrushState.stampDitherPatternStyle,
            stampDitherBgFill: savedBrushState.stampDitherBgFill,
            stampDitherClears: savedBrushState.stampDitherClears,
            stampDitherPressureLinked: savedBrushState.stampDitherPressureLinked,
            pxlEdgeEnabled: savedBrushState.pxlEdgeEnabled,
            layerSnapshots
          });

          if (typeof (colorCycleBrush as {
            applyLayerSnapshot?: (
              layerId: string,
              snapshot: {
                paintBuffer: ArrayBuffer;
                gradientIdBuffer?: ArrayBuffer;
                gradientDefIdBuffer?: ArrayBuffer;
                speedBuffer?: ArrayBuffer;
                flowBuffer?: ArrayBuffer;
                phaseBuffer?: ArrayBuffer;
                hasContent: boolean;
                strokeCounter: number;
              },
              animatorIndex?: {
                width: number;
                height: number;
                data: ArrayBuffer;
                gradientIdData?: ArrayBuffer;
                speedData?: ArrayBuffer;
                flowData?: ArrayBuffer;
                phaseData?: ArrayBuffer;
                gradientStops: Array<{ position: number; color: string }>;
                gradientDefs?: Array<{ id: string; name?: string; currentSlot: number }>;
                slotPalettes?: Array<{ slot: number; stops: Array<{ position: number; color: string }> }>;
                paintSlot?: number;
                legacyRemap?: { from: number; to: number };
                activeGradientId?: string;
              },
            ) => void;
          }).applyLayerSnapshot === 'function') {
            for (const snapshot of layerSnapshots) {
              if (!(snapshot.paintBuffer instanceof ArrayBuffer) || snapshot.paintBuffer.byteLength === 0) {
                continue;
              }
              (
                colorCycleBrush as {
                  applyLayerSnapshot: (
                    layerId: string,
                    snapshot: {
                      paintBuffer: ArrayBuffer;
                      gradientIdBuffer?: ArrayBuffer;
                      gradientDefIdBuffer?: ArrayBuffer;
                      speedBuffer?: ArrayBuffer;
                      flowBuffer?: ArrayBuffer;
                      phaseBuffer?: ArrayBuffer;
                      hasContent: boolean;
                      strokeCounter: number;
                    },
                    animatorIndex?: {
                      width: number;
                      height: number;
                      data: ArrayBuffer;
                      gradientIdData?: ArrayBuffer;
                      speedData?: ArrayBuffer;
                      flowData?: ArrayBuffer;
                      phaseData?: ArrayBuffer;
                      gradientStops: Array<{ position: number; color: string }>;
                      gradientDefs?: Array<{ id: string; name?: string; currentSlot: number }>;
                      slotPalettes?: Array<{ slot: number; stops: Array<{ position: number; color: string }> }>;
                      paintSlot?: number;
                      legacyRemap?: { from: number; to: number };
                      activeGradientId?: string;
                    },
                  ) => void;
                }
              ).applyLayerSnapshot(snapshot.layerId, {
                paintBuffer: snapshot.paintBuffer,
                gradientIdBuffer: snapshot.gradientIdBuffer,
                gradientDefIdBuffer: snapshot.gradientDefIdBuffer,
                speedBuffer: snapshot.speedBuffer,
                flowBuffer: snapshot.flowBuffer,
                phaseBuffer: snapshot.phaseBuffer,
                hasContent: snapshot.hasContent ?? false,
                strokeCounter: snapshot.strokeCounter ?? 0,
              }, snapshot.animatorIndex);
            }
          }

          const expectsCurrentLayerContent = Boolean(
            currentLayerSnapshot?.hasContent === true ||
            ccPayloadHasNonZeroByte(currentLayerSnapshot?.paintBuffer),
          );
          if (expectsCurrentLayerContent && typeof colorCycleBrush.getLayerSnapshot === 'function') {
            const restoredCurrentLayerSnapshot = colorCycleBrush.getLayerSnapshot(layer.id);
            if (restoredCurrentLayerSnapshot?.hasContent !== true) {
              ccWarmRestoreDebug.warn('runtime-restore-verification-failed', {
                layerId: layer.id,
                expectedHasContent: true,
                restoredHasContent: restoredCurrentLayerSnapshot?.hasContent ?? null,
                restoredPaintBuffer: describeBufferForDebug(restoredCurrentLayerSnapshot?.paintBuffer),
              });
              return { brush: null, materialized: false, reason: 'runtime-restore-verification-failed' };
            }
          }

          if (typeof colorCycleBrush.setLayerId === 'function') {
            try {
              colorCycleBrush.setLayerId(layer.id);
            } catch (error) {
              debugWarn('raw-console', '[projectIO] Failed to assign layerId to restored color cycle brush:', error);
            }
          }

          requestGradientApply(layer.id, 'project-load');

          if (!hasSpeedBuffer) {
            const controllerSpeed = resolveLayerColorCycleBaseSpeed(colorCycleData);
            if (typeof controllerSpeed === 'number') {
              colorCycleBrush.setSpeed(controllerSpeed);
            } else if (typeof savedBrushState.cycleSpeed === 'number') {
              colorCycleBrush.setSpeed(savedBrushState.cycleSpeed);
            }
          }

          colorCycleData.colorCycleBrush = colorCycleBrush;
          colorCycleData.brushState = shouldUseOversizedFastPath
            ? toFastPathMetadataBrushState(savedBrushState)
            : savedBrushState;
          deleteSavedColorCycleBrushState(layer);

          if (colorCycleData.isAnimating) {
            colorCycleBrush.setPlaying(true);
          } else {
            colorCycleBrush.setPlaying(false);
          }

          flushGradientApply(layer.id);
          const materialized = materializeRestoredColorCycleSurface(layer, colorCycleBrush);

          if (typeof colorCycleBrush.markLayerHasExternalBase === 'function') {
            try {
              colorCycleBrush.markLayerHasExternalBase(layer.id);
            } catch (error) {
              debugWarn('raw-console', '[projectIO] Failed to flag restored color cycle base (brush state):', error);
            }
          }

          ccWarmRestoreDebug.log('brush-state-restore-complete', {
            layerId: layer.id,
            hydration: getColorCycleHydrationState(colorCycleData),
            isAnimating: colorCycleData.isAnimating,
            hasSpeedBuffer,
            materialized,
            hasCanvasImageData: Boolean(colorCycleData.canvasImageData),
          });
          return { brush: colorCycleBrush as ColorCycleRuntimeBrush, materialized };
        } catch (error) {
          ccWarmRestoreDebug.warn('brush-state-restore-failed', {
            layerId: layer.id,
            error: error instanceof Error ? error.message : String(error),
          });
          logError('[projectIO] Failed to restore color cycle brush state:', error);
        }
        }
      }
      // Check if we have saved WebGL state
      const savedState = getSavedColorCycleWebGLState(layer);
      if (savedState) {
        // Create new color cycle brush
        const colorCycleBrush = createColorCycleBrush(colorCycleData.canvas!);
        if (typeof colorCycleBrush.setLayerId === 'function') {
          try {
            colorCycleBrush.setLayerId(layer.id);
          } catch (error) {
            debugWarn('raw-console', '[projectIO] Failed to assign layerId to restored CC brush (WebGL state):', error);
          }
        }

        // Restore the WebGL state
        const layerSnapshots = new Map<string, ArrayBuffer>();
        for (const snapshot of savedState.layerSnapshots) {
          layerSnapshots.set(snapshot.layerId, base64ToArrayBuffer(snapshot.data));
        }

        colorCycleBrush.restoreFullState({
          gradients: savedState.gradients,
          animationState: savedState.animationState,
          layerSnapshots
        });

        // Attach the brush to the layer
        colorCycleData.colorCycleBrush = colorCycleBrush;

        // Clean up the temporary saved state
        deleteSavedColorCycleWebGLState(layer);

        // Start animation if it was animating
        if (colorCycleData.isAnimating) {
          colorCycleBrush.setPlaying(!savedState.animationState.isPaused);
        }

        if (typeof colorCycleBrush.markLayerHasExternalBase === 'function') {
          try {
            colorCycleBrush.markLayerHasExternalBase(layer.id);
          } catch (error) {
            debugWarn('raw-console', '[projectIO] Failed to flag restored color cycle base (WebGL state):', error);
          }
        }
        flushGradientApply(layer.id);
        const materialized = materializeRestoredColorCycleSurface(layer, colorCycleBrush);
        return { brush: colorCycleBrush as ColorCycleRuntimeBrush, materialized };
      } else {
        // No saved state, create a new brush with the gradient
        const legacyStaticPreviewImageData =
          colorCycleData.canvasImageData ??
          (imageDataHasVisiblePixels(layer.imageData) ? layer.imageData ?? undefined : undefined);
        const documentStateResult = normalizeColorCycleLayerDocumentState(layer, {
          fallbackWidth: colorCycleData.canvas?.width ?? colorCycleData.canvasWidth ?? layer.imageData?.width,
          fallbackHeight: colorCycleData.canvas?.height ?? colorCycleData.canvasHeight ?? layer.imageData?.height,
        });
        if (
          documentStateResult.ok &&
          !documentStateResult.state.paintBuffer &&
          (
            documentStateResult.state.hasContent ||
            Boolean(documentStateResult.state.gradientIdBuffer) ||
            Boolean(documentStateResult.state.gradientDefIdBuffer) ||
            imageDataHasVisiblePixels(legacyStaticPreviewImageData)
          )
        ) {
          if (!colorCycleData.canvasImageData && legacyStaticPreviewImageData) {
            colorCycleData.canvasImageData = legacyStaticPreviewImageData;
            colorCycleData.canvasWidth ??= legacyStaticPreviewImageData.width;
            colorCycleData.canvasHeight ??= legacyStaticPreviewImageData.height;
          }
          ccWarmRestoreDebug.warn('missing-paint-buffer-skip-runtime-restore', {
            layerId: layer.id,
            hasContent: documentStateResult.state.hasContent,
            gradientIdBuffer: describeBufferForDebug(documentStateResult.state.gradientIdBuffer),
            gradientDefIdBuffer: describeBufferForDebug(documentStateResult.state.gradientDefIdBuffer),
            hasCanvasImageData: Boolean(colorCycleData.canvasImageData),
            usedLayerImageDataPreview: legacyStaticPreviewImageData === layer.imageData,
          });
          return { brush: null, materialized: false, reason: 'missing-paint-buffer' };
        }
        const colorCycleBrush = createColorCycleBrush(colorCycleData.canvas!);
        const existingBrushState = colorCycleData.brushState as
          | PersistedColorCycleBrushState
          | undefined;
        const metadataOnlyExistingBrushState = existingBrushState
          ? toFastPathMetadataBrushState(existingBrushState)
          : undefined;
        if (typeof colorCycleBrush.setLayerId === 'function') {
          try {
            colorCycleBrush.setLayerId(layer.id);
          } catch (error) {
            debugWarn('raw-console', '[projectIO] Failed to assign layerId to restored CC brush (fallback):', error);
          }
        }
        if (colorCycleData.gradient) {
          requestGradientApply(layer.id, 'project-load');
        }

        if (metadataOnlyExistingBrushState) {
          try {
            colorCycleBrush.restoreFullState({
              cycleSpeed: metadataOnlyExistingBrushState.cycleSpeed,
              fps: metadataOnlyExistingBrushState.fps,
              brushSize: metadataOnlyExistingBrushState.brushSize,
              ditherEnabled: metadataOnlyExistingBrushState.ditherEnabled,
              ditherStrength: metadataOnlyExistingBrushState.ditherStrength,
              ditherPixelSize: metadataOnlyExistingBrushState.ditherPixelSize,
              perceptualDither: metadataOnlyExistingBrushState.perceptualDither,
              stampShape: metadataOnlyExistingBrushState.stampShape,
              stampDitherEnabled: metadataOnlyExistingBrushState.stampDitherEnabled,
              stampDitherPixelSize: metadataOnlyExistingBrushState.stampDitherPixelSize,
              stampDitherAlgorithm: metadataOnlyExistingBrushState.stampDitherAlgorithm,
              stampDitherPatternStyle: metadataOnlyExistingBrushState.stampDitherPatternStyle,
              stampDitherBgFill: metadataOnlyExistingBrushState.stampDitherBgFill,
              stampDitherClears: metadataOnlyExistingBrushState.stampDitherClears,
              stampDitherPressureLinked: metadataOnlyExistingBrushState.stampDitherPressureLinked,
              pxlEdgeEnabled: metadataOnlyExistingBrushState.pxlEdgeEnabled,
              layerSnapshots: [],
            });
          } catch (error) {
            debugWarn('raw-console', '[projectIO] Failed to restore metadata-only color cycle brush state:', error);
          }
        }

        const controllerSpeed = resolveLayerColorCycleBaseSpeed(colorCycleData);
        if (typeof controllerSpeed === 'number') {
          try {
            // Legacy fallback for files without per-stroke speed buffers.
            colorCycleBrush.setSpeed(controllerSpeed);
          } catch (error) {
            debugWarn('raw-console', '[projectIO] Failed to restore color cycle speed:', error);
          }
        }

        if (metadataOnlyExistingBrushState) {
          colorCycleData.brushState = metadataOnlyExistingBrushState;
        }
        colorCycleData.colorCycleBrush = colorCycleBrush;
        flushGradientApply(layer.id);
        const materialized = materializeRestoredColorCycleSurface(layer, colorCycleBrush);
        return { brush: colorCycleBrush as ColorCycleRuntimeBrush, materialized };
      }
          return { brush: null, materialized: false };
};

export async function restoreColorCycleBrushes(
  layers: Layer[],
  options?: RestoreColorCycleBrushesOptions,
): Promise<Layer[]> {
  // Import ColorCycleBrush factory dynamically to avoid circular dependencies
  const { createColorCycleBrush } = await import('../hooks/brushEngine/ColorCycleBrushMigration');
  const canSeedFromPersistedBuffers = (
    colorCycleBrush: {
      applyLayerSnapshot?: (
        layerId: string,
        snapshot: {
          paintBuffer: ArrayBuffer;
          gradientIdBuffer?: ArrayBuffer;
          gradientDefIdBuffer?: ArrayBuffer;
          hasContent: boolean;
          strokeCounter: number;
        },
      ) => void;
    },
    colorCycleData: NonNullable<Layer['colorCycleData']>,
  ): boolean => {
    const persistedGradientIdBuffer = colorCycleData.gradientIdBuffer;
    const expectedSize = colorCycleData.canvas!.width * colorCycleData.canvas!.height;
    return (
      typeof colorCycleBrush.applyLayerSnapshot === 'function' &&
      persistedGradientIdBuffer instanceof ArrayBuffer &&
      persistedGradientIdBuffer.byteLength === expectedSize
    );
  };
  for (const layer of layers) {
    if (layer.layerType === 'color-cycle' && layer.colorCycleData) {
      if (
        layer.colorCycleData.repairStatus?.ok === false &&
        !hasRecoverableColorCycleRuntimeSource(layer)
      ) {
        const repairStatus = layer.colorCycleData.repairStatus;
        layer.colorCycleData = {
          ...setColorCycleHydrationState(layer.colorCycleData, 'cold'),
          deferredRuntimeRestore: false,
        };
        ccWarmRestoreDebug.warn('repair-failed-skip-runtime-restore', {
          layerId: layer.id,
          reason: repairStatus.reason,
        });
        continue;
      }
      ccWarmRestoreDebug.log('layer-enter', {
        layerId: layer.id,
        name: layer.name,
        defer: shouldDeferColorCycleRuntimeRestore(layer, options),
        activeLayerId: options?.activeLayerId,
        hydration: getColorCycleHydrationState(layer.colorCycleData),
        hasBrush: Boolean(layer.colorCycleData.colorCycleBrush),
        hasBrushState: Boolean(getSavedColorCycleBrushState(layer)),
        hasCanvasImageData: Boolean(layer.colorCycleData.canvasImageData),
        gradientIdBuffer: describeBufferForDebug(layer.colorCycleData.gradientIdBuffer),
        gradientDefIdBuffer: describeBufferForDebug(layer.colorCycleData.gradientDefIdBuffer),
      });
      if (shouldDeferColorCycleRuntimeRestore(layer, options)) {
        layer.colorCycleData = setColorCycleHydrationState(layer.colorCycleData, 'cold');
        ccWarmRestoreDebug.log('deferred-cold', {
          layerId: layer.id,
          reason: 'shouldDeferColorCycleRuntimeRestore',
        });
        continue;
      }
      const targetRuntimeState = options?.activeLayerId === layer.id ? 'active' : 'warm';
      const hadLazyArchiveRuntime = Boolean(getLazyColorCycleArchiveRuntime(layer));
      const shouldValidateWarmupPrimaryPayload = Boolean(
        hadLazyArchiveRuntime ||
        layer.colorCycleData.deferredRuntimeRestore === true ||
        getColorCycleHydrationState(layer.colorCycleData) === 'cold'
      );
      await hydrateLazyColorCycleArchiveRuntime(layer);
      ccWarmRestoreDebug.log('archive-runtime-hydrated', {
        layerId: layer.id,
        gradientIdBuffer: describeBufferForDebug(layer.colorCycleData?.gradientIdBuffer),
        gradientDefIdBuffer: describeBufferForDebug(layer.colorCycleData?.gradientDefIdBuffer),
      });
      const savedBrushStateForWarmup = getSavedColorCycleBrushState(layer);
      if (savedBrushStateForWarmup && !layer.colorCycleData.brushState) {
        layer.colorCycleData.brushState = savedBrushStateForWarmup;
      }
      const warmupSnapshot = captureColorCyclePersistenceSnapshot(layer, {
        projectWidth: layer.colorCycleData.canvasWidth ?? layer.imageData?.width ?? layer.framebuffer.width ?? 1,
        projectHeight: layer.colorCycleData.canvasHeight ?? layer.imageData?.height ?? layer.framebuffer.height ?? 1,
        requirePaint: true,
        mode: 'diagnostic',
        runtimeBrush: null,
        serializeRuntimeBrushState: (state, layerId) => (
          serializeBrushStateForCanonicalSave(state as ColorCycleBrushState, layerId) as PersistenceBrushState | undefined
        ),
        diagnostics: (diagnostic) => {
          ccWarmRestoreDebug.log('canonical-payload-diagnostic', {
            layerId: layer.id,
            ...diagnostic,
          });
        },
      });
      if (
        !warmupSnapshot.ok &&
        shouldValidateWarmupPrimaryPayload &&
        hasRecoverableColorCycleRuntimeSource(layer) &&
        isPrimaryColorCyclePayloadFailure(warmupSnapshot.reason)
      ) {
        const before = summarizeColorCycleLayer(layer);
        layer.colorCycleData = {
          ...setColorCycleHydrationState(layer.colorCycleData, 'cold'),
          deferredRuntimeRestore: false,
          repairStatus: layer.colorCycleData.repairStatus ?? {
            ok: false,
            reason: toRepairStatusReasonForPrimaryPayloadFailure(warmupSnapshot.reason),
            notes: withColorCycleDiagnosticNotes(
              ['color-cycle-runtime-restore-primary-payload-drop-blocked'],
              ['static-preview-only', 'repair-failed'],
            ),
          },
        };
        ccWarmRestoreDebug.warn('cc-warmup-canonical-payload-drop-blocked', {
          layerId: layer.id,
          reason: warmupSnapshot.reason,
          damageKind: warmupSnapshot.damageKind,
          diagnostics: warmupSnapshot.diagnostics,
        });
        logCCMutation({
          event: 'cc-warmup-canonical-payload-drop-blocked',
          layerId: layer.id,
          reason: 'restoreColorCycleBrushes',
          severity: 'error',
          before,
          after: summarizeColorCycleLayer(layer),
          details: {
            snapshotReason: warmupSnapshot.reason,
            damageKind: warmupSnapshot.damageKind ?? null,
            diagnostics: warmupSnapshot.diagnostics,
          },
        });
        continue;
      }
      layer.colorCycleData = setColorCycleHydrationState(layer.colorCycleData, targetRuntimeState);
      const restored = await restoreColorCycleLayerRuntimeForMaterialization(
        layer,
        createColorCycleBrush,
        canSeedFromPersistedBuffers,
      );
      if (!restored.brush) {
        layer.colorCycleData = {
          ...setColorCycleHydrationState(layer.colorCycleData, 'cold'),
          deferredRuntimeRestore: false,
        };
        if (
          restored.reason === 'missing-paint-buffer' &&
          layer.colorCycleData &&
          !layer.colorCycleData.repairStatus
        ) {
          layer.colorCycleData.repairStatus = {
            ok: false,
            reason: 'missing-paint-buffer',
            notes: withColorCycleDiagnosticNotes(
              ['color-cycle-runtime-restore-missing-canonical-paint'],
              ['static-preview-only', 'repair-failed'],
            ),
          };
        }
        ccWarmRestoreDebug.warn('runtime-restore-missing-brush', {
          layerId: layer.id,
          targetRuntimeState,
          reason: restored.reason,
        });
      }
    }
  }

  // Return the modified layers
  return layers;
}

// Export project as PNG
export async function exportProjectAsPNG(
  project: Project,
  layers: Layer[],
  options: {
    includeBackground?: boolean;
    scale?: number;
    quality?: number;
  } = {}
): Promise<void> {
  const { includeBackground = true, scale = 1, quality = 1 } = options;

  const canvas = document.createElement('canvas');
  canvas.width = project.width * scale;
  canvas.height = project.height * scale;
  const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });

  if (!ctx) {
    throw new Error('Failed to get canvas context');
  }

  // Scale context if needed
  if (scale !== 1) {
    ctx.scale(scale, scale);
  }

  // Draw background if requested
  if (includeBackground) {
    ctx.fillStyle = project.backgroundColor;
    ctx.fillRect(0, 0, project.width, project.height);
  }

  // Draw layers in order
  const sortedLayers = [...layers].sort((a, b) => a.order - b.order);
  for (const layer of sortedLayers) {
    if (!layer.visible || !layer.imageData) continue;

    ctx.globalAlpha = layer.opacity;
    ctx.globalCompositeOperation = layer.blendMode;

    // Create temporary canvas for the layer
    const layerCanvas = document.createElement('canvas');
    layerCanvas.width = layer.imageData.width;
    layerCanvas.height = layer.imageData.height;
    const layerCtx = layerCanvas.getContext('2d', { colorSpace: 'srgb' });
    if (layerCtx) {
      layerCtx.putImageData(layer.imageData, 0, 0);
      ctx.drawImage(layerCanvas, 0, 0);
    }
  }

  const shape = normalizeCanvasShape(project.canvasShape, project.width, project.height);
  applyCanvasShapeMask(ctx, shape);

  // Save as PNG
  canvas.toBlob((blob) => {
    if (!blob) return;

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.name}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 'image/png', quality);
}

// Validate project file format
export async function validateProjectFile(projectData: ProjectFileData): Promise<{ valid: boolean; error?: string }> {
  try {
    const manifest = await readProjectManifest(projectData);

    if (!manifest.version) {
      return { valid: false, error: 'Missing version information' };
    }

    if (!manifest.project) {
      return { valid: false, error: 'Missing project data' };
    }

    const { project: projectInfo } = manifest;

    if (!projectInfo.id || !projectInfo.name || !projectInfo.width || !projectInfo.height) {
      return { valid: false, error: 'Missing required project properties' };
    }

    if (!Array.isArray(projectInfo.layers)) {
      return { valid: false, error: 'Invalid layers data' };
    }

    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Invalid Vessel project file'
    };
  }
}
