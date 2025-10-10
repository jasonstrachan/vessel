
// Core type definitions for Vessel
// Based on /docs/02_System_Architecture/Data_Model.md

export type LayerAlignmentFit =
  | 'contain'
  | 'cover'
  | 'fill'
  | 'tile'
  | 'none';

export type LayerHorizontalAlignment = 'left' | 'center' | 'right';

export type LayerVerticalAlignment = 'top' | 'center' | 'bottom';

export interface LayerAlignmentOffset {
  x: number;
  y: number;
}

export interface LayerAlignmentPercentOffset {
  x: number;
  y: number;
}

export type LayerPositioningMode = 'anchor' | 'auto';

export interface LayerAlignmentSettings {
  fit: LayerAlignmentFit;
  horizontal: LayerHorizontalAlignment;
  vertical: LayerVerticalAlignment;
  positioning: LayerPositioningMode;
  offsetPx?: LayerAlignmentOffset;
  offsetPercent?: LayerAlignmentPercentOffset;
}

export interface ContentBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ExportContainerPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export type ExportContainerSizeMode = 'fill' | 'hug' | 'fixed';

export type ExportLayoutFlow = 'stack' | 'row' | 'row-reverse' | 'column' | 'column-reverse';
export type ExportLayoutAlign = 'start' | 'center' | 'end' | 'stretch';
export type ExportLayoutJustify = 'start' | 'center' | 'end' | 'space-between' | 'space-around';

export interface ExportContainerLayout {
  padding: ExportContainerPadding;
  sizeMode: ExportContainerSizeMode;
  width?: number;
  height?: number;
  flow: ExportLayoutFlow;
  wrap: boolean;
  gap: number;
  align: ExportLayoutAlign;
  justify: ExportLayoutJustify;
}

export type WebGLExportBundleFormat = 'zip' | 'single-html' | 'json';

