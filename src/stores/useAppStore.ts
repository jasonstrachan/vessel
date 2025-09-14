// Zustand store with state slices
// Based on /docs/02_System_Architecture/Overall_Design.md (lines 58-64)

// Module-level flag to prevent saveCanvasState during undo/redo operations
let isHistoryOperationInProgress = false;

// Debouncing for canvas state saves to improve performance
let saveCanvasStateTimer: NodeJS.Timeout | null = null;
let lastSaveTimestamp = 0;
const MIN_SAVE_INTERVAL = 100; // Minimum 0.1 second between saves

// Detailed layer tracking for debugging
const trackLayerChanges = (_location: string, _layers: any[]) => {
  // Debug tracking disabled
};

// Helper to preserve colorCycleData when spreading layers
const preserveColorCycleData = (layer: Layer): Layer => {
  if (layer.layerType === 'color-cycle' && layer.colorCycleData) {
    // Ensure we preserve the colorCycleData reference
    return {
      ...layer,
      layerType: 'color-cycle',  // EXPLICITLY preserve layerType
      colorCycleData: layer.colorCycleData
    };
  }
  return layer;
};

// Global watcher to detect unexpected layer mutations
if (typeof window !== 'undefined') {
  (window as any).__checkLayerIntegrity = () => {
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
        // eslint-disable-next-line no-console
        console.error('🔴 LAYER INTEGRITY ISSUES:', issues);
      }
    }
    return issues;
  };
}

// Import ColorCycleBrush manager
import { getColorCycleBrushManager, setLayerIdGetter } from './colorCycleBrushManager';

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
const storeColorCycleBrush = (layerId: string, brush: any) => {
  colorCycleBrushManager.updateBrush(layerId, brush);
};

// Helper to retrieve brush instance (now delegates to manager)
const getColorCycleBrush = (layerId: string) => {
  return colorCycleBrushManager.getBrush(layerId);
};

// Helper to clean up brush instance (now delegates to manager)
const deleteColorCycleBrush = (layerId: string) => {
  colorCycleBrushManager.deleteBrush(layerId);
};

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { brushCache } from '../utils/brushCache';
import { scaledBrushCache } from '../utils/scaledBrushCache';
import type {
  Project,
  Layer,
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
} from '@/types';
import { BrushShape } from '@/types';
import { brushPresets, applyBrushPreset, defaultBrushPreset, defaultBrushSettings } from '../presets/brushPresets';
import { 
  saveProjectToFile, 
  loadProjectFromFile, 
  exportProjectAsPNG,
  restoreColorCycleBrushes
} from '../utils/projectIO';
// import { memoryManager } from '../utils/memoryCleanup';
import { DEFAULT_CANVAS_WIDTH, DEFAULT_CANVAS_HEIGHT } from '../constants/canvas';
import { adjustHueAndSaturation } from '../utils/imageProcessing';
import { debugLog, debugWarn, logError, __DEV__ } from '../utils/debug';

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
    colorCycleFlowForward: settings.colorCycleFlowForward,
    gradientBands: settings.gradientBands
  };
};

interface AppState {
  // Project State
  project: Project | null;
  setProject: (project: Project) => void;
  updateProject: (updates: Partial<Project>) => void;
  
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
  saveCanvasState: (canvas: HTMLCanvasElement, actionType: CanvasSnapshot['actionType'], description: string, overrideActiveLayerId?: string) => void;
  undo: () => CanvasSnapshot | null;
  redo: () => CanvasSnapshot | null;
  canUndo: () => boolean;
  canRedo: () => boolean;
  clearHistory: () => void;
  
  // Canvas State
  canvas: CanvasState;
  setZoom: (zoom: number) => void;
  setRotation: (rotation: number) => void;
  setGridSize: (size: number) => void;
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
  deleteSelectedPixels: () => void;
  
  // Floating Paste State
  floatingPaste: {
    active: boolean;
    imageData: ImageData | null;
    position: { x: number; y: number };
    originalPosition: { x: number; y: number };
    width: number;
    height: number;
  } | null;
  setFloatingPaste: (paste: {
    imageData: ImageData;
    position: { x: number; y: number };
    width: number;
    height: number;
  } | null) => void;
  updateFloatingPastePosition: (position: { x: number; y: number }) => void;
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
  currentLayer: number;
  addLayer: (layer: Omit<Layer, 'id' | 'order'>) => string;
  removeLayer: (id: string) => void;
  updateLayer: (id: string, updates: Partial<Layer>) => void;
  setActiveLayer: (id: string) => void;
  setLayers: (layers: Layer[]) => void;
  reorderLayers: (sourceIndex: number, destinationIndex: number) => void;
  
