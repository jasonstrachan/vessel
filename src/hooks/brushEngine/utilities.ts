/**
 * Utility functions extracted from useBrushEngine
 * Pure functions without hook dependencies
 */

import type { BrushSettings } from '@/types';
import { calculatePressureSize as calculatePressureSizeCurve } from '@/utils/pressureCurve';

/**
 * Calculate grid spacing from brush settings
 */
export const calculateGridSpacing = (brushSettings: BrushSettings): number => {
  const defaultSpacing = 16;
  // Grid size is not in BrushSettings, using default
  const gridSize = defaultSpacing;
  
  // Ensure minimum spacing of 2 pixels
  return Math.max(2, gridSize);
};

/**
 * Check if grid snapping should be applied
 */
export const shouldApplyGridSnapPure = (brushSettings: BrushSettings): boolean => {
  return brushSettings.gridSnapEnabled === true;
};

/**
 * Snap position to grid
 */
export const snapToGridPure = (
  x: number,
  y: number,
  gridSpacing: number
): { x: number; y: number } => {
  return {
    x: Math.round(x / gridSpacing) * gridSpacing,
    y: Math.round(y / gridSpacing) * gridSpacing
  };
};

/**
 * Calculate spacing between brush stamps
 */
export const calculateBrushSpacing = (
  brushSettings: BrushSettings,
  baseSize: number
): number => {
  // Spacing value from settings is 1-40, representing pixels between stamps
  // spacing = 1 means stamps are drawn 1 pixel apart
  // spacing = 10 means stamps are drawn 10 pixels apart  
  // spacing = 40 means stamps are drawn 40 pixels apart
  const actualSpacing = brushSettings.spacing || 1;
  
  return actualSpacing;
};

/**
 * Calculate pressure-modified brush size with smooth curve
 */
export const calculatePressureSize = (
  baseSize: number,
  pressure: number,
  minPressure: number,
  maxPressure: number,
  pressureEnabled: boolean
): number => {
  if (!pressureEnabled) {
    return baseSize;
  }
  
  // Use the new pressure curve function
  // minPressure and maxPressure are percentages (1-1000)
  const minPercent = minPressure || 100; // Default to 100% (no reduction)
  const maxPercent = maxPressure || 100; // Default to 100% (no increase)
  
  return calculatePressureSizeCurve(
    baseSize,
    pressure,
    minPercent,
    maxPercent,
    's-curve' // Use smooth S-curve by default
  );
};

/**
 * Calculate opacity with pressure modification
 */
export const calculatePressureOpacity = (
  baseOpacity: number,
  pressure: number,
  pressureEnabled: boolean,
  pressureOpacityEnabled?: boolean
): number => {
  if (!pressureEnabled || !pressureOpacityEnabled) {
    return baseOpacity;
  }
  
  // Apply pressure curve to opacity
  const minOpacity = 0.1;
  const maxOpacity = 1.0;
  
  // Use a curve for more natural pressure response
  const pressureCurve = Math.pow(pressure, 1.5);
  
  const modifiedOpacity = baseOpacity * (minOpacity + pressureCurve * (maxOpacity - minOpacity));
  
  return Math.max(0, Math.min(1, modifiedOpacity));
};

/**
 * Check if transparency lock should prevent drawing
 */
export const checkTransparencyLock = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  transparencyLockEnabled?: boolean
): boolean => {
  if (!transparencyLockEnabled) {
    return false; // Allow drawing
  }
  
  const centerX = Math.floor(x);
  const centerY = Math.floor(y);
  
  // Ensure coordinates are within canvas bounds
  const canvasWidth = ctx.canvas.width;
  const canvasHeight = ctx.canvas.height;
  
  if (centerX >= 0 && centerX < canvasWidth && centerY >= 0 && centerY < canvasHeight) {
    try {
      const imageData = ctx.getImageData(centerX, centerY, 1, 1);
      const alpha = imageData.data[3]; // Alpha channel
      
      // If pixel is fully transparent, prevent drawing
      return alpha === 0;
    } catch {
      // If we can't read the pixel data, allow drawing
      return false;
    }
  }
  
  return false; // Allow drawing if outside bounds
};

/**
 * Factory to create utility functions with injected settings
 */
export const createBrushUtilities = (getSettings: () => BrushSettings) => {
  return {
    calculateGridSpacing: () => calculateGridSpacing(getSettings()),
    shouldApplyGridSnap: () => shouldApplyGridSnapPure(getSettings()),
    snapToGrid: (x: number, y: number) => {
      const spacing = calculateGridSpacing(getSettings());
      return snapToGridPure(x, y, spacing);
    },
    calculateBrushSpacing: (baseSize: number) => 
      calculateBrushSpacing(getSettings(), baseSize),
    calculatePressureSize: (baseSize: number, pressure: number) => {
      const settings = getSettings();
      return calculatePressureSize(
        baseSize,
        pressure,
        settings.minPressure || 50,    // Default to 50% at min pressure
        settings.maxPressure || 200,   // Default to 200% at max pressure
        settings.pressureEnabled || false
      );
    },
    calculatePressureOpacity: (baseOpacity: number, pressure: number) => {
      const settings = getSettings();
      return calculatePressureOpacity(
        baseOpacity,
        pressure,
        settings.pressureEnabled || false,
        false // pressureOpacityEnabled not in BrushSettings
      );
    }
  };
};