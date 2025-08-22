/**
 * Brush Engine Facade
 * Simplified interface that combines all brush engine modules
 */

import { BrushShape, type BrushSettings, type CustomBrush } from '@/types';
import { createStrokeProcessor } from './strokeProcessor';
import { createShapeDrawer, type DrawShapeSettings, type ShapeDrawingDependencies } from './shapes';
import { createBrushUtilities } from './utilities';
import { applyThrottledColorJitter } from './colorUtils';
import { applyDithering, applySierraLiteDither } from './dithering';
import type { PixelQueue, RenderSettings, StrokeInput } from './types';

/**
 * Configuration for the brush engine facade
 */
export interface BrushEngineConfig {
  brushSettings: BrushSettings;
  transparencyLockEnabled?: boolean;
  getPatternTempContext?: (width: number, height: number) => CanvasRenderingContext2D | null;
  patternTempCanvas?: HTMLCanvasElement | null;
  brushStampCache?: Map<string, HTMLCanvasElement>;
  createPixelCircleStamp?: (size: number) => HTMLCanvasElement | null;
  createPixelSquareStamp?: (size: number) => HTMLCanvasElement | null;
  customBrushes?: CustomBrush[];
}

/**
 * Simplified brush stroke parameters
 */
export interface BrushStrokeParams {
  from: { x: number; y: number };
  to: { x: number; y: number };
  pressure: number;
  velocity: number;
  timestamp: number;
}

/**
 * Main brush engine facade that combines all modules
 */
export class BrushEngineFacade {
  private strokeProcessor: ReturnType<typeof createStrokeProcessor>;
  private shapeDrawer: ReturnType<typeof createShapeDrawer>;
  private utilities: ReturnType<typeof createBrushUtilities>;
  private pixelQueue: PixelQueue;
  private config: BrushEngineConfig;
  private jitterState = {
    lastJitterColor: [0, 0, 0] as [number, number, number],
    nextJitterColor: [0, 0, 0] as [number, number, number],
    counter: 0,
    recalcFrequency: 5
  };

  constructor(config: BrushEngineConfig) {
    this.config = config;
    
    // Initialize stroke processor
    this.strokeProcessor = createStrokeProcessor({
      applyThrottledColorJitter: (color: string, jitterAmount: number) => 
        applyThrottledColorJitter(color, jitterAmount, this.jitterState),
      drawShape: this.drawShapeInternal.bind(this)
    });

    // Initialize shape drawer
    const shapeSettings: DrawShapeSettings = {
      get transparencyLockEnabled() {
        return config.transparencyLockEnabled;
      },
      brushSettings: config.brushSettings
    };

    const shapeDeps: ShapeDrawingDependencies = {
      getPatternTempContext: config.getPatternTempContext,
      patternTempCanvas: config.patternTempCanvas,
      brushStampCache: config.brushStampCache,
      createPixelCircleStamp: config.createPixelCircleStamp,
      createPixelSquareStamp: config.createPixelSquareStamp
    };

    this.shapeDrawer = createShapeDrawer(shapeSettings, shapeDeps);

    // Initialize utilities
    this.utilities = createBrushUtilities(() => config.brushSettings);

    // Initialize pixel queue
    this.pixelQueue = this.strokeProcessor.createPixelQueue();
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<BrushEngineConfig>) {
    this.config = { ...this.config, ...config };
    
    // Re-create modules with new config if needed
    if (config.brushSettings) {
      const self = this;
      const shapeSettings: DrawShapeSettings = {
        get transparencyLockEnabled() {
          return self.config.transparencyLockEnabled;
        },
        brushSettings: self.config.brushSettings
      };

      const shapeDeps: ShapeDrawingDependencies = {
        getPatternTempContext: this.config.getPatternTempContext,
        patternTempCanvas: this.config.patternTempCanvas,
        brushStampCache: this.config.brushStampCache,
        createPixelCircleStamp: this.config.createPixelCircleStamp,
        createPixelSquareStamp: this.config.createPixelSquareStamp
      };

      this.shapeDrawer = createShapeDrawer(shapeSettings, shapeDeps);
      this.utilities = createBrushUtilities(() => this.config.brushSettings);
    }
  }

