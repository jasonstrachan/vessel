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

const isCcDebugVerboseEnabled = (): boolean => {
  try {
    const scope = globalThis as { CC_DEBUG?: { verbose?: boolean } };
    return scope.CC_DEBUG?.verbose === true;
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
  LayerGroup,
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
  CanvasShape,
  CanvasShapeTool,
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
  SequentialStrokeEvent,
} from '@/types';
import { BrushShape } from '@/types';
import { createCustomBrushPersistence } from '@/stores/helpers/customBrushPersistence';
import {
  PressureSettings,
  applyPressureUpdate,
  applyPressureToTools,
} from '@/stores/helpers/toolsState';
import { createColorCycleSlice } from '@/stores/slices/colorCycleSlice';
import type { CCReason, ColorCycleRuntimeHandlers, ColorCycleUIState } from '@/stores/slices/colorCycleSlice';
import { createSequentialRecordSlice } from '@/stores/slices/sequentialRecordSlice';
import type { SequentialRecordSlice, SequentialRecordState } from '@/stores/slices/sequentialRecordSlice';
import { createHistorySlice } from '@/stores/slices/historySlice';
import { createLayersSlice } from '@/stores/slices/layersSlice';
import type { CompositeSegment, UpdateLayerOptions } from '@/stores/slices/layersSlice';
import { createAutosaveSlice } from '@/stores/slices/autosaveSlice';
import { createPaletteSlice } from '@/stores/slices/paletteSlice';
import { createProjectSlice } from '@/stores/slices/projectSlice';
import { createUiSlice } from '@/stores/slices/uiSlice';
import { createToolsSlice } from '@/stores/slices/toolsSlice';
import { createShapeFillSlice } from '@/stores/slices/shapeFillSlice';
import type { ShapeFillState } from '@/stores/slices/shapeFillSlice';
import { createColorAdjustSlice } from '@/stores/slices/colorAdjustSlice';
import { createCropSlice } from '@/stores/slices/cropSlice';
import { createVesselStore } from '@/stores/createVesselStore';
// import { memoryManager } from '../utils/memoryCleanup';
import { logError } from '../utils/debug';
import { computeLayerPercentOffset, computePercentOffsetFromPixels } from '@/utils/layerMetrics';
import { setActiveHistoryDocument } from '@/history/historyService';
import {
  captureLayerStructureSnapshot,
  commitLayerStructureHistory,
} from '@/stores/helpers/layerStructureHistory';
import { createSelectionSlice } from '@/stores/slices/selectionSlice';
import type { FloatingPasteHistoryContext } from '@/stores/slices/selectionSlice';
import type { SelectionClipboardPayload } from '@/stores/slices/selectionSlice';
import { createCanvasSlice } from '@/stores/slices/canvasSlice';
import { createCanvasShapeSlice, type CanvasShapeEditorState } from '@/stores/slices/canvasShapeSlice';
import { loadGlobalBrushSettings, saveGlobalBrushSettings } from '@/utils/brushSettingsStorage';
import type { GlobalBrushSettingsPayload } from '@/utils/brushSettingsStorage';
import { loadWebglExportSettings, saveWebglExportSettings } from '@/utils/webglExportSettingsStorage';
import { setGradientApplyStateGetter } from '@/hooks/brushEngine/ccGradientApplyScheduler';

export type { CCReason, ColorCycleRuntimeHandlers, ColorCycleUIState } from '@/stores/slices/colorCycleSlice';
export type { SequentialRecordSlice, SequentialRecordState } from '@/stores/slices/sequentialRecordSlice';



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
  colorCycleRuntimeHandlers: ColorCycleRuntimeHandlers;
  setColorCycleRuntimeHandlers: (handlers: ColorCycleRuntimeHandlers | null) => void;

  // Sequential record state
  sequentialRecord: SequentialRecordState;
  setRecordFPS: SequentialRecordSlice['setRecordFPS'];
  setRecordFrameCount: SequentialRecordSlice['setRecordFrameCount'];
  setTimeSmear: SequentialRecordSlice['setTimeSmear'];
  stepSequentialFrame: SequentialRecordSlice['stepSequentialFrame'];
  setSequentialFrame: SequentialRecordSlice['setSequentialFrame'];
  setSequentialPointerDown: SequentialRecordSlice['setSequentialPointerDown'];
  setSequentialCaptureActive: SequentialRecordSlice['setSequentialCaptureActive'];
  recordSequentialRuntimeTick: SequentialRecordSlice['recordSequentialRuntimeTick'];
  setSequentialFrameCacheStats: SequentialRecordSlice['setSequentialFrameCacheStats'];
  resetSequentialRuntimeMetrics: SequentialRecordSlice['resetSequentialRuntimeMetrics'];
  
  // Layer composition trigger
  layersNeedRecomposition: boolean;
  setLayersNeedRecomposition: (needed: boolean) => void;
  
  // Global brush settings
  globalBrushSize: number;
  setGlobalBrushSize: (size: number) => void;
  bumpGlobalBrushSize: (delta: number) => void;
  setCustomBrushSizePercent: (percent: number) => void;
  pressureSettings: PressureSettings;
  setPressureSettings: (settings: Partial<PressureSettings>) => void;
  
  // Palette State
  palette: PaletteState;
  setPaletteColor: (slot: 'foreground' | 'background', color: string) => void;
  setActiveColor: (color: string) => void;
  swapPaletteColors: () => void;
  setActivePaletteSlot: (slot: 'foreground' | 'background') => void;
  colorPickerPreferReferenceLayer: boolean;
  setColorPickerPreferReferenceLayer: (prefer: boolean) => void;
  syncPaletteFromTool: (color: string, slot?: 'foreground' | 'background') => void;
  
  // Brush-specific settings storage
  brushSpecificSettings: Record<string, Partial<BrushSettings>>;
  shapeModeByBrush: Record<string, boolean>;
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

  // Canvas Shape Editor
  canvasShapeEditor: CanvasShapeEditorState;
  beginCanvasShapeEdit: (tool: CanvasShapeTool) => void;
  setCanvasShapeDraft: (shape: CanvasShape | null) => void;
  commitCanvasShape: () => void;
  cancelCanvasShapeEdit: () => void;
  setCanvasShape: (shape: CanvasShape) => void;
  
  // Selection State
  selectionStart: { x: number; y: number } | null;
  selectionEnd: { x: number; y: number } | null;
  selectionClipboard: SelectionClipboardPayload | null;
  selectionVectorPath: {
    mode: 'freehand' | 'click-line';
    points: Array<{ x: number; y: number }>;
  } | null;
  selectionMask: ImageData | null;
  selectionMaskBounds: Rectangle | null;
  selectionMaskLayerId: string | null;
  setSelectionBounds: (start: { x: number; y: number } | null, end: { x: number; y: number } | null) => void;
  clearSelection: () => void;
  selectAllActiveLayerPixels: () => void;
  selectLayerAlpha: (layerId?: string | null) => void;
  invertSelection: () => void;
  deleteSelectedPixels: () => void;
  extractSelectionToFloatingPaste: () => boolean;
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
    rotation: number;
    sourceLayerId?: string | null;
    colorCycleIndices?: Uint8Array | null;
    vectorPath?: {
      mode: 'freehand' | 'click-line';
      points: Array<{ x: number; y: number }>;
    } | null;
  } | null;
  floatingPasteHistoryContext: FloatingPasteHistoryContext | null;
  setFloatingPaste: (paste: {
    imageData: ImageData;
    position: { x: number; y: number };
    width: number;
    height: number;
    displayWidth?: number;
    displayHeight?: number;
    rotation?: number;
    originalPosition?: { x: number; y: number };
    sourceLayerId?: string | null;
    colorCycleIndices?: Uint8Array | null;
    vectorPath?: {
      mode: 'freehand' | 'click-line';
      points: Array<{ x: number; y: number }>;
    } | null;
  } | null) => void;
  updateFloatingPastePosition: (position: { x: number; y: number }) => void;
  updateFloatingPasteRect: (rect: { x: number; y: number; width: number; height: number }) => void;
  updateFloatingPasteRotation: (rotation: number) => void;
  flipFloatingPasteHorizontal: () => void;
  flipFloatingPasteVertical: () => void;
  commitFloatingPaste: () => Promise<void>;
  cancelFloatingPaste: () => void;
  
  // Tool State
  tools: ToolState;
  setCurrentTool: (tool: Tool) => void;
  setBrushSettings: (settings: Partial<BrushSettings>) => void;
  setEraserSettings: (settings: Partial<BrushSettings>) => void;
  setFillSettings: (settings: Partial<ToolState['fillSettings']>) => void;
  setWandSettings: (settings: Partial<ToolState['wandSettings']>) => void;
  setCcGradientSource: (source: ToolState['ccGradientSource']) => void;
  setShapeMode: (enabled: boolean) => void;
  setCustomBrushSampleAllLayers: (sampleAllLayers: boolean) => void;
  setCustomBrushCaptureMode: (mode: 'rectangle' | 'freehand') => void;
  setCustomBrushFreehandPath: (payload: { points: { x: number; y: number }[]; bounds: Rectangle | null } | null) => void;
  setSelectionMode: (mode: ToolState['selectionMode']) => void;
  ccGradientSampleCount: number;
  ccGradientSampleResetToken: number;
  setCcGradientSampleCount: (count: number) => void;
  resetCcGradientSample: () => void;
  
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
  layerGroups: LayerGroup[];
  hiddenLayerGroupIds: string[];
  activeLayerId: string | null;
  selectedLayerIds: string[];
  referenceLayerId: string | null;
  currentLayer: number;
  addLayer: (layer: Omit<Layer, 'id' | 'order'>) => string;
  duplicateLayer: (id: string) => string | null;
  removeLayer: (id: string) => void;
  updateLayer: (id: string, updates: Partial<Layer>, options?: UpdateLayerOptions) => void;
  appendSequentialLayerEvent: (
    layerId: string,
    event: SequentialStrokeEvent,
    metadata: { frameCount: number; fps: number; durationMs: number }
  ) => void;
  appendSequentialLayerEvents: (
    layerId: string,
    events: SequentialStrokeEvent[],
    metadata: { frameCount: number; fps: number; durationMs: number }
  ) => void;
  mergeLayers: (layerIds: string[]) => string | null;
  setLayersVisibility: (layerIds: string[], visible: boolean) => void;
  toggleLayersVisibility: (layerIds: string[]) => void;
  createLayerGroupFromSelection: (layerIds: string[]) => string | null;
  removeLayerGroup: (groupId: string) => void;
  renameLayerGroup: (groupId: string, name: string) => void;
  setLayerGroupVisibility: (groupId: string, visible: boolean) => void;
  setActiveLayer: (id: string, opts?: { preserveSelection?: boolean }) => void;
  setLayers: (layers: Layer[]) => void;
  setReferenceLayer: (id: string | null) => void;
  updateLayerAlignment: (layerId: string, alignment: LayerAlignmentSettings) => void;
  scheduleColorCycleSlotRebuild: (reason: string) => void;
  runColorCycleSlotRebuild: (reason: string) => void;
  reorderLayers: (sourceIndex: number, destinationIndex: number) => void;
  reorderLayerBlock: (layerIds: string[], destinationIndex: number) => void;
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
  getCustomBrushByIdUnsafe: (brushId: string) => CustomBrush | null;
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
  saveProject: (request?: string | { filename?: string; forceDialog?: boolean }) => Promise<void>;
  loadProject: () => Promise<void>;
  importProject: (
    project: Project,
    options?: { fileName?: string | null; fileHandle?: FileSystemFileHandle | null }
  ) => Promise<void>;
  exportProject: (format: 'png', options?: { quality?: number; scale?: number }) => Promise<void>;
  newProject: (width: number, height: number, name?: string) => void;
  compositeLayersToCanvas: (targetCanvas: HTMLCanvasElement) => void;
  captureCanvasToActiveLayer: (
    sourceCanvas?: HTMLCanvasElement,
    roi?: CaptureROI,
    options?: { mode?: 'alpha' | 'replace' }
  ) => Promise<void>;
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
  setSaveStatus: (
    phase: NonNullable<AutosaveState['saveStatus']>['phase'],
    source: NonNullable<AutosaveState['saveStatus']>['source'],
    message: string
  ) => void;
  clearSaveStatus: () => void;
  setHistorySize: (size: number) => void;
}

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

      // Expose store globally for debugging and test utilities
      if (typeof window !== 'undefined') {
        setTimeout(() => {
          (window as Window & { __vesselStore?: typeof useAppStore }).__vesselStore = useAppStore;
        }, 0);
        void ensureCustomBrushHydratedFn();
      }

      setActiveHistoryDocument('default-project');
      const colorCycleSlice = createColorCycleSlice(set, get, store);
      const sequentialRecordSlice = createSequentialRecordSlice(set, get, store);

      const historySlice = createHistorySlice({
        runWithColorCycleSuspended: colorCycleSlice.withColorCycleSuspended,
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
      const canvasShapeSlice = createCanvasShapeSlice(set, get, store);
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
      const paletteSlice = createPaletteSlice(set, get, store);
      const autosaveSlice = createAutosaveSlice(set, get, store);

      return {
        ...historySlice,
        ...projectSlice,
        ...layersSlice,
        ...uiSlice,
        ...canvasSlice,
        ...canvasShapeSlice,
        ...selectionSlice,
        ...cropSlice,
        ...toolsSlice,
        ...shapeFillSlice,
        ...colorAdjustSlice,
        ...colorCycleSlice,
        ...sequentialRecordSlice,
        ...paletteSlice,
        ...autosaveSlice,
        selectLayerAlpha: selectionSlice.selectLayerAlpha,
        ensureCustomBrushHydrated: () => ensureCustomBrushHydratedFn(),
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
export const selectSequentialRecordState = (state: AppState): SequentialRecordState =>
  state.sequentialRecord;
export const selectSequentialPlaybackActive = (state: AppState): boolean => {
  if (!selectColorCycleDesiredPlaying(state)) {
    return false;
  }
  return state.layers.some((layer) => layer.layerType === 'sequential');
};
export const selectSequentialCaptureActive = (state: AppState): boolean => {
  const activeLayerId = state.activeLayerId;
  if (!activeLayerId) {
    return false;
  }
  const activeLayer = state.layers.find((layer) => layer.id === activeLayerId);
  if (activeLayer?.layerType !== 'sequential') {
    return false;
  }
  return state.sequentialRecord.isPointerDown;
};
export const selectGlobalAnimationActive = (state: AppState): boolean =>
  selectEffectiveColorCyclePlaying(state) ||
  selectSequentialPlaybackActive(state) ||
  selectSequentialCaptureActive(state);
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
if (typeof setGradientApplyStateGetter === 'function') {
  setGradientApplyStateGetter(() => useAppStore.getState());
}
configureMaskManager({
  getLayer: (layerId) => {
    const state = useAppStore.getState();
    return state.layers.find((layer) => layer.id === layerId);
  },
  updateLayer: (layerId, patch, options) => {
    useAppStore.getState().updateLayer(layerId, patch, options);
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
  let isMarkingDirty = false;
  const ensureMarkDirty = (reason: AutosaveDirtyReason) => {
    if (isMarkingDirty) {
      return;
    }
    const store = useAppStore.getState();
    if (store.markAutosaveDirty) {
      isMarkingDirty = true;
      try {
        store.markAutosaveDirty(reason);
      } finally {
        isMarkingDirty = false;
      }
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

};

subscribeToAutosaveDirtyTracking();

const getActiveBrushStorageId = (state: AppState): string | null => {
  if (state.currentBrushPreset?.id) {
    return state.currentBrushPreset.id;
  }
  const settings = state.tools.brushSettings;
  if (settings.brushShape === BrushShape.CUSTOM && settings.selectedCustomBrush) {
    return settings.selectedCustomBrush;
  }
  return null;
};

const hydrateGlobalBrushSettings = (): void => {
  const payload = loadGlobalBrushSettings();
  if (!payload) {
    return;
  }

  useAppStore.setState((state) => {
    let nextTools = state.tools;
    let nextPressure = state.pressureSettings;
    const partial: Partial<AppState> = {};

    const storedMap = payload.brushSpecificSettings;
    if (storedMap) {
      partial.brushSpecificSettings = storedMap;
      const activeId = getActiveBrushStorageId(state);
      if (activeId) {
        const overrides = storedMap[activeId];
        if (overrides) {
          const rest = { ...overrides };
          delete rest.size;
          delete rest.pressureEnabled;
          delete rest.minPressure;
          delete rest.maxPressure;
          if (Object.keys(rest).length > 0) {
            nextTools = {
              ...nextTools,
              brushSettings: {
                ...nextTools.brushSettings,
                ...rest,
              },
            };
          }
        }
      }
    }
    if (payload.shapeModeByBrush && typeof payload.shapeModeByBrush === 'object') {
      partial.shapeModeByBrush = payload.shapeModeByBrush;
      const activePresetId = state.currentBrushPreset?.id ?? null;
      if (activePresetId && typeof payload.shapeModeByBrush[activePresetId] === 'boolean') {
        nextTools = {
          ...nextTools,
          shapeMode: payload.shapeModeByBrush[activePresetId],
        };
      }
    }

    if (payload.pressureSettings) {
      const pressureUpdates = {
        enabled: payload.pressureSettings.enabled,
        min: payload.pressureSettings.min,
        max: payload.pressureSettings.max,
      };
      nextPressure = applyPressureUpdate(nextPressure, pressureUpdates);
    }

    if (typeof payload.globalBrushSize === 'number' && Number.isFinite(payload.globalBrushSize)) {
      const nextSize = Math.max(1, Math.round(payload.globalBrushSize));
      partial.globalBrushSize = nextSize;
      nextTools = {
        ...nextTools,
        brushSettings: {
          ...nextTools.brushSettings,
          size: nextSize,
        },
        eraserSettings:
          nextTools.eraserSettings.linkSizeToBrush !== false
            ? { ...nextTools.eraserSettings, size: nextSize }
            : nextTools.eraserSettings,
      };
    }

    if (nextPressure !== state.pressureSettings) {
      partial.pressureSettings = nextPressure;
      nextTools = applyPressureToTools(nextTools, nextPressure);
    }

    if (nextTools !== state.tools) {
      partial.tools = nextTools;
    }

    return Object.keys(partial).length > 0 ? partial : state;
  });

  if (payload.lastBrushId) {
    const state = useAppStore.getState();
    const preset = state.brushPresets.find((p) => p.id === payload.lastBrushId);

    if (preset) {
      // Apply via store action so components and pressure syncing stay consistent
      state.setBrushPreset(preset, true);
    }
  }
};

const subscribeToGlobalBrushPersistence = (): void => {
  let pendingPayload: GlobalBrushSettingsPayload | null = null;
  let debounceHandle: number | null = null;

  const flushPending = () => {
    if (!pendingPayload) {
      return;
    }
    const payload = pendingPayload;
    pendingPayload = null;
    debounceHandle = null;
    saveGlobalBrushSettings(payload);
  };

  const scheduleSave = (payload: GlobalBrushSettingsPayload) => {
    pendingPayload = payload;
    if (typeof window === 'undefined') {
      flushPending();
      return;
    }
    if (debounceHandle !== null) {
      window.clearTimeout(debounceHandle);
    }
    debounceHandle = window.setTimeout(flushPending, 250);
  };

  storeSubscribeWithSelector(
    (state) => ({
      brushSpecificSettings: state.brushSpecificSettings,
      shapeModeByBrush: state.shapeModeByBrush,
      globalBrushSize: state.globalBrushSize,
      pressureSettings: state.pressureSettings,
      lastBrushId: getActiveBrushStorageId(state),
    }),
    (next, prev) => {
      if (
        next.brushSpecificSettings === prev.brushSpecificSettings &&
        next.shapeModeByBrush === prev.shapeModeByBrush &&
        next.globalBrushSize === prev.globalBrushSize &&
        next.pressureSettings === prev.pressureSettings &&
        next.lastBrushId === prev.lastBrushId
      ) {
        return;
      }

      scheduleSave({
        globalBrushSize: next.globalBrushSize,
        brushSpecificSettings: next.brushSpecificSettings,
        shapeModeByBrush: next.shapeModeByBrush,
        pressureSettings: next.pressureSettings,
        lastBrushId: next.lastBrushId ?? undefined,
      });
    },
    {
      equalityFn: (a, b) =>
        a.brushSpecificSettings === b.brushSpecificSettings &&
        a.shapeModeByBrush === b.shapeModeByBrush &&
        a.globalBrushSize === b.globalBrushSize &&
        a.pressureSettings === b.pressureSettings &&
        a.lastBrushId === b.lastBrushId,
    }
  );

  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', flushPending);
    window.addEventListener('pagehide', flushPending);
  }
};

const hydrateWebglExportSettings = (): void => {
  const payload = loadWebglExportSettings();
  if (!payload) {
    return;
  }
  useAppStore.getState().updateWebglExportSettings(payload);
};

const subscribeToWebglExportSettingsPersistence = (): void => {
  let pendingPayload: WebGLExportSettings | null = null;
  let debounceHandle: number | null = null;

  const flushPending = () => {
    if (!pendingPayload) {
      return;
    }
    const payload = pendingPayload;
    pendingPayload = null;
    debounceHandle = null;
    saveWebglExportSettings(payload);
  };

  const scheduleSave = (payload: WebGLExportSettings) => {
    pendingPayload = payload;
    if (typeof window === 'undefined') {
      flushPending();
      return;
    }
    if (debounceHandle !== null) {
      window.clearTimeout(debounceHandle);
    }
    debounceHandle = window.setTimeout(flushPending, 250);
  };

  storeSubscribeWithSelector(
    (state) => state.webglExportSettings,
    (next, prev) => {
      if (next === prev) {
        return;
      }
      scheduleSave(next);
    }
  );

  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', flushPending);
    window.addEventListener('pagehide', flushPending);
  }
};

const subscribeToSaveInFlightUnloadGuard = (): void => {
  if (typeof window === 'undefined') {
    return;
  }

  const handleBeforeUnload = (event: BeforeUnloadEvent) => {
    const saveStatus = useAppStore.getState().autosave.saveStatus;
    const isManualSaveInFlight =
      saveStatus?.phase === 'saving' && saveStatus?.source === 'manual';

    if (!isManualSaveInFlight) {
      return;
    }

    event.preventDefault();
    event.returnValue = '';
  };

  window.addEventListener('beforeunload', handleBeforeUnload);
};

hydrateGlobalBrushSettings();
subscribeToGlobalBrushPersistence();
hydrateWebglExportSettings();
subscribeToWebglExportSettingsPersistence();
subscribeToSaveInFlightUnloadGuard();

// DEBUG ONLY
(() => {
  try {
    const get = useAppStore.getState;
    const current = get();
    const origUpdateLayer = current.updateLayer as typeof current.updateLayer & { __ccTraceWrapped?: boolean };
    if (origUpdateLayer.__ccTraceWrapped) {
      return;
    }
    const wrapped: typeof current.updateLayer & { __ccTraceWrapped?: boolean } = (id, patch, options) => {
      const before = useAppStore.getState().layers.find((l) => l.id === id);
      const prev = before?.colorCycleData?.isAnimating;
      const next = patch?.colorCycleData?.isAnimating;
      if (isCcDebugEnabled() && isCcDebugVerboseEnabled() && typeof next === 'boolean' && next !== prev) {
        console.groupCollapsed('[CC:TRACE] updateLayer isAnimating flip', { id: id?.slice(-6), prev, next });
        console.log('patch:', patch);
        console.log(new Error('updateLayer:isAnimating').stack);
        console.groupEnd();
        // debugger;
      }
      return origUpdateLayer(id, patch, options);
    };
    wrapped.__ccTraceWrapped = true;
    origUpdateLayer.__ccTraceWrapped = true;
    get().updateLayer = wrapped;
  } catch {}
})();
