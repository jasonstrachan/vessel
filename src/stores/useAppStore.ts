import { create } from 'zustand';
import { AppState, Tool, Layer, BrushSettings, OnionSkinSettings, UndoAction } from '@/types';

interface AppStore extends AppState {
  // Zoom state
  zoom: number;
  panX: number;
  panY: number;
  
  // Actions
  setCurrentTool: (tool: Tool) => void;
  setCurrentLayer: (layerIndex: number) => void;
  setCurrentFrame: (frame: number) => void;
  setBrushSettings: (settings: Partial<BrushSettings>) => void;
  setOnionSkinSettings: (settings: Partial<OnionSkinSettings>) => void;
  togglePlay: () => void;
  addLayer: (name: string) => void;
  removeLayer: (layerIndex: number) => void;
  toggleLayerVisibility: (layerIndex: number) => void;
  renameLayer: (layerIndex: number, name: string) => void;
  addFrame: () => void;
  removeFrame: (frameIndex: number) => void;
  copyFrame: (fromLayer: number, fromFrame: number, toLayer: number, toFrame: number) => void;
  undo: () => void;
  redo: () => void;
  addUndoAction: (action: UndoAction) => void;
  setZoom: (zoom: number, mouseX?: number, mouseY?: number) => void;
  setPan: (x: number, y: number) => void;
}

const createDefaultBrushSettings = (): BrushSettings => ({
  color: '#000000',
  size: 25,
  opacity: 1,
  rotation: 0,
  pixelPerfect: false,
  followBrush: false,
  dottedStyle: {
    enabled: false,
    spacing: 5,
    dashLength: 10,
    dashSpacing: 5,
  },
});

const createDefaultOnionSkinSettings = (): OnionSkinSettings => ({
  enabled: false,
  framesBefore: 2,
  framesAfter: 2,
  opacity: 0.3,
});

export const useAppStore = create<AppStore>((set, get) => ({
  project: {
    id: 'default',
    name: 'New Project',
    width: 2000,
    height: 2000,
    layers: [
      {
        id: 'layer_default',
        name: 'Layer 1',
        visible: true,
        frames: [null], // Will be initialized by canvas
      }
    ],
    currentFrame: 0,
    fps: 18,
  },
  currentTool: Tool.BRUSH,
  currentLayer: 0,
  brushSettings: createDefaultBrushSettings(),
  onionSkinSettings: createDefaultOnionSkinSettings(),
  isPlaying: false,
  undoStack: [],
  redoStack: [],
  zoom: 1, // Start at 1:1 zoom
  panX: 0,
  panY: 0,

  setCurrentTool: (tool) => set({ currentTool: tool }),
  
  setCurrentLayer: (layerIndex) => set({ currentLayer: layerIndex }),
  
  setCurrentFrame: (frame) => set((state) => ({
    project: { ...state.project, currentFrame: frame }
  })),
  
  setBrushSettings: (settings) => set((state) => ({
    brushSettings: { ...state.brushSettings, ...settings }
  })),
  
  setOnionSkinSettings: (settings) => set((state) => ({
    onionSkinSettings: { ...state.onionSkinSettings, ...settings }
  })),
  
  togglePlay: () => set((state) => ({ isPlaying: !state.isPlaying })),
  
  addLayer: (name) => set((state) => {
    const newLayer: Layer = {
      id: `layer_${Date.now()}`,
      name,
      visible: true,
      frames: [null as any], // Will be created by canvas
    };
    return {
      project: {
        ...state.project,
        layers: [...state.project.layers, newLayer]
      }
    };
  }),
  
  removeLayer: (layerIndex) => set((state) => ({
    project: {
      ...state.project,
      layers: state.project.layers.filter((_, index) => index !== layerIndex)
    }
  })),
  
  toggleLayerVisibility: (layerIndex) => set((state) => {
    const layers = [...state.project.layers];
    layers[layerIndex] = { ...layers[layerIndex], visible: !layers[layerIndex].visible };
    return {
      project: { ...state.project, layers }
    };
  }),
  
  renameLayer: (layerIndex, name) => set((state) => {
    const layers = [...state.project.layers];
    layers[layerIndex] = { ...layers[layerIndex], name };
    return {
      project: { ...state.project, layers }
    };
  }),
  
  addFrame: () => set((state) => {
    const layers = state.project.layers.map(layer => ({
      ...layer,
      frames: [...layer.frames, null as any] // Will be created by P5 canvas
    }));
    return {
      project: { ...state.project, layers }
    };
  }),
  
  removeFrame: (frameIndex) => set((state) => {
    const layers = state.project.layers.map(layer => ({
      ...layer,
      frames: layer.frames.filter((_, index) => index !== frameIndex)
    }));
    return {
      project: { ...state.project, layers }
    };
  }),
  
  copyFrame: (fromLayer, fromFrame, toLayer, toFrame) => {
    // Implementation will depend on P5 canvas integration
  },
  
  undo: () => set((state) => {
    if (state.undoStack.length === 0) return state;
    
    const [lastAction, ...restUndo] = state.undoStack;
    // Implementation will depend on P5 canvas integration
    
    return {
      undoStack: restUndo,
      redoStack: [lastAction, ...state.redoStack.slice(0, 4)]
    };
  }),
  
  redo: () => set((state) => {
    if (state.redoStack.length === 0) return state;
    
    const [lastAction, ...restRedo] = state.redoStack;
    // Implementation will depend on P5 canvas integration
    
    return {
      redoStack: restRedo,
      undoStack: [lastAction, ...state.undoStack.slice(0, 4)]
    };
  }),
  
  addUndoAction: (action) => set((state) => ({
    undoStack: [action, ...state.undoStack.slice(0, 4)],
    redoStack: [] // Clear redo stack when new action is added
  })),

  setZoom: (zoom, mouseX, mouseY) => set((state) => {
    const newZoom = Math.max(0.1, Math.min(10, zoom));
    
    if (mouseX !== undefined && mouseY !== undefined) {
      // Zoom to cursor position
      const zoomFactor = newZoom / state.zoom;
      const newPanX = mouseX - (mouseX - state.panX) * zoomFactor;
      const newPanY = mouseY - (mouseY - state.panY) * zoomFactor;
      
      return {
        zoom: newZoom,
        panX: newPanX,
        panY: newPanY
      };
    }
    
    return { zoom: newZoom };
  }),

  setPan: (x, y) => set({ panX: x, panY: y }),
}));