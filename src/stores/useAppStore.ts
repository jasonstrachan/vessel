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
import type { ShapeFillFinalizePayload } from '@/shapeFill';
import type { FillParams, ShapeFillId, ShapeFillParamKey, Vec2 } from '@/shapeFill/types';
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
import type {
  Project,
  Layer,
  LayerAlignmentSettings,
  CanvasState,
  ToolState,
  UIState,
  AutosaveDirtyReason,
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
import { createCustomBrushPersistence } from '@/stores/helpers/customBrushPersistence';
import {
  DEFAULT_RECTANGLE_BRUSH_STATE,
  PressureSettings,
} from '@/stores/helpers/toolsState';
import { createHistorySlice } from '@/stores/slices/historySlice';
import { createLayersSlice } from '@/stores/slices/layersSlice';
import type { CompositeSegment } from '@/stores/slices/layersSlice';
import { createProjectSlice } from '@/stores/slices/projectSlice';
import { createUiSlice } from '@/stores/slices/uiSlice';
import { createToolsSlice } from '@/stores/slices/toolsSlice';
import { createShapeFillSlice } from '@/stores/slices/shapeFillSlice';
import type { ShapeFillState } from '@/stores/slices/shapeFillSlice';
import { createColorAdjustSlice } from '@/stores/slices/colorAdjustSlice';
import { createCropSlice } from '@/stores/slices/cropSlice';
import { createVesselStore } from '@/stores/createVesselStore';
// import { memoryManager } from '../utils/memoryCleanup';
import { logError, __DEV__ } from '../utils/debug';
import { createDefaultPalette } from '@/utils/layoutDefaults';
import { computeLayerPercentOffset, computePercentOffsetFromPixels } from '@/utils/layerMetrics';
import { setActiveHistoryDocument } from '@/history/historyService';
import { applyPaletteSnapshot } from '@/stores/helpers/paletteState';
import {
  captureLayerStructureSnapshot,
  commitLayerStructureHistory,
} from '@/stores/helpers/layerStructureHistory';
import { createSelectionSlice } from '@/stores/slices/selectionSlice';
import type { SelectionClipboardPayload } from '@/stores/slices/selectionSlice';
import { createCanvasSlice } from '@/stores/slices/canvasSlice';


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
  setShowFPSMeter: (visible: boolean) => void;
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
  selectionClipboard: SelectionClipboardPayload | null;
  setSelectionBounds: (start: { x: number; y: number } | null, end: { x: number; y: number } | null) => void;
  clearSelection: () => void;
  selectAllActiveLayerPixels: () => void;
  deleteSelectedPixels: () => void;
  copySelectionToClipboard: (options?: { mode?: 'copy' | 'cut' }) => Promise<boolean>;
  clearSelectionClipboard: () => void;

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
  setCustomBrushSampleAllLayers: (sampleAllLayers: boolean) => void;
  setCustomBrushCaptureMode: (mode: 'rectangle' | 'freehand') => void;
  setCustomBrushFreehandPath: (payload: { points: { x: number; y: number }[]; bounds: Rectangle | null } | null) => void;
  
  // Brush Presets
  brushPresets: BrushPreset[];
  currentBrushPreset: BrushPreset | null;
  activeBrushComponents: BrushComponent[];
  setBrushPreset: (preset: BrushPreset, preserveEditMode?: boolean) => void;
  getBrushPresets: () => BrushPreset[];
  getBrushPresetById: (id: string) => BrushPreset | undefined;
  
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
  setShapeFillPixelPerfect: (enabled: boolean) => void;
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
  duplicateLayer: (id: string) => string | null;
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
  temporaryCustomBrush: CustomBrush | null;
  setTemporaryCustomBrush: (brush: CustomBrush | null) => void;
  addCustomBrush: (brush: CustomBrush) => void;
  updateCustomBrush: (brushId: string, updates: Partial<CustomBrush>) => void;
  removeCustomBrush: (brushId: string) => void;
  setDefaultCustomBrush: (brushId: string | null) => void;
  saveCustomBrushAsPreset: (customBrushId: string) => void;
  getCustomBrushById: (brushId: string) => CustomBrush | null;
  listCustomBrushes: () => CustomBrush[];
  ensureCustomBrushHydrated: () => Promise<void>;
  
  // Brush Editor State
  brushEditor: BrushEditorState;
  startBrushEdit: (brushId: string, canvas: HTMLCanvasElement) => void;
  saveBrushEdit: (canvas: HTMLCanvasElement) => void;
  cancelBrushEdit: (canvas?: HTMLCanvasElement | null) => void;
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
  staticCompositeVersion: number;
  compositeSegments: CompositeSegment[];
  compositeSegmentsVersion: number;
  renderStaticComposite: (
    targetCanvas: HTMLCanvasElement,
    options?: { captureBitmap?: boolean }
  ) => boolean | Promise<boolean>;
  renderColorCycleOverlay: (targetCanvas: HTMLCanvasElement) => boolean;
  getCompositeSegmentsSnapshot: () => CompositeSegment[];
  markCompositeSegmentsDirtyByLayerIds: (layerIds: string[]) => void;
  markAllCompositeSegmentsDirty: () => void;
  
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
  markAutosaveDirty: (reason: AutosaveDirtyReason) => void;
  updateFileBackupTime: () => void;
  setAutosaveInterval: (interval: number) => void;
  setHistorySize: (size: number) => void;
}

