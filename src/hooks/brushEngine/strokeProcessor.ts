/**
 * Stroke processing and interpolation algorithms
 * Extracted from useBrushEngine for better modularity
 * Uses factory pattern for stateful operations
 */

import { logError } from '@/utils/debug';
import { BrushShape } from '@/types';
import { isFeatureFlagEnabled } from '@/config/featureFlags';
import type { BrushSettings } from '@/types';
import type { PixelQueue, RenderSettings } from './types';
import { shouldSkipPigmentLiftWithTransparencyLock } from './utilities';
import {
  calculateRotation,
  createDirectionState,
  type RotationConfig,
  type RotationInput
} from './rotation';
import { calculateBrushSpacing } from './utilities';

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
 * Create initial pixel queue state
 */
export function createPixelQueue(): PixelQueue {
  type PixelQueueTask = {
    kind: 'paint';
    mergeable: false;
    run: () => void;
  };

  const tasks: PixelQueueTask[] = [];
  let taskHead = 0;
  let rafId: number | null = null;
  const idleListeners: Array<() => void> = [];
  let idleHead = 0;
  const hasWindow = typeof window !== 'undefined';
  const requestFrame = hasWindow && typeof window.requestAnimationFrame === 'function'
    ? window.requestAnimationFrame.bind(window)
    : null;
  const cancelFrame = hasWindow && typeof window.cancelAnimationFrame === 'function'
    ? window.cancelAnimationFrame.bind(window)
    : null;

  let dirtyRect: { x: number; y: number; w: number; h: number } | null = null;
  let pendingDirtyFrame: number | null = null;
  let pendingDirtyTimeout: ReturnType<typeof setTimeout> | null = null;

  const now = () => {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now();
    }
    return Date.now();
  };

  const BUDGET_MS = 6;
  const MAX_TASKS = 512;
  const MAX_PENDING_PIXEL_TASKS = 2048;
  const QUEUE_COMPACT_INTERVAL = 1024;
  const debtControlEnabled = isFeatureFlagEnabled('enableSequentialTypedQueueDebtControl');

  const taskCount = () => tasks.length - taskHead;

  const compactTasksIfNeeded = () => {
    if (taskHead <= QUEUE_COMPACT_INTERVAL || taskHead <= tasks.length / 2) {
      return;
    }
    tasks.splice(0, taskHead);
    taskHead = 0;
  };

  const shiftTask = (): PixelQueueTask | null => {
    if (taskHead >= tasks.length) {
      return null;
    }
    const task = tasks[taskHead];
    taskHead += 1;
    compactTasksIfNeeded();
    return task;
  };

  const runTask = (task: PixelQueueTask) => {
    try {
      task.run();
    } catch (error) {
      logError('[PixelQueue] Task execution failed:', error);
    }
  };

  const notifyIdle = () => {
    if (taskCount() > 0 || rafId != null) {
      return;
    }
    if (idleHead >= idleListeners.length) {
      return;
    }
    const callbacks = idleListeners.slice(idleHead);
    idleHead = idleListeners.length;
    if (idleHead > QUEUE_COMPACT_INTERVAL && idleHead > idleListeners.length / 2) {
      idleListeners.splice(0, idleHead);
      idleHead = 0;
    }
    for (const cb of callbacks) {
      try {
        cb();
      } catch (error) {
        logError('[PixelQueue] Idle callback failed:', error);
      }
    }
  };

  const dispatchDirtyRect = () => {
    pendingDirtyFrame = null;
    if (pendingDirtyTimeout != null) {
      clearTimeout(pendingDirtyTimeout);
      pendingDirtyTimeout = null;
    }
    if (!dirtyRect || !hasWindow) {
      dirtyRect = null;
      return;
    }
    const rect = dirtyRect;
    dirtyRect = null;
    try {
      window.dispatchEvent(
        new CustomEvent('colorCycleFrameUpdate', {
          detail: {
            onlyActiveLayer: true,
            roi: { x: rect.x, y: rect.y, width: rect.w, height: rect.h }
          }
        })
      );
    } catch (error) {
      logError('[PixelQueue] Failed to dispatch dirty rect:', error);
    }
  };

  const scheduleDirtyDispatch = () => {
    if (!dirtyRect || !hasWindow) {
      return;
    }
    if (pendingDirtyFrame != null) {
      return;
    }
    if (requestFrame) {
      pendingDirtyFrame = requestFrame(dispatchDirtyRect);
    } else {
      pendingDirtyTimeout = setTimeout(dispatchDirtyRect, 0);
    }
  };

  const tick = () => {
    rafId = null;
    if (taskCount() === 0) {
      if (dirtyRect) {
        scheduleDirtyDispatch();
      }
      notifyIdle();
      return;
    }

    const start = now();
    let processed = 0;
    while (taskCount() > 0 && processed < MAX_TASKS) {
      const nextTask = shiftTask();
      if (!nextTask) {
        break;
      }
      runTask(nextTask);
      processed++;
      if (now() - start >= BUDGET_MS) {
        break;
      }
    }

    if (dirtyRect) {
      scheduleDirtyDispatch();
    }

    if (taskCount() > 0) {
      if (requestFrame) {
        rafId = requestFrame(tick);
      } else {
        // No RAF (e.g., SSR). Process synchronously to avoid stalling.
        tick();
      }
    } else {
      notifyIdle();
    }
  };

  const enqueue = (fn: () => void) => {
    tasks.push({ kind: 'paint', mergeable: false, run: fn });
    if (debtControlEnabled && taskCount() > MAX_PENDING_PIXEL_TASKS) {
      const catchUpStart = now();
      while (taskCount() > MAX_PENDING_PIXEL_TASKS / 2) {
        const task = shiftTask();
        if (!task) {
          break;
        }
        runTask(task);
        if (now() - catchUpStart >= BUDGET_MS * 3) {
          break;
        }
      }
    }
    if (rafId != null) {
      return;
    }
    if (requestFrame) {
      rafId = requestFrame(tick);
    } else {
      tick();
    }
  };

  const flushNow = () => {
    if (rafId != null && cancelFrame) {
      cancelFrame(rafId);
    }
    if (pendingDirtyFrame != null) {
      if (cancelFrame) {
        cancelFrame(pendingDirtyFrame);
      }
      pendingDirtyFrame = null;
    }
    if (pendingDirtyTimeout != null) {
      clearTimeout(pendingDirtyTimeout);
      pendingDirtyTimeout = null;
    }
    rafId = null;
    while (taskCount() > 0) {
      const task = shiftTask();
      if (!task) {
        break;
      }
      runTask(task);
    }
    if (dirtyRect) {
      dispatchDirtyRect();
    }
    notifyIdle();
  };

  const onIdle = (cb: () => void) => {
    if (typeof cb !== 'function') {
      return;
    }
    if (taskCount() === 0 && rafId == null) {
      Promise.resolve().then(() => {
        try {
          cb();
        } catch (error) {
          logError('[PixelQueue] Idle callback failed:', error);
        }
      });
      return;
    }
    idleListeners.push(cb);
  };

  const addDirtyRect = (x: number, y: number, width: number, height: number) => {
    if (width <= 0 || height <= 0) {
      return;
    }
    const rect = dirtyRect;
    if (!rect) {
      dirtyRect = { x, y, w: width, h: height };
      return;
    }
    const minX = Math.min(rect.x, x);
    const minY = Math.min(rect.y, y);
    const maxX = Math.max(rect.x + rect.w, x + width);
    const maxY = Math.max(rect.y + rect.h, y + height);
    dirtyRect = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  };

  return {
    initialized: false,
    lastDrawnX: 0,
    lastDrawnY: 0,
    waitingPixelX: 0,
    waitingPixelY: 0,
    spacingCounter: 0,
    lastStrokePosition: { x: 0, y: 0 },
    accumulatedDistance: 0,
    lastLiftPosition: null,
    stampedGridPositions: new Set<string>(),
    dashPhasePx: 0,
    dashVelocityEma: 0,
    dashStampCounter: 0,
    drawnPixels: new Set<string>(),
    enqueue,
    flushNow,
    onIdle,
    addDirtyRect
  };
}

