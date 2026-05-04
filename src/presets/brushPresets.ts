import { BrushPreset, BrushComponent, ComponentType, BrushSettings, BrushShape } from '../types';
import { DEFAULT_GRADIENT_STOPS } from '@/utils/gradientPresets';

export type BrushCapabilities = {
  canDither?: boolean;
  forceDither?: boolean;
};

// Brush capability flags keyed by canonical preset id
export const BRUSH_PRESET_CAPABILITIES: Record<string, BrushCapabilities> = {
  'dither-stroke': { canDither: true, forceDither: true },
  'dither-shape': { canDither: true, forceDither: true },
  'checkered': { canDither: false },
  'color-cycle-stroke': { canDither: false },
  'color-cycle-shape': { canDither: false },
  'color-cycle-triangle': { canDither: false },
  'color-cycle-gradient': { canDither: false },
  'shape-fill': { canDither: false },
};

export const getPresetCapabilities = (
  id: string,
  preset?: Partial<{ capabilities?: BrushCapabilities }>
): BrushCapabilities => {
  const base = BRUSH_PRESET_CAPABILITIES[id] || {};
  const fromPreset = preset?.capabilities || {};
  return {
    canDither: fromPreset.canDither ?? base.canDither,
    forceDither: fromPreset.forceDither ?? base.forceDither,
  };
};

// Default brush settings for pixel-perfect drawing
export const pixelBrushSettings: BrushSettings = {
  size: 1,
  customBrushSizePercent: 100,
  opacity: 1,
  color: '#000000',
  blendMode: 'source-over',
  spacing: 1,
  pressure: 1,
  rotation: 0,
  antialiasing: false,
  pressureEnabled: false,
  minPressure: 0,   // Maintain 1px at light pressure (0% under base)
  maxPressure: 200,   // Grow to 3px at firm pressure (200% over base)
  rotationEnabled: false,
  rotationConfig: {
    enabled: false,
    mode: 'direction' as const,
    smoothing: 0.5,
    jitter: 0,
    offset: 0
  },
  dashedEnabled: false,
  dashLength: 3,
  velocitySpacingEnabled: false,
  velocityAnimationSpeedEnabled: false,
  velocityDashGapEnabled: false,
  velocityDashGapStrength: 1,
  dashGap: 2,
  gridSnapEnabled: false,
  gridSnapSize: 16,
  roundedCornersEnabled: false,
  cornerRadiusPx: 8,
  shapeEnabled: false,
  useSwatchColor: false,
  hueShift: 0,
  lightnessAdjust: 0,
  saturationAdjust: 100,
  colorJitter: 0,
  risographIntensity: 0,
  risographOutline: false,
  risographColorShift: 3,
  ditherEnabled: false,
  ditherPhaseJitter: 0,
  ditherPatternDiversity: 100,
  ditherStrokeTipShape: 'round',
  pressureLinkedFillResolution: false,
  pressureDitherSmoosh: false,
  ditherBackgroundFill: true,
  ditherGradBgFill: true,
  ditherGradSampleEnabled: false,
  lostEdge: 0,
  pxlEdge: false,
  colorCycleStampDitherEnabled: false,
  colorCycleStampDitherPixelSize: 1,
  colorCycleStampDitherBgFill: true,
  colorCycleStampDitherClears: false,
  colorCycleStampDitherPressureLinked: false,
  colorCycleStampShape: 'square',
  colorCycleUseForegroundGradient: false,
  colorCycleFgLightness: 50,
  colorCycleFgVariance: 0,
  colorCycleFgHueShift: 0,
  colorCycleFgSaturationShift: 0,
  colorCycleFgOpacity: 100,
  colorCycleFgStops: 2,
  contourLines2Spacing: 4,
  contourLines2Density: 4,
  contourLines2Alternate: false,
  customBrushColorCycle: false,
  customBrushCcPhaseMode: 'global',
  customBrushCcPhaseJitter: 0,
  colorCycleFlowMode: 'forward',
  colorCycleFillMode: 'concentric',
  colorCycleBandSpacingPx: 12,
  triangleFillSize: 36,
  triangleFillJitter: 35,
  triangleFillRotation: 0,
  mosaicTilePx: 8,
  mosaicBlocksCount: 6,
  mosaicPaletteCount: 8,
  mosaicSegmentPx: 160,
  mosaicSegmentJitter: 0,
  mosaicDitherEnabled: false,
  flowSeedSpacing: 18,
  flowStepSize: 4,
  flowMaxSteps: 120,
  flowUseOrthogonal: false,
  flowFieldResolution: 8,
  ribbonSdfStep: 8,
  ribbonSeedSpacing: 18,
  ribbonStepSize: 1.7,
  ribbonMaxSteps: 370,
  ribbonTangentWeight: 0.6,
  ribbonBiasAngle: 80,
  ribbonNoiseStrength: 0.45,
  ribbonNoiseScale: 220,
  ribbonNoiseOctaves: 3,
  ribbonLineWidth: 1.6,
  ribbonJitter: 0.25,
  ribbonAnchorFalloff: 0.3,
  ribbonSeed: 2025
};

