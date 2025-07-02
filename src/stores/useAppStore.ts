import { create } from 'zustand';
import { AppState, Tool, Layer, BrushSettings, OnionSkinSettings, UndoAction, CustomBrush } from '@/types';

interface AppStore extends AppState {
  // Zoom state
  zoom: number;
  panX: number;
  panY: number;
  
  // Selection state for brush selection tool
  isSelecting: boolean;
  selectionStart: { x: number; y: number } | null;
  selectionEnd: { x: number; y: number } | null;
  
  // Clipboard state
  clipboardData: ImageData | null;
  pastedImageData: { data: ImageData, x: number, y: number, width: number, height: number } | null;
  
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
  
  // Custom brush actions
  addCustomBrush: (brush: CustomBrush) => void;
  removeCustomBrush: (brushId: string) => void;
  setSelection: (start: { x: number; y: number } | null, end: { x: number; y: number } | null) => void;
  setIsSelecting: (selecting: boolean) => void;
  clearSelection: () => void;
  
  // Clipboard actions
  copySelection: () => void;
  cutSelection: () => void;
  pasteFromClipboard: (x: number, y: number) => void;
  setPastedImageData: (data: { data: ImageData, x: number, y: number, width: number, height: number } | null) => void;
  commitPastedImage: () => void;
}