export interface WebGLExportSettings {
  includeHiddenLayers: boolean;
  embedCanvasFallback: boolean;
  minifyOutput: boolean;
  bundleFormat: WebGLExportBundleFormat;
  enableGobletDiagnostics: boolean;
}

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
  };
  // Brush-specific settings (size, opacity, etc per brush)
  brushSpecificSettings?: Record<string, Partial<BrushSettings>>;
  // Global brush size (applies to all brushes)
  globalBrushSize?: number;
  exportLayout?: ExportContainerLayout;
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
  // Use a flexible framebuffer type for broader browser support
  framebuffer: OffscreenCanvas | HTMLCanvasElement;
  alignment: LayerAlignmentSettings;
  
  // Layer type system for supporting different rendering modes
  layerType: 'normal' | 'color-cycle'; // REQUIRED - not optional
  
  // Color cycle specific data (only present for CC layers)
  colorCycleData?: {
    // Mode selection: brush-based cycling vs recolor layer animation
    mode?: 'brush' | 'recolor';

    // Brush mode data (existing functionality)
    gradient?: Array<{ position: number; color: string }>;
    colorCycleBrush?: import('../hooks/brushEngine/ColorCycleBrushCanvas2D').ColorCycleBrushCanvas2D;
    isAnimating?: boolean;
    // Per-layer animation speed for brush-mode CC (cycles per second)
    // If undefined, UI should default to 0.1 or fall back to brush settings
    brushSpeed?: number;
    canvas?: HTMLCanvasElement;

    // Recolor mode data (new functionality)
    recolorSettings?: {
      // Quantization settings
      quantizationMode: 'rgb332' | 'oklab-median-cut';
      ditherMode: 'off' | 'bayer4' | 'bayer8';
      
      // Index buffer and palette (core performance data)
      indexBuffer?: Uint8Array;
      palette?: Uint32Array; // 256 RGBA colors as packed 32-bit values
      colorMap?: Map<number, number>; // RGB color key to palette index mapping
      
      // Animation settings
      animation: {
        speed: number; // 0.02 - 2.0x
        fps: number; // 15, 30, or 60
        ticksPerFrame: number; // Calculated from speed
        isPlaying: boolean;
        currentTick: number;
        flowDirection: 'forward' | 'reverse' | 'pingpong' | 'bounce';
      };
      
      // Gradient configuration (for the cycling effect)
      cycleColors: number; // 8-256, default 16 (visible color bands)
      gradient: Array<{ position: number; color: string }>;
      // Visual interpolation of gradient steps
      mappingMode?: 'banded' | 'continuous';

      // Flow mapping determines how the gradient phase is chosen per pixel
      // 'palette' = current behavior (by palette index)
      // 'directional' = geometric sweep using angle + wavelength
      // 'luminance' = phase from original pixel luminance
      flowMapping?: 'palette' | 'directional' | 'luminance';

      // Optional remap for palette-based flow: maps each palette index (0-255)
      // to a phase 0-255 so the gradient sequence can follow a desired direction
      // without altering the pixel index buffer structure.
      indexPhaseMap?: Uint8Array;

      // Parameters for directional mapping
      directionAngle?: number; // degrees, 0 = left->right
      bandWidthPx?: number;    // wavelength in pixels between repeating bands
      // Cached per-pixel phase map (0-255) for non-palette mappings
      phaseMap?: Uint8Array;
      
      // Performance optimization levels
      currentLOD: 'full' | 'half' | 'quarter';
      
      // Original image data (preserved for undo/reprocessing)
      originalImageData?: ImageData;
    };
  };
  
  // Version tracking for detecting content changes
  version?: number;
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
  POLYGON = 'polygon',
  CUSTOM = 'custom',
  RECTANGLE_GRADIENT = 'rectangle_gradient',
  POLYGON_GRADIENT = 'polygon_gradient',
  CONTOUR_POLYGON = 'contour_polygon',
  CONTOUR_LINES2 = 'contour_lines2',
  RISOGRAPH_SOFT = 'risograph_soft',
  RISOGRAPH_ULTRA = 'risograph_ultra',
  RESAMPLER = 'resampler',
  COLOR_CYCLE = 'color_cycle',
  COLOR_CYCLE_SHAPE = 'color_cycle_shape',
  SPAM_TEXT = 'spam_text',
  SHAPE_FILL = 'shape_fill'
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
  rotation: number;
  gridSize: number;
  showRulers: boolean;
  displayMode: 'pixelated' | 'smooth';
  canvasWidth: number;
  canvasHeight: number;
  offsetX: number;
  offsetY: number;
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
  lastRegularTool?: Tool; // Track last regular brush/eraser tool
  lastRegularBrushShape?: BrushShape; // Track last regular brush shape
  // Separate shape mode memories to avoid leakage between CC and default brushes
  lastRegularShapeMode?: boolean;
  lastColorCycleShapeMode?: boolean;
  brushSettings: BrushSettings;
  eraserSettings: BrushSettings;
  fillSettings: {
    threshold: number;
    contiguous: boolean;
  };
  shapeMode: boolean; // When true, draws closed polygon shapes with current brush
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
  keyboardScope: KeyboardScope;
}

export type KeyboardScope = 'global' | 'canvas' | 'recolor' | 'gradient' | 'modal';