// Default brush settings for smooth drawing
export const defaultBrushSettings: BrushSettings = {
  size: 100,
  customBrushSizePercent: 100,
  customBrushSnapEnabled: false,
  opacity: 1,
  color: '#000000',
  blendMode: 'source-over',
  spacing: 1,
  pressure: 1,
  rotation: 0,
  antialiasing: false,
  brushShape: BrushShape.SQUARE,
  lastRegularBrushSize: 100,
  pressureEnabled: false,
  minPressure: 99,
  maxPressure: undefined,
  rotationEnabled: false,
  rotationConfig: {
    enabled: false,
    mode: 'direction' as const,
    smoothing: 0.5,
    jitter: 0,
    offset: 0
  },
  dashedEnabled: false,
  dashLength: 3,
  velocitySpacingEnabled: false,
  velocityAnimationSpeedEnabled: false,
  velocityDashGapEnabled: false,
  velocityDashGapStrength: 1,
  dashGap: 2,
  gridSnapEnabled: false,
  gridSnapSize: 16,
  shapeEnabled: false,
  useSwatchColor: false,
  hueShift: 0,
  lightnessAdjust: 0,
  saturationAdjust: 100,
  colorJitter: 0,
  risographIntensity: 0,
  risographOutline: false, // Default: no rough outline effect
  risographColorShift: 3,
  ditherEnabled: false,
  ditherPhaseJitter: 0,
  ditherPaletteSpread: 0,
  ditherPatternDiversity: 100,
  ditherStrokeTipShape: 'round',
  pressureLinkedFillResolution: false,
  pressureDitherSmoosh: false,
  ditherBackgroundFill: true,
  ditherGradBgFill: true,
  ditherGradSampleEnabled: false,
  pigmentLiftEnabled: false,
  pigmentLiftStrength: 0.6,
  pigmentLiftFeather: 1,
  pigmentLiftNoise: 0.35,
  lostEdge: 0,
  pxlEdge: false,
  colorCycleStampDitherEnabled: false,
  colorCycleStampDitherPixelSize: 1,
  colorCycleStampDitherBgFill: true,
  colorCycleStampDitherClears: false,
  colorCycleStampDitherPressureLinked: false,
  customBrushColorCycle: false,
  customBrushCcPhaseMode: 'global',
  customBrushCcPhaseJitter: 0,
  autoSampleColor: false,
  // Auto-sample gradient for color cycle brushes (off by default)
  autoSampleGradient: false,
  autoSampleGradientRealtime: false,
  colorCycleGradientVersion: 0,
  gradientLength: 100,
  fillResolution: 1,
  colors: 2, // Default to 2 colors for rectangle and polygon gradient brushes
  rectGradientPresetId: 'none', // Default: sample from canvas for rectangle gradient
  polygonSampleColors: true,
  mosaicTilePx: 8,
  mosaicBlocksCount: 6,
  mosaicPaletteCount: 8,
  mosaicSegmentPx: 160,
  mosaicSegmentJitter: 0,
  mosaicDitherEnabled: false,
  contourSpacing: 4, // Default contour spacing (1-10)
  contourVariance: 5, // Default contour variance (0-10, medium variance)
  contourSmoothness: 0.5, // Default contour smoothness (0-5, low smoothness)
  contourLines2Spacing: 4, // Default base spacing for Lines2 brush
  contourLines2Density: 4, // Default line bundle density
  contourLines2Alternate: false, // Default to uniform direction
  colorCycleFlowMode: 'forward',
  colorCycleLayerSpeedScale: 1,
  colorCycleFillMode: 'concentric', // Default to concentric fill for Color Cycle Shape
  colorCycleBandSpacingPx: 12,
  colorCycleUseForegroundGradient: false,
  colorCycleFgLightness: 50,
  colorCycleFgVariance: 0,
  colorCycleFgHueShift: 0,
  colorCycleFgSaturationShift: 0,
  colorCycleFgStops: 2,
  shapeGradientMode: 'contour', // Default to contour mode for shape gradient brushes
  triangleFillSize: 36,
  triangleFillJitter: 35,
  triangleFillRotation: 0,
  flowSeedSpacing: 18,
  flowStepSize: 4,
  flowMaxSteps: 120,
  flowUseOrthogonal: false,
  flowFieldResolution: 8,
  ribbonSdfStep: 8,
  ribbonSeedSpacing: 18,
  ribbonStepSize: 1.7,
  ribbonMaxSteps: 370,
  ribbonTangentWeight: 0.6,
  ribbonBiasAngle: 80,
  ribbonNoiseStrength: 0.45,
  ribbonNoiseScale: 220,
  ribbonNoiseOctaves: 3,
  ribbonLineWidth: 1.6,
  ribbonJitter: 0.25,
  ribbonAnchorFalloff: 0.3,
  ribbonSeed: 2025
};

// Components for pixel brush - 1px, hard edges, pixel perfect
export const pixelBrushComponents: BrushComponent[] = [
  {
    id: 'pixel-size',
    type: ComponentType.SIZE_MODIFIER,
    parameters: {
      minSize: 1,
      maxSize: 1000,
      pressureInfluence: 0
    },
    priority: 10,
    enabled: true
  },
  {
    id: 'pixel-opacity',
    type: ComponentType.OPACITY_MODIFIER,
    parameters: {
      pressureInfluence: 0
    },
    priority: 20,
    enabled: true
  },
  {
    id: 'pixel-antialiasing',
    type: ComponentType.ANTI_ALIASING,
    parameters: {
      mode: 'pixel'
    },
    priority: 30,
    enabled: true
  },
  {
    id: 'pixel-shape',
    type: ComponentType.SHAPE_RENDERER,
    parameters: {
      shape: BrushShape.SQUARE
    },
    priority: 40,
    enabled: true
  }
];

