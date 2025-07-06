import p5 from 'p5';

// Import new modular brush system
export * from './brush';

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  frames: (p5.Framebuffer | null)[];
}

export interface Project {
  id: string;
  name: string;
  width: number;
  height: number;
  layers: Layer[];
  currentFrame: number;
  fps: number;
  customBrushes: CustomBrush[];
}

export interface CustomBrush {
  id: string;
  name: string;
  imageData: ImageData;
  thumbnail: string; // Base64 encoded thumbnail
  width: number;
  height: number;
  createdAt: number;
}

export interface BrushSettings {
  color: string;
  size: number;
  opacity: number;
  rotation: number;
  brushShape: 'square' | 'circle' | 'custom' | 'flowfield';
  pixelPerfect: boolean;
  gridSnap: boolean;
  rotateEnabled: boolean; // Separate rotate toggle
  selectedCustomBrush: string | null; // ID of selected custom brush
  spacing: {
    value: number; // Fixed spacing value (in pixels)
    dynamicEnabled: boolean; // Enable dynamic spacing based on cursor speed
    defaultValue: number; // Default spacing for current brush preset
  };
  dottedStyle: {
    enabled: boolean;
    dashLength: number;
    dashSpacing: number;
    gap: number;
  };
  pressureSettings: {
    enabled: boolean;
    minValue: number;
    maxValue: number;
  };
}

export interface OnionSkinSettings {
  enabled: boolean;
  framesBefore: number;
  framesAfter: number;
  opacity: number;
}

export enum Tool {
  SELECT = 'select',      // V key - Selection tool
  BRUSH = 'brush',        // B key - Brush tool  
  CUSTOM_BRUSH = 'custom_brush', // U key - Custom Brush tool
  FILL = 'fill',          // G key - Fill tool
  ERASER = 'eraser',      // E key - Eraser tool
  BRUSH_SELECT = 'brush_select', // Legacy - will be removed
  CLEAR = 'clear',        // Clear tool
}

export interface UndoAction {
  layerId: string;
  frameIndex: number;
  framebuffer: p5.Framebuffer;
}

export interface AppState {
  project: Project;
  currentTool: Tool;
  currentLayer: number;
  brushSettings: BrushSettings; // Legacy - maintained for compatibility
  onionSkinSettings: OnionSkinSettings;
  isPlaying: boolean;
  undoStack: UndoAction[];
  redoStack: UndoAction[];
  
  // New modular brush system
  brushLibrary?: import('./brush').BrushLibraryState; // Optional - will be populated during migration
  selectedBrushPreset?: string; // ID of currently selected modular brush
}