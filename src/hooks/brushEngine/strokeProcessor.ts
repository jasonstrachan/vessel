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
  type RotationConfig,
  type RotationInput
} from './rotation';
import { calculateBrushSpacing } from './utilities';
import { createPixelQueue, resetPixelQueue } from './strokePixelQueue';
import { createPigmentLiftController } from './strokePigmentLift';
import {
  drawPixelPerfectLine as drawPixelPerfectLineWithContext,
  perfectPixels as perfectPixelsWithContext,
} from './strokePixelPerfect';

export { createPixelQueue, resetPixelQueue } from './strokePixelQueue';

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
    centerAlignment?: boolean,
    customPatternDimensions?: { width: number; height: number }
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
 * Determine if a stamp should be drawn based on dash settings
 */
export const shouldDrawStamp = (
  brushSettings: BrushSettings,
  queue: PixelQueue,
  actualSize?: number,
  isGridSnapping: boolean = false,
  speedSamplePxPerMs?: number,
  phaseAdvancePx?: number
): boolean => {
  // Defensive checks for brush settings
  if (!brushSettings || typeof brushSettings !== 'object') {
    return true;
  }
  
  const dashedEnabled = brushSettings.dashedEnabled;
  const dashLength = brushSettings.dashLength;
  const dashGap = brushSettings.dashGap;
  const velocityDashGapStrengthRaw = Number(brushSettings.velocityDashGapStrength);
  const velocityDashGapStrength = Number.isFinite(velocityDashGapStrengthRaw)
    ? Math.max(0, Math.min(10, velocityDashGapStrengthRaw))
    : 1;
  
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
  
  // Scale dash length and gap using real rendered spacing so values stay linear with brush size
  // instead of growing quadratically when spacing is percentage-based.
  const brushSize = Number(actualSize || brushSettings.size) || 4;
  const spacingPx = calculateBrushSpacing(brushSettings, brushSize, speedSamplePxPerMs);

  // Convert desired physical lengths (multipliers of brush size) into stamp counts.
  // For the dash we subtract one brush size so a value of 1 roughly paints one-brush-length
  // instead of two due to the stamp footprint at both ends.
  const dashDistance = baseDashLen * brushSize;
  const dashLen = brushSize <= 2
    ? baseDashLen
    : Math.max(1, 1 + Math.round(Math.max(dashDistance - brushSize, 0) / spacingPx));

  // For the gap we target center-to-center distance so the blank space between footprints
  // (minus the brush diameter) matches the user input. Subtract one slot because the next
  // dash draw happens after the gap slots are consumed.
  const gapDistance = baseDashGapLen * brushSize;
  const rawGapSlots = (gapDistance + brushSize) / spacingPx - 1;
  const dashGapLen = brushSize <= 2
    ? baseDashGapLen
    : Math.max(1, Math.round(Math.max(rawGapSlots, 0)));

  const speedSample = Number(speedSamplePxPerMs);
  const rawSpeedPxPerMs = Number.isFinite(speedSample) ? Math.max(0, Math.min(4, speedSample)) : 0;
  const prevEma = Number.isFinite(queue.dashVelocityEma) ? queue.dashVelocityEma : 0;
  // Smooth velocity strongly to avoid visible dash jitter from per-segment timestamp noise.
  const speedEma = prevEma + (rawSpeedPxPerMs - prevEma) * 0.12;
  queue.dashVelocityEma = speedEma;
  const speedDeadzone = 0.04;
  const speedRange = 0.9;
  const speedNormLinear = Math.max(0, Math.min(1, (speedEma - speedDeadzone) / speedRange));
  const speedNorm = Math.pow(speedNormLinear, 1.35);
  // Make low V values intentionally gentle and reserve stronger behavior for higher settings.
  const strengthNorm = Math.pow(Math.max(0, Math.min(1, velocityDashGapStrength / 10)), 1.7);
  const velocityGapBoost = strengthNorm * speedNorm * 2.2;
  const dashPaintPx = Math.max(spacingPx, dashLen * spacingPx);
  const gapPx = Math.max(spacingPx, dashGapLen * spacingPx) * (1 + velocityGapBoost);
  const cyclePx = dashPaintPx + gapPx;
  const currentPhase = ((queue.dashPhasePx % cyclePx) + cyclePx) % cyclePx;
  const isInDashSegment = currentPhase < dashPaintPx;
  const safeAdvance = Number.isFinite(phaseAdvancePx) ? Math.max(0, phaseAdvancePx as number) : spacingPx;
  queue.dashPhasePx = (currentPhase + safeAdvance) % cyclePx;
  queue.dashStampCounter++;
  
  return isInDashSegment;
};

/**
 * Factory function to create a stroke processor with injected dependencies
 */
export const createStrokeProcessor = (deps: StrokeProcessorDependencies) => {
  // Private state for the processor
  const velocityHistory: number[] = [];
  const directionHistory: number[] = [];
  let lastDirection = 0;
  const pigmentLift = createPigmentLiftController();
  const pixelPerfectContext = {
    shouldDrawStamp,
    applyThrottledColorJitter: deps.applyThrottledColorJitter,
    drawShape: deps.drawShape,
    applyPigmentLift: pigmentLift.applyPigmentLift,
  };
  
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
    perfectPixelsWithContext(ctx, currentX, currentY, settings, queue, brushSettings, pixelPerfectContext);
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
    drawPixelPerfectLineWithContext(ctx, x0, y0, x1, y1, settings, queue, brushSettings, pixelPerfectContext);
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
      pigmentLift.reset();
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
    shouldDrawStamp: (
      brushSettings: BrushSettings,
      queue: PixelQueue,
      size?: number,
      isGridSnapping?: boolean,
      speedSamplePxPerMs?: number,
      phaseAdvancePx?: number
    ) => boolean;
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
      centerAlignment?: boolean,
      customPatternDimensions?: { width: number; height: number }
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
    shouldDrawStamp: (
      brushSettings: BrushSettings,
      queue: PixelQueue,
      size?: number,
      isGridSnapping?: boolean,
      speedSamplePxPerMs?: number,
      phaseAdvancePx?: number
    ) => boolean;
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
      centerAlignment?: boolean,
      customPatternDimensions?: { width: number; height: number }
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