// Pixel brush preset
export const pixelBrushPreset: BrushPreset = {
  id: 'pixel-square',
  name: 'Pixel Square',
  category: 'Pixel Art',
  components: pixelBrushComponents,
  thumbnail: '/assets/images/Brush.png',
  tags: ['pixel', 'hard', '1px', 'pixel-art'],
  isDefault: true,
  createdAt: new Date(),
  modifiedAt: new Date(),
  preferredSettings: {
    size: 1,
    antialiasing: false,
    pressureEnabled: false,
    minPressure: 0,
    maxPressure: 200,
    rotationEnabled: false,
    dashedEnabled: false,
    gridSnapEnabled: false,
    shapeEnabled: false
    // Removed opacity, spacing, colorJitter - these are user preferences, not brush technical requirements
  }
};

// Default brush components for smooth drawing
export const defaultBrushComponents: BrushComponent[] = [
  {
    id: 'default-size',
    type: ComponentType.SIZE_MODIFIER,
    parameters: {
      minSize: 1,
      maxSize: 1000,
      pressureInfluence: 0.5
    },
    priority: 10,
    enabled: true
  },
  {
    id: 'default-opacity',
    type: ComponentType.OPACITY_MODIFIER,
    parameters: {
      pressureInfluence: 0.2
    },
    priority: 20,
    enabled: true
  },
  {
    id: 'default-antialiasing',
    type: ComponentType.ANTI_ALIASING,
    parameters: {
      mode: 'antialiased'
    },
    priority: 30,
    enabled: true
  },
  {
    id: 'default-shape',
    type: ComponentType.SHAPE_RENDERER,
    parameters: {
      shape: BrushShape.ROUND
    },
    priority: 40,
    enabled: true
  },
  {
    id: 'default-rotation',
    type: ComponentType.ROTATION_TRANSFORM,
    parameters: {
      enableRotation: true
    },
    priority: 50,
    enabled: true
  }
];

// Default brush preset
export const defaultBrushPreset: BrushPreset = {
  id: 'soft-round',
  name: 'Soft Round',
  category: 'Digital Painting',
  components: defaultBrushComponents,
  thumbnail: '/assets/images/Brush.png',
  tags: ['default', 'smooth', 'digital-painting'],
  isDefault: true,
  createdAt: new Date(),
  modifiedAt: new Date(),
  preferredSettings: {
    size: 5,
    antialiasing: true,
    pressureEnabled: false,
    rotationEnabled: false,
    dashedEnabled: false,
    gridSnapEnabled: false,
    shapeEnabled: false
    // Removed opacity, spacing, colorJitter - these are user preferences, not brush technical requirements
  }
};

// Mosaic brush components (stamp along path)
export const mosaicBrushComponents: BrushComponent[] = [
  {
    id: 'mosaic-size',
    type: ComponentType.SIZE_MODIFIER,
    parameters: {
      minSize: 1,
      maxSize: 1000,
      pressureInfluence: 0.5
    },
    priority: 10,
    enabled: true
  },
  {
    id: 'mosaic-opacity',
    type: ComponentType.OPACITY_MODIFIER,
    parameters: {
      pressureInfluence: 0.2
    },
    priority: 20,
    enabled: true
  },
  {
    id: 'mosaic-antialiasing',
    type: ComponentType.ANTI_ALIASING,
    parameters: {
      mode: 'pixel'
    },
    priority: 30,
    enabled: true
  },
  {
    id: 'mosaic-shape',
    type: ComponentType.SHAPE_RENDERER,
    parameters: {
      shape: BrushShape.MOSAIC
    },
    priority: 40,
    enabled: true
  },
  {
    id: 'mosaic-rotation',
    type: ComponentType.ROTATION_TRANSFORM,
    parameters: {
      enableRotation: true
    },
    priority: 50,
    enabled: true
  }
];

// Mosaic brush preset
export const mosaicBrushPreset: BrushPreset = {
  id: 'mosaic',
  name: 'Mosaic',
  category: 'Digital Painting',
  components: mosaicBrushComponents,
  thumbnail: '/assets/images/Brush.png',
  tags: ['mosaic', 'stamp', 'tiles'],
  isDefault: false,
  createdAt: new Date(),
  modifiedAt: new Date(),
  preferredSettings: {
    size: 60,
    antialiasing: false,
    pressureEnabled: true,
    minPressure: 50,
    maxPressure: 150,
    rotationEnabled: false,
    dashedEnabled: false,
    gridSnapEnabled: false,
    shapeEnabled: false,
    mosaicTilePx: 8,
    mosaicBlocksCount: 6,
    mosaicPaletteCount: 8,
    mosaicSegmentPx: 160,
    mosaicSegmentJitter: 0,
    mosaicDitherEnabled: false
  }
};


