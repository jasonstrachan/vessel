// Zustand store with state slices
// Based on /docs/02_System_Architecture/Overall_Design.md (lines 58-64)

// Module-level flag to prevent saveCanvasState during undo/redo operations
let isHistoryOperationInProgress = false;

// Debouncing for canvas state saves to improve performance
let saveCanvasStateTimer: NodeJS.Timeout | null = null;
let lastSaveTimestamp = 0;
const MIN_SAVE_INTERVAL = 100; // Minimum 0.1 second between saves


import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
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
} from '../types';
import { BrushShape } from '../types';
import { brushPresets, applyBrushPreset, defaultBrushPreset, defaultBrushSettings } from '../presets/brushPresets';
import { 
  saveProjectToFile, 
  loadProjectFromFile, 
  exportProjectAsPNG
} from '../utils/projectIO';
import { DEFAULT_CANVAS_WIDTH, DEFAULT_CANVAS_HEIGHT } from '../constants/canvas';

interface AppState {
  // Project State
  project: Project | null;
  setProject: (project: Project) => void;
  updateProject: (updates: Partial<Project>) => void;
  
  // Layer composition trigger
  layersNeedRecomposition: boolean;
  setLayersNeedRecomposition: (needed: boolean) => void;
  
  // History State
  history: HistoryState;
  saveCanvasState: (canvas: HTMLCanvasElement, actionType: CanvasSnapshot['actionType'], description: string) => void;
  undo: () => CanvasSnapshot | null;
  redo: () => CanvasSnapshot | null;
  canUndo: () => boolean;
  canRedo: () => boolean;
  clearHistory: () => void;
  
  // Canvas State
  canvas: CanvasState;
  setZoom: (zoom: number) => void;
  setPan: (panX: number, panY: number) => void;
  setRotation: (rotation: number) => void;
  toggleGrid: () => void;
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
  
  // Tool State
  tools: ToolState;
  setCurrentTool: (tool: Tool) => void;
  setBrushSettings: (settings: Partial<BrushSettings>) => void;
  setEraserSettings: (settings: Partial<BrushSettings>) => void;
  setFillSettings: (settings: Partial<ToolState['fillSettings']>) => void;
  
  // Brush Presets
  brushPresets: BrushPreset[];
  currentBrushPreset: BrushPreset | null;
  activeBrushComponents: BrushComponent[];
  setBrushPreset: (preset: BrushPreset) => void;
  getBrushPresets: () => BrushPreset[];
  getBrushPresetById: (id: string) => BrushPreset | undefined;
  
  // Temporary Custom Brush (for immediate use, not saved to library)
  temporaryCustomBrush: CustomBrush | null;
  setTemporaryCustomBrush: (brush: CustomBrush | null) => void;
  
  
  // UI State
  ui: UIState;
  togglePanel: (panel: keyof UIState['panels']) => void;
  toggleModal: (modal: keyof UIState['modals']) => void;
  setTheme: (theme: 'dark' | 'light') => void;
  addNotification: (notification: Omit<UIState['notifications'][0], 'id'>) => void;
  removeNotification: (id: string) => void;
  
  // Layer Management
  layers: Layer[];
  activeLayerId: string | null;
  currentLayer: number;
  addLayer: (layer: Omit<Layer, 'id' | 'order'>) => void;
  removeLayer: (id: string) => void;
  updateLayer: (id: string, updates: Partial<Layer>) => void;
  setActiveLayer: (id: string) => void;
  reorderLayers: (sourceIndex: number, destinationIndex: number) => void;
  
  // Custom Brush Management
  addCustomBrush: (brush: CustomBrush) => void;
  removeCustomBrush: (brushId: string) => void;
  saveCustomBrushAsPreset: (customBrushId: string) => void;
  
  // Brush Preset Management
  removeBrushPreset: (presetId: string) => void;
  
  // Project Save/Load Management
  saveProject: (filename?: string) => Promise<void>;
  loadProject: () => Promise<void>;
  exportProject: (format: 'png', options?: any) => Promise<void>;
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
  panX: 0,
  panY: 0,
  rotation: 0,
  showGrid: false,
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
  brushSettings: defaultBrushSettingsForStore,
  eraserSettings: { ...defaultBrushSettingsForStore, blendMode: 'source-over', color: 'rgba(255, 255, 255, 0.1)' },
  fillSettings: {
    threshold: 0,
    contiguous: true
  }
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
  notifications: []
};