/**
 * Reset pixel queue state
 */
export const resetPixelQueue = (queue: PixelQueue): void => {
  queue.flushNow();
  queue.initialized = false;
  queue.lastDrawnX = 0;
  queue.lastDrawnY = 0;
  queue.waitingPixelX = 0;
  queue.waitingPixelY = 0;
  queue.spacingCounter = 0;
  queue.lastStrokePosition = { x: 0, y: 0 };
  queue.accumulatedDistance = 0;
  queue.lastLiftPosition = null;
  queue.stampedGridPositions.clear();
  queue.dashPhasePx = 0;
  queue.dashVelocityEma = 0;
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
  let pigmentLiftMask: HTMLCanvasElement | null = null;
  let pigmentLiftMaskKey = '';

  const buildPigmentLiftMask = (
    size: number,
    feather: number,
    noise: number
  ): HTMLCanvasElement | null => {
    if (typeof document === 'undefined') {
      return null;
    }

    const radius = Math.max(1, size / 2);
    const featherAmount = Math.max(0, feather);
    const maskSize = Math.max(2, Math.round(radius * 2 + featherAmount * 2));
    const key = `${maskSize}-${Math.round(featherAmount * 10)}-${Math.round(noise * 100)}`;

    if (pigmentLiftMask && pigmentLiftMaskKey === key) {
      return pigmentLiftMask;
    }

    const canvas = document.createElement('canvas');
    canvas.width = maskSize;
    canvas.height = maskSize;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return null;
    }

    const imageData = ctx.createImageData(maskSize, maskSize);
    const data = imageData.data;
    const cx = maskSize / 2;
    const cy = maskSize / 2;
    const noiseAmount = Math.min(1, Math.max(0, noise));

    for (let y = 0; y < maskSize; y += 1) {
      for (let x = 0; x < maskSize; x += 1) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const inCore = distance <= radius;
        let falloff = 0;
        if (!inCore && featherAmount > 0) {
          const over = distance - radius;
          falloff = Math.max(0, 1 - over / featherAmount);
        } else if (inCore) {
          falloff = 1;
        }

        if (falloff <= 0) {
          continue;
        }

        const noiseCut = noiseAmount > 0 ? noiseAmount * Math.random() : 0;
        // Amplify noise to open up more texture; occasional full holes
        const fullHole = noiseAmount > 0 && Math.random() < noiseAmount * 0.5;
        const alpha = fullHole
          ? 0
          : Math.max(0, Math.min(1, falloff * (1 - noiseCut * 1.6)));
        if (alpha <= 0) {
          continue;
        }

        const idx = (y * maskSize + x) * 4;
        data[idx] = 255;
        data[idx + 1] = 255;
        data[idx + 2] = 255;
        data[idx + 3] = Math.round(alpha * 255);
      }
    }

    ctx.putImageData(imageData, 0, 0);
    pigmentLiftMask = canvas;
    pigmentLiftMaskKey = key;
    return canvas;
  };

  const applyPigmentLift = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    settings: RenderSettings,
    brushSettings: BrushSettings
  ) => {
    const strength = Math.max(0, Math.min(1, brushSettings.pigmentLiftStrength ?? 0));
    if (
      !brushSettings.pigmentLiftEnabled ||
      strength <= 0 ||
      brushSettings.blendMode === 'destination-out'
    ) {
      return;
    }

    if (shouldSkipPigmentLiftWithTransparencyLock(ctx, x, y, brushSettings.transparencyLockEnabled)) {
      return;
    }

    const effectiveNoise = Math.min(1.2, (brushSettings.pigmentLiftNoise ?? 0) * 1.8);
    const mask = buildPigmentLiftMask(
      settings.size,
      brushSettings.pigmentLiftFeather ?? 0,
      effectiveNoise
    );

    if (!mask) {
      return;
    }

    const prevComposite = ctx.globalCompositeOperation;
    const prevAlpha = ctx.globalAlpha;

    ctx.globalCompositeOperation = 'destination-out';
    ctx.globalAlpha = strength;
    const drawX = x - mask.width / 2;
    const drawY = y - mask.height / 2;
    ctx.drawImage(mask, drawX, drawY);

    ctx.globalCompositeOperation = prevComposite;
    ctx.globalAlpha = prevAlpha;
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
    const roundedX = Math.round(currentX);
    const roundedY = Math.round(currentY);
    const usePixelSpacing = settings.pixelAlignment ||
      settings.shape === BrushShape.PIXEL_ROUND ||
      settings.shape === BrushShape.PIXEL_DITHER;
    const spacingThreshold = usePixelSpacing
      ? Math.max(1, Math.round(settings.spacing || 1))
      : Math.max(settings.spacing, 0.0001);

    // Apply lift at its own cadence so fast strokes still show breakup
    const liftSpacing = Math.max(1, Math.min(settings.size, settings.size * 0.35));
    const lastLift = queue.lastLiftPosition;
    const distSinceLift = lastLift
      ? Math.max(Math.abs(roundedX - lastLift.x), Math.abs(roundedY - lastLift.y))
      : Infinity;
    if (distSinceLift >= liftSpacing) {
      applyPigmentLift(ctx, roundedX, roundedY, settings, brushSettings);
      queue.lastLiftPosition = { x: roundedX, y: roundedY };
    }
    
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
      if (shouldDrawStamp(
        brushSettings,
        queue,
        settings.size,
        false,
        settings.speedSamplePx,
        0
      )) {
        applyPigmentLift(ctx, roundedX, roundedY, settings, brushSettings);
        const jitteredColor = deps.applyThrottledColorJitter(settings.color, brushSettings.colorJitter || 0);
        ctx.fillStyle = jitteredColor;
        deps.drawShape(
          ctx,
          roundedX,
          roundedY,
          settings.size,
          settings.shape,
          false,
          settings.rotation,
          settings.risographIntensity,
          settings.pattern,
          settings.centerAlignment,
          settings.customPatternDimensions
        );
      }
      
      return;
    }
    
    // Calculate distance from last stroke position to current position
    const distance = usePixelSpacing
      ? Math.max(
          Math.abs(roundedX - queue.lastStrokePosition.x),
          Math.abs(roundedY - queue.lastStrokePosition.y)
        )
      : Math.sqrt(
          Math.pow(roundedX - queue.lastStrokePosition.x, 2) +
          Math.pow(roundedY - queue.lastStrokePosition.y, 2)
        );
    queue.accumulatedDistance += distance;
    
    // Apply waiting pixel algorithm for ALL brushes (from original working implementation)
    // If current pixel is NOT a neighbor to lastDrawn, draw waiting pixel
    if (Math.abs(roundedX - queue.lastDrawnX) > 1 || Math.abs(roundedY - queue.lastDrawnY) > 1) {
      // Draw the waiting shape only if accumulated distance exceeds spacing
      if (queue.accumulatedDistance >= spacingThreshold) {
        // Check if we should draw this stamp (cursor-speed independent)
        if (shouldDrawStamp(
          brushSettings,
          queue,
          settings.size,
          false,
          settings.speedSamplePx,
          distance
        )) {
          applyPigmentLift(ctx, queue.waitingPixelX, queue.waitingPixelY, settings, brushSettings);
          const jitteredColor = deps.applyThrottledColorJitter(settings.color, brushSettings.colorJitter || 0);
          ctx.fillStyle = jitteredColor;
          deps.drawShape(
            ctx,
            queue.waitingPixelX,
            queue.waitingPixelY,
            settings.size,
            settings.shape,
            false,
            settings.rotation,
            settings.risographIntensity,
            settings.pattern,
            settings.centerAlignment,
            settings.customPatternDimensions
          );
        }
        if (usePixelSpacing) {
          queue.accumulatedDistance = Math.max(0, queue.accumulatedDistance - spacingThreshold);
          queue.accumulatedDistance = Math.round(queue.accumulatedDistance);
        } else {
          queue.accumulatedDistance -= spacingThreshold;
        }
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
      pigmentLiftMask = null;
      pigmentLiftMaskKey = '';
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
