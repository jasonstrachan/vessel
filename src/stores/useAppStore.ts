// Zustand store with state slices
// Based on /docs/02_System_Architecture/Overall_Design.md (lines 58-64)

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type {
  Project,
  Layer,
  CanvasState,
  ToolState,
  UIState,
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

interface AppState {
  // Project State
  project: Project | null;
  setProject: (project: Project) => void;
  updateProject: (updates: Partial<Project>) => void;
  
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
}

// Default states - use default brush settings
const defaultBrushSettingsForStore: BrushSettings = defaultBrushSettings;

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
  eraserSettings: { ...defaultBrushSettingsForStore, blendMode: 'destination-out' },
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
    help: false
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
        width: 800,
        height: 600,
        layers: [],
        backgroundColor: '#FFFFFF',
        createdAt: new Date(),
        updatedAt: new Date(),
        customBrushes: []
      },
      setProject: (project) => set({ project }),
      updateProject: (updates) => set((state) => ({
        project: state.project ? { ...state.project, ...updates } : null
      })),
      
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
      tools: defaultToolState,
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
        const newLayer: Layer = {
          ...layer,
          id: `layer-${Date.now()}-${Math.random()}`,
          order: state.layers.length
        };
        return {
          layers: [...state.layers, newLayer],
          activeLayerId: newLayer.id
        };
      }),
      removeLayer: (id) => set((state) => ({
        layers: state.layers.filter(l => l.id !== id),
        activeLayerId: state.activeLayerId === id ? 
          state.layers.find(l => l.id !== id)?.id || null : 
          state.activeLayerId
      })),
      updateLayer: (id, updates) => set((state) => ({
        layers: state.layers.map(layer =>
          layer.id === id ? { ...layer, ...updates } : layer
        )
      })),
      setActiveLayer: (id) => set({ activeLayerId: id }),
      reorderLayers: (sourceIndex, destinationIndex) => set((state) => {
        const newLayers = [...state.layers];
        const [removed] = newLayers.splice(sourceIndex, 1);
        newLayers.splice(destinationIndex, 0, removed);
        
        // Update order values
        return {
          layers: newLayers.map((layer, index) => ({
            ...layer,
            order: index
          }))
        };
      }),
      
      // Custom Brush Management
      addCustomBrush: (brush) => set((state) => ({
        project: state.project ? {
          ...state.project,
          customBrushes: [...state.project.customBrushes, brush]
        } : null
      })),
      removeCustomBrush: (brushId) => set((state) => ({
        project: state.project ? {
          ...state.project,
          customBrushes: state.project.customBrushes.filter(b => b.id !== brushId)
        } : null
      })),
      saveCustomBrushAsPreset: (customBrushId) => set((state) => {
        const customBrush = state.project?.customBrushes.find(b => b.id === customBrushId);
        if (!customBrush) return state;
        
        // Create a brush preset from the custom brush
        const newPreset: BrushPreset = {
          id: `preset_${customBrush.id}`,
          name: `${customBrush.name} (Saved)`,
          category: 'Custom',
          components: [], // Custom brushes don't use components
          thumbnail: customBrush.thumbnail,
          tags: ['custom', 'saved'],
          isDefault: false,
          createdAt: new Date(),
          modifiedAt: new Date(),
          isCustomBrush: true,
          customBrushData: {
            imageData: customBrush.imageData,
            width: customBrush.width,
            height: customBrush.height
          }
        };
        
        return {
          brushPresets: [...state.brushPresets, newPreset]
        };
      }),
      
      // History Management
      saveCanvasState: (canvas, actionType, description) => set((state) => {
        if (state.history.isCapturing) return state;
        
        const ctx = canvas.getContext('2d');
        if (!ctx) return state;
        
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
        
        return {
          history: {
            ...state.history,
            undoStack: newUndoStack,
            redoStack: []
          }
        };
      }),
      
      undo: () => {
        const state = get();
        if (state.history.undoStack.length === 0) return null;
        
        const snapshot = state.history.undoStack[state.history.undoStack.length - 1];
        const newUndoStack = state.history.undoStack.slice(0, -1);
        const newRedoStack = [...state.history.redoStack, snapshot];
        
        set({
          history: {
            ...state.history,
            undoStack: newUndoStack,
            redoStack: newRedoStack,
            isCapturing: true
          }
        });
        
        // Reset capturing flag after restoration
        setTimeout(() => {
          set((state) => ({
            history: {
              ...state.history,
              isCapturing: false
            }
          }));
        }, 0);
        
        return snapshot;
      },
      
      redo: () => {
        const state = get();
        if (state.history.redoStack.length === 0) return null;
        
        const snapshot = state.history.redoStack[state.history.redoStack.length - 1];
        const newRedoStack = state.history.redoStack.slice(0, -1);
        const newUndoStack = [...state.history.undoStack, snapshot];
        
        set({
          history: {
            ...state.history,
            undoStack: newUndoStack,
            redoStack: newRedoStack,
            isCapturing: true
          }
        });
        
        // Reset capturing flag after restoration
        setTimeout(() => {
          set((state) => ({
            history: {
              ...state.history,
              isCapturing: false
            }
          }));
        }, 0);
        
        return snapshot;
      },
      
      canUndo: () => get().history.undoStack.length > 0,
      canRedo: () => get().history.redoStack.length > 0,
      
      clearHistory: () => set((state) => ({
        history: {
          ...state.history,
          undoStack: [],
          redoStack: []
        }
      }))
    }),
    { name: 'tinybrush-store' }
  )
);