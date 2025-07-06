import { 
  BrushPreset, 
  ComponentType,
  SizeModifierParams,
  AntiAliasingParams,
  PressureHandlerParams,
  ColorBlendingParams,
  SpacingParams
} from '@/types/brush';

/**
 * Default brush presets that match the current TinyBrush UI
 * These will replace the hardcoded BRUSH_PRESETS in Toolbar.tsx
 */

export const DEFAULT_PIXEL_1PX: BrushPreset = {
  id: 'pixel-1px',
  name: 'Pixel 1px',
  category: 'Pixel Art',
  components: [
    {
      id: 'pressure-handler-1px',
      type: ComponentType.PRESSURE_HANDLER,
      priority: 10,
      enabled: false, // No pressure for pixel art
      parameters: {
        inputSource: 'mouse',
        pressureCurve: [0, 1], // Flat curve
        velocityInfluence: 0,
        smoothing: 0,
        minimumPressure: 1
      } as PressureHandlerParams
    },
    {
      id: 'color-blending-1px',
      type: ComponentType.COLOR_BLENDING,
      priority: 35,
      enabled: true,
      parameters: {
        blendMode: 'normal',
        colorVariation: 0,
        hueShift: 0,
        saturationAdjust: 0
      } as ColorBlendingParams
    },
    {
      id: 'size-modifier-1px',
      type: ComponentType.SIZE_MODIFIER,
      priority: 20,
      enabled: true,
      parameters: {
        baseSize: 1,
        pressureInfluence: 0, // No pressure variation
        minSize: 1,
        maxSize: 1,
        variationAmount: 0,
        variationSeed: 0
      } as SizeModifierParams
    },
    {
      id: 'antialiasing-pixel',
      type: ComponentType.ANTI_ALIASING,
      priority: 50,
      enabled: true,
      parameters: {
        mode: 'pixel',
        pixelAlignment: true,
        edgeSharpness: 1.0,
        subpixelPrecision: false
      } as AntiAliasingParams
    },
    {
      id: 'spacing-pixel-1px',
      type: ComponentType.SPACING,
      priority: 25,
      enabled: true,
      parameters: {
        defaultSpacing: 1,
        fixedSpacing: 1,
        dynamicEnabled: false,
        velocityInfluence: 0.3,
        minSpacing: 1,
        maxSpacing: 10
      } as SpacingParams
    }
  ],
  thumbnail: '', // Will be generated
  tags: ['pixel', 'precise', '1px'],
  isFavorite: true, // Auto-favorite standard brushes
  isDefault: true,
  createdAt: new Date(),
  modifiedAt: new Date()
};

export const DEFAULT_SOFT_BRUSH: BrushPreset = {
  id: 'soft-round',
  name: 'Soft Round',
  category: 'Digital Painting',
  components: [
    {
      id: 'pressure-handler-soft',
      type: ComponentType.PRESSURE_HANDLER,
      priority: 10,
      enabled: true,
      parameters: {
        inputSource: 'tablet', // Supports both mouse and tablet
        pressureCurve: [0, 0.2, 0.8, 1], // Natural pressure curve
        velocityInfluence: 0.3,
        smoothing: 0.5,
        minimumPressure: 0.1
      } as PressureHandlerParams
    },
    {
      id: 'color-blending-soft',
      type: ComponentType.COLOR_BLENDING,
      priority: 35,
      enabled: true,
      parameters: {
        blendMode: 'normal',
        colorVariation: 0,
        hueShift: 0,
        saturationAdjust: 0
      } as ColorBlendingParams
    },
    {
      id: 'size-modifier-soft',
      type: ComponentType.SIZE_MODIFIER,
      priority: 20,
      enabled: true,
      parameters: {
        baseSize: 20,
        pressureInfluence: 0.8, // Strong pressure sensitivity
        minSize: 2,
        maxSize: 50,
        variationAmount: 0,
        variationSeed: 0
      } as SizeModifierParams
    },
    {
      id: 'antialiasing-smooth',
      type: ComponentType.ANTI_ALIASING,
      priority: 50,
      enabled: true,
      parameters: {
        mode: 'antialiased',
        pixelAlignment: false,
        edgeSharpness: 0.3,
        subpixelPrecision: true
      } as AntiAliasingParams
    },
    {
      id: 'spacing-soft-brush',
      type: ComponentType.SPACING,
      priority: 25,
      enabled: true,
      parameters: {
        defaultSpacing: 8,
        fixedSpacing: 8,
        dynamicEnabled: false,
        velocityInfluence: 0.5,
        minSpacing: 2,
        maxSpacing: 20
      } as SpacingParams
    }
  ],
  thumbnail: '',
  tags: ['soft', 'painting', 'pressure'],
  isFavorite: true, // Auto-favorite standard brushes
  isDefault: true,
  createdAt: new Date(),
  modifiedAt: new Date()
};

export const DEFAULT_PIXEL_3PX: BrushPreset = {
  id: 'pixel-3px',
  name: 'Pixel 3px',
  category: 'Pixel Art',
  components: [
    {
      id: 'pressure-handler-3px',
      type: ComponentType.PRESSURE_HANDLER,
      priority: 10,
      enabled: false,
      parameters: {
        inputSource: 'mouse',
        pressureCurve: [0, 1],
        velocityInfluence: 0,
        smoothing: 0,
        minimumPressure: 1
      } as PressureHandlerParams
    },
    {
      id: 'color-blending-3px',
      type: ComponentType.COLOR_BLENDING,
      priority: 35,
      enabled: true,
      parameters: {
        blendMode: 'normal',
        colorVariation: 0,
        hueShift: 0,
        saturationAdjust: 0
      } as ColorBlendingParams
    },
    {
      id: 'size-modifier-3px',
      type: ComponentType.SIZE_MODIFIER,
      priority: 20,
      enabled: true,
      parameters: {
        baseSize: 3,
        pressureInfluence: 0,
        minSize: 3,
        maxSize: 3,
        variationAmount: 0,
        variationSeed: 0
      } as SizeModifierParams
    },
    {
      id: 'antialiasing-pixel-3',
      type: ComponentType.ANTI_ALIASING,
      priority: 50,
      enabled: true,
      parameters: {
        mode: 'pixel',
        pixelAlignment: true,
        edgeSharpness: 1.0,
        subpixelPrecision: false
      } as AntiAliasingParams
    },
    {
      id: 'spacing-pixel-3px',
      type: ComponentType.SPACING,
      priority: 25,
      enabled: true,
      parameters: {
        defaultSpacing: 3,
        fixedSpacing: 3,
        dynamicEnabled: false,
        velocityInfluence: 0.3,
        minSpacing: 1,
        maxSpacing: 15
      } as SpacingParams
    }
  ],
  thumbnail: '',
  tags: ['pixel', 'precise', '3px'],
  isFavorite: true,
  isDefault: true,
  createdAt: new Date(),
  modifiedAt: new Date()
};

/**
 * All default brush presets
 */
export const DEFAULT_BRUSH_PRESETS: BrushPreset[] = [
  DEFAULT_PIXEL_1PX,
  DEFAULT_PIXEL_3PX,
  DEFAULT_SOFT_BRUSH
];

/**
 * Get default brush preset by ID
 */
export function getDefaultBrush(id: string): BrushPreset | undefined {
  return DEFAULT_BRUSH_PRESETS.find(brush => brush.id === id);
}

/**
 * Get all favorite default brushes
 */
export function getDefaultFavorites(): BrushPreset[] {
  return DEFAULT_BRUSH_PRESETS.filter(brush => brush.isFavorite);
}