  // Color Cycle Layer Management
  initColorCycleForLayer: (layerId: string, width: number, height: number) => void;
  cleanupColorCycleForLayer: (layerId: string) => void;
  getLayerColorCycleBrush: (layerId: string) => any;
  
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
  captureCanvasToActiveLayer: (sourceCanvas?: HTMLCanvasElement) => Promise<void>;
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
const { settings: defaultPresetSettings } = applyBrushPreset(defaultBrushPreset);
const defaultBrushSettingsForStore: BrushSettings = {
  ...defaultBrushSettings,
  ...defaultPresetSettings
};


const defaultCanvasState: CanvasState = {
  zoom: 1,
  rotation: 0,
  gridSize: 16,
  showRulers: false,
  displayMode: 'pixelated',
  canvasWidth: 0,
  canvasHeight: 0,
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
  lastRegularBrushShape: BrushShape.ROUND,
  lastRegularShapeMode: false,
  lastColorCycleShapeMode: false,
  brushSettings: defaultBrushSettingsForStore,
  eraserSettings: { ...defaultBrushSettingsForStore, blendMode: 'destination-out', color: 'rgba(255, 255, 255, 0.1)' },
  fillSettings: {
    threshold: 0,
    contiguous: true
  },
  shapeMode: false
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
  previewPath: undefined
};

// Wrap set to trace ALL state updates
const tracedSet = (setter: any, get: any) => {
  const result = setter(get());
  if (result && 'layers' in result) {
    // logging removed
  }
  return result;
};

export const useAppStore = create<AppState>()(
  // TEMPORARILY DISABLE DEVTOOLS TO SEE IF IT'S THE CAUSE
  // devtools(
    (set, get) => {
      
      // Expose store globally for debugging and test utilities
      if (typeof window !== 'undefined') {
        setTimeout(() => {
          (window as Window & { __tinybrushStore?: typeof useAppStore }).__tinybrushStore = useAppStore;
        }, 0);
      }
      
      return {
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
        brushSpecificSettings: {}
      },
      setProject: (project) => set({ project }),
      updateProject: (updates) => set((state) => ({
        project: state.project ? { ...state.project, ...updates } : null
      })),
      
      // Global brush settings
      globalBrushSize: 5, // Start with default brush size (5px)
      
      // Unified size settings - one for all default brushes, one for all custom brushes
      defaultBrushesSize: 5,   // 5px for all default brushes
      customBrushesSize: 100,  // 100% for all custom brushes
      setGlobalBrushSize: (size) => set((state) => {
        const currentSettings = state.tools.brushSettings;
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
        
        // Also update current brush settings
        if (state.tools) {
          const updatedBrushSettings = {
            ...state.tools.brushSettings,
            size
          };
          
          return {
            ...newState,
            tools: {
              ...state.tools,
              brushSettings: updatedBrushSettings
            }
          };
        }
        
        return newState;
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
      
      // History State
      history: defaultHistoryState,
      setZoom: (zoom) => set((state) => ({
        canvas: { ...state.canvas, zoom: Math.max(0.1, Math.min(10, zoom)) }
      })),
      setRotation: (rotation) => set((state) => ({
        canvas: { ...state.canvas, rotation }
      })),
      setGridSize: (gridSize) => set((state) => ({
        canvas: { ...state.canvas, gridSize }
      })),
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
        
        return {
          project: updatedProject,
          layers: resizedLayers,
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
        
        // Save state for undo
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = project.width;
        tempCanvas.height = project.height;
            const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings) as (CanvasRenderingContext2D | null);
            if (tempCtx) {
          tempCtx.putImageData(newImageData, 0, 0);
          state.saveCanvasState(tempCanvas, 'delete', 'Delete selected pixels');
        }
        
        // Clear selection after deletion
        state.clearSelection();
      },
      
      // Floating Paste State
      floatingPaste: null,
      setFloatingPaste: (paste) => set({ 
        floatingPaste: paste ? {
          active: true,
          imageData: paste.imageData,
          position: paste.position,
          originalPosition: paste.position,
          width: paste.width,
          height: paste.height
        } : null 
      }),
      updateFloatingPastePosition: (position) => set((state) => ({
        floatingPaste: state.floatingPaste ? {
          ...state.floatingPaste,
          position
        } : null
      })),
      commitFloatingPaste: async () => {
        const state = get();
        const { floatingPaste, layers, activeLayerId, project } = state;

        if (!floatingPaste || !floatingPaste.imageData || !project) return;

        const activeLayer = layers.find(l => l.id === activeLayerId) || layers[0];
        if (!activeLayer) return;

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
            tempCtx.drawImage(pasteCanvas, floatingPaste.position.x, floatingPaste.position.y);
          }

          // Capture composited result to the active layer
          await state.captureCanvasToActiveLayer(tempCanvas);

          // Save state for undo
          state.saveCanvasState(tempCanvas, 'paste', 'Committed paste');
        }

        // Clear floating paste
        set({ floatingPaste: null });
      },
      cancelFloatingPaste: () => set({ floatingPaste: null }),
      
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
        // Save current settings before switching
        get()._saveCurrentBrushSettings();
        
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
        
        try {
          set((state) => {

        const newBrushSettings = { ...state.tools.brushSettings };
        
        // Track last regular tool and brush shape when switching from regular brush
        let lastRegularTool = state.tools.lastRegularTool;
        let lastRegularBrushShape = state.tools.lastRegularBrushShape;
        
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
        
        return {
          tools: {
            ...state.tools,
            previousTool: state.tools.currentTool,
            currentTool: tool,
            lastRegularTool: lastRegularTool,
            lastRegularBrushShape: lastRegularBrushShape,
            brushSettings: newBrushSettings
          }
        };
        });
        } catch {}
      },
      setBrushSettings: (settings) => set((state) => {
        try { const { debugLog } = require('../utils/debug'); debugLog('brush', 'SET brush settings called', settings); } catch {}
        try {
        const currentSettings = state.tools.brushSettings;
        const newSettings = { ...currentSettings, ...settings };
        
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
          if (settings.colors !== undefined) settingsToSave.colors = newSettings.colors;
          if (settings.rectGradientPresetId !== undefined) settingsToSave.rectGradientPresetId = newSettings.rectGradientPresetId;
          if (settings.continuousSampling !== undefined) settingsToSave.continuousSampling = newSettings.continuousSampling;
          if (settings.resampleInterval !== undefined) settingsToSave.resampleInterval = newSettings.resampleInterval;
          
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
        } catch (e) {
          try { const { debugLog } = require('../utils/debug'); debugLog('brush-error', 'Failed to apply brush settings', e); } catch {}
          // Return state unchanged on failure to prevent app crash
          return state;
        }
      }),
      setEraserSettings: (settings) => set((state) => ({
        tools: {
          ...state.tools,
          eraserSettings: { ...state.tools.eraserSettings, ...settings }
        }
      })),
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
      currentBrushPreset: defaultBrushPreset,
      activeBrushComponents: defaultBrushPreset.components,
      
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
        // Save current settings before switching
        get()._saveCurrentBrushSettings();
        
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
        
