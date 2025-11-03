// Zustand store with state slices
// Based on /docs/02_System_Architecture/Overall_Design.md (lines 58-64)

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

export interface VesselWindow extends Window {
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
import { syncCCRuntimes } from './ccRuntime';
import type { ColorCycleBrushImplementation } from './colorCycleBrushManager';
import { ShapeFillOrchestrator, type ShapeFillFinalizePayload } from '@/shapeFill';
import { getFillStrategy, listFillStrategies } from '@/shapeFill/strategies';
import type { FillParams, ShapeFillId, ShapeFillSession, ShapeFillParamKey, Vec2 } from '@/shapeFill/types';
import { FillStage } from '@/shapeFill/types';
import { RecolorManager } from '@/lib/colorCycle/RecolorManager';
import { configureMaskManager } from '@/layers/MaskManager';
import { clampPressurePercent, getDefaultMaxPressurePercent } from '@/utils/pressureSettings';

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
  KeyboardScopeEntry,
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
import { createCustomBrushPersistence } from '@/stores/helpers/customBrushPersistence';
import {
  cloneImageDataForHistory,
} from '@/stores/helpers/historyLifecycle';
import { createHistorySlice } from '@/stores/slices/historySlice';
import { createLayersSlice } from '@/stores/slices/layersSlice';
import { createProjectSlice } from '@/stores/slices/projectSlice';
import { createVesselStore } from '@/stores/createVesselStore';
// import { memoryManager } from '../utils/memoryCleanup';
import { MAX_CANVAS_ZOOM, MIN_CANVAS_ZOOM } from '../constants/canvas';
import { adjustHueLightnessSaturation, applyColorAdjustments } from '../utils/imageProcessing';
import { debugLog, logError, __DEV__ } from '../utils/debug';
import { applyCroppedLayers } from '@/utils/crop/apply';
import { rebuildCCLayerAfterCrop, rebuildRecolorLayersAfterCrop } from '@/utils/crop/ccRebuild';
import { normalizeCropRect } from '@/utils/crop/normalize';
import { createDefaultPalette } from '@/utils/layoutDefaults';
import { computeLayerPercentOffset, computePercentOffsetFromPixels } from '@/utils/layerMetrics';
import historyManager, { setActiveHistoryDocument } from '@/history/historyService';
import { createShapeSessionDelta } from '@/history/deltas/shapeSessionDelta';
import { commitLayerHistory, cloneLayerImageData } from '@/history/helpers/layerHistory';
import { selectionSnapshotFromValues } from '@/history/selectionState';
import { captureColorCycleBrushState } from '@/history/helpers/colorCycle';
import {
  captureCropHistoryBaseline,
  recordCropHistory,
  recordCropSelectionHistory,
  selectionSnapshotFromCropState,
} from '@/stores/helpers/cropHistory';
import { applyPaletteSnapshot } from '@/stores/helpers/paletteState';
import {
  captureLayerStructureSnapshot,
  commitLayerStructureHistory,
} from '@/stores/helpers/layerStructureHistory';
import { createSelectionPasteHelpers } from '@/stores/helpers/selectionPaste';

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

type PressureSettings = {
  enabled: boolean;
  min: number;
  max: number;
};

const applyPressureUpdate = (current: PressureSettings, updates: Partial<PressureSettings>): PressureSettings => {
  const nextEnabled = updates.enabled ?? current.enabled;
  const nextMin = clampPressurePercent(updates.min ?? current.min);
  const nextMaxRaw = clampPressurePercent(updates.max ?? current.max);
  const nextMax = Math.max(nextMin, nextMaxRaw);

  return {
    enabled: nextEnabled,
    min: nextMin,
    max: nextMax,
  };
};

const applyPressureToTools = (tools: ToolState, pressure: PressureSettings): ToolState => ({
  ...tools,
  brushSettings: {
    ...tools.brushSettings,
    pressureEnabled: pressure.enabled,
    minPressure: pressure.min,
    maxPressure: pressure.max,
  },
  eraserSettings: {
    ...tools.eraserSettings,
    pressureEnabled: pressure.enabled,
    minPressure: pressure.min,
    maxPressure: pressure.max,
  },
});

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
  projectFilename: string | null;
  projectFileHandle: FileSystemFileHandle | null;
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
  setCustomBrushSizePercent: (percent: number) => void;
  pressureSettings: PressureSettings;
  setPressureSettings: (settings: Partial<PressureSettings>) => void;
  