const defaultHistoryState: HistoryState = {
  undoStack: [],
  redoStack: [],
  maxHistorySize: 50,
  isCapturing: false
};

export const useAppStore = create<AppState>()(
  devtools(
    (set, get) => ({
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
        customBrushes: []
      },
      setProject: (project) => set({ project }),
      updateProject: (updates) => set((state) => ({
        project: state.project ? { ...state.project, ...updates } : null
      })),
      
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
      setPan: (panX, panY) => set((state) => ({
        canvas: { ...state.canvas, panX, panY }
      })),
      setRotation: (rotation) => set((state) => ({
        canvas: { ...state.canvas, rotation }
      })),
      toggleGrid: () => set((state) => ({
        canvas: { ...state.canvas, showGrid: !state.canvas.showGrid }
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
          if (!layer.imageData) return layer;
          
          // Create new canvas with new dimensions
          const newCanvas = document.createElement('canvas');
          newCanvas.width = width;
          newCanvas.height = height;
          const newCtx = newCanvas.getContext('2d', { willReadFrequently: true });
          
          if (newCtx) {
            // Clear with transparent background
            newCtx.clearRect(0, 0, width, height);
            
            // Create temporary canvas for existing content
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = layer.imageData.width;
            tempCanvas.height = layer.imageData.height;
            const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
            
            if (tempCtx) {
              tempCtx.putImageData(layer.imageData, 0, 0);
              
              // Draw existing content centered in new canvas
              newCtx.drawImage(tempCanvas, offsetX, offsetY);
            }
            
            // Get new image data
            const newImageData = newCtx.getImageData(0, 0, width, height);
            
            return {
              ...layer,
              imageData: newImageData
            };
          }
          
          return layer;
        });
        
        return {
          project: updatedProject,
          layers: resizedLayers,
          canvas: { ...state.canvas, canvasWidth: width, canvasHeight: height },
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
      
      // Tool State
      tools: (() => {
        return defaultToolState;
      })(),
      setCurrentTool: (tool) => set((state) => {
        const newBrushSettings = { ...state.tools.brushSettings };
        
        // Reset custom brush state when switching to incompatible tools
        // Preserve custom brush when switching from 'custom' to 'brush' tool
        if (state.tools.currentTool === 'custom' && tool !== 'custom' && tool !== 'brush') {
          newBrushSettings.brushShape = BrushShape.ROUND; // Reset to default shape
          newBrushSettings.selectedCustomBrush = null;
        }
        
        return {
          tools: {
            ...state.tools,
            previousTool: state.tools.currentTool,
            currentTool: tool,
            brushSettings: newBrushSettings
          }
        };
      }),
      setBrushSettings: (settings) => set((state) => {
        
        const currentSettings = state.tools.brushSettings;
        const newSettings = { ...currentSettings, ...settings };
        
        // Handle brush size restoration when switching between custom and regular brushes
        if (settings.brushShape !== undefined) {
          const wasCustom = currentSettings.brushShape === BrushShape.CUSTOM;
          const isCustom = settings.brushShape === BrushShape.CUSTOM;
          
          if (!wasCustom && isCustom) {
            // Switching TO custom brush: save current regular size
            newSettings.lastRegularBrushSize = currentSettings.size;
          } else if (wasCustom && !isCustom) {
            // Switching FROM custom brush: restore last regular size
            if (currentSettings.lastRegularBrushSize !== undefined) {
              newSettings.size = currentSettings.lastRegularBrushSize;
            }
          }
        }
        
        // Update lastRegularBrushSize when size changes for regular brushes
        if (settings.size !== undefined && 
            newSettings.brushShape !== BrushShape.CUSTOM) {
          newSettings.lastRegularBrushSize = settings.size;
        }
        
        
        return {
          tools: {
            ...state.tools,
            brushSettings: newSettings
          }
        };
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
      
      // Brush Presets
      brushPresets,
      currentBrushPreset: defaultBrushPreset,
      activeBrushComponents: defaultBrushPreset.components,
      
      // Temporary Custom Brush
      temporaryCustomBrush: null,
      setTemporaryCustomBrush: (brush) => set({ temporaryCustomBrush: brush }),
      setBrushPreset: (preset) => set((state) => {
        
        const { settings, components } = applyBrushPreset(preset);
        
        const currentSettings = state.tools.brushSettings;
        const newBrushSettings = { ...currentSettings, ...settings };
        
        // Handle brush size restoration when switching between custom and regular brushes
        if (settings.brushShape !== undefined) {
          const wasCustom = currentSettings.brushShape === BrushShape.CUSTOM;
          const isCustom = settings.brushShape === BrushShape.CUSTOM;
          
          if (!wasCustom && isCustom) {
            // Switching TO custom brush: save current regular size
            newBrushSettings.lastRegularBrushSize = currentSettings.size;
          } else if (wasCustom && !isCustom) {
            // Switching FROM custom brush: restore last regular size
            if (currentSettings.lastRegularBrushSize !== undefined) {
              newBrushSettings.size = currentSettings.lastRegularBrushSize;
            }
          }
        }
        
        // Update lastRegularBrushSize when size changes for regular brushes
        if (settings.size !== undefined && 
            newBrushSettings.brushShape !== BrushShape.CUSTOM) {
          newBrushSettings.lastRegularBrushSize = settings.size;
        }
        
        return {
          currentBrushPreset: preset,
          activeBrushComponents: components,
          tools: {
            ...state.tools,
            brushSettings: newBrushSettings
          }
        };
      }),
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
      
      // Layer Management
      layers: [],
      activeLayerId: null,
      currentLayer: 0,
      addLayer: (layer) => set((state) => {
        // Adding new layer
        
        const newLayer: Layer = {
          ...layer,
          id: `layer-${Date.now()}-${Math.random()}`,
          order: state.layers.length
        };
        const updatedLayers = [...state.layers, newLayer];
        
        return {
          layers: updatedLayers,
          activeLayerId: newLayer.id,
          project: state.project ? {
            ...state.project,
            layers: updatedLayers
          } : null
        };
      }),
      removeLayer: (id) => set((state) => {
        const layerToRemove = state.layers.find(l => l.id === id);
        const updatedLayers = state.layers.filter(l => l.id !== id);
        const newActiveLayerId = state.activeLayerId === id ? 
          updatedLayers.find(l => l.id !== id)?.id || null : 
          state.activeLayerId;
        
        return {
          layers: updatedLayers,
          activeLayerId: newActiveLayerId,
          project: state.project ? {
            ...state.project,
            layers: updatedLayers
          } : null
        };
      }),
      updateLayer: (id, updates) => set((state) => {
        const updatedLayers = state.layers.map(layer =>
          layer.id === id ? { ...layer, ...updates } : layer
        );
        
        // Check if visual properties changed that require recomposition
        const needsRecomposition = 'visible' in updates || 'opacity' in updates || 'blendMode' in updates;
        if (needsRecomposition) {
          // Visual property changed - triggering recomposition
        }
        
        return {
          layers: updatedLayers,
          layersNeedRecomposition: needsRecomposition || state.layersNeedRecomposition,
          project: state.project ? {
            ...state.project,
            layers: updatedLayers
          } : null
        };
      }),
      setActiveLayer: (id) => {
        set({ activeLayerId: id });
      },
      reorderLayers: (sourceIndex, destinationIndex) => set((state) => {
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
          layersNeedRecomposition: true,
          project: state.project ? {
            ...state.project,
            layers: updatedLayers
          } : null
        };
      }),
      
      // Custom Brush Management
      addCustomBrush: (brush) => set((state) => {
        const newProject = state.project ? {
          ...state.project,
          customBrushes: [...state.project.customBrushes, brush]
        } : null;

        // Automatically select the newly created custom brush
        const newBrushSettings = {
          ...state.tools.brushSettings,
          brushShape: BrushShape.CUSTOM,
          selectedCustomBrush: brush.id,
          size: 100
        };

        return {
          project: newProject,
          tools: {
            ...state.tools,
            brushSettings: newBrushSettings
          }
        };
      }),
      removeCustomBrush: (brushId) => set((state) => ({
        project: state.project ? {
          ...state.project,
          customBrushes: state.project.customBrushes.filter(b => b.id !== brushId)
        } : null
      })),
      saveCustomBrushAsPreset: (customBrushId) => set((state) => {
        // This function should actually just save temporary brushes to the project
        // Check if this is a temporary brush
        if (!state.temporaryCustomBrush || state.temporaryCustomBrush.id !== customBrushId) {
          return state; // Only save temporary brushes
        }
        
        const customBrush = state.temporaryCustomBrush;
        
        if (!state.project) return state;
        
        // Add the temporary brush to project's custom brushes
        const updatedProject = {
          ...state.project,
          customBrushes: [...state.project.customBrushes, customBrush]
        };
        
        return {
          // Clear the temporary brush since it's now saved to the project
          temporaryCustomBrush: null,
          // Update the project with the new custom brush
          project: updatedProject,
          // Keep the same brush selected (with its original ID)
          tools: {
            ...state.tools,
            brushSettings: {
              ...state.tools.brushSettings,
              brushShape: BrushShape.CUSTOM,
              selectedCustomBrush: customBrush.id, // Keep using the original brush ID
              currentBrushTip: undefined, // Clear currentBrushTip since the brush is now saved
              useSwatchColor: false // Default to false so custom brushes use their tip colors
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
      
      // History Management
      saveCanvasState: (canvas, actionType, description) => {
        if (isHistoryOperationInProgress) {
          return;
        }
        
        const now = Date.now();
        
        // Clear existing timer
        if (saveCanvasStateTimer) {
          clearTimeout(saveCanvasStateTimer);
        }
        
        // For important actions, save immediately
        const isImportantAction = actionType === 'paste' || actionType === 'fill';
        
        const performSave = () => {
          const state = get();
          if (state.history.isCapturing || isHistoryOperationInProgress) {
            return;
          }
          
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (!ctx) return;
          
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const snapshot: CanvasSnapshot = {
            id: `snapshot_${Date.now()}_${Math.random()}`,
            timestamp: Date.now(),
            imageData,
            actionType,
            description
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
        };
        
        if (isImportantAction || (now - lastSaveTimestamp) >= MIN_SAVE_INTERVAL) {
          // Save immediately
          performSave();
          lastSaveTimestamp = now;
        } else {
          // Debounce for frequent actions like brush strokes
          saveCanvasStateTimer = setTimeout(() => {
            performSave();
            lastSaveTimestamp = Date.now();
            saveCanvasStateTimer = null;
          }, 100);
        }
      },
      
      undo: () => {
        const state = get();
        
        if (state.history.undoStack.length <= 1) {
          return null; // Need at least 2 states to undo
        }
        
        // Current state is the last item in undoStack - move it to redoStack
        const currentState = state.history.undoStack[state.history.undoStack.length - 1];
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
              zoom: freshState.canvas.zoom,
              panX: freshState.canvas.panX,
              panY: freshState.canvas.panY
            }
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
          
          // Update the store with the loaded project
          set({
            project: loadedProject,
            layers: loadedProject.layers,
            activeLayerId: loadedProject.layers[0]?.id || null,
            layersNeedRecomposition: true,
            // Restore view state if available
            canvas: loadedProject.viewState ? {
              ...get().canvas,
              zoom: loadedProject.viewState.zoom,
              panX: loadedProject.viewState.panX,
              panY: loadedProject.viewState.panY
            } : get().canvas
          });
          
          // Restore canvas dimensions to match the loaded project
          state.setCanvasDimensions(loadedProject.width, loadedProject.height);
          
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
        const newProject: Project = {
          id: `project-${Date.now()}-${Math.random()}`,
          name,
          width,
          height,
          layers: [],
          backgroundColor: 'transparent',
          createdAt: new Date(),
          updatedAt: new Date(),
          customBrushes: []
        };
        
        set({
          project: newProject,
          layers: [],
          activeLayerId: null,
          canvas: {
            ...get().canvas,
            canvasWidth: width,
            canvasHeight: height
          },
          layersNeedRecomposition: true
        });
        
        // Clear history for new project
        get().clearHistory();
      },
      
      compositeLayersToCanvas: (targetCanvas: HTMLCanvasElement) => {
        const state = get();
        // Starting layer composition
        
        if (!state.project || !state.layers.length) {
          return;
        }
        
        const ctx = targetCanvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          return;
        }
        
        // Only resize canvas if dimensions don't match project
        // This prevents unnecessary canvas resets when toggling layer visibility
        if (targetCanvas.width !== state.project.width || targetCanvas.height !== state.project.height) {
          targetCanvas.width = state.project.width;
          targetCanvas.height = state.project.height;
        }
        
        // Clear the canvas
        ctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
        
        // Draw background color only if not transparent
        if (state.project.backgroundColor && state.project.backgroundColor !== 'transparent') {
          ctx.fillStyle = state.project.backgroundColor;
          ctx.fillRect(0, 0, targetCanvas.width, targetCanvas.height);
        }
        
        // Sort layers by order and draw each visible layer
        const sortedLayers = [...state.layers].sort((a, b) => a.order - b.order);
        let drawnLayers = 0;
        for (const layer of sortedLayers) {
          if (!layer.visible || !layer.imageData) {
            continue;
          }
          
          // Create temporary canvas for the layer
          const layerCanvas = document.createElement('canvas');
          layerCanvas.width = layer.imageData.width;
          layerCanvas.height = layer.imageData.height;
          const layerCtx = layerCanvas.getContext('2d', { willReadFrequently: true });
          
          if (layerCtx) {
            // Put the layer's ImageData onto the temporary canvas
            layerCtx.putImageData(layer.imageData, 0, 0);
            
            // Set composite operation and opacity
            ctx.globalCompositeOperation = layer.blendMode;
            ctx.globalAlpha = layer.opacity;
            
            // Draw the layer onto the target canvas
            ctx.drawImage(layerCanvas, 0, 0);
            drawnLayers++;
          }
        }
        
        // Reset context state
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1.0;
        
        // Layer composition complete
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
        
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          return;
        }
        
        try {
          // Capture only the project area, not the full canvas
          const captureWidth = Math.min(state.project.width, canvas.width);
          const captureHeight = Math.min(state.project.height, canvas.height);
          
          const imageData = ctx.getImageData(0, 0, captureWidth, captureHeight);
          
          // Find the active layer or use the first layer
          const activeLayerId = state.activeLayerId || state.layers[0]?.id;
          const activeLayer = state.layers.find(l => l.id === activeLayerId);
          
          if (activeLayerId) {
            // Update the layer with the captured ImageData using direct set
            set((currentState) => {
              const updatedLayers = currentState.layers.map(layer =>
                layer.id === activeLayerId ? { ...layer, imageData } : layer
              );
              return {
                layers: updatedLayers,
                project: currentState.project ? {
                  ...currentState.project,
                  layers: updatedLayers
                } : null
              };
            });
            
            // Wait for the next tick to ensure store update is complete
            await new Promise(resolve => setTimeout(resolve, 0));
          }
        } catch (error) {
          console.error('Capture failed with error:', error);
        }
      },
      
      captureCanvasToLayer: async (sourceCanvas: HTMLCanvasElement, targetLayerId: string | null) => {
        const state = get();
        // Skip if we're in the middle of a history operation
        if (state.history.isCapturing) {
          layerCount: state.layers.length,
          targetLayerId,
          targetLayerName: state.layers.find(l => l.id === targetLayerId)?.name || 'Unknown'
        });
        
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
        
        const ctx = sourceCanvas.getContext('2d', { willReadFrequently: true });
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
            const updatedLayers = currentState.layers.map(layer =>
              layer.id === targetLayerId ? { ...layer, imageData } : layer
            );
            return {
              layers: updatedLayers,
              project: currentState.project ? {
                ...currentState.project,
                layers: updatedLayers
              } : null
            };
          });
          
          // Wait for the next tick to ensure store update is complete
          await new Promise(resolve => setTimeout(resolve, 0));
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
      }))
    }),
    { name: 'tinybrush-store' }
  )
);