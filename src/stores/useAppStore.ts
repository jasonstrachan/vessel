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
  BrushSettings
} from '../types';

interface AppState {
  // Project State
  project: Project | null;
  setProject: (project: Project) => void;
  updateProject: (updates: Partial<Project>) => void;
  
  // Canvas State
  canvas: CanvasState;
  setZoom: (zoom: number) => void;
  setPan: (panX: number, panY: number) => void;
  setRotation: (rotation: number) => void;
  toggleGrid: () => void;
  setGridSize: (size: number) => void;
  toggleRulers: () => void;
  setSelection: (selection: CanvasState['selection']) => void;
  setCursor: (cursor: CanvasState['cursor']) => void;
  
  // Tool State
  tools: ToolState;
  setCurrentTool: (tool: Tool) => void;
  setBrushSettings: (settings: Partial<BrushSettings>) => void;
  setEraserSettings: (settings: Partial<BrushSettings>) => void;
  setFillSettings: (settings: Partial<ToolState['fillSettings']>) => void;
  
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
  addLayer: (layer: Omit<Layer, 'id' | 'order'>) => void;
  removeLayer: (id: string) => void;
  updateLayer: (id: string, updates: Partial<Layer>) => void;
  setActiveLayer: (id: string) => void;
  reorderLayers: (sourceIndex: number, destinationIndex: number) => void;
}

// Default states
const defaultBrushSettings: BrushSettings = {
  size: 10,
  opacity: 1,
  color: '#000000',
  blendMode: 'source-over',
  spacing: 0.25,
  pressure: 1,
  rotation: 0,
  antialiasing: true
};

const defaultCanvasState: CanvasState = {
  zoom: 1,
  panX: 0,
  panY: 0,
  rotation: 0,
  showGrid: false,
  gridSize: 16,
  showRulers: false,
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
  brushSettings: defaultBrushSettings,
  eraserSettings: { ...defaultBrushSettings, blendMode: 'destination-out' },
  fillSettings: {
    tolerance: 0,
    contiguous: true,
    allLayers: false
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

export const useAppStore = create<AppState>()(
  devtools(
    (set) => ({
      // Project State
      project: null,
      setProject: (project) => set({ project }),
      updateProject: (updates) => set((state) => ({
        project: state.project ? { ...state.project, ...updates } : null
      })),
      
      // Canvas State
      canvas: defaultCanvasState,
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
      setSelection: (selection) => set((state) => ({
        canvas: { ...state.canvas, selection }
      })),
      setCursor: (cursor) => set((state) => ({
        canvas: { ...state.canvas, cursor }
      })),
      
      // Tool State
      tools: defaultToolState,
      setCurrentTool: (tool) => set((state) => ({
        tools: {
          ...state.tools,
          previousTool: state.tools.currentTool,
          currentTool: tool
        }
      })),
      setBrushSettings: (settings) => set((state) => ({
        tools: {
          ...state.tools,
          brushSettings: { ...state.tools.brushSettings, ...settings }
        }
      })),
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
      })
    }),
    { name: 'tinybrush-store' }
  )
);