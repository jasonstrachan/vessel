/**
 * Utility functions extracted from useBrushEngine
 * Pure functions without hook dependencies
 */

import type { BrushSettings } from '@/types';
import { resolvePressureSizing } from '@/utils/pressureSizing';
import { resolveBrushPressureRange } from '@/utils/pressureSettings';

/**
 * Calculate grid spacing from brush settings
 */
export const calculateGridSpacing = (): number => {
  const defaultSpacing = 16;
  return Math.max(2, defaultSpacing);
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
  const safeSpacing = gridSpacing || 1;
  const snappedX = Math.sign(x) * Math.round(Math.abs(x) / safeSpacing) * safeSpacing;
  const snappedY = Math.sign(y) * Math.round(Math.abs(y) / safeSpacing) * safeSpacing;
  return {
    x: Number.isNaN(snappedX) ? 0 : snappedX,
    y: Number.isNaN(snappedY) ? 0 : snappedY
  };
};

/**
 * Calculate spacing between brush stamps
 */
export const calculateBrushSpacing = (
  brushSettings: BrushSettings,
  baseSize: number
): number => {
  const rawSpacing = typeof brushSettings.spacing === 'number' ? brushSettings.spacing : 0.1;
  const effectiveBaseSize = baseSize || brushSettings.size || 1;
  const isRatio = rawSpacing > 0 && rawSpacing < 1;
  const calculated = isRatio ? effectiveBaseSize * rawSpacing : rawSpacing;
  return Math.max(0.5, calculated || 0);
};

/**
 * Calculate pressure-modified brush size with smooth curve
 */
export const calculatePressureSize = (
  baseSize: number,
  pressure: number,
  minPercent: number,
  maxPercent: number,
  pressureEnabled: boolean
): number => {
  const sizing = resolvePressureSizing(baseSize, {
    enabled: pressureEnabled,
    minPercent,
    maxPercent,
  });

  return Math.max(1, Math.round(sizing.sample(pressure) * 2));
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
 * Determine if pigment lift should be skipped for this point when transparency lock is enabled.
 * We reuse the same sampling as checkTransparencyLock to avoid erasing fully transparent pixels.
 */
export const shouldSkipPigmentLiftWithTransparencyLock = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  transparencyLockEnabled?: boolean
): boolean => checkTransparencyLock(ctx, x, y, transparencyLockEnabled);

/**
 * Factory to create utility functions with injected settings
 */
export const createBrushUtilities = (getSettings: () => BrushSettings) => {
  return {
    calculateGridSpacing,
    shouldApplyGridSnap: () => shouldApplyGridSnapPure(getSettings()),
    snapToGrid: (x: number, y: number) => {
      const spacing = calculateGridSpacing();
      return snapToGridPure(x, y, spacing);
    },
    calculateBrushSpacing: (baseSize: number) => 
      calculateBrushSpacing(getSettings(), baseSize),
    calculatePressureSize: (baseSize: number, pressure: number) => {
      const settings = getSettings();
      const resolvedRange = resolveBrushPressureRange(settings);
      return calculatePressureSize(
        baseSize,
        pressure,
        resolvedRange.minPercent,
        resolvedRange.maxPercent,
        resolvedRange.enabled
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
