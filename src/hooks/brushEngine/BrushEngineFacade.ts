/**
 * Brush Engine Facade
 * Simplified interface that combines all brush engine modules
 */

import { BrushShape, type BrushSettings, type CustomBrush } from '@/types';
import { createStrokeProcessor } from './strokeProcessor';
import { createShapeDrawer, type DrawShapeSettings, type ShapeDrawingDependencies } from './shapes';
import { createBrushUtilities } from './utilities';
import { applyThrottledColorJitter, parseColor } from './colorUtils';
import { DEFAULT_COLOR_CYCLE_GRADIENT } from '@/utils/colorCycleGradients';
import {
  MAX_BRUSH_COLOR_CYCLE_SPEED,
  MIN_BRUSH_COLOR_CYCLE_SPEED,
} from '@/constants/colorCycle';
import { applyDithering } from './dithering';
import { buildToneCurveLut } from '@/utils/imageProcessing';
import { getGridPositionsBetween } from '@/utils/gridSnap';
import { isStrokeBrush } from '@/utils/brushCategories';
import {
  calculateRotation,
  createDirectionState,
  type DirectionState,
  type RotationInput
} from './rotation';
import type { PixelQueue, RenderSettings } from './types';

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
export interface CustomBrushStrokeData {
  imageData: ImageData;
  width: number;
  height: number;
  isColorizable?: boolean;
  isResampler?: boolean;
  cacheKey?: string;
}

export interface BrushStrokeParams {
  from: { x: number; y: number };
  to: { x: number; y: number };
  pressure: number;
  velocity: number;
  timestamp: number;
  customBrushData?: CustomBrushStrokeData;
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
  private directionState: DirectionState;
  private jitterState = {
    lastJitterColor: [0, 0, 0] as [number, number, number],
    nextJitterColor: [0, 0, 0] as [number, number, number],
    counter: 0,
    recalcFrequency: 5
  };
  // Spam text state for continuous text flow
  private spamTextState = {
    currentText: '',
    charIndex: 0,
    initialized: false
  };
  private customColorCyclePhase = 0;
  private lastCustomColorCycleEnabled = false;
  private lastCustomGradientHash = '';

