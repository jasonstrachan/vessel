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
  useSwatchColor: false
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
  maxPressure: 100,
  rotationEnabled: false,
  dashedEnabled: false,
  dashLength: 3,
  dashGap: 2,
  gridSnapEnabled: false,
  useSwatchColor: false
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
  name: 'Pixel Brush',
  category: 'Pixel Art',
  components: pixelBrushComponents,
  thumbnail: '/assets/images/Brush.png',
  tags: ['pixel', 'hard', '1px', 'pixel-art'],
  isDefault: true,
  createdAt: new Date(),
  modifiedAt: new Date()
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
  }
];

// Default brush preset
export const defaultBrushPreset: BrushPreset = {
  id: 'default-brush',
  name: 'Default Brush',
  category: 'Digital Painting',
  components: defaultBrushComponents,
  thumbnail: '/assets/images/Brush.png',
  tags: ['default', 'smooth', 'digital-painting'],
  isDefault: true,
  createdAt: new Date(),
  modifiedAt: new Date()
};

// 1px Square Pixel Brush Components
export const squarePixel1Components: BrushComponent[] = [
  {
    id: 'square-pixel-1-size',
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
    id: 'square-pixel-1-opacity',
    type: ComponentType.OPACITY_MODIFIER,
    parameters: {
      pressureInfluence: 0
    },
    priority: 20,
    enabled: true
  },
  {
    id: 'square-pixel-1-antialiasing',
    type: ComponentType.ANTI_ALIASING,
    parameters: {
      mode: 'pixel'
    },
    priority: 30,
    enabled: true
  },
  {
    id: 'square-pixel-1-shape',
    type: ComponentType.SHAPE_RENDERER,
    parameters: {
      shape: BrushShape.SQUARE
    },
    priority: 40,
    enabled: true
  }
];

// 1px Square Pixel Brush Preset
export const squarePixel1Preset: BrushPreset = {
  id: 'square-pixel-1',
  name: '1px Square',
  category: 'Pixel Art',
  components: squarePixel1Components,
  thumbnail: '/assets/images/Brush.png',
  tags: ['pixel', 'hard', '1px', 'square'],
  isDefault: false,
  createdAt: new Date(),
  modifiedAt: new Date()
};

// 4px Round Pixel Brush Components
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

// 4px Round Pixel Brush Preset
export const roundPixel4Preset: BrushPreset = {
  id: 'round-pixel-4',
  name: '4px Round Pixel',
  category: 'Pixel Art',
  components: roundPixel4Components,
  thumbnail: '/assets/images/Brush.png',
  tags: ['pixel', 'round', '4px', 'hard'],
  isDefault: false,
  createdAt: new Date(),
  modifiedAt: new Date()
};

// 4px Round Soft Brush Components
export const roundSoft4Components: BrushComponent[] = [
  {
    id: 'round-soft-4-size',
    type: ComponentType.SIZE_MODIFIER,
    parameters: {
      minSize: 1,
      maxSize: 1000,
      pressureInfluence: 0.3
    },
    priority: 10,
    enabled: true
  },
  {
    id: 'round-soft-4-opacity',
    type: ComponentType.OPACITY_MODIFIER,
    parameters: {
      pressureInfluence: 0.5
    },
    priority: 20,
    enabled: true
  },
  {
    id: 'round-soft-4-antialiasing',
    type: ComponentType.ANTI_ALIASING,
    parameters: {
      mode: 'antialiased'
    },
    priority: 30,
    enabled: true
  },
  {
    id: 'round-soft-4-shape',
    type: ComponentType.SHAPE_RENDERER,
    parameters: {
      shape: BrushShape.ROUND
    },
    priority: 40,
    enabled: true
  }
];

// 4px Round Soft Brush Preset
export const roundSoft4Preset: BrushPreset = {
  id: 'round-soft-4',
  name: '4px Round Soft',
  category: 'Digital Painting',
  components: roundSoft4Components,
  thumbnail: '/assets/images/Brush.png',
  tags: ['soft', 'round', '4px', 'smooth'],
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
  name: '6px Round Square',
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
  modifiedAt: new Date()
};

// Available brush presets
export const brushPresets: BrushPreset[] = [
  pixelBrushPreset,
  defaultBrushPreset,
  squarePixel1Preset,
  roundPixel4Preset,
  roundSoft4Preset,
  roundSquare6Preset,
  inkBrushPreset
];

// Helper functions
export const getBrushPresetById = (id: string): BrushPreset | undefined => {
  return brushPresets.find(preset => preset.id === id);
};

export const getBrushPresetsByCategory = (category: string): BrushPreset[] => {
  return brushPresets.filter(preset => preset.category === category);
};

export const applyBrushPreset = (preset: BrushPreset): { settings: Partial<BrushSettings>; components: BrushComponent[] } => {
  const settings: Partial<BrushSettings> = {};
  
  // Extract behavior settings from components
  preset.components.forEach(component => {
    switch (component.type) {
      case ComponentType.ANTI_ALIASING:
        settings.antialiasing = component.parameters.mode === 'antialiased';
        break;
      case ComponentType.SHAPE_RENDERER:
        settings.brushShape = component.parameters.shape as BrushShape;
        break;
    }
  });
  
  // Apply preset specific settings including default pixel sizes for default brushes
  if (preset.id === 'pixel-brush') {
    settings.size = 1; // 1px default for pixel brush
    settings.opacity = 1;
    settings.spacing = 1;
    settings.antialiasing = false;
  } else if (preset.id === 'default-brush') {
    settings.size = 10; // 10px default for default brush
    settings.opacity = 1;
    settings.spacing = 1;
    settings.antialiasing = true;
  } else if (preset.id === 'square-pixel-1') {
    settings.size = 1; // 1px default as per name
    settings.opacity = 1;
    settings.spacing = 1;
    settings.antialiasing = false;
  } else if (preset.id === 'round-pixel-4') {
    settings.size = 4; // 4px default as per name
    settings.opacity = 1;
    settings.spacing = 1;
    settings.antialiasing = false;
  } else if (preset.id === 'round-soft-4') {
    settings.size = 4; // 4px default as per name
    settings.opacity = 1;
    settings.spacing = 1;
    settings.antialiasing = true;
  } else if (preset.id === 'round-square-6') {
    settings.size = 6; // 6px default as per name
    settings.opacity = 1;
    settings.spacing = 1;
    settings.antialiasing = true;
  } else if (preset.id === 'ink-brush') {
    settings.size = 10; // 10px default for ink brush
    settings.opacity = 1;
    settings.spacing = 1;
    settings.antialiasing = true;
    settings.pressureEnabled = true;
    settings.minPressure = 1;
    settings.maxPressure = 100;
  } else if (preset.category === 'Custom') {
    // Handle custom brush presets - apply sensible defaults
    settings.opacity = 1;
    settings.spacing = 1;
    settings.antialiasing = true;
    settings.pressureEnabled = true;
    settings.minPressure = 1;
    settings.maxPressure = settings.size;
  }
  
  return { settings, components: preset.components };
};