'use client';

import { BrushExecutionEngine } from './BrushExecutionEngine';
import { BrushPreset, StrokeInput, StrokeResult } from '@/types/brush';

/**
 * CanvasIntegration - Bridge between modular brush engine and P5.js canvas
 * Handles the integration of component-based brushes with existing drawing system
 */
export class CanvasIntegration {
  private brushEngine: BrushExecutionEngine;
  private performanceMonitor: PerformanceMonitor;

  constructor() {
    this.brushEngine = new BrushExecutionEngine();
    this.performanceMonitor = new PerformanceMonitor();
  }

  /**
   * Execute modular brush stroke and apply to canvas
   * Replaces the existing performDrawAction brush calculations
   */
  executeModularBrush(
    preset: BrushPreset,
    input: StrokeInput,
    p5Instance: any,
    context?: CanvasRenderingContext2D,
    baseColor: string = '#000000'
  ): boolean {
    const frameStartTime = performance.now();
    
    try {
      // Execute component pipeline with base color
      const strokeResult = this.brushEngine.execute(preset, input, baseColor);
      
      // Apply result to canvas
      this.applyStrokeResult(strokeResult, input, p5Instance, context);
      
      // Track performance
      const executionTime = performance.now() - frameStartTime;
      this.performanceMonitor.trackExecution(executionTime);
      
      return true;
    } catch (error) {
      console.error('Modular brush execution failed:', error);
      return false; // Fallback to existing system
    }
  }

  /**
   * Apply computed stroke result to P5.js canvas
   */
  private applyStrokeResult(
    result: StrokeResult,
    input: StrokeInput,
    p5Instance: any,
    context?: CanvasRenderingContext2D
  ): void {
    if (!p5Instance) return;

    // Check spacing controller - skip drawing if spacing says no
    if (result.shouldDraw === false) {
      return;
    }

    // Get drawing context (P5.js or regular canvas)
    const drawingContext = context || p5Instance;
    
    // Apply computed properties from components
    if (result.size !== undefined) {
      // Size component result
      this.applySize(drawingContext, result.size);
    }
    
    if (result.opacity !== undefined) {
      // Opacity component result
      this.applyOpacity(drawingContext, result.opacity);
    }
    
    if (result.color !== undefined) {
      // Color component result
      this.applyColor(drawingContext, result.color);
    }
    
    // Pressure effects are already applied through size and opacity
    
    // Execute drawing operation
    this.performDrawing(drawingContext, input, result);
  }

  /**
   * Apply size modifications from SizeModifierComponent
   */
  private applySize(ctx: any, size: number): void {
    if (ctx.strokeWeight) {
      // P5.js context
      ctx.strokeWeight(size);
    } else if (ctx.lineWidth !== undefined) {
      // Canvas 2D context
      ctx.lineWidth = size;
    }
  }

  /**
   * Apply opacity modifications from OpacityModifierComponent
   */
  private applyOpacity(ctx: any, opacity: number): void {
    if (ctx.stroke && ctx.fill) {
      // P5.js context - apply alpha to stroke/fill
      const currentStroke = ctx.drawingContext.strokeStyle;
      const currentFill = ctx.drawingContext.fillStyle;
      
      ctx.drawingContext.globalAlpha = opacity;
    } else if (ctx.globalAlpha !== undefined) {
      // Canvas 2D context
      ctx.globalAlpha = opacity;
    }
  }

  /**
   * Apply color modifications from ColorBlendingComponent
   */
  private applyColor(ctx: any, color: string): void {
    if (ctx.stroke && ctx.fill) {
      // P5.js context - set stroke and fill colors
      ctx.stroke(color);
      ctx.fill(color);
    } else if (ctx.strokeStyle !== undefined && ctx.fillStyle !== undefined) {
      // Canvas 2D context
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
    }
  }

  // Pressure effects are handled through the main size and opacity calculations

  /**
   * Perform the actual drawing operation
   */
  private performDrawing(ctx: any, input: StrokeInput, result: StrokeResult): void {
    const size = result.size || 1;
    
    if (ctx.ellipse && ctx.rect) {
      // P5.js drawing - use proper shape functions
      ctx.push();
      ctx.noStroke();
      
      // Draw circle or square based on brush shape
      // For now, default to circle - this could be enhanced with shape info from preset
      if (size <= 1) {
        // For 1px brushes, use point for pixel-perfect drawing
        ctx.point(input.x, input.y);
      } else {
        // For larger brushes, use ellipse (circle)
        ctx.ellipse(input.x, input.y, size, size);
      }
      
      ctx.pop();
    } else if (ctx.fillRect) {
      // Canvas 2D drawing
      ctx.beginPath();
      ctx.arc(input.x, input.y, size/2, 0, 2 * Math.PI);
      ctx.fill();
    }
  }

  /**
   * Check if modular brush should be used for this preset
   */
  shouldUseModularBrush(preset: BrushPreset | null): boolean {
    return preset !== null && preset.components && preset.components.length > 0;
  }

  /**
   * Get performance metrics
   */
  getPerformanceMetrics(): PerformanceMetrics {
    return this.performanceMonitor.getMetrics();
  }

  /**
   * Reset performance tracking
   */
  resetPerformanceTracking(): void {
    this.performanceMonitor.reset();
  }

  /**
   * Reset brush engine state for new stroke
   */
  resetBrushEngine(): void {
    this.brushEngine.reset();
  }
}

/**
 * Simple performance monitor for tracking execution times
 */
class PerformanceMonitor {
  private executionTimes: number[] = [];
  private maxSamples = 100;
  private frameExceededCount = 0;
  private frameTarget = 16.67; // 60fps target

  trackExecution(executionTime: number): void {
    this.executionTimes.push(executionTime);
    
    // Keep only recent samples
    if (this.executionTimes.length > this.maxSamples) {
      this.executionTimes.shift();
    }
    
    // Track frame budget violations
    if (executionTime > this.frameTarget) {
      this.frameExceededCount++;
      console.warn(`Brush execution exceeded frame budget: ${executionTime.toFixed(2)}ms`);
    }
  }

  getMetrics(): PerformanceMetrics {
    if (this.executionTimes.length === 0) {
      return {
        averageTime: 0,
        maxTime: 0,
        minTime: 0,
        frameExceededCount: this.frameExceededCount,
        sampleCount: 0
      };
    }

    const avg = this.executionTimes.reduce((a, b) => a + b, 0) / this.executionTimes.length;
    const max = Math.max(...this.executionTimes);
    const min = Math.min(...this.executionTimes);

    return {
      averageTime: avg,
      maxTime: max,
      minTime: min,
      frameExceededCount: this.frameExceededCount,
      sampleCount: this.executionTimes.length
    };
  }

  reset(): void {
    this.executionTimes = [];
    this.frameExceededCount = 0;
  }
}

export interface PerformanceMetrics {
  averageTime: number;
  maxTime: number;
  minTime: number;
  frameExceededCount: number;
  sampleCount: number;
}