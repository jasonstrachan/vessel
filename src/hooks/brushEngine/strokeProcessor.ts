/**
 * Stroke processing and interpolation algorithms
 * Extracted from useBrushEngine for better modularity
 * Uses factory pattern for stateful operations
 */

import { BrushShape } from '@/types';
import type { BrushSettings } from '@/types';
import type { PixelQueue, RenderSettings } from './types';
import { 
  calculateRotation, 
  createDirectionState, 
  createDefaultRotationConfig,
  type DirectionState,
  type RotationConfig,
  type RotationInput 
} from './rotation';

// Performance: Pre-calculated constants
const QUANTIZE_STEP_SIZE = 0.5;
const INV_QUANTIZE_STEP = 1 / QUANTIZE_STEP_SIZE;

/**
 * Dependencies for stroke processor
 */
export interface StrokeProcessorDependencies {
  applyThrottledColorJitter: (color: string, jitterAmount: number) => string;
  drawShape: (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    shape: BrushShape,
    antiAliasing: boolean,
    rotation: number,
    risographIntensity: number,
    pattern?: ImageData,
    centerAlignment?: boolean
  ) => void;
}

/**
 * Quantize brush size to prevent micro-variations
 */
export const quantizeBrushSize = (size: number): number => {
  return Math.round(size * INV_QUANTIZE_STEP) / INV_QUANTIZE_STEP;
};

/**
 * Calculate smoothed velocity using weighted average
 */
export const calculateSmoothedVelocity = (
  rawVelocity: number,
  velocityHistory: number[]
): number => {
  // Add to velocity history
  velocityHistory.push(rawVelocity);
  
  // Keep only last 5 samples for smoothing
  if (velocityHistory.length > 5) {
    velocityHistory.shift();
  }
  
  // Calculate weighted average (more recent = higher weight)
  const weights = [0.1, 0.15, 0.2, 0.25, 0.3];
  let weightedSum = 0;
  let weightSum = 0;
  
  for (let i = 0; i < velocityHistory.length; i++) {
    const weight = weights[i] || weights[weights.length - 1];
    weightedSum += velocityHistory[i] * weight;
    weightSum += weight;
  }
  
  return weightSum > 0 ? weightedSum / weightSum : rawVelocity;
};

/**
 * Calculate and smooth direction from movement vector
 * @deprecated Use rotation module's calculateRotation instead
 */
export const calculateSmoothDirection = (
  from: { x: number; y: number },
  to: { x: number; y: number },
  directionHistory: number[],
  lastDirection: number,
  cursorPressure: number = 1.0
): number => {
  // Create a temporary direction state for backward compatibility
  const directionState = createDirectionState();
  directionState.history = [...directionHistory];
  directionState.lastDirection = lastDirection;
  
  // Use rotation module with direction mode
  const rotationConfig: RotationConfig = {
    enabled: true,
    mode: 'direction',
    smoothing: cursorPressure < 0.98 ? 0.3 : 0.6 // Adaptive smoothing
  };
  
  const rotationInput: RotationInput = {
    from,
    to,
    pressure: cursorPressure
  };
  
  const direction = calculateRotation(rotationConfig, rotationInput, directionState);
  
  // Update history for backward compatibility
  directionHistory.length = 0;
  directionHistory.push(...directionState.history);
  
  return direction;
};

/**
 * Legacy direction calculation - keeping for reference
 * @deprecated
 */