export interface BrushEditorState {
  status: 'IDLE' | 'EDITING';
  editingBrushId: string | null;
  editingBounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  originalCanvasState: ImageData | null;
  hueShift: number; // -180 to 180
  lightness: number; // -100 to 100
  saturation: number; // 0 to 200 (100 is normal)
  editingBrushData?: CustomBrush | null; // Store the brush being edited
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
  // Legacy rotation toggle (kept for compatibility)
  rotationEnabled: boolean;
  // New modular rotation configuration
  rotationConfig?: {
    enabled: boolean;
    mode: 'direction' | 'fixed' | 'random';
    fixedAngle?: number;      // Degrees for fixed mode
    jitter?: number;          // 0-100% randomization
    smoothing?: number;       // 0-1 direction smoothing
    offset?: number;          // Degrees offset from direction
  };
  // Dashed brush settings
  dashedEnabled: boolean;
  dashLength: number;
  // Custom brush color mode
  useSwatchColor: boolean; // true: use swatch color, false: use brush tip colors
  dashGap: number;
  // Flow controls paint buildup (0-1, where 1 is full flow)
  flow?: number;
  // Grid snap settings
  gridSnapEnabled: boolean;
  // Shape brush settings
  shapeEnabled: boolean;
  // Hue and saturation adjustments for custom brushes
  hueShift?: number; // -180 to 180 degrees
  saturationAdjust?: number; // 0 to 200 percent
  // Color jitter for randomizing colors per brush stamp
  colorJitter: number; // 0 to 100 (0 = no jitter, 100 = full spectrum jitter)
  // Risograph texture effect settings
  risographIntensity: number; // 0 to 100 (0 = no effect, 100 = maximum dissolve effect)
  risographOutline: boolean; // true = add rough outline effect, false = clean edges (default: false)
  // Dither effect for gradients using Sierra Lite algorithm
  ditherEnabled: boolean; // true = use Sierra Lite dithering with colors palette
  ditherAlgorithm?: 'floyd-steinberg' | 'bayer' | 'sierra-lite' | 'atkinson' | 'blue-noise' | 'pattern';
  patternStyle?: 'dots' | 'lines' | 'vertical-lines' | 'horizontal-lines' | 'crosshatch' | 'diagonal';
  // Resampler brush settings
  continuousSampling?: boolean; // true = sample continuously during stroke, false = sample once at stroke start
  resampleInterval?: number; // Number of stamps between resamples (1-10), default 5
  // Current brush tip (edited in mini canvas) with brush identifier
  currentBrushTip?: {
    imageData: ImageData;
    brushId: string; // Identifies which brush this edit belongs to
    isColorizable: boolean; // Whether swatch color should be applied
    width?: number; // Actual brush width
    height?: number; // Actual brush height
  };
  // Rectangle/Polygon gradient colors count
  colors?: number; // 1-10 for gradient brushes
  // Rectangle gradient preset selection ('none' = sample from canvas)
  rectGradientPresetId?: string;
  // Fill resolution for dither block size (1-32 pixels per block)
  fillResolution?: number; // 1-32 for dithering block size
  // Contour polygon settings
  contourSpacing?: number; // 1-10 (spacing between contour lines)
  contourVariance?: number; // 0-10 (variance in spacing, 0=uniform, 10=high variance)
  contourSmoothness?: number; // 0-5 (smoothness of contour lines, 0=sharp, 5=very smooth)
  contourMaxDistance?: number; // optional max distance for contour propagation
  // Contour Lines 2 brush settings (placeholder for upcoming implementation)
  contourLines2Spacing?: number; // 1-20 (base spacing between line groups)
  contourLines2Density?: number; // 1-10 (number of sub-lines per group)
  contourLines2Alternate?: boolean; // Whether to alternate stroke offset every other line
  // Triangle fill brush settings
  triangleFillSize?: number; // 8-200 pixels (base cell size for triangle lattice)
  triangleFillJitter?: number; // 0-100% jitter applied to lattice points
  triangleFillRotation?: number; // 0-360 degrees orientation of triangle lattice
  // Hatch fill settings
  crossHatchRotation?: number; // 0-360 degrees
  crossHatchSpacing?: number; // 2-50 pixels
  crossHatchLineWidth?: number; // 1-10 pixels
  // Flow fill settings
  flowSeedSpacing?: number; // 4-80 pixels between streamline seeds
  flowStepSize?: number; // 0.5-20 pixels per integration step
  flowMaxSteps?: number; // 1-500 integration steps per streamline direction
  flowUseOrthogonal?: boolean; // true = use orthogonal gradient for flow direction
  flowFieldResolution?: number; // 2-32 pixel spacing for SDF grid sampling
  flowOrientationAngle?: number; // 0-360 degrees rotation applied to flow direction
  flowSeedJitter?: number; // 0-1 jitter applied to seed positions
  ribbonSdfStep?: number; // Grid resolution for ink ribbon SDF sampling
  ribbonSeedSpacing?: number; // Poisson spacing between ribbon anchors
  ribbonStepSize?: number; // Step length for ribbon integration
  ribbonMaxSteps?: number; // Maximum integration steps per direction
  ribbonTangentWeight?: number; // Blend between gradient tangent and global bias
  ribbonBiasAngle?: number; // Bias angle in degrees controlling global flow
  ribbonNoiseStrength?: number; // Strength of rotational noise applied to direction
  ribbonNoiseScale?: number; // Spatial scale for noise sampling
  ribbonNoiseOctaves?: number; // Number of FBM octaves for noise sampling
  ribbonLineWidth?: number; // Stroke width override for ribbons
  ribbonJitter?: number; // Seed jitter fraction for variation
  ribbonAnchorFalloff?: number; // How strongly anchors influence step size
  ribbonSeed?: number; // Deterministic seed for ribbon noise / distribution
  // Color cycle flow direction
  colorCycleFlowForward?: boolean; // true = forward flow, false = backward flow