const defaultShapeState: ShapeState = {
  isDrawing: false,
  points: [],
  previewPath: undefined
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
        captureCanvasToActiveLayer: (canvas, roi) =>
          get().captureCanvasToActiveLayer(canvas, roi),
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

      const uiSlice = createUiSlice()(set, get, store);

      const canvasSlice = createCanvasSlice(set, get, store);
      const selectionSlice = createSelectionSlice(set, get, store);
      const cropSlice = createCropSlice({
        colorCycleBrushManager,
        syncPercentOffsetsFromPixels,
        syncCCRuntimes,
        logError,
      })(set, get, store);
      const toolsSlice = createToolsSlice(set, get, store);
      const shapeFillSlice = createShapeFillSlice(set, get, store);
      const colorAdjustSlice = createColorAdjustSlice(set, get, store);

      const initialPalette = createDefaultPalette();

      return {
        ...historySlice,
        ...projectSlice,
        ...layersSlice,
        ...uiSlice,
        ...canvasSlice,
        ...selectionSlice,
        ...cropSlice,
        ...toolsSlice,
        ...shapeFillSlice,
        ...colorAdjustSlice,
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
      // Rectangle Brush State
      rectangleBrushState: DEFAULT_RECTANGLE_BRUSH_STATE,
      setRectangleBrushState: (partialState) => set((state) => ({
        rectangleBrushState: { ...state.rectangleBrushState, ...partialState }
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
      // Autosave State
      autosave: {
        isEnabled: false,
        isRunning: false,
        hasUnsavedChanges: false,
        lastSaveTime: null,
        interval: 2, // default 2 minutes
        lastDirtyReason: null,
        lastDirtyAt: null,
        fileBackup: {
          enabled: false,
          mode: 'single-file',
          fileHandle: null,
          directoryHandle: null,
          backupPath: null,
          lastBackupTime: null,
        },
      },

      ensureCustomBrushHydrated: () => ensureCustomBrushHydratedFn(),
      
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
        autosave: {
          ...state.autosave,
          hasUnsavedChanges: false,
          lastDirtyReason: null,
          lastDirtyAt: null
        }
      })),
      markAutosaveDirty: (reason) => set((state) => ({
        autosave: {
          ...state.autosave,
          hasUnsavedChanges: true,
          lastDirtyReason: reason,
          lastDirtyAt: new Date()
        }
      })),
      updateFileBackupTime: () => set((state) => ({
        autosave: { ...state.autosave, fileBackup: { ...state.autosave.fileBackup, lastBackupTime: new Date() } }
      })),
      setAutosaveInterval: (interval) => set((state) => ({
        autosave: { ...state.autosave, interval }
      })),
      

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

type StoreSubscribeWithSelector<TState> = <Slice>(
  selector: (state: TState) => Slice,
  listener: (nextSlice: Slice, previousSlice: Slice) => void,
  options?: {
    equalityFn?: (a: Slice, b: Slice) => boolean;
    fireImmediately?: boolean;
  }
) => () => void;

const storeSubscribeWithSelector = useAppStore.subscribe as unknown as StoreSubscribeWithSelector<AppState>;

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

const subscribeToAutosaveDirtyTracking = (): void => {
  const ensureMarkDirty = (reason: AutosaveDirtyReason) => {
    const store = useAppStore.getState();
    if (store.markAutosaveDirty) {
      store.markAutosaveDirty(reason);
    }
  };

  storeSubscribeWithSelector(
    (state) => state.layers,
    (next, prev) => {
      if (next !== prev) {
        ensureMarkDirty('layer-change');
      }
    }
  );

  storeSubscribeWithSelector(
    (state) => state.project,
    (next, prev) => {
      if (next !== prev) {
        ensureMarkDirty('project-change');
      }
    }
  );

  storeSubscribeWithSelector(
    (state) => state.palette,
    (next, prev) => {
      if (next !== prev) {
        ensureMarkDirty('palette-change');
      }
    }
  );

  storeSubscribeWithSelector(
    (state) => ({
      undo: state.history.undoStack.length,
      redo: state.history.redoStack.length,
    }),
    (next, prev) => {
      if (next.undo !== prev.undo || next.redo !== prev.redo) {
        ensureMarkDirty('history-change');
      }
    },
    {
      equalityFn: (a, b) => a.undo === b.undo && a.redo === b.redo,
    }
  );
};

subscribeToAutosaveDirtyTracking();

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