const createDefaultBrushSettings = (): BrushSettings => ({
  color: '#000000',
  size: 1, // Default to 1px brush
  spacing: 1, // Default spacing
  opacity: 1,
  rotation: 0,
  brushShape: 'square',
  pixelPerfect: true, // Default pixel toggle ON
  gridSnap: false,
  rotateEnabled: false, // Separate rotate toggle
  selectedCustomBrush: null,
  dottedStyle: {
    enabled: false,
    spacing: 1, // Match default brush size
    dashLength: 1, // Length in brush size units (1 = 1x brush size)
    dashSpacing: 5,
    gap: 1, // Gap in brush size units (1 = 1x brush size)
  },
  pressureSettings: {
    enabled: false,
    minValue: 1,
    maxValue: 5,
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
    customBrushes: [],
  },
  currentTool: Tool.BRUSH,
  currentLayer: 0,
  brushSettings: createDefaultBrushSettings(),
  onionSkinSettings: createDefaultOnionSkinSettings(),
  isPlaying: false,
  undoStack: [],
  redoStack: [],
  zoom: 3, // Start zoomed in closer  
  panX: 0, // Will be calculated to center canvas
  panY: 0, // Will be calculated to center canvas
  
  // Selection state
  isSelecting: false,
  selectionStart: null,
  selectionEnd: null,
  
  // Clipboard state
  clipboardData: null,
  pastedImageData: null,

  setCurrentTool: (tool) => set((state) => {
    return { currentTool: tool };
  }),
  
  setCurrentLayer: (layerIndex) => set({ currentLayer: layerIndex }),
  
  setCurrentFrame: (frame) => set((state) => ({
    project: { ...state.project, currentFrame: frame }
  })),
  
  setBrushSettings: (settings) => set((state) => {
    const newBrushSettings = { ...state.brushSettings, ...settings };
    
    // Auto-adjust spacing for pixel perfect mode
    if (settings.pixelPerfect !== undefined) {
      if (settings.pixelPerfect) {
        // When enabling pixel perfect mode, set spacing to match brush size
        newBrushSettings.dottedStyle = {
          ...newBrushSettings.dottedStyle,
          spacing: newBrushSettings.size
        };
      }
    }
    
    // Grid snapping doesn't need auto-spacing logic - it works differently
    
    return { brushSettings: newBrushSettings };
  }),
  
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
    
    console.log(`🔍 ZOOM CHANGE: ${state.zoom.toFixed(2)} -> ${newZoom.toFixed(2)} ${mouseX !== undefined && mouseY !== undefined ? `at cursor(${mouseX.toFixed(1)}, ${mouseY.toFixed(1)})` : 'center'}`);
    
    if (mouseX !== undefined && mouseY !== undefined) {
      // Zoom to cursor position - maintain point under cursor
      const zoomFactor = newZoom / state.zoom;
      const newPanX = mouseX - (mouseX - state.panX) * zoomFactor;
      const newPanY = mouseY - (mouseY - state.panY) * zoomFactor;
      
      console.log(`  PAN ADJUSTMENT: (${state.panX.toFixed(1)}, ${state.panY.toFixed(1)}) -> (${newPanX.toFixed(1)}, ${newPanY.toFixed(1)})`);
      
      return {
        zoom: newZoom,
        panX: newPanX,
        panY: newPanY
      };
    }
    
    // Zoom without cursor position - keep current pan
    return { zoom: newZoom };
  }),

  setPan: (x, y) => set({ panX: x, panY: y }),

  // Custom brush actions
  addCustomBrush: (brush) => set((state) => ({
    project: {
      ...state.project,
      customBrushes: [...state.project.customBrushes, brush]
    }
  })),

  removeCustomBrush: (brushId) => set((state) => ({
    project: {
      ...state.project,
      customBrushes: state.project.customBrushes.filter(b => b.id !== brushId)
    }
  })),

  setSelection: (start, end) => set({
    selectionStart: start,
    selectionEnd: end
  }),

  setIsSelecting: (selecting) => set({ isSelecting: selecting }),
  
  clearSelection: () => set({ 
    selectionStart: null, 
    selectionEnd: null, 
    isSelecting: false 
  }),

  // Clipboard methods
  copySelection: () => {
    const state = get();
    if (!state.selectionStart || !state.selectionEnd) return;
    
    // Get the canvas element (we'll need to access P5 context)
    const canvas = document.querySelector('canvas');
    if (!canvas) return;
    
    // Calculate selection bounds
    const minX = Math.floor(Math.min(state.selectionStart.x, state.selectionEnd.x));
    const minY = Math.floor(Math.min(state.selectionStart.y, state.selectionEnd.y));
    const maxX = Math.floor(Math.max(state.selectionStart.x, state.selectionEnd.x));
    const maxY = Math.floor(Math.max(state.selectionStart.y, state.selectionEnd.y));
    const width = maxX - minX;
    const height = maxY - minY;
    
    if (width <= 0 || height <= 0) return;
    
    // Create temporary canvas to capture the selection
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = width;
    tempCanvas.height = height;
    const tempCtx = tempCanvas.getContext('2d');
    
    if (tempCtx) {
      try {
        // Capture the selected area
        tempCtx.drawImage(canvas, minX, minY, width, height, 0, 0, width, height);
        const imageData = tempCtx.getImageData(0, 0, width, height);
        set({ clipboardData: imageData });
      } catch (error) {
        console.error('Failed to copy selection:', error);
      }
    }
  },

  cutSelection: () => {
    const state = get();
    // First copy the selection
    state.copySelection();
    
    // Then clear the selected area (we'll implement this when we integrate with canvas)
    // For now, just copy the selection
  },

  pasteFromClipboard: (x, y) => {
    const state = get();
    if (!state.clipboardData) return;
    
    set({
      pastedImageData: {
        data: state.clipboardData,
        x,
        y,
        width: state.clipboardData.width,
        height: state.clipboardData.height
      }
    });
  },

  setPastedImageData: (data) => set({ pastedImageData: data }),

  commitPastedImage: () => {
    const state = get();
    if (!state.pastedImageData) return;
    
    // Store the pasted image data for the canvas to process
    (window as any).pastedImageToCommit = {
      imageData: state.pastedImageData.data,
      x: state.pastedImageData.x,
      y: state.pastedImageData.y,
      width: state.pastedImageData.width,
      height: state.pastedImageData.height
    };
    
    // Clear the pasted image preview
    set({ pastedImageData: null });
    
    // Show success notification
    const toastContainer = document.querySelector('.toast-container');
    if (toastContainer) {
      const toast = document.createElement('div');
      toast.className = 'toast toast-success';
      toast.innerHTML = '✅ Image pasted successfully!';
      toastContainer.appendChild(toast);
      
      // Remove toast after 3 seconds
      setTimeout(() => {
        toast.remove();
      }, 3000);
    }
  },
}));