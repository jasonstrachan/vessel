/**
 * Simplified Brush Engine - All brush logic in one place
 * Replaces the complex modular component system with direct functions
 */

import { BrushSettings } from '@/types';

// Essential brush result type
export interface BrushResult {
  size: number;
  opacity: number;
  color: string;
  shouldDraw: boolean;
}

// Stroke input data
export interface StrokeInput {
  x: number;
  y: number;
  pressure: number;
  velocity: number;
  deltaTime: number;
}

/**
 * Main brush engine - processes brush settings and stroke input
 */
export class SimpleBrushEngine {
  private lastStrokePosition: { x: number; y: number } | null = null;
  private lastStrokeTime = 0;
  private accumulatedDistance = 0;

  /**
   * Process a brush stroke and return drawing parameters
   */
  executeBrushStroke(settings: BrushSettings, input: StrokeInput): BrushResult {
    // Calculate size with pressure
    const pressureMultiplier = settings.pressureSettings.enabled 
      ? this.calculatePressureEffect(input.pressure, settings.pressureSettings)
      : 1;
    
    const finalSize = Math.max(1, settings.size * pressureMultiplier);

    // Calculate opacity with pressure
    const finalOpacity = settings.pressureSettings.enabled
      ? Math.max(0.1, settings.opacity * pressureMultiplier)
      : settings.opacity;

    // Check spacing - should we draw this point?
    const shouldDraw = this.checkSpacing(input, settings.spacing);

    return {
      size: finalSize,
      opacity: finalOpacity,
      color: settings.color,
      shouldDraw
    };
  }

  /**
   * Calculate pressure effect on size/opacity
   */
  private calculatePressureEffect(pressure: number, pressureSettings: BrushSettings['pressureSettings']): number {
    const { minValue, maxValue } = pressureSettings;
    
    // Map pressure (0-1) to range (minValue-maxValue)
    return minValue + (pressure * (maxValue - minValue));
  }

  /**
   * Check if we should draw based on spacing settings
   */
  private checkSpacing(input: StrokeInput, spacing: BrushSettings['spacing']): boolean {
    if (!this.lastStrokePosition) {
      // First stroke point - always draw
      this.lastStrokePosition = { x: input.x, y: input.y };
      this.lastStrokeTime = performance.now();
      this.accumulatedDistance = 0;
      return true;
    }

    // Calculate distance from last stroke
    const dx = input.x - this.lastStrokePosition.x;
    const dy = input.y - this.lastStrokePosition.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    this.accumulatedDistance += distance;

    // Determine spacing threshold
    let spacingThreshold = spacing.value;
    
    if (spacing.dynamicEnabled) {
      // Adjust spacing based on velocity
      const velocityFactor = Math.min(2, input.velocity / 100); // velocity in pixels/ms
      spacingThreshold = Math.max(1, spacing.value * (1 - velocityFactor * 0.5));
    }

    // Check if we've moved far enough to draw
    if (this.accumulatedDistance >= spacingThreshold) {
      this.lastStrokePosition = { x: input.x, y: input.y };
      this.lastStrokeTime = performance.now();
      this.accumulatedDistance = 0;
      return true;
    }

    return false;
  }

  /**
   * Reset stroke state (call at start of new stroke)
   */
  startNewStroke(): void {
    this.lastStrokePosition = null;
    this.lastStrokeTime = 0;
    this.accumulatedDistance = 0;
  }

  /**
   * Draw the actual brush mark to canvas
   */
  drawToCanvas(
    result: BrushResult, 
    input: StrokeInput, 
    p5Instance: any, 
    brushShape: BrushSettings['brushShape']
  ): void {
    if (!result.shouldDraw || !p5Instance) return;

    // Set drawing properties
    p5Instance.fill(result.color);
    p5Instance.noStroke();
    p5Instance.drawingContext.globalAlpha = result.opacity;

    // Draw based on brush shape
    switch (brushShape) {
      case 'circle':
        if (result.size <= 1) {
          p5Instance.point(input.x, input.y);
        } else {
          p5Instance.ellipse(input.x, input.y, result.size, result.size);
        }
        break;
        
      case 'square':
        p5Instance.rect(
          input.x - result.size/2, 
          input.y - result.size/2, 
          result.size, 
          result.size
        );
        break;
        
      default:
        // Default to circle
        if (result.size <= 1) {
          p5Instance.point(input.x, input.y);
        } else {
          p5Instance.ellipse(input.x, input.y, result.size, result.size);
        }
    }

    // Reset global alpha
    p5Instance.drawingContext.globalAlpha = 1;
  }
}

/**
 * Simple stroke input factory
 */
export class StrokeInputFactory {
  private lastPosition: { x: number; y: number } | null = null;
  private lastTime = 0;

  createStrokeInput(x: number, y: number, pressure = 0.5): StrokeInput {
    const now = performance.now();
    
    // Calculate velocity
    let velocity = 0;
    if (this.lastPosition && this.lastTime > 0) {
      const dx = x - this.lastPosition.x;
      const dy = y - this.lastPosition.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const deltaTime = now - this.lastTime;
      velocity = deltaTime > 0 ? distance / deltaTime : 0;
    }

    const input: StrokeInput = {
      x,
      y,
      pressure,
      velocity,
      deltaTime: now - this.lastTime
    };

    // Update state for next calculation
    this.lastPosition = { x, y };
    this.lastTime = now;

    return input;
  }

  reset(): void {
    this.lastPosition = null;
    this.lastTime = 0;
  }
}