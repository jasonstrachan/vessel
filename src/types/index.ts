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
  customBrushes: CustomBrush[];
  // Canvas view state
  viewState?: {
    zoom: number;
    panX: number;
    panY: number;
  };
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
  // Optional fields for custom brushes
  isCustomBrush?: boolean;
  customBrushData?: {
    imageData: ImageData;
    width: number;
    height: number;
  };
  // Preferred settings for this brush
  preferredSettings?: Partial<BrushSettings>;
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
  ROTATION_TRANSFORM = 'rotation',
  SHAPE_RENDERER = 'shape'
}

export enum BrushShape {
  ROUND = 'round',
  PIXEL_ROUND = 'pixel_round',
  SQUARE = 'square',
  TRIANGLE = 'triangle',
  CUSTOM = 'custom',
  RECTANGLE_GRADIENT = 'rectangle_gradient',
  POLYGON_GRADIENT = 'polygon_gradient'
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


export interface CanvasState {
  zoom: number;
  panX: number;
  panY: number;
  rotation: number;
  gridSize: number;
  showRulers: boolean;
  displayMode: 'pixelated' | 'smooth';
  canvasWidth: number;
  canvasHeight: number;
  needsDimensionUpdate?: boolean;
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
    threshold: number;
    contiguous: boolean;
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
    document: boolean;
  };
  theme: 'dark' | 'light';
  notifications: Notification[];
}

export interface AutosaveState {
  isEnabled: boolean;
  isRunning: boolean;
  hasUnsavedChanges: boolean;
  lastSaveTime: Date | null;
  interval: number; // in minutes
  fileBackup: {
    enabled: boolean;
    mode: 'single-file' | 'timestamped-files';
    fileHandle: FileSystemFileHandle | null;
    directoryHandle: FileSystemDirectoryHandle | null;
    backupPath: string | null;
    lastBackupTime: Date | null;
  };
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
  brushShape?: BrushShape;
  selectedCustomBrush?: string | null;
  lastRegularBrushSize?: number;
  // Pressure sensitivity settings
  pressureEnabled: boolean;
  minPressure: number; // Percentage (1-1000)
  maxPressure?: number; // Percentage (1-1000)
  // Rotation settings
  rotationEnabled: boolean;
  // Dashed brush settings
  dashedEnabled: boolean;
  dashLength: number;
  // Custom brush color mode
  useSwatchColor: boolean; // true: use swatch color, false: use brush tip colors
  dashGap: number;
  // Grid snap settings
  gridSnapEnabled: boolean;
  // Shape brush settings
  shapeEnabled: boolean;
  // Hue and saturation adjustments for custom brushes
  hueShift?: number; // -180 to 180 degrees
  saturationAdjust?: number; // 0 to 200 percent
  // Color jitter for randomizing colors per brush stamp
  colorJitter: number; // 0 to 100 (0 = no jitter, 100 = full spectrum jitter)
  // Current brush tip (edited in mini canvas) with brush identifier
  currentBrushTip?: {
    imageData: ImageData;
    brushId: string; // Identifies which brush this edit belongs to
    isColorizable: boolean; // Whether swatch color should be applied
    width?: number; // Actual brush width
    height?: number; // Actual brush height
  };
}

export interface ComponentParams {
  [key: string]: string | number | boolean | ImageData;
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

export interface CanvasSnapshot {
  id: string;
  timestamp: number;
  imageData: ImageData;
  actionType: 'brush' | 'eraser' | 'fill' | 'selection' | 'paste';
  description: string;
}

export interface HistoryState {
  undoStack: CanvasSnapshot[];
  redoStack: CanvasSnapshot[];
  maxHistorySize: number;
  isCapturing: boolean;
}

export type Tool = 'brush' | 'eraser' | 'fill' | 'selection' | 'eyedropper' | 'zoom' | 'pan' | 'new-document' | 'save' | 'load' | 'export-png' | 'custom' | 'options';

export type BlendMode = GlobalCompositeOperation;

// Data persistence interfaces
export interface LocalStorageData {
  projects: Project[];
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

// Shape brush types
export interface ShapePoint {
  x: number;
  y: number;
}

export interface ShapeState {
  isDrawing: boolean;
  points: ShapePoint[];
  previewPath?: Path2D;
}

// Polygon gradient brush types
export interface PolygonGradientPoint {
  x: number;
  y: number;
  color: string;
}

export interface PolygonGradientState {
  drawingState: 'idle' | 'drawing' | 'completed';
  points: PolygonGradientPoint[];
  previewPath?: Path2D;
}