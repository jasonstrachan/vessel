// Core type definitions for TinyBrush
// Based on /docs/02_System_Architecture/Data_Model.md

export interface Project {
  id: string;
  name: string;
  width: number;
  height: number;
  layers: Layer[];
  backgroundColor: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  blendMode: BlendMode;
  locked: boolean;
  order: number;
  imageData: ImageData | null;
  framebuffer: OffscreenCanvas;
}

export interface BrushPreset {
  id: string;
  name: string;
  category: string;
  components: BrushComponent[];
  thumbnail: string;
  tags: string[];
  isDefault: boolean;
  createdAt: Date;
  modifiedAt: Date;
}

export interface BrushComponent {
  id: string;
  type: ComponentType;
  parameters: ComponentParams;
  priority: number;
  enabled: boolean;
}

export enum ComponentType {
  SIZE_MODIFIER = 'size',
  OPACITY_MODIFIER = 'opacity',
  PATTERN_RENDERER = 'pattern',
  SPACING_CONTROLLER = 'spacing',
  PRESSURE_HANDLER = 'pressure',
  ANTI_ALIASING = 'antialiasing',
  COLOR_BLENDING = 'blending',
  ROTATION_TRANSFORM = 'rotation'
}

export interface CustomBrush {
  id: string;
  name: string;
  pattern: ImageData;
  thumbnail: string;
  settings: BrushSettings;
  createdAt: Date;
  isDefault: boolean;
  tags: string[];
}

export interface CanvasState {
  zoom: number;
  panX: number;
  panY: number;
  rotation: number;
  showGrid: boolean;
  gridSize: number;
  showRulers: boolean;
  selection: {
    active: boolean;
    bounds: Rectangle;
    pixels: ImageData;
  };
  cursor: {
    x: number;
    y: number;
    pressure: number;
  };
}

export interface ToolState {
  currentTool: Tool;
  previousTool: Tool;
  brushSettings: BrushSettings;
  eraserSettings: BrushSettings;
  fillSettings: {
    tolerance: number;
    contiguous: boolean;
    allLayers: boolean;
  };
}

export interface UIState {
  panels: {
    leftToolbar: boolean;
    rightToolbar: boolean;
    timeline: boolean;
    layerPanel: boolean;
    brushPanel: boolean;
  };
  modals: {
    export: boolean;
    settings: boolean;
    help: boolean;
  };
  theme: 'dark' | 'light';
  notifications: Notification[];
}

export interface DerivedState {
  canvasToScreenRatio: number;
  visibleCanvasBounds: Rectangle;
  visibleLayers: Layer[];
  activeLayer: Layer;
  layerCount: number;
  effectiveBrushSize: number;
  toolCursor: string;
}

// Helper interfaces and types
export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrushSettings {
  size: number;
  opacity: number;
  color: string;
  blendMode: BlendMode;
  spacing: number;
  pressure: number;
  rotation: number;
  antialiasing: boolean;
}

export interface ComponentParams {
  [key: string]: string | number | boolean;
}

export interface Notification {
  id: string;
  type: 'info' | 'warning' | 'error' | 'success';
  title: string;
  message: string;
  timestamp: Date;
  duration?: number;
}

export interface DrawingAction {
  id: string;
  type: 'brush' | 'eraser' | 'fill' | 'selection';
  layerId: string;
  timestamp: Date;
  data: Record<string, unknown>;
}

export type Tool = 'brush' | 'eraser' | 'fill' | 'selection' | 'eyedropper' | 'zoom' | 'pan';

export type BlendMode = GlobalCompositeOperation;

// Data persistence interfaces
export interface LocalStorageData {
  projects: Project[];
  customBrushes: CustomBrush[];
  userPreferences: {
    theme: string;
    defaultBrushSettings: BrushSettings;
    keyboardShortcuts: Record<string, string>;
    autoSave: boolean;
    autoSaveInterval: number;
  };
  recentFiles: {
    path: string;
    name: string;
    timestamp: Date;
  }[];
}

export interface SessionStorageData {
  currentProject: Project;
  undoHistory: DrawingAction[];
  clipboardData: {
    type: 'image' | 'layer';
    data: ImageData;
    timestamp: Date;
  };
  temporaryCanvases: {
    [key: string]: HTMLCanvasElement;
  };
}

export interface PNGExport {
  format: 'png';
  quality: number;
  includeBackground: boolean;
  layers: string[];
  scale: number;
}