const legacyCalculateSmoothDirection = (
  from: { x: number; y: number },
  to: { x: number; y: number },
  directionHistory: number[],
  lastDirection: number,
  cursorPressure: number = 1.0
): number => {
  const deltaX = to.x - from.x;
  const deltaY = to.y - from.y;
  const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
  
  // Detect stylus vs mouse input
  const isStylusInput = cursorPressure < 0.98; // Stylus typically has variable pressure
  
  // Adaptive smoothing based on input type
  const minDistance = isStylusInput ? 1.5 : 3; // Stylus: more responsive, Mouse: more filtered
  const historySize = isStylusInput ? 4 : 7; // Stylus: shorter history, Mouse: longer history
  
  // If movement is very small, keep last direction to avoid jitter
  if (distance < minDistance) {
    return lastDirection;
  }
  
  // Calculate direction angle (radians)
  // Note: atan2 returns angle from -PI to PI
  const direction = Math.atan2(deltaY, deltaX);
  
  // Add to history for smoothing
  directionHistory.push(direction);
  
  // Keep adaptive history size
  if (directionHistory.length > historySize) {
    directionHistory.shift();
  }
  
  // Smooth direction using weighted average with adaptive weights
  let smoothedDirection = direction;
  if (directionHistory.length > 1) {
    // Adaptive weight distribution based on input type
    const weights = isStylusInput 
      ? [0.45, 0.30, 0.20, 0.05] // Stylus: more emphasis on recent directions
      : [0.25, 0.20, 0.18, 0.15, 0.12, 0.07, 0.03]; // Mouse: gradual smoothing
    
    let weightSum = 0;
    let sinSum = 0;
    let cosSum = 0;
    
    // Use circular averaging to handle angle wraparound properly
    for (let i = 0; i < directionHistory.length; i++) {
      const weight = weights[directionHistory.length - 1 - i] || 0.02;
      const angle = directionHistory[i];
      sinSum += Math.sin(angle) * weight;
      cosSum += Math.cos(angle) * weight;
      weightSum += weight;
    }
    
    // Convert back to angle using atan2 for proper quadrant
    // Only update if we have valid sum values
    if (weightSum > 0 && (Math.abs(sinSum) > 0.001 || Math.abs(cosSum) > 0.001)) {
      smoothedDirection = Math.atan2(sinSum / weightSum, cosSum / weightSum);
    }
  }
  
  // Apply final smoothing only if we have a valid last direction
  if (directionHistory.length > 1 && !isNaN(lastDirection)) {
    // Calculate shortest angular distance between angles
    let angleDiff = smoothedDirection - lastDirection;
    
    // Normalize to [-PI, PI] for shortest rotation path
    while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
    while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
    
    // Define thresholds
    const minAngleThreshold = Math.PI / 180 * 1; // 1 degree minimum to prevent micro-jitter
    const maxRotation = Math.PI / 12; // 15 degrees max per frame (significantly reduced)
    
    // Apply smoothing based on angle difference
    if (Math.abs(angleDiff) < minAngleThreshold) {
      // Too small - use previous direction to prevent jitter
      smoothedDirection = lastDirection;
    } else {
      // Clamp the angle difference to maximum allowed
      const clampedDiff = Math.max(-maxRotation, Math.min(maxRotation, angleDiff));
      
      // Apply smoothing factor - REDUCED to fix double rotation appearance
      // The visual rotation appears doubled because the brush stamp itself might be asymmetric
      // Halving the rotation response compensates for this
      const smoothingFactor = isStylusInput ? 0.25 : 0.15; // Halved to fix double rotation
      smoothedDirection = lastDirection + clampedDiff * smoothingFactor;
      
      // Normalize result to [-PI, PI]
      while (smoothedDirection > Math.PI) smoothedDirection -= 2 * Math.PI;
      while (smoothedDirection < -Math.PI) smoothedDirection += 2 * Math.PI;
    }
  }
  
  return smoothedDirection;
};

/**
 * Determine if a stamp should be drawn based on dash settings
 */
export const shouldDrawStamp = (
  brushSettings: BrushSettings,
  queue: PixelQueue,
  actualSize?: number,
  isGridSnapping: boolean = false
): boolean => {
  // Defensive checks for brush settings
  if (!brushSettings || typeof brushSettings !== 'object') {
    return true;
  }
  
  const dashedEnabled = brushSettings.dashedEnabled;
  const dashLength = brushSettings.dashLength;
  const dashGap = brushSettings.dashGap;
  
  // When grid snapping is enabled, prioritize grid positioning over dash patterns
  if (isGridSnapping) {
    // For grid snapping, we always draw (grid position tracking handles duplicates)
    return true;
  }
  
  if (!dashedEnabled) {
    return true; // Always draw when dashing is disabled
  }
  
  // More defensive checks
  const baseDashLen = Number(dashLength) || 3;
  const baseDashGapLen = Number(dashGap) || 2;
  
  if (baseDashLen <= 0 || baseDashGapLen <= 0) {
    return true; // Invalid settings, default to drawing
  }
  
  // Scale dash length and gap with brush size for consistent visual proportions
  // Use actual render size (including pressure effects) for accurate dash scaling
  const brushSize = Number(actualSize || brushSettings.size) || 4;
  
  let dashLen: number;
  let dashGapLen: number;
  
  if (brushSize <= 2) {
    // For very small brushes (1-2px), use original values to ensure visible dashing
    dashLen = baseDashLen;
    dashGapLen = baseDashGapLen;
  } else {
    // For larger brushes, scale proportionally
    const sizeScaleFactor = brushSize / 4; // No minimum to allow proper scaling
    dashLen = Math.max(1, Math.round(baseDashLen * sizeScaleFactor));
    dashGapLen = Math.max(1, Math.round(baseDashGapLen * sizeScaleFactor));
  }
  
  // Calculate total cycle length in stamps
  const totalCycleLength = dashLen + dashGapLen;
  
  // Get current position in dash cycle
  const cyclePosition = queue.dashStampCounter % totalCycleLength;
  
  // Determine if we're in dash or gap segment
  const isInDashSegment = cyclePosition < dashLen;
  
  // Advance counter for next stamp (happens regardless of whether we draw)
  queue.dashStampCounter++;
  
  return isInDashSegment;
};