// Pixel Round Brush Components
export const roundPixel4Components: BrushComponent[] = [
  {
    id: 'pixel-round-size',
    type: ComponentType.SIZE_MODIFIER,
    parameters: {
      minSize: 1,
      maxSize: 1000,
      pressureInfluence: 0
    },
    priority: 10,
    enabled: true
  },
  {
    id: 'pixel-round-opacity',
    type: ComponentType.OPACITY_MODIFIER,
    parameters: {
      pressureInfluence: 0
    },
    priority: 20,
    enabled: true
  },
  {
    id: 'pixel-round-antialiasing',
    type: ComponentType.ANTI_ALIASING,
    parameters: {
      mode: 'pixel'
    },
    priority: 30,
    enabled: true
  },
  {
    id: 'pixel-round-shape',
    type: ComponentType.SHAPE_RENDERER,
    parameters: {
      shape: BrushShape.PIXEL_ROUND
    },
    priority: 40,
    enabled: true
  }
];

// Pixel Round Brush Preset
export const roundPixel4Preset: BrushPreset = {
  id: 'pixel-round',
  name: 'Pixel Round',
  category: 'Pixel Art',
  components: roundPixel4Components,
  thumbnail: '/assets/images/Brush.png',
  tags: ['pixel', 'round', '4px', 'hard'],
  isDefault: false,
  createdAt: new Date(),
  modifiedAt: new Date(),
  preferredSettings: {
    size: 4,
    antialiasing: false,
    pressureEnabled: false,
    minPressure: 0,
    maxPressure: 200,
    rotationEnabled: false,
    dashedEnabled: false,
    gridSnapEnabled: false,
    shapeEnabled: false
  }
};

// 6px Round Square Brush Components
export const roundSquare6Components: BrushComponent[] = [
  {
    id: 'soft-square-size',
    type: ComponentType.SIZE_MODIFIER,
    parameters: {
      minSize: 1,
      maxSize: 1000,
      pressureInfluence: 0.2
    },
    priority: 10,
    enabled: true
  },
  {
    id: 'soft-square-opacity',
    type: ComponentType.OPACITY_MODIFIER,
    parameters: {
      pressureInfluence: 0.3
    },
    priority: 20,
    enabled: true
  },
  {
    id: 'soft-square-antialiasing',
    type: ComponentType.ANTI_ALIASING,
    parameters: {
      mode: 'antialiased'
    },
    priority: 30,
    enabled: true
  },
  {
    id: 'soft-square-shape',
    type: ComponentType.SHAPE_RENDERER,
    parameters: {
      shape: BrushShape.SQUARE
    },
    priority: 40,
    enabled: true
  }
];

// 6px Round Square Brush Preset
export const roundSquare6Preset: BrushPreset = {
  id: 'soft-square',
  name: 'Soft Square',
  category: 'Digital Painting',
  components: roundSquare6Components,
  thumbnail: '/assets/images/Brush.png',
  tags: ['rounded', 'square', '6px', 'smooth'],
  isDefault: false,
  createdAt: new Date(),
  modifiedAt: new Date()
};

// Color Cycle Stroke Brush Components (shape mode OFF)
export const colorCycleStrokeBrushComponents: BrushComponent[] = [
  {
    id: 'color-cycle-size',
    type: ComponentType.SIZE_MODIFIER,
    parameters: {
      minSize: 1,
      maxSize: 500,
      pressureInfluence: 0
    },
    priority: 10,
    enabled: true
  },
  {
    id: 'color-cycle-opacity',
    type: ComponentType.OPACITY_MODIFIER,
    parameters: {
      pressureInfluence: 0.5
    },
    priority: 20,
    enabled: true
  },
  {
    id: 'color-cycle-shape',
    type: ComponentType.SHAPE_RENDERER,
    parameters: {
      shape: BrushShape.COLOR_CYCLE
    },
    priority: 40,
    enabled: true
  }
];

export const colorCycleStrokeBrushPreset: BrushPreset = {
  id: 'color-cycle-stroke',
  name: 'Color Cycle Stroke',
  category: 'Special',
  components: colorCycleStrokeBrushComponents,
  thumbnail: '/assets/images/Square.png',
  tags: ['color', 'cycle', 'animated', 'special', 'stroke'],
  isDefault: false,
  createdAt: new Date(),
  modifiedAt: new Date(),
  preferredSettings: {
    size: 20,
    opacity: 1,
    spacing: 8,
    colorCycleSpeed: 0.1,
    colorCycleFPS: 60,
    gradientBands: 12, // Number of distinct color bands in strokes
    colorCycleUseForegroundGradient: false,
    colorCycleFgLightness: 50,
    colorCycleFgVariance: 0,
    colorCycleFgHueShift: 0,
    colorCycleFgSaturationShift: 0,
    colorCycleFgStops: 2,
    colorCycleGradient: DEFAULT_GRADIENT_STOPS.map(stop => ({ ...stop })),
    colorCycleStampShape: 'square',
    shapeEnabled: false // Force shape mode OFF for stroke variant
  }
};

