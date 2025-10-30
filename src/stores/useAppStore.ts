// Zustand store with state slices
// Based on /docs/02_System_Architecture/Overall_Design.md (lines 58-64)

const NON_COMPOSITE_DELTA_TAGS = new Set<string>(['selection-bounds', 'view-state']);

const isCcDebugEnabled = (): boolean => {
  try {
    const scope = globalThis as { CC_DEBUG?: { on: boolean } };
    return scope.CC_DEBUG?.on === true;
  } catch {
    return false;
  }
};

export type CaptureROI = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const normalizeCaptureROI = (
  roi: CaptureROI | undefined,
  maxWidth: number,
  maxHeight: number
): CaptureROI | undefined => {
  if (!roi) {
    return undefined;
  }
  if (
    !Number.isFinite(roi.x) ||
    !Number.isFinite(roi.y) ||
    !Number.isFinite(roi.width) ||
    !Number.isFinite(roi.height)
  ) {
    return undefined;
  }
  if (roi.width <= 0 || roi.height <= 0) {
    return undefined;
  }
  const x = Math.max(0, Math.floor(roi.x));
  const y = Math.max(0, Math.floor(roi.y));
  const width = Math.max(1, Math.min(maxWidth - x, Math.ceil(roi.width)));
  const height = Math.max(1, Math.min(maxHeight - y, Math.ceil(roi.height)));
  if (width <= 0 || height <= 0) {
    return undefined;
  }
  return { x, y, width, height };
};

const mergeImageDataRegion = (
  base: ImageData | null,
  region: ImageData,
  offsetX: number,
  offsetY: number,
  fullWidth: number,
  fullHeight: number
): ImageData => {
  const targetWidth = fullWidth;
  const targetHeight = fullHeight;
  const baseMatches =
    base && base.width === targetWidth && base.height === targetHeight;
  const mergedData = baseMatches
    ? new Uint8ClampedArray(base!.data)
    : new Uint8ClampedArray(targetWidth * targetHeight * 4);

  const src = region.data;
  const rowStride = region.width * 4;
  for (let row = 0; row < region.height; row++) {
    const srcStart = row * rowStride;
    const destStart = ((offsetY + row) * targetWidth + offsetX) * 4;
    mergedData.set(src.subarray(srcStart, srcStart + rowStride), destStart);
  }

  return new ImageData(mergedData, targetWidth, targetHeight);
};

const entryRequiresComposite = (entry: HistoryEntry | null): boolean => {
  if (!entry) {
    return true;
  }
  return entry.deltas.some((delta) => !NON_COMPOSITE_DELTA_TAGS.has(delta._tag));
};


interface VesselWindow extends Window {
  __checkLayerIntegrity?: () => string[];
  __TB_DEBUG?: {
    skipLayerAddSnapshot?: boolean;
    breakOnLayerErrors?: boolean;
    disableHistory?: boolean;
    [key: string]: unknown;
  };
}

const getVesselWindow = (): VesselWindow | undefined => {
  if (typeof window === 'undefined') {
    return undefined;
  }
  return window as VesselWindow;
};

// Detailed layer tracking for debugging
const trackLayerChanges = (..._args: unknown[]): void => {
  void _args;
  // Debug tracking disabled
};

const syncPercentOffsetsFromPixels = (layers: Layer[], project: Project | null): Layer[] => {
  if (!project) {
    return layers;
  }

  let didChange = false;

  const syncedLayers = layers.map(layer => {
    const alignment = layer.alignment;
    if (!alignment || alignment.positioning !== 'auto') {
      return layer;
    }

    const percentFromPx = computePercentOffsetFromPixels(alignment.offsetPx, project);

    const alignmentWithoutOffsets: LayerAlignmentSettings = {
      ...alignment,
      offsetPercent: undefined,
      offsetPx: undefined
    };

    const layerWithoutOffsets: Layer = {
      ...layer,
      alignment: alignmentWithoutOffsets
    };

    const percentFromFrameOrMetrics = computeLayerPercentOffset(layerWithoutOffsets, project);

    const frame = (layer as { frame?: { x?: number; y?: number } }).frame;
    const framePx = frame
      ? {
          x: Math.round(Number(frame.x ?? 0)),
          y: Math.round(Number(frame.y ?? 0))
        }
      : null;

    const offsetPx = alignment.offsetPx;

    const pxMatchesFrame = Boolean(
      framePx &&
      offsetPx &&
      Math.round(offsetPx.x ?? 0) === framePx.x &&
      Math.round(offsetPx.y ?? 0) === framePx.y
    );

    const shouldUseFrame = Boolean(framePx && !pxMatchesFrame);

    let nextPercent = percentFromPx ?? percentFromFrameOrMetrics;

    if (shouldUseFrame && percentFromFrameOrMetrics) {
      nextPercent = percentFromFrameOrMetrics;
    }

    const storedPercent = alignment.offsetPercent;
    const usingPxAsSource = !shouldUseFrame && Boolean(percentFromPx);

    if (usingPxAsSource && storedPercent && offsetPx && nextPercent) {
      const width = Math.max(1, project.width);
      const height = Math.max(1, project.height);

      const expectedPxX = Math.round(((storedPercent.x ?? 0) / 100) * width);
      const expectedPxY = Math.round(((storedPercent.y ?? 0) / 100) * height);

      if (expectedPxX === (offsetPx.x ?? 0)) {
        nextPercent = {
          ...nextPercent,
          x: storedPercent.x
        };
      }

      if (expectedPxY === (offsetPx.y ?? 0)) {
        nextPercent = {
          ...nextPercent,
          y: storedPercent.y
        };
      }
    }

    const currentPercent = alignment.offsetPercent;
    if (currentPercent && currentPercent.x === nextPercent.x && currentPercent.y === nextPercent.y) {
      return layer;
    }

    didChange = true;
    if (__DEV__) {
      console.groupCollapsed(`[alignment.percentSync] ${layer.id}`);
      console.log('previousPercent', currentPercent);
      console.log('nextPercent', nextPercent);
      console.log('percentFromPx', percentFromPx);
      console.log('percentFromFrameOrMetrics', percentFromFrameOrMetrics);
      console.log('offsetPx', offsetPx);
      console.log('framePx', framePx);
      console.log('usingPxAsSource', usingPxAsSource);
      console.log('shouldUseFrame', shouldUseFrame);
      console.groupEnd();
    }
    return {
      ...layer,
      alignment: {
        ...alignment,
        offsetPercent: nextPercent
      }
    };
  });

  return didChange ? syncedLayers : layers;
};

type ProjectSizeSnapshot = { width: number; height: number };

interface CropHistoryArgs {
  beforeProject: ProjectSizeSnapshot | null;
  afterProject: ProjectSizeSnapshot | null;
  beforeLayers: Map<string, { image: ImageData | null; colorState: ColorCycleSerializedState }>;
  afterLayers: Layer[];
  description: string;
}

const recordCropHistory = async ({
  beforeProject,
  afterProject,
  beforeLayers,
  afterLayers,
  description,
}: CropHistoryArgs): Promise<void> => {
  let deltaCount = 0;
  const txn = historyManager.begin(mapCanvasActionToHistoryId('crop'), {
    description,
  });

  try {
    for (const layer of afterLayers) {
      const baseline = beforeLayers.get(layer.id) ?? {
        image: null,
        colorState: null,
      };
      const afterImage = cloneLayerImageData(layer.imageData);
      const bitmapDelta = await createBitmapTileDelta({
        layerId: layer.id,
        before: baseline.image,
        after: afterImage,
      });
      if (bitmapDelta) {
        txn.push(bitmapDelta);
        deltaCount += 1;
      }

      if (layer.layerType === 'color-cycle' || baseline.colorState) {
        const afterColor = captureColorCycleBrushState(layer.id);
        const colorDelta = createColorCycleStrokeDelta({
          layerId: layer.id,
          forwardState: afterColor,
          backwardState: baseline.colorState ?? null,
        });
        if (colorDelta) {
          txn.push(colorDelta);
          deltaCount += 1;
        }
      }
    }

    if (
      beforeProject &&
      afterProject &&
      (beforeProject.width !== afterProject.width ||
        beforeProject.height !== afterProject.height)
    ) {
      txn.push(
        createProjectDimensionsDelta({
          before: beforeProject,
          after: afterProject,
        }),
      );
      deltaCount += 1;
    }

    if (deltaCount > 0) {
      txn.commit(description);
    } else {
      txn.cancel();
    }
  } catch (error) {
    txn.cancel();
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[history] Failed to record crop history', error);
    }
  }
};

// Global watcher to detect unexpected layer mutations
if (typeof window !== 'undefined') {
  const tinyWindow = getVesselWindow();
  if (tinyWindow) {
    tinyWindow.__checkLayerIntegrity = () => {
      const state = useAppStore.getState();
      const issues: string[] = [];
      
      state.layers.forEach(layer => {
        if (layer.layerType === 'color-cycle' && !layer.colorCycleData) {
          issues.push(`Layer ${layer.id} is color-cycle but missing colorCycleData`);
        }
        if (!layer.layerType && layer.colorCycleData) {
          issues.push(`Layer ${layer.id} has colorCycleData but no layerType`);
        }
        if (layer.layerType === 'normal' && layer.colorCycleData) {
          issues.push(`Layer ${layer.id} is normal but has colorCycleData`);
        }
      });
    
    if (issues.length > 0) {
      if (process.env.NODE_ENV !== 'production') {
        console.error('🔴 LAYER INTEGRITY ISSUES:', issues);
      }
    }
    return issues;
    };
  }
}

// Import ColorCycleBrush manager
import { getColorCycleBrushManager, setLayerIdGetter, setColorCycleStoreStateGetter } from './colorCycleBrushManager';
import { waitForFinalizeQueueIdle, waitForPendingColorCycleSaves } from './pendingColorCycleSaves';
import { syncCCRuntimes } from './ccRuntime';
import type { ColorCycleBrushImplementation } from './colorCycleBrushManager';
import { ShapeFillOrchestrator, type ShapeFillFinalizePayload } from '@/shapeFill';
import { getFillStrategy, listFillStrategies } from '@/shapeFill/strategies';
import type { FillParams, ShapeFillId, ShapeFillSession, ShapeFillParamKey, Vec2 } from '@/shapeFill/types';
import { FillStage } from '@/shapeFill/types';
import { RecolorManager } from '@/lib/colorCycle/RecolorManager';
import { configureMaskManager } from '@/layers/MaskManager';

// Get global manager instance
const colorCycleBrushManager = getColorCycleBrushManager();

// Setup layer ID getter for orphan cleanup
if (typeof window !== 'undefined') {
  setTimeout(() => {
    setLayerIdGetter(() => {
      const state = useAppStore.getState();
      return new Set(state.layers.map(l => l.id));
    });
  }, 0);
}

// Helper to store brush instance separately (now delegates to manager)
import { create } from 'zustand';
import { brushCache } from '../utils/brushCache';
import { scaledBrushCache } from '../utils/scaledBrushCache';
import type {
  Project,
  Layer,
  LayerAlignmentSettings,
  CanvasState,
  ToolState,
  UIState,
  AutosaveState,
  Tool,
  BrushSettings,
  BrushPreset,
  BrushComponent,
  CustomBrush,
  HistoryState,
  CanvasSnapshot,
  ShapeState,
  ShapePoint,
  PolygonGradientState,
  BrushEditorState,
  KeyboardScope,
  ExportContainerLayout,
  WebGLExportSettings,
  CropState,
  Rectangle,
  ColorAdjustState,
  ColorAdjustParams,
  PaletteState,
} from '@/types';
import { BrushShape } from '@/types';
import { brushPresets, applyBrushPreset, defaultBrushSettings, pixelBrushPreset } from '../presets/brushPresets';
import {
  saveProjectToFile, 
  loadProjectFromFile, 
  exportProjectAsPNG,
  restoreColorCycleBrushes
} from '../utils/projectIO';
// import { memoryManager } from '../utils/memoryCleanup';
import { DEFAULT_CANVAS_WIDTH, DEFAULT_CANVAS_HEIGHT, MAX_CANVAS_ZOOM, MIN_CANVAS_ZOOM } from '../constants/canvas';
import { adjustHueLightnessSaturation, applyColorAdjustments } from '../utils/imageProcessing';
import { debugLog, logError, __DEV__, recordBreadcrumb } from '../utils/debug';
import { applyCroppedLayers } from '@/utils/crop/apply';
import { rebuildCCLayerAfterCrop, rebuildRecolorLayersAfterCrop } from '@/utils/crop/ccRebuild';
import { normalizeCropRect } from '@/utils/crop/normalize';
import {
  cloneExportLayout,
  cloneLayerAlignment,
  createDefaultExportLayout,
  createDefaultLayerAlignment,
  createDefaultPalette,
  normalizeLayers,
  normalizeProject
} from '@/utils/layoutDefaults';
import { computeLayerPercentOffset, computePercentOffsetFromPixels } from '@/utils/layerMetrics';
import historyManager, { setActiveHistoryDocument } from '@/history/historyService';
import { createShapeSessionDelta } from '@/history/deltas/shapeSessionDelta';
import { createLegacySnapshotDelta, isLegacySnapshotDelta } from '@/history/legacyCanvasSnapshot';
import { mapCanvasActionToHistoryId } from '@/history/helpers/actions';
import { commitLayerHistory, cloneLayerImageData } from '@/history/helpers/layerHistory';
import { selectionSnapshotFromValues } from '@/history/selectionState';
import { createBitmapTileDelta } from '@/history/deltas/bitmapDelta';
import { createColorCycleStrokeDelta } from '@/history/deltas/colorCycleStrokeDelta';
import { createProjectDimensionsDelta } from '@/history/deltas/projectDimensionsDelta';
import type { HistoryEntry } from '@/history/actionTypes';
import { captureColorCycleBrushState, type ColorCycleSerializedState } from '@/history/helpers/colorCycle';
import { captureCanvasImageData } from '@/utils/canvas/canvasImage';

const COLOR_CYCLE_PRESET_IDS = ['color-cycle-stroke', 'color-cycle-triangle', 'color-cycle-shape'] as const;

type GradientStops = BrushSettings['colorCycleGradient'];

const cloneGradientStops = (stops?: GradientStops): GradientStops => {
  if (!stops) {
    return undefined;
  }
  return stops.map(stop => ({ ...stop }));
};

const gradientsEqual = (a?: GradientStops, b?: GradientStops): boolean => {
  if (!a || !b) {
    return !a && !b;
  }
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    const lhs = a[i];
    const rhs = b[i];
    if (!rhs) {
      return false;
    }
    if (
      (lhs.color ?? '') !== (rhs.color ?? '') ||
      Number(lhs.position ?? 0) !== Number(rhs.position ?? 0)
    ) {
      return false;
    }
  }
  return true;
};

const findStoredColorCycleGradient = (
  savedSettings: Record<string, Partial<BrushSettings>>
): { gradient: NonNullable<GradientStops>; version?: number } | null => {
  for (const presetId of COLOR_CYCLE_PRESET_IDS) {
    const entry = savedSettings[presetId];
    if (entry?.colorCycleGradient && entry.colorCycleGradient.length > 0) {
      return {
        gradient: entry.colorCycleGradient as NonNullable<GradientStops>,
        version: entry.colorCycleGradientVersion
      };
    }
  }
  return null;
};

const isColorCyclePresetId = (id: string): id is (typeof COLOR_CYCLE_PRESET_IDS)[number] => {
  return COLOR_CYCLE_PRESET_IDS.includes(id as (typeof COLOR_CYCLE_PRESET_IDS)[number]);
};

// Helper function to get serializable brush settings for persistence
const getSerializableBrushSettings = (settings: BrushSettings): Partial<BrushSettings> => {
  return {
    size: settings.size, // Include size in serializable settings for proper restoration
    opacity: settings.opacity,
    spacing: settings.spacing,
    colorJitter: settings.colorJitter,
    risographIntensity: settings.risographIntensity,
    ditherEnabled: settings.ditherEnabled,
    fillResolution: settings.fillResolution,
    pressureEnabled: settings.pressureEnabled,
    minPressure: settings.minPressure,
    maxPressure: settings.maxPressure,
    rotationEnabled: settings.rotationEnabled,
    dashedEnabled: settings.dashedEnabled,
    dashLength: settings.dashLength,
    dashGap: settings.dashGap,
    gridSnapEnabled: settings.gridSnapEnabled,
    shapeEnabled: settings.shapeEnabled,
    antialiasing: settings.antialiasing,
    colors: settings.colors,
    // Color Cycle specific settings
    colorCycleSpeed: settings.colorCycleSpeed,
    colorCycleGradient: settings.colorCycleGradient,
    colorCycleFPS: settings.colorCycleFPS,
    colorCycleFlowMode: settings.colorCycleFlowMode,
    gradientBands: settings.gradientBands
  };
};

const COLOR_ADJUST_TOOL: Tool = 'color-adjust';
const SHAPE_CAPABLE_TOOLS: Tool[] = ['brush', 'custom'];
const isShapeCapableTool = (tool?: Tool | null): boolean => {
  if (!tool) {
    return false;
  }
  return SHAPE_CAPABLE_TOOLS.includes(tool);
};
const isColorCycleBrushShape = (shape?: BrushShape): boolean => {
  if (!shape) {
    return false;
  }
  return (
    shape === BrushShape.COLOR_CYCLE ||
    shape === BrushShape.COLOR_CYCLE_TRIANGLE ||
    shape === BrushShape.COLOR_CYCLE_SHAPE
  );
};
let colorAdjustPreviewHandle: number | null = null;

const cancelScheduledColorAdjustPreview = (): void => {
  if (typeof window !== 'undefined' && colorAdjustPreviewHandle !== null) {
    cancelAnimationFrame(colorAdjustPreviewHandle);
  }
  colorAdjustPreviewHandle = null;
};

const scheduleColorAdjustPreview = (getState: () => AppState): void => {
  if (typeof window === 'undefined') {
    getState().previewColorAdjust();
    return;
  }

  cancelScheduledColorAdjustPreview();
  colorAdjustPreviewHandle = requestAnimationFrame(() => {
    colorAdjustPreviewHandle = null;
    getState().previewColorAdjust();
  });
};

const clampSelectionBounds = (
  bounds: Rectangle | null,
  imageWidth: number,
  imageHeight: number
): Rectangle | null => {
  if (!bounds) {
    return null;
  }

  const width = Math.ceil(bounds.width);
  const height = Math.ceil(bounds.height);
  if (width <= 0 || height <= 0) {
    return null;
  }

  const x = Math.max(0, Math.min(imageWidth - 1, Math.floor(bounds.x)));
  const y = Math.max(0, Math.min(imageHeight - 1, Math.floor(bounds.y)));
  const clampedWidth = Math.min(width, imageWidth - x);
  const clampedHeight = Math.min(height, imageHeight - y);

  if (clampedWidth <= 0 || clampedHeight <= 0) {
    return null;
  }

  return {
    x,
    y,
    width: clampedWidth,
    height: clampedHeight
  };
};

const copyRegionIntoTarget = (source: ImageData, target: ImageData, bounds: Rectangle): void => {
  const srcData = source.data;
  const tgtData = target.data;
  const sourceWidth = source.width;
  const sourceHeight = source.height;
  const targetWidth = target.width;
  const targetHeight = target.height;

  const startX = Math.max(0, Math.min(sourceWidth, Math.floor(bounds.x)));
  const startY = Math.max(0, Math.min(sourceHeight, Math.floor(bounds.y)));
  const endX = Math.min(sourceWidth, Math.ceil(bounds.x + bounds.width));
  const endY = Math.min(sourceHeight, Math.ceil(bounds.y + bounds.height));

  for (let y = startY; y < endY && y < targetHeight; y += 1) {
    for (let x = startX; x < endX && x < targetWidth; x += 1) {
      const index = (y * sourceWidth + x) * 4;
      const targetIndex = (y * targetWidth + x) * 4;

      tgtData[targetIndex] = srcData[index];
      tgtData[targetIndex + 1] = srcData[index + 1];
      tgtData[targetIndex + 2] = srcData[index + 2];
      tgtData[targetIndex + 3] = srcData[index + 3];
    }
  }
};

const defaultColorAdjustParams: ColorAdjustParams = {
  hue: 0,
  saturation: 0,
  lightness: 0,
  contrast: 0
};

const createDefaultColorAdjustState = (): ColorAdjustState => ({
  active: false,
  params: { ...defaultColorAdjustParams },
  originalImageData: null,
  selectionBounds: null,
  targetLayerId: null
});

interface ShapeFillState {
  activeFillId: ShapeFillId;
  availableFillIds: ShapeFillId[];
  paramsByFill: Record<ShapeFillId, Partial<FillParams>>;
  session: ShapeFillSession | null;
  parameterOrder: ShapeFillParamKey[];
  lastFinalize: ShapeFillFinalizePayload | null;
  showOutline: boolean;
  sampleUnderShape: boolean;
  useBackgroundColor: boolean;
}

export type CCReason =
  | 'toolbar'
  | 'brush-stroke'
  | 'stroke-end'
  | 'shape-preview'
  | 'history-apply'
  | 'visibility-hidden'
  | 'layer-switch'
  | 'startup'
  | 'store-sync'
  | 'auto-start'
  | 'shape-tool-start'
  | 'shape-tool-drag'
  | 'pointer-drag'
  | 'layer-create'
  | 'overlay-reinit'
  | 'unknown'
  | 'event';

export interface ColorCycleUIState {
  desiredPlaying: boolean;
  suspendDepth: number;
  lastReason?: CCReason;
  recentReasons?: Array<{ reason: CCReason; ts: number }>;
}

const SHOULD_TRACK_COLOR_CYCLE_REASONS = process.env.NODE_ENV !== 'production';
const MAX_COLOR_CYCLE_RECENT_REASONS = 16;

const appendColorCycleReason = (
  state: ColorCycleUIState,
  reason: CCReason
): ColorCycleUIState['recentReasons'] => {
  if (!SHOULD_TRACK_COLOR_CYCLE_REASONS) {
    return state.recentReasons;
  }
  const base = state.recentReasons ?? [];
  const next = [...base, { reason, ts: Date.now() }];
  const overflow = next.length - MAX_COLOR_CYCLE_RECENT_REASONS;
  return overflow > 0 ? next.slice(overflow) : next;
};

export interface AppState {
  paletteDirty: boolean;
  // Project State
  project: Project | null;
  setProject: (project: Project) => void;
  updateProject: (updates: Partial<Project>) => void;
  setExportLayout: (layout: ExportContainerLayout) => void;
  webglExportSettings: WebGLExportSettings;
  updateWebglExportSettings: (settings: Partial<WebGLExportSettings>) => void;

  // Color Cycle playback state
  colorCyclePlayback: ColorCycleUIState;
  playColorCycle: (reason: CCReason) => void;
  pauseColorCycle: (reason: CCReason) => void;
  suspendColorCycle: (reason: CCReason) => void;
  resumeColorCycle: (reason: CCReason) => void;
  forceResumeColorCycle: (reason: CCReason) => void;
  withColorCycleSuspended: <T>(reason: CCReason, fn: () => T | Promise<T>) => Promise<T>;
  colorCycleRuntimeHandlers: {
    start?: (reason?: string) => void;
    stop?: (reason?: string) => void;
    updateGradient?: (stops: Array<{ position: number; color: string }>) => void;
    setFlowMode?: (mode: 'forward' | 'reverse' | 'pingpong') => void;
    setFlowDirection?: (direction: 'forward' | 'backward') => void;
  };
  setColorCycleRuntimeHandlers: (
    handlers: AppState['colorCycleRuntimeHandlers'] | null
  ) => void;
  
  // Layer composition trigger
  layersNeedRecomposition: boolean;
  setLayersNeedRecomposition: (needed: boolean) => void;
  
  // Global brush settings
  globalBrushSize: number;
  setGlobalBrushSize: (size: number) => void;
  
  // Unified size settings - one for all default brushes, one for all custom brushes
  defaultBrushesSize: number;  // Pixel-based size for all default brushes
  customBrushesSize: number;   // Percentage-based size for all custom brushes
  setDefaultBrushesSize: (size: number) => void;
  setCustomBrushesSize: (size: number) => void;
  
  // Palette State
  palette: PaletteState;
  setPaletteColor: (slot: 'foreground' | 'background', color: string) => void;
  setActiveColor: (color: string) => void;
  swapPaletteColors: () => void;
  setActivePaletteSlot: (slot: 'foreground' | 'background') => void;
  syncPaletteFromTool: (color: string, slot?: 'foreground' | 'background') => void;
  
  // Brush-specific size storage for default brushes (pixel-based) - DEPRECATED
  defaultBrushSizes: Record<string, number>;
  setDefaultBrushSize: (brushId: string, size: number) => void;
  
  // Brush-specific settings storage
  brushSpecificSettings: Record<string, Partial<BrushSettings>>;
  saveBrushSettings: (brushId: string, settings: Partial<BrushSettings>) => void;
  loadBrushSettings: (brushId: string) => Partial<BrushSettings>;
  clearBrushSettings: (brushId: string) => void;
  _saveCurrentBrushSettings: () => void;
  
  // History State
  history: HistoryState;
  undo: () => Promise<CanvasSnapshot | null>;
  redo: () => Promise<CanvasSnapshot | null>;
  canUndo: () => boolean;
  canRedo: () => boolean;
  clearHistory: () => void;

  // Canvas State
  canvas: CanvasState;
  setZoom: (zoom: number) => void;
  setRotation: (rotation: number) => void;
  setGridSize: (size: number) => void;
  setCanvasOffset: (offsetX: number, offsetY: number) => void;
  canvasViewport: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  setCanvasViewport: (viewport: { left: number; top: number; width: number; height: number }) => void;
  toggleRulers: () => void;
  setDisplayMode: (mode: 'pixelated' | 'smooth') => void;
  setCanvasDimensions: (width: number, height: number) => void;
  setProjectDimensions: (width: number, height: number) => void;
  resizeCanvas: (width: number, height: number) => void;
  setSelection: (selection: CanvasState['selection']) => void;
  setCursor: (cursor: CanvasState['cursor']) => void;
  
  // Selection State
  selectionStart: { x: number; y: number } | null;
  selectionEnd: { x: number; y: number } | null;
  setSelectionBounds: (start: { x: number; y: number } | null, end: { x: number; y: number } | null) => void;
  clearSelection: () => void;
  selectAllActiveLayerPixels: () => void;
  deleteSelectedPixels: () => void;

  // Color Adjust Tool
  colorAdjust: ColorAdjustState;
  startColorAdjustSession: () => void;
  updateColorAdjustParams: (params: Partial<ColorAdjustParams>) => void;
  previewColorAdjust: () => void;
  applyColorAdjust: () => Promise<void>;
  cancelColorAdjust: () => void;
  resetColorAdjustParams: () => void;