  // Palette State
  palette: PaletteState;
  setPaletteColor: (slot: 'foreground' | 'background', color: string) => void;
  setActiveColor: (color: string) => void;
  swapPaletteColors: () => void;
  setActivePaletteSlot: (slot: 'foreground' | 'background') => void;
  syncPaletteFromTool: (color: string, slot?: 'foreground' | 'background') => void;
  
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
  resizeProjectCanvas: (width: number, height: number) => Promise<void>;
  resizeCanvas: (width: number, height: number) => Promise<void>;
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
  pushKeyboardScope: (id: string, scope: KeyboardScope) => void;
  popKeyboardScope: (id: string) => void;
  
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
  setDefaultCustomBrush: (brushId: string | null) => void;
  saveCustomBrushAsPreset: (customBrushId: string) => void;
  ensureCustomBrushHydrated: () => Promise<void>;
  
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
  currentCompositeBitmap: ImageBitmap | null;
  setCurrentCompositeBitmap: (bitmap: ImageBitmap | null) => void;
  
  // Project Save/Load Management
  saveProject: (filename?: string) => Promise<void>;
  loadProject: () => Promise<void>;
  importProject: (project: Project, options?: { fileName?: string | null }) => Promise<void>;
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

const CUSTOM_BRUSH_PERCENT_MIN = 5;
const CUSTOM_BRUSH_PERCENT_MAX = 1000;
const CUSTOM_BRUSH_PERCENT_STEP = 5;

const clampCustomBrushPercent = (value: number): number => {
  if (!Number.isFinite(value)) {
    return CUSTOM_BRUSH_PERCENT_MIN;
  }
  return Math.min(CUSTOM_BRUSH_PERCENT_MAX, Math.max(CUSTOM_BRUSH_PERCENT_MIN, value));
};

const quantizeCustomBrushPercent = (value: number): number => {
  return Math.round(value / CUSTOM_BRUSH_PERCENT_STEP) * CUSTOM_BRUSH_PERCENT_STEP;
};

type CustomBrushDimensionInfo = {
  width: number;
  height: number;
  maxDimension: number;
} | null;

const resolveCustomBrushDimensions = (
  state: AppState,
  brushSettings: BrushSettings
): CustomBrushDimensionInfo => {
  const tip = brushSettings.currentBrushTip;
  if (tip) {
    const width = tip.width ?? tip.imageData.width;
    const height = tip.height ?? tip.imageData.height;
    const maxDimension = Math.max(width, height);
    return maxDimension > 0 ? { width, height, maxDimension } : null;
  }

  const selectedId = brushSettings.selectedCustomBrush;
  if (!selectedId) {
    return null;
  }

  if (state.temporaryCustomBrush?.id === selectedId) {
    const { width, height } = state.temporaryCustomBrush;
    const maxDimension = Math.max(width, height);
    return maxDimension > 0 ? { width, height, maxDimension } : null;
  }

  const projectBrush = state.project?.customBrushes?.find(brush => brush.id === selectedId);
  if (projectBrush) {
    const { width, height } = projectBrush;
    const maxDimension = Math.max(width, height);
    return maxDimension > 0 ? { width, height, maxDimension } : null;
  }

  return null;
};

const pixelsFromCustomPercent = (
  percent: number,
  state: AppState,
  brushSettings: BrushSettings
): number | null => {
  const dims = resolveCustomBrushDimensions(state, brushSettings);
  if (!dims) {
    return null;
  }
  const clamped = clampCustomBrushPercent(percent);
  return Math.max(1, Math.round((dims.maxDimension * clamped) / 100));
};

const percentFromPixelSize = (
  pixelSize: number,
  state: AppState,
  brushSettings: BrushSettings
): number | null => {
  const dims = resolveCustomBrushDimensions(state, brushSettings);
  if (!dims || dims.maxDimension === 0) {
    return null;
  }
  const rawPercent = (pixelSize / dims.maxDimension) * 100;
  return clampCustomBrushPercent(rawPercent);
};

const defaultPressureSettings: PressureSettings = {
  enabled: Boolean(defaultBrushSettingsForStore.pressureEnabled),
  min: clampPressurePercent(defaultBrushSettingsForStore.minPressure ?? 100),
  max: clampPressurePercent(
    defaultBrushSettingsForStore.maxPressure ??
      getDefaultMaxPressurePercent(defaultBrushSettingsForStore.brushShape)
  ),
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

const DEFAULT_KEYBOARD_SCOPE: KeyboardScope = 'canvas';
const KEYBOARD_SCOPE_PRIORITY: readonly KeyboardScope[] = ['modal', 'gradient', 'recolor', 'canvas', 'global'] as const;

const resolveActiveKeyboardScope = (stack: KeyboardScopeEntry[]): KeyboardScope => {
  if (stack.length === 0) {
    return DEFAULT_KEYBOARD_SCOPE;
  }

  for (const scope of KEYBOARD_SCOPE_PRIORITY) {
    if (stack.some((entry) => entry.scope === scope)) {
      return scope;
    }
  }

  const lastEntry = stack[stack.length - 1];
  return lastEntry?.scope ?? DEFAULT_KEYBOARD_SCOPE;
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
    document: false,
    loadProject: false
  },
  theme: 'dark',
  notifications: [],
  keyboardScope: {
    active: DEFAULT_KEYBOARD_SCOPE,
    stack: [],
  }
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

export const useAppStore = createVesselStore<AppState>(
  (set, get, store) => {
      const {
        persistCustomBrushes,
        ensureCustomBrushHydrated: ensureCustomBrushHydratedFn,
        getLastSnapshot: getLastCustomBrushSnapshot
      } = createCustomBrushPersistence(store.setState, store.getState);
      const projectSlice = createProjectSlice({
        colorCycleBrushManager,
        persistCustomBrushes,
        getLastCustomBrushSnapshot,
        syncPercentOffsetsFromPixels,
      })(set, get, store);

      const scheduleCompositeBitmapRelease = (bitmap: ImageBitmap) => {
        const dispose = () => {
          try {
            bitmap.close();
          } catch {
            // ignore close errors
          }
        };

        if (typeof window === 'undefined') {
          dispose();
          return;
        }

        const MAX_ATTEMPTS = 3;
        let attempts = 0;

        const tryDispose = () => {
          if (get().currentCompositeBitmap === bitmap && attempts < MAX_ATTEMPTS) {
            attempts += 1;
            window.requestAnimationFrame(tryDispose);
            return;
          }
          dispose();
        };

        window.setTimeout(tryDispose, 160);
      };

      // Expose store globally for debugging and test utilities
      if (typeof window !== 'undefined') {
        setTimeout(() => {
          (window as Window & { __vesselStore?: typeof useAppStore }).__vesselStore = useAppStore;
        }, 0);
        void ensureCustomBrushHydratedFn();
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

      const playColorCycle = (reason: CCReason) => {
        set((state) => ({
          colorCyclePlayback: {
            ...state.colorCyclePlayback,
            desiredPlaying: true,
            lastReason: reason,
            recentReasons: appendColorCycleReason(state.colorCyclePlayback, reason),
          },
        }));
      };

      const pauseColorCycle = (reason: CCReason) => {
        set((state) => ({
          colorCyclePlayback: {
            ...state.colorCyclePlayback,
            desiredPlaying: false,
            lastReason: reason,
            recentReasons: appendColorCycleReason(state.colorCyclePlayback, reason),
          },
        }));
      };

      const suspendColorCycle = (reason: CCReason) => {
        set((state) => {
          const playback = state.colorCyclePlayback;
          const nextDepth = Math.max(0, playback.suspendDepth) + 1;
          return {
            colorCyclePlayback: {
              ...playback,
              suspendDepth: nextDepth,
              lastReason: reason,
              recentReasons: appendColorCycleReason(playback, reason),
            },
          };
        });
      };

      const resumeColorCycle = (reason: CCReason) => {
        set((state) => {
          const playback = state.colorCyclePlayback;
          const nextDepth = Math.max(0, playback.suspendDepth - 1);
          return {
            colorCyclePlayback: {
              ...playback,
              suspendDepth: nextDepth,
              lastReason: reason,
              recentReasons: appendColorCycleReason(playback, reason),
            },
          };
        });
      };

      const forceResumeColorCycle = (reason: CCReason) => {
        set((state) => ({
          colorCyclePlayback: {
            ...state.colorCyclePlayback,
            suspendDepth: 0,
            lastReason: reason,
            recentReasons: appendColorCycleReason(state.colorCyclePlayback, reason),
          },
        }));
      };

      const withColorCycleSuspended = async <T>(
        reason: CCReason,
        fn: () => T | Promise<T>
      ): Promise<T> => {
        suspendColorCycle(reason);
        try {
          return await fn();
        } finally {
          resumeColorCycle(reason);
        }
      };

      const historySlice = createHistorySlice({
        runWithColorCycleSuspended: withColorCycleSuspended,
      })(set, get, store);

      const layersSlice = createLayersSlice({
        syncPercentOffsetsFromPixels,
        trackLayerChanges,
        colorCycleBrushManager,
        captureLayerStructureSnapshot,
        commitLayerStructureHistory,
        getVesselWindow,
      })(set, get, store);

      const selectionPasteHelpers = createSelectionPasteHelpers({
        get,
        set,
        captureCanvasToActiveLayer: (canvas, roi) => get().captureCanvasToActiveLayer(canvas, roi),
      });

      const initialPalette = createDefaultPalette();

      return {
        ...historySlice,
        ...projectSlice,
        ...layersSlice,
        paletteDirty: false,
        palette: initialPalette,
      colorCyclePlayback: {
        desiredPlaying: false,
        suspendDepth: 0,
        lastReason: 'startup',
        recentReasons: SHOULD_TRACK_COLOR_CYCLE_REASONS ? [] : undefined
      },
      playColorCycle,
      pauseColorCycle,
      suspendColorCycle,
      resumeColorCycle,
      forceResumeColorCycle,
      withColorCycleSuspended,
      colorCycleRuntimeHandlers: {},
      setColorCycleRuntimeHandlers: (handlers) => set(() => ({
        colorCycleRuntimeHandlers: handlers ?? {}
      })),
      
      // Global brush settings
      globalBrushSize: defaultBrushSettingsForStore.size ?? 5,
      pressureSettings: defaultPressureSettings,
      setPressureSettings: (updates) => set((state) => {
        const nextPressure = applyPressureUpdate(state.pressureSettings, updates);
        const nextTools = applyPressureToTools(state.tools, nextPressure);
        return {
          pressureSettings: nextPressure,
          tools: nextTools,
        };
      }),
      setGlobalBrushSize: (size) => set((state) => {
        const tools = state.tools;
        const nextSize = Math.max(1, Math.round(size));
        const updatedBrushSettings: BrushSettings = {
          ...tools.brushSettings,
          size: nextSize
        };

        if (updatedBrushSettings.brushShape === BrushShape.CUSTOM) {
          const derivedPercent = percentFromPixelSize(nextSize, state, updatedBrushSettings);
          if (derivedPercent !== null) {
            updatedBrushSettings.customBrushSizePercent = quantizeCustomBrushPercent(derivedPercent);
          } else if (updatedBrushSettings.customBrushSizePercent === undefined) {
            updatedBrushSettings.customBrushSizePercent = 100;
          }
        } else {
          updatedBrushSettings.customBrushSizePercent = undefined;
        }
        
        const shouldSyncEraser = tools.eraserSettings.linkSizeToBrush !== false;
        const updatedEraserSettings = shouldSyncEraser
          ? { ...tools.eraserSettings, size: nextSize }
          : tools.eraserSettings;

        return {
          globalBrushSize: nextSize,
          tools: {
            ...tools,
            brushSettings: updatedBrushSettings,
            eraserSettings: updatedEraserSettings
          }
        };
      }),
      setCustomBrushSizePercent: (percent) => set((state) => {
        const tools = state.tools;
        const quantized = quantizeCustomBrushPercent(clampCustomBrushPercent(percent));
        const brushSettings = tools.brushSettings;
        let pixelSize = brushSettings.size ?? state.globalBrushSize ?? 1;

        if (brushSettings.brushShape === BrushShape.CUSTOM) {
          const computed = pixelsFromCustomPercent(quantized, state, brushSettings);
          if (computed !== null) {
            pixelSize = computed;
          }
        } else {
          pixelSize = Math.max(1, Math.round(percent));
        }

        const nextBrushSettings: BrushSettings = {
          ...brushSettings,
          size: pixelSize,
          customBrushSizePercent:
            brushSettings.brushShape === BrushShape.CUSTOM ? quantized : undefined
        };

        const shouldSyncEraser = tools.eraserSettings.linkSizeToBrush !== false;
        const updatedEraserSettings = shouldSyncEraser
          ? { ...tools.eraserSettings, size: pixelSize }
          : tools.eraserSettings;

        return {
          globalBrushSize: pixelSize,
          tools: {
            ...tools,
            brushSettings: nextBrushSettings,
            eraserSettings: updatedEraserSettings
          }
        };
      }),
      
      setPaletteColor: (slot, color) => {
        const palette = get().palette;
        const currentColor =
          slot === 'background' ? palette.backgroundColor : palette.foregroundColor;

        if (currentColor === color) {
          return;
        }

        const nextPalette: PaletteState =
          slot === 'background'
            ? { ...palette, backgroundColor: color }
            : { ...palette, foregroundColor: color };

        applyPaletteSnapshot(set, get, nextPalette, { paletteDirty: true });
      },
      setActiveColor: (color) => {
        const slot = (get().palette.activeSlot ?? 'foreground');
        get().setPaletteColor(slot, color);
      },
      swapPaletteColors: () => {
        const palette = get().palette;
        const nextPalette: PaletteState = {
          ...palette,
          foregroundColor: palette.backgroundColor,
          backgroundColor: palette.foregroundColor
        };
        if (
          palette.foregroundColor === nextPalette.foregroundColor &&
          palette.backgroundColor === nextPalette.backgroundColor
        ) {
          return;
        }
        applyPaletteSnapshot(set, get, nextPalette, { paletteDirty: true });
      },
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
      syncPaletteFromTool: (color, slot = 'foreground') => {
        const palette = get().palette;
        const nextPalette: PaletteState =
          slot === 'background'
            ? { ...palette, backgroundColor: color }
            : { ...palette, foregroundColor: color };
        if (
          palette.foregroundColor === nextPalette.foregroundColor &&
          palette.backgroundColor === nextPalette.backgroundColor
        ) {
          return;
        }
        applyPaletteSnapshot(set, get, nextPalette, { paletteDirty: true });
      },
      
      // Brush-specific settings storage (in-memory, separate from project)
      brushSpecificSettings: {},
      
      // Canvas State
      canvas: defaultCanvasState,
      canvasViewport: {
        left: 0,
        top: 0,
        width: 0,
        height: 0
      },
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
      resizeCanvas: async (width, height) => {
        await get().resizeProjectCanvas(width, height);
      },
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
        state.setLayersNeedRecomposition(true);

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
        state.setLayersNeedRecomposition(true);
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
            state.setLayersNeedRecomposition(true);
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
          const {
            projectSize: beforeProject,
            layerSnapshots: beforeLayerSnapshots,
            selectionSnapshot: selectionBefore,
          } = captureCropHistoryBaseline({
            project,
            layers: state.layers,
            selectionStart: state.selectionStart,
            selectionEnd: state.selectionEnd,
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
            crop: {
              ...prev.crop,
              marquee: null,
              status: 'ready',
              activeHandle: null,
              commitInFlight: true
            }
          }));
          get().setLayersNeedRecomposition(true);

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

          const selectionAfter = selectionSnapshotFromCropState(
            postState.selectionStart,
            postState.selectionEnd,
          );
          recordCropSelectionHistory({
            before: selectionBefore,
            after: selectionAfter,
            description: 'Crop selection reset',
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
      commitFloatingPaste: () => selectionPasteHelpers.commitFloatingPaste(),
      cancelFloatingPaste: () => selectionPasteHelpers.cancelFloatingPaste(),
      
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

        const pressure = state.pressureSettings;
        const syncedBrushSettings = {
          ...newBrushSettings,
          pressureEnabled: pressure.enabled,
          minPressure: pressure.min,
          maxPressure: pressure.max,
        };

        const nextTools = applyPressureToTools(
          {
            ...state.tools,
            previousTool: state.tools.currentTool,
            currentTool: tool,
            lastRegularTool: lastRegularTool,
            lastRegularBrushShape: lastRegularBrushShape,
            lastRegularShapeMode,
            lastColorCycleShapeMode,
            brushSettings: syncedBrushSettings,
            shapeMode: newShapeMode
          },
          pressure
        );

        return {
          tools: nextTools
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
      setBrushSettings: (incomingSettings) => {
        let pendingPalette: PaletteState | null = null;
        set((state) => {
        // quiet
        try {
        const settings = {
          ...incomingSettings,
        } as Partial<BrushSettings> & { colorCycleFlowForward?: boolean };

        let incomingCustomPercent: number | undefined;
        if (Object.prototype.hasOwnProperty.call(settings, 'customBrushSizePercent')) {
          const rawPercent = settings.customBrushSizePercent;
          if (rawPercent !== undefined && rawPercent !== null) {
            const numericPercent = Number(rawPercent);
            if (Number.isFinite(numericPercent)) {
              incomingCustomPercent = numericPercent;
            }
          }
          delete settings.customBrushSizePercent;
        }

        const pressureUpdates: Partial<PressureSettings> = {};
        let hasPressureUpdate = false;

        if (Object.prototype.hasOwnProperty.call(settings, 'pressureEnabled')) {
          const value = settings.pressureEnabled;
          if (value !== undefined) {
            pressureUpdates.enabled = Boolean(value);
            hasPressureUpdate = true;
          }
          delete settings.pressureEnabled;
        }

        if (Object.prototype.hasOwnProperty.call(settings, 'minPressure')) {
          const value = settings.minPressure;
          if (value !== undefined) {
            pressureUpdates.min = Number(value);
            hasPressureUpdate = true;
          }
          delete settings.minPressure;
        }

        if (Object.prototype.hasOwnProperty.call(settings, 'maxPressure')) {
          const value = settings.maxPressure;
          if (value !== undefined) {
            pressureUpdates.max = Number(value);
            hasPressureUpdate = true;
          }
          delete settings.maxPressure;
        }

        const nextPressure = hasPressureUpdate
          ? applyPressureUpdate(state.pressureSettings, pressureUpdates)
          : state.pressureSettings;

        if (settings.colorCycleFlowForward !== undefined) {
          settings.colorCycleFlowMode = settings.colorCycleFlowForward === false ? 'reverse' : 'forward';
          delete settings.colorCycleFlowForward;
        }

        const currentSettings = state.tools.brushSettings;
        let newSettings = { ...currentSettings, ...settings };

        const nextBrushShape = settings.brushShape ?? currentSettings.brushShape;
        if (nextBrushShape === BrushShape.CUSTOM) {
          let percentToApply = incomingCustomPercent;

          if (percentToApply === undefined && typeof settings.size === 'number') {
            const derived = percentFromPixelSize(
              settings.size,
              state,
              { ...newSettings, brushShape: nextBrushShape }
            );
            if (derived !== null) {
              percentToApply = derived;
            }
          }

          if (percentToApply === undefined && typeof newSettings.customBrushSizePercent === 'number') {
            percentToApply = newSettings.customBrushSizePercent;
          }

          if (percentToApply === undefined) {
            const baseSize = typeof newSettings.size === 'number'
              ? newSettings.size
              : state.globalBrushSize ?? 1;
            const derived = percentFromPixelSize(baseSize, state, newSettings);
            percentToApply = derived ?? 100;
          }

          percentToApply = quantizeCustomBrushPercent(clampCustomBrushPercent(percentToApply));
          const computedSize =
            pixelsFromCustomPercent(
              percentToApply,
              state,
              {
                ...newSettings,
                brushShape: nextBrushShape,
                customBrushSizePercent: percentToApply
              }
            ) ?? (typeof newSettings.size === 'number' ? newSettings.size : state.globalBrushSize ?? 1);

          newSettings = {
            ...newSettings,
            brushShape: nextBrushShape,
            size: Math.max(1, Math.round(computedSize)),
            customBrushSizePercent: percentToApply
          };
        } else {
          if (incomingCustomPercent !== undefined && Number.isFinite(incomingCustomPercent)) {
            const fallbackSize = Math.max(1, Math.round(incomingCustomPercent));
            newSettings = { ...newSettings, size: fallbackSize };
          }
          newSettings = {
            ...newSettings,
            customBrushSizePercent: undefined,
            brushShape: nextBrushShape
          };
        }

        newSettings = {
          ...newSettings,
          pressureEnabled: nextPressure.enabled,
          minPressure: nextPressure.min,
          maxPressure: nextPressure.max,
        };
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

          delete settingsToSave.pressureEnabled;
          delete settingsToSave.minPressure;
          delete settingsToSave.maxPressure;
          
          // Update with changed settings
          if (settings.opacity !== undefined) settingsToSave.opacity = newSettings.opacity;
          if (settings.spacing !== undefined) settingsToSave.spacing = newSettings.spacing;
          if (settings.colorJitter !== undefined) settingsToSave.colorJitter = newSettings.colorJitter;
          if (settings.risographIntensity !== undefined) settingsToSave.risographIntensity = newSettings.risographIntensity;
          if (settings.ditherEnabled !== undefined) settingsToSave.ditherEnabled = newSettings.ditherEnabled;
          if (settings.fillResolution !== undefined) settingsToSave.fillResolution = newSettings.fillResolution;
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
        
        // Handle brush-specific resource cleanup when switching between custom and regular brushes
        if (newSettings.brushShape !== undefined) {
          const wasCustom = currentSettings.brushShape === BrushShape.CUSTOM;
          const isCustom = newSettings.brushShape === BrushShape.CUSTOM;

          if (wasCustom && !isCustom) {
            // Clear stale custom brush tip data when switching away from custom brushes
            newSettings.currentBrushTip = undefined;
            newSettings.selectedCustomBrush = null;
          }

          if (wasCustom !== isCustom) {
            try {
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
          globalBrushSize:
            typeof newSettings.size === 'number' ? newSettings.size : state.globalBrushSize,
          pressureSettings: nextPressure
        };

        updatedState = {
          ...updatedState,
          tools: applyPressureToTools(updatedState.tools, nextPressure)
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
          pendingPalette = {
            ...state.palette,
            foregroundColor: newSettings.color ?? state.palette.foregroundColor,
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
      });

        if (pendingPalette) {
          applyPaletteSnapshot(set, get, pendingPalette);
        }
      },
      setEraserSettings: (incomingSettings) => {
        let pendingPalette: PaletteState | null = null;
        set((state) => {
          const settings = { ...incomingSettings } as Partial<BrushSettings>;

        const pressureUpdates: Partial<PressureSettings> = {};
        let hasPressureUpdate = false;

        if (Object.prototype.hasOwnProperty.call(settings, 'pressureEnabled')) {
          const value = settings.pressureEnabled;
          if (value !== undefined) {
            pressureUpdates.enabled = Boolean(value);
            hasPressureUpdate = true;
          }
          delete settings.pressureEnabled;
        }

        if (Object.prototype.hasOwnProperty.call(settings, 'minPressure')) {
          const value = settings.minPressure;
          if (value !== undefined) {
            pressureUpdates.min = Number(value);
            hasPressureUpdate = true;
          }
          delete settings.minPressure;
        }

        if (Object.prototype.hasOwnProperty.call(settings, 'maxPressure')) {
          const value = settings.maxPressure;
          if (value !== undefined) {
            pressureUpdates.max = Number(value);
            hasPressureUpdate = true;
          }
          delete settings.maxPressure;
        }

        const nextPressure = hasPressureUpdate
          ? applyPressureUpdate(state.pressureSettings, pressureUpdates)
          : state.pressureSettings;

        const next = {
          ...state.tools.eraserSettings,
          ...settings,
          pressureEnabled: nextPressure.enabled,
          minPressure: nextPressure.min,
          maxPressure: nextPressure.max,
        };
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

        const baseTools: ToolState = {
          ...state.tools,
          eraserSettings: next,
          brushSettings: paletteUpdate
            ? { ...state.tools.brushSettings, color: paletteUpdate.foregroundColor }
            : state.tools.brushSettings
        };

        const nextTools = applyPressureToTools(baseTools, nextPressure);
        const baseReturn = {
          tools: nextTools,
          pressureSettings: nextPressure,
        };
        if (!paletteUpdate) {
          return baseReturn;
        }

        pendingPalette = paletteUpdate;
        return baseReturn;
      });

        if (pendingPalette) {
          applyPaletteSnapshot(set, get, pendingPalette);
        }
      },
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
      currentCompositeBitmap: null,
      setCurrentCompositeBitmap: (bitmap) => {
        const previous = get().currentCompositeBitmap;
        set({ currentCompositeBitmap: bitmap ?? null });
        if (previous && previous !== bitmap) {
          scheduleCompositeBitmapRelease(previous);
        }
      },
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
        let userOverrides = get().loadBrushSettings(preset.id);
        if (userOverrides) {
          userOverrides = { ...userOverrides };
          delete userOverrides.size;
          delete userOverrides.pressureEnabled;
          delete userOverrides.minPressure;
          delete userOverrides.maxPressure;
        }
        const { settings: presetDefaults, components } = applyBrushPreset(preset, userOverrides);
        const currentSettings = state.tools.brushSettings;
        let updatedBrushSpecificSettings = state.brushSpecificSettings;


        // Always start from the current global size; fall back to preset default only if undefined
        const presetSuggestedSize =
          typeof presetDefaults.size === 'number' ? presetDefaults.size : undefined;
        const fallbackSize =
          presetSuggestedSize ?? defaultBrushSettingsForStore.size ?? 5;
        const appropriateSize =
          typeof state.globalBrushSize === 'number' ? state.globalBrushSize : fallbackSize;

        let newBrushSettings: BrushSettings = {
          ...defaultBrushSettingsForStore, // 1. Start with the absolute base defaults.
          ...presetDefaults,               // 2. Apply the preset settings (which now includes user overrides).
          
          // 3. Finally, preserve the settings that carry over between any brush.
          color: currentSettings.color,
          blendMode: currentSettings.blendMode,
          size: appropriateSize            // Use appropriate size based on brush type
        };

        const globalPressure = state.pressureSettings;
        newBrushSettings = {
          ...newBrushSettings,
          pressureEnabled: globalPressure.enabled,
          minPressure: globalPressure.min,
          maxPressure: globalPressure.max,
        };

        // Preserve Color Cycle dynamics across preset switches unless user changes them
        // This keeps animation feel consistent between Color Cycle variants
        if (currentSettings.colorCycleSpeed !== undefined) {
          newBrushSettings.colorCycleSpeed = currentSettings.colorCycleSpeed;
        }
        if (currentSettings.colorCycleFlowMode !== undefined) {
          newBrushSettings.colorCycleFlowMode = currentSettings.colorCycleFlowMode;
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
        
        // Handle brush resource cleanup and brush tip state when switching between custom and regular brushes
        if (presetDefaults.brushShape !== undefined) {
          const wasCustom = currentSettings.brushShape === BrushShape.CUSTOM;
          const isCustom = presetDefaults.brushShape === BrushShape.CUSTOM;

          if (wasCustom && !isCustom) {
            newBrushSettings.currentBrushTip = undefined;
            newBrushSettings.selectedCustomBrush = null;
          }

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

        const pressureSyncedState = {
          ...updatedState,
          pressureSettings: globalPressure,
          tools: applyPressureToTools(updatedState.tools, globalPressure)
        };
        
        // If switching away from custom brush, discard temporary brush
        if (presetDefaults.brushShape !== undefined && 
            currentSettings.brushShape === BrushShape.CUSTOM && 
            presetDefaults.brushShape !== BrushShape.CUSTOM) {
          return {
            ...pressureSyncedState,
            temporaryCustomBrush: null
          };
        }
        
        return pressureSyncedState;
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
      pushKeyboardScope: (id, scope) => set((state) => {
        const existingStack = state.ui.keyboardScope.stack;
        const filtered = existingStack.filter((entry) => entry.id !== id);
        const nextStack = [...filtered, { id, scope }];
        const nextActive = resolveActiveKeyboardScope(nextStack);

        if (
          existingStack.length === nextStack.length &&
          state.ui.keyboardScope.active === nextActive &&
          existingStack.every(
            (entry, index) =>
              entry.id === nextStack[index]?.id && entry.scope === nextStack[index]?.scope,
          )
        ) {
          return state;
        }

        return {
          ui: {
            ...state.ui,
            keyboardScope: {
              stack: nextStack,
              active: nextActive,
            },
          },
        };
      }),
      popKeyboardScope: (id) => set((state) => {
        const existingStack = state.ui.keyboardScope.stack;
        const nextStack = existingStack.filter((entry) => entry.id !== id);
        if (nextStack.length === existingStack.length) {
          return state;
        }

        const nextActive = resolveActiveKeyboardScope(nextStack);

        return {
          ui: {
            ...state.ui,
            keyboardScope: {
              stack: nextStack,
              active: nextActive,
            },
          },
        };
      }),
      
      ensureCustomBrushHydrated: () => ensureCustomBrushHydratedFn(),
      
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
        const targetSize = typeof state.globalBrushSize === 'number'
          ? state.globalBrushSize
          : 100;
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
          size: targetSize
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
          globalBrushSize: targetSize
        };
      }),
      saveBrushEdit: (canvas) => {
        const state = get();
        if (
          state.brushEditor.status !== 'EDITING' ||
          !state.brushEditor.editingBounds ||
          !state.brushEditor.editingBrushId
        ) {
          return;
        }

        const ctx = canvas.getContext(
          '2d',
          { willReadFrequently: true } as CanvasRenderingContext2DSettings
        ) as CanvasRenderingContext2D | null;
        if (!ctx || !state.project) {
          return;
        }

        const bounds = state.brushEditor.editingBounds;
        const brushId = state.brushEditor.editingBrushId;

        const editedImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

        const thumbnailSize = 64;
        let thumbnail = '';
        if (typeof document !== 'undefined') {
          const thumbnailCanvas = document.createElement('canvas');
          thumbnailCanvas.width = thumbnailSize;
          thumbnailCanvas.height = thumbnailSize;
          const thumbnailCtx = thumbnailCanvas.getContext(
            '2d',
            { willReadFrequently: true } as CanvasRenderingContext2DSettings
          ) as CanvasRenderingContext2D | null;

          if (thumbnailCtx) {
            const scale = Math.min(thumbnailSize / canvas.width, thumbnailSize / canvas.height);
            const scaledWidth = canvas.width * scale;
            const scaledHeight = canvas.height * scale;
            const offsetX = (thumbnailSize - scaledWidth) / 2;
            const offsetY = (thumbnailSize - scaledHeight) / 2;

            thumbnailCtx.clearRect(0, 0, thumbnailSize, thumbnailSize);

            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = canvas.width;
            tempCanvas.height = canvas.height;
            const tempCtx = tempCanvas.getContext('2d', {
              willReadFrequently: true,
            } as CanvasRenderingContext2DSettings);

            if (tempCtx) {
              tempCtx.putImageData(editedImageData, 0, 0);
              thumbnailCtx.drawImage(
                tempCanvas,
                0,
                0,
                bounds.width,
                bounds.height,
                offsetX,
                offsetY,
                scaledWidth,
                scaledHeight
              );
            }

            thumbnail = thumbnailCanvas.toDataURL();
          }
        }

        const existingCustomBrush = state.project.customBrushes?.find((b) => b.id === brushId) ?? null;
        let targetCustomBrushId: string;
        let targetBrush: CustomBrush | null = null;

        if (existingCustomBrush) {
          const updatedBrush: CustomBrush = {
            ...existingCustomBrush,
            imageData: editedImageData,
            thumbnail,
            width: canvas.width,
            height: canvas.height,
          };
          state.updateCustomBrush(brushId, {
            imageData: editedImageData,
            thumbnail,
            width: canvas.width,
            height: canvas.height,
          });
          targetCustomBrushId = updatedBrush.id;
          targetBrush = updatedBrush;
        } else {
          const defaultBrush = brushPresets.find((b) => b.id === brushId);
          const newCustomBrushId = `custom-${brushId}-${Date.now()}`;
          const newCustomBrush: CustomBrush = {
            id: newCustomBrushId,
            name: `Custom ${defaultBrush?.name || 'Brush'}`,
            imageData: editedImageData,
            thumbnail,
            width: canvas.width,
            height: canvas.height,
            createdAt: Date.now(),
          };
          state.addCustomBrush(newCustomBrush);
          targetCustomBrushId = newCustomBrushId;
          targetBrush = newCustomBrush;
        }

        brushCache.clear();
        scaledBrushCache.clear();

        set((current) => {
          const targetSize =
            typeof current.globalBrushSize === 'number' ? current.globalBrushSize : 100;
          const brushTipSource =
            targetBrush ??
            current.project?.customBrushes?.find((brush) => brush.id === targetCustomBrushId) ??
            null;

          const nextBrushTip = brushTipSource
            ? {
                imageData: brushTipSource.imageData,
                brushId: brushTipSource.id,
                isColorizable: false,
                width: brushTipSource.width,
                height: brushTipSource.height,
              }
            : undefined;

          return {
            brushEditor: defaultBrushEditorState,
            tools: {
              ...current.tools,
              brushSettings: {
                ...current.tools.brushSettings,
                brushShape: BrushShape.CUSTOM,
                selectedCustomBrush: targetCustomBrushId,
                size: targetSize,
                currentBrushTip: nextBrushTip,
              },
            },
            globalBrushSize: targetSize,
          };
        });
      },
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

        delete normalized.pressureEnabled;
        delete normalized.minPressure;
        delete normalized.maxPressure;

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