// Color Cycle Triangle Brush Components (shape mode OFF, triangle stamp)
export const colorCycleTriangleBrushComponents: BrushComponent[] = [
  {
    id: 'color-cycle-triangle-size',
    type: ComponentType.SIZE_MODIFIER,
    parameters: {
      minSize: 1,
      maxSize: 500,
      pressureInfluence: 0
    },
    priority: 10,
    enabled: true
  },
  {
    id: 'color-cycle-triangle-opacity',
    type: ComponentType.OPACITY_MODIFIER,
    parameters: {
      pressureInfluence: 0.5
    },
    priority: 20,
    enabled: true
  },
  {
    id: 'color-cycle-triangle-shape',
    type: ComponentType.SHAPE_RENDERER,
    parameters: {
      shape: BrushShape.COLOR_CYCLE_TRIANGLE
    },
    priority: 40,
    enabled: true
  }
];

export const colorCycleTriangleBrushPreset: BrushPreset = {
  id: 'color-cycle-triangle',
  name: 'Color Cycle Triangle',
  category: 'Special',
  components: colorCycleTriangleBrushComponents,
  thumbnail: '/assets/images/Square.png',
  tags: ['color', 'cycle', 'animated', 'special', 'triangle'],
  isDefault: false,
  createdAt: new Date(),
  modifiedAt: new Date(),
  preferredSettings: {
    size: 20,
    opacity: 1,
    spacing: 8,
    colorCycleSpeed: 0.1,
    colorCycleFPS: 60,
    gradientBands: 12,
    colorCycleUseForegroundGradient: false,
    colorCycleFgLightness: 50,
    colorCycleFgVariance: 0,
    colorCycleFgHueShift: 0,
    colorCycleFgSaturationShift: 0,
    colorCycleFgStops: 2,
    colorCycleGradient: DEFAULT_GRADIENT_STOPS.map(stop => ({ ...stop })),
    colorCycleStampShape: 'triangle',
    shapeEnabled: false
  }
};

// Color Cycle Shape Brush Components (shape mode ON)
export const colorCycleShapeBrushComponents: BrushComponent[] = [
  {
    id: 'color-cycle-shape-size',
    type: ComponentType.SIZE_MODIFIER,
    parameters: {
      minSize: 1,
      maxSize: 500,
      pressureInfluence: 0
    },
    priority: 10,
    enabled: true
  },
  {
    id: 'color-cycle-shape-opacity',
    type: ComponentType.OPACITY_MODIFIER,
    parameters: {
      pressureInfluence: 0.5
    },
    priority: 20,
    enabled: true
  },
  {
    id: 'color-cycle-shape-renderer',
    type: ComponentType.SHAPE_RENDERER,
    parameters: {
      shape: BrushShape.COLOR_CYCLE_SHAPE
    },
    priority: 40,
    enabled: true
  }
];

export const colorCycleShapeBrushPreset: BrushPreset = {
  id: 'color-cycle-shape',
  name: 'Color Cycle Shape',
  category: 'Special',
  components: colorCycleShapeBrushComponents,
  thumbnail: '/assets/images/Square.png',
  tags: ['color', 'cycle', 'animated', 'special', 'shape', 'polygon'],
  isDefault: false,
  createdAt: new Date(),
  modifiedAt: new Date(),
  preferredSettings: {
    size: 20,
    opacity: 1,
    spacing: 4,
    colorCycleSpeed: 0.1,
    colorCycleFPS: 60,
    gradientBands: 26,
    colorCycleUseForegroundGradient: false,
    colorCycleFgLightness: 50,
    colorCycleFgVariance: 0,
    colorCycleFgHueShift: 0,
    colorCycleFgSaturationShift: 0,
    colorCycleFgStops: 2,
    colorCycleGradient: DEFAULT_GRADIENT_STOPS.map(stop => ({ ...stop })),
    shapeEnabled: true // Force shape mode ON for shape variant
  }
};

// Color Cycle Gradient Brush Components (shape mode ON, linear fill)
export const colorCycleGradientBrushComponents: BrushComponent[] = [
  {
    id: 'color-cycle-gradient-size',
    type: ComponentType.SIZE_MODIFIER,
    parameters: {
      minSize: 1,
      maxSize: 500,
      pressureInfluence: 0
    },
    priority: 10,
    enabled: true
  },
  {
    id: 'color-cycle-gradient-opacity',
    type: ComponentType.OPACITY_MODIFIER,
    parameters: {
      pressureInfluence: 0.5
    },
    priority: 20,
    enabled: true
  },
  {
    id: 'color-cycle-gradient-shape',
    type: ComponentType.SHAPE_RENDERER,
    parameters: {
      shape: BrushShape.COLOR_CYCLE_SHAPE
    },
    priority: 40,
    enabled: true
  }
];

export const colorCycleGradientBrushPreset: BrushPreset = {
  id: 'color-cycle-gradient',
  name: 'Color Cycle Gradient',
  category: 'Special',
  components: colorCycleGradientBrushComponents,
  thumbnail: '/assets/images/Brush.png',
  tags: ['color', 'cycle', 'gradient', 'special', 'shape'],
  isDefault: false,
  createdAt: new Date(),
  modifiedAt: new Date(),
  preferredSettings: {
    size: 20,
    opacity: 1,
    spacing: 4,
    colorCycleSpeed: 0.03,
    colorCycleFPS: 60,
    gradientBands: 64,
    colorCycleUseForegroundGradient: false,
    colorCycleFgLightness: 50,
    colorCycleFgVariance: 0,
    colorCycleFgHueShift: 0,
    colorCycleFgSaturationShift: 0,
    colorCycleFgStops: 2,
    colorCycleGradient: DEFAULT_GRADIENT_STOPS.map(stop => ({ ...stop })),
    colorCycleFillMode: 'linear',
    shapeEnabled: true,
    ditherEnabled: true,
    ditherAlgorithm: 'bayer',
    fillResolution: 6,
    pxlEdge: true,
  }
};

