/**
 * Brush Engine Facade
 * Simplified interface that combines all brush engine modules
 */

import {
  BrushShape,
  type BrushSettings,
  type CustomBrush,
  type CustomBrushColorCycleData,
  type SequentialStampPoint,
} from '@/types';
import { createStrokeProcessor } from './strokeProcessor';
import { createShapeDrawer, type DrawShapeSettings, type ShapeDrawingDependencies } from './shapes';
import { createBrushUtilities } from './utilities';
import { applyThrottledColorJitter, parseColor } from './colorUtils';
import { DEFAULT_COLOR_CYCLE_GRADIENT } from '@/utils/colorCycleGradients';
import { DEFAULT_GRADIENT_STOPS } from '@/utils/gradientPresets';
import {
  MAX_BRUSH_COLOR_CYCLE_SPEED,
} from '@/constants/colorCycle';
import {
  computeCustomBrushPhaseAtStamp,
  computeCustomBrushStampJitter,
  computeCustomBrushStrokeSeedPhase,
  resolveCustomBrushCcPhaseMode,
} from './customColorCyclePhase';
import { applyDithering } from './dithering';
import { isStrokeBrush } from '@/utils/brushCategories';
import {
  createMosaicState,
  DEFAULT_MOSAIC_SIZE,
  rebuildMosaicStamp,
  shuffleMosaicPalette,
  type MosaicState
} from './mosaic';
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
  colorCycle?: CustomBrushColorCycleData;
}

export interface BrushStrokeParams {
  from: { x: number; y: number };
  to: { x: number; y: number };
  pressure: number;
  velocity: number;
  timestamp: number;
  customBrushData?: CustomBrushStrokeData;
}

type CapturedPatternPerfStats = {
  calls: number;
  totalMs: number;
  cacheHit: number;
  cacheMiss: number;
  tip: number;
  temp: number;
  project: number;
  anon: number;
};

type BrushPerfWindow = Window & {
  __vesselBrushProfileEnabled?: boolean;
  __vesselBrushProfile?: {
    capturedPattern?: CapturedPatternPerfStats;
  };
  __vesselBrushProfileDump?: () => void;
};

const getNow = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

const resolveSourceBucket = (cacheKey: string | undefined): 'tip' | 'temp' | 'project' | 'anon' => {
  if (!cacheKey) {
    return 'anon';
  }
  if (cacheKey.startsWith('tip:')) {
    return 'tip';
  }
  if (cacheKey.startsWith('temp:')) {
    return 'temp';
  }
  if (cacheKey.startsWith('project:')) {
    return 'project';
  }
  return 'anon';
};

const getCapturedPatternProfile = (): CapturedPatternPerfStats | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  const win = window as BrushPerfWindow;
  if (!win.__vesselBrushProfileEnabled) {
    return null;
  }
  if (!win.__vesselBrushProfile) {
    win.__vesselBrushProfile = {};
  }
  if (!win.__vesselBrushProfile.capturedPattern) {
    win.__vesselBrushProfile.capturedPattern = {
      calls: 0,
      totalMs: 0,
      cacheHit: 0,
      cacheMiss: 0,
      tip: 0,
      temp: 0,
      project: 0,
      anon: 0,
    };
  }
  return win.__vesselBrushProfile.capturedPattern;
};

/**
 * Main brush engine facade that combines all modules
 */
export class BrushEngineFacade {
  private lastStrokePressure: number | null = null;
  private lastCustomBrushData: BrushStrokeParams['customBrushData'] | null = null;
  private strokeProcessor: ReturnType<typeof createStrokeProcessor>;
  private _shapeDrawer: ReturnType<typeof createShapeDrawer>;
  private utilities: ReturnType<typeof createBrushUtilities>;
  private pixelQueue: PixelQueue;
  private config: BrushEngineConfig;
  private directionState: DirectionState;
  private mosaicState: MosaicState | null = null;
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
  private customStrokeCyclePhaseBase = 0;
  private customStrokeCycleStampIndex = 0;
  private customStrokeCycleSeed = 0;
  private customStrokeCycleInitialized = false;
  private lastCustomColorCycleEnabled = false;
  private lastCustomGradientHash = '';
  private customCapturedPatternCache = new Map<string, ImageData>();
  private customCyclePaletteCache = new Map<string, Uint8ClampedArray>();
  private recentStamps: SequentialStampPoint[] = [];
  private stampTrackingActive = false;
  private trackedStampPressure = 1;
  private trackedStampAlpha = 1;
  private static readonly MAX_CAPTURED_PATTERN_CACHE = 512;
  private static readonly MAX_CAPTURED_PALETTE_CACHE = 64;

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

