import {
  BrushShape,
  type SequentialStampPoint,
} from '@/types';
import { canDrawWithAlphaLockPolicy } from './alphaLockDrawPolicy';
import { BrushStampTracker } from './brushStampTracker';
import { createStrokeProcessor } from './strokeProcessor';
import { createShapeDrawer, type DrawShapeSettings, type ShapeDrawingDependencies } from './shapes';
import { createBrushUtilities } from './utilities';
import { applyThrottledColorJitter } from './colorUtils';
import { CustomBrushCycleReplayService } from './customBrushCycleReplay';
import { applyDithering } from './dithering';
import { MosaicStrokeRenderer } from './mosaicStrokeRenderer';
import { createDirectionState, type DirectionState } from './rotation';
import { SpamTextSequence } from './spamTextSequence';
import { RotatedStampCache } from './shapeRotatedStamp';
import type { PixelQueue, RenderSettings } from './types';
import { GridSnapSession } from './gridSnapSession';
import { renderBrushStrokeWithServices } from './brushStrokeRenderer';
import { finalizePixelStroke } from './strokeFinalizer';
import { renderSmoothStroke as renderSmoothStrokeWithServices } from './smoothStrokeRenderer';
import { CustomPatternCache } from './shapeCustomPattern';
import {
  type BrushEngineConfig,
  type BrushStrokeParams,
  type CustomBrushStrokeData,
} from './brushEngineFacadeTypes';

export type {
  BrushEngineConfig,
  BrushStrokeParams,
  CustomBrushStrokeData,
} from './brushEngineFacadeTypes';

export class BrushEngineFacade {
  private lastStrokePressure: number | null = null;
  private lastCustomBrushData: CustomBrushStrokeData | null = null;
  private strokeProcessor: ReturnType<typeof createStrokeProcessor>;
  private _shapeDrawer: ReturnType<typeof createShapeDrawer>;
  private utilities: ReturnType<typeof createBrushUtilities>;
  private pixelQueue: PixelQueue;
  private config: BrushEngineConfig;
  private directionState: DirectionState;
  private stampTracker = new BrushStampTracker();
  private customBrushCycleReplay: CustomBrushCycleReplayService;
  private mosaicRenderer: MosaicStrokeRenderer;
  private spamTextSequence = new SpamTextSequence();
  private gridSnapSession = new GridSnapSession();
  private rotatedStampCache = new RotatedStampCache();
  private customPatternCache = new CustomPatternCache();
  private jitterState = {
    lastJitterColor: [0, 0, 0] as [number, number, number],
    nextJitterColor: [0, 0, 0] as [number, number, number],
    counter: 0,
    recalcFrequency: 5
  };
  constructor(config: BrushEngineConfig) {
    this.config = config;
    this.customBrushCycleReplay = new CustomBrushCycleReplayService(config.brushSettings);
    this.directionState = createDirectionState();

    this.strokeProcessor = createStrokeProcessor({
      applyThrottledColorJitter: (color: string, jitterAmount: number) => 
        applyThrottledColorJitter(color, jitterAmount, this.jitterState),
      drawShape: this.drawShapeInternal.bind(this)
    });

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
      getNextSpamChar: this.getNextSpamChar.bind(this),
      rotatedStampCache: this.rotatedStampCache,
      customPatternCache: this.customPatternCache,
    };