  // Crop State
  crop: CropState;
  setCropState: (partial: Partial<CropState>) => void;
  resetCrop: () => void;
  commitCrop: (overrideRect?: Rectangle | null) => Promise<void>;
  cancelCrop: () => void;
  
  // Floating Paste State
  floatingPaste: {
    active: boolean;
    imageData: ImageData | null;
    position: { x: number; y: number };
    originalPosition: { x: number; y: number };
    width: number;
    height: number;
    displayWidth: number;
    displayHeight: number;
    sourceLayerId?: string | null;
  } | null;
  setFloatingPaste: (paste: {
    imageData: ImageData;
    position: { x: number; y: number };
    width: number;
    height: number;
    displayWidth?: number;
    displayHeight?: number;
    originalPosition?: { x: number; y: number };
    sourceLayerId?: string | null;
  } | null) => void;
  updateFloatingPastePosition: (position: { x: number; y: number }) => void;
  updateFloatingPasteRect: (rect: { x: number; y: number; width: number; height: number }) => void;
  commitFloatingPaste: () => Promise<void>;
  cancelFloatingPaste: () => void;
  
  // Tool State
  tools: ToolState;
  setCurrentTool: (tool: Tool) => void;
  setBrushSettings: (settings: Partial<BrushSettings>) => void;
  setEraserSettings: (settings: Partial<BrushSettings>) => void;
  setFillSettings: (settings: Partial<ToolState['fillSettings']>) => void;
  setShapeMode: (enabled: boolean) => void;
  
  // Brush Presets
  brushPresets: BrushPreset[];
  currentBrushPreset: BrushPreset | null;
  activeBrushComponents: BrushComponent[];
  setBrushPreset: (preset: BrushPreset, preserveEditMode?: boolean) => void;
  getBrushPresets: () => BrushPreset[];
  getBrushPresetById: (id: string) => BrushPreset | undefined;
  
  // Temporary Custom Brush (for immediate use, not saved to library)
  temporaryCustomBrush: CustomBrush | null;
  setTemporaryCustomBrush: (brush: CustomBrush | null) => void;
  
  // Shape State
  shapeState: ShapeState;
  setShapeDrawing: (isDrawing: boolean) => void;
  addShapePoint: (point: ShapePoint) => void;
  clearShapePoints: () => void;
  setShapePreviewPath: (path: Path2D | undefined) => void;

  // Shape Fill State
  shapeFill: ShapeFillState;
  setShapeFillActiveFill: (fillId: ShapeFillId) => void;
  setShapeFillParameterOrder: (order: ShapeFillParamKey[]) => void;
  setShapeFillParamValue: (
    fillId: ShapeFillId,
    param: keyof FillParams,
    value: number | boolean | undefined
  ) => void;
  setShapeFillShowOutline: (show: boolean) => void;
  setShapeFillSampleUnderShape: (sample: boolean) => void;
  setShapeFillUseBackground: (enabled: boolean) => void;
  beginShapeFillSession: (points: Vec2[]) => void;
  updateShapeFillCursor: (cursor: Vec2) => void;
  commitShapeFillParameter: () => void;
  finalizeShapeFillSession: () => ShapeFillFinalizePayload | null;
  cancelShapeFillSession: () => void;
  
  // Rectangle Brush State
  rectangleBrushState: {
    drawingState: 'idle' | 'definingLength' | 'definingWidth';
    startPos: { x: number; y: number };
    endPos: { x: number; y: number };
    currentPos: { x: number; y: number };
    width: number;
    startColor: string;
    endColor: string;
  };
  setRectangleBrushState: (partialState: Partial<AppState['rectangleBrushState']>) => void;
  
  // Polygon Gradient Brush State
  polygonGradientState: PolygonGradientState;
  setPolygonGradientState: (partialState: Partial<PolygonGradientState>) => void;
  addPolygonGradientPoint: (x: number, y: number, color: string) => void;
  clearPolygonGradientPoints: () => void;

  // Contour lines interactive state
  // Recolor gradient sampling (draw-a-line) state
  recolorSampling: {
    active: boolean;
    start?: { x: number; y: number } | null;
    end?: { x: number; y: number } | null;
    samples?: number; // number of colors to sample along line
    target?: 'recolor' | 'brush'; // where to apply the sampled gradient
  };
  startRecolorSampling: (samples?: number, target?: 'recolor' | 'brush') => void;
  updateRecolorSampling: (partial: Partial<AppState['recolorSampling']>) => void;
  stopRecolorSampling: () => void;
  
  // UI State
  ui: UIState;
  togglePanel: (panel: keyof UIState['panels']) => void;
  toggleModal: (modal: keyof UIState['modals']) => void;
  setTheme: (theme: 'dark' | 'light') => void;
  addNotification: (notification: Omit<UIState['notifications'][0], 'id'>) => void;
  removeNotification: (id: string) => void;
  setKeyboardScope: (scope: KeyboardScope) => void;
  
  // Layer Management
  layers: Layer[];
  activeLayerId: string | null;
  selectedLayerIds: string[];
  referenceLayerId: string | null;
  currentLayer: number;
  addLayer: (layer: Omit<Layer, 'id' | 'order'>) => string;
  removeLayer: (id: string) => void;
  updateLayer: (id: string, updates: Partial<Layer>) => void;
  setActiveLayer: (id: string) => void;
  setLayers: (layers: Layer[]) => void;
  setReferenceLayer: (id: string | null) => void;
  updateLayerAlignment: (layerId: string, alignment: LayerAlignmentSettings) => void;
  reorderLayers: (sourceIndex: number, destinationIndex: number) => void;
  setSelectedLayerIds: (layerIds: string[]) => void;
  
  // Color Cycle Layer Management
  initColorCycleForLayer: (layerId: string, width: number, height: number) => void;
  cleanupColorCycleForLayer: (layerId: string) => void;
  getLayerColorCycleBrush: (layerId: string) => ColorCycleBrushImplementation | null;
  
  // Custom Brush Management
  addCustomBrush: (brush: CustomBrush) => void;
  updateCustomBrush: (brushId: string, updates: Partial<CustomBrush>) => void;
  removeCustomBrush: (brushId: string) => void;
  saveCustomBrushAsPreset: (customBrushId: string) => void;
  
  // Brush Editor State
  brushEditor: BrushEditorState;
  startBrushEdit: (brushId: string, canvas: HTMLCanvasElement) => void;
  saveBrushEdit: (canvas: HTMLCanvasElement) => void;
  cancelBrushEdit: (canvas: HTMLCanvasElement) => void;
  setBrushEditorHue: (hue: number) => void;
  setBrushEditorLightness: (lightness: number) => void;
  setBrushEditorSaturation: (saturation: number) => void;
  updateCurrentBrushTip: (brushTip: {
    imageData: ImageData;
    brushId: string;
    isColorizable: boolean;
    width?: number;
    height?: number;
  }) => void;
  refreshCurrentBrushTipFromSource: () => void;
  
  // Brush Preset Management
  removeBrushPreset: (presetId: string) => void;
  
  // Canvas Reference Management
  currentOffscreenCanvas: HTMLCanvasElement | null;
  setCurrentOffscreenCanvas: (canvas: HTMLCanvasElement | null) => void;
  
  // Project Save/Load Management
  saveProject: (filename?: string) => Promise<void>;
  loadProject: () => Promise<void>;
  exportProject: (format: 'png', options?: { quality?: number; scale?: number }) => Promise<void>;
  newProject: (width: number, height: number, name?: string) => void;
  compositeLayersToCanvas: (targetCanvas: HTMLCanvasElement) => void;
  captureCanvasToActiveLayer: (sourceCanvas?: HTMLCanvasElement, roi?: CaptureROI) => Promise<void>;
  captureCanvasToLayer: (sourceCanvas: HTMLCanvasElement, targetLayerId: string | null) => Promise<void>;
  
  // Autosave State
  autosave: AutosaveState;
  setAutosaveEnabled: (enabled: boolean) => void;
  setFileBackupEnabled: (enabled: boolean) => void;
  setFileBackupMode: (mode: 'single-file' | 'timestamped-files') => void;
  setFileBackupFile: (handle: FileSystemFileHandle | null, path?: string) => void;
  setFileBackupDirectory: (handle: FileSystemDirectoryHandle | null, path?: string) => void;
  clearDirtyState: () => void;
  updateFileBackupTime: () => void;
  setAutosaveInterval: (interval: number) => void;
  setHistorySize: (size: number) => void;
}

// Default states - apply default brush preset to get correct size
const initialBrushPreset = pixelBrushPreset;
const { settings: defaultPresetSettings } = applyBrushPreset(initialBrushPreset);
const defaultBrushSettingsForStore: BrushSettings = {
  ...defaultBrushSettings,
  ...defaultPresetSettings
};

type PersistedColorCycleData = Omit<NonNullable<Layer['colorCycleData']>, 'brushState'> & {
  canvasImageData?: ImageData;
  canvasWidth?: number;
  canvasHeight?: number;
  eraseMaskImageData?: ImageData;
  brushState?: ColorCycleSerializedState | null;
};

type LayerHistorySnapshot = Layer & { colorCycleData?: PersistedColorCycleData };

const cloneImageDataForHistory = (imageData: ImageData | null | undefined): ImageData | undefined => {
  if (!imageData) {
    return undefined;
  }
  return new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
};

interface CloneLayerForHistoryOptions {
  actionType: CanvasSnapshot['actionType'];
  description?: string;
  activeLayerId: string;
  isColorCycleTarget?: boolean;
  isColorCycleAction?: boolean;
  previousLayersById?: Map<string, LayerHistorySnapshot | Layer>;
  contextOptions?: CanvasRenderingContext2DSettings;
}

const cloneLayerForHistory = (
  layer: Layer,
  {
    actionType,
    description,
    activeLayerId,
    isColorCycleTarget = false,
    isColorCycleAction = false,
    previousLayersById,
    contextOptions = { willReadFrequently: true },
  }: CloneLayerForHistoryOptions
): LayerHistorySnapshot => {
  if (
    isColorCycleTarget &&
    isColorCycleAction &&
    previousLayersById &&
    layer.id !== activeLayerId
  ) {
    const previousLayer = previousLayersById.get(layer.id) as LayerHistorySnapshot | Layer | undefined;
    if (previousLayer && 'alignment' in previousLayer) {
      return previousLayer as LayerHistorySnapshot;
    }
  }

  const shouldCloneImageData =
    !!layer.imageData &&
    (!isColorCycleTarget || !isColorCycleAction || layer.id === activeLayerId);
  const clonedImageData = shouldCloneImageData
    ? cloneImageDataForHistory(layer.imageData)
    : layer.imageData;

  const { colorCycleData: _colorCycleData, ...layerWithoutCC } = layer;
  const layerCopy: LayerHistorySnapshot = {
    ...layerWithoutCC,
    layerType: layer.layerType,
    imageData: clonedImageData ?? null,
    alignment: cloneLayerAlignment(layer.alignment),
  };

  if (layer.colorCycleData) {
    let captured: ImageData | undefined;
    const isStructural =
      actionType === 'layer' ||
      actionType === 'layers' ||
      actionType === 'structure' ||
      actionType.startsWith('layer-');
    const isCCActionForLayer =
      isStructural ||
      actionType === 'fill' ||
      (description && (description.includes('CC') || description.includes('Color Cycle')));

    if (!isCCActionForLayer && layer.colorCycleData.canvas) {
      try {
        const ccCtx = layer.colorCycleData.canvas.getContext('2d', contextOptions);
        if (ccCtx) {
          captured = ccCtx.getImageData(
            0,
            0,
            layer.colorCycleData.canvas.width,
            layer.colorCycleData.canvas.height
          );
        }
      } catch {
        captured = undefined;
      }
    }

    let hasCCPixels = Boolean(layer.colorCycleData.hasContent);
    if (captured?.data) {
      const data = captured.data;
      const step = Math.max(4, Math.floor(data.length / 4096));
      for (let i = 3; i < data.length; i += step) {
        if (data[i] > 0) {
          hasCCPixels = true;
          break;
        }
      }
    }

    const shouldCaptureBrushState =
      layer.layerType === 'color-cycle' &&
      (isColorCycleTarget || isCCActionForLayer || layer.id === activeLayerId);
    const existingBrushState = (layer.colorCycleData.brushState ?? null) as ColorCycleSerializedState | null;
    const brushState = shouldCaptureBrushState
      ? captureColorCycleBrushState(layer.id)
      : existingBrushState;

    const canvasImageData = captured ?? layer.colorCycleData.canvasImageData;
    const canvasWidth =
      layer.colorCycleData.canvas?.width ??
      captured?.width ??
      layer.colorCycleData.canvasWidth;
    const canvasHeight =
      layer.colorCycleData.canvas?.height ??
      captured?.height ??
      layer.colorCycleData.canvasHeight;
    const eraseMaskImageData =
      captureCanvasImageData(layer.colorCycleData.eraseMask ?? null) ??
      layer.colorCycleData.eraseMaskImageData;

    layerCopy.layerType = 'color-cycle';
    layerCopy.colorCycleData = {
      ...layer.colorCycleData,
      hasContent: hasCCPixels,
      gradient: layer.colorCycleData.gradient ? [...layer.colorCycleData.gradient] : undefined,
      canvasImageData,
      canvasWidth,
      canvasHeight,
      eraseMaskImageData,
      brushState,
    } satisfies PersistedColorCycleData;
  }

  return layerCopy;
};

interface SnapshotFromStateOptions {
  actionType: CanvasSnapshot['actionType'];
  description: string;
  activeLayerId?: string;
  previousSnapshot?: CanvasSnapshot | null;
  isColorCycleTarget?: boolean;
  isColorCycleAction?: boolean;
}

const createHistorySnapshotFromState = (
  state: AppState,
  {
    actionType,
    description,
    activeLayerId,
    previousSnapshot = null,
    isColorCycleTarget = false,
    isColorCycleAction = false,
  }: SnapshotFromStateOptions
): CanvasSnapshot => {
  const resolvedActiveLayerId =
    activeLayerId ?? state.activeLayerId ?? state.layers[0]?.id ?? '';
  const previousLayersById = previousSnapshot
    ? new Map<string, LayerHistorySnapshot | Layer>(previousSnapshot.layers.map((layer) => [layer.id, layer]))
    : undefined;

  const contextOptions: CanvasRenderingContext2DSettings = { willReadFrequently: true };
  const layersCopy = (state.layers || []).map((layer) =>
    cloneLayerForHistory(layer, {
      actionType,
      description,
      activeLayerId: resolvedActiveLayerId,
      isColorCycleTarget,
      isColorCycleAction,
      previousLayersById,
      contextOptions,
    })
  );

  let colorCycleState: CanvasSnapshot['colorCycleState'] = undefined;
  const activeLayer = (state.layers || []).find((layer) => layer.id === state.activeLayerId);
  const brush = activeLayer?.colorCycleData?.colorCycleBrush;
  const rawState =
    brush?.serialize?.() ??
    brush?.getFullState?.() ??
    null;

  if (activeLayer && isSerializedColorCycleBrushState(rawState) && rawState.layers) {
    colorCycleState = {
      layerId: activeLayer.id,
      strokeData: new ArrayBuffer(0),
      gradients: [],
      animationState: {
        cycleOffset: 0,
        speed: 1,
        fps: 30,
        isPaused: false,
      },
      layerStrokes: rawState.layers.map((layerSnapshot) => {
        const indexBuffer = layerSnapshot.data?.indexBuffer;
        const indexSource = indexBuffer?.data;
        const indexArray = indexSource ? new Uint8Array(indexSource) : null;
        const hasNonZeroIndex = indexArray ? indexArray.some((value) => value !== 0) : false;

        const paintBufferSource = layerSnapshot.strokeData?.paintBuffer;
        const paintBufferArray = paintBufferSource ? new Uint8Array(paintBufferSource) : null;
        const paintBufferCopy = paintBufferArray ? paintBufferArray.slice().buffer : new ArrayBuffer(0);

        const animatorIndex = indexBuffer
          ? {
              width: indexBuffer.width,
              height: indexBuffer.height,
              data: (indexArray ? indexArray.slice() : new Uint8Array()).buffer,
              gradientStops: layerSnapshot.data?.gradient?.gradientStops || undefined,
            }
          : undefined;

        return {
          layerId: layerSnapshot.layerId,
          paintBuffer: paintBufferCopy,
          hasContent: Boolean(layerSnapshot.strokeData?.hasContent) || hasNonZeroIndex,
          strokeCounter: layerSnapshot.strokeData?.strokeCounter ?? 0,
          strokeLength: 0,
          gradientLayerIndices: [],
          currentGradientIndex: 0,
          animatorIndex,
        };
      }),
    };
  }

  return {
    id: `snapshot_${Date.now()}_${Math.random()}`,
    timestamp: Date.now(),
    layers: layersCopy,
    activeLayerId: resolvedActiveLayerId,
    actionType,
    description,
    colorCycleState,
    projectSize: state.project
      ? {
          width: state.project.width,
          height: state.project.height,
        }
      : undefined,
    canvasState: state.canvas
      ? {
          canvasWidth: state.canvas.canvasWidth,
          canvasHeight: state.canvas.canvasHeight,
          offsetX: state.canvas.offsetX,
          offsetY: state.canvas.offsetY,
          zoom: state.canvas.zoom,
        }
      : undefined,
  };
};

interface SerializedColorCycleLayerSnapshot {
  layerId: string;
  data?: {
    indexBuffer?: {
      width: number;
      height: number;
      data?: ArrayBufferLike | Uint8Array;
      gradient?: {
        gradientStops?: Array<{ position: number; color: string }>;
      };
    };
    gradient?: {
      gradientStops?: Array<{ position: number; color: string }>;
    };
  };
  strokeData?: {
    paintBuffer?: ArrayBufferLike;
    hasContent?: boolean;
    strokeCounter?: number;
  };
}

interface SerializedColorCycleBrushState {
  layers?: SerializedColorCycleLayerSnapshot[];
  cycleSpeed?: number;
  fps?: number;
  brushSize?: number;
}

const isSerializedColorCycleBrushState = (value: unknown): value is SerializedColorCycleBrushState => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const maybeState = value as { layers?: unknown };
  if (maybeState.layers !== undefined && !Array.isArray(maybeState.layers)) {
    return false;
  }
  return true;
};


const defaultCanvasState: CanvasState = {
  zoom: 1,
  rotation: 0,
  gridSize: 16,
  showRulers: false,
  displayMode: 'pixelated',
  canvasWidth: 2000,
  canvasHeight: 2000,
  offsetX: 0,
  offsetY: 0,
  selection: {
    active: false,
    bounds: { x: 0, y: 0, width: 0, height: 0 },
    pixels: typeof ImageData !== 'undefined' ? new ImageData(1, 1) : {} as ImageData
  },
  cursor: {
    x: 0,
    y: 0,
    pressure: 0
  }
};

const defaultToolState: ToolState = {
  currentTool: 'brush',
  previousTool: 'brush',
  lastRegularTool: 'brush',
  lastRegularBrushShape: BrushShape.SQUARE,
  lastRegularShapeMode: false,
  lastColorCycleShapeMode: false,
  brushSettings: defaultBrushSettingsForStore,
  eraserSettings: {
    ...defaultBrushSettingsForStore,
    blendMode: 'destination-out',
    color: 'rgba(255, 255, 255, 0.1)',
    linkSizeToBrush: true
  },
  fillSettings: {
    threshold: 0,
    contiguous: true,
    eraseInstead: false
  },
  shapeMode: false
};

const defaultCropState: CropState = {
  status: 'idle',
  marquee: null,
  activeHandle: null,
  commitInFlight: false
};

const defaultUIState: UIState = {
  panels: {
    leftToolbar: true,
    rightToolbar: true,
    timeline: true,
    layerPanel: true,
    brushPanel: true
  },
  modals: {
    export: false,
    settings: false,
    help: false,
    document: false
  },
  theme: 'dark',
  notifications: [],
  keyboardScope: 'canvas'
};

const defaultHistoryState: HistoryState = {
  undoStack: [],
  redoStack: [],
  maxHistorySize: 50,
  isCapturing: false
};

const defaultBrushEditorState: BrushEditorState = {
  status: 'IDLE',
  editingBrushId: null,
  editingBounds: null,
  originalCanvasState: null,
  hueShift: 0,
  lightness: 0,
  saturation: 100
};

const defaultShapeState: ShapeState = {
  isDrawing: false,
  points: [],
  previewPath: undefined
};

const defaultShapeFillStrategies = listFillStrategies();
const defaultShapeFillIds = defaultShapeFillStrategies.map(strategy => strategy.id);
const defaultShapeFillParams = defaultShapeFillStrategies.reduce<Record<ShapeFillId, Partial<FillParams>>>(
  (acc, strategy) => {
    acc[strategy.id] = { ...strategy.defaults };
    return acc;
  },
  {} as Record<ShapeFillId, Partial<FillParams>>
);

const defaultShapeFillState: ShapeFillState = {
  activeFillId: defaultShapeFillIds[0] ?? 'hatch',
  availableFillIds: defaultShapeFillIds,
  paramsByFill: defaultShapeFillParams,
  session: null,
  parameterOrder: ['spacing', 'rotation'],
  lastFinalize: null,
  showOutline: false,
  sampleUnderShape: false,
  useBackgroundColor: false,
};

const SHAPE_FILL_STORAGE_KEY = 'vessel-shape-fill-settings';

const cloneVec2 = (vec: Vec2 | undefined): Vec2 | undefined =>
  vec ? { x: vec.x, y: vec.y } : undefined;

const cloneShapeSession = (session: ShapeFillSession | null): ShapeFillSession | null => {
  if (!session) {
    return null;
  }
  return {
    ...session,
    points: session.points.map((point) => ({ ...point })),
    params: { ...(session.params ?? {}) },
    paramQueue: [...session.paramQueue],
    shape: session.shape
      ? {
          ...session.shape,
          points: session.shape.points.map((point) => ({ ...point })),
          centroid: { ...session.shape.centroid },
          bounds: { ...session.shape.bounds },
        }
      : undefined,
    cursorAnchorDirection: cloneVec2(session.cursorAnchorDirection),
    lastCursor: cloneVec2(session.lastCursor),
  };
};

type PersistedShapeFillSnapshot = {
  activeFillId?: ShapeFillId;
  paramsByFill?: Record<string, Partial<FillParams>>;
  showOutline?: boolean;
  sampleUnderShape?: boolean;
  useBackgroundColor?: boolean;
};

const VALID_FILL_PARAM_KEYS: (keyof FillParams)[] = [
  'spacing',
  'rotation',
  'thickness',
  'variance',
  'seed',
  'dashLength',
  'dashLengthJitter',
  'dashWeightJitter',
  'scatter',
  'nearFalloff',
  'farFalloff',
  'angleDrift',
  'angleScale',
  'segments',
  'sierraDensity',
  'sierraResolution',
  'organic',
  'cross',
  'flowSeedSpacing',
  'flowStepSize',
  'flowMaxSteps',
  'flowFieldStep',
  'flowUseOrthogonal',
  'noiseScale',
  'noiseContrast',
  'noiseThreshold',
  'noiseOctaves',
  'noiseRandomness',
];

const VALID_FILL_PARAM_KEY_SET = new Set<keyof FillParams>(VALID_FILL_PARAM_KEYS);

const cloneDefaultShapeFillParams = (): Record<ShapeFillId, Partial<FillParams>> => {
  return defaultShapeFillStrategies.reduce<Record<ShapeFillId, Partial<FillParams>>>(
    (acc, strategy) => {
      acc[strategy.id] = { ...(defaultShapeFillParams[strategy.id] ?? {}) };
      return acc;
    },
    {} as Record<ShapeFillId, Partial<FillParams>>
  );
};

const sanitizePersistedParams = (
  _fillId: ShapeFillId,
  params: unknown
): Partial<FillParams> => {
  if (!params || typeof params !== 'object') {
    return {};
  }

  const sanitized: Partial<FillParams> = {};
  Object.entries(params as Record<string, unknown>).forEach(([key, value]) => {
    if (!VALID_FILL_PARAM_KEY_SET.has(key as keyof FillParams)) {
      return;
    }

    if (key === 'cross') {
      // Crosshatch toggle removed; ignore persisted flag.
      return;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      sanitized[key as keyof FillParams] = value as never;
    }
  });

  return sanitized;
};

const loadPersistedShapeFillState = (): PersistedShapeFillSnapshot | null => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(SHAPE_FILL_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as PersistedShapeFillSnapshot;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
};

const persistShapeFillState = (state: ShapeFillState): void => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }

  const snapshot: PersistedShapeFillSnapshot = {
    activeFillId: state.activeFillId,
    paramsByFill: state.paramsByFill,
    showOutline: state.showOutline,
    sampleUnderShape: state.sampleUnderShape,
    useBackgroundColor: state.useBackgroundColor,
  };

  try {
    window.localStorage.setItem(SHAPE_FILL_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Ignore quota and serialization errors — persistence is best effort.
  }
};

const createInitialShapeFillState = (): ShapeFillState => {
  const base: ShapeFillState = {
    ...defaultShapeFillState,
    paramsByFill: cloneDefaultShapeFillParams(),
  };

  const persisted = loadPersistedShapeFillState();
  if (!persisted) {
    return base;
  }

  if (persisted.paramsByFill && typeof persisted.paramsByFill === 'object') {
    Object.entries(persisted.paramsByFill).forEach(([id, params]) => {
      if (!base.availableFillIds.includes(id as ShapeFillId)) {
        return;
      }

      const fillId = id as ShapeFillId;
      const sanitized = sanitizePersistedParams(fillId, params);

      base.paramsByFill[fillId] = {
        ...base.paramsByFill[fillId],
        ...sanitized,
      };
    });
  }

  if (persisted.activeFillId && base.availableFillIds.includes(persisted.activeFillId)) {
    base.activeFillId = persisted.activeFillId;
  }

  if (typeof persisted.showOutline === 'boolean') {
    base.showOutline = persisted.showOutline;
  }

  if (typeof persisted.sampleUnderShape === 'boolean') {
    base.sampleUnderShape = persisted.sampleUnderShape;
  }

  if (typeof persisted.useBackgroundColor === 'boolean') {
    base.useBackgroundColor = persisted.useBackgroundColor;
  }

  if (typeof window !== 'undefined') {
    persistShapeFillState(base);
  }

  return base;
};

const pickFillParamsForPersist = (params: FillParams, defaults: FillParams): Partial<FillParams> => {
  const persisted: Partial<FillParams> = {};
  (Object.keys(defaults) as (keyof FillParams)[]).forEach(key => {
    const value = params[key];
    if (value !== undefined) {
      persisted[key] = value as never;
    }
  });
  return persisted;
};

const defaultRectangleBrushState = {
  drawingState: 'idle' as const,
  startPos: { x: 0, y: 0 },
  endPos: { x: 0, y: 0 },
  currentPos: { x: 0, y: 0 },
  width: 0,
  startColor: 'white',
  endColor: 'white',
};

