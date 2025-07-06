// Modular Brush Engine Type Definitions
// Following TinyBrush documentation specifications

export enum ComponentType {
  SIZE_MODIFIER = 'size',
  OPACITY_MODIFIER = 'opacity', 
  PATTERN_RENDERER = 'pattern',
  PRESSURE_HANDLER = 'pressure',
  ANTI_ALIASING = 'antialiasing',
  COLOR_BLENDING = 'blending',
  ROTATION_TRANSFORM = 'rotation',
  SPACING = 'spacing'
}

export interface BrushComponent {
  id: string;
  type: ComponentType;
  parameters: ComponentParams;
  priority: number; // Execution order (0-100)
  enabled: boolean;
}

export interface ComponentParams {
  [key: string]: any; // Component-specific parameters
}

// Size Modifier Component Parameters
export interface SizeModifierParams extends ComponentParams {
  baseSize: number; // Base brush size (1-1000px)
  pressureInfluence: number; // Pressure effect on size (0-1)
  minSize: number; // Minimum size limit
  maxSize: number; // Maximum size limit
  variationAmount: number; // Random size variation (0-1)
  variationSeed: number; // Random seed for consistency
}

// Anti-aliasing Component Parameters
export interface AntiAliasingParams extends ComponentParams {
  mode: 'pixel' | 'antialiased'; // Rendering mode
  pixelAlignment: boolean; // Snap to pixel grid
  edgeSharpness: number; // Edge sharpness control (0-1)
  subpixelPrecision: boolean; // Subpixel positioning
}

// Pressure Handler Component Parameters
export interface PressureHandlerParams extends ComponentParams {
  inputSource: 'mouse' | 'tablet'; // Input device type
  pressureCurve: number[]; // Pressure response curve
  velocityInfluence: number; // Mouse velocity to pressure (0-1)
  smoothing: number; // Pressure smoothing factor (0-1)
  minimumPressure: number; // Minimum pressure value
}

// Pattern Renderer Component Parameters
export interface PatternRendererParams extends ComponentParams {
  patternType: 'solid' | 'texture' | 'custom'; // Pattern type
  patternData: ImageData | null; // Custom pattern data
  patternScale: number; // Pattern scale factor
  patternRotation: number; // Pattern rotation angle
  patternOpacity: number; // Pattern opacity
  blendMode: string; // Pattern blend mode
}

// Opacity Modifier Component Parameters
export interface OpacityModifierParams extends ComponentParams {
  baseOpacity: number; // Base opacity (0-1)
  pressureInfluence: number; // Pressure effect on opacity (0-1)
  velocityInfluence: number; // Velocity effect on opacity (0-1)
  minimumOpacity: number; // Minimum opacity value
}

// Legacy alias for backward compatibility
export interface OpacityParams extends ComponentParams {
  baseOpacity: number;
  pressureInfluence: number;
  velocityInfluence: number;
  fadeInDuration: number;
  fadeOutDuration: number;
  minOpacity: number;
  maxOpacity: number;
  opacityJitter: number;
  buildup: boolean;
  buildupRate: number;
}

// Color Blending Component Parameters
export interface ColorBlendingParams extends ComponentParams {
  blendMode: 'normal' | 'multiply' | 'screen' | 'overlay' | 'soft-light';
  colorVariation: number; // Random color variation (0-1)
  hueShift: number; // Hue shift amount (-180 to 180)
  saturationAdjust: number; // Saturation adjustment (-1 to 1)
}

// Rotation Transform Component Parameters
export interface RotationTransformParams extends ComponentParams {
  rotationMode: 'fixed' | 'follow-stroke' | 'random' | 'pressure';
  rotationAngle: number; // Base rotation angle (0-360)
  rotationVariation: number; // Random rotation variation (0-1)
  followStrokeStrength: number; // How much to follow stroke direction (0-1)
}

// Spacing Component Parameters
export interface SpacingParams extends ComponentParams {
  defaultSpacing: number; // Default spacing for this brush preset (in pixels)
  fixedSpacing: number; // User-adjustable fixed spacing (in pixels)
  dynamicEnabled: boolean; // Enable dynamic spacing based on cursor speed
  velocityInfluence: number; // How much cursor speed affects spacing (0-1)
  minSpacing: number; // Minimum spacing value
  maxSpacing: number; // Maximum spacing value
}

// Brush Preset Definition
export interface BrushPreset {
  id: string;
  name: string;
  category: string; // Pixel Art, Digital Painting, Traditional, Custom
  components: BrushComponent[];
  thumbnail: string; // Base64 encoded thumbnail
  tags: string[]; // Search tags
  isFavorite: boolean; // Favorite status
  isDefault: boolean; // System default preset
  createdAt: Date;
  modifiedAt: Date;
}

// Stroke Input Data
export interface StrokeInput {
  x: number;
  y: number;
  pressure: number; // 0-1 pressure value
  velocity: number; // Stroke velocity
  timestamp: number; // Timestamp for timing calculations
  tiltX?: number; // Tablet tilt X (optional)
  tiltY?: number; // Tablet tilt Y (optional)
}

// Stroke Output Result
export interface StrokeResult {
  size: number; // Final calculated size
  opacity: number; // Final calculated opacity
  color: string; // Final color value
  rotation: number; // Final rotation angle
  pattern?: HTMLCanvasElement; // Rendered pattern (if applicable)
  blendMode: string; // Final blend mode
  antialiased: boolean; // Antialiasing setting
  shouldDraw: boolean; // Whether to draw this stroke point
}

// Performance Monitoring
export interface PerformanceMetrics {
  componentExecutionTime: number; // Component execution time (ms)
  totalExecutionTime: number; // Total brush execution time (ms)
  cacheHitRate: number; // Cache hit rate percentage
  memoryUsage: number; // Memory usage (bytes)
  fps: number; // Current frame rate
}

// Brush Library State
export interface BrushLibraryState {
  brushes: BrushPreset[];
  favorites: string[]; // Brush IDs
  recentBrushes: string[]; // Recently used brush IDs
  selectedBrush: string | null; // Currently selected brush ID
  searchQuery: string; // Current search query
  selectedCategory: string | null; // Selected category filter
}

// Component Cache Entry
export interface CacheEntry<T> {
  key: string;
  value: T;
  timestamp: number;
  accessCount: number;
}

// Brush Creation Configuration
export interface BrushCreationConfig {
  sourceSelection: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  layerSource: 'selected' | 'all'; // Layer inclusion mode
  autoTrim: boolean; // Remove transparent edges
  targetSize: number; // Final brush size
  centerPoint: { x: number; y: number }; // Brush center point
}