// Rectangle Gradient Brush Components
export const rectangleGradientBrushComponents: BrushComponent[] = [
  {
    id: 'rectangle-gradient-size',
    type: ComponentType.SIZE_MODIFIER,
    parameters: {
      minSize: 1,
      maxSize: 1000,
      pressureInfluence: 0
    },
    priority: 10,
    enabled: true
  },
  {
    id: 'rectangle-gradient-opacity',
    type: ComponentType.OPACITY_MODIFIER,
    parameters: {
      pressureInfluence: 0
    },
    priority: 20,
    enabled: true
  },
  {
    id: 'rectangle-gradient-shape',
    type: ComponentType.SHAPE_RENDERER,
    parameters: {
      shape: BrushShape.RECTANGLE_GRADIENT
    },
    priority: 40,
    enabled: true
  }
];

export const rectangleGradientBrushPreset: BrushPreset = {
  id: 'rectangle-gradient',
  name: 'Rectangle Gradient',
  category: 'Special',
  components: rectangleGradientBrushComponents,
  thumbnail: '/assets/images/Brush.png',
  tags: ['gradient', 'rectangle', 'special'],
  isDefault: false,
  createdAt: new Date(),
  modifiedAt: new Date(),
  preferredSettings: {
    ditherEnabled: true,
    fillResolution: 3
  }
};

// Polygon Gradient Brush Components
const polygonGradientBrushComponents: BrushComponent[] = [
  {
    id: 'polygon-gradient-size',
    type: ComponentType.SIZE_MODIFIER,
    parameters: {
      pressureInfluence: 0
    },
    priority: 10,
    enabled: true
  },
  {
    id: 'polygon-gradient-opacity',
    type: ComponentType.OPACITY_MODIFIER,
    parameters: {
      pressureInfluence: 0
    },
    priority: 20,
    enabled: true
  },
  {
    id: 'polygon-gradient-shape',
    type: ComponentType.SHAPE_RENDERER,
    parameters: {
      shape: BrushShape.POLYGON_GRADIENT
    },
    priority: 40,
    enabled: true
  }
];

export const polygonGradientBrushPreset: BrushPreset = {
  id: 'shape-gradient',
  name: 'Shape Gradient',
  category: 'Special',
  components: polygonGradientBrushComponents,
  thumbnail: '/assets/images/Brush.png',
  tags: ['gradient', 'polygon', 'special'],
  isDefault: false,
  createdAt: new Date(),
  modifiedAt: new Date(),
  preferredSettings: {
    ditherEnabled: true,
    // Default to a larger max pixel size so pressure-linking has visible range (1..fillResolution)
    fillResolution: 6
  }
};

// Dither Gradient Brush Components
const ditherGradientBrushComponents: BrushComponent[] = [
  {
    id: 'dither-gradient-size',
    type: ComponentType.SIZE_MODIFIER,
    parameters: {
      pressureInfluence: 0
    },
    priority: 10,
    enabled: true
  },
  {
    id: 'dither-gradient-opacity',
    type: ComponentType.OPACITY_MODIFIER,
    parameters: {
      pressureInfluence: 0
    },
    priority: 20,
    enabled: true
  },
  {
    id: 'dither-gradient-shape',
    type: ComponentType.SHAPE_RENDERER,
    parameters: {
      shape: BrushShape.DITHER_GRADIENT
    },
    priority: 40,
    enabled: true
  }
];

export const ditherGradientBrushPreset: BrushPreset = {
  id: 'dither-grad',
  name: 'Dither Grad',
  category: 'Special',
  components: ditherGradientBrushComponents,
  thumbnail: '/assets/images/Brush.png',
  tags: ['gradient', 'dither', 'polygon', 'special'],
  isDefault: false,
  createdAt: new Date(),
  modifiedAt: new Date(),
  preferredSettings: {
    ditherEnabled: true,
    // Default to a larger max pixel size so pressure-linking spans multiple bins
    fillResolution: 6,
    ditherAlgorithm: 'bayer',
    ditherGradBgFill: true,
    ditherGradSampleEnabled: false
  }
};

const shapeFillBrushComponents: BrushComponent[] = [
  {
    id: 'shape-fill-renderer',
    type: ComponentType.SHAPE_RENDERER,
    parameters: {
      shape: BrushShape.SHAPE_FILL
    },
    priority: 40,
    enabled: true
  }
];

export const shapeFillBrushPreset: BrushPreset = {
  id: 'shape-fill',
  name: 'Shape Fill',
  category: 'Special',
  components: shapeFillBrushComponents,
  thumbnail: '/assets/images/Brush.png',
  tags: ['shape', 'fill', 'procedural'],
  isDefault: false,
  createdAt: new Date(),
  modifiedAt: new Date(),
  preferredSettings: {
    shapeEnabled: true,
    brushShape: BrushShape.SHAPE_FILL
  }
};