    this._shapeDrawer = this.createTrackedShapeDrawer(
      createShapeDrawer(shapeSettings, shapeDeps)
    );
    this.utilities = createBrushUtilities(() => config.brushSettings);
    this.mosaicRenderer = new MosaicStrokeRenderer({
      getBrushSettings: () => this.config.brushSettings,
      calculatePressureSize: (baseSize, pressure) => this.utilities.calculatePressureSize(baseSize, pressure),
      canDrawAt: this.canDrawAt.bind(this),
      stampTracker: this.stampTracker,
    });
    this.pixelQueue = this.strokeProcessor.createPixelQueue();
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
      getNextSpamChar: this.getNextSpamChar.bind(this),
      rotatedStampCache: this.rotatedStampCache,
      customPatternCache: this.customPatternCache,
    };

    this._shapeDrawer = this.createTrackedShapeDrawer(
      createShapeDrawer(shapeSettings, shapeDeps)
    );
    
    if (config.brushSettings) {
      this.utilities = createBrushUtilities(() => this.config.brushSettings);
      this.customBrushCycleReplay.updateBrushSettings(this.config.brushSettings);
    }
  }

  private initializeCustomStrokeCycleStateIfNeeded(params: BrushStrokeParams, shape: BrushShape): void {
    this.customBrushCycleReplay.initializeStrokeCycleIfNeeded(
      params,
      shape,
      this.pixelQueue.initialized
    );
  }

  /**
   * Main method to render a brush stroke
   */
  renderBrushStroke(
    ctx: CanvasRenderingContext2D,
    params: BrushStrokeParams
  ): void {
    renderBrushStrokeWithServices(ctx, params, {
      config: this.config,
      utilities: this.utilities,
      strokeProcessor: this.strokeProcessor,
      pixelQueue: this.pixelQueue,
      directionState: this.directionState,
      gridSnapSession: this.gridSnapSession,
      mosaicRenderer: this.mosaicRenderer,
      shapeDrawer: this.shapeDrawer,
      setLastStrokeInfo: this.setLastStrokeInfo.bind(this),
      initializeCustomStrokeCycleStateIfNeeded: this.initializeCustomStrokeCycleStateIfNeeded.bind(this),
      beginStampTracking: this.beginStampTracking.bind(this),
      endStampTracking: this.endStampTracking.bind(this),
      renderPixelPerfectStroke: this.renderPixelPerfectStroke.bind(this),
      renderSmoothStroke: this.renderSmoothStroke.bind(this),
      canDrawAt: this.canDrawAt.bind(this),
      shouldSkipNearDuplicateFinalStamp: this.shouldSkipNearDuplicateFinalStamp.bind(this),
      getNextCustomCyclePhase: this.getNextCustomCyclePhase.bind(this),
      getCapturedDataPattern: this.getCapturedDataPattern.bind(this),
      sampleGradientColor: this.sampleGradientColor.bind(this),
    });
  }

  private setLastStrokeInfo(pressure: number, customBrushData?: CustomBrushStrokeData): void {
    this.lastStrokePressure = pressure;
    this.lastCustomBrushData = customBrushData ?? null;
  }

  private renderSmoothStroke(
    ctx: CanvasRenderingContext2D,
    from: { x: number; y: number },
    to: { x: number; y: number },
    settings: RenderSettings,
    customBrushData?: CustomBrushStrokeData
  ): void {
    renderSmoothStrokeWithServices({
      ctx,
      from,
      to,
      settings,
      customBrushData,
      brushSettings: this.config.brushSettings,
      pixelQueue: this.pixelQueue,
      strokeProcessor: this.strokeProcessor,
      customBrushCycleReplay: this.customBrushCycleReplay,
      shapeDrawer: this.shapeDrawer,
      canDrawAt: this.canDrawAt.bind(this),
      shouldSkipNearDuplicateFinalStamp: this.shouldSkipNearDuplicateFinalStamp.bind(this),
    });
  }

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

  private sampleGradientColor(
    stops: Array<{ position: number; color: string; opacity?: number }>,
    position: number
  ): string {
    return this.customBrushCycleReplay.sampleGradientColor(stops, position);
  }

  private getNextCustomCyclePhase(): number {
    return this.customBrushCycleReplay.getNextPhase();
  }

  private getCapturedDataPattern(
    customBrushData: CustomBrushStrokeData,
    phase: number
  ): ImageData | null {
    return this.customBrushCycleReplay.getCapturedDataPattern(customBrushData, phase);
  }

  private shouldSkipNearDuplicateFinalStamp(
    point: { x: number; y: number },
    settings: RenderSettings
  ): boolean {
    return this.stampTracker.shouldSkipNearDuplicateFinalStamp(point, settings.shape);
  }

  private createTrackedShapeDrawer(
    drawer: ReturnType<typeof createShapeDrawer>
  ): ReturnType<typeof createShapeDrawer> {
    return this.stampTracker.createTrackedShapeDrawer(drawer);
  }

  private beginStampTracking(pressure: number, alpha: number): void {
    this.stampTracker.begin(pressure, alpha);
  }

  private endStampTracking(): void {
    this.stampTracker.end();
  }

  consumeRecentStamps(): SequentialStampPoint[] {
    return this.stampTracker.consume();
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
    centerAlignment?: boolean,
    customPatternDimensions?: { width: number; height: number }
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
      centerAlignment,
      customPatternDimensions
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
    customPalette?: string[],
    imageTileThresholdResolver?: (x: number, y: number) => number | null
  ): ImageData {
    return applyDithering(
      imageData,
      numColors,
      algorithm,
      patternStyle,
      customPalette,
      undefined,
      imageTileThresholdResolver
    );
  }

  /**
   * Finalize the current stroke by drawing any waiting pixels
   */
  finalizeStroke(ctx: CanvasRenderingContext2D): void {
    finalizePixelStroke({
      ctx,
      brushSettings: this.config.brushSettings,
      pixelQueue: this.pixelQueue,
      lastStrokePressure: this.lastStrokePressure,
      lastCustomBrushData: this.lastCustomBrushData,
      utilities: this.utilities,
      shapeDrawer: this.shapeDrawer,
    });
  }

  /**
   * Reset the pixel queue for a new stroke
   */
  resetStroke(): void {
    this.strokeProcessor.resetPixelQueue(this.pixelQueue);
    this.strokeProcessor.reset();
    this.lastStrokePressure = null;
    this.lastCustomBrushData = null;
    this.mosaicRenderer.reset();
    this.customBrushCycleReplay.resetStroke();
    this.gridSnapSession.reset();
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
    return canDrawWithAlphaLockPolicy(ctx, x, y, this.config.transparencyLockEnabled);
  }

  /**
   * Get next character for spam text brush
   */
  getNextSpamChar(): string {
    return this.spamTextSequence.getNextChar();
  }

  /**
   * Initialize spam text for current content type or custom text
   */
  initializeSpamText(contentType: string, customText?: string): void {
    this.spamTextSequence.initialize(contentType, customText);
  }

  /**
   * Reset spam text state
   */
  resetSpamText(): void {
    this.spamTextSequence.reset();
  }

  /**
   * Get spam text state for external access
   */
  getSpamTextState() {
    return this.spamTextSequence.getState();
  }
}

/**
 * Factory function to create a brush engine facade
 */
export const createBrushEngineFacade = (config: BrushEngineConfig): BrushEngineFacade => {
  return new BrushEngineFacade(config);
};