  // Custom brush color cycle toggle
  customBrushColorCycle?: boolean; // true = cycle gradient colors per stamp for custom brushes

  // Color cycle brush settings
  colorCycleSpeed?: number; // 0.02-1.0 (brush animation speed)
  colorCycleGradient?: Array<{ position: number; color: string }>; // Gradient stops
  colorCycleFPS?: number; // 15-60 (frames per second for animation)
  colorCycleFillMode?: 'concentric' | 'linear' | 'circular'; // Fill mode for Color Cycle Shape
  // Auto-sampling for gradient while drawing (Color Cycle brushes)
  autoSampleGradient?: boolean; // When true, sample up to 5 colors across stroke/shape from canvas
  
  // Gradient bands/steps for both strokes and fills
  gradientBands?: number; // 2-50 (number of color steps in gradients)
  
  // Polygon settings
  polygonSides?: number; // 3-12 (number of sides for polygon)
  polygonDitherResolution?: number; // 1-32 (dither block size for polygon fill)
  
  // Spam brush settings
  spamFont?: string; // Font ID for spam brush text
  spamContentType?: string; // Type of spam content to use
  spamCustomText?: string; // Custom text to use instead of preset content
  // Shape gradient mode settings
  shapeGradientMode?: 'contour' | 'lines' | 'lines2' | 'mesh' | 'triangle' | 'crosshatch' | 'flow' | 'inkRibbons'; // Mode for shape gradient brushes ('mesh' kept for legacy projects)
  
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
  imageData: ImageData;  // Keep for backward compatibility
  layers: Layer[];  // Full layers state
  activeLayerId: string;  // Active layer at time of snapshot
  // Expanded to include structural layer operations captured in history
  actionType: 'brush' | 'eraser' | 'fill' | 'selection' | 'paste' | 'delete'
            | 'layer' | 'layers' | 'structure'
            | 'layer-add' | 'layer-remove' | 'layer-reorder';
  description: string;
  colorCycleState?: ColorCycleSnapshot; // Optional color cycle state
}

// Color Cycle Brush specific snapshot data
export interface ColorCycleSnapshot {
  layerId: string;
  strokeData: ArrayBuffer; // Serialized WebGL paint buffer
  gradients: Array<{
    layerIndex: number;
    gradientStops: Array<{ position: number; color: string }>;
    hasContent: boolean;
  }>;
  animationState: {
    cycleOffset: number;
    speed: number;
    fps: number;
    isPaused: boolean;
  };
  layerStrokes: Array<{
    layerId: string;
    paintBuffer: ArrayBuffer;
    hasContent: boolean;
    strokeCounter: number;
    strokeLength: number;
    gradientLayerIndices: number[];
    currentGradientIndex: number;
  }>;
}

export interface HistoryState {
  undoStack: CanvasSnapshot[];
  redoStack: CanvasSnapshot[];
  maxHistorySize: number;
  isCapturing: boolean;
}

export type Tool = 'brush' | 'eraser' | 'fill' | 'selection' | 'eyedropper' | 'zoom' | 'new-document' | 'save' | 'load' | 'export' | 'export-png' | 'custom' | 'options' | 'recolor';

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
  drawingState: 'idle' | 'drawing' | 'completed' | 'adjustingRotation' | 'adjustingSpacing' | 'adjustingSize';
  points: PolygonGradientPoint[];
  previewPath?: Path2D;
  // For cross-hatch / flow interactive adjustment
  vertices?: Array<{ x: number; y: number }>;
  fillColor?: string;
  adjustmentStartPos?: { x: number; y: number };
  tempRotation?: number;
  tempSpacing?: number;
  tempMaxSteps?: number;
  tempOrientation?: number;
  tempNoiseStrength?: number;
  gpuJobId?: string;
  spacingReferenceDistance?: number;
  spacingReferenceSpacing?: number;
  mode?: 'contour' | 'crosshatch' | 'triangle' | 'flow' | 'inkRibbons';
  rotationReferenceAngle?: number;
  rotationInitialRotation?: number;
  tempSize?: number;
  sizeReferenceDistance?: number;
  sizeInitialSize?: number;
  flowRandomSeed?: number;
}
