/**
 * Essential brush types - simplified from the complex modular system
 */

// Re-export essential types from main types
export type { BrushSettings } from '@/types';

// Simple brush preset for common brushes
export interface SimpleBrushPreset {
  id: string;
  name: string;
  size: number;
  opacity: number;
  spacing: number;
  shape: 'circle' | 'square';
  pressureEnabled: boolean;
  dynamicSpacing: boolean;
}

// Common brush presets
export const SIMPLE_BRUSHES: SimpleBrushPreset[] = [
  {
    id: 'pixel-brush',
    name: 'Pixel Brush',
    size: 1,
    opacity: 1,
    spacing: 1,
    shape: 'square',
    pressureEnabled: false,
    dynamicSpacing: false
  },
  {
    id: 'soft-brush',
    name: 'Soft Brush',
    size: 10,
    opacity: 0.8,
    spacing: 3,
    shape: 'circle',
    pressureEnabled: true,
    dynamicSpacing: true
  },
  {
    id: 'hard-brush',
    name: 'Hard Brush',
    size: 5,
    opacity: 1,
    spacing: 2,
    shape: 'circle',
    pressureEnabled: false,
    dynamicSpacing: false
  }
];

/**
 * Convert simplified preset to full brush settings
 */
export function presetToBrushSettings(
  preset: SimpleBrushPreset, 
  currentColor: string
): BrushSettings {
  return {
    color: currentColor,
    size: preset.size,
    opacity: preset.opacity,
    rotation: 0,
    brushShape: preset.shape,
    pixelPerfect: preset.shape === 'square',
    gridSnap: false,
    rotateEnabled: false,
    selectedCustomBrush: null,
    spacing: {
      value: preset.spacing,
      dynamicEnabled: preset.dynamicSpacing,
      defaultValue: preset.spacing
    },
    dottedStyle: {
      enabled: false,
      dashLength: 10,
      dashSpacing: 5,
      gap: 3
    },
    pressureSettings: {
      enabled: preset.pressureEnabled,
      minValue: 0.3,
      maxValue: 1.2
    }
  };
}