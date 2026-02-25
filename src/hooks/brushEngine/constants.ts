/**
 * Constants extracted from useBrushEngine
 * Centralized configuration values
 */

/**
 * Brush base sizes for different tools
 */
export const BRUSH_BASE_SIZES = {
  pixel: 1,
  small: 4,
  medium: 8,
  large: 16,
  xlarge: 32,
  xxlarge: 64
};

/**
 * Extended dithering palette with various browns and colors
 */
export const DITHER_PALETTE: [number, number, number][] = [
  [0, 0, 0],          // Black
  [255, 255, 255],    // White
  [128, 128, 128],    // Medium Grey
  [192, 192, 192],    // Light Grey
  [64, 64, 64],       // Dark Grey
  [139, 69, 19],      // Saddle Brown
  [160, 82, 45],      // Sienna
  [205, 133, 63],     // Peru
  [210, 180, 140],    // Tan
  [222, 184, 135],    // Burlywood
  [245, 222, 179],    // Wheat
  [255, 228, 196],    // Bisque
  [101, 67, 33],      // Dark Brown
  [128, 70, 27],      // Russet
  [92, 51, 23],       // Dark Coffee
  [188, 143, 143],    // Rosy Brown
  [244, 164, 96],     // Sandy Brown
  [255, 218, 185],    // Peach Puff
  [250, 235, 215],    // Antique White
  [245, 245, 220],    // Beige
  // Apple II colors
  [255, 68, 253],     // A2 Magenta
  [20, 7, 253],       // A2 Dark Blue
  [255, 106, 60],     // A2 Purple
  [20, 245, 60],      // A2 Dark Green
  [20, 207, 253],     // A2 Medium Blue
  [208, 195, 255],    // A2 Light Blue
  [96, 78, 189],      // A2 Brown
  [255, 106, 60],     // A2 Orange
  [156, 156, 156],    // A2 Light Gray
  [255, 160, 208],    // A2 Pink
  [208, 221, 141],    // A2 Green
  [191, 204, 128],    // A2 Yellow
  [141, 217, 191],    // A2 Aqua
];

/**
 * Color names for debugging/logging
 */
export const DITHER_COLOR_NAMES = [
  'Black', 'White', 'Medium Grey', 'Light Grey', 'Dark Grey',
  'Saddle Brown', 'Sienna', 'Peru', 'Tan', 'Burlywood', 'Wheat', 'Bisque',
  'Dark Brown', 'Russet', 'Dark Coffee',
  'Rosy Brown', 'Sandy Brown', 'Peach Puff', 'Antique White', 'Beige',
  'A2 Magenta', 'A2 Dark Blue', 'A2 Purple', 'A2 Dark Green',
  'A2 Medium Blue', 'A2 Light Blue', 'A2 Brown', 'A2 Orange',
  'A2 Light Gray', 'A2 Pink', 'A2 Green', 'A2 Yellow', 'A2 Aqua'
];

/**
 * Authentic Apple II Hi-Res color palette (NTSC composite output)
 */
export const AUTHENTIC_APPLE_II_PALETTE: [number, number, number][] = [
  [0, 0, 0],         // Black
  [114, 38, 64],     // Dark Red/Magenta
  [64, 51, 127],     // Dark Blue
  [228, 52, 254],    // Purple
  [14, 89, 64],      // Dark Green
  [128, 128, 128],   // Gray 1
  [27, 154, 254],    // Medium Blue
  [191, 179, 255],   // Light Blue
  [64, 76, 0],       // Brown
  [228, 101, 1],     // Orange
  [128, 128, 128],   // Gray 2
  [241, 166, 191],   // Pink
  [27, 203, 1],      // Light Green
  [191, 204, 128],   // Yellow
  [141, 217, 191],   // Aqua
  [255, 255, 255]    // White
];

/**
 * Performance constants
 */
export const PERFORMANCE = {
  // Brush stamp cache
  MAX_STAMP_CACHE_SIZE: 100,
  
  // Stroke processing
  MIN_DISTANCE_FOR_DIRECTION: 1.5, // Minimum pixels to calculate direction
  DIRECTION_HISTORY_SIZE: 7,       // Number of direction samples to smooth
  VELOCITY_HISTORY_SIZE: 5,        // Number of velocity samples to smooth
  
  // Jitter settings
  JITTER_RECALC_FREQUENCY: 5,      // Recalculate jitter every N points
  
  // Dithering
  DITHER_SAMPLE_STEP: 1000,        // Sample every Nth pixel for palette selection
  
  // Pattern rendering
  PATTERN_CANVAS_SIZE: 512,        // Size for pattern generation canvas
  
  // GPU/WebGL
  MAX_TEXTURE_SIZE: 4096,          // Maximum texture dimension
};

/**
 * Default brush settings
 */
export const DEFAULT_BRUSH = {
  size: 8,
  opacity: 100,
  spacing: 0.1,
  pressureEnabled: false,
  minPressure: 0.1,
  maxPressure: 1.0,
  smoothing: 0,
  jitter: 0,
};

/**
 * Shape tool constants
 */
