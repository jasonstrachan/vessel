import { BrushPreset, BrushComponent, ComponentType, BrushSettings, BrushShape } from '../types';

// Default brush settings for pixel-perfect drawing
export const pixelBrushSettings: BrushSettings = {
  size: 1,
  opacity: 1,
  color: '#000000',
  blendMode: 'source-over',
  spacing: 1,
  pressure: 1,
  rotation: 0,
  antialiasing: false,
  pressureEnabled: false,
  minPressure: 1,
  maxPressure: 2,
  rotationEnabled: false,
  dashedEnabled: true,
  dashLength: 3,
  dashGap: 2,
  gridSnapEnabled: false,
  shapeEnabled: false,
  useSwatchColor: false,
  hueShift: 0,
  saturationAdjust: 100,
  colorJitter: 0,
  risographIntensity: 0,
  ditherEnabled: false
};

// Default brush settings for smooth drawing
export const defaultBrushSettings: BrushSettings = {
  size: 100,
  opacity: 1,
  color: '#000000',
  blendMode: 'source-over',
  spacing: 1,
  pressure: 1,
  rotation: 0,
  antialiasing: true,
  lastRegularBrushSize: 100,
  pressureEnabled: false,
  minPressure: 1,
  maxPressure: undefined,
  rotationEnabled: false,
  dashedEnabled: false,
  dashLength: 3,
  dashGap: 2,
  gridSnapEnabled: false,
  shapeEnabled: false,
  useSwatchColor: false,
  hueShift: 0,
  saturationAdjust: 100,
  colorJitter: 0,
  risographIntensity: 0,
  ditherEnabled: false,
  fillResolution: 1
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
  id: 'pixel-brush',
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
  id: 'default-brush',
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


// Pixel Round Brush Components
export const roundPixel4Components: BrushComponent[] = [
  {
    id: 'round-pixel-4-size',
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
    id: 'round-pixel-4-opacity',
    type: ComponentType.OPACITY_MODIFIER,
    parameters: {
      pressureInfluence: 0
    },
    priority: 20,
    enabled: true
  },
  {
    id: 'round-pixel-4-antialiasing',
    type: ComponentType.ANTI_ALIASING,
    parameters: {
      mode: 'pixel'
    },
    priority: 30,
    enabled: true
  },
  {
    id: 'round-pixel-4-shape',
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
  id: 'round-pixel-4',
  name: 'Pixel Round',
  category: 'Pixel Art',
  components: roundPixel4Components,
  thumbnail: '/assets/images/Brush.png',
  tags: ['pixel', 'round', '4px', 'hard'],
  isDefault: false,
  createdAt: new Date(),
  modifiedAt: new Date()
};

// 6px Round Square Brush Components
export const roundSquare6Components: BrushComponent[] = [
  {
    id: 'round-square-6-size',
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
    id: 'round-square-6-opacity',
    type: ComponentType.OPACITY_MODIFIER,
    parameters: {
      pressureInfluence: 0.3
    },
    priority: 20,
    enabled: true
  },
  {
    id: 'round-square-6-antialiasing',
    type: ComponentType.ANTI_ALIASING,
    parameters: {
      mode: 'antialiased'
    },
    priority: 30,
    enabled: true
  },
  {
    id: 'round-square-6-shape',
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
  id: 'round-square-6',
  name: 'Soft Square',
  category: 'Digital Painting',
  components: roundSquare6Components,
  thumbnail: '/assets/images/Brush.png',
  tags: ['rounded', 'square', '6px', 'smooth'],
  isDefault: false,
  createdAt: new Date(),
  modifiedAt: new Date()
};

// Ink Brush Components (pressure-sensitive with min/max override)
export const inkBrushComponents: BrushComponent[] = [
  {
    id: 'ink-size',
    type: ComponentType.SIZE_MODIFIER,
    parameters: {
      minSize: 1,
      maxSize: 1000,
      pressureInfluence: 100
    },
    priority: 10,
    enabled: true
  },
  {
    id: 'ink-opacity',
    type: ComponentType.OPACITY_MODIFIER,
    parameters: {
      pressureInfluence: 0
    },
    priority: 20,
    enabled: true
  },
  {
    id: 'ink-antialiasing',
    type: ComponentType.ANTI_ALIASING,
    parameters: {
      mode: 'antialiased'
    },
    priority: 30,
    enabled: true
  },
  {
    id: 'ink-shape',
    type: ComponentType.SHAPE_RENDERER,
    parameters: {
      shape: BrushShape.ROUND
    },
    priority: 40,
    enabled: true
  },
  {
    id: 'ink-rotation',
    type: ComponentType.ROTATION_TRANSFORM,
    parameters: {
      enableRotation: true
    },
    priority: 50,
    enabled: true
  }
];

// Ink Brush Preset (pressure overrides size slider)
export const inkBrushPreset: BrushPreset = {
  id: 'ink-brush',
  name: 'Ink',
  category: 'Artistic',
  components: inkBrushComponents,
  thumbnail: '/assets/images/Brush.png',
  tags: ['ink', 'pressure', 'artistic', 'variable'],
  isDefault: false,
  createdAt: new Date(),
  modifiedAt: new Date(),
  preferredSettings: {
    size: 5,
    antialiasing: true,
    pressureEnabled: true,
    minPressure: 10,
    maxPressure: 200,
    rotationEnabled: true,
    dashedEnabled: false,
    gridSnapEnabled: false,
    shapeEnabled: false
    // Removed opacity, spacing, colorJitter - these are user preferences, not brush technical requirements
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
  id: 'rectangle-gradient-brush',
  name: 'Rectangle Gradient',
  category: 'Special',
  components: rectangleGradientBrushComponents,
  thumbnail: '/assets/images/Brush.png',
  tags: ['gradient', 'rectangle', 'special'],
  isDefault: false,
  createdAt: new Date(),
  modifiedAt: new Date()
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
  id: 'polygon-gradient-brush',
  name: 'Polygon Gradient',
  category: 'Special',
  components: polygonGradientBrushComponents,
  thumbnail: '/assets/images/Brush.png',
  tags: ['gradient', 'polygon', 'special'],
  isDefault: false,
  createdAt: new Date(),
  modifiedAt: new Date()
};

// Available brush presets
export const brushPresets: BrushPreset[] = [
  pixelBrushPreset,
  defaultBrushPreset,
  roundPixel4Preset,
  roundSquare6Preset,
  inkBrushPreset,
  rectangleGradientBrushPreset,
  polygonGradientBrushPreset
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
  if (preset.id === 'pixel-brush') {
    settings.size = 1; // 1px default for pixel brush
    settings.antialiasing = false;
  } else if (preset.id === 'default-brush') {
    settings.size = 5; // 5px default for default brush
    settings.antialiasing = true;
  } else if (preset.id === 'square-pixel-1') {
    settings.size = 1; // 1px default as per name
    settings.antialiasing = false;
  } else if (preset.id === 'round-pixel-4') {
    settings.size = 4; // 4px default as per name
    settings.antialiasing = false;
  } else if (preset.id === 'round-square-6') {
    settings.size = 6; // 6px default as per name
    settings.antialiasing = true;
  } else if (preset.id === 'ink-brush') {
    settings.size = 5; // 5px default for ink brush
    settings.antialiasing = true;
    settings.pressureEnabled = true;
    settings.minPressure = 1;
    settings.maxPressure = 100;
  } else if (preset.category === 'Custom') {
    // Handle custom brush presets - apply sensible defaults
    settings.antialiasing = true;
    settings.pressureEnabled = true;
    settings.minPressure = 1;
    settings.maxPressure = 100;
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