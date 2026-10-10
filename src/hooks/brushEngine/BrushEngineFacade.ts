import {
  BrushShape,
  type SequentialStampPoint,
} from '@/types';
import { canDrawWithAlphaLockPolicy } from './alphaLockDrawPolicy';
import { BrushStampTracker } from './brushStampTracker';
import { createStrokeProcessor } from './strokeProcessor';
import { createShapeDrawer, drawShape, type DrawShapeSettings, type ShapeDrawingDependencies } from './shapes';
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
import { finalizePixelStroke, resolveDeferredPixelStamp } from './strokeFinalizer';
import { getNativeRisographStampRadius } from './shapeRisographEffect';
import { createForkableSeededRng, type ForkableSeededRng } from '@/utils/risographTexture';
import { mergeRectBounds, normalizeRectForCanvas, type Rect } from './engineShared';
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
  private eraserRisographRandom: ForkableSeededRng | null = null;
  private readonly nextRisographRandom = (): number => this.supportsNativePixelStroke() && this.eraserRisographRandom
    ? this.eraserRisographRandom.next()
    : Math.random();

  private supportsNativePixelStroke(): boolean {
    const settings = this.config.brushSettings;
    return !this.lastCustomBrushData && !settings.antialiasing && (
      settings.brushShape === BrushShape.SQUARE ||
      settings.brushShape === BrushShape.PIXEL_ROUND ||
      (settings.brushShape === BrushShape.PIXEL_DITHER && settings.ditherStrokeTipShape === 'diamond5')
    );
  }

  beginStroke(target: 'paint' | 'erase-mask'): void {
    // New eraser strokes own their texture randomness, including later Riso activation.
    this.eraserRisographRandom = target === 'erase-mask'
      ? createForkableSeededRng(Math.floor(Math.random() * 0xffffffff))
      : null;
    this.pixelStrokePreview = null;
  }

  private strokePreviewRevision = -1;
  private pixelStrokePreviewCanvas: HTMLCanvasElement | null = null;
  private pixelStrokePreview: {
    canvas: HTMLCanvasElement;
    bounds: Rect;
    rawCanvas: HTMLCanvasElement | OffscreenCanvas;
    revision: number;
  } | null = null;
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
      getNativeAuthoredSupportContext: config.getNativeAuthoredSupportContext,
      getNextSpamChar: this.getNextSpamChar.bind(this),
      rotatedStampCache: this.rotatedStampCache,
      customPatternCache: this.customPatternCache,
      risographRandom: this.nextRisographRandom,
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
    if (this.strokePreviewRevision >= 0) {
      this.strokePreviewRevision++;
    }
    
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
      getNativeAuthoredSupportContext: this.config.getNativeAuthoredSupportContext,
      getNextSpamChar: this.getNextSpamChar.bind(this),
      rotatedStampCache: this.rotatedStampCache,
      customPatternCache: this.customPatternCache,
      risographRandom: this.nextRisographRandom,
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
    this.strokePreviewRevision = Math.max(0, this.strokePreviewRevision) + 1;
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

  /** Presentation-only release cap; accepted raw pixels and stroke state stay unchanged. */
  getPixelStrokePreview({ rawCanvas, bounds }: {
    rawCanvas: HTMLCanvasElement | OffscreenCanvas;
    bounds: Rect;
  }): { canvas: HTMLCanvasElement; bounds: Rect } | null {
    const brushSettings = this.config.brushSettings;
    if (this.strokePreviewRevision < 0 || rawCanvas.width <= 0 || rawCanvas.height <= 0) {
      return null;
    }
    const canPreviewCap = this.supportsNativePixelStroke() &&
      !(brushSettings.ditherEnabled && brushSettings.pressureLinkedFillResolution) &&
      ((brushSettings.risographIntensity ?? 0) <= 0 || this.eraserRisographRandom !== null);
    if (
      this.pixelStrokePreview?.revision === this.strokePreviewRevision &&
      this.pixelStrokePreview.rawCanvas === rawCanvas &&
      this.pixelStrokePreview.canvas.width === rawCanvas.width &&
      this.pixelStrokePreview.canvas.height === rawCanvas.height
    ) {
      return this.pixelStrokePreview;
    }
    const stamp = canPreviewCap ? resolveDeferredPixelStamp({
      brushSettings,
      pixelQueue: this.pixelQueue,
      lastStrokePressure: this.lastStrokePressure,
      lastCustomBrushData: this.lastCustomBrushData,
      utilities: this.utilities,
      composite: 'source-over',
    }) : null;
    if (!stamp && !this.pixelStrokePreview) return null;

    // Include the old tentative cap so a suppressed corner is restored on publication.
    let previewBounds = mergeRectBounds(this.pixelStrokePreview?.bounds ?? null, bounds);
    if (stamp) {
      const radius = Math.max(
        Math.ceil(stamp.settings.size / 2) + 5,
        stamp.settings.risographIntensity > 0
          ? getNativeRisographStampRadius(stamp.settings.size, stamp.settings.risographIntensity)
          : 0,
      );
      previewBounds = mergeRectBounds(previewBounds, {
        x: stamp.x - radius, y: stamp.y - radius, width: radius * 2, height: radius * 2,
      });
    }
    previewBounds = normalizeRectForCanvas(previewBounds, rawCanvas.width, rawCanvas.height);
    const canvas = this.pixelStrokePreviewCanvas ??= document.createElement('canvas');
    if (canvas.width !== rawCanvas.width || canvas.height !== rawCanvas.height) {
      canvas.width = rawCanvas.width;
      canvas.height = rawCanvas.height;
    }
    // Match raw authoring so copying then blending a texture cap uses the same precision.
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    const { x, y, width, height } = previewBounds;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(x, y, width, height);
    ctx.drawImage(rawCanvas, x, y, width, height, x, y, width, height);
    if (stamp) {
      ctx.fillStyle = stamp.settings.color;
      ctx.globalAlpha = stamp.settings.opacity;
      // Reuse native geometry without the tracked drawer or authored-support sink.
      drawShape(
        ctx, stamp.x, stamp.y, stamp.settings.size, stamp.settings.shape, false, 0, stamp.settings.risographIntensity,
        undefined, undefined, undefined, { brushSettings },
        {
          createPixelCircleStamp: this.config.createPixelCircleStamp,
          risographRandom: stamp.settings.risographIntensity > 0 ? this.eraserRisographRandom?.fork().next : undefined,
        },
      );
    }
    this.pixelStrokePreview = { canvas, bounds: previewBounds, rawCanvas, revision: this.strokePreviewRevision };
    return this.pixelStrokePreview;
  }

  /** Finalize the current stroke by drawing any waiting pixels. */
  finalizeStroke(ctx: CanvasRenderingContext2D): void {
    this.strokePreviewRevision = -1;
    this.pixelStrokePreview = null;
    try {
      finalizePixelStroke({
        ctx,
        brushSettings: this.config.brushSettings,
        pixelQueue: this.pixelQueue,
        lastStrokePressure: this.lastStrokePressure,
        lastCustomBrushData: this.lastCustomBrushData,
        utilities: this.utilities,
        shapeDrawer: this.shapeDrawer,
      });
    } finally {
      this.eraserRisographRandom = null;
    }
  }

  /**
   * Reset the pixel queue for a new stroke
   */
  resetStroke(): void {
    this.eraserRisographRandom = null;
    this.strokePreviewRevision = -1;
    this.pixelStrokePreview = null;
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