/**
 * Create initial pixel queue state
 */
export const createPixelQueue = (): PixelQueue => ({
  initialized: false,
  lastDrawnX: 0,
  lastDrawnY: 0,
  waitingPixelX: 0,
  waitingPixelY: 0,
  spacingCounter: 0,
  lastStrokePosition: { x: 0, y: 0 },
  accumulatedDistance: 0,
  stampedGridPositions: new Set<string>(),
  dashStampCounter: 0,
  drawnPixels: new Set<string>()
});

/**
 * Reset pixel queue state
 */
export const resetPixelQueue = (queue: PixelQueue): void => {
  queue.initialized = false;
  queue.lastDrawnX = 0;
  queue.lastDrawnY = 0;
  queue.waitingPixelX = 0;
  queue.waitingPixelY = 0;
  queue.spacingCounter = 0;
  queue.lastStrokePosition = { x: 0, y: 0 };
  queue.accumulatedDistance = 0;
  queue.stampedGridPositions.clear();
  queue.dashStampCounter = 0;
  queue.drawnPixels.clear();
};

/**
 * Factory function to create a stroke processor with injected dependencies
 */
export const createStrokeProcessor = (deps: StrokeProcessorDependencies) => {
  // Private state for the processor
  const velocityHistory: number[] = [];
  const directionHistory: number[] = [];
  let lastDirection = 0;
  
  /**
   * Perfect pixel placement for pixel art
   * Uses the waiting pixel algorithm from monolithic implementation:
   * - Keeps track of lastDrawn, current, and waiting pixels
   * - Only draws when current pixel is not a neighbor of lastDrawn
   * - This ensures smooth lines without pixel doubling
   */
  const perfectPixels = (
    ctx: CanvasRenderingContext2D,
    currentX: number,
    currentY: number,
    settings: RenderSettings,
    queue: PixelQueue,
    brushSettings: BrushSettings
  ) => {
    const roundedX = Math.round(currentX);
    const roundedY = Math.round(currentY);
    
    if (!queue.initialized) {
      // First pixel - initialize queue
      queue.lastDrawnX = roundedX;
      queue.lastDrawnY = roundedY;
      queue.waitingPixelX = roundedX;
      queue.waitingPixelY = roundedY;
      queue.initialized = true;
      queue.spacingCounter = 0;
      queue.lastStrokePosition = { x: roundedX, y: roundedY };
      queue.accumulatedDistance = 0;
      
      // Draw the first pixel
      if (shouldDrawStamp(brushSettings, queue, settings.size, false)) {
        const jitteredColor = deps.applyThrottledColorJitter(settings.color, brushSettings.colorJitter || 0);
        ctx.fillStyle = jitteredColor;
        deps.drawShape(ctx, roundedX, roundedY, settings.size, settings.shape, false, settings.rotation, settings.risographIntensity, settings.pattern, settings.centerAlignment);
      }
      
      return;
    }
    
    // Calculate distance from last stroke position to current position
    const distance = Math.sqrt(
      Math.pow(roundedX - queue.lastStrokePosition.x, 2) + 
      Math.pow(roundedY - queue.lastStrokePosition.y, 2)
    );
    queue.accumulatedDistance += distance;
    
    // Apply waiting pixel algorithm for ALL brushes (from original working implementation)
    // If current pixel is NOT a neighbor to lastDrawn, draw waiting pixel
    if (Math.abs(roundedX - queue.lastDrawnX) > 1 || Math.abs(roundedY - queue.lastDrawnY) > 1) {
      // Draw the waiting shape only if accumulated distance exceeds spacing
      if (queue.accumulatedDistance >= settings.spacing) {
        // Check if we should draw this stamp (cursor-speed independent)
        if (shouldDrawStamp(brushSettings, queue, settings.size, false)) {
          const jitteredColor = deps.applyThrottledColorJitter(settings.color, brushSettings.colorJitter || 0);
          ctx.fillStyle = jitteredColor;
          deps.drawShape(ctx, queue.waitingPixelX, queue.waitingPixelY, settings.size, settings.shape, false, settings.rotation, settings.risographIntensity, settings.pattern, settings.centerAlignment);
        }
        queue.accumulatedDistance -= settings.spacing;
        queue.lastStrokePosition = { x: queue.waitingPixelX, y: queue.waitingPixelY };
      }
      
      // Update queue
      queue.lastDrawnX = queue.waitingPixelX;
      queue.lastDrawnY = queue.waitingPixelY;
      queue.waitingPixelX = roundedX;
      queue.waitingPixelY = roundedY;
    } else {
      // Update waiting pixel to current position
      queue.waitingPixelX = roundedX;
      queue.waitingPixelY = roundedY;
    }
    
    // Update last stroke position for distance calculation
    queue.lastStrokePosition = { x: roundedX, y: roundedY };
  };
  
  /**
   * Draw a pixel-perfect line using Bresenham's algorithm
   */
  const drawPixelPerfectLine = (
    ctx: CanvasRenderingContext2D,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    settings: RenderSettings,
    queue: PixelQueue,
    brushSettings: BrushSettings
  ) => {
    // Bresenham's line algorithm for pixel-perfect lines
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    
    let x = x0;
    let y = y0;
    
    while (true) {
      // Use perfectPixels for each point to ensure consistent behavior
      // This applies the waiting pixel algorithm universally
      perfectPixels(ctx, x, y, settings, queue, brushSettings);
      
      if (x === x1 && y === y1) break;
      
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
    }
  };
  
  // Return the public API
  return {
    // Stateless utilities (can be used directly)
    quantizeBrushSize,
    
    // Stateful operations
    calculateSmoothedVelocity: (rawVelocity: number) => 
      calculateSmoothedVelocity(rawVelocity, velocityHistory),
    
    calculateSmoothDirection: (
      from: { x: number; y: number },
      to: { x: number; y: number },
      cursorPressure: number = 1.0
    ) => {
      const result = calculateSmoothDirection(from, to, directionHistory, lastDirection, cursorPressure);
      lastDirection = result;
      return result;
    },
    
    shouldDrawStamp,
    perfectPixels,
    drawPixelPerfectLine,
    
    // Queue management
    createPixelQueue,
    resetPixelQueue,
    
    // State reset
    reset: () => {
      velocityHistory.length = 0;
      directionHistory.length = 0;
      lastDirection = 0;
    }
  };
};