const defaultPolygonGradientState: PolygonGradientState = {
  drawingState: 'idle',
  points: [],
  previewPath: undefined,
  rotationReferenceAngle: undefined,
  rotationInitialRotation: undefined,
  tempSize: undefined,
  sizeReferenceDistance: undefined,
  sizeInitialSize: undefined,
  spacingReferenceDistance: undefined,
  spacingReferenceSpacing: undefined,
  flowRandomSeed: undefined,
  mode: undefined,
  tempRotation: undefined,
  tempSpacing: undefined,
  tempMaxSteps: undefined,
  tempOrientation: undefined,
  tempNoiseStrength: undefined,
  gpuJobId: undefined,
  vertices: undefined,
  fillColor: undefined,
  adjustmentStartPos: undefined,
};

export const useAppStore = create<AppState>()(
  // TEMPORARILY DISABLE DEVTOOLS TO SEE IF IT'S THE CAUSE
  // devtools(
    (set, get) => {
      
      // Expose store globally for debugging and test utilities
      if (typeof window !== 'undefined') {
        setTimeout(() => {
          (window as Window & { __vesselStore?: typeof useAppStore }).__vesselStore = useAppStore;
        }, 0);
      }

      const shapeFillOrchestratorInstance = new ShapeFillOrchestrator();
      shapeFillOrchestratorInstance.setParameterOrder(defaultShapeFillState.parameterOrder);

      shapeFillOrchestratorInstance.setSessionListener((session) => {
        const nextSession = cloneShapeSession(session);
        set((state) => ({
          shapeFill: {
            ...state.shapeFill,
            session: nextSession,
          },
        }));
      });
      
      setActiveHistoryDocument('default-project');

      const initialPalette = createDefaultPalette();

      return {
        paletteDirty: false,
        // Project State
        project: {
          id: 'default-project',
          name: 'Untitled',
          width: DEFAULT_CANVAS_WIDTH,
          height: DEFAULT_CANVAS_HEIGHT,
          layers: [],
          backgroundColor: 'transparent',
          createdAt: new Date(),
          updatedAt: new Date(),
          customBrushes: [],
          brushSpecificSettings: {},
          exportLayout: createDefaultExportLayout(),
          palette: initialPalette
        },
        palette: initialPalette,
        webglExportSettings: {
          includeHiddenLayers: true,
          embedCanvasFallback: false,
          minifyOutput: true,
          bundleFormat: 'single-html',
          enableGobletDiagnostics: process.env.NODE_ENV !== 'production',
          htmlTitle: 'Goblet'
        },
      setProject: (project) => set((state) => {
        const normalized = normalizeProject(project);
        setActiveHistoryDocument(normalized.id);
        const nextPalette = normalized.palette ?? createDefaultPalette();
        const projectWithPalette = {
          ...normalized,
          palette: nextPalette
        };
        const nextTools = {
          ...state.tools,
          brushSettings: {
            ...state.tools.brushSettings,
            color: nextPalette.foregroundColor
          },
          eraserSettings:
            state.tools.currentTool === 'eraser'
              ? { ...state.tools.eraserSettings, color: nextPalette.foregroundColor }
              : state.tools.eraserSettings
        };
        return {
          project: projectWithPalette,
          palette: nextPalette,
          tools: nextTools,
          paletteDirty: false
        };
      }),
      updateProject: (updates) => set((state) => {
        if (!state.project) {
          return { project: null };
        }

        const baseProject = {
          ...state.project,
          ...updates,
          exportLayout: 'exportLayout' in updates
            ? cloneExportLayout(updates.exportLayout)
            : cloneExportLayout(state.project.exportLayout)
        };

        const normalized = normalizeProject(baseProject);

        if (normalized.id) {
          setActiveHistoryDocument(normalized.id);
        }

        const nextPalette = normalized.palette ?? state.palette ?? createDefaultPalette();
        const projectWithPalette = {
          ...normalized,
          palette: nextPalette
        };
        const nextTools = {
          ...state.tools,
          brushSettings: {
            ...state.tools.brushSettings,
            color: nextPalette.foregroundColor
          },
          eraserSettings:
            state.tools.currentTool === 'eraser'
              ? { ...state.tools.eraserSettings, color: nextPalette.foregroundColor }
              : state.tools.eraserSettings
        };

        return {
          project: projectWithPalette,
          palette: nextPalette,
          tools: nextTools,
          paletteDirty: false,
          referenceLayerId: null
        };
      }),
      setExportLayout: (layout) => set((state) => {
        if (!state.project) {
          return state;
        }

        return {
          project: {
            ...state.project,
            exportLayout: cloneExportLayout(layout),
            updatedAt: new Date()
          }
        };
      }),
      updateWebglExportSettings: (settings) => set((state) => {
        const { enableViewerDiagnostics, ...rest } = settings as Partial<WebGLExportSettings> & { enableViewerDiagnostics?: boolean };
        return {
          webglExportSettings: {
            ...state.webglExportSettings,
            ...rest,
            ...(typeof enableViewerDiagnostics === 'boolean'
              ? { enableGobletDiagnostics: enableViewerDiagnostics }
              : {})
          }
        };
      }),

      colorCyclePlayback: {
        desiredPlaying: false,
        suspendDepth: 0,
        lastReason: 'startup',
        recentReasons: SHOULD_TRACK_COLOR_CYCLE_REASONS ? [] : undefined
      },
      playColorCycle: (reason) => set((state) => ({
        colorCyclePlayback: {
          ...state.colorCyclePlayback,
          desiredPlaying: true,
          lastReason: reason,
          recentReasons: appendColorCycleReason(state.colorCyclePlayback, reason)
        }
      })),
      pauseColorCycle: (reason) => set((state) => ({
        colorCyclePlayback: {
          ...state.colorCyclePlayback,
          desiredPlaying: false,
          lastReason: reason,
          recentReasons: appendColorCycleReason(state.colorCyclePlayback, reason)
        }
      })),
      suspendColorCycle: (reason) => set((state) => {
        const playback = state.colorCyclePlayback;
        const nextDepth = Math.max(0, playback.suspendDepth) + 1;
        return {
          colorCyclePlayback: {
            ...playback,
            suspendDepth: nextDepth,
            lastReason: reason,
            recentReasons: appendColorCycleReason(playback, reason)
          }
        };
      }),
      resumeColorCycle: (reason) => set((state) => {
        const playback = state.colorCyclePlayback;
        const nextDepth = Math.max(0, playback.suspendDepth - 1);
        return {
          colorCyclePlayback: {
            ...playback,
            suspendDepth: nextDepth,
            lastReason: reason,
            recentReasons: appendColorCycleReason(playback, reason)
          }
        };
      }),
      forceResumeColorCycle: (reason) => set((state) => ({
        colorCyclePlayback: {
          ...state.colorCyclePlayback,
          suspendDepth: 0,
          lastReason: reason,
          recentReasons: appendColorCycleReason(state.colorCyclePlayback, reason)
        }
      })),
      withColorCycleSuspended: async (reason, fn) => {
        const { suspendColorCycle, resumeColorCycle } = get();
        suspendColorCycle(reason);
        try {
          return await fn();
        } finally {
          resumeColorCycle(reason);
        }
      },
      colorCycleRuntimeHandlers: {},
      setColorCycleRuntimeHandlers: (handlers) => set(() => ({
        colorCycleRuntimeHandlers: handlers ?? {}
      })),
      
      // Global brush settings
      globalBrushSize: defaultBrushSettingsForStore.size ?? 5,
      
      // Unified size settings - one for all default brushes, one for all custom brushes
      defaultBrushesSize: 5,   // 5px for all default brushes
      customBrushesSize: 100,  // 100% for all custom brushes
      setGlobalBrushSize: (size) => set((state) => {
        const tools = state.tools;
        const currentSettings = tools.brushSettings;
        const isCustomBrush = currentSettings.brushShape === BrushShape.CUSTOM;

        // Update the appropriate unified size based on brush type
        const newState: { globalBrushSize: number; customBrushesSize?: number; defaultBrushesSize?: number } = { globalBrushSize: size };
        
        if (isCustomBrush) {
          // Update custom brushes size
          newState.customBrushesSize = size;
        } else {
          // Update default brushes size
          newState.defaultBrushesSize = size;
        }
        
        const updatedBrushSettings = {
          ...tools.brushSettings,
          size
        };
        
        const shouldSyncEraser = tools.eraserSettings.linkSizeToBrush !== false;
        const updatedEraserSettings = shouldSyncEraser
          ? { ...tools.eraserSettings, size }
          : tools.eraserSettings;

        return {
          ...newState,
          tools: {
            ...tools,
            brushSettings: updatedBrushSettings,
            eraserSettings: updatedEraserSettings
          }
        };
      }),
      
      // Default brush sizes storage (initialize with common defaults)
      defaultBrushSizes: {
        'pixel-brush': 1,
        'default-brush': 5,
        'round-pixel-4': 4,
        'round-soft-4': 4,
        'round-square-6': 6,
        'ink-brush': 10
      },
      setDefaultBrushSize: (brushId, size) => set((state) => ({
        defaultBrushSizes: {
          ...state.defaultBrushSizes,
          [brushId]: size
        }
      })),
      
      // Unified size setter functions
      setDefaultBrushesSize: (size) => set(() => ({
        defaultBrushesSize: size
        // Do not sync globalBrushSize here - it should only be synced during brush switching
      })),
      setCustomBrushesSize: (size) => set(() => ({
        customBrushesSize: size
        // Do not sync globalBrushSize here - it should only be synced during brush switching
      })),
      
      setPaletteColor: (slot, color) => set((state) => {
        const currentColor =
          slot === 'background'
            ? state.palette.backgroundColor
            : state.palette.foregroundColor;
        if (currentColor === color) {
          return state;
        }

        const nextPalette: PaletteState =
          slot === 'background'
            ? { ...state.palette, backgroundColor: color }
            : { ...state.palette, foregroundColor: color };

        const result: Partial<AppState> = {
          palette: nextPalette,
          paletteDirty: true,
        };

        if (state.project) {
          result.project = { ...state.project, palette: nextPalette };
        }

        if (slot === 'foreground') {
          result.tools = {
            ...state.tools,
            brushSettings: {
              ...state.tools.brushSettings,
              color,
            },
          };
        }

        return result;
      }),
      setActiveColor: (color) => {
        const slot = (get().palette.activeSlot ?? 'foreground');
        get().setPaletteColor(slot, color);
      },
      swapPaletteColors: () => set((state) => {
        const nextPalette: PaletteState = {
          ...state.palette,
          foregroundColor: state.palette.backgroundColor,
          backgroundColor: state.palette.foregroundColor
        };
        if (
          state.palette.foregroundColor === nextPalette.foregroundColor &&
          state.palette.backgroundColor === nextPalette.backgroundColor
        ) {
          return state;
        }
        return {
          palette: nextPalette,
          paletteDirty: true
        };
      }),
      setActivePaletteSlot: (slot) => set((state) => {
        if (state.palette.activeSlot === slot) {
          return state;
        }
        const nextPalette: PaletteState = {
          ...state.palette,
          activeSlot: slot
        };
        return {
          palette: nextPalette
        };
      }),
      syncPaletteFromTool: (color, slot = 'foreground') => set((state) => {
        const nextPalette: PaletteState =
          slot === 'background'
            ? { ...state.palette, backgroundColor: color }
            : { ...state.palette, foregroundColor: color };
        if (
          state.palette.foregroundColor === nextPalette.foregroundColor &&
          state.palette.backgroundColor === nextPalette.backgroundColor
        ) {
          return state;
        }
        return {
          palette: nextPalette,
          paletteDirty: true
        };
      }),
      
      // Brush-specific settings storage (in-memory, separate from project)
      brushSpecificSettings: {},
      
      // Layer composition trigger
      layersNeedRecomposition: false,
      setLayersNeedRecomposition: (needed) => {
        // Layer recomposition flag updated
        set({ layersNeedRecomposition: needed });
      },
      
      // Canvas State
      canvas: defaultCanvasState,
      canvasViewport: {
        left: 0,
        top: 0,
        width: 0,
        height: 0
      },

      // History State
      history: defaultHistoryState,
      setZoom: (zoom) => set((state) => ({
        canvas: { ...state.canvas, zoom: Math.max(MIN_CANVAS_ZOOM, Math.min(MAX_CANVAS_ZOOM, zoom)) }
      })),
      setRotation: (rotation) => set((state) => ({
        canvas: { ...state.canvas, rotation }
      })),
      setGridSize: (gridSize) => set((state) => ({
        canvas: { ...state.canvas, gridSize }
      })),
      setCanvasOffset: (offsetX, offsetY) => set((state) => {
        if (state.canvas.offsetX === offsetX && state.canvas.offsetY === offsetY) {
          return state;
        }
        return {
          canvas: { ...state.canvas, offsetX, offsetY }
        };
      }),
      setCanvasViewport: (viewport) => set((state) => {
        const { left, top, width, height } = state.canvasViewport;
        if (
          left === viewport.left &&
          top === viewport.top &&
          width === viewport.width &&
          height === viewport.height
        ) {
          return state;
        }
        return {
          canvasViewport: viewport
        };
      }),
      toggleRulers: () => set((state) => ({
        canvas: { ...state.canvas, showRulers: !state.canvas.showRulers }
      })),
      setDisplayMode: (mode) => set((state) => ({
        canvas: { ...state.canvas, displayMode: mode }
      })),
      setCanvasDimensions: (width, height) => set((state) => ({
        canvas: { ...state.canvas, canvasWidth: width, canvasHeight: height }
      })),
      setProjectDimensions: (width, height) => set((state) => ({
        project: state.project ? { ...state.project, width, height } : null
      })),
      resizeCanvas: (width, height) => set((state) => {
        if (!state.project) return state;
        
        const oldWidth = state.project.width;
        const oldHeight = state.project.height;
        
        
        // Calculate offset to center content
        const offsetX = (width - oldWidth) / 2;
        const offsetY = (height - oldHeight) / 2;
        
        // Update project dimensions
        const updatedProject = { ...state.project, width, height };
        
        // Resize layers while preserving content position from center
        const resizedLayers = state.layers.map(layer => {
          // Create new offscreen canvas with new dimensions
          const newFramebuffer = new OffscreenCanvas(width, height);
          const newCtx = newFramebuffer.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
          
          if (newCtx) {
            // First, ensure the old framebuffer has the latest imageData
            if (layer.imageData && layer.framebuffer) {
              const oldCtx = layer.framebuffer.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
              if (oldCtx) {
                // Sync imageData to framebuffer before copying
                oldCtx.clearRect(0, 0, layer.framebuffer.width, layer.framebuffer.height);
                oldCtx.putImageData(layer.imageData, 0, 0);
              }
            }
            
            // Now draw the synced framebuffer content centered in new canvas
            if (layer.framebuffer) {
              newCtx.drawImage(layer.framebuffer, offsetX, offsetY);
            }
            
            // Get imageData from the new framebuffer for compatibility
            const newImageData = newCtx.getImageData(0, 0, width, height);
            
            return {
              ...layer,
              imageData: newImageData,
              framebuffer: newFramebuffer,
              // CRITICAL: Preserve layerType and colorCycleData
              layerType: layer.layerType,
              colorCycleData: layer.colorCycleData
            };
          }
          
          return layer;
        });
        
        // Reset zoom to default value
        
        const syncedLayers = syncPercentOffsetsFromPixels(resizedLayers, updatedProject);

        return {
          project: updatedProject,
          layers: syncedLayers,
          canvas: { 
            ...state.canvas,
            zoom: 1,         // Reset to default zoom
            canvasWidth: width, 
            canvasHeight: height,
            needsDimensionUpdate: true 
          },
          layersNeedRecomposition: true
        };
      }),
      setSelection: (selection) => set((state) => ({
        canvas: { ...state.canvas, selection }
      })),
      setCursor: (cursor) => set((state) => ({
        canvas: { ...state.canvas, cursor }
      })),
      
      // Selection State
      selectionStart: null,
      selectionEnd: null,
      setSelectionBounds: (start, end) => set({ selectionStart: start, selectionEnd: end }),
      clearSelection: () => set({ selectionStart: null, selectionEnd: null }),
      selectAllActiveLayerPixels: () => {
        const state = get();
        const { project, layers, activeLayerId } = state;

        const activeLayer = activeLayerId
          ? layers.find(layer => layer.id === activeLayerId) ?? null
          : null;

        const width = activeLayer?.imageData?.width
          ?? activeLayer?.framebuffer?.width
          ?? project?.width;
        const height = activeLayer?.imageData?.height
          ?? activeLayer?.framebuffer?.height
          ?? project?.height;

        if (!width || !height) {
          return;
        }

        set({
          selectionStart: { x: 0, y: 0 },
          selectionEnd: { x: width, y: height }
        });
      },
      deleteSelectedPixels: () => {
        const state = get();
        const { selectionStart, selectionEnd, layers, activeLayerId, project } = state;
        
        if (!selectionStart || !selectionEnd || !project) return;
        
        const activeLayer = layers.find(l => l.id === activeLayerId);
        if (!activeLayer || !activeLayer.imageData || !activeLayerId) return;
        
        // Calculate selection bounds
        const x = Math.min(selectionStart.x, selectionEnd.x);
        const y = Math.min(selectionStart.y, selectionEnd.y);
        const width = Math.abs(selectionEnd.x - selectionStart.x);
        const height = Math.abs(selectionEnd.y - selectionStart.y);
        
        if (width <= 0 || height <= 0) return;

        const selectionBefore = selectionSnapshotFromValues(selectionStart, selectionEnd);
        
        const beforeImage = cloneLayerImageData(activeLayer.imageData);
        const beforeColorState =
          activeLayer.layerType === 'color-cycle'
            ? captureColorCycleBrushState(activeLayer.id)
            : null;

        // Create a copy of the image data
        const newImageData = new ImageData(
          new Uint8ClampedArray(activeLayer.imageData.data),
          activeLayer.imageData.width,
          activeLayer.imageData.height
        );
        
        // Clear pixels within selection bounds
        for (let py = Math.max(0, Math.floor(y)); py < Math.min(newImageData.height, Math.ceil(y + height)); py++) {
          for (let px = Math.max(0, Math.floor(x)); px < Math.min(newImageData.width, Math.ceil(x + width)); px++) {
            const index = (py * newImageData.width + px) * 4;
            newImageData.data[index] = 0;     // R
            newImageData.data[index + 1] = 0; // G
            newImageData.data[index + 2] = 0; // B
            newImageData.data[index + 3] = 0; // A
          }
        }
        
        // Update the layer - this will trigger a state change
        state.updateLayer(activeLayerId, { imageData: newImageData });
        
        // Trigger recomposition to update the canvas immediately
        set({ layersNeedRecomposition: true });

        // Clear selection before committing history so the delta captures UI state changes
        state.clearSelection();

        void commitLayerHistory({
          layerId: activeLayerId,
          beforeImage,
          beforeColorState,
          actionType: 'delete',
          description: 'Delete selected pixels',
          tool: 'selection',
          selectionBefore,
        }).catch((error) => {
          if (process.env.NODE_ENV !== 'production') {
            console.warn('[history] Failed to record selection delete', error);
          }
        });
      },

      // Color Adjust Tool
      colorAdjust: createDefaultColorAdjustState(),
      startColorAdjustSession: () => {
        const state = get();
        const { activeLayerId, layers } = state;
        if (!activeLayerId) {
          set({ colorAdjust: createDefaultColorAdjustState() });
          return;
        }

        const layer = layers.find((l) => l.id === activeLayerId);
        if (!layer || layer.layerType !== 'normal' || !layer.imageData) {
          set({ colorAdjust: createDefaultColorAdjustState() });
          return;
        }

        const originalImageData = cloneLayerImageData(layer.imageData);
        if (!originalImageData) {
          set({ colorAdjust: createDefaultColorAdjustState() });
          return;
        }

        const selectionFromBounds =
          state.selectionStart && state.selectionEnd
            ? {
                x: Math.min(state.selectionStart.x, state.selectionEnd.x),
                y: Math.min(state.selectionStart.y, state.selectionEnd.y),
                width: Math.abs(state.selectionEnd.x - state.selectionStart.x),
                height: Math.abs(state.selectionEnd.y - state.selectionStart.y)
              }
            : null;
        const canvasSelection = state.canvas.selection;
        const rawBounds =
          selectionFromBounds && selectionFromBounds.width > 0 && selectionFromBounds.height > 0
            ? selectionFromBounds
            : canvasSelection?.active
              ? canvasSelection.bounds
              : null;
        const selectionBounds = clampSelectionBounds(rawBounds, originalImageData.width, originalImageData.height);

        set({
          colorAdjust: {
            active: true,
            targetLayerId: layer.id,
            originalImageData,
            selectionBounds,
            params: { ...defaultColorAdjustParams }
          }
        });
        scheduleColorAdjustPreview(get);
      },
      updateColorAdjustParams: (params) => {
        let didUpdate = false;
        set((state) => {
          if (!state.colorAdjust.active) {
            return state;
          }

          didUpdate = true;
          return {
            colorAdjust: {
              ...state.colorAdjust,
              params: {
                ...state.colorAdjust.params,
                ...params
              }
            }
          };
        });

        if (didUpdate) {
          scheduleColorAdjustPreview(get);
        }
      },
      previewColorAdjust: () => {
        const state = get();
        const { colorAdjust } = state;
        if (!colorAdjust.active || !colorAdjust.targetLayerId || !colorAdjust.originalImageData) {
          return;
        }

        const layer = state.layers.find((l) => l.id === colorAdjust.targetLayerId);
        if (!layer || layer.layerType !== 'normal') {
          return;
        }

        const { params, selectionBounds, originalImageData } = colorAdjust;
        const hasAdjustments =
          params.hue !== 0 || params.saturation !== 0 || params.lightness !== 0 || params.contrast !== 0;

        let finalImageData: ImageData;
        if (!hasAdjustments) {
          const baselineImage = cloneLayerImageData(originalImageData) ?? originalImageData;
          finalImageData = baselineImage;
        } else {
          const adjustedImage = applyColorAdjustments(originalImageData, params);
          if (selectionBounds) {
            const compositeImage = cloneLayerImageData(originalImageData);
            if (!compositeImage) {
              return;
            }
            copyRegionIntoTarget(adjustedImage, compositeImage, selectionBounds);
            finalImageData = compositeImage;
          } else {
            finalImageData = adjustedImage;
          }
        }

        state.updateLayer(layer.id, { imageData: finalImageData });
        set({ layersNeedRecomposition: true });
      },
      applyColorAdjust: async () => {
        const state = get();
        const { colorAdjust } = state;
        if (!colorAdjust.active || !colorAdjust.targetLayerId || !colorAdjust.originalImageData) {
          return;
        }

        cancelScheduledColorAdjustPreview();

        const layer = state.layers.find((l) => l.id === colorAdjust.targetLayerId);
        if (!layer || layer.layerType !== 'normal') {
          set({ colorAdjust: createDefaultColorAdjustState() });
          return;
        }

        const beforeImage = cloneLayerImageData(colorAdjust.originalImageData);
        if (!beforeImage) {
          set({ colorAdjust: createDefaultColorAdjustState() });
          return;
        }

        // Ensure the latest params are rendered prior to committing history
        get().previewColorAdjust();

        const selectionSnapshot =
          state.selectionStart && state.selectionEnd
            ? selectionSnapshotFromValues(state.selectionStart, state.selectionEnd)
            : null;

        await commitLayerHistory({
          layerId: layer.id,
          beforeImage,
          beforeColorState: null,
          actionType: 'color-adjust',
          description: 'Color adjust',
          tool: 'color-adjust',
          selectionBefore: selectionSnapshot ?? undefined,
          bitmapRoi: colorAdjust.selectionBounds ?? undefined
        }).catch((error) => {
          if (process.env.NODE_ENV !== 'production') {
            console.warn('[history] Failed to record color adjust', error);
          }
        });

        const refreshedLayer = get().layers.find((l) => l.id === layer.id);
        const updatedBaseline = refreshedLayer?.imageData
          ? cloneLayerImageData(refreshedLayer.imageData)
          : null;

        if (updatedBaseline) {
          set((prev) => ({
            colorAdjust: {
              active: true,
              targetLayerId: layer.id,
              originalImageData: updatedBaseline,
              selectionBounds: prev.colorAdjust.selectionBounds,
              params: { ...defaultColorAdjustParams }
            }
          }));
        } else {
          set({ colorAdjust: createDefaultColorAdjustState() });
        }
      },
      cancelColorAdjust: () => {
        const state = get();
        const { colorAdjust } = state;
        if (!colorAdjust.active || !colorAdjust.targetLayerId || !colorAdjust.originalImageData) {
          set({ colorAdjust: createDefaultColorAdjustState() });
          return;
        }

        cancelScheduledColorAdjustPreview();

        const layer = state.layers.find((l) => l.id === colorAdjust.targetLayerId);
        if (layer && layer.layerType === 'normal') {
          const restoredImage = cloneLayerImageData(colorAdjust.originalImageData);
          if (restoredImage) {
            state.updateLayer(layer.id, { imageData: restoredImage });
            set({ layersNeedRecomposition: true });
          }
        }

        set({ colorAdjust: createDefaultColorAdjustState() });
      },
      resetColorAdjustParams: () => {
        let didReset = false;
        set((state) => {
          if (!state.colorAdjust.active) {
            return state;
          }

          didReset = true;
          return {
            colorAdjust: {
              ...state.colorAdjust,
              params: { ...defaultColorAdjustParams }
            }
          };
        });

        if (didReset) {
          scheduleColorAdjustPreview(get);
        }
      },

      // Crop State
      crop: defaultCropState,
      setCropState: (partial) =>
        set((state) => ({
          crop: {
            ...state.crop,
            ...partial
          }
        })),
      resetCrop: () => set({ crop: defaultCropState }),
      cancelCrop: () => set({ crop: defaultCropState }),
      commitCrop: async (overrideRect) => {
        const state = get();
        const cropState = state.crop;

        if (cropState.commitInFlight) {
          return;
        }

        const sourceRect = overrideRect ?? cropState.marquee;
        const project = state.project;
        const normalizedRect = normalizeCropRect(sourceRect ?? null, project);

        if (!sourceRect || !normalizedRect || !project) {
          set({ crop: defaultCropState });
          return;
        }

        set((prev) => ({
          crop: {
            ...prev.crop,
            commitInFlight: true
          }
        }));

        try {
          const beforeProject =
            project != null
              ? {
                  width: project.width,
                  height: project.height,
                }
              : null;
          const beforeLayerSnapshots = new Map<
            string,
            { image: ImageData | null; colorState: ColorCycleSerializedState }
          >();
          state.layers.forEach((layer) => {
            beforeLayerSnapshots.set(layer.id, {
              image: cloneLayerImageData(layer.imageData),
              colorState:
                layer.layerType === 'color-cycle'
                  ? captureColorCycleBrushState(layer.id)
                  : null,
            });
          });
          const {
            updatedProject,
            updatedLayers,
            colorCycleBrushResets,
            recolorRebuildQueue
          } = applyCroppedLayers({
            project,
            layers: state.layers,
            rect: normalizedRect,
            activeLayerId: state.activeLayerId ?? null,
            syncPercentOffsetsFromPixels
          });

          const currentCanvas = state.canvas;
          const currentZoom = currentCanvas?.zoom ?? 1;
          const nextOffsetX = (currentCanvas?.offsetX ?? 0) + normalizedRect.x * currentZoom;
          const nextOffsetY = (currentCanvas?.offsetY ?? 0) + normalizedRect.y * currentZoom;

          const nextCanvasState = currentCanvas
            ? {
                ...currentCanvas,
                canvasWidth: normalizedRect.width,
                canvasHeight: normalizedRect.height,
                offsetX: nextOffsetX,
                offsetY: nextOffsetY,
                selection: {
                  active: false,
                  bounds: { x: 0, y: 0, width: 0, height: 0 },
                  pixels:
                    currentCanvas.selection?.pixels ??
                    (typeof ImageData !== 'undefined' ? new ImageData(1, 1) : ({} as ImageData))
                }
              }
            : currentCanvas;

          set((prev) => ({
            project: updatedProject,
            layers: updatedLayers,
            canvas: nextCanvasState,
            selectionStart: null,
            selectionEnd: null,
            floatingPaste: null,
            layersNeedRecomposition: true,
            crop: {
              ...prev.crop,
              marquee: null,
              status: 'ready',
              activeHandle: null,
              commitInFlight: true
            }
          }));

          const postState = get();
          const { compositeLayersToCanvas } = postState;

          if (compositeLayersToCanvas) {
            if (typeof document !== 'undefined') {
              const croppedCanvas = document.createElement('canvas');
              croppedCanvas.width = normalizedRect.width;
              croppedCanvas.height = normalizedRect.height;
              compositeLayersToCanvas(croppedCanvas);
              set({ currentOffscreenCanvas: croppedCanvas });
            } else if (postState.currentOffscreenCanvas) {
              compositeLayersToCanvas(postState.currentOffscreenCanvas);
            }
          }

          await recordCropHistory({
            beforeProject,
            afterProject: postState.project
              ? { width: postState.project.width, height: postState.project.height }
              : null,
            beforeLayers: beforeLayerSnapshots,
            afterLayers: postState.layers,
            description: 'Crop to selection',
          });

          set({ crop: defaultCropState });

          if (colorCycleBrushResets.length > 0) {
            rebuildCCLayerAfterCrop({
              entries: colorCycleBrushResets,
              colorCycleBrushManager,
              getState: get,
              setState: set,
              syncCCRuntimes,
              logError
            });
          }

          if (recolorRebuildQueue.length > 0) {
            const manager = RecolorManager.getInstance();
            rebuildRecolorLayersAfterCrop({
              queue: recolorRebuildQueue,
              getState: get,
              setState: set,
              processLayer: (layer, options) => manager.processLayer(layer, options),
              logError
            });
          }
        } catch (error) {
          logError('[crop] Failed to commit crop', error);
          set({ crop: defaultCropState });
        } finally {
          set((prev) => ({
            crop: {
              ...prev.crop,
              commitInFlight: false
            }
          }));
        }
      },
      // Floating Paste State
      floatingPaste: null,
      setFloatingPaste: (paste) => set({ 
        floatingPaste: paste ? {
          active: true,
          imageData: paste.imageData,
          position: paste.position,
          originalPosition: paste.originalPosition ?? paste.position,
          width: paste.width,
          height: paste.height,
          displayWidth: paste.displayWidth ?? paste.width,
          displayHeight: paste.displayHeight ?? paste.height,
          sourceLayerId: paste.sourceLayerId ?? null
        } : null 
      }),
      updateFloatingPastePosition: (position) => set((state) => ({
        floatingPaste: state.floatingPaste ? {
          ...state.floatingPaste,
          position
        } : null
      })),
      updateFloatingPasteRect: (rect) => set((state) => ({
        floatingPaste: state.floatingPaste ? {
          ...state.floatingPaste,
          position: { x: rect.x, y: rect.y },
          displayWidth: rect.width,
          displayHeight: rect.height
        } : null
      })),
      commitFloatingPaste: async () => {
        const state = get();
        const { floatingPaste, layers, activeLayerId, project } = state;

        if (!floatingPaste || !floatingPaste.imageData || !project) return;

        const activeLayer = layers.find(l => l.id === activeLayerId) || layers[0];
        if (!activeLayer) return;

        const beforeImage =
          activeLayer.imageData ? cloneImageDataForHistory(activeLayer.imageData) ?? null : null;
        const beforeColorState =
          activeLayer.layerType === 'color-cycle'
            ? captureColorCycleBrushState(activeLayer.id)
            : null;

        // Create a temporary canvas to merge existing layer content + floating paste
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = project.width;
        tempCanvas.height = project.height;
        const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });

        if (tempCtx) {
          // Draw existing layer content when available
          if (activeLayer.imageData) {
            // Fast path when ImageData is present
            try {
              tempCtx.putImageData(activeLayer.imageData, 0, 0);
            } catch {}
          } else if (activeLayer.framebuffer) {
            // Fallback: draw from framebuffer if imageData is not yet populated
            try {
              tempCtx.drawImage(activeLayer.framebuffer, 0, 0);
            } catch {}
          }

          // Draw floating paste at its position
          const pasteCanvas = document.createElement('canvas');
          pasteCanvas.width = floatingPaste.width;
          pasteCanvas.height = floatingPaste.height;
          const pasteCtx = pasteCanvas.getContext('2d', { willReadFrequently: true });
          if (pasteCtx) {
            pasteCtx.putImageData(floatingPaste.imageData, 0, 0);
            tempCtx.drawImage(
              pasteCanvas,
              floatingPaste.position.x,
              floatingPaste.position.y,
              Math.round(floatingPaste.displayWidth),
              Math.round(floatingPaste.displayHeight)
            );
          }

          // Capture composited result to the active layer
          await state.captureCanvasToActiveLayer(tempCanvas);

          await commitLayerHistory({
            layerId: activeLayer.id,
            beforeImage,
            beforeColorState,
            actionType: 'paste',
            description: 'Committed paste',
            tool: 'paste',
          });
        }

        // Clear floating paste
        set({ floatingPaste: null });
      },
      cancelFloatingPaste: () => {
        const state = get();
        const floatingPaste = state.floatingPaste;

        if (floatingPaste && floatingPaste.imageData && floatingPaste.sourceLayerId) {
          const targetLayer = state.layers.find(l => l.id === floatingPaste.sourceLayerId);
          let layerImageData = targetLayer?.imageData || null;

          if (!layerImageData && targetLayer?.framebuffer) {
            try {
              const tempCanvas = document.createElement('canvas');
              tempCanvas.width = targetLayer.framebuffer.width;
              tempCanvas.height = targetLayer.framebuffer.height;
              const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
              if (tempCtx) {
                tempCtx.drawImage(targetLayer.framebuffer, 0, 0);
                layerImageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
              }
            } catch {
              layerImageData = null;
            }
          }

          if (layerImageData) {
            const restoredLayerData = new Uint8ClampedArray(layerImageData.data);
            const pasteData = floatingPaste.imageData.data;
            const pasteWidth = floatingPaste.imageData.width;
            const pasteHeight = floatingPaste.imageData.height;
            const baseX = Math.max(0, Math.min(layerImageData.width, Math.round(floatingPaste.originalPosition.x)));
            const baseY = Math.max(0, Math.min(layerImageData.height, Math.round(floatingPaste.originalPosition.y)));

            for (let y = 0; y < pasteHeight; y++) {
              const targetY = baseY + y;
              if (targetY < 0 || targetY >= layerImageData.height) continue;

              for (let x = 0; x < pasteWidth; x++) {
                const targetX = baseX + x;
                if (targetX < 0 || targetX >= layerImageData.width) continue;

                const destIndex = (targetY * layerImageData.width + targetX) * 4;
                const srcIndex = (y * pasteWidth + x) * 4;

                restoredLayerData[destIndex] = pasteData[srcIndex];
                restoredLayerData[destIndex + 1] = pasteData[srcIndex + 1];
                restoredLayerData[destIndex + 2] = pasteData[srcIndex + 2];
                restoredLayerData[destIndex + 3] = pasteData[srcIndex + 3];
              }
            }

            const restoredImage = new ImageData(restoredLayerData, layerImageData.width, layerImageData.height);
            state.updateLayer(floatingPaste.sourceLayerId, { imageData: restoredImage });
            set({ floatingPaste: null, layersNeedRecomposition: true });
            return;
          }
        }

        set({ floatingPaste: null });
      },
      
      // Tool State
      tools: (() => {
        return defaultToolState;
      })(),
      // Helper function to save current brush settings
      _saveCurrentBrushSettings: () => {
        const state = get();
        const { tools, currentBrushPreset, brushSpecificSettings } = state;
        const currentTool = tools.currentTool;
        const currentBrushSettings = tools.brushSettings;
        
        const brushIdToSave = currentBrushPreset?.id ?? 
            (currentBrushSettings.brushShape === BrushShape.CUSTOM && currentBrushSettings.selectedCustomBrush
                ? currentBrushSettings.selectedCustomBrush
                : null);

        if (brushIdToSave && (currentTool === 'brush' || currentTool === 'custom')) {
          const existingSettings = brushSpecificSettings[brushIdToSave] || {};
          const settingsToSave = {
              ...existingSettings,
              ...getSerializableBrushSettings(currentBrushSettings),
          };
          set(prevState => ({
            brushSpecificSettings: {
                ...prevState.brushSpecificSettings,
                [brushIdToSave]: settingsToSave,
            },
          }));
        }
      },
      setCurrentTool: (tool) => {
        const stateBeforeSwitch = get();
        // Save current settings before switching
        stateBeforeSwitch._saveCurrentBrushSettings();
        const shapeFillSession = stateBeforeSwitch.shapeFill.session;
        const isShapeFillActive =
          !!shapeFillSession &&
          stateBeforeSwitch.tools.currentTool === 'brush' &&
          stateBeforeSwitch.tools.brushSettings.brushShape === BrushShape.SHAPE_FILL;
        const toolChanged = tool !== stateBeforeSwitch.tools.currentTool;

        if (isShapeFillActive && toolChanged) {
          stateBeforeSwitch.cancelShapeFillSession();
        }
        
        // Clear temporary brush and selection when switching to or re-selecting custom tool
        if (tool === 'custom') {
          // Clear these immediately before the state update
          const currentState = get();
          
          if (currentState.temporaryCustomBrush) {
            
            get().setTemporaryCustomBrush(null);
          }
          if (currentState.selectionStart || currentState.selectionEnd) {
            
            get().clearSelection();
          }
        }

        if (stateBeforeSwitch.tools.currentTool === 'crop' && tool !== 'crop') {
          set({ crop: defaultCropState });
        }
        
        try {
          set((state) => {

        const newBrushSettings = { ...state.tools.brushSettings };
        const wasShapeFillBrush = state.tools.brushSettings.brushShape === BrushShape.SHAPE_FILL;
        const currentToolSupportsShapes = isShapeCapableTool(state.tools.currentTool);
        const nextToolSupportsShapes = isShapeCapableTool(tool);
        const isCurrentColorCycleBrush = isColorCycleBrushShape(state.tools.brushSettings.brushShape);
        
        // Track last regular tool and brush shape when switching from regular brush
        let lastRegularTool = state.tools.lastRegularTool;
        let lastRegularBrushShape = state.tools.lastRegularBrushShape;
        let lastRegularShapeMode = state.tools.lastRegularShapeMode;
        let lastColorCycleShapeMode = state.tools.lastColorCycleShapeMode;
        
        if ((state.tools.currentTool === 'brush' || state.tools.currentTool === 'eraser') &&
            tool !== 'brush' && tool !== 'eraser') {
          // Switching away from regular brush/eraser - save current settings
          lastRegularTool = state.tools.currentTool;
          lastRegularBrushShape = state.tools.brushSettings.brushShape;
        }

        // Reset custom brush state when switching to incompatible tools
        // Preserve custom brush when switching from 'custom' to 'brush' tool
        if (state.tools.currentTool === 'custom' && tool !== 'custom' && tool !== 'brush') {
          newBrushSettings.brushShape = BrushShape.ROUND; // Reset to default shape
          newBrushSettings.selectedCustomBrush = null;
        }

        // Clear currentBrushTip when switching to custom tool
        if (tool === 'custom') {
          newBrushSettings.currentBrushTip = undefined;
        }

        // Reset shapeMode and clear shape state when switching away from brush/eraser tools
        let newShapeMode = state.tools.shapeMode;
        if (wasShapeFillBrush && tool !== 'brush') {
          newShapeMode = false;
        }

        if (currentToolSupportsShapes && !nextToolSupportsShapes) {
          if (isCurrentColorCycleBrush) {
            lastColorCycleShapeMode = state.tools.shapeMode;
          } else {
            lastRegularShapeMode = state.tools.shapeMode;
          }
          newShapeMode = false;
        } else if (!currentToolSupportsShapes && nextToolSupportsShapes) {
          const nextIsColorCycleBrush = isColorCycleBrushShape(newBrushSettings.brushShape);
          newShapeMode = nextIsColorCycleBrush
            ? (lastColorCycleShapeMode ?? false)
            : (lastRegularShapeMode ?? false);
        }

        if ((state.tools.currentTool === 'brush' || state.tools.currentTool === 'eraser' || state.tools.currentTool === 'custom') &&
            tool !== 'brush' && tool !== 'eraser' && tool !== 'custom') {
          newShapeMode = false;
          // Clear any active shape drawing sessions
          get().setPolygonGradientState({
            drawingState: 'idle',
            points: [],
            vertices: undefined,
            fillColor: undefined,
          });
          get().setRectangleBrushState({
            drawingState: 'idle',
            startPos: { x: 0, y: 0 },
            endPos: { x: 0, y: 0 }
          });
        }

        return {
          tools: {
            ...state.tools,
            previousTool: state.tools.currentTool,
            currentTool: tool,
            lastRegularTool: lastRegularTool,
            lastRegularBrushShape: lastRegularBrushShape,
            lastRegularShapeMode,
            lastColorCycleShapeMode,
            brushSettings: newBrushSettings,
            shapeMode: newShapeMode
          }
        };
        });
        } catch {}

        if (tool === COLOR_ADJUST_TOOL) {
          const store = get();
          if (!store.colorAdjust.active || toolChanged) {
            store.startColorAdjustSession();
          }
        } else if (stateBeforeSwitch.tools.currentTool === COLOR_ADJUST_TOOL) {
          const store = get();
          if (stateBeforeSwitch.colorAdjust?.active) {
            store.cancelColorAdjust();
          } else {
            set({ colorAdjust: createDefaultColorAdjustState() });
          }
        }
      },
      setBrushSettings: (incomingSettings) => set((state) => {
        // quiet
        try {
        const settings = {
          ...incomingSettings,
        } as Partial<BrushSettings> & { colorCycleFlowForward?: boolean };

        if (settings.colorCycleFlowForward !== undefined) {
          settings.colorCycleFlowMode = settings.colorCycleFlowForward === false ? 'reverse' : 'forward';
          delete settings.colorCycleFlowForward;
        }

        const currentSettings = state.tools.brushSettings;
        const newSettings = { ...currentSettings, ...settings };
        const explicitGradientVersion = settings.colorCycleGradientVersion;
        if (settings.colorCycleGradient !== undefined && explicitGradientVersion === undefined) {
          const gradientChanged = !gradientsEqual(
            currentSettings.colorCycleGradient,
            settings.colorCycleGradient
          );
          if (gradientChanged) {
            newSettings.colorCycleGradientVersion =
              (currentSettings.colorCycleGradientVersion ?? 0) + 1;
          } else if (currentSettings.colorCycleGradientVersion !== undefined) {
            newSettings.colorCycleGradientVersion = currentSettings.colorCycleGradientVersion;
          }
        } else if (explicitGradientVersion !== undefined) {
          newSettings.colorCycleGradientVersion = explicitGradientVersion;
        } else if (
          newSettings.colorCycleGradientVersion === undefined &&
          currentSettings.colorCycleGradientVersion !== undefined
        ) {
          newSettings.colorCycleGradientVersion = currentSettings.colorCycleGradientVersion;
        }
        
        // If size is being changed, update global size
        if (settings.size !== undefined) {
          get().setGlobalBrushSize(settings.size);
        }
        
        // Auto-save brush-specific settings when they change (excluding size)
        // Determine current brush ID (standard brush preset or custom brush)
        const currentBrushId = state.currentBrushPreset 
          ? state.currentBrushPreset.id 
          : (currentSettings.brushShape === BrushShape.CUSTOM && currentSettings.selectedCustomBrush 
             ? currentSettings.selectedCustomBrush 
             : null);
             
        // Store brush settings to save for later
        let brushSettingsToSave: { brushId: string; settings: Partial<BrushSettings> } | null = null;
        
        if (currentBrushId) {
          // Get existing saved settings for this brush
          const existingSavedSettings = state.brushSpecificSettings[currentBrushId] || {};
          
          // Merge with new settings
          const settingsToSave: Partial<BrushSettings> = {
            ...existingSavedSettings
          };
          
          // Update with changed settings
          if (settings.size !== undefined) settingsToSave.size = newSettings.size;
          if (settings.opacity !== undefined) settingsToSave.opacity = newSettings.opacity;
          if (settings.spacing !== undefined) settingsToSave.spacing = newSettings.spacing;
          if (settings.colorJitter !== undefined) settingsToSave.colorJitter = newSettings.colorJitter;
          if (settings.risographIntensity !== undefined) settingsToSave.risographIntensity = newSettings.risographIntensity;
          if (settings.ditherEnabled !== undefined) settingsToSave.ditherEnabled = newSettings.ditherEnabled;
          if (settings.fillResolution !== undefined) settingsToSave.fillResolution = newSettings.fillResolution;
          if (settings.pressureEnabled !== undefined) settingsToSave.pressureEnabled = newSettings.pressureEnabled;
          if (settings.minPressure !== undefined) settingsToSave.minPressure = newSettings.minPressure;
          if (settings.maxPressure !== undefined) settingsToSave.maxPressure = newSettings.maxPressure;
          if (settings.rotationEnabled !== undefined) settingsToSave.rotationEnabled = newSettings.rotationEnabled;
          if (settings.dashedEnabled !== undefined) settingsToSave.dashedEnabled = newSettings.dashedEnabled;
          if (settings.dashLength !== undefined) settingsToSave.dashLength = newSettings.dashLength;
          if (settings.dashGap !== undefined) settingsToSave.dashGap = newSettings.dashGap;
          if (settings.gridSnapEnabled !== undefined) settingsToSave.gridSnapEnabled = newSettings.gridSnapEnabled;
          if (settings.shapeEnabled !== undefined) settingsToSave.shapeEnabled = newSettings.shapeEnabled;
          if (settings.antialiasing !== undefined) settingsToSave.antialiasing = newSettings.antialiasing;
          if (settings.hueShift !== undefined) settingsToSave.hueShift = newSettings.hueShift;
          if (settings.lightnessAdjust !== undefined) settingsToSave.lightnessAdjust = newSettings.lightnessAdjust;
          if (settings.saturationAdjust !== undefined) settingsToSave.saturationAdjust = newSettings.saturationAdjust;
          if (settings.colors !== undefined) settingsToSave.colors = newSettings.colors;
          if (settings.rectGradientPresetId !== undefined) settingsToSave.rectGradientPresetId = newSettings.rectGradientPresetId;
          if (settings.continuousSampling !== undefined) settingsToSave.continuousSampling = newSettings.continuousSampling;
          if (settings.resampleInterval !== undefined) settingsToSave.resampleInterval = newSettings.resampleInterval;
          if (settings.colorCycleGradient !== undefined) {
            settingsToSave.colorCycleGradient = newSettings.colorCycleGradient;
          }
          if (settings.colorCycleFlowMode !== undefined) {
            settingsToSave.colorCycleFlowMode = newSettings.colorCycleFlowMode;
          }
          if (
            settings.colorCycleGradient !== undefined ||
            settings.colorCycleGradientVersion !== undefined
          ) {
            settingsToSave.colorCycleGradientVersion = newSettings.colorCycleGradientVersion;
          }
          
          brushSettingsToSave = { brushId: currentBrushId, settings: settingsToSave };
        }
        
        // Handle brush size restoration when switching between custom and regular brushes
        let newGlobalBrushSize: number | undefined;
        if (newSettings.brushShape !== undefined) {
          const wasCustom = currentSettings.brushShape === BrushShape.CUSTOM;
          const isCustom = newSettings.brushShape === BrushShape.CUSTOM;
          
          if (!wasCustom && isCustom) {
            // Switching TO custom brush: save current regular size and use custom size
            newSettings.lastRegularBrushSize = currentSettings.size;
            newSettings.size = state.customBrushesSize;
            newGlobalBrushSize = state.customBrushesSize;
          } else if (wasCustom && !isCustom) {
            // Switching FROM custom brush: restore last regular size or use default
            const restoredSize = currentSettings.lastRegularBrushSize !== undefined 
              ? currentSettings.lastRegularBrushSize 
              : state.defaultBrushesSize;
            newSettings.size = restoredSize;
            newGlobalBrushSize = restoredSize;
            // Clear stale custom brush tip data when switching away from custom brushes
            newSettings.currentBrushTip = undefined;
            newSettings.selectedCustomBrush = null;
          }
          
          // Only clear specific brush caches, not all memory when brush type changes
          if (wasCustom !== isCustom) {
            try {
              // Clear only brush-specific caches, preserve other caches for performance
              brushCache.clear();
              scaledBrushCache.clear();
            } catch {
              // Cache cleanup failed, continue silently
            }
          }
        }
        
        // CRITICAL: Always clear currentBrushTip for standard brushes to prevent contamination
        // But ONLY if we're not in the process of setting it to CUSTOM with a currentBrushTip
        if (newSettings.brushShape !== BrushShape.CUSTOM && !settings.currentBrushTip) {
          newSettings.currentBrushTip = undefined;
          newSettings.selectedCustomBrush = null;
        }
        
        // Update lastRegularBrushSize when size changes for regular brushes
        if (settings.size !== undefined && 
            newSettings.brushShape !== BrushShape.CUSTOM) {
          newSettings.lastRegularBrushSize = settings.size;
        }
        
        
        // Keep brush editor adjustments in sync while editing
        let nextBrushEditor = state.brushEditor;
        if (state.brushEditor.status === 'EDITING') {
          const nextHueShift = settings.hueShift !== undefined
            ? settings.hueShift
            : newSettings.hueShift !== undefined
              ? newSettings.hueShift
              : state.brushEditor.hueShift;
          const nextLightness = settings.lightnessAdjust !== undefined
            ? settings.lightnessAdjust
            : newSettings.lightnessAdjust !== undefined
              ? newSettings.lightnessAdjust
              : state.brushEditor.lightness;
          const nextSaturation = settings.saturationAdjust !== undefined
            ? settings.saturationAdjust
            : newSettings.saturationAdjust !== undefined
              ? newSettings.saturationAdjust
              : state.brushEditor.saturation;

          if (
            nextHueShift !== state.brushEditor.hueShift ||
            nextLightness !== state.brushEditor.lightness ||
            nextSaturation !== state.brushEditor.saturation
          ) {
            nextBrushEditor = {
              ...state.brushEditor,
              hueShift: nextHueShift,
              lightness: nextLightness,
              saturation: nextSaturation
            };
          }
        }
        
        // Clear temporary brush when switching away from custom brushes
        let updatedState = {
          ...state,
          tools: {
            ...state.tools,
            brushSettings: newSettings
          },
          // Update globalBrushSize if we're switching brush types
          ...(newGlobalBrushSize !== undefined ? { globalBrushSize: newGlobalBrushSize } : {})
        };

        if (nextBrushEditor !== state.brushEditor) {
          updatedState = {
            ...updatedState,
            brushEditor: nextBrushEditor
          };
        }
        
        
        // Apply brush settings save if needed (avoid circular dependency)
        if (brushSettingsToSave) {
          updatedState = {
            ...updatedState,
            brushSpecificSettings: {
              ...updatedState.brushSpecificSettings,
              [brushSettingsToSave.brushId]: brushSettingsToSave.settings
            }
          };
        }
        
        if (newSettings.color !== currentSettings.color) {
          const nextPalette: PaletteState = {
            ...state.palette,
            foregroundColor: newSettings.color ?? state.palette.foregroundColor
          };
          const projectValue = updatedState.project;
          updatedState = {
            ...updatedState,
            palette: nextPalette,
            project: projectValue ? { ...projectValue, palette: nextPalette } : projectValue
          };
        }
        
        // If switching away from custom brush, discard temporary brush
        if (newSettings.brushShape !== undefined && 
            currentSettings.brushShape === BrushShape.CUSTOM && 
            newSettings.brushShape !== BrushShape.CUSTOM) {
          return {
            ...updatedState,
            temporaryCustomBrush: null
          };
        }
        
        return updatedState;
        } catch (error) {
          debugLog('brush-error', 'Failed to apply brush settings', error);
          // Return state unchanged on failure to prevent app crash
          return state;
        }
      }),
      setEraserSettings: (settings) => set((state) => {
        const next = { ...state.tools.eraserSettings, ...settings };
        if (settings.linkSizeToBrush === true) {
          const syncSize = state.globalBrushSize ?? next.size;
          if (typeof syncSize === 'number') {
            next.size = syncSize;
          }
        }
        let paletteUpdate: PaletteState | null = null;
        if (
          settings.color !== undefined &&
          state.palette.activeSlot === 'foreground' &&
          state.tools.currentTool === 'eraser' &&
          state.palette.foregroundColor !== settings.color
        ) {
          paletteUpdate = {
            ...state.palette,
            foregroundColor: settings.color
          };
        }

        const nextTools: ToolState = {
          ...state.tools,
          eraserSettings: next,
          brushSettings: paletteUpdate
            ? { ...state.tools.brushSettings, color: paletteUpdate.foregroundColor }
            : state.tools.brushSettings
        };
        if (!paletteUpdate) {
          return { tools: nextTools };
        }
        return {
          tools: nextTools,
          palette: paletteUpdate,
          project: state.project ? { ...state.project, palette: paletteUpdate } : null
        };
      }),
      setFillSettings: (settings) => set((state) => ({
        tools: {
          ...state.tools,
          fillSettings: { ...state.tools.fillSettings, ...settings }
        }
      })),
      setShapeMode: (enabled) => set((state) => {
        try {
          // Gate noisy logs behind debug toggle
          debugLog('shape-store', 'setShapeMode', {
            enabled,
            prev: state.tools.shapeMode,
            tool: state.tools.currentTool,
            brushShape: state.tools.brushSettings.brushShape,
            selectedCustomBrush: state.tools.brushSettings.selectedCustomBrush,
          });
        } catch {}

        const isCC = state.tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE ||
                      state.tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE_TRIANGLE ||
                      state.tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE_SHAPE;
        return {
          tools: {
            ...state.tools,
            shapeMode: enabled,
            // Persist per-domain shape mode memories so switching brushes restores expected state
            ...(isCC ? { lastColorCycleShapeMode: enabled } : { lastRegularShapeMode: enabled })
          }
        };
      }),
      
      // Brush Presets
      brushPresets,
      currentBrushPreset: initialBrushPreset,
      activeBrushComponents: initialBrushPreset.components,
      
      // Temporary Custom Brush
      temporaryCustomBrush: null,
      setTemporaryCustomBrush: (brush) => set({ temporaryCustomBrush: brush }),
      
      // Shape State
      shapeState: defaultShapeState,
      setShapeDrawing: (isDrawing) => set((state) => ({
        shapeState: { ...state.shapeState, isDrawing }
      })),
      addShapePoint: (point) => set((state) => ({
        shapeState: { 
          ...state.shapeState, 
          points: [...state.shapeState.points, point] 
        }
      })),
      clearShapePoints: () => set((state) => ({
        shapeState: { 
          ...state.shapeState, 
          points: [], 
          previewPath: undefined 
        }
      })),
      setShapePreviewPath: (path) => set((state) => ({
        shapeState: { ...state.shapeState, previewPath: path }
      })),
      
      // Shape Fill State
      shapeFill: createInitialShapeFillState(),
      setShapeFillActiveFill: (fillId) => {
        const current = get();
        if (!current.shapeFill.availableFillIds.includes(fillId)) {
          return;
        }
        set((state) => ({
          shapeFill: { ...state.shapeFill, activeFillId: fillId }
        }));
        persistShapeFillState(get().shapeFill);
      },
      setShapeFillParameterOrder: (order) => {
        shapeFillOrchestratorInstance.setParameterOrder(order);
        set((state) => ({
          shapeFill: { ...state.shapeFill, parameterOrder: [...order] }
        }));
      },
      setShapeFillParamValue: (fillId, param, value) => {
        const current = get();
        if (!current.shapeFill.availableFillIds.includes(fillId)) {
          return;
        }

        set((state) => ({
          shapeFill: {
            ...state.shapeFill,
            paramsByFill: {
              ...state.shapeFill.paramsByFill,
              [fillId]: {
                ...(state.shapeFill.paramsByFill[fillId] ?? {}),
                [param]: value as never,
              },
            },
          },
        }));
        persistShapeFillState(get().shapeFill);

        const session = shapeFillOrchestratorInstance.getSession();
        const activeFillId = get().shapeFill.activeFillId;
        if (session && activeFillId === fillId) {
          shapeFillOrchestratorInstance.setParameterValue(param, value);
        }
      },
      setShapeFillShowOutline: (show) => {
        set((state) => ({
          shapeFill: {
            ...state.shapeFill,
            showOutline: show,
          },
        }));
        persistShapeFillState(get().shapeFill);
      },
      setShapeFillSampleUnderShape: (sample) => {
        set((state) => ({
          shapeFill: {
            ...state.shapeFill,
            sampleUnderShape: sample,
          },
        }));
        persistShapeFillState(get().shapeFill);
      },
      setShapeFillUseBackground: (enabled) => {
        set((state) => ({
          shapeFill: {
            ...state.shapeFill,
            useBackgroundColor: enabled,
          },
        }));
        persistShapeFillState(get().shapeFill);
      },
      beginShapeFillSession: (points) => {
        const state = get();
        const fillId = state.shapeFill.activeFillId;
        const strategy = getFillStrategy(fillId);
        const baseParams = state.shapeFill.paramsByFill[fillId] ?? strategy.defaults;
        shapeFillOrchestratorInstance.begin(fillId, strategy, points, baseParams);
        set((prevState) => ({
          shapeFill: {
            ...prevState.shapeFill,
            lastFinalize: null,
          },
        }));
      },
      updateShapeFillCursor: (cursor) => {
        shapeFillOrchestratorInstance.updateCursor(cursor);
      },
      commitShapeFillParameter: () => {
        shapeFillOrchestratorInstance.commitCurrentParameter();
      },
      finalizeShapeFillSession: () => {
        const payload = shapeFillOrchestratorInstance.finalize();
        if (payload) {
          const strategy = getFillStrategy(payload.fillId);
          set((state) => ({
            shapeFill: {
              ...state.shapeFill,
              lastFinalize: payload,
              paramsByFill: {
                ...state.shapeFill.paramsByFill,
                [payload.fillId]: {
                  ...state.shapeFill.paramsByFill[payload.fillId],
                  ...pickFillParamsForPersist(payload.params, strategy.defaults),
                },
              },
            },
          }));
          persistShapeFillState(get().shapeFill);
        }
        return payload;
      },
      cancelShapeFillSession: () => {
        const previousSession = shapeFillOrchestratorInstance.getSession();
        shapeFillOrchestratorInstance.cancel();

        const shouldRecordDelta =
          previousSession != null && previousSession.stage !== FillStage.Finalized;

        if (shouldRecordDelta) {
          const delta = createShapeSessionDelta({ forward: null, backward: previousSession });
          if (delta) {
            const txn = historyManager.begin('shape-session');
            txn.push(delta);
            txn.commit('Cancel Shape Session');
          }
        }

        set((currentState) => ({
          shapeFill: {
            ...currentState.shapeFill,
          },
        }));
      },
      
      // Rectangle Brush State
      rectangleBrushState: defaultRectangleBrushState,
      setRectangleBrushState: (partialState) => set((state) => ({
        rectangleBrushState: { ...state.rectangleBrushState, ...partialState }
      })),
      
      // Polygon Gradient Brush State
      polygonGradientState: defaultPolygonGradientState,
      setPolygonGradientState: (partialState) => set((state) => ({
        polygonGradientState: { ...state.polygonGradientState, ...partialState }
      })),
      addPolygonGradientPoint: (x, y, color) => set((state) => ({
        polygonGradientState: {
          ...state.polygonGradientState,
          points: [...state.polygonGradientState.points, { x, y, color }]
        }
      })),
      clearPolygonGradientPoints: () => set((state) => ({
        polygonGradientState: {
          ...state.polygonGradientState,
          points: [],
          previewPath: undefined
        }
      })),

      // Recolor/Brush gradient sampling state
      recolorSampling: { active: false, start: null, end: null, samples: 8, target: 'recolor' },
      startRecolorSampling: (samples, target) => set(() => ({
        recolorSampling: { active: true, start: null, end: null, samples: samples ?? 8, target: target ?? 'recolor' }
      })),
      updateRecolorSampling: (partial) => set((state) => ({
        recolorSampling: { ...state.recolorSampling, ...partial }
      })),
      stopRecolorSampling: () => set(() => ({
        recolorSampling: { active: false, start: null, end: null, samples: 8, target: 'recolor' }
      })),
      
      // Canvas Reference
      currentOffscreenCanvas: null,
      setCurrentOffscreenCanvas: (canvas) => set({ currentOffscreenCanvas: canvas }),
      setBrushPreset: (preset, preserveEditMode = false) => {
        const stateBeforeSwitch = get();
        // Save current settings before switching
        stateBeforeSwitch._saveCurrentBrushSettings();

        if (
          stateBeforeSwitch.shapeFill.session &&
          stateBeforeSwitch.tools.brushSettings.brushShape === BrushShape.SHAPE_FILL &&
          stateBeforeSwitch.currentBrushPreset?.id !== preset.id
        ) {
          stateBeforeSwitch.cancelShapeFillSession();
        }
        
        // Cancel any active brush edit session before switching (unless preserveEditMode is true)
        const state = get();
        if (state.brushEditor.status === 'EDITING' && !preserveEditMode) {
          const canvas = state.currentOffscreenCanvas;
          if (canvas) {
            get().cancelBrushEdit(canvas);
          }
        }

        set((state) => {
        // --- THIS IS THE NEW, ROBUST REPLACEMENT ---
        const userOverrides = get().loadBrushSettings(preset.id);
        const { settings: presetDefaults, components } = applyBrushPreset(preset, userOverrides);
        const currentSettings = state.tools.brushSettings;
        let updatedBrushSpecificSettings = state.brushSpecificSettings;


        // Determine if the new preset is custom or default
        const isNewPresetCustom = presetDefaults.brushShape === BrushShape.CUSTOM;
        
        // Get appropriate size for this brush type using individual brush-specific sizing
        let appropriateSize;
        if (isNewPresetCustom) {
          // Custom brushes use the stored custom brush size
          appropriateSize = state.customBrushesSize;
        } else {
          // Default brushes use saved size if available, otherwise shared size
          const savedSize = userOverrides.size;
          appropriateSize = savedSize !== undefined ? savedSize : state.defaultBrushesSize;
        }
        
        const newBrushSettings: BrushSettings = {
          ...defaultBrushSettingsForStore, // 1. Start with the absolute base defaults.
          ...presetDefaults,               // 2. Apply the preset settings (which now includes user overrides).
          
          // 3. Finally, preserve the settings that carry over between any brush.
          color: currentSettings.color,
          blendMode: currentSettings.blendMode,
          size: appropriateSize            // Use appropriate size based on brush type
        };

        // Preserve Color Cycle dynamics across preset switches unless user changes them
        // This keeps animation feel consistent between Color Cycle variants
        if (currentSettings.colorCycleSpeed !== undefined) {
          newBrushSettings.colorCycleSpeed = currentSettings.colorCycleSpeed;
        }
        if (currentSettings.colorCycleFPS !== undefined) {
          newBrushSettings.colorCycleFPS = currentSettings.colorCycleFPS;
        }
        if (currentSettings.colorCycleFillMode !== undefined) {
          newBrushSettings.colorCycleFillMode = currentSettings.colorCycleFillMode;
        }

        const previousGradient = currentSettings.colorCycleGradient;
        const previousGradientVersion = currentSettings.colorCycleGradientVersion;
        const storedGradientEntry = findStoredColorCycleGradient(state.brushSpecificSettings);
        const shouldApplyColorCycleGradient = isColorCycleBrushShape(newBrushSettings.brushShape);

        if (shouldApplyColorCycleGradient) {
          const gradientSource = previousGradient && previousGradient.length > 0
            ? previousGradient
            : storedGradientEntry?.gradient;
          const gradientVersionSource = previousGradient && previousGradient.length > 0
            ? previousGradientVersion
            : storedGradientEntry?.version;

          if (gradientSource && gradientSource.length > 0) {
            const gradientClone = cloneGradientStops(gradientSource);
            if (gradientClone && gradientClone.length > 0) {
              newBrushSettings.colorCycleGradient = gradientClone;
              if (typeof gradientVersionSource === 'number') {
                newBrushSettings.colorCycleGradientVersion = gradientVersionSource;
              }

              if (isColorCyclePresetId(preset.id)) {
                const existingSettings = state.brushSpecificSettings[preset.id] || {};
                updatedBrushSpecificSettings = {
                  ...updatedBrushSpecificSettings,
                  [preset.id]: {
                    ...existingSettings,
                    colorCycleGradient: cloneGradientStops(gradientSource),
                    ...(typeof gradientVersionSource === 'number'
                      ? { colorCycleGradientVersion: gradientVersionSource }
                      : existingSettings.colorCycleGradientVersion !== undefined
                        ? { colorCycleGradientVersion: existingSettings.colorCycleGradientVersion }
                        : {})
                  }
                };
              }
            }
          }
        }

        // Handle custom brush presets specifically
        if (preset.isCustomBrush) {
          const customBrushId = preset.id.startsWith('custom_') ? preset.id.substring(7) : preset.id;
          
          newBrushSettings.brushShape = BrushShape.CUSTOM;
          newBrushSettings.selectedCustomBrush = customBrushId;
          newBrushSettings.useSwatchColor = false;
          newBrushSettings.hueShift = 0;
          newBrushSettings.lightnessAdjust = 0;
          newBrushSettings.saturationAdjust = 100;
          
          // CRITICAL FIX: Load the custom brush data into currentBrushTip
          // The issue was that custom brushes selected from the library weren't
          // properly loading their imageData into currentBrushTip
          
          // First check temporary custom brush
          let customBrush = state.temporaryCustomBrush && state.temporaryCustomBrush.id === customBrushId 
            ? state.temporaryCustomBrush 
            : null;
          
          // If not temporary, check project custom brushes
          if (!customBrush && state.project?.customBrushes) {
            customBrush = state.project.customBrushes.find(b => b.id === customBrushId) || null;
          }
          
          // IMPORTANT: Always use preset.customBrushData as the primary source
          // This ensures custom brushes loaded from BrushLibrary work correctly
          if (preset.customBrushData) {
            const data = preset.customBrushData;
            // Create/update the custom brush object with preset data
            customBrush = {
              id: customBrushId,
              name: preset.name,
              imageData: data.imageData,
              width: data.width,
              height: data.height,
              thumbnail: preset.thumbnail || '',
              createdAt: customBrush?.createdAt || Date.now()
            };
          }
          
          if (customBrush) {
            newBrushSettings.currentBrushTip = {
              imageData: customBrush.imageData,
              brushId: customBrush.id,
              isColorizable: false,
              width: customBrush.width,
              height: customBrush.height
            };
          } else {
            
          }
        }
        
        // Handle brush size restoration when switching between custom and regular brushes
        if (presetDefaults.brushShape !== undefined) {
          const wasCustom = currentSettings.brushShape === BrushShape.CUSTOM;
          const isCustom = presetDefaults.brushShape === BrushShape.CUSTOM;
          
          if (!wasCustom && isCustom) {
            // Switching TO custom brush: save current regular size
            newBrushSettings.lastRegularBrushSize = currentSettings.size;
          } else if (wasCustom && !isCustom) {
            // Switching FROM custom brush: restore last regular size
            if (currentSettings.lastRegularBrushSize !== undefined) {
              newBrushSettings.size = currentSettings.lastRegularBrushSize;
            }
            // Clear stale custom brush tip data when switching away from custom brushes
            newBrushSettings.currentBrushTip = undefined;
            newBrushSettings.selectedCustomBrush = null;
          }
          
          // Only clear specific brush caches, not all memory when brush type changes
          if (wasCustom !== isCustom) {
            try {
              // Clear only brush-specific caches, preserve other caches for performance
              brushCache.clear();
              scaledBrushCache.clear();
            } catch {
              // Cache cleanup failed, continue silently
            }
          }
        }
        
        // Update lastRegularBrushSize when size changes for regular brushes
        if (newBrushSettings.size !== undefined && 
            newBrushSettings.brushShape !== BrushShape.CUSTOM) {
          newBrushSettings.lastRegularBrushSize = newBrushSettings.size;
        }
        
        // Force antialiasing off for spam brush (disables shape mode)
        if (newBrushSettings.brushShape === BrushShape.SPAM_TEXT) {
          newBrushSettings.antialiasing = false;
        }

        // Explicitly enforce Color Cycle variant selection
        // Some UI sequences may briefly override the shape; guard here by preset id
        if (preset.id === 'color-cycle-shape') {
          newBrushSettings.brushShape = BrushShape.COLOR_CYCLE_SHAPE;
        } else if (preset.id === 'color-cycle-stroke') {
          newBrushSettings.brushShape = BrushShape.COLOR_CYCLE;
        }
        
        // Decide shapeMode based on brush domain (Color Cycle vs regular)
        const isNewCC = newBrushSettings.brushShape === BrushShape.COLOR_CYCLE ||
                        newBrushSettings.brushShape === BrushShape.COLOR_CYCLE_TRIANGLE ||
                        newBrushSettings.brushShape === BrushShape.COLOR_CYCLE_SHAPE;
        const wasShapeFillBrush = state.tools.brushSettings.brushShape === BrushShape.SHAPE_FILL;
        const isShapeFillBrush = newBrushSettings.brushShape === BrushShape.SHAPE_FILL;

        let nextShapeMode: boolean;
        if (isShapeFillBrush) {
          nextShapeMode = true;
        } else if (isNewCC) {
          // Respect explicit CC variant presets; otherwise restore last CC shape mode
          if (preset.id === 'color-cycle-shape') {
            nextShapeMode = true;
          } else if (preset.id === 'color-cycle-stroke') {
            nextShapeMode = false;
          } else {
            nextShapeMode = state.tools.lastColorCycleShapeMode ?? state.tools.shapeMode ?? false;
          }
        } else {
          // Non-CC brushes should not inherit CC shape mode
          nextShapeMode = wasShapeFillBrush ? false : state.tools.lastRegularShapeMode ?? false;
        }

        // Clear temporary brush when switching away from custom brushes
        const brushSpecificSettingsChanged = updatedBrushSpecificSettings !== state.brushSpecificSettings;

        const updatedState = {
          ...state,
          ...(brushSpecificSettingsChanged ? { brushSpecificSettings: updatedBrushSpecificSettings } : {}),
          currentBrushPreset: preset,
          activeBrushComponents: components,
          globalBrushSize: appropriateSize, // Update global size to match new brush
          tools: {
            ...state.tools,
            // Keep shapeMode separate between CC and default brushes
            shapeMode: nextShapeMode,
            ...(isNewCC
              ? { lastColorCycleShapeMode: nextShapeMode }
              : { lastRegularShapeMode: nextShapeMode }
            ),
            brushSettings: newBrushSettings
          }
        };
        
        // If switching away from custom brush, discard temporary brush
        if (presetDefaults.brushShape !== undefined && 
            currentSettings.brushShape === BrushShape.CUSTOM && 
            presetDefaults.brushShape !== BrushShape.CUSTOM) {
          return {
            ...updatedState,
            temporaryCustomBrush: null
          };
        }
        
        return updatedState;
        });
      },
      getBrushPresets: () => brushPresets,
      getBrushPresetById: (id) => brushPresets.find(preset => preset.id === id),
      
      
      // UI State
      ui: defaultUIState,
      
      // Autosave State
      autosave: {
        isEnabled: false,
        isRunning: false,
        hasUnsavedChanges: false,
        lastSaveTime: null,
        interval: 2, // default 2 minutes
        fileBackup: {
          enabled: false,
          mode: 'single-file',
          fileHandle: null,
          directoryHandle: null,
          backupPath: null,
          lastBackupTime: null,
        },
      },
      
      togglePanel: (panel) => set((state) => ({
        ui: {
          ...state.ui,
          panels: {
            ...state.ui.panels,
            [panel]: !state.ui.panels[panel]
          }
        }
      })),
      toggleModal: (modal) => set((state) => ({
        ui: {
          ...state.ui,
          modals: {
            ...state.ui.modals,
            [modal]: !state.ui.modals[modal]
          }
        }
      })),
      setTheme: (theme) => set((state) => ({
        ui: { ...state.ui, theme }
      })),
      addNotification: (notification) => set((state) => ({
        ui: {
          ...state.ui,
          notifications: [
            ...state.ui.notifications,
            {
              ...notification,
              id: `notification-${Date.now()}-${Math.random()}`
            }
          ]
        }
      })),
      removeNotification: (id) => set((state) => ({
        ui: {
          ...state.ui,
          notifications: state.ui.notifications.filter(n => n.id !== id)
        }
      })),
      setKeyboardScope: (scope) => set((state) => ({
        ui: {
          ...state.ui,
          keyboardScope: scope
        }
      })),
      
      // Layer Management - Start empty for SSR compatibility
      layers: [],
      activeLayerId: null,
      selectedLayerIds: [],
      referenceLayerId: null,
      currentLayer: 0,
      addLayer: (layer) => {
        if (__DEV__) {
          // quiet
        }
        recordBreadcrumb('layers', { event: 'store-addLayer-enter', incomingType: layer?.layerType });
        const stateBeforeAdd = get();
        const beforeSnapshot = createHistorySnapshotFromState(stateBeforeAdd, {
          actionType: 'layer-add',
          description: 'Add layer',
        });

        const newLayerId = `layer-${Date.now()}-${Math.random()}`;
        // quiet

        set((state) => {
          // quiet
          // CRITICAL CHECK: Verify existing layers are not mutated
          const existingLayersSnapshot = state.layers.map(l => ({
            id: l.id,
            type: l.layerType,
            hasCC: !!l.colorCycleData
          }));
          
          const newLayer = {
            ...layer,
            id: newLayerId,
            // Temporary order; will be normalized after insertion
            order: 0,
            alignment: cloneLayerAlignment(layer.alignment),
            transparencyLocked: layer.transparencyLocked === true,
            // CRITICAL: Preserve layerType EXACTLY - DO NOT convert CC layers to normal!
            layerType: layer.layerType || (
              (logError('CRITICAL: Layer missing layerType!', {
                layerId: newLayerId?.substring(0, 20),
                hasColorCycleData: !!layer.colorCycleData,
                fallbackToNormal: true
              }),
              'normal')
            )
          };
          
          // Insert the new layer directly ABOVE the currently active layer
          // Fallback: if no active layer, append to top of stack
          const activeIdx = state.activeLayerId
            ? state.layers.findIndex(l => l.id === state.activeLayerId)
            : -1;
          const insertedIndex = activeIdx >= 0 ? activeIdx + 1 : state.layers.length;
          const newLayers = [...state.layers];
          newLayers.splice(insertedIndex, 0, newLayer);

          // Normalize order values to match visual/composite order (ascending = bottom -> top)
          const updatedLayers = newLayers.map((l, idx) => ({ ...l, order: idx }));
          recordBreadcrumb('layers', { event: 'store-addLayer-updated', total: updatedLayers.length, insertedIndex });
          // quiet
          
          // Initialize ColorCycleBrush for color-cycle layers
          if (newLayer.layerType === 'color-cycle' && state.project) {
            const width = state.project.width || 1024;
            const height = state.project.height || 1024;
            // quiet

            // Use enhanced manager method for initialization
            // Note: gradient is in { position, color }[] format, but initColorCycleForLayer expects Uint8Array
            // Pass undefined to use default gradient
            const success = colorCycleBrushManager.initColorCycleForLayer(
              newLayerId, 
              width, 
              height, 
              undefined
            );
            
            if (!success) {
              console.error('Failed to initialize ColorCycleBrush for new layer:', newLayerId);
            } else {
              // Pre-create the animator to avoid lag on first paint
              const brush = colorCycleBrushManager.getBrush(newLayerId);
              if (brush && 'setSpeed' in brush && typeof brush.setSpeed === 'function') {
                // Call setSpeed to trigger animator creation internally
                // This ensures the animator is ready before first paint
                brush.setSpeed(1.0);
                // quiet
              }
            }
          }
          
          // VERIFY: Check if any existing layer lost its type
          // IMPORTANT: Compare by stable id, not by array index, because we inserted a new
          // layer and normalized order which shifts indices. Index-based comparison would
          // falsely report a mutation at and after the insertion point.
          existingLayersSnapshot.forEach((original) => {
            const updated = updatedLayers.find(l => l.id === original.id);
            if (!updated) {
              // Should never happen; log once for diagnostics without throwing
              console.error('🔴🔴🔴 LAYER MISSING AFTER ADD_LAYER (by id lookup):', {
                layerId: original.id.substring(0, 20),
                originalType: original.type
              });
              return;
            }
            if (original.type !== updated.layerType) {
              console.error('🔴🔴🔴 LAYER TYPE MUTATION IN ADD_LAYER:', {
                layerId: original.id.substring(0, 20),
                originalType: original.type,
                newType: updated.layerType,
                wasCC: original.hasCC,
                isCC: !!updated.colorCycleData
              });
            }
          });
          
          /* console.log('🔵 ADD LAYER RESULT:', {
            totalLayers: updatedLayers.length,
            layers: updatedLayers.map(l => ({
              id: l.id.substring(0, 20),
              type: l.layerType,
              hasCC: !!l.colorCycleData,
              hasGradient: !!l.colorCycleData?.gradient
            }))
          }); */
          
          const syncedLayers = syncPercentOffsetsFromPixels(updatedLayers, state.project ?? null);

          return {
            layers: syncedLayers
          };
        });

        // Ensure the newly created layer becomes the active selection.
        try {
          const storeState = get();
          if (storeState.setActiveLayer) {
            if (storeState.activeLayerId !== newLayerId) {
              storeState.setActiveLayer(newLayerId);
            } else if (!storeState.selectedLayerIds.includes(newLayerId) && storeState.setSelectedLayerIds) {
              storeState.setSelectedLayerIds([newLayerId]);
            }
          }
        } catch (error) {
          logError('addLayer: failed to auto-select new layer', error);
          set(() => ({
            activeLayerId: newLayerId,
            selectedLayerIds: [newLayerId]
          }));
        }

        const stateAfterAdd = get();
        const afterSnapshot = createHistorySnapshotFromState(stateAfterAdd, {
          actionType: 'layer-add',
          description: 'Add layer',
          activeLayerId: newLayerId,
        });

        try {
          const txn = historyManager.begin('layer-structure', {
            layerId: newLayerId,
            operation: 'add',
          });
          txn.push(
            createLegacySnapshotDelta({
              forward: afterSnapshot,
              backward: beforeSnapshot,
            })
          );
          txn.commit('Add layer');
          set((state) => ({
            autosave: {
              ...state.autosave,
              hasUnsavedChanges: true,
              lastSaveTime: new Date(),
            },
          }));
        } catch (historyError) {
          logError('[history] Failed to record layer add', historyError);
        }

        return newLayerId;
      },
      removeLayer: (id) => {
        const stateBeforeRemove = get();
        const beforeSnapshot = createHistorySnapshotFromState(stateBeforeRemove, {
          actionType: 'layer-remove',
          description: 'Remove layer',
        });

        set((state) => {
          // Use enhanced manager method for cleanup
          colorCycleBrushManager.removeColorCycleBrush(id);
          
          const updatedLayers = state.layers.filter(l => l.id !== id);
          const newActiveLayerId = state.activeLayerId === id ? 
            updatedLayers.find(l => l.id !== id)?.id || null : 
            state.activeLayerId;

          const filteredSelection = state.selectedLayerIds.filter(selectedId => {
            if (selectedId === id) {
              return false;
            }
            return updatedLayers.some(layer => layer.id === selectedId);
          });
          const nextSelection = filteredSelection.length > 0
            ? filteredSelection
            : (newActiveLayerId ? [newActiveLayerId] : []);
          
          trackLayerChanges('removeLayer RETURN', updatedLayers);
          const syncedLayers = syncPercentOffsetsFromPixels(updatedLayers, state.project ?? null);
          return {
            layers: syncedLayers,
            activeLayerId: newActiveLayerId,
            selectedLayerIds: nextSelection,
            referenceLayerId: state.referenceLayerId === id ? null : state.referenceLayerId
          // Remove the project update entirely - only update top-level layers
        };
        });

        const stateAfterRemove = get();
        const afterSnapshot = createHistorySnapshotFromState(stateAfterRemove, {
          actionType: 'layer-remove',
          description: 'Remove layer',
        });

        try {
          const txn = historyManager.begin('layer-structure', {
            layerId: id,
            operation: 'remove',
          });
          txn.push(
            createLegacySnapshotDelta({
              forward: afterSnapshot,
              backward: beforeSnapshot,
            })
          );
          txn.commit('Remove layer');
          set((state) => ({
            autosave: {
              ...state.autosave,
              hasUnsavedChanges: true,
              lastSaveTime: new Date(),
            },
          }));
        } catch (historyError) {
          logError('[history] Failed to record layer removal', historyError);
        }
      },
      updateLayer: (id, updates) => set((state) => {
        const originalLayer = state.layers.find(l => l.id === id);
        
        // CRITICAL: Detect when a color-cycle layer is being changed to normal
        if (originalLayer?.layerType === 'color-cycle' && 
            updates.layerType === 'normal') {
          console.error('🔴🔴🔴 LAYER TYPE CORRUPTION DETECTED');
          console.error('Stack trace:', new Error().stack);
          console.error('Layer being corrupted:', id);
          console.error('Update that caused it:', updates);
          // Only break into debugger when explicitly opted-in
          const debugWindow = getVesselWindow();
          if (debugWindow?.__TB_DEBUG?.breakOnLayerErrors) {
            debugger;
          }
        }
        
        // Also detect when colorCycleData is being cleared
        if (originalLayer?.colorCycleData && 
            'colorCycleData' in updates && 
            !updates.colorCycleData) {
          console.error('🔴🔴🔴 COLOR CYCLE DATA BEING CLEARED');
          console.error('Stack trace:', new Error().stack);
          console.error('Layer:', id);
          // Only break into debugger when explicitly opted-in
          const debugWindow = getVesselWindow();
          if (debugWindow?.__TB_DEBUG?.breakOnLayerErrors) {
            debugger;
          }
        }
        
        
        // DEBUG: Log any layerType changes from color-cycle
        if (originalLayer && originalLayer.layerType === 'color-cycle' && 
            ('layerType' in updates && updates.layerType !== 'color-cycle')) {
          console.error('🔴 CRITICAL WARNING: Changing color-cycle layer to:', updates.layerType, 'for layer:', id.substring(0, 20));
          console.trace('Stack trace for layer type change');
        }
        
        const updatedLayers = state.layers.map(layer => {
          if (layer.id === id) {
            // Start with a shallow copy
            const updatedLayer = { ...layer };
            
            // Special handling for colorCycleData updates
            if ('colorCycleData' in updates) {
              if (updates.colorCycleData) {
                // CRITICAL: Only allow colorCycleData updates on color-cycle layers
                if (layer.layerType !== 'color-cycle') {
                  console.error('🚨 BLOCKED: Attempted to add colorCycleData to normal layer!', {
                    layerId: layer.id?.substring(0, 20),
                    layerType: layer.layerType
                  });
                  // Skip this update - don't add colorCycleData to normal layers
                } else {
                  // Merging colorCycleData for color-cycle layer
                  updatedLayer.colorCycleData = {
                    ...layer.colorCycleData,
                    ...updates.colorCycleData
                  };
                  // Layer is already color-cycle, keep it that way
                  updatedLayer.layerType = 'color-cycle';
                }
              } else {
                // FORBIDDEN: CC layers cannot be converted to normal layers!
                console.error('🚨🚨🚨 BLOCKED: Attempted to convert CC layer to normal!', {
                  layerId: layer.id?.substring(0, 20),
                  originalType: layer.layerType,
                  attemptedConversion: 'CC -> Normal - BLOCKED!'
                });
                // DO NOT delete colorCycleData or change layerType - preserve CC layer!
                // Keep the layer as-is to prevent conversion
              }
            }
            
            // Apply all other updates except colorCycleData
            const otherUpdates = { ...updates };
            delete (otherUpdates as Partial<typeof layer>).colorCycleData;
            Object.assign(updatedLayer, otherUpdates);
            
            // Protect against accidentally clearing layerType or colorCycleData
            // If the layer was color-cycle and we're not explicitly changing it
            if (layer.layerType === 'color-cycle' && 
                !('layerType' in updates) && 
                !('colorCycleData' in updates)) {
              // Ensure we preserve the color-cycle nature
              updatedLayer.layerType = 'color-cycle';
              updatedLayer.colorCycleData = layer.colorCycleData;
            }
            
            // FORBIDDEN: Never allow conversion from CC to normal!
            if (updates.layerType === 'normal' && layer.layerType === 'color-cycle') {
              console.error('🚨🚨🚨 BLOCKED: Direct conversion CC -> Normal!', {
                layerId: layer.id?.substring(0, 20),
                originalType: layer.layerType,
                attemptedType: updates.layerType,
                hasColorCycleData: !!layer.colorCycleData
              });
              // REVERT the layerType change - keep it as color-cycle
              updatedLayer.layerType = 'color-cycle';
              // DO NOT delete colorCycleData!
            } else if (updates.layerType === 'normal' && layer.layerType === 'normal') {
              // Safe: normal -> normal, can clear colorCycleData if any exists
              delete updatedLayer.colorCycleData;
            }
            
            return updatedLayer;
          }
          return layer;
        });
      
        // Check if visual properties changed that require recomposition
        const needsRecomposition = 'visible' in updates || 'opacity' in updates || 'blendMode' in updates || 
                                   'colorCycleData' in updates || 'layerType' in updates;
        if (needsRecomposition) {
          // Visual property changed - triggering recomposition
        }
        
        // FINAL VERIFICATION: Check for unexpected CC -> Normal conversions
        const updatedLayer = updatedLayers.find(l => l.id === id);
        if (originalLayer?.layerType === 'color-cycle' && updatedLayer?.layerType === 'normal') {
          logError('LAYER CONVERSION DETECTED DESPITE PROTECTIONS!', {
            layerId: id.substring(0, 20),
            originalType: originalLayer.layerType,
            finalType: updatedLayer.layerType,
            hadColorCycleData: !!originalLayer.colorCycleData,
            hasColorCycleData: !!updatedLayer.colorCycleData,
            stackTrace: new Error().stack
          });
        }

        trackLayerChanges('updateLayer RETURN', updatedLayers);
        const syncedLayers = syncPercentOffsetsFromPixels(updatedLayers, state.project ?? null);

        try {
          const syncedLayer = syncedLayers.find(layer => layer.id === id);
          if (syncedLayer?.layerType === 'color-cycle' && syncedLayer.colorCycleData) {
            syncCCRuntimes([syncedLayer], 'updateLayer');
          }
        } catch (error) {
          logError('[updateLayer] Failed to sync CC runtime', error);
        }

        return {
          layers: syncedLayers,
          layersNeedRecomposition: needsRecomposition || state.layersNeedRecomposition
          // Remove the project update entirely - only update top-level layers
        };
      }),
      setSelectedLayerIds: (layerIds) => set((state) => {
        const validIds = layerIds.filter((layerId, index, list) => {
          return list.indexOf(layerId) === index && state.layers.some(layer => layer.id === layerId);
        });

        return {
          selectedLayerIds: validIds
        };
      }),
      setActiveLayer: (id) => set((state) => {
        const layer = state.layers.find(l => l.id === id);
        if (!layer) {
          logError('setActiveLayer: Invalid layer ID', id);
          return state;
        }
        // quiet
        
        /* console.log('🟢 SET ACTIVE LAYER DEBUG:', {
          newActiveId: id?.substring(0, 20),
          oldActiveId: state.activeLayerId?.substring(0, 20),
          targetLayerType: layer?.layerType,
          targetHasCC: !!layer?.colorCycleData,
          allLayersBefore: state.layers.map(l => ({
            id: l.id.substring(0, 20),
            type: l.layerType,
            hasCC: !!l.colorCycleData,
            hasGradient: !!l.colorCycleData?.gradient
          }))
        }); */
        
        // When switching away from a color-cycle layer, mark it as inactive
        const currentActiveLayer = state.layers.find(l => l.id === state.activeLayerId);
        if (currentActiveLayer?.layerType === 'color-cycle' && currentActiveLayer.id !== id) {
          /* console.log('🟠 SWITCHING AWAY FROM CC LAYER:', {
            fromLayerId: currentActiveLayer.id.substring(0, 20),
            toLayerId: id?.substring(0, 20)
          }); */
          
          try {
            // Mark the old layer's brush as inactive
            if (colorCycleBrushManager) {
              if (state.activeLayerId) {
                try { colorCycleBrushManager.setActiveState(state.activeLayerId, false); } catch (e) { logError('CC cleanup error (non-fatal): setActiveState', e); }
                // End any active strokes
                try {
                  const oldBrush = colorCycleBrushManager.getLayerColorCycleBrush(state.activeLayerId);
                  oldBrush?.endStroke(state.activeLayerId);
                } catch (e) { logError('CC cleanup error (non-fatal): endStroke', e); }
              }
            }
          } catch {
            // quiet
          }
          // quiet
        }
        
        // If switching to a color-cycle layer in BRUSH context, validate/reinit brush resources.
        // Skip entirely when the Recolor tool is active so we don't override recolor mode.
        if (layer?.layerType === 'color-cycle' && state.tools.currentTool !== 'recolor') {
          /* console.log('🟣 SWITCHING TO CC LAYER:', {
            layerId: id.substring(0, 20),
            hasGradient: !!layer.colorCycleData?.gradient,
            gradientLength: layer.colorCycleData?.gradient?.length
          }); */
          
          // Validate and reinitialize if needed
          if (!colorCycleBrushManager.validateColorCycleBrush(id)) {
            
            const width = state.project?.width || 1024;
            const height = state.project?.height || 1024;
            // Note: gradient is in { position, color }[] format, but initColorCycleForLayer expects Uint8Array
            try {
              colorCycleBrushManager.initColorCycleForLayer(
              id, 
              width, 
              height, 
              undefined
            );
            } catch (e) {
              console.error('Error re-initializing CC brush on setActiveLayer:', e);
            }
            // quiet
          }
          
          // Mark as active
          try { colorCycleBrushManager.setActiveState(id, true); } catch (e) { console.error('CC setActiveState error:', e); }
          
          // Ensure brush tracks the active layer before runtime sync
          try {
            const colorCycleBrush = colorCycleBrushManager.getLayerColorCycleBrush(id);
            if (colorCycleBrush && 'setActiveLayer' in colorCycleBrush && typeof colorCycleBrush.setActiveLayer === 'function') {
              colorCycleBrush.setActiveLayer(id);
            }
          } catch {
            // quiet
          }
          
          // Remember the user's current brush context so we can restore it when leaving CC layers
          let savedRegularTool = state.tools.lastRegularTool;
          let savedBrushShape = state.tools.lastRegularBrushShape;
          if (state.tools.currentTool === 'brush' || state.tools.currentTool === 'eraser') {
            savedRegularTool = state.tools.currentTool;
            savedBrushShape = state.tools.brushSettings.brushShape;
          }

          const layerGradientStops = layer.colorCycleData?.gradient
            ?? layer.colorCycleData?.recolorSettings?.gradient;
          const gradientForBrushSettings = layerGradientStops
            ? layerGradientStops.map(stop => ({ ...stop }))
            : undefined;

          const nextBrushSettings = {
            ...state.tools.brushSettings,
            customBrushColorCycle: true,
            ...(gradientForBrushSettings ? { colorCycleGradient: gradientForBrushSettings } : {})
          };

          const result = {
            activeLayerId: id,
            selectedLayerIds: [id],
            tools: {
              ...state.tools,
              lastRegularTool: savedRegularTool,
              lastRegularBrushShape: savedBrushShape,
              lastColorCycleShapeMode: state.tools.shapeMode,
              brushSettings: nextBrushSettings
            }
          };

          try {
            syncCCRuntimes([layer], 'setActiveLayer');
          } catch (error) {
            logError('[setActiveLayer] Failed to sync CC runtime', error);
          }
          
          /* console.log('🟢 SET ACTIVE LAYER RESULT (CC):', {
            activeLayerId: result.activeLayerId.substring(0, 20),
            gradientSet: !!result.tools.brushSettings.colorCycleGradient,
            allLayersAfter: state.layers.map(l => ({
              id: l.id.substring(0, 20),
              type: l.layerType,
              hasCC: !!l.colorCycleData
            }))
          }); */
          
          return result;
        }
        
        // When switching to a regular layer from color cycle, restore last regular tool
        const baseBrushSettings = {
          ...state.tools.brushSettings,
          customBrushColorCycle: false
        };

        let nextTools = {
          ...state.tools,
          brushSettings: baseBrushSettings
        };
        const wasOnColorCycle = currentActiveLayer?.layerType === 'color-cycle';
        // Only restore last regular tool if we're NOT explicitly in recolor tool
        if (wasOnColorCycle && layer && layer.layerType === 'normal' && state.tools.currentTool !== 'recolor') {
          // Restore the last regular tool and brush shape
          const lastTool = state.tools.lastRegularTool ?? 'brush';
          const lastShape = state.tools.lastRegularBrushShape ?? state.tools.brushSettings.brushShape;

          nextTools = {
            ...nextTools,
            currentTool: lastTool,
            brushSettings: {
              ...baseBrushSettings,
              brushShape: lastShape
            }
          };
        }

        const result = {
          activeLayerId: id,
          selectedLayerIds: [id],
          tools: nextTools
          // DO NOT return layers unless we're actually changing them
        };
        
        /* console.log('🟢 SET ACTIVE LAYER RESULT (NORMAL):', {
          activeLayerId: id?.substring(0, 20),
          allLayersAfter: state.layers.map(l => ({
            id: l.id.substring(0, 20),
            type: l.layerType,
            hasCC: !!l.colorCycleData
          })),
          returnedLayers: 'layers' in result
        }); */
        
        // Debug checks removed - the race condition has been fixed
        
        return result;
      }),
      setLayers: (layers) => {
        const state = get();
        
        // Fix any corrupted layers before setting
        const fixedLayers = layers.map(layer => {
          // Ensure layer type matches the presence of colorCycleData
          const shouldBeColorCycle = !!layer.colorCycleData;
          const correctType: 'color-cycle' | 'normal' = shouldBeColorCycle ? 'color-cycle' : 'normal';
          
          if (layer.layerType !== correctType) {
            console.warn(`Fixing layer type mismatch for layer ${layer.id}: was ${layer.layerType}, should be ${correctType}`);
            return {
              ...layer,
              layerType: correctType
            };
          }
          
          return layer;
        });
        
        // Check if any color-cycle layers are being removed
        const oldCCLayers = state.layers.filter(l => l.layerType === 'color-cycle');
        const newCCLayers = fixedLayers.filter(l => l.layerType === 'color-cycle');
        
        if (oldCCLayers.length > newCCLayers.length) {
          console.info('Color-cycle layers being removed:', oldCCLayers.length - newCCLayers.length);
        }
        
        trackLayerChanges('setLayers CALLED', fixedLayers);
        const normalizedLayers = normalizeLayers(fixedLayers);
        const syncedLayers = syncPercentOffsetsFromPixels(normalizedLayers, state.project ?? null);
        const validSelection = state.selectedLayerIds.filter(id => syncedLayers.some(layer => layer.id === id));
        const ensuredActiveId = state.activeLayerId && syncedLayers.some(layer => layer.id === state.activeLayerId)
          ? state.activeLayerId
          : syncedLayers[0]?.id ?? null;
        const nextSelection = validSelection.length > 0
          ? validSelection
          : ensuredActiveId
            ? [ensuredActiveId]
            : [];

        set({
          layers: syncedLayers,
          selectedLayerIds: nextSelection,
          referenceLayerId: state.referenceLayerId && syncedLayers.some(layer => layer.id === state.referenceLayerId)
            ? state.referenceLayerId
            : null
        });
      },
      setReferenceLayer: (id) => set((state) => {
        if (id && !state.layers.some(layer => layer.id === id)) {
          return { referenceLayerId: null };
        }

        return { referenceLayerId: id ?? null };
      }),
      updateLayerAlignment: (layerId, alignment) => set((state) => {
        const targetLayer = state.layers.find(layer => layer.id === layerId);

        if (!targetLayer) {
          return { layers: state.layers };
        }

        let nextAlignment = cloneLayerAlignment(alignment);

        const previousAlignment = targetLayer.alignment;
        const becameAuto = nextAlignment.positioning === 'auto' && previousAlignment.positioning !== 'auto';
        const previousPercent = previousAlignment.offsetPercent ?? { x: 0, y: 0 };
        const nextPercent = nextAlignment.offsetPercent ?? { x: 0, y: 0 };
        const offsetPercentChanged = previousPercent.x !== nextPercent.x || previousPercent.y !== nextPercent.y;

        if (state.project) {
          if (becameAuto && !offsetPercentChanged) {
            try {
              const percentOffset = computeLayerPercentOffset(targetLayer, state.project);
              nextAlignment = {
                ...nextAlignment,
                offsetPercent: percentOffset
              };
            } catch (error) {
              console.warn('[useAppStore] Failed to compute percent offset during alignment update', error);
            }
          }

          if (nextAlignment.positioning === 'auto') {
            const percent = nextAlignment.offsetPercent ?? { x: 0, y: 0 };
            const width = Math.max(1, state.project.width);
            const height = Math.max(1, state.project.height);
            nextAlignment = {
              ...nextAlignment,
              offsetPercent: percent,
              offsetPx: {
                x: Math.round((percent.x / 100) * width),
                y: Math.round((percent.y / 100) * height)
              }
            };
          } else {
            nextAlignment = {
              ...nextAlignment,
              offsetPercent: undefined
            };
          }
        } else if (nextAlignment.positioning !== 'auto') {
          nextAlignment = {
            ...nextAlignment,
            offsetPercent: undefined
          };
        }

        const updatedLayers = state.layers.map(layer => (
          layer.id === layerId
            ? { ...layer, alignment: nextAlignment }
            : layer
        ));

        const syncedLayers = syncPercentOffsetsFromPixels(updatedLayers, state.project ?? null);

        return {
          layers: syncedLayers,
          layersNeedRecomposition: true
        };
      }),
      reorderLayers: (sourceIndex, destinationIndex) => {
        const stateBeforeReorder = get();
        const beforeSnapshot = createHistorySnapshotFromState(stateBeforeReorder, {
          actionType: 'layer-reorder',
          description: 'Reorder layers',
        });

        set((state) => {
          const newLayers = [...state.layers];
          const [removed] = newLayers.splice(sourceIndex, 1);
          newLayers.splice(destinationIndex, 0, removed);
          
          // Update order values
          const updatedLayers = newLayers.map((layer, index) => ({
            ...layer,
            order: index
          }));
          
          // Layer order changed - triggering recomposition
          
          const syncedLayers = syncPercentOffsetsFromPixels(updatedLayers, state.project ?? null);

          return {
            layers: syncedLayers,
            layersNeedRecomposition: true
            // Remove the project update entirely - only update top-level layers
          };
        });

        const stateAfterReorder = get();
        const afterSnapshot = createHistorySnapshotFromState(stateAfterReorder, {
          actionType: 'layer-reorder',
          description: 'Reorder layers',
        });

        try {
          const txn = historyManager.begin('layer-structure', {
            operation: 'reorder',
          });
          txn.push(
            createLegacySnapshotDelta({
              forward: afterSnapshot,
              backward: beforeSnapshot,
            })
          );
          txn.commit('Reorder layers');
          set((state) => ({
            autosave: {
              ...state.autosave,
              hasUnsavedChanges: true,
              lastSaveTime: new Date(),
            },
          }));
        } catch (historyError) {
          logError('[history] Failed to record layer reorder', historyError);
        }
      },
      
      // Color Cycle Layer Management
      initColorCycleForLayer: (layerId, width, height) => set((state) => {
        try {
          const layer = state.layers.find(l => l.id === layerId);
          if (!layer) {
            console.error('[Store] Layer not found:', layerId);
            return {};
          }
          
          // CRITICAL: Only allow initialization for color-cycle layers
          if (layer.layerType !== 'color-cycle') {
            console.error('🚨 BLOCKED: Attempted to init color cycle for non-CC layer!', {
              layerId: layerId.substring(0, 20),
              layerType: layer.layerType
            });
            return {}; // Prevent color cycle initialization on regular layers
          }
          
          // GUARD: Don't re-initialize if already initialized
          const existingBrush = colorCycleBrushManager.getBrush(layerId);
          if (existingBrush) {
            // quiet
            // Ensure the layer has a valid canvas and CC metadata even if we skip recreation.
            const updatedLayers = state.layers.map(l => {
              if (l.id !== layerId) return l;
              const existingCanvas = l.colorCycleData?.canvas;
              const brushWithControls = existingBrush as typeof existingBrush & {
                setTargetCanvas?: (canvas: HTMLCanvasElement | null) => void;
              };
              const layerCanvas =
                typeof HTMLCanvasElement !== 'undefined' && existingCanvas instanceof HTMLCanvasElement
                  ? existingCanvas
                  : undefined;
              if (layerCanvas && brushWithControls.setTargetCanvas) {
                brushWithControls.setTargetCanvas(layerCanvas);
              }
              const canvas = existingBrush.getCanvas ? existingBrush.getCanvas() : layerCanvas ?? existingCanvas;
              return {
                ...l,
                layerType: 'color-cycle' as const,
                colorCycleData: {
                  ...(l.colorCycleData || {}),
                  // Preserve existing gradient if any
                  gradient: l.colorCycleData?.gradient || state.tools.brushSettings.colorCycleGradient || l.colorCycleData?.gradient,
                  colorCycleBrush: existingBrush,
                  // Keep current animation state if present; default to true for responsiveness
                  isAnimating: l.colorCycleData?.isAnimating ?? true,
                  // Ensure per-layer brush speed exists
                  brushSpeed: l.colorCycleData?.brushSpeed ?? (state.tools.brushSettings.colorCycleSpeed || 0.1),
                  canvas
                }
              };
            });
            trackLayerChanges('initColorCycleForLayer (hydrate existing)', updatedLayers);
            const syncedLayers = syncPercentOffsetsFromPixels(updatedLayers, state.project ?? null);
            return { layers: syncedLayers };
          }
          
          // Validate dimensions
          const safeWidth = Math.max(width || 1024, 1);
          const safeHeight = Math.max(height || 1024, 1);
          
          // Create a canvas element for this layer's color cycle
          // Use the current brush gradient if available
          const currentBrushGradient = state.tools.brushSettings.colorCycleGradient;
          const gradient = currentBrushGradient || layer?.colorCycleData?.gradient || [
            { position: 0.0, color: '#ff0000' },
            { position: 0.17, color: '#ff7f00' },
            { position: 0.33, color: '#ffff00' },
            { position: 0.5, color: '#00ff00' },
            { position: 0.67, color: '#0000ff' },
            { position: 0.83, color: '#4b0082' },
            { position: 1.0, color: '#9400d3' }
          ];
          
          // Convert gradient to Uint8Array for brush creation
          const gradientArray = new Uint8Array(256 * 3);
          // Simple gradient interpolation (can be improved)
          for (let i = 0; i < 256; i++) {
            const t = i / 255;
            // Find gradient stops
            const color = { r: 255, g: 0, b: 0 }; // Default red
            for (let j = 0; j < gradient.length - 1; j++) {
              if (t >= gradient[j].position && t <= gradient[j + 1].position) {
                // Interpolate between colors
                const t0 = gradient[j].position;
                const t1 = gradient[j + 1].position;
                const localT = (t - t0) / (t1 - t0);
                
                const c0 = parseInt(gradient[j].color.substring(1), 16);
                const c1 = parseInt(gradient[j + 1].color.substring(1), 16);
                
                const r0 = (c0 >> 16) & 0xff;
                const g0 = (c0 >> 8) & 0xff;
                const b0 = c0 & 0xff;
                
                const r1 = (c1 >> 16) & 0xff;
                const g1 = (c1 >> 8) & 0xff;
                const b1 = c1 & 0xff;
                
                color.r = Math.round(r0 + (r1 - r0) * localT);
                color.g = Math.round(g0 + (g1 - g0) * localT);
                color.b = Math.round(b0 + (b1 - b0) * localT);
                break;
              }
            }
            gradientArray[i * 3] = color.r;
            gradientArray[i * 3 + 1] = color.g;
            gradientArray[i * 3 + 2] = color.b;
          }
          
          // Create brush through manager
          const colorCycleBrush = colorCycleBrushManager.createBrush(layerId, safeWidth, safeHeight, gradientArray);
          
          if (!colorCycleBrush) {
            console.error('[Store] Failed to create color cycle brush');
            return {};
          }

          let layerCanvas: HTMLCanvasElement | undefined;
          if (typeof document !== 'undefined') {
            const offscreen = document.createElement('canvas');
            offscreen.width = safeWidth;
            offscreen.height = safeHeight;
            layerCanvas = offscreen;
          } else if (colorCycleBrush.getCanvas) {
            layerCanvas = colorCycleBrush.getCanvas();
          }

          const brushWithControls = colorCycleBrush as typeof colorCycleBrush & {
            setTargetCanvas?: (canvas: HTMLCanvasElement | null) => void;
            renderDirectToCanvas?: (targetCanvas: HTMLCanvasElement, layerId: string) => void;
          };
          if (layerCanvas && brushWithControls.setTargetCanvas) {
            brushWithControls.setTargetCanvas(layerCanvas);
          }
          if (layerCanvas && brushWithControls.renderDirectToCanvas) {
            try {
              brushWithControls.renderDirectToCanvas(layerCanvas, layerId);
            } catch {
              // best effort; canvas will be populated on next stroke
            }
          }

        const updatedLayers = state.layers.map(l => {
          if (l.id !== layerId) {
            return l;
          }

          let eraseMask = l.colorCycleData?.eraseMask;
          let eraseMaskVersion = l.colorCycleData?.eraseMaskVersion ?? 0;

          if (typeof document !== 'undefined') {
            if (eraseMask) {
              if (eraseMask.width !== safeWidth || eraseMask.height !== safeHeight) {
                const resized = document.createElement('canvas');
                resized.width = safeWidth;
                resized.height = safeHeight;
                const ctx = resized.getContext('2d');
                if (ctx) {
                  ctx.drawImage(
                    eraseMask,
                    0,
                    0,
                    eraseMask.width,
                    eraseMask.height,
                    0,
                    0,
                    safeWidth,
                    safeHeight
                  );
                }
                eraseMask = resized;
                eraseMaskVersion =
                  typeof l.colorCycleData?.eraseMaskVersion === 'number'
                    ? l.colorCycleData.eraseMaskVersion + 1
                    : 1;
              }
            } else {
              const maskCanvas = document.createElement('canvas');
              maskCanvas.width = safeWidth;
              maskCanvas.height = safeHeight;
              eraseMask = maskCanvas;
              eraseMaskVersion = 0;
            }
          }

          return {
            ...l,
            layerType: 'color-cycle' as const,
            colorCycleData: {
              gradient: gradient || [],
              colorCycleBrush,
              isAnimating: true,
              // Initialize per-layer brush speed from current brush settings
              brushSpeed: state.tools.brushSettings.colorCycleSpeed || 0.1,
              canvas: layerCanvas ?? (colorCycleBrush.getCanvas ? colorCycleBrush.getCanvas() : undefined),
              eraseMask,
              eraseMaskVersion
            }
          };
        });
        
        trackLayerChanges('initColorCycleForLayer RETURN', updatedLayers);
        const syncedLayers = syncPercentOffsetsFromPixels(updatedLayers, state.project ?? null);
        return {
          layers: syncedLayers
          // Remove the project update entirely - only update top-level layers
        };
        } catch (error) {
          console.error('[Store] Error initializing color cycle:', error);
          return {}; // Return empty partial state on error
        }
      }),
      
      cleanupColorCycleForLayer: (layerId) => set((state) => {
        const layer = state.layers.find(l => l.id === layerId);
        // CRITICAL: Only cleanup color-cycle layers, never touch normal layers
        if (!layer || layer.layerType !== 'color-cycle' || !layer.colorCycleData) return state;
        
        // Cleanup through manager
        colorCycleBrushManager.deleteBrush(layerId);
        
        // CRITICAL FIX: Don't change the layer type when cleaning up!
        // We're just disposing Canvas2D resources, not converting the layer
        const updatedLayers = state.layers.map(l => 
          l.id === layerId 
            ? {
                ...l,
                // Keep the layer type as is - don't change it!
                colorCycleData: {
                  ...l.colorCycleData,
                  colorCycleBrush: undefined // Just clear the brush instance
                }
              }
            : l
        );
        
        const syncedLayers = syncPercentOffsetsFromPixels(updatedLayers, state.project ?? null);
        return {
          layers: syncedLayers
        };
      }),
      
      getLayerColorCycleBrush: (layerId) => {
        // CRITICAL: Verify layer is actually a color-cycle layer
        const state = get();
        const layer = state.layers.find(l => l.id === layerId);
        if (layer && layer.layerType !== 'color-cycle') {
          // Silently return null for non-CC layers - this is expected behavior
          return null; // Never return a CC brush for regular layers
        }
        
        // Get from manager
        return colorCycleBrushManager.getBrush(layerId) ?? null;
      },
      
      // Custom Brush Management
      addCustomBrush: (brush) => set((state) => {
        console.log('[STORE] Adding custom brush:', {
          id: brush.id,
          name: brush.name,
          hasImageData: !!brush.imageData,
          width: brush.width,
          height: brush.height,
          dataLength: brush.imageData?.data?.length
        });
        
        const newProject = state.project ? {
          ...state.project,
          customBrushes: [...state.project.customBrushes, brush]
        } : null;
        
        console.log('[STORE] Updated project:', {
          hasProject: !!newProject,
          customBrushCount: newProject?.customBrushes?.length,
          brushIds: newProject?.customBrushes?.map(b => b.id)
        });

        // IMPORTANT: Unconditionally set hueShift and saturationAdjust to neutral defaults
        // when a new custom brush is added and automatically selected.
        // This ensures the global sliders reflect the new brush's "baked" state.
        const newBrushSettings = {
          ...state.tools.brushSettings,
          brushShape: BrushShape.CUSTOM,
          selectedCustomBrush: brush.id,
          size: 100, // New custom brush starts at 100%
          useSwatchColor: false, // Ensure it uses the brush's colors
          hueShift: 0,           // <--- CRITICAL: Reset global hueShift here
          lightnessAdjust: 0,    // Reset lightness when selecting new brush
          saturationAdjust: 100  // <--- CRITICAL: Reset global saturationAdjust here
        };

        return {
          project: newProject,
          // Keep current custom brush size when adding a new brush
          customBrushesSize: state.customBrushesSize,
          globalBrushSize: state.customBrushesSize,
          tools: {
            ...state.tools,
            brushSettings: {
              ...newBrushSettings,
              size: 100 // New custom brush starts at 100%
            }
          }
        };
      }),
      updateCustomBrush: (brushId, updates) => set((state) => {
        if (!state.project) return state;
        
        const updatedBrushes = state.project.customBrushes.map(brush => 
          brush.id === brushId ? { ...brush, ...updates } : brush
        );
        
        return {
          project: {
            ...state.project,
            customBrushes: updatedBrushes
          }
        };
      }),
      removeCustomBrush: (brushId) => set((state) => {
        if (!state.project) return state;
        
        return {
          project: {
            ...state.project,
            customBrushes: state.project.customBrushes.filter(b => b.id !== brushId)
          }
        };
      }),
      saveCustomBrushAsPreset: (customBrushId) => set((state) => {
        // This function should actually just save temporary brushes to the project
        // Check if this is a temporary brush
        if (!state.temporaryCustomBrush || state.temporaryCustomBrush.id !== customBrushId) {
          return state; // Only save temporary brushes
        }
        
        const customBrush = state.temporaryCustomBrush;
        const currentBrushSettings = state.tools.brushSettings;
        
        if (!state.project) return state;
        
        // CRITICAL FIX: Apply current hue shift and saturation adjustments to the brush ImageData
        // This "bakes" the visual transformations into the saved brush so it looks the same
        let finalImageData = customBrush.imageData;
        
        // Apply hue shift and saturation adjustments if they're not at defaults
        const hasHueShift = currentBrushSettings.hueShift !== 0;
        const hasLightnessAdjust = currentBrushSettings.lightnessAdjust !== 0;
        const hasSaturationAdjust = currentBrushSettings.saturationAdjust !== 100;
        
        if (hasHueShift || hasLightnessAdjust || hasSaturationAdjust) {
          // Apply the hue/lightness/saturation adjustments to the brush ImageData
          finalImageData = adjustHueLightnessSaturation(
            customBrush.imageData,
            currentBrushSettings.hueShift || 0,
            currentBrushSettings.lightnessAdjust || 0,
            currentBrushSettings.saturationAdjust || 100
          );
        }
        
        // Create the final brush with transformed ImageData
        const transformedBrush = {
          ...customBrush,
          imageData: finalImageData
        };
        
        // Add the transformed brush to project's custom brushes
        const updatedProject = {
          ...state.project,
          customBrushes: [...state.project.customBrushes, transformedBrush]
        };
        
        return {
          // Clear the temporary brush since it's now saved to the project
          temporaryCustomBrush: null,
          // Update the project with the new custom brush
          project: updatedProject,
          // Keep current custom brush size when saving
          customBrushesSize: state.customBrushesSize,
          globalBrushSize: state.customBrushesSize,
          // Keep the same brush selected but reset transformations since they're now baked in
          tools: {
            ...state.tools,
            brushSettings: {
              ...state.tools.brushSettings,
              brushShape: BrushShape.CUSTOM,
              selectedCustomBrush: customBrush.id, // Keep using the original brush ID
              currentBrushTip: undefined, // Clear currentBrushTip since the brush is now saved
              useSwatchColor: false, // Default to false so custom brushes use their tip colors
              hueShift: 0,           // Reset since transformations are now baked into the brush
              lightnessAdjust: 0,
              saturationAdjust: 100, // Reset since transformations are now baked into the brush
              size: 100              // New custom brush starts at 100%
            }
          }
        };
      }),
      
      removeBrushPreset: (presetId) => set((state) => {
        // Don't allow deletion of default presets
        const presetToDelete = state.brushPresets.find(p => p.id === presetId);
        if (!presetToDelete || presetToDelete.isDefault) return state;
        
        const newPresets = state.brushPresets.filter(p => p.id !== presetId);
        
        // If deleting the currently active preset, switch to default
        let newCurrentPreset = state.currentBrushPreset;
        if (state.currentBrushPreset?.id === presetId) {
          newCurrentPreset = newPresets.find(p => p.isDefault) || newPresets[0] || null;
        }
        
        return {
          brushPresets: newPresets,
          currentBrushPreset: newCurrentPreset
        };
      }),
      
      // Brush Editor State
      brushEditor: defaultBrushEditorState,
      startBrushEdit: (brushId, canvas) => set((state) => {
        const ctx = canvas.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings) as (CanvasRenderingContext2D | null);
        if (!ctx || !state.project) {
          return state;
        }

        let brushData: CustomBrush | null = null;

        // First, try to find in custom brushes
        if (state.project.customBrushes) {
          brushData = state.project.customBrushes.find(b => b.id === brushId) || null;
        }

        // If not found in custom brushes, check default brush presets
        if (!brushData) {
          const defaultBrush = brushPresets.find(b => b.id === brushId);
          if (defaultBrush) {
            // Generate temporary image data for the default brush
            const tempCanvas = document.createElement('canvas');
            const size = 32; // Default editing size for brush presets
            tempCanvas.width = size;
            tempCanvas.height = size;
            const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings) as (CanvasRenderingContext2D | null);
            if (tempCtx) {
              // Create a simple black brush shape based on the preset
              tempCtx.fillStyle = '#000000';
              if (defaultBrush.id === 'pixel-brush' || defaultBrush.id.includes('pixel')) {
                // Square pixel brush
                tempCtx.fillRect(0, 0, size, size);
              } else if (defaultBrush.id.includes('square')) {
                // Square brush
                tempCtx.fillRect(0, 0, size, size);
              } else {
                // Round brush (default)
                tempCtx.beginPath();
                tempCtx.arc(size/2, size/2, size/2, 0, Math.PI * 2);
                tempCtx.fill();
              }
              
              // Create temporary brush data
              brushData = {
                id: brushId,
                name: defaultBrush.name,
                imageData: tempCtx.getImageData(0, 0, size, size),
                thumbnail: tempCanvas.toDataURL(),
                width: size,
                height: size,
                createdAt: Date.now()
              };
            }
          }
        }

        // If still no brush found, exit
        if (!brushData) {
          return state;
        }

        // Calculate centered bounds using the actual canvas dimensions
        const brushWidth = brushData.imageData.width;
        const brushHeight = brushData.imageData.height;
        
        // Get the canvas dimensions - if it's the offscreen canvas, use project dimensions
        const canvasWidth = state.project?.width || canvas.width;
        const canvasHeight = state.project?.height || canvas.height;
        
        const centerX = Math.floor((canvasWidth - brushWidth) / 2);
        const centerY = Math.floor((canvasHeight - brushHeight) / 2);
        
        const bounds = { x: centerX, y: centerY, width: brushWidth, height: brushHeight };

        // Create an empty ImageData for originalCanvasState since we're not modifying the main canvas
        // This is just to satisfy the type requirements and prevent errors
        const originalCanvasState = ctx.createImageData(bounds.width, bounds.height);
        
        // NOTE: We don't draw the brush onto the main canvas here
        // The BrushEditorUI panel renders and manages its own off-main canvas

        // Automatically select the brush being edited
        const newBrushSettings = {
          ...state.tools.brushSettings,
          brushShape: BrushShape.CUSTOM,
          selectedCustomBrush: brushId,
          currentBrushTip: {
            imageData: brushData.imageData,
            brushId: brushId,
            isColorizable: false,
            width: brushData.width,
            height: brushData.height
          },
          size: 100
        };
        
        // Clear caches to ensure fresh brush data
        brushCache.clear();
        scaledBrushCache.clear();
        
        const preserveAdjustments =
          state.brushEditor.status === 'EDITING' && state.brushEditor.editingBrushId === brushId;

        const nextHueShift = preserveAdjustments ? state.brushEditor.hueShift : 0;
        const nextLightness = preserveAdjustments ? state.brushEditor.lightness : 0;
        const nextSaturation = preserveAdjustments ? state.brushEditor.saturation : 100;

        return {
          brushEditor: {
            status: 'EDITING' as const,
            editingBrushId: brushId,
            editingBounds: bounds,
            originalCanvasState,
            hueShift: nextHueShift,  // Preserve adjustments when reloading the same brush
            lightness: nextLightness,
            saturation: nextSaturation,
            editingBrushData: brushData // Store the brush data for reference
          },
          tools: {
            ...state.tools,
            brushSettings: newBrushSettings
          },
          customBrushesSize: state.customBrushesSize,
          globalBrushSize: state.customBrushesSize
        };
      }),
      saveBrushEdit: (canvas) => set((state) => {
        if (state.brushEditor.status !== 'EDITING' || !state.brushEditor.editingBounds || !state.brushEditor.editingBrushId) {
          return state;
        }

        const ctx = canvas.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings) as (CanvasRenderingContext2D | null);
        if (!ctx || !state.project) return state;

        const bounds = state.brushEditor.editingBounds;
        const brushId = state.brushEditor.editingBrushId;
        
        // Find the original brush data (unused variable removed)
        
        // Create a composite canvas to match the inline editor canvas size
        const compositeCanvas = document.createElement('canvas');
        compositeCanvas.width = canvas.width;
        compositeCanvas.height = canvas.height;
        const compositeCtx = compositeCanvas.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings) as (CanvasRenderingContext2D | null);

        if (!compositeCtx) return state;
        
        // Get the pixels directly from the inline editor canvas (starts at 0,0)
        // Note: The canvas already has the hue/lightness/saturation adjustments applied
        // by the BrushEditorUI component's effect, so we don't need to apply them again
        const editedImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        
        // Put the image data on the composite canvas
        compositeCtx.putImageData(editedImageData, 0, 0);

        // Create thumbnail (max 64x64)
        const thumbnailSize = 64;
        const thumbnailCanvas = document.createElement('canvas');
        thumbnailCanvas.width = thumbnailSize;
        thumbnailCanvas.height = thumbnailSize;
        const thumbnailCtx = thumbnailCanvas.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings) as (CanvasRenderingContext2D | null);
        
        let thumbnail = '';
        if (thumbnailCtx) {
          // Scale to fit thumbnail while maintaining aspect ratio
          const scale = Math.min(thumbnailSize / canvas.width, thumbnailSize / canvas.height);
          const scaledWidth = canvas.width * scale;
          const scaledHeight = canvas.height * scale;
          const offsetX = (thumbnailSize - scaledWidth) / 2;
          const offsetY = (thumbnailSize - scaledHeight) / 2;
          
          // Set background to transparent
          thumbnailCtx.clearRect(0, 0, thumbnailSize, thumbnailSize);
          
          // Create temporary canvas for the edited area
          const tempCanvas = document.createElement('canvas');
          tempCanvas.width = canvas.width;
          tempCanvas.height = canvas.height;
          const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
          
          if (tempCtx) {
            tempCtx.putImageData(editedImageData, 0, 0);
            // Draw scaled version to thumbnail
            thumbnailCtx.drawImage(
              tempCanvas,
              0, 0, bounds.width, bounds.height,         // Source: full tempCanvas
              offsetX, offsetY, scaledWidth, scaledHeight // Destination: scaled in thumbnail
            );
          }
          
          thumbnail = thumbnailCanvas.toDataURL();
        }

        // Note: The canvas parameter here should be the inline canvas from BrushEditorUI,
        // not the main canvas. We don't need to clear it since it's a separate UI element
        // that will be hidden after saving. The main canvas will be properly recomposed
        // via the layersNeedRecomposition flag below

        // Check if this is an existing custom brush or a default brush being turned into custom
        const existingCustomBrush = state.project.customBrushes?.find(b => b.id === brushId);
        let updatedCustomBrushes: CustomBrush[];
        let targetCustomBrushId: string;
        
        if (existingCustomBrush) {
          // Update existing custom brush
          updatedCustomBrushes = state.project.customBrushes!.map(brush => 
            brush.id === brushId 
              ? { ...brush, imageData: editedImageData, thumbnail, width: canvas.width, height: canvas.height }
              : brush
          );
          targetCustomBrushId = existingCustomBrush.id;
        } else {
          // This was a default brush - create a new custom brush
          const defaultBrush = brushPresets.find(b => b.id === brushId);
          const newCustomBrushId = `custom-${brushId}-${Date.now()}`;
          const newCustomBrush: CustomBrush = {
            id: newCustomBrushId,
            name: `Custom ${defaultBrush?.name || 'Brush'}`,
            imageData: editedImageData,
            thumbnail,
            width: canvas.width,
            height: canvas.height,
            createdAt: Date.now()
          };
          
          updatedCustomBrushes = [...(state.project.customBrushes || []), newCustomBrush];
          targetCustomBrushId = newCustomBrushId;
        }

        // Find the updated custom brush to set as current
        const updatedBrush = updatedCustomBrushes.find(b => b.id === targetCustomBrushId);
        
        // Clear brush cache to ensure updated brush is used immediately
        brushCache.clear();
        scaledBrushCache.clear();
        
        return {
          project: {
            ...state.project,
            customBrushes: updatedCustomBrushes,
            updatedAt: new Date()
          },
          brushEditor: defaultBrushEditorState,
          tools: {
            ...state.tools,
            brushSettings: {
              ...state.tools.brushSettings,
              brushShape: BrushShape.CUSTOM,
              selectedCustomBrush: targetCustomBrushId,
              size: 100, // Always set to 100% size after editing
              currentBrushTip: updatedBrush ? {
                imageData: updatedBrush.imageData,
                brushId: updatedBrush.id,
                isColorizable: false,
                width: updatedBrush.width,
                height: updatedBrush.height
              } : undefined // Set the updated brush data immediately
            }
          },
          customBrushesSize: state.customBrushesSize, // Keep current custom brush size
          globalBrushSize: state.customBrushesSize // Keep slider in sync
          // REMOVED: layersNeedRecomposition: true - brush editing doesn't change layers
        };
      }),
      setBrushEditorHue: (hue: number) => set((state) => ({
        brushEditor: { ...state.brushEditor, hueShift: hue },
        tools: {
          ...state.tools,
          brushSettings: {
            ...state.tools.brushSettings,
            hueShift: hue
          }
        }
      })),
      setBrushEditorLightness: (lightness: number) => set((state) => ({
        brushEditor: { ...state.brushEditor, lightness },
        tools: {
          ...state.tools,
          brushSettings: {
            ...state.tools.brushSettings,
            lightnessAdjust: lightness
          }
        }
      })),
      setBrushEditorSaturation: (saturation: number) => set((state) => ({
        brushEditor: { ...state.brushEditor, saturation },
        tools: {
          ...state.tools,
          brushSettings: {
            ...state.tools.brushSettings,
            saturationAdjust: saturation
          }
        }
      })),
      updateCurrentBrushTip: (brushTip) => set((state) => ({
        tools: {
          ...state.tools,
          brushSettings: {
            ...state.tools.brushSettings,
            currentBrushTip: brushTip
          }
        }
      })),
      refreshCurrentBrushTipFromSource: () => set((state) => {
        if (state.brushEditor.status === 'EDITING') {
          return {};
        }

        const settings = state.tools.brushSettings;
        if (settings.brushShape !== BrushShape.CUSTOM || !settings.selectedCustomBrush) {
          return {};
        }

        const brushId = settings.selectedCustomBrush;
        const fromProject = state.project?.customBrushes?.find((brush) => brush.id === brushId);
        const fromTemporary = state.temporaryCustomBrush && state.temporaryCustomBrush.id === brushId
          ? state.temporaryCustomBrush
          : null;
        const sourceBrush = fromProject || fromTemporary;
        if (!sourceBrush) {
          return {};
        }

        const hueShift = settings.hueShift ?? 0;
        const lightnessAdjust = settings.lightnessAdjust ?? 0;
        const saturationAdjust = settings.saturationAdjust ?? 100;

        const needsAdjustment = hueShift !== 0 || lightnessAdjust !== 0 || saturationAdjust !== 100;
        const baseImageData = sourceBrush.imageData;
        const adjustedImageData = needsAdjustment
          ? adjustHueLightnessSaturation(baseImageData, hueShift, lightnessAdjust, saturationAdjust)
          : new ImageData(new Uint8ClampedArray(baseImageData.data), baseImageData.width, baseImageData.height);

        const nextBrushTip = {
          imageData: adjustedImageData,
          brushId: sourceBrush.id,
          isColorizable: false,
          width: sourceBrush.width,
          height: sourceBrush.height
        } as BrushSettings['currentBrushTip'];

        try {
          scaledBrushCache.clearForBrush('current-brush-tip');
          scaledBrushCache.clearForBrush(sourceBrush.id);
        } catch {}

        return {
          tools: {
            ...state.tools,
            brushSettings: {
              ...state.tools.brushSettings,
              currentBrushTip: nextBrushTip
            }
          }
        };
      }),
      cancelBrushEdit: () => set((state) => {
        if (state.brushEditor.status !== 'EDITING' || !state.brushEditor.originalCanvasState || !state.brushEditor.editingBounds) {
          return { 
            brushEditor: defaultBrushEditorState,
            tools: {
              ...state.tools,
              brushSettings: {
                ...state.tools.brushSettings,
                currentBrushTip: undefined,
                selectedCustomBrush: null,
                brushShape: BrushShape.ROUND // Reset to default
              }
            }
            // REMOVED: layersNeedRecomposition: true - brush editing doesn't change layers
          };
        }

        // NOTE: We don't need to restore anything to the main canvas
        // The brush editor works entirely in its own inline canvas

        // Clear currentBrushTip when canceling brush edit
        return { 
          brushEditor: defaultBrushEditorState,
          tools: {
            ...state.tools,
            brushSettings: {
              ...state.tools.brushSettings,
              currentBrushTip: undefined,
              selectedCustomBrush: null,
              brushShape: BrushShape.ROUND // Reset to default
            }
          }
          // REMOVED: layersNeedRecomposition: true - brush editing doesn't change layers
        };
      }),
      
      // History Management

      
      undo: async () => {
        return get().withColorCycleSuspended('history-apply', async () => {
          const pendingEntry = historyManager.peekUndo();
          if (!pendingEntry) {
            return null;
          }

          const hasLegacySnapshot = pendingEntry.deltas.some((delta) => isLegacySnapshotDelta(delta));
          const requiresComposite = entryRequiresComposite(pendingEntry);
          let currentSnapshot: CanvasSnapshot | null = null;
          let previousSnapshot: CanvasSnapshot | null = null;

          if (hasLegacySnapshot) {
            const snapshotState = get();
            if (snapshotState.history.undoStack.length <= 1) {
              return null;
            }

            currentSnapshot =
              snapshotState.history.undoStack[snapshotState.history.undoStack.length - 1] ?? null;
            previousSnapshot =
              snapshotState.history.undoStack[snapshotState.history.undoStack.length - 2] ?? null;
          }

          const pendingLayerId =
            typeof pendingEntry.meta?.['layerId'] === 'string'
              ? (pendingEntry.meta['layerId'] as string)
              : null;

          if (pendingLayerId) {
            await waitForFinalizeQueueIdle(pendingLayerId);
            await waitForPendingColorCycleSaves(pendingLayerId);
          } else {
            await waitForFinalizeQueueIdle();
          }

          await historyManager.undo();

          set((state) => {
            const nextHistory = {
              ...state.history,
              isCapturing: false,
            };

            if (hasLegacySnapshot && currentSnapshot) {
              nextHistory.undoStack = state.history.undoStack.slice(0, -1);
              nextHistory.redoStack = [currentSnapshot, ...state.history.redoStack];
            }

            return {
              history: nextHistory,
              layersNeedRecomposition: requiresComposite ? true : state.layersNeedRecomposition,
            };
          });

          return previousSnapshot;
        });
      },
      
      redo: async () => {
        return get().withColorCycleSuspended('history-apply', async () => {
          const pendingEntry = historyManager.peekRedo();
          if (!pendingEntry) {
            return null;
          }

          const hasLegacySnapshot = pendingEntry.deltas.some((delta) => isLegacySnapshotDelta(delta));
          const requiresComposite = entryRequiresComposite(pendingEntry);
          let stateToRestore: CanvasSnapshot | null = null;

          if (hasLegacySnapshot) {
            const snapshotState = get();
            if (snapshotState.history.redoStack.length === 0) {
              return null;
            }
            stateToRestore = snapshotState.history.redoStack[0] ?? null;
          }

          const pendingLayerId =
            typeof pendingEntry.meta?.['layerId'] === 'string'
              ? (pendingEntry.meta['layerId'] as string)
              : null;

          if (pendingLayerId) {
            await waitForFinalizeQueueIdle(pendingLayerId);
            await waitForPendingColorCycleSaves(pendingLayerId);
          } else {
            await waitForFinalizeQueueIdle();
          }

          await historyManager.redo();

          set((state) => {
            const nextHistory = {
              ...state.history,
              isCapturing: false,
            };

            if (hasLegacySnapshot && stateToRestore) {
              nextHistory.redoStack = state.history.redoStack.slice(1);
              nextHistory.undoStack = [...state.history.undoStack, stateToRestore];
            }

            return {
              history: nextHistory,
              layersNeedRecomposition: requiresComposite ? true : state.layersNeedRecomposition,
            };
          });

          return stateToRestore;
        });
      },
      
      canUndo: () => Boolean(historyManager.peekUndo()),
      canRedo: () => Boolean(historyManager.peekRedo()),
      
      clearHistory: () => {
        historyManager.clear();
        set((state) => ({
          history: {
            ...state.history,
            undoStack: [],
            redoStack: []
          }
        }));
      },
      
      // Project Save/Load Management
      saveProject: async (filename?: string) => {
        const state = get();
        if (!state.project) {
          throw new Error('No project to save');
        }
        
        try {
          // Capture current canvas state to active layer before saving
          await state.captureCanvasToActiveLayer();
          
          // Get fresh state after capture and save view state
          const freshState = get();
          const projectWithViewState = {
            ...freshState.project!,
            viewState: {
              zoom: freshState.canvas.zoom
            },
            brushSpecificSettings: freshState.brushSpecificSettings,
            globalBrushSize: freshState.globalBrushSize,
            palette: freshState.palette
          };
          
          await saveProjectToFile(projectWithViewState, filename, freshState.layers);
          set({ paletteDirty: false });
          state.addNotification({
            type: 'success',
            title: 'Project Saved',
            message: `${state.project.name} has been saved successfully`,
            timestamp: new Date()
          });
        } catch (error) {
          state.addNotification({
            type: 'error',
            title: 'Save Failed',
            message: error instanceof Error ? error.message : 'Failed to save project',
            timestamp: new Date()
          });
          throw error;
        }
      },
      
      loadProject: async () => {
        const state = get();
        
        try {
          const loadedProject = await loadProjectFromFile();
          
          // Restore color cycle brushes for CC layers BEFORE setting them in store
          // This ensures the layers have their colorCycleData properly populated
          const layersWithRestoredColorCycles = await restoreColorCycleBrushes(loadedProject.layers);
          
          // VERIFICATION: Log layer states before setting
          const finalLayers = layersWithRestoredColorCycles || loadedProject.layers;
          console.log('🔵 LOAD PROJECT - Final layers being set:', finalLayers.map(l => ({
            id: l.id?.substring(0, 20),
            type: l.layerType,
            hasColorCycleData: !!l.colorCycleData
          })));
          
          const normalizedProject = normalizeProject(loadedProject);
          const normalizedPalette = normalizedProject.palette ?? createDefaultPalette();
          const projectWithPalette = {
            ...normalizedProject,
            palette: normalizedPalette
          };
          const toolsWithPalette = {
            ...state.tools,
            brushSettings: {
              ...state.tools.brushSettings,
              color: normalizedPalette.foregroundColor
            },
            eraserSettings:
              state.tools.currentTool === 'eraser'
                ? { ...state.tools.eraserSettings, color: normalizedPalette.foregroundColor }
                : state.tools.eraserSettings
          };
          const normalizedLayers = normalizeLayers(finalLayers);
          const syncedLayers = syncPercentOffsetsFromPixels(normalizedLayers, normalizedProject);

          // Update the store with the loaded project and restored layers
          set({
            project: projectWithPalette,
            palette: normalizedPalette,
            paletteDirty: false,
            layers: syncedLayers,
            activeLayerId: loadedProject.layers[0]?.id || null,
            selectedLayerIds: loadedProject.layers[0]?.id ? [loadedProject.layers[0].id] : [],
            layersNeedRecomposition: true,
            referenceLayerId: null,
            // Restore view state if available
            canvas: loadedProject.viewState ? {
              ...get().canvas,
              zoom: loadedProject.viewState.zoom
            } : get().canvas,
            // Restore brush-specific settings
            brushSpecificSettings: loadedProject.brushSpecificSettings || {},
            // Restore global brush size
            globalBrushSize: loadedProject.globalBrushSize || 10,
            tools: toolsWithPalette
          });
          
          // Restore canvas dimensions to match the loaded project
          state.setCanvasDimensions(loadedProject.width, loadedProject.height);
          
          // Update current brush size to match global
          const currentState = get();
          if (currentState.tools && currentState.globalBrushSize) {
            set((s) => ({
              tools: {
                ...s.tools,
                brushSettings: {
                  ...s.tools.brushSettings,
                  size: currentState.globalBrushSize
                }
              }
            }));
          }

          // Register restored color cycle brushes with the manager so they aren't recreated blank
          if (colorCycleBrushManager) {
            const postLoadState = get();
            const colorCycleLayerIds = new Set(
              postLoadState.layers
                .filter(layer => layer.layerType === 'color-cycle')
                .map(layer => layer.id)
            );

            try {
              colorCycleBrushManager.cleanupOrphanedBrushes(colorCycleLayerIds);
            } catch (error) {
              console.warn('[Store] Failed to cleanup orphaned color cycle brushes during load:', error);
            }

            const now = Date.now();
            const projectWidth = postLoadState.project?.width ?? loadedProject.width ?? 0;
            const projectHeight = postLoadState.project?.height ?? loadedProject.height ?? 0;

            for (const layer of postLoadState.layers) {
              if (layer.layerType !== 'color-cycle' || !layer.colorCycleData?.colorCycleBrush) {
                continue;
              }

              const brush = layer.colorCycleData.colorCycleBrush as ColorCycleBrushImplementation & {
                setLayerId?: (layerId: string) => void;
                isUsingWebGL?: () => boolean;
              };

              try {
                brush.setLayerId?.(layer.id);
              } catch (error) {
                console.warn('[Store] Failed to set layerId on restored color cycle brush:', error);
              }

              colorCycleBrushManager.brushes.set(layer.id, brush);
              colorCycleBrushManager.brushMetadata.set(layer.id, {
                layerId: layer.id,
                created: now,
                lastUsed: now,
                width: layer.colorCycleData.canvas?.width ?? projectWidth,
                height: layer.colorCycleData.canvas?.height ?? projectHeight,
                gradientHash: undefined,
                isActive: false
              });
              colorCycleBrushManager.activeResources.add(layer.id);
              colorCycleBrushManager.activeResources.add(`canvas_${layer.id}`);

              try {
                if (brush.isUsingWebGL?.()) {
                  colorCycleBrushManager.activeResources.add(`webgl_${layer.id}`);
                }
              } catch (error) {
                console.warn('[Store] Failed to register WebGL resource for restored CC brush:', error);
              }
            }

            if (postLoadState.activeLayerId) {
              try {
                colorCycleBrushManager.setActiveState(postLoadState.activeLayerId, true);
              } catch (error) {
                console.warn('[Store] Failed to set active CC brush state during load:', error);
              }
            }
          }
          
          // Clear history when loading a new project
          state.clearHistory();
          
          // Force recomposition after a short delay to ensure canvas is ready
          setTimeout(() => {
            const currentState = get();
            if (currentState.layersNeedRecomposition === false) {
              set({ layersNeedRecomposition: true });
            }
          }, 100);
          
          state.addNotification({
            type: 'success',
            title: 'Project Loaded',
            message: `${loadedProject.name} has been loaded successfully`,
            timestamp: new Date()
          });
        } catch (error) {
          state.addNotification({
            type: 'error',
            title: 'Load Failed',
            message: error instanceof Error ? error.message : 'Failed to load project',
            timestamp: new Date()
          });
          throw error;
        }
      },
      
      exportProject: async (format: 'png', options = {}) => {
        const state = get();
        if (!state.project) {
          throw new Error('No project to export');
        }
        
        try {
          if (format === 'png') {
            await exportProjectAsPNG(state.project, state.layers, options);
            state.addNotification({
              type: 'success',
              title: 'Export Complete',
              message: `${state.project.name} has been exported as PNG`,
              timestamp: new Date()
            });
          } else {
            throw new Error(`Unsupported export format: ${format}`);
          }
        } catch (error) {
          state.addNotification({
            type: 'error',
            title: 'Export Failed',
            message: error instanceof Error ? error.message : 'Failed to export project',
            timestamp: new Date()
          });
          throw error;
        }
      },
      
      newProject: (width: number, height: number, name = 'Untitled') => {
        const currentState = get();
        const layerIdFactory = () => `layer-${Date.now()}-${Math.random()}`;

        // Create the base regular layer (Layer 1)
        const defaultLayerId = layerIdFactory();
        const defaultFramebuffer = new OffscreenCanvas(width, height);
        const defaultLayer: Layer = {
          id: defaultLayerId,
          name: 'Layer 1',
          visible: true,
          opacity: 1,
          blendMode: 'source-over',
          order: 0,
          locked: false,
          transparencyLocked: false,
          imageData: new ImageData(width, height),
          framebuffer: defaultFramebuffer,
          alignment: createDefaultLayerAlignment(),
          layerType: 'normal' // REQUIRED field
        };

        // Prepare a default color cycle layer that ships with every new project
        const colorCycleLayerId = layerIdFactory();
        const colorCycleFramebuffer = new OffscreenCanvas(width, height);
        const colorCycleCanvas =
          typeof document !== 'undefined'
            ? (() => {
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                return canvas;
              })()
            : undefined;
        const fallbackColorCycleGradient = [
          { position: 0.0, color: '#ff0000' },
          { position: 0.17, color: '#ff7f00' },
          { position: 0.33, color: '#ffff00' },
          { position: 0.5, color: '#00ff00' },
          { position: 0.67, color: '#0000ff' },
          { position: 0.83, color: '#4b0082' },
          { position: 1.0, color: '#9400d3' }
        ];
        const gradientSource = currentState.tools?.brushSettings?.colorCycleGradient;
        const initialColorCycleGradient = (gradientSource ?? fallbackColorCycleGradient).map(stop => ({
          position: stop.position,
          color: stop.color
        }));
        const initialColorCycleSpeed =
          currentState.tools?.brushSettings?.colorCycleSpeed ?? 0.1;
        const colorCycleLayer: Layer = {
          id: colorCycleLayerId,
          name: 'CC Layer 1',
          visible: true,
          opacity: 1,
          blendMode: 'source-over',
          order: 1,
          locked: false,
          transparencyLocked: false,
          imageData: null,
          framebuffer: colorCycleFramebuffer,
          alignment: createDefaultLayerAlignment(),
          layerType: 'color-cycle',
          colorCycleData: {
            mode: 'brush',
            gradient: initialColorCycleGradient,
            isAnimating: true,
            brushSpeed: initialColorCycleSpeed,
            canvas: colorCycleCanvas
          }
        };

        const newPalette = createDefaultPalette();
        const newProject: Project = {
          id: `project-${Date.now()}-${Math.random()}`,
          name,
          width,
          height,
          layers: [], // Keep empty - we'll use top-level layers instead
          backgroundColor: 'transparent',
          createdAt: new Date(),
          updatedAt: new Date(),
          customBrushes: [],
          brushSpecificSettings: {},
          exportLayout: createDefaultExportLayout(),
          palette: newPalette
        };

        const normalizedProject = normalizeProject(newProject);
        const normalizedPalette = normalizedProject.palette ?? createDefaultPalette();
        const projectWithPalette = {
          ...normalizedProject,
          palette: normalizedPalette
        };
        const normalizedLayers = normalizeLayers([defaultLayer, colorCycleLayer]);
        const syncedLayers = syncPercentOffsetsFromPixels(normalizedLayers, normalizedProject);

        setActiveHistoryDocument(normalizedProject.id);

        set({
          project: projectWithPalette,
          palette: normalizedPalette,
          paletteDirty: false,
          layers: syncedLayers, // Only set top-level layers
          activeLayerId: defaultLayerId,
          selectedLayerIds: defaultLayerId ? [defaultLayerId] : [],
          referenceLayerId: null,
          canvas: {
            ...get().canvas,
            canvasWidth: width,
            canvasHeight: height
          },
          layersNeedRecomposition: true
          // Preserve brush settings across projects - they are user preferences
        });

        if (typeof window !== 'undefined') {
          setTimeout(() => {
            try {
              get().initColorCycleForLayer(colorCycleLayerId, width, height);
            } catch (error) {
              logError('[Store] Failed to initialize default color cycle layer', error);
            }
          }, 0);
        }
        
        // Clear history for new project
        get().clearHistory();
      },
      
      compositeLayersToCanvas: (targetCanvas: HTMLCanvasElement) => {
        const state = get();

        try {
          if (!state.project || !state.layers.length) {
            return;
          }

          const ctx = targetCanvas.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings) as (CanvasRenderingContext2D | null);
          if (!ctx) {
            return;
          }

          // Check if we should use pixel-perfect rendering (based on current tool/brush)
          const currentState = get();
          const isPixelBrush = currentState.tools.brushSettings.brushShape === 'pixel_round' ||
                               (currentState.tools.brushSettings.brushShape === 'square' && !currentState.tools.brushSettings.antialiasing);

          // Set image smoothing based on brush type
          ctx.imageSmoothingEnabled = !isPixelBrush;

          // Set canvas dimensions to match project size
          const expectedWidth = state.project.width;
          const expectedHeight = state.project.height;

          // Only resize canvas if dimensions don't match
          if (targetCanvas.width !== expectedWidth || targetCanvas.height !== expectedHeight) {
            targetCanvas.width = expectedWidth;
            targetCanvas.height = expectedHeight;
          }

          // Clear the canvas
          ctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);

          // Draw background color if not transparent
          if (state.project.backgroundColor && state.project.backgroundColor !== 'transparent') {
            ctx.fillStyle = state.project.backgroundColor;
            ctx.fillRect(0, 0, targetCanvas.width, targetCanvas.height);
          }

          const sortedLayers = [...state.layers].sort((a, b) => a.order - b.order);

          for (const layer of sortedLayers) {
            try {
              if (!layer.visible) continue;

              // Brush-based Color Cycle (Canvas2D path)
              if (
                layer.layerType === 'color-cycle' &&
                layer.colorCycleData?.canvas &&
                layer.colorCycleData?.mode !== 'recolor'
              ) {
                const mgr = getColorCycleBrushManager();
                const brush = mgr?.getBrush(layer.id);
                const wantPlaying = !!layer.colorCycleData.isAnimating;

                if (brush) {
                  try {
                    const playing = typeof brush.isPlaying === 'function' ? brush.isPlaying() : false;

                    if (wantPlaying && !playing) {
                      brush.startAnimation?.();
                    } else if (!wantPlaying && playing) {
                      brush.stopAnimation?.();
                    }

                    if (wantPlaying) {
                      brush.updateAnimation?.();
                    }
                    brush.renderDirectToCanvas?.(layer.colorCycleData.canvas, layer.id);
                  } catch (e) {
                    logError('[compose] CC advance/render failed', e);
                  }
                }

                ctx.globalCompositeOperation = layer.blendMode;
                ctx.globalAlpha = layer.opacity;
                ctx.drawImage(layer.colorCycleData.canvas, 0, 0);
                continue;
              }

              // Recolor mode (GPU path): draw GPU-updated canvas if available
              if (layer.layerType === 'color-cycle' && layer.colorCycleData?.mode === 'recolor' && layer.colorCycleData.canvas) {
                ctx.globalCompositeOperation = layer.blendMode;
                ctx.globalAlpha = layer.opacity;
                ctx.drawImage(layer.colorCycleData.canvas, 0, 0);
                continue;
              }

              // Normal layers
              if (!layer.imageData) {
                continue;
              }
              const layerImageData = layer.imageData;
              const layerCanvas = document.createElement('canvas');
              layerCanvas.width = layerImageData.width;
              layerCanvas.height = layerImageData.height;
              const layerCtx = layerCanvas.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings) as (CanvasRenderingContext2D | null);
              if (layerCtx) {
                layerCtx.putImageData(layerImageData, 0, 0);
                ctx.globalCompositeOperation = layer.blendMode;
                ctx.globalAlpha = layer.opacity;
                ctx.drawImage(layerCanvas, 0, 0);
              }
            } catch (layerError) {
              logError('[compose] Layer compose error', layerError);
              // Continue composing remaining layers
            }
          }

          // Reset context state
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = 1.0;
        } catch (e) {
          logError('[compose] Compose failed', e);
        } finally {
        }
      },
      
      captureCanvasToActiveLayer: async (sourceCanvas?: HTMLCanvasElement, roi?: CaptureROI) => {
        const state = get();

        // Skip if we're in the middle of a history operation
        if (state.history.isCapturing) {
          return;
        }

        if (!state.project || state.layers.length === 0) {
          return;
        }

        // Try to get the source canvas (offscreen canvas with the drawing)
        const canvas = sourceCanvas;

        if (!canvas) {
          return;
        }

        const ctx = canvas.getContext(
          '2d',
          { willReadFrequently: true } as CanvasRenderingContext2DSettings
        ) as CanvasRenderingContext2D | null;
        if (!ctx) {
          return;
        }

        try {
          const projectWidth = state.project.width;
          const projectHeight = state.project.height;
          const captureWidth = Math.min(projectWidth, canvas.width);
          const captureHeight = Math.min(projectHeight, canvas.height);

          const normalizedRoi = normalizeCaptureROI(roi, captureWidth, captureHeight);
          const captureX = normalizedRoi ? normalizedRoi.x : 0;
          const captureY = normalizedRoi ? normalizedRoi.y : 0;
          const regionWidth = normalizedRoi ? normalizedRoi.width : captureWidth;
          const regionHeight = normalizedRoi ? normalizedRoi.height : captureHeight;

          const capturedImageData = ctx.getImageData(captureX, captureY, regionWidth, regionHeight);

          // Find the active layer or use the first layer
          const activeLayerId = state.activeLayerId || state.layers[0]?.id;
          
          if (activeLayerId) {
            // Update the layer AND immediately trigger recomposition in one atomic update
            set((currentState) => {
              // CRITICAL FIX: Use the activeLayerId parameter, not the one from state
              // This ensures we're updating the correct layer even if activeLayerId changed
              const targetLayerId = activeLayerId;
              
              const updatedLayers = currentState.layers.map(layer => {
                if (layer.id === targetLayerId) {
                  // Update both imageData and framebuffer to stay in sync
                  const fb = layer.framebuffer;
                  // Ensure framebuffer matches capture dimensions to avoid clipping
                  if (fb.width !== captureWidth || fb.height !== captureHeight) {
                    fb.width = captureWidth;
                    fb.height = captureHeight;
                  }
                  const framebufferCtx = fb.getContext(
                    '2d',
                    { willReadFrequently: true } as CanvasRenderingContext2DSettings
                  ) as (CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null);
                  if (framebufferCtx) {
                    if (normalizedRoi) {
                      framebufferCtx.putImageData(capturedImageData, captureX, captureY);
                    } else {
                      framebufferCtx.clearRect(0, 0, fb.width, fb.height);
                      framebufferCtx.putImageData(capturedImageData, 0, 0);
                    }
                  }
                  const baseImageData =
                    layer.imageData &&
                    layer.imageData.width === captureWidth &&
                    layer.imageData.height === captureHeight
                      ? layer.imageData
                      : null;
                  const mergedImageData = normalizedRoi
                    ? mergeImageDataRegion(
                        baseImageData,
                        capturedImageData,
                        captureX,
                        captureY,
                        captureWidth,
                        captureHeight
                      )
                    : capturedImageData;

                  let nextAlignment = layer.alignment;
                  const project = currentState.project;
                  if (project && nextAlignment && nextAlignment.positioning === 'auto') {
                    try {
                      const layerForMetrics: Layer = {
                        ...layer,
                        imageData: mergedImageData,
                        alignment: {
                          ...nextAlignment,
                          offsetPercent: undefined,
                          offsetPx: undefined
                        }
                      };
                      const percentOffset = computeLayerPercentOffset(layerForMetrics, project);
                      const projectWidth = Math.max(1, project.width);
                      const projectHeight = Math.max(1, project.height);
                      nextAlignment = {
                        ...nextAlignment,
                        offsetPercent: percentOffset,
                        offsetPx: {
                          x: Math.round((percentOffset.x / 100) * projectWidth),
                          y: Math.round((percentOffset.y / 100) * projectHeight)
                        }
                      };
                    } catch (error) {
                      console.warn('[captureCanvasToActiveLayer] Failed to sync percent alignment', error);
                    }
                  }
                  // CRITICAL: Preserve ALL layer properties including layerType and colorCycleData
                  // Use spread operator first to preserve everything, then override only imageData
                  const updatedLayer = { 
                    ...layer, 
                    imageData: mergedImageData,
                    alignment: nextAlignment,
                    version: (layer.version || 0) + 1 // Increment version for color swatch updates
                    // Don't explicitly set layerType and colorCycleData - they're already in ...layer
                  };
                  
                  // VALIDATION: Ensure layer type hasn't changed
                  if (updatedLayer.layerType !== layer.layerType) {
                    console.error('🚨 LAYER TYPE CORRUPTION IN CAPTURE!', {
                      layerId: layer.id?.substring(0, 20),
                      originalType: layer.layerType,
                      corruptedType: updatedLayer.layerType
                    });
                    // Force restore the original layer type
                    updatedLayer.layerType = layer.layerType;
                  }
                  
                  return updatedLayer;
                }
                return layer;
              });
              
              // CRITICAL: Set both layers AND recomposition flag in the same update
              const syncedLayers = syncPercentOffsetsFromPixels(updatedLayers, currentState.project ?? null);
              return {
                layers: syncedLayers,
                layersNeedRecomposition: true
              };
            });
            
            // Remove the setTimeout - it can cause race conditions with layer switching
            // The state update is synchronous, we don't need to wait
            
          }
        } catch (error) {
          throw error; // Re-throw to trigger the catch in DrawingCanvas
        }
      },
      
      captureCanvasToLayer: async (sourceCanvas: HTMLCanvasElement, targetLayerId: string | null) => {
        const state = get();
        // Skip if we're in the middle of a history operation
        if (state.history.isCapturing) {
          return;
        }
        
        // Skip if we're in the middle of a history operation
        if (state.history.isCapturing) {
          return;
        }
        
        if (!state.project || state.layers.length === 0) {
          return;
        }
        
        if (!targetLayerId) {
          return;
        }

        const ctx = sourceCanvas.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings) as (CanvasRenderingContext2D | null);
        if (!ctx) {
          return;
        }
        
        try {
          // Capture only the project area, not the full canvas
          const captureWidth = Math.min(state.project.width, sourceCanvas.width);
          const captureHeight = Math.min(state.project.height, sourceCanvas.height);
          
          const imageData = ctx.getImageData(0, 0, captureWidth, captureHeight);
          
          // Find the target layer
          const targetLayer = state.layers.find(l => l.id === targetLayerId);
          if (!targetLayer) {
            return;
          }
          
          // Update the specific layer with the captured ImageData
          set((currentState) => {
            const updatedLayers = currentState.layers.map(layer => {
              if (layer.id !== targetLayerId) return layer;
              const fb = layer.framebuffer;
              if (fb.width !== imageData.width || fb.height !== imageData.height) {
                fb.width = imageData.width;
                fb.height = imageData.height;
              }
              const ctx2 = fb.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings) as (CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null);
              if (ctx2) {
                ctx2.clearRect(0, 0, fb.width, fb.height);
                ctx2.putImageData(imageData, 0, 0);
              }
              return {
                ...layer,
                imageData
              };
            });
            const syncedLayers = syncPercentOffsetsFromPixels(updatedLayers, currentState.project ?? null);
            return {
              layers: syncedLayers,
              layersNeedRecomposition: true
            };
          });
          
          // Remove the setTimeout - it can cause race conditions with layer switching
          
        } catch (error) {
          console.error('Capture to specific layer failed with error:', error);
        }
      },
      
      // Autosave Methods
      setAutosaveEnabled: (enabled) => set((state) => ({
        autosave: { ...state.autosave, isEnabled: enabled }
      })),
      setFileBackupEnabled: (enabled) => set((state) => ({
        autosave: { ...state.autosave, fileBackup: { ...state.autosave.fileBackup, enabled } }
      })),
      setFileBackupMode: (mode) => set((state) => ({
        autosave: { ...state.autosave, fileBackup: { ...state.autosave.fileBackup, mode } }
      })),
      setFileBackupFile: (handle, path) => set((state) => ({
        autosave: { ...state.autosave, fileBackup: { ...state.autosave.fileBackup, fileHandle: handle, backupPath: path || null } }
      })),
      setFileBackupDirectory: (handle, path) => set((state) => ({
        autosave: { ...state.autosave, fileBackup: { ...state.autosave.fileBackup, directoryHandle: handle, backupPath: path || null } }
      })),
      clearDirtyState: () => set((state) => ({
        autosave: { ...state.autosave, hasUnsavedChanges: false }
      })),
      updateFileBackupTime: () => set((state) => ({
        autosave: { ...state.autosave, fileBackup: { ...state.autosave.fileBackup, lastBackupTime: new Date() } }
      })),
      setAutosaveInterval: (interval) => set((state) => ({
        autosave: { ...state.autosave, interval }
      })),
      setHistorySize: (size) => {
        historyManager.setMaxEntries(size);
        set((state) => ({
          history: { ...state.history, maxHistorySize: size }
        }));
      },
      
      // Brush-specific settings methods
      saveBrushSettings: (brushId, settings) => set((state) => {
        const existingSettings = state.brushSpecificSettings[brushId] || {};
        const newSettings = { ...existingSettings, ...settings };
        
        return { 
          brushSpecificSettings: {
            ...state.brushSpecificSettings,
            [brushId]: newSettings
          }
        };
      }),
      loadBrushSettings: (brushId) => {
        const state = get();
        const loadedSettings = state.brushSpecificSettings[brushId] || {};

        const normalized = {
          ...loadedSettings,
        } as Partial<BrushSettings> & { colorCycleFlowForward?: boolean };

        if (normalized.colorCycleFlowForward !== undefined) {
          normalized.colorCycleFlowMode = normalized.colorCycleFlowForward === false ? 'reverse' : 'forward';
          delete normalized.colorCycleFlowForward;
        }

        return normalized;
      },
      clearBrushSettings: (brushId) => set((state) => {
        const { [brushId]: removed, ...remaining } = state.brushSpecificSettings;
        void removed;
        return { brushSpecificSettings: remaining };
      })
    };
    }
  // ),
  // { name: 'vessel-store' }
);

