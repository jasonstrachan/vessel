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
import { getGridPositionsBetween } from '@/utils/gridSnap';
import type { PixelQueue, RenderSettings, StrokeInput } from './types';

/**
 * Configuration for the brush engine facade
 */
export interface BrushEngineConfig {
  brushSettings: BrushSettings;
  transparencyLockEnabled?: boolean;
  getPatternTempContext?: (width: number, height: number) => CanvasRenderingContext2D | null;
  brushStampCache?: Map<string, HTMLCanvasElement>;
  createPixelCircleStamp?: (size: number) => HTMLCanvasElement | null;
  createPixelSquareStamp?: (size: number) => HTMLCanvasElement | null;
  getRotationTempContext?: (width: number, height: number) => CanvasRenderingContext2D | null;
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
  customBrushData?: {
    imageData: ImageData;
    width: number;
    height: number;
    isColorizable?: boolean;
  };
}

/**
 * Main brush engine facade that combines all modules
 */
export class BrushEngineFacade {
  private strokeProcessor: ReturnType<typeof createStrokeProcessor>;
  private _shapeDrawer: ReturnType<typeof createShapeDrawer>;
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
      brushStampCache: config.brushStampCache,
      createPixelCircleStamp: config.createPixelCircleStamp,
      createPixelSquareStamp: config.createPixelSquareStamp,
      getRotationTempContext: config.getRotationTempContext
    };

    this._shapeDrawer = createShapeDrawer(shapeSettings, shapeDeps);

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
    
    // Always re-create shape drawer to ensure deps are updated
    const self = this;
    const shapeSettings: DrawShapeSettings = {
      get transparencyLockEnabled() {
        return self.config.transparencyLockEnabled;
      },
      brushSettings: self.config.brushSettings
    };

    const shapeDeps: ShapeDrawingDependencies = {
      getPatternTempContext: this.config.getPatternTempContext,
      brushStampCache: this.config.brushStampCache,
      createPixelCircleStamp: this.config.createPixelCircleStamp,
      createPixelSquareStamp: this.config.createPixelSquareStamp,
      getRotationTempContext: this.config.getRotationTempContext
    };

    this._shapeDrawer = createShapeDrawer(shapeSettings, shapeDeps);
    
    if (config.brushSettings) {
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
    const { from, to, pressure, velocity, customBrushData } = params;
    const { brushSettings } = this.config;

    // Calculate size with pressure
    // For custom brushes, scale based on the brush's max dimension
    let baseSize = brushSettings.size;
    if (customBrushData) {
      // Custom brushes: size slider (1-100) represents percentage of max dimension
      const maxDimension = Math.max(customBrushData.width, customBrushData.height);
      baseSize = (brushSettings.size / 100) * maxDimension;
    }
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
    // Override shape to CUSTOM if custom brush data is provided
    const shape = customBrushData ? BrushShape.CUSTOM : (brushSettings.brushShape || BrushShape.ROUND);
    const isPixelBrush = shape === BrushShape.PIXEL_ROUND;
    const isPixelSquare = shape === BrushShape.SQUARE && !brushSettings.antialiasing;
    
    // Create render settings with custom brush pattern if provided
    const settings: RenderSettings = {
      size,
      opacity,
      color: brushSettings.color,
      antiAliasing: brushSettings.antialiasing,
      pixelAlignment: !brushSettings.antialiasing,
      spacing,
      // Apply half the direction angle to fix double rotation appearance
      // The brush rotation should be subtle, not a full 1:1 with movement direction
      rotation: brushSettings.rotationEnabled ? direction * 0.5 : 0,
      shape,
      risographIntensity: brushSettings.risographIntensity || 0,
      blendMode: ctx.globalCompositeOperation,
      pattern: customBrushData?.imageData, // Pass custom brush data as pattern
      isColorizable: customBrushData?.isColorizable // Pass colorizable flag for custom brushes
    };

    // Apply color for the stroke
    ctx.fillStyle = settings.color;
    ctx.globalAlpha = settings.opacity;

    // Check if grid snapping is enabled
    const isGridSnapping = this.utilities.shouldApplyGridSnap();
    
    // When grid snapping is enabled, draw stamps at grid positions
    if (isGridSnapping) {
      // Use pressure-modified size for grid (matches monolithic implementation)
      const gridSize = settings.size;
      
      // Get all grid positions between last and current position
      // This matches the monolithic implementation
      const lastX = this.pixelQueue.lastDrawnX || snappedFrom.x;
      const lastY = this.pixelQueue.lastDrawnY || snappedFrom.y;
      
      const gridPositions = getGridPositionsBetween(
        lastX,
        lastY, 
        snappedTo.x,
        snappedTo.y,
        gridSize
      );
      
      // Set image smoothing based on brush type
      if (isPixelBrush || isPixelSquare || !brushSettings.antialiasing) {
        ctx.imageSmoothingEnabled = false;
      } else {
        ctx.imageSmoothingEnabled = true;
      }
      
      // Draw at each grid position that hasn't been stamped
      const stampedPositions = this.pixelQueue.stampedGridPositions || new Set<string>();
      
      for (const pos of gridPositions) {
        const posKey = `${pos.x},${pos.y}`;
        if (!stampedPositions.has(posKey)) {
          // Check if we can draw at this position
          if (this.canDrawAt(ctx, pos.x, pos.y)) {
            this.shapeDrawer(
              ctx,
              pos.x,
              pos.y,
              settings.size,
              settings.shape,
              settings.antiAliasing,
              settings.rotation,
              settings.risographIntensity,
              settings.pattern,
              settings.centerAlignment
            );
          }
          stampedPositions.add(posKey);
        }
      }
      
      // Update tracking
      this.pixelQueue.stampedGridPositions = stampedPositions;
      this.pixelQueue.lastDrawnX = snappedTo.x;
      this.pixelQueue.lastDrawnY = snappedTo.y;
    } else {
      // Normal rendering with interpolation
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
    // Calculate distance (optimized)
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

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
            settings.isColorizable // Pass isColorizable as centerAlignment for custom brushes
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
   * Shape drawer property for direct access
   */
  private get shapeDrawer() {
    return this._shapeDrawer;
  }
  
  private set shapeDrawer(value: any) {
    this._shapeDrawer = value;
  }

  /**
   * Apply dithering to an image
   */
  applyDithering(
    imageData: ImageData,
    numColors: number,
    algorithm?: string,
    patternStyle?: string,
    customPalette?: string[]
  ): ImageData {
    return applyDithering(imageData, numColors, algorithm, patternStyle, customPalette);
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