        const newBrushSettings = {
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
          (newBrushSettings as any).colorCycleSpeed = currentSettings.colorCycleSpeed;
        }
        if (currentSettings.colorCycleFPS !== undefined) {
          (newBrushSettings as any).colorCycleFPS = currentSettings.colorCycleFPS;
        }
        if (currentSettings.colorCycleFillMode !== undefined) {
          (newBrushSettings as any).colorCycleFillMode = currentSettings.colorCycleFillMode;
        }
        
        // Handle custom brush presets specifically
        if (preset.isCustomBrush) {
          const customBrushId = preset.id.startsWith('custom_') ? preset.id.substring(7) : preset.id;
          
          newBrushSettings.brushShape = BrushShape.CUSTOM;
          newBrushSettings.selectedCustomBrush = customBrushId;
          newBrushSettings.useSwatchColor = false;
          newBrushSettings.hueShift = 0;
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
                        newBrushSettings.brushShape === BrushShape.COLOR_CYCLE_SHAPE;

        let nextShapeMode: boolean;
        if (isNewCC) {
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
          nextShapeMode = state.tools.lastRegularShapeMode ?? false;
        }

        // Clear temporary brush when switching away from custom brushes
        const updatedState = {
          ...state,
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
      currentLayer: 0,
      addLayer: (layer) => {
        if (__DEV__) {
          debugLog('layers-raw', 'STORE:addLayer invoked', layer?.layerType);
        }
        try { const { recordBreadcrumb } = require('../utils/debug'); recordBreadcrumb('layers', { event: 'store-addLayer-enter', incomingType: layer?.layerType }); } catch {}
        const newLayerId = `layer-${Date.now()}-${Math.random()}`;
        debugLog('layers', 'STORE: addLayer called', {
          newLayerId: newLayerId.substring(0, 20),
          incomingType: layer.layerType,
          hasCCData: !!(layer as any)?.colorCycleData,
          framebufferType: (layer as any)?.framebuffer?.constructor?.name,
          existing: get().layers.map(l => ({ id: l.id.substring(0, 20), type: l.layerType }))
        });

        set((state) => {
          debugLog('layers', 'STORE: addLayer set() begin', {
            existingCount: state.layers.length,
            offscreenAvailable: typeof OffscreenCanvas !== 'undefined',
            projectSize: state.project ? { w: state.project.width, h: state.project.height } : null
          });
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
            // CRITICAL: Preserve layerType EXACTLY - DO NOT convert CC layers to normal!
            layerType: layer.layerType || (
              (logError('CRITICAL: Layer missing layerType!', {
                layerId: newLayerId?.substring(0, 20),
                hasColorCycleData: !!(layer as any)?.colorCycleData,
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
          try { const { recordBreadcrumb } = require('../utils/debug'); recordBreadcrumb('layers', { event: 'store-addLayer-updated', total: updatedLayers.length, insertedIndex }); } catch {}
          debugLog('layers', 'STORE: addLayer updatedLayers', {
            total: updatedLayers.length,
            insertedIndex,
            newId: newLayerId.substring(0, 20),
            newType: newLayer.layerType,
            hasCC: !!newLayer.colorCycleData
          });
          
          // Initialize ColorCycleBrush for color-cycle layers
          if (newLayer.layerType === 'color-cycle' && state.project) {
            const width = state.project.width || 1024;
            const height = state.project.height || 1024;
            const gradient = newLayer.colorCycleData?.gradient;
            debugLog('layers', 'STORE: init CC brush for new layer', {
              id: newLayerId.substring(0, 20), size: { w: width, h: height }, hasGradient: !!gradient
            });

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
                debugLog('layers', 'STORE: CC brush initialized and warmed', newLayerId.substring(0, 20));
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
          
          return {
            layers: updatedLayers
          };
        });
        
        // Persist a structural snapshot asynchronously so the UI doesn't stutter
        // when adding layers on large canvases.
        try {
          // Allow opting out for debugging perf issues
          try { if ((window as any).__TB_DEBUG?.skipLayerAddSnapshot) { throw new Error('skip-snapshot'); } } catch {}
          const st = get();
          const w = st.project?.width ?? 1;
          const h = st.project?.height ?? 1;
          debugLog('layers', 'STORE: schedule saveCanvasState(layer-add)', { w, h, activeLayerId: st.activeLayerId?.substring(0, 20) });
          // Use a tiny placeholder canvas; we only need to record structure here.
          const temp = document.createElement('canvas');
          temp.width = 1;
          temp.height = 1;
          // Defer to allow React to finish updates and keep the thread responsive
          setTimeout(() => {
            try {
              st.saveCanvasState(temp as unknown as HTMLCanvasElement, 'layer-add', 'Add layer', newLayerId);
              try { const { recordBreadcrumb } = require('../utils/debug'); recordBreadcrumb('layers', { event: 'store-addLayer-saved', id: newLayerId.slice(0,20) }); } catch {}
            } catch (e) {
              try { const { debugLog } = require('../utils/debug'); debugLog('layers', 'STORE: async saveCanvasState(layer-add) failed', e); } catch {}
            }
          }, 0);
        } catch (e) {
          try { const { debugLog } = require('../utils/debug'); debugLog('layers', 'STORE: schedule saveCanvasState(layer-add) failed', e); } catch {}
        }

        return newLayerId;
      },
      removeLayer: (id) => {
        set((state) => {
          // Find the layer to be removed
          const layerToRemove = state.layers.find(l => l.id === id);
          
          // Use enhanced manager method for cleanup
          colorCycleBrushManager.removeColorCycleBrush(id);
          
          const updatedLayers = state.layers.filter(l => l.id !== id);
          const newActiveLayerId = state.activeLayerId === id ? 
            updatedLayers.find(l => l.id !== id)?.id || null : 
            state.activeLayerId;
          
          trackLayerChanges('removeLayer RETURN', updatedLayers);
          return {
            layers: updatedLayers,
            activeLayerId: newActiveLayerId
            // Remove the project update entirely - only update top-level layers
          };
        });

        // Persist a structural snapshot so undo restores the removed layer
        try {
          const st = get();
          const w = st.project?.width ?? 1;
          const h = st.project?.height ?? 1;
          const temp = document.createElement('canvas');
          temp.width = w;
          temp.height = h;
          st.saveCanvasState(temp as unknown as HTMLCanvasElement, 'layer-remove', 'Remove layer');
        } catch {}
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
          try { if ((window as any).__TB_DEBUG?.breakOnLayerErrors) { debugger; } } catch {}
        }
        
        // Also detect when colorCycleData is being cleared
        if (originalLayer?.colorCycleData && 
            'colorCycleData' in updates && 
            !updates.colorCycleData) {
          console.error('🔴🔴🔴 COLOR CYCLE DATA BEING CLEARED');
          console.error('Stack trace:', new Error().stack);
          console.error('Layer:', id);
          // Only break into debugger when explicitly opted-in
          try { if ((window as any).__TB_DEBUG?.breakOnLayerErrors) { debugger; } } catch {}
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
            let updatedLayer = { ...layer };
            
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
            const { colorCycleData, ...otherUpdates } = updates;
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
        
        // If a color-cycle layer's per-layer brush speed was updated, push it to the brush instance immediately
        try {
          if ('colorCycleData' in updates && (updates as any).colorCycleData) {
            const maybeSpeed = (updates as any).colorCycleData.brushSpeed;
            if (typeof maybeSpeed === 'number') {
              const newSpeed = Math.max(0.02, Math.min(2.0, maybeSpeed));
              const mgr = colorCycleBrushManager;
              const brush = mgr.getBrush(id);
              if (brush && 'setSpeed' in (brush as any) && typeof (brush as any).setSpeed === 'function') {
                (brush as any).setSpeed(newSpeed);
              }
            }
          }
        } catch {}

        trackLayerChanges('updateLayer RETURN', updatedLayers);

        return {
          layers: updatedLayers,
          layersNeedRecomposition: needsRecomposition || state.layersNeedRecomposition
          // Remove the project update entirely - only update top-level layers
        };
      }),
      setActiveLayer: (id) => set((state) => {
        const layer = state.layers.find(l => l.id === id);
        if (!layer) {
          logError('setActiveLayer: Invalid layer ID', id);
          return {} as any;
        }
        debugLog('layers', 'STORE: setActiveLayer called', {
          newId: id?.substring(0, 20),
          type: layer?.layerType,
          hadCC: !!layer?.colorCycleData,
          prev: state.activeLayerId?.substring(0, 20)
        });
        
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
                  if (oldBrush && 'endStroke' in oldBrush && typeof (oldBrush as any).endStroke === 'function') {
                    (oldBrush as any).endStroke(state.activeLayerId);
                  }
                } catch (e) { logError('CC cleanup error (non-fatal): endStroke', e); }
              }
            }
          } catch (e) {
            try { const { debugLog } = require('../utils/debug'); debugLog('layers', 'STORE: error switching away from CC layer', e); } catch {}
          }
          debugLog('layers', 'STORE: switched away from CC layer', {
            from: state.activeLayerId?.substring(0, 20),
            to: id?.substring(0, 20)
          });
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
            debugLog('layers', 'STORE: re-initialized CC brush on setActiveLayer', { id: id.substring(0, 20), size: { w: width, h: height } });
          }
          
          // Mark as active
          try { colorCycleBrushManager.setActiveState(id, true); } catch (e) { console.error('CC setActiveState error:', e); }
          
          // Update the brush gradient to match layer
          try {
            const colorCycleBrush = colorCycleBrushManager.getLayerColorCycleBrush(id);
            if (colorCycleBrush && layer.colorCycleData?.gradient) {
              // Set the active layer in the brush first
              if ('setActiveLayer' in colorCycleBrush && typeof colorCycleBrush.setActiveLayer === 'function') {
                colorCycleBrush.setActiveLayer(id);
              }
              // Then sync the gradient
              if ('setGradient' in colorCycleBrush && typeof colorCycleBrush.setGradient === 'function') {
                colorCycleBrush.setGradient(layer.colorCycleData.gradient, id);
              }
              debugLog('layers', 'STORE: synced gradient to CC brush for active layer', id.substring(0, 20));
            }
          } catch (e) {
            try { const { debugLog } = require('../utils/debug'); debugLog('layers', 'STORE: error syncing CC brush on activate', e); } catch {}
          }
          
          // Save current brush settings if we're on a regular brush
          let savedRegularBrush = state.tools.currentTool;
          let savedBrushShape = state.tools.brushSettings.brushShape;
          if (state.tools.currentTool === 'brush' || state.tools.currentTool === 'eraser') {
            savedRegularBrush = state.tools.currentTool;
            savedBrushShape = state.tools.brushSettings.brushShape;
          }
          
          // Inside this branch we've already ruled out 'recolor'; default to 'brush'
          const nextTool: Tool = 'brush';
          // When activating a Color Cycle layer, ensure a CC brush is selected so CC settings are visible
          const preferShapeMode = (state.tools.lastColorCycleShapeMode ?? state.tools.shapeMode) ?? false;
          const ccBrushShape = preferShapeMode ? BrushShape.COLOR_CYCLE_SHAPE : BrushShape.COLOR_CYCLE;
          const result = {
            activeLayerId: id,
            tools: {
              ...state.tools,
              // Preserve recolor tool if user is in Recolor and animate view
              currentTool: nextTool,
              lastRegularTool: savedRegularBrush, // Track the last regular tool
              lastRegularBrushShape: savedBrushShape, // Track the last brush shape
              // Align shape mode to the preferred CC variant so UI reflects CC controls immediately
              shapeMode: preferShapeMode,
              brushSettings: {
                ...state.tools.brushSettings,
                // Select Color Cycle brush variant so BrushControls show CC settings
                brushShape: ccBrushShape,
                colorCycleGradient: layer.colorCycleData?.gradient || []
              }
            }
          };
          
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
        let toolUpdate = {};
        const wasOnColorCycle = currentActiveLayer?.layerType === 'color-cycle';
        // Only restore last regular tool if we're NOT explicitly in recolor tool
        if (wasOnColorCycle && layer && layer.layerType === 'normal' && state.tools.currentTool !== 'recolor') {
          // Restore the last regular tool and brush shape
          const lastTool = (state.tools as any).lastRegularTool || 'brush';
          const lastShape = (state.tools as any).lastRegularBrushShape || state.tools.brushSettings.brushShape;
          
          toolUpdate = {
            tools: {
              ...state.tools,
              currentTool: lastTool,
              brushSettings: {
                ...state.tools.brushSettings,
                brushShape: lastShape
              }
            }
          };
        }
        
        const result = { 
          activeLayerId: id,
          ...toolUpdate
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
        set({ layers: fixedLayers });
      },
      reorderLayers: (sourceIndex, destinationIndex) => {
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
          
          return {
            layers: updatedLayers,
            layersNeedRecomposition: true
            // Remove the project update entirely - only update top-level layers
          };
        });

        // Persist a structural snapshot so reorders are undoable step-by-step
        try {
          const st = get();
          const w = st.project?.width ?? 1;
          const h = st.project?.height ?? 1;
          const temp = document.createElement('canvas');
          temp.width = w;
          temp.height = h;
          st.saveCanvasState(temp as unknown as HTMLCanvasElement, 'layer-reorder', 'Reorder layers');
        } catch {}
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
            console.log('Color cycle already initialized for layer:', layerId);
            // Ensure the layer has a valid canvas and CC metadata even if we skip recreation.
            const updatedLayers = state.layers.map(l => {
              if (l.id !== layerId) return l;
              const existingCanvas = l.colorCycleData?.canvas;
              const brushCanvas = existingBrush.getCanvas ? existingBrush.getCanvas() : undefined;
              // Prefer brush canvas; fall back to existing if present
              const canvas = brushCanvas || existingCanvas;
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
            return { layers: updatedLayers };
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
            let color = { r: 255, g: 0, b: 0 }; // Default red
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
        
        const updatedLayers = state.layers.map(l => 
          l.id === layerId 
            ? {
                ...l,
                layerType: 'color-cycle' as const,
                colorCycleData: {
                  gradient: gradient || [],
                  colorCycleBrush,
                  isAnimating: true,
                  // Initialize per-layer brush speed from current brush settings
                  brushSpeed: state.tools.brushSettings.colorCycleSpeed || 0.1,
                  canvas: colorCycleBrush.getCanvas ? colorCycleBrush.getCanvas() : undefined
                }
              }
            : l
        );
        
        trackLayerChanges('initColorCycleForLayer RETURN', updatedLayers);
        return {
          layers: updatedLayers
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
        
        return {
          layers: updatedLayers
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
        return colorCycleBrushManager.getBrush(layerId);
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
        const hasSaturationAdjust = currentBrushSettings.saturationAdjust !== 100;
        
        if (hasHueShift || hasSaturationAdjust) {
          // Apply the hue shift and saturation adjustments to the brush ImageData
          finalImageData = adjustHueAndSaturation(
            customBrush.imageData,
            currentBrushSettings.hueShift || 0,
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
        // The BrushEditorUI component will display it in its own modal canvas

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
        
        return {
          brushEditor: {
            status: 'EDITING' as const,
            editingBrushId: brushId,
            editingBounds: bounds,
            originalCanvasState,
            hueShift: 0,  // Reset adjustments for new edit
            lightness: 0,
            saturation: 100,
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
        
        // Create a composite canvas to match the modal canvas size
        const compositeCanvas = document.createElement('canvas');
        compositeCanvas.width = canvas.width;
        compositeCanvas.height = canvas.height;
        const compositeCtx = compositeCanvas.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings) as (CanvasRenderingContext2D | null);

        if (!compositeCtx) return state;
        
        // Get the pixels directly from the modal canvas (starts at 0,0)
        // Note: The canvas already has the hue/lightness/saturation adjustments applied
        // by the BrushEditorUI component's useEffect, so we don't need to apply them again
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

        // Note: The canvas parameter here should be the modal canvas from BrushEditorUI,
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
        brushEditor: { ...state.brushEditor, hueShift: hue }
      })),
      setBrushEditorLightness: (lightness: number) => set((state) => ({
        brushEditor: { ...state.brushEditor, lightness: lightness }
      })),
      setBrushEditorSaturation: (saturation: number) => set((state) => ({
        brushEditor: { ...state.brushEditor, saturation: saturation }
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
        // The brush editor works entirely in its own modal canvas

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
      saveCanvasState: (canvas, actionType, description, overrideActiveLayerId?: string) => {
        // Diagnostics via scoped debug
        try { const { debugLog } = require('../utils/debug'); debugLog('history', { event: 'saveCanvasState', actionType, description }); } catch {}
        // Allow disabling history during debugging/perf triage
        try { if ((window as any).__TB_DEBUG?.disableHistory) { return; } } catch {}
        if (isHistoryOperationInProgress) {
          return;
        }
        
        const now = Date.now();
        
        // Clear existing timer
        if (saveCanvasStateTimer) {
          clearTimeout(saveCanvasStateTimer);
        }
        
        // For important actions, save immediately
        // Treat Color-Cycle brush commits and structural layer ops as important so each action
        // becomes its own history entry (enables step-by-step undo: stroke -> empty layer -> no layer).
        let isImportantAction = actionType === 'paste' || actionType === 'fill';
        if (typeof actionType === 'string') {
          if (
            actionType === 'layer' ||
            actionType.startsWith('layer-') ||
            actionType === 'layers' ||
            actionType === 'structure'
          ) {
            isImportantAction = true;
          }
        }
        try {
          const s = get();
          const activeLayer = (s.layers || []).find(l => l.id === s.activeLayerId);
          const isColorCycleLayer = activeLayer?.layerType === 'color-cycle';
          if (actionType === 'brush' && isColorCycleLayer) {
            isImportantAction = true;
          }
          // ADDITIONAL FIX: Also check description for any CC-related actions
          if (description && (description.includes('CC') || description.includes('Color Cycle'))) {
            isImportantAction = true;
          }
        } catch {}
        
        const performSave = () => {
          const state = get();
          if (state.history.isCapturing || isHistoryOperationInProgress) {
            return;
          }
          
          const ctx = canvas.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings) as (CanvasRenderingContext2D | null);
          if (!ctx) return;
          
          let imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          // Optimization: For Color Cycle actions, avoid capturing full-canvas ImageData
          try {
            const s = get();
            const activeLayer = (s.layers || []).find(l => l.id === s.activeLayerId);
            const isColorCycleLayer = activeLayer?.layerType === 'color-cycle';
            const isCCAction = actionType === 'fill' || (description && (description.includes('CC') || description.includes('Color Cycle')));
            if (isColorCycleLayer && isCCAction) {
              imageData = new ImageData(1, 1);
            }
          } catch {}
          // Deep copy layers to preserve their individual ImageData and colorCycleData
          const layersCopy = (state.layers || []).map(layer => {
            const layerCopy: any = {
              ...layer,
              // CRITICAL: Explicitly preserve layerType to prevent corruption
              layerType: layer.layerType,
              imageData: layer.imageData ? new ImageData(
                new Uint8ClampedArray(layer.imageData.data),
                layer.imageData.width,
                layer.imageData.height
              ) : layer.imageData
            };
            
            // Deep copy colorCycleData if present
            if (layer.colorCycleData) {
              // Capture canvas pixels (if any) and only persist colorCycleData when there is content.
              let captured: ImageData | undefined = undefined;
              const isStructural = typeof actionType === 'string' && (
                actionType === 'layer' || actionType.startsWith('layer-') || actionType === 'layers' || actionType === 'structure'
              );
              const isCCAction = isStructural || actionType === 'fill' || (description && (description.includes('CC') || description.includes('Color Cycle')));
              if (!isCCAction && layer.colorCycleData.canvas) {
                try {
                  const ccCtx = layer.colorCycleData.canvas.getContext('2d', { willReadFrequently: true } as any);
                  if (ccCtx && 'getImageData' in ccCtx) {
                    captured = (ccCtx as CanvasRenderingContext2D).getImageData(0, 0, layer.colorCycleData.canvas.width, layer.colorCycleData.canvas.height);
                  }
                } catch {}
              }

              // Determine if the CC canvas has any visible pixels (alpha > 0)
              // Default to true (keep CC) if we could not capture pixels safely
              let hasCCPixels = !captured ? true : false;
              if (captured?.data) {
                const data = captured.data;
                // Sample alpha every few pixels for performance
                const step = Math.max(4, Math.floor(data.length / 4096));
                for (let i = 3; i < data.length; i += step) {
                  if (data[i] > 0) { hasCCPixels = true; break; }
                }
              }

              if (hasCCPixels) {
                // Persist CC data when there is actual content
                layerCopy.colorCycleData = {
                  ...layer.colorCycleData,
                  gradient: layer.colorCycleData.gradient ? [...layer.colorCycleData.gradient] : undefined,
                  canvasImageData: captured,
                  canvasWidth: layer.colorCycleData.canvas?.width,
                  canvasHeight: layer.colorCycleData.canvas?.height,
                };
              } else {
                // No CC pixels at this snapshot — treat as a normal layer in history.
                // This enables the desired undo sequence:
                //  - Undo last stroke: layer remains but converts to normal
                //  - Undo again (if the layer was created by that action): layer can be removed by older snapshot
                delete layerCopy.colorCycleData;
                layerCopy.layerType = 'normal';
              }
            }
            
            return layerCopy;
          });
          
          // Capture color cycle state if available
          let colorCycleState: CanvasSnapshot['colorCycleState'] = undefined;
          const activeLayer = (state.layers || []).find(l => l.id === state.activeLayerId);
          
          if (activeLayer?.colorCycleData?.colorCycleBrush) {
            const brush = activeLayer.colorCycleData.colorCycleBrush as any;
            const fullState = brush.serialize ? brush.serialize() : (brush.getFullState ? brush.getFullState() : null);
            
            if (fullState) {
              colorCycleState = {
                layerId: activeLayer.id,
                strokeData: new ArrayBuffer(0),
                gradients: [],
                animationState: {
                  cycleOffset: 0,
                  speed: 1,
                  fps: 30,
                  isPaused: false
                },
                layerStrokes: (fullState.layers || []).map((layer: any) => {
                  const idx = layer?.data?.indexBuffer;
                  const dataArr: Uint8Array | null = idx?.data ? new Uint8Array(idx.data) : null;
                  const nonZero = dataArr ? dataArr.some((v) => v !== 0) : false;
                  return {
                    layerId: layer.layerId,
                    paintBuffer: layer.strokeData?.paintBuffer ? layer.strokeData.paintBuffer.slice(0) : new ArrayBuffer(0),
                    hasContent: !!layer.strokeData?.hasContent || nonZero,
                    strokeCounter: layer.strokeData?.strokeCounter || 0,
                    strokeLength: 0,
                    gradientLayerIndices: [],
                    currentGradientIndex: 0,
                    // Include animator's index buffer so restore can faithfully rebuild prior pixels
                    animatorIndex: idx ? {
                      width: idx.width,
                      height: idx.height,
                      data: (dataArr ? dataArr.slice(0) : new Uint8Array()).buffer,
                      // Optional: persist current gradient stops with this layer
                      gradientStops: layer?.data?.gradient?.gradientStops || undefined
                    } : undefined
                  };
                })
              };

              // DEBUG: Log CC snapshot details
              try {
                const ls = colorCycleState.layerStrokes || [];
                debugLog('cc-history', {
                  phase: 'save',
                  activeLayerId: activeLayer.id?.substring(0, 20),
                  layersCount: (state.layers || []).length,
                  ccLayers: (state.layers || []).filter(l => l.layerType === 'color-cycle').length,
                  strokesSaved: ls.length,
                  details: ls.map((s: any) => ({
                    id: s.layerId?.substring(0, 20),
                    hasContent: s.hasContent,
                    paintBufferBytes: s.paintBuffer?.byteLength || 0,
                    strokeCounter: s.strokeCounter
                  }))
                });
              } catch {}
            }
          }
          
          const snapshot: CanvasSnapshot = {
            id: `snapshot_${Date.now()}_${Math.random()}`,
            timestamp: Date.now(),
            imageData,
            layers: layersCopy,  // Deep copy of all layers with cloned ImageData
            activeLayerId: overrideActiveLayerId || state.activeLayerId || state.layers[0]?.id || '',  // Current active layer or fallback
            actionType,
            description,
            colorCycleState
          };
          
          const newUndoStack = [...state.history.undoStack, snapshot];
          if (newUndoStack.length > state.history.maxHistorySize) {
            newUndoStack.shift();
          }
          
          
          set({
            history: {
              ...state.history,
              undoStack: newUndoStack,
              redoStack: []
            },
            autosave: {
              ...state.autosave,
              hasUnsavedChanges: true,
              lastSaveTime: new Date()
            }
          });

          // Debug: trace history entry and stack size (opt-in)
          try { const { debugLog } = require('../utils/debug'); debugLog('history', { event: 'save', actionType, description, undoSize: newUndoStack.length }); } catch {}
        };

        if (isImportantAction || (now - lastSaveTimestamp) >= MIN_SAVE_INTERVAL) {
          // Save immediately
          try { const { debugLog } = require('../utils/debug'); debugLog('history', { event: 'performSave-immediate', actionType, description }); } catch {}
          performSave();
          lastSaveTimestamp = now;
        } else {
          // Debounce for frequent actions like brush strokes
          try { const { debugLog } = require('../utils/debug'); debugLog('history', { event: 'performSave-scheduled', delay: 100, actionType, description }); } catch {}
          saveCanvasStateTimer = setTimeout(() => {
            performSave();
            lastSaveTimestamp = Date.now();
            saveCanvasStateTimer = null;
          }, 100);
        }
      },
      
      undo: () => {
        const state = get();
        
        if (state.history.undoStack.length === 0) {
          return null; // Can't undo if stack is empty
        }
        
        // Current state is the last item in undoStack - move it to redoStack
        const currentState = state.history.undoStack[state.history.undoStack.length - 1];
        
        // If there's only one state, we can't undo further but we should handle it gracefully
        if (state.history.undoStack.length === 1) {
          return null;
        }
        
        // Previous state is what we want to restore to
        const previousState = state.history.undoStack[state.history.undoStack.length - 2];
        
        const newUndoStack = state.history.undoStack.slice(0, -1); // Remove current state
        const newRedoStack = [currentState, ...state.history.redoStack]; // Add current to redo stack
        
        // Set protection flags during operation
        isHistoryOperationInProgress = true;
        
        set({
          history: {
            ...state.history,
            undoStack: newUndoStack,
            redoStack: newRedoStack,
            isCapturing: true
          }
        });
        
        // Reset flags immediately after state update - no async delay needed
        isHistoryOperationInProgress = false;
        set((state) => ({
          history: {
            ...state.history,
            isCapturing: false
          }
        }));
        
        return previousState; // Return the state to restore to
      },
      
      redo: () => {
        const state = get();
        
        
        if (state.history.redoStack.length === 0) {
          return null;
        }
        
        // The first item in redoStack is the state we want to restore to
        const stateToRestore = state.history.redoStack[0];
        
        const newRedoStack = state.history.redoStack.slice(1); // Remove restored state from redo stack
        const newUndoStack = [...state.history.undoStack, stateToRestore]; // Add restored state to undo stack
        
        // Set protection flags during operation
        isHistoryOperationInProgress = true;
        
        set({
          history: {
            ...state.history,
            undoStack: newUndoStack,
            redoStack: newRedoStack,
            isCapturing: true
          }
        });
        
        // Reset flags immediately after state update - no async delay needed
        isHistoryOperationInProgress = false;
        set((state) => ({
          history: {
            ...state.history,
            isCapturing: false
          }
        }));
        
        return stateToRestore; // Return the state to restore to
      },
      
      canUndo: () => get().history.undoStack.length > 1,
      canRedo: () => get().history.redoStack.length > 0,
      
      clearHistory: () => set((state) => ({
        history: {
          ...state.history,
          undoStack: [],
          redoStack: []
        }
      })),
      
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
            globalBrushSize: freshState.globalBrushSize
          };
          
          await saveProjectToFile(projectWithViewState, filename, freshState.layers);
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
          
          // Update the store with the loaded project and restored layers
          set({
            project: loadedProject,
            layers: finalLayers,
            activeLayerId: loadedProject.layers[0]?.id || null,
            layersNeedRecomposition: true,
            // Restore view state if available
            canvas: loadedProject.viewState ? {
              ...get().canvas,
              zoom: loadedProject.viewState.zoom
            } : get().canvas,
            // Restore brush-specific settings
            brushSpecificSettings: loadedProject.brushSpecificSettings || {},
            // Restore global brush size
            globalBrushSize: loadedProject.globalBrushSize || 10
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
        // Create a default layer with empty image data
        const defaultLayerId = `layer-${Date.now()}-${Math.random()}`;
        
        // Create framebuffer as HTMLCanvasElement
        const framebuffer = new OffscreenCanvas(width, height);
        
        const defaultLayer: Layer = {
          id: defaultLayerId,
          name: 'Layer 1',
          visible: true,
          opacity: 1,
          blendMode: 'source-over',
          order: 0,
          locked: false,
          imageData: new ImageData(width, height),
          framebuffer,
          layerType: 'normal' // REQUIRED field
        };
        
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
          brushSpecificSettings: {}
        };
        
        set({
          project: newProject,
          layers: [defaultLayer], // Only set top-level layers
          activeLayerId: defaultLayerId,
          canvas: {
            ...get().canvas,
            canvasWidth: width,
            canvasHeight: height
          },
          layersNeedRecomposition: true
          // Preserve brush settings across projects - they are user preferences
        });
        
        // Clear history for new project
        get().clearHistory();
      },
      
      compositeLayersToCanvas: (targetCanvas: HTMLCanvasElement) => {
        const state = get();
        try { const { debugLog } = require('../utils/debug'); debugLog('composite', 'BEGIN compose', { count: state.layers.length, size: { w: state.project?.width, h: state.project?.height } }); } catch {}

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
          try { const { debugLog } = require('../utils/debug'); debugLog('composite', 'Layers order', sortedLayers.map(l => ({ id: l.id.slice(0, 8), type: l.layerType, vis: l.visible, hasCC: !!l.colorCycleData }))); } catch {}

          for (const layer of sortedLayers) {
            try {
              if (!layer.visible) continue;

              // Brush-based Color Cycle (Canvas2D path)
              if (layer.layerType === 'color-cycle' && layer.colorCycleData?.canvas && layer.colorCycleData?.mode !== 'recolor') {
                try { const { debugLog } = require('../utils/debug'); debugLog('composite', 'Draw CC layer', { id: layer.id.slice(0, 8) }); } catch {}
                const colorCycleBrushManager = getColorCycleBrushManager();
                const isAnimating = !!layer.colorCycleData.isAnimating;
                if (colorCycleBrushManager && isAnimating) {
                  const colorCycleBrush = colorCycleBrushManager.getBrush(layer.id);
                  const playing = colorCycleBrush && colorCycleBrush.isPlaying && colorCycleBrush.isPlaying();
                  if (playing) {
                    colorCycleBrush.updateAnimation();
                    colorCycleBrush.renderDirectToCanvas(layer.colorCycleData.canvas, layer.id);
                  }
                  try { const { debugLog } = require('../utils/debug'); debugLog('cc-render', { event: 'composite', layerId: layer.id.substring(0, 20), isAnimating, isPlaying: !!playing }); } catch {}
                }

                ctx.globalCompositeOperation = layer.blendMode;
                ctx.globalAlpha = layer.opacity;
                ctx.drawImage(layer.colorCycleData.canvas, 0, 0);
                continue;
              }

              // Recolor mode (GPU path): draw GPU-updated canvas if available
              if (layer.layerType === 'color-cycle' && layer.colorCycleData?.mode === 'recolor' && layer.colorCycleData.canvas) {
                try { const { debugLog } = require('../utils/debug'); debugLog('composite', 'Draw recolor GPU canvas', { id: layer.id.slice(0, 8) }); } catch {}
                ctx.globalCompositeOperation = layer.blendMode;
                ctx.globalAlpha = layer.opacity;
                ctx.drawImage(layer.colorCycleData.canvas, 0, 0);
                continue;
              }

              // Normal layers
              if (!layer.imageData) {
                try { const { debugLog } = require('../utils/debug'); debugLog('composite', 'Skip normal layer (no imageData)', { id: layer.id.slice(0, 8) }); } catch {}
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
              try { const { debugLog } = require('../utils/debug'); debugLog('composite-error', 'Layer compose error', layerError); } catch {}
              // Continue composing remaining layers
            }
          }

          // Reset context state
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = 1.0;
        } catch (e) {
          try { const { debugLog } = require('../utils/debug'); debugLog('composite-error', 'Compose failed', e); } catch {}
        } finally {
          try { const { debugLog } = require('../utils/debug'); debugLog('composite', 'END compose'); } catch {}
        }
      },
      
      captureCanvasToActiveLayer: async (sourceCanvas?: HTMLCanvasElement) => {
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
        
        const ctx = canvas.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings) as (CanvasRenderingContext2D | null);
        if (!ctx) {
          return;
        }
        
        try {
          // Capture only the project area, not the full canvas
          const captureWidth = Math.min(state.project.width, canvas.width);
          const captureHeight = Math.min(state.project.height, canvas.height);
          
          
          // CRITICAL CHECK: Are we capturing the right area?
          if (captureWidth !== state.project.width || captureHeight !== state.project.height) {
            console.warn('[CAPTURE] WARNING: Capture size mismatch!', {
              captureSize: { width: captureWidth, height: captureHeight },
              projectSize: { width: state.project.width, height: state.project.height }
            });
          }
          
          // Always capture the full canvas, regardless of brush editor status
          // This allows normal drawing on the main canvas while the modal is open
          const imageData = ctx.getImageData(0, 0, captureWidth, captureHeight);
          
          
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
                  if (fb.width !== imageData.width || fb.height !== imageData.height) {
                    fb.width = imageData.width;
                    fb.height = imageData.height;
                  }
                  const framebufferCtx = fb.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings) as (CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null);
                  if (framebufferCtx) {
                    framebufferCtx.clearRect(0, 0, fb.width, fb.height);
                    framebufferCtx.putImageData(imageData, 0, 0);
                  }
                  // CRITICAL: Preserve ALL layer properties including layerType and colorCycleData
                  // Use spread operator first to preserve everything, then override only imageData
                  const updatedLayer = { 
                    ...layer, 
                    imageData,
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
              return {
                layers: updatedLayers,
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
        
        if (!sourceCanvas) {
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
            return {
              layers: updatedLayers,
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
      setHistorySize: (size) => set((state) => ({
        history: { ...state.history, maxHistorySize: size }
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
        
        return loadedSettings;
      },
      clearBrushSettings: (brushId) => set((state) => {
        const { [brushId]: _, ...remaining } = state.brushSpecificSettings;
        return { brushSpecificSettings: remaining };
      })
    };
    }
  // ),
  // { name: 'tinybrush-store' }
);

// Corruption detector removed - bug is fixed

// Subscribe to track all layer changes
useAppStore.subscribe((state) => {
  trackLayerChanges('STORE SUBSCRIPTION', state.layers);
  
  // Note: Zustand v4 doesn't provide previous state in subscribe
  // Would need to track manually if we need to compare
});