export const selectColorCyclePlayback = (state: AppState): ColorCycleUIState => state.colorCyclePlayback;
export const selectColorCycleDesiredPlaying = (state: AppState): boolean =>
  state.colorCyclePlayback.desiredPlaying;
export const selectColorCycleSuspendDepth = (state: AppState): number =>
  state.colorCyclePlayback.suspendDepth;
export const selectEffectiveColorCyclePlaying = (state: AppState): boolean =>
  state.colorCyclePlayback.desiredPlaying && state.colorCyclePlayback.suspendDepth === 0;
export const selectActivePaletteColor = (state: AppState): string =>
  state.palette.activeSlot === 'background'
    ? state.palette.backgroundColor
    : state.palette.foregroundColor;

setColorCycleStoreStateGetter(() => useAppStore.getState());
configureMaskManager({
  getLayer: (layerId) => {
    const state = useAppStore.getState();
    return state.layers.find((layer) => layer.id === layerId);
  },
  updateLayer: (layerId, patch) => {
    useAppStore.getState().updateLayer(layerId, patch);
  },
  getProjectSize: () => {
    const project = useAppStore.getState().project;
    return project ? { width: project.width, height: project.height } : null;
  }
});

// Corruption detector removed - bug is fixed

// Subscribe to track all layer changes
useAppStore.subscribe((state) => {
  trackLayerChanges('STORE SUBSCRIPTION', state.layers);
  
  // Note: Zustand v4 doesn't provide previous state in subscribe
  // Would need to track manually if we need to compare
});

// DEBUG ONLY
(() => {
  try {
    const get = useAppStore.getState;
    const current = get();
    const origUpdateLayer = current.updateLayer as typeof current.updateLayer & { __ccTraceWrapped?: boolean };
    if (origUpdateLayer.__ccTraceWrapped) {
      return;
    }
    const wrapped: typeof current.updateLayer & { __ccTraceWrapped?: boolean } = (id, patch) => {
      const before = useAppStore.getState().layers.find((l) => l.id === id);
      const prev = before?.colorCycleData?.isAnimating;
      const next = patch?.colorCycleData?.isAnimating;
      if (isCcDebugEnabled() && typeof next === 'boolean' && next !== prev) {
        console.groupCollapsed('[CC:TRACE] updateLayer isAnimating flip', { id: id?.slice(-6), prev, next });
        console.log('patch:', patch);
        console.log(new Error('updateLayer:isAnimating').stack);
        console.groupEnd();
        // debugger;
      }
      return origUpdateLayer(id, patch);
    };
    wrapped.__ccTraceWrapped = true;
    origUpdateLayer.__ccTraceWrapped = true;
    get().updateLayer = wrapped;
  } catch {}
})();