export const SHAPE_TOOLS = {
  MIN_SHAPE_SIZE: 2,               // Minimum pixels for a shape
  ELLIPSE_SEGMENTS: 64,            // Number of segments for ellipse approximation
  POLYGON_DEFAULT_SIDES: 5,        // Default polygon sides
  STAR_DEFAULT_POINTS: 5,          // Default star points
};

/**
 * Pixel-perfect circle patterns for sizes 1-8
 */
export const PIXEL_CIRCLE_PATTERNS: Record<number, Array<{x: number, y: number}>> = {
  1: [{x: 0, y: 0}],
  2: [{x: 0, y: 0}, {x: 1, y: 0}, {x: 0, y: 1}, {x: 1, y: 1}],
  3: [{x: 0, y: 1}, {x: 1, y: 0}, {x: 1, y: 1}, {x: 1, y: 2}, {x: 2, y: 1}],
  4: [
    {x: 0, y: 1}, {x: 0, y: 2},
    {x: 1, y: 0}, {x: 1, y: 1}, {x: 1, y: 2}, {x: 1, y: 3},
    {x: 2, y: 0}, {x: 2, y: 1}, {x: 2, y: 2}, {x: 2, y: 3},
    {x: 3, y: 1}, {x: 3, y: 2}
  ],
  5: [
    {x: 0, y: 2},
    {x: 1, y: 1}, {x: 1, y: 2}, {x: 1, y: 3},
    {x: 2, y: 0}, {x: 2, y: 1}, {x: 2, y: 2}, {x: 2, y: 3}, {x: 2, y: 4},
    {x: 3, y: 1}, {x: 3, y: 2}, {x: 3, y: 3},
    {x: 4, y: 2}
  ],
  6: [
    {x: 0, y: 2}, {x: 0, y: 3},
    {x: 1, y: 1}, {x: 1, y: 2}, {x: 1, y: 3}, {x: 1, y: 4},
    {x: 2, y: 0}, {x: 2, y: 1}, {x: 2, y: 2}, {x: 2, y: 3}, {x: 2, y: 4}, {x: 2, y: 5},
    {x: 3, y: 0}, {x: 3, y: 1}, {x: 3, y: 2}, {x: 3, y: 3}, {x: 3, y: 4}, {x: 3, y: 5},
    {x: 4, y: 1}, {x: 4, y: 2}, {x: 4, y: 3}, {x: 4, y: 4},
    {x: 5, y: 2}, {x: 5, y: 3}
  ],
  7: [
    {x: 0, y: 2}, {x: 0, y: 3}, {x: 0, y: 4},
    {x: 1, y: 1}, {x: 1, y: 2}, {x: 1, y: 3}, {x: 1, y: 4}, {x: 1, y: 5},
    {x: 2, y: 0}, {x: 2, y: 1}, {x: 2, y: 2}, {x: 2, y: 3}, {x: 2, y: 4}, {x: 2, y: 5}, {x: 2, y: 6},
    {x: 3, y: 0}, {x: 3, y: 1}, {x: 3, y: 2}, {x: 3, y: 3}, {x: 3, y: 4}, {x: 3, y: 5}, {x: 3, y: 6},
    {x: 4, y: 0}, {x: 4, y: 1}, {x: 4, y: 2}, {x: 4, y: 3}, {x: 4, y: 4}, {x: 4, y: 5}, {x: 4, y: 6},
    {x: 5, y: 1}, {x: 5, y: 2}, {x: 5, y: 3}, {x: 5, y: 4}, {x: 5, y: 5},
    {x: 6, y: 2}, {x: 6, y: 3}, {x: 6, y: 4}
  ],
  8: [
    {x: 0, y: 2}, {x: 0, y: 3}, {x: 0, y: 4}, {x: 0, y: 5},
    {x: 1, y: 1}, {x: 1, y: 2}, {x: 1, y: 3}, {x: 1, y: 4}, {x: 1, y: 5}, {x: 1, y: 6},
    {x: 2, y: 0}, {x: 2, y: 1}, {x: 2, y: 2}, {x: 2, y: 3}, {x: 2, y: 4}, {x: 2, y: 5}, {x: 2, y: 6}, {x: 2, y: 7},
    {x: 3, y: 0}, {x: 3, y: 1}, {x: 3, y: 2}, {x: 3, y: 3}, {x: 3, y: 4}, {x: 3, y: 5}, {x: 3, y: 6}, {x: 3, y: 7},
    {x: 4, y: 0}, {x: 4, y: 1}, {x: 4, y: 2}, {x: 4, y: 3}, {x: 4, y: 4}, {x: 4, y: 5}, {x: 4, y: 6}, {x: 4, y: 7},
    {x: 5, y: 0}, {x: 5, y: 1}, {x: 5, y: 2}, {x: 5, y: 3}, {x: 5, y: 4}, {x: 5, y: 5}, {x: 5, y: 6}, {x: 5, y: 7},
    {x: 6, y: 1}, {x: 6, y: 2}, {x: 6, y: 3}, {x: 6, y: 4}, {x: 6, y: 5}, {x: 6, y: 6},
    {x: 7, y: 2}, {x: 7, y: 3}, {x: 7, y: 4}, {x: 7, y: 5}
  ]
};