  constructor(config: BrushEngineConfig) {
    this.config = config;
    
    // Initialize direction state for rotation
    this.directionState = createDirectionState();
    
    // Initialize stroke processor
    this.strokeProcessor = createStrokeProcessor({
      applyThrottledColorJitter: (color: string, jitterAmount: number) => 
        applyThrottledColorJitter(color, jitterAmount, this.jitterState),
      drawShape: this.drawShapeInternal.bind(this)
    });

    // Initialize shape drawer
    const shapeSettings: DrawShapeSettings = {
      transparencyLockEnabled: config.transparencyLockEnabled,
      brushSettings: config.brushSettings
    };

    const shapeDeps: ShapeDrawingDependencies = {
      getPatternTempContext: config.getPatternTempContext,
      brushStampCache: config.brushStampCache,
      createPixelCircleStamp: config.createPixelCircleStamp,
      createPixelSquareStamp: config.createPixelSquareStamp,
      getRotationTempContext: config.getRotationTempContext,
      getNextSpamChar: this.getNextSpamChar.bind(this)
    };

    this._shapeDrawer = createShapeDrawer(shapeSettings, shapeDeps);

    // Initialize utilities
    this.utilities = createBrushUtilities(() => config.brushSettings);

    // Initialize pixel queue
    this.pixelQueue = this.strokeProcessor.createPixelQueue();

    this.lastCustomColorCycleEnabled = !!config.brushSettings.customBrushColorCycle;
    this.lastCustomGradientHash = this.hashGradient(config.brushSettings.colorCycleGradient);
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<BrushEngineConfig>) {
    this.config = { ...this.config, ...config };
    
    // Always re-create shape drawer to ensure deps are updated
    const shapeSettings: DrawShapeSettings = {
      transparencyLockEnabled: this.config.transparencyLockEnabled,
      brushSettings: this.config.brushSettings
    };

    const shapeDeps: ShapeDrawingDependencies = {
      getPatternTempContext: this.config.getPatternTempContext,
      brushStampCache: this.config.brushStampCache,
      createPixelCircleStamp: this.config.createPixelCircleStamp,
      createPixelSquareStamp: this.config.createPixelSquareStamp,
      getRotationTempContext: this.config.getRotationTempContext,
      getNextSpamChar: this.getNextSpamChar.bind(this)
    };

    this._shapeDrawer = createShapeDrawer(shapeSettings, shapeDeps);
    
    if (config.brushSettings) {
      this.utilities = createBrushUtilities(() => this.config.brushSettings);

      const nextSettings = this.config.brushSettings;
      const nowEnabled = !!nextSettings.customBrushColorCycle;
      const nextHash = this.hashGradient(nextSettings.colorCycleGradient);

      if (!nowEnabled) {
        this.customColorCyclePhase = 0;
      } else {
        if (!this.lastCustomColorCycleEnabled || nextHash !== this.lastCustomGradientHash) {
          this.customColorCyclePhase = 0;
        }
      }

      this.lastCustomColorCycleEnabled = nowEnabled;
      this.lastCustomGradientHash = nextHash;
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
    if (customBrushData && !customBrushData.isResampler) {
      const maxDimension = Math.max(customBrushData.width, customBrushData.height);
      baseSize = Math.max(1, brushSettings.size ?? maxDimension);
    } else if (customBrushData?.isResampler) {
      // Resampler: use the original brush size, not the captured size
      // This allows the captured pattern to be scaled to match the brush cursor size
      baseSize = brushSettings.size;
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

    // Calculate smoothed velocity
    const smoothedVelocity = this.strokeProcessor.calculateSmoothedVelocity(velocity);

    // Determine if this is a pixel brush that should remain pixel-perfect
    // Override shape to CUSTOM if custom brush data is provided
    const shape = customBrushData ? BrushShape.CUSTOM : (brushSettings.brushShape || BrushShape.ROUND);
    const isPixelBrush = shape === BrushShape.PIXEL_ROUND;
    const isPixelSquare = shape === BrushShape.SQUARE && !brushSettings.antialiasing;
    
    // Calculate rotation only for stroke-based brushes
    let rotation = 0;
    const isStroke = isStrokeBrush(shape);
    
    if (isStroke) {
      // Use new rotation config if available, otherwise fall back to legacy
      // If rotationConfig exists but is disabled, check legacy rotationEnabled
      const rotationConfig = brushSettings.rotationConfig ? 
        {
          ...brushSettings.rotationConfig,
          // Override enabled with legacy setting if rotationConfig is disabled but legacy is enabled
          enabled: brushSettings.rotationConfig.enabled || brushSettings.rotationEnabled || false
        } : 
        {
          enabled: brushSettings.rotationEnabled || false,
          mode: 'direction' as const,
          smoothing: 0.5,
          offset: 0,
          jitter: 0
        };
      
      if (rotationConfig.enabled) {
        const rotationInput: RotationInput = {
          from: snappedFrom,
          to: snappedTo,
          pressure,
          velocity: smoothedVelocity
        };
        
        rotation = calculateRotation(rotationConfig, rotationInput, this.directionState);
        
        // Apply the 0.5 multiplier for backward compatibility if using legacy mode
        if (!brushSettings.rotationConfig && brushSettings.rotationEnabled) {
          rotation *= 0.5; // Legacy behavior
        }
      }
    }
    
    // Create render settings with custom brush pattern if provided
    const settings: RenderSettings = {
      size,
      opacity,
      color: brushSettings.color,
      antiAliasing: brushSettings.antialiasing,
      pixelAlignment: !brushSettings.antialiasing,
      spacing,
      rotation,
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

    // Interpolate and draw stamps (excluding the final position to avoid duplicate)
    for (let i = 0; i < steps; i++) {
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
          if (this.config.brushSettings.customBrushColorCycle && settings.shape === BrushShape.CUSTOM) {
            ctx.fillStyle = this.getNextCustomCycleColor();
          } else {
            ctx.fillStyle = settings.color;
          }
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
    
    // Draw final stamp at exact end position if we have moved
    if (distance > 0 && this.strokeProcessor.shouldDrawStamp(
      this.config.brushSettings,
      this.pixelQueue,
      settings.size,
      false
    )) {
      if (this.canDrawAt(ctx, to.x, to.y)) {
        if (this.config.brushSettings.customBrushColorCycle && settings.shape === BrushShape.CUSTOM) {
          ctx.fillStyle = this.getNextCustomCycleColor();
        } else {
          ctx.fillStyle = settings.color;
        }
        this.shapeDrawer(
          ctx,
          to.x,
          to.y,
          settings.size,
          settings.shape,
          settings.antiAliasing,
          settings.rotation,
          settings.risographIntensity,
          settings.pattern,
          settings.isColorizable
        );
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

  private hashGradient(stops?: Array<{ position: number; color: string }>): string {
    if (!stops || stops.length === 0) {
      return 'none';
    }
    return stops.map(stop => `${stop.position}:${stop.color}`).join('|');
  }

  private sampleGradientColor(
    stops: Array<{ position: number; color: string }>,
    position: number
  ): string {
    if (!stops.length) {
      return '#ffffff';
    }

    const clamped = Math.max(0, Math.min(1, position));
    let prev = stops[0];
    let next = stops[stops.length - 1];

    for (let i = 0; i < stops.length - 1; i++) {
      const current = stops[i];
      const upcoming = stops[i + 1];
      if (clamped >= current.position && clamped <= upcoming.position) {
        prev = current;
        next = upcoming;
        break;
      }
    }

    const span = next.position - prev.position;
    const t = span > 0 ? (clamped - prev.position) / span : 0;

    const [r1, g1, b1] = parseColor(prev.color);
    const [r2, g2, b2] = parseColor(next.color);

    const r = Math.round(r1 + (r2 - r1) * t);
    const g = Math.round(g1 + (g2 - g1) * t);
    const b = Math.round(b1 + (b2 - b1) * t);

    return `rgb(${r}, ${g}, ${b})`;
  }

  private getNextCustomCycleColor(): string {
    const stops = this.config.brushSettings.colorCycleGradient && this.config.brushSettings.colorCycleGradient.length > 0
      ? this.config.brushSettings.colorCycleGradient
      : DEFAULT_COLOR_CYCLE_GRADIENT;

    const color = this.sampleGradientColor(stops, this.customColorCyclePhase);
    const step = Math.max(
      MIN_BRUSH_COLOR_CYCLE_SPEED,
      Math.min(MAX_BRUSH_COLOR_CYCLE_SPEED, this.config.brushSettings.colorCycleSpeed || 0.1)
    );
    this.customColorCyclePhase = (this.customColorCyclePhase + step) % 1;
    return color;
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
  
  private set shapeDrawer(value: ReturnType<typeof createShapeDrawer>) {
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
    const algo = algorithm || this.config.brushSettings.ditherAlgorithm || 'sierra-lite';
    const toneCurvePoints =
      this.config.brushSettings.toneCurveByAlgorithm?.[algo] ||
      this.config.brushSettings.toneCurvePoints;
    const toneCurveLut = buildToneCurveLut(toneCurvePoints);
    return applyDithering(imageData, numColors, algorithm, patternStyle, customPalette, toneCurveLut);
  }

  /**
   * Finalize the current stroke by drawing any waiting pixels
   */
  finalizeStroke(ctx: CanvasRenderingContext2D): void {
    // Only draw waiting pixel for pixel-perfect brushes (antialiasing disabled)
    // This prevents an extra stamp at the end of strokes for normal brushes
    if (!this.config.brushSettings.antialiasing && 
        this.pixelQueue.initialized && 
        (this.pixelQueue.waitingPixelX !== this.pixelQueue.lastDrawnX ||
         this.pixelQueue.waitingPixelY !== this.pixelQueue.lastDrawnY)) {
      // Draw the waiting pixel if it's different from the last drawn pixel
      const settings: RenderSettings = {
        size: this.config.brushSettings.size,
        opacity: this.config.brushSettings.opacity,
        color: this.config.brushSettings.color,
        antiAliasing: false, // Pixel-perfect mode
        pixelAlignment: true, // Always align for pixel-perfect
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
        false, // No antialiasing for pixel-perfect
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

    // With the higher-level alpha-lock compositing, we allow the stamp to draw
    // and rely on the final destination-in mask to clip the result. Sampling
    // per-stamp alpha here produced frequent false negatives when the mask and
    // brush coordinates diverged slightly (e.g., CC layers or rotated strokes),
    // effectively disabling painting even though the layer had visible alpha.
    // TODO: if we reintroduce gating, use the selected mask canvas instead of
    // the live context and account for coordinate scaling.
    if (typeof window !== 'undefined') {
      const debugLevel =
        (window as typeof window & { __alphaLockDebug?: number }).__alphaLockDebug ?? 0;
      if (debugLevel >= 3) {
        try {
          const pixel = ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1);
          console.log('[AL] canDrawAt bypass sample', {
            x: Math.floor(x),
            y: Math.floor(y),
            alpha: pixel.data[3],
          });
        } catch {
          // ignore sampling errors in debug logging
        }
      }
    }

    return true;
  }

  /**
   * Get next character for spam text brush
   */
  getNextSpamChar(): string {
    if (!this.spamTextState.currentText) {
      return 'S'; // Fallback character
    }
    
    const char = this.spamTextState.currentText[this.spamTextState.charIndex % this.spamTextState.currentText.length];
    this.spamTextState.charIndex++;
    return char;
  }

  /**
   * Initialize spam text for current content type or custom text
   */
  initializeSpamText(contentType: string, customText?: string): void {
    // Use custom text if provided
    if (customText && customText.trim().length > 0) {
      this.spamTextState.currentText = customText;
    } else {
      // Full spam messages for continuous flow
      const spamTexts: Record<string, string> = {
        classic: 'WINNER!!! ACT NOW!!! LIMITED TIME OFFER!!! CONGRATULATIONS!!! FREE FREE FREE!!! CLICK HERE!!! URGENT MESSAGE!!! HOT SINGLES IN YOUR AREA!!! 100% GUARANTEED!!! NO RISK!!! CALL NOW!!! AMAZING OFFER!!! EARN $$$!!! LOSE WEIGHT FAST!!! MIRACLE CURE!!! SECRET REVEALED!!! ',
        crypto: 'TO THE MOON!!! HODL!!! DIAMOND HANDS!!! BUY THE DIP!!! WHALE ALERT!!! 100X GAINS!!! PUMP IT!!! NOT FINANCIAL ADVICE!!! LAMBO SOON!!! MOON MISSION!!! GEM FOUND!!! RUG PROOF!!! DYOR!!! APE IN NOW!!! ',
        prince: 'DEAR BENEFICIARY!!! INHERITANCE FUND!!! BANK OF NIGERIA!!! TRANSFER FEES REQUIRED!!! MILLION DOLLARS!!! TRUSTED BARRISTER!!! URGENT RESPONSE NEEDED!!! STRICTLY CONFIDENTIAL!!! GOD BLESS!!! AWAITING YOUR REPLY!!! KINDLY SEND DETAILS!!! WESTERN UNION!!! ',
        pharma: 'CHEAP MEDS!!! NO PRESCRIPTION!!! FDA APPROVED!!! GENERIC PILLS!!! DISCREET SHIPPING!!! ONLINE PHARMACY!!! SPECIAL PRICE!!! ORDER TODAY!!! DOCTOR APPROVED!!! SAFE & EFFECTIVE!!! FAST DELIVERY!!! ',
        mixed: 'WINNER!!! TO THE MOON!!! DEAR BENEFICIARY!!! CHEAP MEDS!!! ACT NOW!!! HODL!!! BANK OF NIGERIA!!! FDA APPROVED!!! FREE FREE FREE!!! DIAMOND HANDS!!! MILLION DOLLARS!!! SPECIAL PRICE!!! 100% GUARANTEED!!! PUMP IT!!! URGENT!!! '
      };
      
      this.spamTextState.currentText = spamTexts[contentType] || spamTexts.mixed;
    }
    
    if (!this.spamTextState.initialized) {
      this.spamTextState.charIndex = 0;
      this.spamTextState.initialized = true;
    }
  }

  /**
   * Reset spam text state
   */
  resetSpamText(): void {
    this.spamTextState.charIndex = 0;
    this.spamTextState.initialized = false;
  }

  /**
   * Get spam text state for external access
   */
  getSpamTextState() {
    return this.spamTextState;
  }
}

/**
 * Factory function to create a brush engine facade
 */
export const createBrushEngineFacade = (config: BrushEngineConfig): BrushEngineFacade => {
  return new BrushEngineFacade(config);
};