// Export legacy functions for backward compatibility
export const perfectPixels = (
  ctx: CanvasRenderingContext2D,
  currentX: number,
  currentY: number,
  settings: RenderSettings,
  queue: PixelQueue,
  context: {
    shouldDrawStamp: (brushSettings: BrushSettings, queue: PixelQueue, size?: number, isGridSnapping?: boolean) => boolean;
    applyThrottledColorJitter: (color: string, jitterAmount: number) => string;
    drawShape: (
      ctx: CanvasRenderingContext2D,
      x: number,
      y: number,
      size: number,
      shape: any,
      antiAliasing: boolean,
      rotation: number,
      risographIntensity: number,
      pattern?: ImageData,
      centerAlignment?: boolean
    ) => void;
  },
  brushSettings: BrushSettings
) => {
  const processor = createStrokeProcessor({
    applyThrottledColorJitter: context.applyThrottledColorJitter,
    drawShape: context.drawShape
  });
  
  processor.perfectPixels(ctx, currentX, currentY, settings, queue, brushSettings);
};

export const drawPixelPerfectLine = (
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  settings: RenderSettings,
  queue: PixelQueue,
  context: {
    shouldDrawStamp: (brushSettings: BrushSettings, queue: PixelQueue, size?: number) => boolean;
    applyThrottledColorJitter: (color: string, jitterAmount: number) => string;
    drawShape: (
      ctx: CanvasRenderingContext2D,
      x: number,
      y: number,
      size: number,
      shape: any,
      antiAliasing: boolean,
      rotation: number,
      risographIntensity: number,
      pattern?: ImageData,
      centerAlignment?: boolean
    ) => void;
  },
  brushSettings: BrushSettings
) => {
  const processor = createStrokeProcessor({
    applyThrottledColorJitter: context.applyThrottledColorJitter,
    drawShape: context.drawShape
  });
  
  processor.drawPixelPerfectLine(ctx, x0, y0, x1, y1, settings, queue, brushSettings);
};