    this._shapeDrawer = this.createTrackedShapeDrawer(
      createShapeDrawer(shapeSettings, shapeDeps)
    );

    // Initialize utilities
    this.utilities = createBrushUtilities(() => config.brushSettings);

    // Initialize pixel queue
    this.pixelQueue = this.strokeProcessor.createPixelQueue();

    this.lastCustomColorCycleEnabled = !!config.brushSettings.customBrushColorCycle;
    this.lastCustomGradientHash = this.hashGradient(config.brushSettings.colorCycleGradient);
  }

  private resetCustomColorCycleState(): void {
    this.customColorCyclePhase = 0;
    this.customStrokeCyclePhaseBase = 0;
    this.customStrokeCycleStampIndex = 0;
    this.customStrokeCycleSeed = 0;
    this.customStrokeCycleInitialized = false;
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

    this._shapeDrawer = this.createTrackedShapeDrawer(
      createShapeDrawer(shapeSettings, shapeDeps)
    );
    
    if (config.brushSettings) {
      this.utilities = createBrushUtilities(() => this.config.brushSettings);

      const nextSettings = this.config.brushSettings;
      const nowEnabled = !!nextSettings.customBrushColorCycle;
      const nextHash = this.hashGradient(nextSettings.colorCycleGradient);

      if (!nowEnabled) {
        this.resetCustomColorCycleState();
      } else {
        if (!this.lastCustomColorCycleEnabled || nextHash !== this.lastCustomGradientHash) {
          this.resetCustomColorCycleState();
        }
      }

      this.lastCustomColorCycleEnabled = nowEnabled;
      this.lastCustomGradientHash = nextHash;
    }
  }

  private initializeCustomStrokeCycleStateIfNeeded(params: BrushStrokeParams, shape: BrushShape): void {
    const settings = this.config.brushSettings;
    const isCustomBrushCycle = settings.customBrushColorCycle && shape === BrushShape.CUSTOM;
    if (!isCustomBrushCycle) {
      return;
    }

    const mode = resolveCustomBrushCcPhaseMode(settings.customBrushCcPhaseMode);
    if (mode === 'global') {
      return;
    }

    if (this.pixelQueue.initialized || this.customStrokeCycleInitialized) {
      return;
    }

    const seed = computeCustomBrushStrokeSeedPhase(
      params.from.x,
      params.from.y,
      params.timestamp
    );
    this.customStrokeCycleSeed = seed;
    this.customStrokeCyclePhaseBase = seed;
    this.customStrokeCycleStampIndex = 0;
    this.customStrokeCycleInitialized = true;
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

    this.lastStrokePressure = pressure;
    this.lastCustomBrushData = customBrushData ?? null;

    // Calculate smoothed velocity
    const smoothedVelocity = this.strokeProcessor.calculateSmoothedVelocity(velocity);
    // Spacing slider is in pixels: 1 = 1px.
    // Optional velocity spacing increases stamp gap at higher speed.
    const spacing = this.utilities.calculateBrushSpacing(
      size,
      smoothedVelocity
    );

    // Keep pointer path in raw space; only quantize stamp placement for grid mode.
    const isGridSnapping = this.utilities.shouldApplyGridSnap();
    const drawFrom = from;
    const drawTo = to;

    // Determine if this is a pixel brush that should remain pixel-perfect
    // Override shape to CUSTOM if custom brush data is provided
    const configuredShape = customBrushData ? BrushShape.CUSTOM : (brushSettings.brushShape || BrushShape.ROUND);
    // PIXEL_DITHER should render like PIXEL_ROUND unless a non-round dither tip shape is selected
    const ditherTipShape = brushSettings.ditherStrokeTipShape ?? 'round';
    const shape =
      configuredShape === BrushShape.PIXEL_DITHER && ditherTipShape !== 'round'
        ? BrushShape.PIXEL_DITHER
        : configuredShape === BrushShape.PIXEL_DITHER
          ? BrushShape.PIXEL_ROUND
          : configuredShape;
    const isPixelBrush = shape === BrushShape.PIXEL_ROUND || shape === BrushShape.PIXEL_DITHER;
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
          from: drawFrom,
          to: drawTo,
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
    const resolvedColor = brushSettings.color || '#000000';
    const settings: RenderSettings = {
      size,
      opacity,
      color: resolvedColor,
      antiAliasing: brushSettings.antialiasing,
      pixelAlignment: !brushSettings.antialiasing,
      spacing,
      speedSamplePx: Math.max(0, smoothedVelocity),
      rotation,
      shape,
      risographIntensity: brushSettings.risographIntensity || 0,
      blendMode: ctx.globalCompositeOperation,
      pattern: customBrushData?.imageData, // Pass custom brush data as pattern
      isColorizable: customBrushData?.isColorizable // Pass colorizable flag for custom brushes
    };

    this.initializeCustomStrokeCycleStateIfNeeded(params, shape);

    // Apply color for the stroke
    ctx.fillStyle = settings.color;
    ctx.globalAlpha = settings.opacity;
    this.beginStampTracking(pressure, settings.opacity);
    try {
      if (settings.shape === BrushShape.MOSAIC) {
        this.renderMosaicStroke(ctx, drawFrom, drawTo, pressure, rotation);
        return;
      }

      // When grid snapping is enabled, draw stamps at grid positions
      if (isGridSnapping) {
        const gridSpacing = this.utilities.calculateGridSpacing();
        const snappedFrom = this.utilities.snapToGrid(drawFrom.x, drawFrom.y);
        const snappedTo = this.utilities.snapToGrid(drawTo.x, drawTo.y);

        // Set image smoothing based on brush type
        if (isPixelBrush || isPixelSquare || !brushSettings.antialiasing) {
          ctx.imageSmoothingEnabled = false;
        } else {
          ctx.imageSmoothingEnabled = true;
        }

        if (!this.pixelQueue.initialized) {
          this.pixelQueue.initialized = true;
          this.pixelQueue.lastStrokePosition = { x: snappedFrom.x, y: snappedFrom.y };
          this.pixelQueue.accumulatedDistance = 0;
        }

        const stampedPositions = this.pixelQueue.stampedGridPositions || new Set<string>();

        const drawSnappedStamp = (x: number, y: number) => {
          const posKey = `${x},${y}`;
          if (!stampedPositions.has(posKey)) {
            if (this.canDrawAt(ctx, x, y)) {
              let stampPattern = settings.pattern;
              let stampIsColorizable = settings.isColorizable;
              if (this.config.brushSettings.customBrushColorCycle && settings.shape === BrushShape.CUSTOM) {
                const phase = this.getNextCustomCyclePhase();
                const capturedPattern = customBrushData
                  ? this.getCapturedDataPattern(customBrushData, phase)
                  : null;
                if (capturedPattern) {
                  stampPattern = capturedPattern;
                  stampIsColorizable = false;
                  ctx.fillStyle = settings.color;
                } else {
                  ctx.fillStyle = this.sampleGradientColor(
                    this.config.brushSettings.colorCycleGradient?.length
                      ? this.config.brushSettings.colorCycleGradient
                      : DEFAULT_COLOR_CYCLE_GRADIENT,
                    phase
                  );
                }
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
                stampPattern,
                stampIsColorizable
              );
            }
            stampedPositions.add(posKey);
          }
        };

        // Traverse every touched grid cell with Bresenham to avoid skipped cells on steep/diagonal moves.
        let cellX = Math.round(snappedFrom.x / gridSpacing);
        let cellY = Math.round(snappedFrom.y / gridSpacing);
        const targetCellX = Math.round(snappedTo.x / gridSpacing);
        const targetCellY = Math.round(snappedTo.y / gridSpacing);
        const deltaX = Math.abs(targetCellX - cellX);
        const deltaY = Math.abs(targetCellY - cellY);
        const stepX = cellX < targetCellX ? 1 : -1;
        const stepY = cellY < targetCellY ? 1 : -1;
        let error = deltaX - deltaY;

        while (true) {
          drawSnappedStamp(cellX * gridSpacing, cellY * gridSpacing);
          if (cellX === targetCellX && cellY === targetCellY) {
            break;
          }
          const doubleError = error * 2;
          if (doubleError > -deltaY) {
            error -= deltaY;
            cellX += stepX;
          }
          if (doubleError < deltaX) {
            error += deltaX;
            cellY += stepY;
          }
        }

        // Update tracking
        this.pixelQueue.stampedGridPositions = stampedPositions;
        this.pixelQueue.lastStrokePosition = { x: snappedTo.x, y: snappedTo.y };
        this.pixelQueue.lastDrawnX = snappedTo.x;
        this.pixelQueue.lastDrawnY = snappedTo.y;
      } else {
        // Normal rendering with interpolation
        const forceSmoothForCapturedCustom =
          settings.shape === BrushShape.CUSTOM &&
          !!customBrushData?.colorCycle &&
          customBrushData.colorCycle.schemaVersion === 2 &&
          customBrushData.colorCycle.mode === 'captured-data' &&
          this.config.brushSettings.customBrushColorCycle === true;

        if (!forceSmoothForCapturedCustom && (isPixelBrush || isPixelSquare || !brushSettings.antialiasing)) {
          // Ensure pixel-perfect rendering
          ctx.imageSmoothingEnabled = false;
          // Pixel-perfect brush
          this.renderPixelPerfectStroke(ctx, drawFrom, drawTo, settings);
        } else {
          // Ensure smooth rendering
          ctx.imageSmoothingEnabled = true;
          // Smooth brush - use stroke interpolation
          this.renderSmoothStroke(ctx, drawFrom, drawTo, settings, customBrushData);
        }
      }
    } finally {
      this.endStampTracking();
    }
  }

  /**
   * Render a smooth antialiased stroke
   */
  private renderSmoothStroke(
    ctx: CanvasRenderingContext2D,
    from: { x: number; y: number },
    to: { x: number; y: number },
    settings: RenderSettings,
    customBrushData?: CustomBrushStrokeData
  ): void {
    // Calculate distance (optimized)
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    const spacingThreshold = Math.max(1, settings.spacing || 1);
    // Sample at fixed 1px granularity so spacing gating controls stamp density.
    const sampleStep = 1;
    const steps = Math.max(1, Math.ceil(distance / sampleStep));

    if (!this.pixelQueue.initialized) {
      this.pixelQueue.initialized = true;
      this.pixelQueue.lastStrokePosition = { x: from.x, y: from.y };
      this.pixelQueue.accumulatedDistance = 0;
    }

    // Interpolate and draw stamps (excluding the final position to avoid duplicate)
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      const x = from.x + (to.x - from.x) * t;
      const y = from.y + (to.y - from.y) * t;

      const lastPos = this.pixelQueue.lastStrokePosition;
      const dxSeg = x - lastPos.x;
      const dySeg = y - lastPos.y;
      const segDistance = Math.sqrt(dxSeg * dxSeg + dySeg * dySeg);
      this.pixelQueue.accumulatedDistance += segDistance;
      this.pixelQueue.lastStrokePosition = { x, y };

      // Check if we should draw this stamp
      if (this.strokeProcessor.shouldDrawStamp(
        this.config.brushSettings,
        this.pixelQueue,
        settings.size,
        false,
        settings.speedSamplePx,
        segDistance
      )) {
        if (this.pixelQueue.accumulatedDistance >= spacingThreshold) {
          this.pixelQueue.accumulatedDistance -= spacingThreshold;
          // Check transparency lock
          if (this.canDrawAt(ctx, x, y)) {
            let stampPattern = settings.pattern;
            let stampIsColorizable = settings.isColorizable;
            if (this.config.brushSettings.customBrushColorCycle && settings.shape === BrushShape.CUSTOM) {
              const phase = this.getNextCustomCyclePhase();
              const capturedPattern = customBrushData
                ? this.getCapturedDataPattern(customBrushData, phase)
                : null;
              if (capturedPattern) {
                stampPattern = capturedPattern;
                stampIsColorizable = false;
                ctx.fillStyle = settings.color;
              } else {
                ctx.fillStyle = this.sampleGradientColor(
                  this.config.brushSettings.colorCycleGradient?.length
                    ? this.config.brushSettings.colorCycleGradient
                    : DEFAULT_COLOR_CYCLE_GRADIENT,
                  phase
                );
              }
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
              stampPattern,
              stampIsColorizable // Pass isColorizable as centerAlignment for custom brushes
            );
          }
        }
      }
    }
    
    // Draw final stamp at exact end position if we have moved
    if (distance > 0 && this.strokeProcessor.shouldDrawStamp(
      this.config.brushSettings,
      this.pixelQueue,
      settings.size,
      false,
      settings.speedSamplePx,
      distance
    )) {
      const lastPos = this.pixelQueue.lastStrokePosition;
      const dxSeg = to.x - lastPos.x;
      const dySeg = to.y - lastPos.y;
      const segDistance = Math.sqrt(dxSeg * dxSeg + dySeg * dySeg);
      this.pixelQueue.accumulatedDistance += segDistance;
      this.pixelQueue.lastStrokePosition = { x: to.x, y: to.y };

      if (this.pixelQueue.accumulatedDistance >= spacingThreshold) {
        this.pixelQueue.accumulatedDistance -= spacingThreshold;
        if (this.canDrawAt(ctx, to.x, to.y)) {
          let stampPattern = settings.pattern;
          let stampIsColorizable = settings.isColorizable;
          if (this.config.brushSettings.customBrushColorCycle && settings.shape === BrushShape.CUSTOM) {
            const phase = this.getNextCustomCyclePhase();
            const capturedPattern = customBrushData
              ? this.getCapturedDataPattern(customBrushData, phase)
              : null;
            if (capturedPattern) {
              stampPattern = capturedPattern;
              stampIsColorizable = false;
              ctx.fillStyle = settings.color;
            } else {
              ctx.fillStyle = this.sampleGradientColor(
                this.config.brushSettings.colorCycleGradient?.length
                  ? this.config.brushSettings.colorCycleGradient
                  : DEFAULT_COLOR_CYCLE_GRADIENT,
                phase
              );
            }
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
            stampPattern,
            stampIsColorizable
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

  private renderMosaicStroke(
    ctx: CanvasRenderingContext2D,
    from: { x: number; y: number },
    to: { x: number; y: number },
    pressure: number,
    rotation: number
  ): void {
    const state = this.ensureMosaicState(from.x, from.y);
    if (!state || !state.stampCanvas) {
      return;
    }

    if (!state.hasStamped) {
      this.drawMosaicStamp(ctx, from.x, from.y, state, pressure, rotation);
      state.hasStamped = true;
      state.spacingRemainingPx = state.spacingPx;
    }

    const dx = to.x - state.lastX;
    const dy = to.y - state.lastY;
    const distance = Math.hypot(dx, dy);

    if (distance <= 0) {
      return;
    }

    const dirX = dx / distance;
    const dirY = dy / distance;
    let remaining = distance;
    let cursorX = state.lastX;
    let cursorY = state.lastY;

    while (remaining > 0) {
      const step = Math.min(remaining, state.segmentRemainingPx);
      const nextX = cursorX + dirX * step;
      const nextY = cursorY + dirY * step;

      this.stampMosaicSegment(ctx, cursorX, cursorY, nextX, nextY, state, pressure, rotation);

      remaining -= step;
      state.segmentRemainingPx -= step;
      cursorX = nextX;
      cursorY = nextY;

      if (state.segmentRemainingPx <= 0) {
        shuffleMosaicPalette(state);
        rebuildMosaicStamp(state);
      }
    }

    state.lastX = to.x;
    state.lastY = to.y;
  }

  private stampMosaicSegment(
    ctx: CanvasRenderingContext2D,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    state: MosaicState,
    pressure: number,
    rotation: number
  ): void {
    const dx = toX - fromX;
    const dy = toY - fromY;
    const distance = Math.hypot(dx, dy);
    if (distance <= 0) {
      return;
    }

    const dirX = dx / distance;
    const dirY = dy / distance;
    let remaining = distance;
    let cursorX = fromX;
    let cursorY = fromY;
    let spacingRemaining = state.spacingRemainingPx;

    if (spacingRemaining <= 0) {
      this.drawMosaicStamp(ctx, cursorX, cursorY, state, pressure, rotation);
      spacingRemaining = state.spacingPx;
    }

    while (remaining >= spacingRemaining) {
      cursorX += dirX * spacingRemaining;
      cursorY += dirY * spacingRemaining;
      remaining -= spacingRemaining;
      this.drawMosaicStamp(ctx, cursorX, cursorY, state, pressure, rotation);
      spacingRemaining = state.spacingPx;
    }

    spacingRemaining -= remaining;
    state.spacingRemainingPx = spacingRemaining;
  }

  private drawMosaicStamp(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    state: MosaicState,
    pressure: number,
    rotation: number
  ): void {
    if (!state.stampCanvas) {
      return;
    }

    const baseSize = this.config.brushSettings.size || DEFAULT_MOSAIC_SIZE;
    const pressureSize = this.utilities.calculatePressureSize(baseSize, pressure);
    const scale = pressureSize > 0 ? pressureSize / DEFAULT_MOSAIC_SIZE : 1;

    const drawW = Math.max(1, state.stampW * scale);
    const drawH = Math.max(1, state.stampH * scale);
    const centerX = Math.round(x);
    const centerY = Math.round(y);

    if (!this.canDrawAt(ctx, centerX, centerY)) {
      return;
    }

    const rotationOffset = Math.PI / 2;
    const totalRotation = rotation + rotationOffset;

    ctx.save();
    ctx.imageSmoothingEnabled = Boolean(this.config.brushSettings.antialiasing);
    ctx.translate(centerX, centerY);
    if (totalRotation !== 0) {
      ctx.rotate(totalRotation);
    }
    ctx.drawImage(state.stampCanvas, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();

    if (this.stampTrackingActive) {
      this.recentStamps.push({
        x: centerX,
        y: centerY,
        pressure: this.trackedStampPressure,
        rotation: Number.isFinite(rotation) ? rotation : 0,
        size: Math.max(drawW, drawH),
        alpha: this.trackedStampAlpha,
      });
    }
  }


  private ensureMosaicState(startX: number, startY: number): MosaicState | null {
    if (this.mosaicState) {
      return this.mosaicState;
    }

    const stops = this.config.brushSettings.colorCycleGradient?.length
      ? this.config.brushSettings.colorCycleGradient
      : DEFAULT_GRADIENT_STOPS;

    this.mosaicState = createMosaicState({
      settings: this.config.brushSettings,
      gradientStops: stops,
      startX,
      startY
    });

    return this.mosaicState;
  }

  private hashGradient(stops?: Array<{ position: number; color: string; opacity?: number }>): string {
    if (!stops || stops.length === 0) {
      return 'none';
    }
    return stops
      .map(stop => `${stop.position}:${stop.color}:${Number.isFinite(stop.opacity) ? stop.opacity : 1}`)
      .join('|');
  }

  private sampleGradientColor(
    stops: Array<{ position: number; color: string; opacity?: number }>,
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

  private trimImageDataCache(cache: Map<string, ImageData>, limit: number): void {
    if (cache.size <= limit) {
      return;
    }
    const oldestKey = cache.keys().next().value;
    if (typeof oldestKey === 'string') {
      cache.delete(oldestKey);
    }
  }

  private trimPaletteCache(cache: Map<string, Uint8ClampedArray>, limit: number): void {
    if (cache.size <= limit) {
      return;
    }
    const oldestKey = cache.keys().next().value;
    if (typeof oldestKey === 'string') {
      cache.delete(oldestKey);
    }
  }

  private getNextCustomCyclePhase(): number {
    const step = Math.max(
      0,
      Math.min(MAX_BRUSH_COLOR_CYCLE_SPEED, this.config.brushSettings.colorCycleSpeed ?? 0.1)
    );

    const mode = resolveCustomBrushCcPhaseMode(this.config.brushSettings.customBrushCcPhaseMode);
    const jitterAmount =
      mode === 'jittered'
        ? Math.max(0, Math.min(1, this.config.brushSettings.customBrushCcPhaseJitter ?? 0))
        : 0;

    let phase = this.customColorCyclePhase;
    if (mode === 'global') {
      this.customColorCyclePhase = (this.customColorCyclePhase + step) % 1;
      return phase;
    }

    const jitterOffset = computeCustomBrushStampJitter(
      this.customStrokeCycleSeed,
      this.customStrokeCycleStampIndex,
      jitterAmount
    );
    phase = computeCustomBrushPhaseAtStamp(
      this.customStrokeCyclePhaseBase,
      this.customStrokeCycleStampIndex,
      step,
      jitterOffset
    );
    this.customStrokeCycleStampIndex += 1;
    return phase;
  }

  private getGradientPalette(
    stops: Array<{ position: number; color: string; opacity?: number }>,
    cycleLength: number
  ): Uint8ClampedArray {
    const gradientHash = this.hashGradient(stops);
    const key = `${gradientHash}:${cycleLength}`;
    const cached = this.customCyclePaletteCache.get(key);
    if (cached) {
      return cached;
    }

    const length = Math.max(1, Math.min(1024, Math.round(cycleLength)));
    const palette = new Uint8ClampedArray(length * 4);
    for (let i = 0; i < length; i += 1) {
      const t = length <= 1 ? 0 : i / (length - 1);
      const color = this.sampleGradientColor(stops, t);
      const [r, g, b] = parseColor(color);
      const p = i * 4;
      palette[p] = r;
      palette[p + 1] = g;
      palette[p + 2] = b;
      palette[p + 3] = 255;
    }

    this.customCyclePaletteCache.set(key, palette);
    this.trimPaletteCache(this.customCyclePaletteCache, BrushEngineFacade.MAX_CAPTURED_PALETTE_CACHE);
    return palette;
  }

  private getCapturedDataPattern(
    customBrushData: CustomBrushStrokeData,
    phase: number
  ): ImageData | null {
    const profile = getCapturedPatternProfile();
    const profileStart = profile ? getNow() : 0;
    const bucket = profile ? resolveSourceBucket(customBrushData.cacheKey) : 'anon';
    const finishProfile = (cacheHit: boolean): void => {
      if (!profile) {
        return;
      }
      profile.calls += 1;
      profile.totalMs += getNow() - profileStart;
      profile[bucket] += 1;
      if (cacheHit) {
        profile.cacheHit += 1;
      } else {
        profile.cacheMiss += 1;
      }
    };

    const colorCycle = customBrushData.colorCycle;
    if (
      !colorCycle ||
      colorCycle.schemaVersion !== 2 ||
      colorCycle.mode !== 'captured-data'
    ) {
      finishProfile(false);
      return null;
    }

    const width = colorCycle.mapWidth;
    const height = colorCycle.mapHeight;
    const pixelCount = width * height;
    if (width <= 0 || height <= 0 || pixelCount <= 0) {
      finishProfile(false);
      return null;
    }

    if (customBrushData.imageData.width !== width || customBrushData.imageData.height !== height) {
      finishProfile(false);
      return null;
    }

    const hasMaps =
      (colorCycle.indexMap && colorCycle.indexMap.length === pixelCount) ||
      (colorCycle.phaseMap && colorCycle.phaseMap.length === pixelCount);
    if (!hasMaps) {
      finishProfile(false);
      return null;
    }

    const stops = colorCycle.gradient?.length
      ? colorCycle.gradient
      : this.config.brushSettings.colorCycleGradient?.length
        ? this.config.brushSettings.colorCycleGradient
        : DEFAULT_COLOR_CYCLE_GRADIENT;
    const cycleLength = Math.max(1, Math.min(1024, Math.round(colorCycle.sourceCycleLength || 256)));
    const phaseBucket = ((Math.round(phase * cycleLength) % cycleLength) + cycleLength) % cycleLength;
    const gradientHash = this.hashGradient(stops);
    const sourceKey = customBrushData.cacheKey ?? `anon:${width}x${height}`;
    const useAlphaMask = true;
    const key = `${sourceKey}:ccd:${gradientHash}:${cycleLength}:${phaseBucket}:${useAlphaMask ? 1 : 0}`;
    const cached = this.customCapturedPatternCache.get(key);
    if (cached) {
      finishProfile(true);
      return cached;
    }

    const palette = this.getGradientPalette(stops, cycleLength);
    const src = customBrushData.imageData.data;
    const output = new Uint8ClampedArray(src.length);
    const indexMap = colorCycle.indexMap;
    const phaseMap = colorCycle.phaseMap;
    const alphaMask =
      useAlphaMask && colorCycle.alphaMask && colorCycle.alphaMask.length === pixelCount
        ? colorCycle.alphaMask
        : undefined;

    for (let i = 0, p = 0; i < pixelCount; i += 1, p += 4) {
      const baseAlpha = src[p + 3];
      const maskAlpha = alphaMask ? alphaMask[i] : 255;
      const alpha = Math.round((baseAlpha * maskAlpha) / 255);
      if (alpha <= 0) {
        continue;
      }

      const base =
        phaseMap && phaseMap.length === pixelCount
          ? phaseMap[i]
          : indexMap && indexMap.length === pixelCount
            ? indexMap[i]
            : 0;
      const resolved = (base + phaseBucket) % cycleLength;
      const paletteOffset = resolved * 4;
      output[p] = palette[paletteOffset];
      output[p + 1] = palette[paletteOffset + 1];
      output[p + 2] = palette[paletteOffset + 2];
      output[p + 3] = alpha;
    }

    const imageData = new ImageData(output, width, height);
    (imageData as ImageData & { __vesselCacheKey?: string }).__vesselCacheKey = key;
    this.customCapturedPatternCache.set(key, imageData);
    this.trimImageDataCache(this.customCapturedPatternCache, BrushEngineFacade.MAX_CAPTURED_PATTERN_CACHE);
    finishProfile(false);
    return imageData;
  }

  private createTrackedShapeDrawer(
    drawer: ReturnType<typeof createShapeDrawer>
  ): ReturnType<typeof createShapeDrawer> {
    return ((
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
    ) => {
      drawer(
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

      if (!this.stampTrackingActive) {
        return;
      }

      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return;
      }

      this.recentStamps.push({
        x,
        y,
        pressure: this.trackedStampPressure,
        rotation: Number.isFinite(rotation) ? rotation : 0,
        size: Number.isFinite(size) ? Math.max(0, size) : 0,
        alpha: this.trackedStampAlpha,
      });
    }) as ReturnType<typeof createShapeDrawer>;
  }

  private beginStampTracking(pressure: number, alpha: number): void {
    this.recentStamps = [];
    this.stampTrackingActive = true;
    this.trackedStampPressure = Number.isFinite(pressure)
      ? Math.max(0, Math.min(1, pressure))
      : 1;
    this.trackedStampAlpha = Number.isFinite(alpha)
      ? Math.max(0, Math.min(1, alpha))
      : 1;
  }

  private endStampTracking(): void {
    this.stampTrackingActive = false;
  }

  consumeRecentStamps(): SequentialStampPoint[] {
    const stamps = this.recentStamps.map((stamp) => ({ ...stamp }));
    this.recentStamps = [];
    return stamps;
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
    return applyDithering(imageData, numColors, algorithm, patternStyle, customPalette);
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
      const { brushSettings } = this.config;
      let baseSize = brushSettings.size;
      if (this.lastCustomBrushData && !this.lastCustomBrushData.isResampler) {
        const maxDimension = Math.max(this.lastCustomBrushData.width, this.lastCustomBrushData.height);
        baseSize = Math.max(1, brushSettings.size ?? maxDimension);
      } else if (this.lastCustomBrushData?.isResampler) {
        baseSize = brushSettings.size;
      }
      const pressure = this.lastStrokePressure ?? 1;
      const size = this.utilities.calculatePressureSize(baseSize, pressure);
      const opacity = this.utilities.calculatePressureOpacity(brushSettings.opacity, pressure);
      // Draw the waiting pixel if it's different from the last drawn pixel
      const settings: RenderSettings = {
        size,
        opacity,
        color: brushSettings.color,
        antiAliasing: false, // Pixel-perfect mode
        pixelAlignment: true, // Always align for pixel-perfect
        spacing: brushSettings.spacing,
        rotation: 0,
        shape: brushSettings.brushShape || BrushShape.ROUND,
        risographIntensity: brushSettings.risographIntensity || 0,
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
    this.lastStrokePressure = null;
    this.lastCustomBrushData = null;
    this.mosaicState = null;
    this.customStrokeCycleStampIndex = 0;
    this.customStrokeCycleSeed = 0;
    this.customStrokeCyclePhaseBase = 0;
    this.customStrokeCycleInitialized = false;
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