// Spam Text brush components
const spamBrushComponents: BrushComponent[] = [
  {
    id: 'spam-size',
    type: ComponentType.SIZE_MODIFIER,
    parameters: {
      minSize: 8,
      maxSize: 72,
      pressureInfluence: 0.3
    },
    priority: 10,
    enabled: true
  },
  {
    id: 'spam-opacity',
    type: ComponentType.OPACITY_MODIFIER,
    parameters: {
      pressureInfluence: 0.2
    },
    priority: 20,
    enabled: true
  },
  {
    id: 'spam-shape',
    type: ComponentType.SHAPE_RENDERER,
    parameters: {
      shape: BrushShape.SPAM_TEXT
    },
    priority: 40,
    enabled: true
  }
];

export const spamBrushPreset: BrushPreset = {
  id: 'spam-text',
  name: 'Spam Text',
  category: 'Text',
  components: spamBrushComponents,
  thumbnail: '/assets/images/Brush.png',
  tags: ['spam', 'text', 'typography', 'artistic', 'monospace'],
  isDefault: false,
  createdAt: new Date(),
  modifiedAt: new Date(),
  preferredSettings: {
    size: 20,  // Default size for text visibility
    opacity: 1,
    antialiasing: false,  // MUST be false - this controls shape mode
    spacing: 10,  // Optimized spacing for letter-by-letter text flow
    pressureEnabled: false,  // Disable pressure for consistent text
    gridSnapEnabled: true,  // Grid snap on by default
    minPressure: 99,
    maxPressure: 0,
    spamFont: 'courier',
    spamContentType: 'mixed'
  }
};

// Resampler Brush Components
const resamplerBrushComponents: BrushComponent[] = [
  {
    id: 'resampler-size',
    type: ComponentType.SIZE_MODIFIER,
    parameters: {
      pressureInfluence: 0.5
    },
    priority: 10,
    enabled: true
  },
  {
    id: 'resampler-opacity',
    type: ComponentType.OPACITY_MODIFIER,
    parameters: {
      pressureInfluence: 0
    },
    priority: 20,
    enabled: true
  },
  {
    id: 'resampler-shape',
    type: ComponentType.SHAPE_RENDERER,
    parameters: {
      shape: BrushShape.RESAMPLER
    },
    priority: 40,
    enabled: true
  },
  {
    id: 'resampler-antialiasing',
    type: ComponentType.ANTI_ALIASING,
    parameters: {
      mode: 'antialiased'
    },
    priority: 30,
    enabled: true
  }
];

export const resamplerBrushPreset: BrushPreset = {
  id: 'resampler',
  name: 'Resampler',
  category: 'Special',
  components: resamplerBrushComponents,
  thumbnail: '/assets/images/Brush.png',
  tags: ['resampler', 'sample', 'special'],
  isDefault: false,
  createdAt: new Date(),
  modifiedAt: new Date(),
  preferredSettings: {
    size: 20,
    opacity: 1,
    antialiasing: true,
    spacing: 1,
    pressureEnabled: false,
    minPressure: 99,
    maxPressure: 0,
    rotationEnabled: true,
    dashedEnabled: false,
    dashLength: 10,
    dashGap: 10,
    gridSnapEnabled: false,
    shapeEnabled: false,
    colorJitter: 0,
    risographIntensity: 0,
    risographOutline: false,
    ditherEnabled: false
  }
};

// Pixel dither brush preset – pixel brush with dithering locked on
export const pixelDitherPreset: BrushPreset = {
  id: 'dither-stroke',
  name: 'Dither Stroke',
  category: 'Pixel Art',
  components: pixelBrushComponents,
  thumbnail: '/assets/images/Brush.png',
  tags: ['pixel', 'dither', 'pixel-art', 'retro'],
  isDefault: false,
  createdAt: new Date(),
  modifiedAt: new Date(),
  preferredSettings: {
    ...pixelBrushSettings,
    brushShape: BrushShape.PIXEL_DITHER,
    size: 1,
    opacity: 1,
    spacing: 1,
    antialiasing: false,
    pressureEnabled: false,
    minPressure: 0,
    maxPressure: 200,
    ditherEnabled: true,
    ditherAlgorithm: 'sierra-lite',
    ditherPaletteSpread: 0,
    ditherPatternDiversity: 100,
    ditherPhaseJitter: 0,
    ditherStrokeTipShape: 'round',
    lostEdge: 0,
    pressureLinkedFillResolution: true,
    fillResolution: 28,
    pressureLinkedFillMaxResolution: 28,
  }
};

// Shape dither brush preset – pixel dither defaults but forced into shape mode
export const shapeDitherPreset: BrushPreset = {
  id: 'dither-shape',
  name: 'Dither Shape',
  category: 'Pixel Art',
  components: pixelBrushComponents,
  thumbnail: '/assets/images/Brush.png',
  tags: ['pixel', 'dither', 'shape', 'pixel-art'],
  isDefault: false,
  createdAt: new Date(),
  modifiedAt: new Date(),
  preferredSettings: {
    ...pixelBrushSettings,
    brushShape: BrushShape.PIXEL_DITHER,
    size: 1,
    opacity: 1,
    spacing: 1,
    antialiasing: false,
    pressureEnabled: false,
    minPressure: 0,
    maxPressure: 200,
    ditherEnabled: true,
    ditherAlgorithm: 'sierra-lite',
    ditherPaletteSpread: 0,
    ditherPatternDiversity: 100,
    ditherPhaseJitter: 0,
    ditherStrokeTipShape: 'round',
    lostEdge: 0,
    pxlEdge: true,
    shapeEnabled: true,
    pressureLinkedFillResolution: true,
    fillResolution: 28,
    pressureLinkedFillMaxResolution: 28,
  }
};