  /**
   * Main method to render a brush stroke
   */
  renderBrushStroke(
    ctx: CanvasRenderingContext2D,
    params: BrushStrokeParams
  ): void {
    const { from, to, pressure, velocity } = params;
    const { brushSettings } = this.config;

    // Calculate size with pressure
    const baseSize = brushSettings.size;
    const size = this.utilities.calculatePressureSize(baseSize, pressure);

    // Calculate opacity (already in 0-1 range)
    const baseOpacity = brushSettings.opacity;
    const opacity = this.utilities.calculatePressureOpacity(baseOpacity, pressure);

    // Calculate spacing
    const spacing = this.utilities.calculateBrushSpacing(size);

    // Apply grid snapping if enabled
    const snappedFrom = this.utilities.shouldApplyGridSnap() 
      ? this.utilities.snapToGrid(from.x, from.y)
      : from;
    
    const snappedTo = this.utilities.shouldApplyGridSnap()
      ? this.utilities.snapToGrid(to.x, to.y)
      : to;

    // Calculate smoothed velocity and direction
    const smoothedVelocity = this.strokeProcessor.calculateSmoothedVelocity(velocity);
    const direction = this.strokeProcessor.calculateSmoothDirection(snappedFrom, snappedTo, pressure);

    // Determine if this is a pixel brush that should remain pixel-perfect
    const shape = brushSettings.brushShape || BrushShape.ROUND;
    const isPixelBrush = shape === BrushShape.PIXEL_ROUND;
    const isPixelSquare = shape === BrushShape.SQUARE && !brushSettings.antialiasing;
    
    // Create render settings
    const settings: RenderSettings = {
      size,
      opacity,
      color: brushSettings.color,
      antiAliasing: brushSettings.antialiasing,
      pixelAlignment: !brushSettings.antialiasing,
      spacing,
      rotation: brushSettings.rotationEnabled ? direction : 0,
      shape,
      risographIntensity: 0, // Can be extended
      blendMode: ctx.globalCompositeOperation
    };

    // Apply color for the stroke
    ctx.fillStyle = settings.color;
    ctx.globalAlpha = settings.opacity;

    // Render based on brush type
    // Pixel brushes should always use pixel-perfect rendering
    if (isPixelBrush || isPixelSquare || !brushSettings.antialiasing) {
      // Ensure pixel-perfect rendering
      ctx.imageSmoothingEnabled = false;
      // Pixel-perfect brush
      this.renderPixelPerfectStroke(ctx, snappedFrom, snappedTo, settings);
    } else {
      // Ensure smooth rendering
      ctx.imageSmoothingEnabled = true;
      // Smooth brush - use stroke interpolation
      this.renderSmoothStroke(ctx, snappedFrom, snappedTo, settings);
    }
  }

