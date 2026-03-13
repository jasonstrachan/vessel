/**
 * Utility functions extracted from useBrushEngine
 * Pure functions without hook dependencies
 */

import type { BrushSettings } from '@/types';
import { resolvePressureSizing } from '@/utils/pressureSizing';
import { resolveBrushPressureRange } from '@/utils/pressureSettings';
import { resolveVelocityAdjustedSpacing } from '@/utils/velocitySpacing';

type CustomBrushSpacingSource = {
  width: number;
  height: number;
};

const resolveExactCustomBrushSpacing = (
  brushSettings: BrushSettings,
  baseSize: number,
  customBrush?: CustomBrushSpacingSource
): number | null => {
  if (!brushSettings.customBrushSnapEnabled || !customBrush) {
    return null;
  }

  const width = Number(customBrush.width);
  const height = Number(customBrush.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }

  const maxDimension = Math.max(width, height);
  if (maxDimension <= 0) {
    return null;
  }

  const scaledWidth = Math.max(1, Math.round((width * baseSize) / maxDimension));
  return scaledWidth;
};

/**
 * Calculate grid spacing from brush settings
 */
export const calculateGridSpacing = (brushSettings?: BrushSettings): number => {
  const defaultSpacing = 16;
  const configuredSpacing = brushSettings?.gridSnapSize ?? defaultSpacing;
  const normalized = Number.isFinite(configuredSpacing)
    ? Math.round(configuredSpacing)
    : defaultSpacing;
  return Math.max(1, normalized);
};

/**
 * Scale grid spacing with live pressure so snap distance tracks the rendered brush size.
 */
export const calculatePressureAwareGridSpacing = (
  brushSettings?: BrushSettings,
  pressure?: number
): number => {
  const baseSpacing = calculateGridSpacing(brushSettings);
  if (!brushSettings?.pressureEnabled || !Number.isFinite(pressure)) {
    return baseSpacing;
  }
  const safePressure = pressure ?? 1;

  const resolvedRange = resolveBrushPressureRange(brushSettings);
  if (!resolvedRange.enabled) {
    return baseSpacing;
  }

  const sizing = resolvePressureSizing(baseSpacing, {
    enabled: resolvedRange.enabled,
    minPercent: resolvedRange.minPercent,
    maxPercent: resolvedRange.maxPercent,
  });

  return Math.max(1, Math.round(sizing.sample(safePressure) * 2));
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
  baseSize: number,
  speedSamplePxPerMs?: number,
  customBrush?: CustomBrushSpacingSource
): number => {
  const effectiveBaseSize = baseSize || brushSettings.size || 1;
  const exactCustomBrushSpacing = resolveExactCustomBrushSpacing(
    brushSettings,
    effectiveBaseSize,
    customBrush
  );
  const rawSpacing = typeof brushSettings.spacing === 'number' ? brushSettings.spacing : 0.1;
  const isRatio = rawSpacing > 0 && rawSpacing < 1;
  const baseSpacing = exactCustomBrushSpacing ?? ((isRatio ? effectiveBaseSize * rawSpacing : rawSpacing) || 0);
  const velocityAdjustedSpacing = resolveVelocityAdjustedSpacing({
    baseSpacing,
    baseSize: effectiveBaseSize,
    enabled: brushSettings.velocitySpacingEnabled,
    speedPxPerMs: speedSamplePxPerMs,
  });
  return Math.max(0.5, velocityAdjustedSpacing);
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
    calculateGridSpacing: (pressure?: number) =>
      calculatePressureAwareGridSpacing(getSettings(), pressure),
    shouldApplyGridSnap: () => shouldApplyGridSnapPure(getSettings()),
    snapToGrid: (x: number, y: number, pressure?: number) => {
      const spacing = calculatePressureAwareGridSpacing(getSettings(), pressure);
      return snapToGridPure(x, y, spacing);
    },
    calculateBrushSpacing: (
      baseSize: number,
      speedSamplePxPerMs?: number,
      customBrush?: CustomBrushSpacingSource
    ) =>
      calculateBrushSpacing(getSettings(), baseSize, speedSamplePxPerMs, customBrush),
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