export const checkeredBrushPreset: BrushPreset = {
  id: 'checkered',
  name: 'Checkered',
  category: 'Special',
  components: colorCycleStrokeBrushComponents,
  thumbnail: '/assets/images/checkered-brush.svg',
  tags: ['color-cycle', 'checkered', 'stroke', 'retro'],
  isDefault: false,
  createdAt: new Date(),
  modifiedAt: new Date(),
  preferredSettings: {
    ...pixelBrushSettings,
    brushShape: BrushShape.COLOR_CYCLE,
    size: 8,
    opacity: 1,
    spacing: 8,
    antialiasing: false,
    pressureEnabled: false,
    minPressure: 0,
    maxPressure: 200,
    colorCycleFPS: 10,
    colorCycleSpeed: 0.1,
    gradientBands: 12,
    colorCycleStampShape: 'checkered',
    colorCycleStampDitherEnabled: true,
    colorCycleStampDitherPixelSize: 1,
    colorCycleStampDitherBgFill: true,
    colorCycleStampDitherPressureLinked: false,
    lostEdge: 0,
    pressureLinkedFillResolution: true,
    fillResolution: 6,
    pressureLinkedFillMaxResolution: 12,
  },
};

// Available brush presets
export const brushPresets: BrushPreset[] = [
  pixelBrushPreset,
  roundSquare6Preset,
  roundPixel4Preset,
  defaultBrushPreset,
  mosaicBrushPreset,
  pixelDitherPreset,
  shapeDitherPreset,
  checkeredBrushPreset,
  ditherGradientBrushPreset,
  colorCycleStrokeBrushPreset,
  colorCycleTriangleBrushPreset,
  colorCycleShapeBrushPreset,
  colorCycleGradientBrushPreset,
  rectangleGradientBrushPreset,
  polygonGradientBrushPreset,
  shapeFillBrushPreset,
  spamBrushPreset,
  resamplerBrushPreset
];

// Helper functions
export const getBrushPresetById = (id: string): BrushPreset | undefined => {
  return brushPresets.find(preset => preset.id === id);
};

export const getBrushPresetsByCategory = (category: string): BrushPreset[] => {
  return brushPresets.filter(preset => preset.category === category);
};

export const applyBrushPreset = (preset: BrushPreset, userSavedSettings?: Partial<BrushSettings>): { settings: Partial<BrushSettings>; components: BrushComponent[] } => {
  const settings: Partial<BrushSettings> = {};
  
  // FIRST: Apply only technical defaults (size and functional settings), not user preferences
  if (preset.id === 'pixel-square') {
    settings.size = 1; // 1px default for pixel brush
    settings.antialiasing = false;
  } else if (preset.id === 'soft-round') {
    settings.size = 5; // 5px default for default brush
    settings.antialiasing = true;
  } else if (preset.id === 'pixel-round') {
    settings.size = 4; // 4px default as per name
    settings.antialiasing = false;
  } else if (preset.id === 'soft-square') {
    settings.size = 6; // 6px default as per name
    settings.antialiasing = true;
  } else if (preset.id === 'mosaic') {
    settings.size = 60; // 60px default for mosaic brush
    settings.antialiasing = false;
  } else if (preset.id === 'resampler') {
    settings.size = 20; // 20px default for resampler brush
    settings.antialiasing = true;
    settings.pressureEnabled = false;
    settings.minPressure = 50;  // 50% under base => min at 50%
    settings.maxPressure = 100; // 100% over base => max at 200%
  } else if (preset.category === 'Custom') {
    // Handle custom brush presets - apply sensible defaults
    settings.antialiasing = true;
    settings.pressureEnabled = false;
    settings.minPressure = 99;
    settings.maxPressure = undefined;
  }
  // Removed hardcoded opacity, spacing, colorJitter - these should come from user preferences or store defaults
  
  // SECOND: Extract behavior settings from components (only core functionality, not user preferences)
  preset.components.forEach(component => {
    switch (component.type) {
      case ComponentType.ANTI_ALIASING:
        // Only override if user hasn't saved a preference
        if (!userSavedSettings?.antialiasing) {
          settings.antialiasing = component.parameters.mode === 'antialiased';
        }
        break;
      case ComponentType.SHAPE_RENDERER:
        settings.brushShape = component.parameters.shape as BrushShape;
        break;
    }
  });
  
  // THIRD: ALWAYS merge in preferred settings from the preset to provide baseline
  if (preset.preferredSettings) {
    Object.assign(settings, preset.preferredSettings);
  }
  
  // FINAL: User-saved settings have absolute highest priority and CANNOT be overridden
  if (userSavedSettings) {
    Object.assign(settings, userSavedSettings);
  }
  
  return { settings, components: preset.components };
};