  /**
   * Render a smooth antialiased stroke
   */
  private renderSmoothStroke(
    ctx: CanvasRenderingContext2D,
    from: { x: number; y: number },
    to: { x: number; y: number },
    settings: RenderSettings
  ): void {
    // Calculate distance
    const distance = Math.sqrt(
      Math.pow(to.x - from.x, 2) + 
      Math.pow(to.y - from.y, 2)
    );

    // Determine number of interpolation steps
    const steps = Math.max(1, Math.ceil(distance / settings.spacing));

    // Interpolate and draw stamps
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = from.x + (to.x - from.x) * t;
      const y = from.y + (to.y - from.y) * t;

      // Check if we should draw this stamp
      if (this.strokeProcessor.shouldDrawStamp(
        this.config.brushSettings,
        this.pixelQueue,
        settings.size,
        false
      )) {
        // Check transparency lock
        if (this.canDrawAt(ctx, x, y)) {
          this.shapeDrawer(
            ctx,
            x,
            y,
            settings.size,
            settings.shape,
            settings.antiAliasing,
            settings.rotation,
            settings.risographIntensity,
            settings.pattern,
            settings.centerAlignment
          );
        }
      }
    }
  }

  /**
   * Render a pixel-perfect stroke
   */
  private renderPixelPerfectStroke(
    ctx: CanvasRenderingContext2D,
    from: { x: number; y: number },
    to: { x: number; y: number },
    settings: RenderSettings
  ): void {
    // Use the stroke processor's pixel-perfect line drawing
    this.strokeProcessor.drawPixelPerfectLine(
      ctx,
      Math.round(from.x),
      Math.round(from.y),
      Math.round(to.x),
      Math.round(to.y),
      settings,
      this.pixelQueue,
      this.config.brushSettings
    );
  }

  /**
   * Internal shape drawing method for stroke processor
   */
  private drawShapeInternal(
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
  ): void {
    this.shapeDrawer(
      ctx,
      x,
      y,
      size,
      shape,
      antiAliasing,
      rotation,
      risographIntensity,
      pattern,
      centerAlignment
    );
  }

  /**
   * Apply dithering to an image
   */
  applyDithering(
    imageData: ImageData,
    numColors: number,
    algorithm?: string
  ): ImageData {
    return applyDithering(imageData, numColors, algorithm);
  }

  /**
   * Finalize the current stroke by drawing any waiting pixels
   */
  finalizeStroke(ctx: CanvasRenderingContext2D): void {
    // Draw any waiting pixel for pixel-perfect brushes
    if (this.pixelQueue.initialized && 
        this.pixelQueue.waitingPixelX !== this.pixelQueue.lastDrawnX ||
        this.pixelQueue.waitingPixelY !== this.pixelQueue.lastDrawnY) {
      // Draw the waiting pixel if it's different from the last drawn pixel
      const settings: RenderSettings = {
        size: this.config.brushSettings.size,
        opacity: this.config.brushSettings.opacity,
        color: this.config.brushSettings.color,
        antiAliasing: this.config.brushSettings.antialiasing,
        pixelAlignment: !this.config.brushSettings.antialiasing,
        spacing: this.config.brushSettings.spacing,
        rotation: 0,
        shape: this.config.brushSettings.brushShape || BrushShape.ROUND,
        risographIntensity: this.config.brushSettings.risographIntensity || 0,
        blendMode: ctx.globalCompositeOperation
      };
      
      // Apply settings to context
      ctx.fillStyle = settings.color;
      ctx.globalAlpha = settings.opacity;
      
      // Draw the waiting pixel
      this.shapeDrawer(
        ctx,
        this.pixelQueue.waitingPixelX,
        this.pixelQueue.waitingPixelY,
        settings.size,
        settings.shape,
        settings.antiAliasing,
        settings.rotation,
        settings.risographIntensity
      );
    }
  }

  /**
   * Reset the pixel queue for a new stroke
   */
  resetStroke(): void {
    this.strokeProcessor.resetPixelQueue(this.pixelQueue);
    this.strokeProcessor.reset();
  }

  /**
   * Get current pixel queue state
   */
  getPixelQueue(): PixelQueue {
    return this.pixelQueue;
  }

  /**
   * Check if a position can be drawn (transparency lock)
   */
  canDrawAt(ctx: CanvasRenderingContext2D, x: number, y: number): boolean {
    if (!this.config.transparencyLockEnabled) {
      return true;
    }

    try {
      const imageData = ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1);
      return imageData.data[3] > 0; // Check alpha channel
    } catch {
      return true; // Allow drawing if we can't check
    }
  }
}

/**
 * Factory function to create a brush engine facade
 */
export const createBrushEngineFacade = (config: BrushEngineConfig): BrushEngineFacade => {
  return new BrushEngineFacade(config);
};