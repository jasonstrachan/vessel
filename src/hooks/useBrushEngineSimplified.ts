/**
 * Simplified Brush Engine Hook
 * Clean interface using the facade pattern
 */

import { useCallback, useMemo, useRef, useEffect } from 'react';
import {
  selectColorCycleDesiredPlaying,
  selectEffectiveColorCyclePlaying,
  useAppStore
} from '../stores/useAppStore';
import { createBrushEngineFacade, type BrushEngineConfig, type BrushStrokeParams, type CustomBrushStrokeData } from './brushEngine/BrushEngineFacade';
import { BrushShape, type BrushSettings } from '../types';
import {
  getRisographPattern,
  getRisographEffectSettings,
  getRisographFilter,
  createSeededRng,
  hashNumbers,
  createRisoTintMask
} from '../utils/risographTexture';
import { applyDithering as applyDitheringImport, applyDitheringWithFillResolution } from './brushEngine/dithering';
import { canvasPool } from '../utils/canvasPool';
import { resolveBrushPressureRange } from '@/utils/pressureSettings';
import {
  computePressureResolution,
  createPressureResolutionState,
  PRESSURE_RESOLUTION_MAX_PX,
  type PressureResolutionState,
} from '@/utils/pressureResolution';
// Use migration wrapper to switch between WebGL and Canvas2D implementations
import { type ColorCycleBrushImplementation } from './brushEngine/ColorCycleBrushMigration';
import { bindBrushToCanvas, refreshLayerCCSurface, renderBrushToLayerCanvas } from './brushEngine/colorCycleSurface';
import {
  clearCanvasSurface,
  clearLiveStrokeBufferCanvases,
  ensureLiveStrokeBuffersForContext,
  ensureReusableCanvas2D,
} from './brushEngine/liveStrokeBuffers';
import {
  applyLostEdgeMaskInRegion as applyLostEdgeMaskInRegionUtil,
  applyLostEdgeToStrokeAlphaData,
  shouldApplyStrokeDitherForSettings as shouldApplyStrokeDitherForSettingsUtil,
} from './brushEngine/strokeDitherUtils';
import {
  ditherRegionWithCurrentPressure as ditherRegionWithCurrentPressureUtil,
  type StrokeDitherRegionOptions,
} from './brushEngine/strokeDitherRegion';
import { renderLiveStrokePreview as renderLiveStrokePreviewUtil } from './brushEngine/liveStrokePreview';
import {
  createInitialStrokePressureState,
  createInitialStrokePresResPressureState,
  type StrokePressureState,
  type StrokePresResPressureState,
} from './brushEngine/strokePressure';
import { updateLiveStrokeTracking } from './brushEngine/liveStrokeTracking';
import { runPressureLinkedLiveDitherPass } from './brushEngine/strokeLivePressurePass';
import { resetStrokePressureDitherRuntime } from './brushEngine/strokeStateReset';
import { beginStrokeIfNeeded } from './brushEngine/strokeEntry';
import { resetStrokeCurrent } from './brushEngine/strokeResetEntryController';
import { runStrokePostRenderPipeline } from './brushEngine/strokePostRender';
import { getActiveLayerBitmapCanvas as getActiveLayerBitmapCanvasController } from './brushEngine/activeLayerBitmapController';
import { finalizeStrokeCurrent } from './brushEngine/strokeFinalizeEntryController';
import { runLivePressureDitherForCurrentStroke as runLivePressureDitherForCurrentStrokeController } from './brushEngine/livePressureDitherController';
import {
  applyStrokeRisographOverlay as applyStrokeRisographOverlayController,
  renderLiveStrokePreview as renderLiveStrokePreviewController,
  scheduleLiveStrokeRender as scheduleLiveStrokeRenderController,
} from './brushEngine/liveStrokePreviewController';
import {
  resetPressureDitherState as resetPressureDitherStateController,
  resolveStrokePressureForRender as resolveStrokePressureForRenderController,
} from './brushEngine/pressureRuntimeController';
import {
  getStrokeDitherPixelSize as getStrokeDitherPixelSizeController,
  updateStrokePresResPressure as updateStrokePresResPressureController,
} from './brushEngine/pressureDitherSamplingController';
import {
  applyStrokeDither as applyStrokeDitherController,
  ditherRegionWithCurrentPressure as ditherRegionWithCurrentPressureController,
} from './brushEngine/strokeDitherController';
import { getLiveStrokeRawContext } from './brushEngine/strokeLiveContext';
import { runDrawBrushEntry, runDrawStampEntry } from './brushEngine/strokeDrawEntry';
import {
  runStrokeDrawCoreEntry,
  type RunStrokeDrawCoreHookArgs,
} from './brushEngine/strokeDrawCoreEntryController';
import { drawRectangleGradient as drawRectangleGradientController } from './brushEngine/shapeRectangleGradientController';
import { drawPolygonGradient as drawPolygonGradientController } from './brushEngine/shapePolygonGradientController';
import { applyRisographEffect as applyRisographEffectController } from './brushEngine/shapeRisographEffect';
import { applyAlphaLockToPaint } from './brushEngine/alphaLockController';
import { detectLayerHasAnyAlpha } from './brushEngine/alphaPresenceController';
import {
  setBlendModeIfUnlocked,
  setMultiplyIfUnlocked as setMultiplyIfUnlockedController,
  withTransparencyLockComposite,
} from './brushEngine/transparencyCompositeController';
import {
  createPixelCircleStamp as createPixelCircleStampController,
  createPixelSquareStamp as createPixelSquareStampController,
  getPatternTempContext as getPatternTempContextController,
  getRotationTempContext as getRotationTempContextController,
} from './brushEngine/brushStampController';
import { estimateStrokeBounds as estimateStrokeBoundsController } from './brushEngine/strokeBoundsController';
import {
  ensureColorCycleAnimationForLayers,
  initializeColorCycleBrushForActiveLayer,
} from './brushEngine/colorCycleInitController';
import {
  drawColorCycleStroke,
  renderColorCycleToContext,
} from './brushEngine/colorCycleDrawController';
import { renderColorCycleWithBlendAndLock } from './brushEngine/colorCycleBlendLockController';
import { applyColorCycleRisographOverlay as applyColorCycleRisographOverlayController } from './brushEngine/colorCycleRisographOverlayController';
import {
  endColorCycleStrokeForLayer,
  resetColorCycleStroke,
} from './brushEngine/colorCycleStrokeLifecycleController';
import {
  updateColorCycleBandSpacingForLayer,
  updateColorCycleDitherSettings,
  updateColorCycleFillDitherPixelSize,
  updateColorCycleGradientBandsForLayer,
  updateColorCycleStampDitherPixelSize,
} from './brushEngine/colorCycleBrushSettingsController';
import {
  fillColorCycleConcentric,
  fillColorCycleLinear,
} from './brushEngine/colorCycleFillController';
import {
  AL,
  DD,
  MAX_ALPHA_PROBE_SIZE,
  DEFAULT_CC_BAND_SPACING,
  appendPresResTrace,
  cancelDeferred,
  clamp,
  clampColorCycleBandSpacing,
  computeStrokeDitherPaletteForSettings,
  ensureCanvasPixelSize,
  getAlphaLockDebugLevel,
  inflateRect,
  isPresResDebugEnabled,
  maskHasAlphaNear,
  normalizePressureSettings,
  normalizeRectForCanvas,
  pick2D,
  pick2DRead,
  pickTransparentInk,
  sampleMaskA,
  sampleRGBA,
  scheduleDeferred,
  warnShapeFillRemoved,
  type IdleHandle,
  type Rect,
} from './brushEngine/engineShared';
import { getColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import { RecolorManager } from '@/lib/colorCycle/RecolorManager';
import {
  MAX_CC_LAYER_SPEED_SCALE,
  MAX_RECOLOR_COLOR_CYCLE_SPEED,
  MIN_CC_LAYER_SPEED_SCALE,
  MIN_RECOLOR_COLOR_CYCLE_SPEED
} from '@/constants/colorCycle';
import { isFgPending } from '@/utils/colorCycleGradients';
import { flushGradientApply, requestGradientApply } from '@/hooks/brushEngine/ccGradientApplyScheduler';
import { applyGradientEdit } from '@/hooks/brushEngine/ccGradientController';

declare global {
  interface Window {
    transparencyLockEnabled?: boolean;
    __alphaLockDebug?: number;
    __presResDebug?: boolean | number;
    __presResTrace?: Array<Record<string, unknown>>;
    __clearPresResTrace?: () => void;
    __summarizePresResTrace?: () => Record<string, unknown>;
    __AL_sample?: { x: number; y: number; tag?: string };
    __AL_maskSrc?: string;
  }
}

/**
 * Simplified brush engine hook with facade pattern
 */
type DrawColorCycleOptions = {
  customStamp?: CustomBrushStrokeData;
};

type ShapeFillOptions = Record<string, unknown>;
export type { StrokeBounds } from './brushEngine/engineShared';
export { refreshLayerCCSurface } from './brushEngine/colorCycleSurface';

export const useBrushEngineSimplified = () => {
  const { tools, project, activeLayerId } = useAppStore();
  const layers = useAppStore((state) => state.layers);
  // Track per-layer CC brush speed for the active layer
  const activeLayerBrushSpeed = useAppStore((state) => {
    const layer = state.layers.find(l => l.id === state.activeLayerId);
    return layer?.colorCycleData?.controllerSpeedCps ?? layer?.colorCycleData?.brushSpeed;
  });
  const activeLayerFlowMode = useAppStore((state) => {
    const layer = state.layers.find(l => l.id === state.activeLayerId);
    return layer?.colorCycleData?.flowMode;
  });
  const activeLayerTransparencyLock = useAppStore((state) => {
    const layer = state.layers.find(l => l.id === state.activeLayerId);
    return layer?.transparencyLocked === true;
  });
  const mirrorScheduledRef = useRef(false);
  const firstStampImmediateRef = useRef(true);

  const getActiveLayerBitmapCanvas = useCallback((): HTMLCanvasElement | OffscreenCanvas | null => {
    return getActiveLayerBitmapCanvasController({
      getState: useAppStore.getState,
    });
  }, []);

  const withTransparencyLock = useCallback((
    ctx: CanvasRenderingContext2D,
    draw: () => void
  ) => {
    withTransparencyLockComposite({
      ctx,
      isTransparencyLocked: activeLayerTransparencyLock,
      draw,
    });
  }, [activeLayerTransparencyLock]);

  const setBlendIfUnlocked = useCallback((ctx: CanvasRenderingContext2D) => {
    setBlendModeIfUnlocked({
      ctx,
      isTransparencyLocked: activeLayerTransparencyLock,
      blendMode: tools.brushSettings.blendMode,
    });
  }, [activeLayerTransparencyLock, tools.brushSettings.blendMode]);

  const setMultiplyIfUnlocked = useCallback((ctx: CanvasRenderingContext2D) => {
    setMultiplyIfUnlockedController({
      ctx,
      isTransparencyLocked: activeLayerTransparencyLock,
    });
  }, [activeLayerTransparencyLock]);

  const alphaPresenceCacheRef = useRef<{
    canvas: HTMLCanvasElement | OffscreenCanvas | null;
    hasAlpha: boolean;
    sampledAt: number;
  }>({
    canvas: null,
    hasAlpha: true,
    sampledAt: 0
  });
  const alphaProbeCanvasRef = useRef<HTMLCanvasElement | OffscreenCanvas | null>(null);
  const strokeBoundsRef = useRef<Rect | null>(null);
  const liveStrokeRawRef = useRef<HTMLCanvasElement | OffscreenCanvas | null>(null);
  const liveStrokeDitherRef = useRef<HTMLCanvasElement | OffscreenCanvas | null>(null);
  const bgOffTempCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const bgOffTempCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const bgOffHoleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const bgOffHoleCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const bgOffMaskImageRef = useRef<ImageData | null>(null);
  const liveStrokeBoundsRef = useRef<Rect | null>(null);
  const liveDirtyRectRef = useRef<Rect | null>(null);
  const lastSegmentBoundsRef = useRef<Rect | null>(null);
  const strokePhaseOriginRef = useRef<{ x: number; y: number } | null>(null);
  const liveRenderScheduledRef = useRef(false);
  const recolorLayerScaleByIdRef = useRef<Map<string, number>>(new Map());
  const ditherCoverageMapRef = useRef<Map<string, {
    canvas: HTMLCanvasElement | OffscreenCanvas;
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  }>>(new Map());

  const clearCoverageMaps = useCallback(() => {
    ditherCoverageMapRef.current.clear();
  }, []);

  const clearBgOffHoleCanvas = useCallback(() => {
    if (!bgOffHoleCanvasRef.current) {
      bgOffMaskImageRef.current = null;
      return;
    }
    clearCanvasSurface(bgOffHoleCanvasRef.current);
    bgOffMaskImageRef.current = null;
  }, []);

  const ensureBgOffTemp = useCallback((width: number, height: number) => {
    return ensureReusableCanvas2D(width, height, bgOffTempCanvasRef, bgOffTempCtxRef);
  }, []);

  const ensureBgOffHole = useCallback((width: number, height: number) => {
    return ensureReusableCanvas2D(width, height, bgOffHoleCanvasRef, bgOffHoleCtxRef);
  }, []);

  const ensureLiveStrokeBuffers = useCallback((ctx: CanvasRenderingContext2D): boolean => {
    return ensureLiveStrokeBuffersForContext(ctx, liveStrokeRawRef, liveStrokeDitherRef);
  }, []);

  const clearLiveStrokeBuffers = useCallback(() => {
    clearLiveStrokeBufferCanvases(liveStrokeRawRef, liveStrokeDitherRef);
    liveStrokeBoundsRef.current = null;
    lastSegmentBoundsRef.current = null;
    liveRenderScheduledRef.current = false;
    strokePhaseOriginRef.current = null;
    committedPixelSizeRef.current = null;
    pendingPixelSizeRef.current = null;
    pendingSinceRef.current = 0;
    clearBgOffHoleCanvas();
  }, [clearBgOffHoleCanvas]);

  useEffect(() => {
    const ids = new Set(layers.map((layer) => layer.id));
    const map = ditherCoverageMapRef.current;
    for (const key of Array.from(map.keys())) {
      if (!ids.has(key)) {
        map.delete(key);
      }
    }
  }, [layers]);

  const runResetPressureDitherRuntime = useCallback((resetCommittedAndPending: boolean) => {
    resetStrokePressureDitherRuntime({
      strokePressureRef,
      lastPressureDitherTimeRef,
      lastPressureDitherPixelSizeRef,
      committedPixelSizeRef,
      pendingPixelSizeRef,
      pendingSinceRef,
      strokePressureResStateRef,
      createPressureResolutionState,
      strokePresResPressureRef,
      presResLastLogAtRef,
      presResLastLoggedPixelSizeRef,
      resetCommittedAndPending,
    });
  }, []);

  // Reset pressure-linked resolution caches whenever the mode toggles
  useEffect(() => {
    runResetPressureDitherRuntime(false);
  }, [tools.brushSettings.pressureLinkedFillResolution, runResetPressureDitherRuntime]);

  const layerHasAnyAlpha = useCallback(() => {
    return detectLayerHasAnyAlpha({
      getMaskCanvas: getActiveLayerBitmapCanvas,
      alphaPresenceCacheRef,
      alphaProbeCanvasRef,
      maxAlphaProbeSize: MAX_ALPHA_PROBE_SIZE,
      pick2DRead,
    });
  }, [getActiveLayerBitmapCanvas]);

  const alphaLockEmptyMaskWarnedRef = useRef(false);

  const withAlphaLock = useCallback((
    dstCtx: CanvasRenderingContext2D,
    paint: (targetCtx: CanvasRenderingContext2D) => void,
    bounds?: Rect
  ) => {
    applyAlphaLockToPaint({
      dstCtx,
      paint,
      bounds,
      activeLayerTransparencyLock,
      alphaLockEmptyMaskWarnedRef,
      getActiveLayerBitmapCanvas,
      layerHasAnyAlpha,
      getAlphaLockDebugLevel,
      getStateSnapshot: useAppStore.getState,
      normalizeRectForCanvas,
      sampleRGBA,
      canvasPool,
      blendMode: (tools.brushSettings.blendMode || 'source-over') as GlobalCompositeOperation,
      alphaPresenceCacheRef,
      AL,
    });
  }, [activeLayerTransparencyLock, getActiveLayerBitmapCanvas, layerHasAnyAlpha, tools.brushSettings.blendMode]);

  const renderCCWithBlendAndLock = useCallback((
    targetCtx: CanvasRenderingContext2D,
    sourceCanvas: HTMLCanvasElement | OffscreenCanvas,
    blendMode: GlobalCompositeOperation
  ) => {
    renderColorCycleWithBlendAndLock({
      targetCtx,
      sourceCanvas,
      blendMode,
      activeLayerTransparencyLock,
      getActiveLayerBitmapCanvas,
      layerHasAnyAlpha,
      alphaPresenceCacheRef,
      AL,
      sampleMaskA,
      canvasPool,
    });
  }, [activeLayerTransparencyLock, getActiveLayerBitmapCanvas, layerHasAnyAlpha]);
  
  // Cache for brush stamps
  const brushStampCacheRef = useRef(new Map<string, HTMLCanvasElement>());
  const patternTempCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rotationTempCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const brushSizePendingRef = useRef(Math.max(1, Math.round(tools.brushSettings.size || 1)));
  const brushPressurePendingRef = useRef(normalizePressureSettings(tools.brushSettings));
  const strokePressureRef = useRef<StrokePressureState>(createInitialStrokePressureState());
  const strokePresResPressureRef = useRef<StrokePresResPressureState>(createInitialStrokePresResPressureState());
  const strokePressureResStateRef = useRef<PressureResolutionState>(createPressureResolutionState(1));
  // Pressure ratchet: limit decay by elapsed time so fast lift-offs keep peak resolution.
  const MAX_PRESSURE_DECAY_PER_MS = 0.003;
  const MIN_DROP_PER_EVENT = 0.01;
  const INSTANT_PRESSURE_SAMPLE_WINDOW = 5;
  const lastPressureDitherTimeRef = useRef(0);
  const lastPressureDitherPixelSizeRef = useRef<number | null>(null);
  const committedPixelSizeRef = useRef<number | null>(null);
  const pendingPixelSizeRef = useRef<number | null>(null);
  const pendingSinceRef = useRef(0);
  const PRESSURE_DITHER_MIN_INTERVAL_MS = 30; // ~33 FPS throttle
  const PRESSURE_DITHER_MIN_DELTA_RES = 0.75; // px; revert to previous threshold
  const PRES_RES_FALLBACK_PRESSURE = 0.01;
  const PRES_RES_HOLD_ON_ZERO_MS = 40;
  const presResLastLogAtRef = useRef(0);
  const presResLastLoggedPixelSizeRef = useRef<number | null>(null);
  const brushSizeDeferredHandleRef = useRef<IdleHandle>(null);

  // Get color cycle brush from active layer instead of single instance
  const getActiveLayerColorCycleBrush = useCallback((): ColorCycleBrushImplementation | null => {
    if (!activeLayerId) return null;
    return useAppStore.getState().getLayerColorCycleBrush(activeLayerId);
  }, [activeLayerId]);

  const applyPendingBrushSizing = useCallback(() => {
    const colorCycleBrush = getActiveLayerColorCycleBrush();
    if (!colorCycleBrush) {
      return;
    }
    const pressure = brushPressurePendingRef.current;
    try {
      colorCycleBrush.setBrushSize(brushSizePendingRef.current);
      colorCycleBrush.setPressureEnabled(pressure.enabled);
      colorCycleBrush.setMinPressure(pressure.min);
      colorCycleBrush.setMaxPressure(pressure.max);
    } catch (error) {
      console.error('[CC Effect] Failed to sync pressure settings:', error);
    }
  }, [getActiveLayerColorCycleBrush]);
  
  // Performance: Cache expensive computations
  const isPixelBrush = useMemo(() =>
    tools.brushSettings.brushShape === BrushShape.PIXEL_ROUND ||
    tools.brushSettings.brushShape === BrushShape.PIXEL_DITHER ||
    (tools.brushSettings.brushShape === BrushShape.SQUARE &&
     !tools.brushSettings.antialiasing),
    [tools.brushSettings.brushShape, tools.brushSettings.antialiasing]
  );
  
  // Pattern temp context getter - also returns the canvas
  const getPatternTempContext = useCallback((width: number, height: number) => {
    return getPatternTempContextController({
      width,
      height,
      patternTempCanvasRef,
    });
  }, []);

  // Rotation temp context getter for pixel-perfect rotation
  const getRotationTempContext = useCallback((width: number, height: number) => {
    return getRotationTempContextController({
      width,
      height,
      rotationTempCanvasRef,
    });
  }, []);

  // Create pixel square stamp for non-antialiased squares
  const createPixelSquareStamp = useCallback((size: number) => {
    return createPixelSquareStampController({
      size,
      brushStampCache: brushStampCacheRef.current,
    });
  }, []);
  
  // Create pixel circle stamp (matching monolithic implementation exactly)
  
  const createPixelCircleStamp = useCallback((size: number) => {
    return createPixelCircleStampController({
      size,
      brushStampCache: brushStampCacheRef.current,
    });
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.transparencyLockEnabled = activeLayerTransparencyLock;
    }
  }, [activeLayerTransparencyLock]);

  const estimateStrokeBounds = useCallback((
    from: { x: number; y: number },
    to: { x: number; y: number },
    pressure: number = 1,
    customBrushData?: {
      width?: number;
      height?: number;
      isResampler?: boolean;
    }
  ): Rect => {
    return estimateStrokeBoundsController({
      from,
      to,
      pressure,
      customBrushData,
      brushSettings: tools.brushSettings,
      clamp,
      inflateRect,
    });
  }, [tools.brushSettings]);

  // Create brush engine facade - only recreate when structural dependencies change
  const brushEngine = useMemo(() => {
    const config: BrushEngineConfig = {
      brushSettings: tools.brushSettings,
      transparencyLockEnabled: Boolean(activeLayerTransparencyLock),
      getPatternTempContext,
      brushStampCache: brushStampCacheRef.current,
      createPixelCircleStamp,
      createPixelSquareStamp,
      getRotationTempContext,
      customBrushes: project?.customBrushes || []
    };
    
    return createBrushEngineFacade(config);
  }, [tools.brushSettings, project?.customBrushes, getPatternTempContext, createPixelCircleStamp, createPixelSquareStamp, getRotationTempContext, activeLayerTransparencyLock]);

  // Update engine config when settings change
  useEffect(() => {
    brushEngine.updateConfig({
      brushSettings: tools.brushSettings,
      transparencyLockEnabled: Boolean(activeLayerTransparencyLock),
      getPatternTempContext,
      brushStampCache: brushStampCacheRef.current,
      getRotationTempContext
    });

    // Initialize spam text when the Spam Text brush is selected
    if (tools.brushSettings.brushShape === BrushShape.SPAM_TEXT) {
      const contentType = tools.brushSettings.spamContentType || 'mixed';
      const customText = tools.brushSettings.spamCustomText;
      brushEngine.initializeSpamText(contentType, customText);
    }
  }, [brushEngine, tools.brushSettings, getPatternTempContext, getRotationTempContext, activeLayerTransparencyLock]);

  const shouldApplyStrokeDitherForSettings = useCallback((settings: BrushSettings) => {
    return shouldApplyStrokeDitherForSettingsUtil(settings);
  }, []);

  const shouldApplyStrokeDither = useMemo(() => {
    return shouldApplyStrokeDitherForSettings(tools.brushSettings);
  }, [shouldApplyStrokeDitherForSettings, tools.brushSettings]);

  const strokeDitherPalette = useMemo(() => {
    return computeStrokeDitherPaletteForSettings(tools.brushSettings);
  }, [tools.brushSettings]);

  // Pick a single palette entry to represent "off"/transparent ink: choose the darkest ink for stability
  const transparentInk = useMemo(() => {
    return pickTransparentInk(strokeDitherPalette);
  }, [strokeDitherPalette]);

  const currentBrushPreset = useAppStore((state) => state.currentBrushPreset);
  const activeLayer = useMemo(() => {
    return layers.find((layer) => layer.id === activeLayerId) ?? null;
  }, [layers, activeLayerId]);
  const isDitherPreset = useMemo(() => {
    const id = currentBrushPreset?.id;
    if (!id) return false;
    return id === 'dither-stroke' || id === 'dither-shape';
  }, [currentBrushPreset]);
  const isCCGradient = currentBrushPreset?.id === 'color-cycle-gradient';
  const isCCGradientActiveLayer = isCCGradient && activeLayer?.layerType === 'color-cycle';
  const isDitherStrokeBrush = tools.brushSettings.brushShape === BrushShape.PIXEL_DITHER;
  const ditherStrokeGuardWarnedRef = useRef(false);
  const warnIfDitherStrokePath = useCallback((context: string) => {
    if (process.env.NODE_ENV === 'production') {
      return;
    }
    if (isDitherStrokeBrush || ditherStrokeGuardWarnedRef.current) {
      return;
    }
    ditherStrokeGuardWarnedRef.current = true;
    console.warn('[Dither] Legacy Dither Stroke path hit by non-dither brush', {
      context,
      brushShape: tools.brushSettings.brushShape,
      presetId: currentBrushPreset?.id ?? null,
    });
  }, [currentBrushPreset?.id, isDitherStrokeBrush, tools.brushSettings.brushShape]);

  const isPixelDitherNoBg = useMemo(() => {
    return (
      isDitherPreset &&
      shouldApplyStrokeDither &&
      tools.brushSettings.ditherBackgroundFill === false
    );
  }, [isDitherPreset, shouldApplyStrokeDither, tools.brushSettings.ditherBackgroundFill]);

  const computePressureScaledResolution = useCallback((pressure: number) => {
    return computePressureResolution(
      tools.brushSettings.fillResolution || 1,
      pressure,
      tools.brushSettings.pressureLinkedFillResolution ?? false,
      strokePressureResStateRef.current,
      undefined,
      PRESSURE_RESOLUTION_MAX_PX
    );
  }, [tools.brushSettings.fillResolution, tools.brushSettings.pressureLinkedFillResolution]);

  const updateStrokePresResPressure = useCallback((pressure: number, now: number) => {
    updateStrokePresResPressureController({
      pressure,
      now,
      statsRef: strokePresResPressureRef,
      holdOnZeroMs: PRES_RES_HOLD_ON_ZERO_MS,
    });
  }, []);

  const getStrokeDitherPixelSize = useCallback(() => {
    return getStrokeDitherPixelSizeController({
      statsRef: strokePresResPressureRef,
      fallbackPressure: PRES_RES_FALLBACK_PRESSURE,
      computePressureScaledResolution,
      isPresResDebugEnabled,
      presResLastLogAtRef,
      presResLastLoggedPixelSizeRef,
      appendPresResTrace,
    });
  }, [computePressureScaledResolution]);

  // Erode stroke alpha before dithering to keep the pattern intact.
  const applyLostEdgeToStrokeAlpha = useCallback((
    data: Uint8ClampedArray,
    width: number,
    height: number,
    lostEdgePercent?: number
  ) => {
    applyLostEdgeToStrokeAlphaData(data, width, height, lostEdgePercent);
  }, []);

  const applyLostEdgeMaskInRegion = useCallback((
    ctx: CanvasRenderingContext2D,
    region: Rect | null,
    lostEdgePercent?: number
  ) => {
    applyLostEdgeMaskInRegionUtil(ctx, region, lostEdgePercent, applyLostEdgeToStrokeAlpha);
  }, [applyLostEdgeToStrokeAlpha]);

  const ditherRegionWithCurrentPressure = useCallback((
    ctx: CanvasRenderingContext2D,
    region: { x: number; y: number; width: number; height: number },
    sampleCtx?: CanvasRenderingContext2D,
    options?: StrokeDitherRegionOptions
  ) => {
    ditherRegionWithCurrentPressureController({
      ctx,
      region,
      sampleCtx,
      options,
      ditherRegionWithCurrentPressureUtil,
      toolsBrushSettings: tools.brushSettings,
      strokeDitherPalette,
      transparentInk,
      computeStrokeDitherPaletteForSettings,
      pickTransparentInk,
      computePressureScaledResolution,
      getStrokeDitherPixelSize,
      applyLostEdgeToStrokeAlpha,
      ensureBgOffTemp,
      ensureBgOffHole,
      bgOffMaskImageRef,
      strokePhaseOriginRef,
      DD,
    });
  }, [
    applyLostEdgeToStrokeAlpha,
    computePressureScaledResolution,
    getStrokeDitherPixelSize,
    tools.brushSettings,
    transparentInk,
    strokeDitherPalette,
    ensureBgOffHole,
    ensureBgOffTemp
  ]);

  const applyStrokeDither = useCallback((
    ctx: CanvasRenderingContext2D,
    bounds: Rect | null,
    sampleCtx?: CanvasRenderingContext2D,
    options?: {
      mergeExisting?: boolean;
      overridePressure?: number;
      overridePixelSize?: number;
      bgOffMode?: 'direct' | 'accumulate';
      bgOffComposite?: 'copy' | 'source-over';
      settingsOverride?: BrushSettings;
    }
  ) => {
    applyStrokeDitherController({
      ctx,
      bounds,
      sampleCtx,
      options,
      toolsBrushSettings: tools.brushSettings,
      shouldApplyStrokeDitherForSettings,
      normalizeRectForCanvas,
      ditherRegionWithCurrentPressure,
    });
  }, [ditherRegionWithCurrentPressure, shouldApplyStrokeDitherForSettings, tools.brushSettings]);

  const applyStrokeRisographOverlay = useCallback((ctx: CanvasRenderingContext2D, bounds: Rect | null, source?: HTMLCanvasElement | null) => {
    applyStrokeRisographOverlayController({
      ctx,
      bounds,
      source,
      risographIntensity: tools.brushSettings.risographIntensity || 0,
    });
  }, [tools.brushSettings.risographIntensity]);

  const renderLiveStrokePreview = useCallback((visibleCtx: CanvasRenderingContext2D) => {
    renderLiveStrokePreviewController({
      visibleCtx,
      liveRenderScheduledRef,
      liveStrokeRawRef,
      liveStrokeDitherRef,
      liveStrokeBoundsRef,
      strokeBoundsRef,
      liveDirtyRectRef,
      shouldApplyStrokeDither,
      brushSettings: tools.brushSettings,
      isDitherStrokeBrush,
      isPixelDitherNoBg,
      warnIfDitherStrokePath,
      withAlphaLock,
      applyStrokeDither,
      applyStrokeRisographOverlay,
      renderLiveStrokePreviewUtil,
    });
  }, [
    applyStrokeDither,
    applyStrokeRisographOverlay,
    isPixelDitherNoBg,
    isDitherStrokeBrush,
    shouldApplyStrokeDither,
    tools.brushSettings,
    warnIfDitherStrokePath,
    withAlphaLock
  ]);

  const scheduleLiveStrokeRender = useCallback((visibleCtx: CanvasRenderingContext2D) => {
    scheduleLiveStrokeRenderController({
      visibleCtx,
      liveRenderScheduledRef,
      renderLiveStrokePreview,
    });
  }, [renderLiveStrokePreview]);

  const livePressureDitherSettings = useMemo(() => ({
    ditherBackgroundFill: tools.brushSettings.ditherBackgroundFill,
  }), [tools.brushSettings.ditherBackgroundFill]);

  const strokePressureRuntimeSettings = useMemo(() => ({
    pressureEnabled: tools.brushSettings.pressureEnabled ?? false,
  }), [tools.brushSettings.pressureEnabled]);

  const liveStrokeTrackingSettings = useMemo(() => ({
    fillResolution: tools.brushSettings.fillResolution,
    ditherBackgroundFill: tools.brushSettings.ditherBackgroundFill,
  }), [
    tools.brushSettings.fillResolution,
    tools.brushSettings.ditherBackgroundFill,
  ]);

  const runLivePressureDitherForCurrentStroke = useCallback(({
    rawCtx,
    segmentBounds,
    enableLargeRegionFallback,
  }: {
    rawCtx: CanvasRenderingContext2D;
    segmentBounds: Rect;
    enableLargeRegionFallback: boolean;
  }) => {
    runLivePressureDitherForCurrentStrokeController({
      rawCtx,
      segmentBounds,
      enableLargeRegionFallback,
      liveStrokeDitherRef,
      strokeBoundsRef,
      ditherBackgroundFill: livePressureDitherSettings.ditherBackgroundFill,
      pick2D,
      runPressureLinkedLiveDitherPass,
      getStrokeDitherPixelSize,
      committedPixelSizeRef,
      pendingPixelSizeRef,
      pendingSinceRef,
      lastPressureDitherTimeRef,
      lastPressureDitherPixelSizeRef,
      pressureDitherMinIntervalMs: PRESSURE_DITHER_MIN_INTERVAL_MS,
      pressureDitherMinDeltaRes: PRESSURE_DITHER_MIN_DELTA_RES,
      ditherRegionWithCurrentPressure,
      liveStrokeBoundsRef,
      liveDirtyRectRef,
    });
  }, [
    livePressureDitherSettings,
    getStrokeDitherPixelSize,
    ditherRegionWithCurrentPressure,
  ]);

  const resetPressureDitherState = useCallback(() => {
    resetPressureDitherStateController({
      resetStrokePressureDitherRuntime: () => runResetPressureDitherRuntime(true),
      clearBgOffHoleCanvas,
    });
  }, [clearBgOffHoleCanvas, runResetPressureDitherRuntime]);

  const resolveStrokePressureForRender = useCallback((rawPressure: number, nowHighRes: number): number => {
    return resolveStrokePressureForRenderController({
      rawPressure,
      nowHighRes,
      strokePressureRef,
      pressureEnabled: strokePressureRuntimeSettings.pressureEnabled,
      updateStrokePresResPressure,
      maxPressureDecayPerMs: MAX_PRESSURE_DECAY_PER_MS,
      minDropPerEvent: MIN_DROP_PER_EVENT,
      instantPressureSampleWindow: INSTANT_PRESSURE_SAMPLE_WINDOW,
    });
  }, [strokePressureRuntimeSettings, updateStrokePresResPressure]);

  const getLiveStrokeRawCtx = useCallback((ctx: CanvasRenderingContext2D) => {
    return getLiveStrokeRawContext({
      ctx,
      ensureLiveStrokeBuffers,
      liveStrokeRawRef,
    });
  }, [ensureLiveStrokeBuffers]);

  const trackLiveStrokeSegment = useCallback((segmentBounds: Rect) => {
    updateLiveStrokeTracking({
      segmentBounds,
      fillResolution: liveStrokeTrackingSettings.fillResolution,
      ditherBackgroundFill: liveStrokeTrackingSettings.ditherBackgroundFill,
      strokeBoundsRef,
      liveStrokeBoundsRef,
      lastSegmentBoundsRef,
      liveDirtyRectRef,
    });
  }, [liveStrokeTrackingSettings]);

  const renderBrushStrokeToRaw = useCallback((rawCtx: CanvasRenderingContext2D, params: BrushStrokeParams) => {
    brushEngine.renderBrushStroke(rawCtx, params);
  }, [brushEngine]);

  const strokeDrawRuntimeSettings = useMemo(() => ({
    lostEdge: tools.brushSettings.lostEdge ?? 0,
    pressureLinkedFillResolution: tools.brushSettings.pressureLinkedFillResolution ?? false,
  }), [
    tools.brushSettings.lostEdge,
    tools.brushSettings.pressureLinkedFillResolution,
  ]);

  const finalizeStrokeSettings = useMemo(() => ({
    lostEdge: tools.brushSettings.lostEdge,
    ditherBackgroundFill: tools.brushSettings.ditherBackgroundFill,
    pressureLinkedFillResolution: tools.brushSettings.pressureLinkedFillResolution,
  }), [
    tools.brushSettings.lostEdge,
    tools.brushSettings.ditherBackgroundFill,
    tools.brushSettings.pressureLinkedFillResolution,
  ]);

  const runStrokeDrawCore = useCallback((args: RunStrokeDrawCoreHookArgs) => {
    runStrokeDrawCoreEntry({
      ...args,
      resolveStrokePressureForRender,
      estimateStrokeBounds,
      getLiveStrokeRawCtx,
      trackLiveStrokeSegment,
      renderBrushStrokeToRaw,
      runStrokePostRenderPipeline,
      shouldApplyStrokeDither,
      strokeDrawRuntimeSettings,
      applyLostEdgeMaskInRegion,
      runLivePressureDitherForCurrentStroke,
      scheduleLiveStrokeRender,
    });
  }, [
    resolveStrokePressureForRender,
    estimateStrokeBounds,
    getLiveStrokeRawCtx,
    trackLiveStrokeSegment,
    renderBrushStrokeToRaw,
    shouldApplyStrokeDither,
    strokeDrawRuntimeSettings,
    applyLostEdgeMaskInRegion,
    runLivePressureDitherForCurrentStroke,
    scheduleLiveStrokeRender,
  ]);

  const beginStrokeAtPoint = useCallback((x: number, y: number) => {
    beginStrokeIfNeeded({
      strokeBoundsRef,
      strokePhaseOriginRef,
      x,
      y,
      resetPressureDitherState,
    });
  }, [resetPressureDitherState]);

  /**
   * Main drawing function - simplified interface
   */
  const drawBrush = useCallback((
    ctx: CanvasRenderingContext2D,
    from: { x: number; y: number },
    to: { x: number; y: number },
    cursor: { 
      pressure?: number;
      customBrushData?: CustomBrushStrokeData;
      velocityPxPerMs?: number;
      timestampMs?: number;
    } = {}
  ) => {
    runDrawBrushEntry({
      ctx,
      from,
      to,
      cursor,
      beginStroke: beginStrokeAtPoint,
      runStrokeDrawCore,
    });
    // Dithering is applied in live preview (from raw buffer) and once more in finalizeStroke
  }, [
    beginStrokeAtPoint,
    runStrokeDrawCore,
  ]);

  /**
   * Draw a single stamp at a position
   */
  const drawStamp = useCallback((
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    pressure: number = 1.0
  ) => {
    runDrawStampEntry({
      ctx,
      x,
      y,
      pressure,
      beginStroke: beginStrokeAtPoint,
      runStrokeDrawCore,
    });
    // Dithering is applied in live preview (from raw buffer) and once more in finalizeStroke
  }, [
    beginStrokeAtPoint,
    runStrokeDrawCore,
  ]);

  /**
   * Finalize the current stroke (draw any waiting pixels)
   */
  const finalizeStroke = useCallback((ctx: CanvasRenderingContext2D): Rect | null => {
    return finalizeStrokeCurrent({
      ctx,
      strokeBoundsRef,
      liveStrokeBoundsRef,
      liveStrokeRawRef,
      liveStrokeDitherRef,
      clearLiveStrokeBuffers,
      clearCoverageMaps,
      brushEngine,
      withAlphaLock,
      shouldApplyStrokeDither,
      finalizeStrokeSettings,
      applyLostEdgeMaskInRegion,
      committedPixelSizeRef,
      lastPressureDitherPixelSizeRef,
      getStrokeDitherPixelSize,
      ditherRegionWithCurrentPressure,
      applyStrokeDither,
      isPixelDitherNoBg,
      applyStrokeRisographOverlay,
      isDitherStrokeBrush,
      warnIfDitherStrokePath,
    });
  }, [
    applyStrokeDither,
    applyStrokeRisographOverlay,
    brushEngine,
    clearLiveStrokeBuffers,
    clearCoverageMaps,
    applyLostEdgeMaskInRegion,
    ditherRegionWithCurrentPressure,
    getStrokeDitherPixelSize,
    isDitherStrokeBrush,
    isPixelDitherNoBg,
    shouldApplyStrokeDither,
    finalizeStrokeSettings,
    warnIfDitherStrokePath,
    withAlphaLock
  ]);

  /**
   * Reset for new stroke
   */
  const resetStroke = useCallback(() => {
    resetStrokeCurrent({
      brushEngine,
      strokeBoundsRef,
      strokePhaseOriginRef,
      clearLiveStrokeBuffers,
      clearCoverageMaps,
      clearBgOffHoleCanvas,
      runResetPressureDitherRuntime,
    });
  }, [brushEngine, clearCoverageMaps, clearLiveStrokeBuffers, clearBgOffHoleCanvas, runResetPressureDitherRuntime]);

  /**
   * Apply dithering effect
   */
  const applyDithering = useCallback((
    imageData: ImageData,
    numColors: number,
    algorithm?: string,
    patternStyle?: string,
    customPalette?: string[]
  ) => {
    return brushEngine.applyDithering(imageData, numColors, algorithm, patternStyle, customPalette);
  }, [brushEngine]);

  const rectangleGradientSettings = useMemo(() => ({
    opacity: tools.brushSettings.opacity,
    color: tools.brushSettings.color,
    ditherEnabled: tools.brushSettings.ditherEnabled,
    risographIntensity: tools.brushSettings.risographIntensity,
    colors: tools.brushSettings.colors,
    gradientBands: tools.brushSettings.gradientBands,
    fillResolution: tools.brushSettings.fillResolution,
    ditherAlgorithm: tools.brushSettings.ditherAlgorithm,
    patternStyle: tools.brushSettings.patternStyle,
    risographColorShift: tools.brushSettings.risographColorShift,
  }), [
    tools.brushSettings.opacity,
    tools.brushSettings.color,
    tools.brushSettings.ditherEnabled,
    tools.brushSettings.risographIntensity,
    tools.brushSettings.colors,
    tools.brushSettings.gradientBands,
    tools.brushSettings.fillResolution,
    tools.brushSettings.ditherAlgorithm,
    tools.brushSettings.patternStyle,
    tools.brushSettings.risographColorShift,
  ]);

  const polygonGradientSettings = useMemo(() => ({
    opacity: tools.brushSettings.opacity,
    color: tools.brushSettings.color,
    ditherEnabled: tools.brushSettings.ditherEnabled,
    risographIntensity: tools.brushSettings.risographIntensity,
    colors: tools.brushSettings.colors,
    gradientBands: tools.brushSettings.gradientBands,
    fillResolution: tools.brushSettings.fillResolution,
    ditherAlgorithm: tools.brushSettings.ditherAlgorithm,
    patternStyle: tools.brushSettings.patternStyle,
  }), [
    tools.brushSettings.opacity,
    tools.brushSettings.color,
    tools.brushSettings.ditherEnabled,
    tools.brushSettings.risographIntensity,
    tools.brushSettings.colors,
    tools.brushSettings.gradientBands,
    tools.brushSettings.fillResolution,
    tools.brushSettings.ditherAlgorithm,
    tools.brushSettings.patternStyle,
  ]);

  const drawColorCycleSettings = useMemo(() => ({
    size: tools.brushSettings.size,
    brushShape: tools.brushSettings.brushShape,
    colorCycleStampShape: tools.brushSettings.colorCycleStampShape,
    pressureEnabled: tools.brushSettings.pressureEnabled,
    minPressure: tools.brushSettings.minPressure,
    maxPressure: tools.brushSettings.maxPressure,
  }), [
    tools.brushSettings.size,
    tools.brushSettings.brushShape,
    tools.brushSettings.colorCycleStampShape,
    tools.brushSettings.pressureEnabled,
    tools.brushSettings.minPressure,
    tools.brushSettings.maxPressure,
  ]);

  const fillColorCycleSettings = useMemo(() => ({
    ditherEnabled: tools.brushSettings.ditherEnabled,
    gradientBands: tools.brushSettings.gradientBands,
    brushShape: tools.brushSettings.brushShape,
    colorCycleBandSpacingPx: tools.brushSettings.colorCycleBandSpacingPx,
    spacing: tools.brushSettings.spacing,
    lostEdge: tools.brushSettings.lostEdge,
  }), [
    tools.brushSettings.ditherEnabled,
    tools.brushSettings.gradientBands,
    tools.brushSettings.brushShape,
    tools.brushSettings.colorCycleBandSpacingPx,
    tools.brushSettings.spacing,
    tools.brushSettings.lostEdge,
  ]);

  /**
   * Draw rectangle with gradient
   */
  const drawRectangleGradient = useCallback((
    ctx: CanvasRenderingContext2D,
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    width: number,
    colors: string[],
    isPreview: boolean = false
  ) => {
    drawRectangleGradientController({
      ctx,
      startX,
      startY,
      endX,
      endY,
      width,
      colors,
      isPreview,
      isPixelBrush,
      brushSettings: rectangleGradientSettings,
      withTransparencyLock,
      setBlendIfUnlocked,
      setMultiplyIfUnlocked,
      applyDithering: applyDitheringImport,
      applyDitheringWithFillResolution,
      canvasPool,
      getRisographPattern,
      getRisographEffectSettings,
      getRisographFilter,
      createSeededRng,
      hashNumbers,
      createRisoTintMask,
    });
  }, [withTransparencyLock, setBlendIfUnlocked, setMultiplyIfUnlocked, rectangleGradientSettings, isPixelBrush]);

  // Helper function to apply risograph effect
  const applyRisographEffect = useCallback((
    ctx: CanvasRenderingContext2D,
    vertices: Array<{ x: number; y: number }>,
    risographIntensity: number
  ) => {
    applyRisographEffectController({
      ctx,
      vertices,
      risographIntensity,
      isPixelBrush,
      brushColor: tools.brushSettings.color || '#000',
      risographColorShift: tools.brushSettings.risographColorShift,
      setMultiplyIfUnlocked,
      canvasPool,
      getRisographPattern,
      getRisographEffectSettings,
      getRisographFilter,
      createSeededRng,
      hashNumbers,
      createRisoTintMask,
    });
  }, [setMultiplyIfUnlocked, isPixelBrush, tools.brushSettings.color, tools.brushSettings.risographColorShift]);

  const applyColorCycleRisographOverlay = useCallback((
    ctx: CanvasRenderingContext2D,
    sourceCanvas: HTMLCanvasElement | OffscreenCanvas,
    outputOpacity: number
  ) => {
    applyColorCycleRisographOverlayController({
      ctx,
      sourceCanvas,
      outputOpacity,
      brushSettings: {
        risographIntensity: tools.brushSettings.risographIntensity,
        risographColorShift: tools.brushSettings.risographColorShift,
        color: tools.brushSettings.color,
        ditherEnabled: tools.brushSettings.ditherEnabled,
      },
      canvasPool,
      getRisographPattern,
      getRisographEffectSettings,
      getRisographFilter,
      hashNumbers,
      createSeededRng,
    });
  }, [tools.brushSettings.risographIntensity, tools.brushSettings.risographColorShift, tools.brushSettings.color, tools.brushSettings.ditherEnabled]);

  /**
   * Draw polygon with gradient - DEBUG VERSION
   */
  const drawPolygonGradient = useCallback((
    ctx: CanvasRenderingContext2D,
    polygonData: { vertices: Array<{ x: number; y: number }>, colors: string[] },
    isPreview: boolean = false
  ) => {
    drawPolygonGradientController({
      ctx,
      polygonData,
      isPreview,
      brushSettings: polygonGradientSettings,
      withTransparencyLock,
      setBlendIfUnlocked,
      canvasPool,
      applyDithering: applyDitheringImport,
      applyDitheringWithFillResolution,
      applyRisographEffect,
    });
  }, [withTransparencyLock, setBlendIfUnlocked, polygonGradientSettings, applyRisographEffect]);


  /**
   * Draw contour polygon - creates contour lines like a topographic map using distance fields
   */
  const drawContourPolygon = useCallback((
    _ctx: CanvasRenderingContext2D,
    _polygonData: { vertices: Array<{ x: number; y: number }>; fillColor?: string },
    _isPreview: boolean = false,
    _options?: ShapeFillOptions
  ) => {
    warnShapeFillRemoved('drawContourPolygon');
    void _ctx;
    void _polygonData;
    void _isPreview;
    void _options;
  }, []);

  /**
   * Draw cross-hatch polygon - fills with rough, hand-drawn cross-hatching pattern
   */
  const drawCrossHatchPolygon = useCallback((
    _ctx: CanvasRenderingContext2D,
    _polygonData: {
      vertices: Array<{ x: number; y: number }>;
      fillColor?: string;
      spacingOverride?: number;
      rotationOverride?: number;
      lineWidthOverride?: number;
    },
    _isPreview: boolean = false
  ) => {
    warnShapeFillRemoved('drawCrossHatchPolygon');
    void _ctx;
    void _polygonData;
    void _isPreview;
  }, []);

  /**
   * Draw Delaunay polygon - fills with triangulated network of lines
   */
  const drawDelaunayPolygon = useCallback((
    _ctx: CanvasRenderingContext2D,
    _polygonData: { vertices: Array<{ x: number; y: number }>; fillColor?: string },
    _isPreview: boolean = false,
    _options?: ShapeFillOptions
  ) => {
    warnShapeFillRemoved('drawDelaunayPolygon');
    void _ctx;
    void _polygonData;
    void _isPreview;
    void _options;
  }, []);

  /**
   * Initialize Color Cycle Brush for the active layer
   */
  const initializeColorCycleBrush = useCallback((options?: { skipGradientReinit?: boolean }) => {
    return initializeColorCycleBrushForActiveLayer<ColorCycleBrushImplementation>({
      activeLayerId,
      projectWidth: project?.width,
      projectHeight: project?.height,
      brushSettings: tools.brushSettings,
      isCCGradientActiveLayer,
      defaultBandSpacing: DEFAULT_CC_BAND_SPACING,
      clampColorCycleBandSpacing,
      resolveBrushPressureRange,
      getLayers: () => useAppStore.getState().layers,
      initColorCycleForLayer: (layerId, width, height) => useAppStore.getState().initColorCycleForLayer(layerId, width, height),
      getActiveLayerColorCycleBrush,
      requestGradientApply,
      skipGradientReinit: options?.skipGradientReinit,
    });
  }, [
    tools.brushSettings,
    project?.width,
    project?.height,
    activeLayerId,
    getActiveLayerColorCycleBrush,
    isCCGradientActiveLayer,
  ]);

  const ensureColorCycleAnimation = useCallback((shouldPlay: boolean) => {
    const manager = getColorCycleBrushManager();
    ensureColorCycleAnimationForLayers({
      shouldPlay,
      layers: useAppStore.getState().layers,
      getBrush: (layerId) => manager.getBrush(layerId) as Partial<ColorCycleBrushImplementation> | undefined,
    });
  }, []);

  useEffect(() => {
    const colorCycleBrush = getActiveLayerColorCycleBrush();
    if (!colorCycleBrush) {
      return;
    }
    const flowMode = 'forward' as const;
    if (typeof colorCycleBrush.setFlowMode === 'function') {
      colorCycleBrush.setFlowMode(flowMode);
    } else {
      colorCycleBrush.setFlowDirection('forward');
    }
  }, [getActiveLayerColorCycleBrush, activeLayerId, activeLayerFlowMode]);

  /**
   * Color Cycle pipelines (keep these distinct to avoid cross-bleed):
   * - CC stroke brushes: BrushShape.COLOR_CYCLE / COLOR_CYCLE_TRIANGLE
   *   => stamp-based stroke path (drawColorCycle / endColorCycleStroke)
   *   => uses colorCycleStampDitherEnabled + stamp settings
   * - CC gradient/shape: BrushShape.COLOR_CYCLE_SHAPE
   *   => shape fill path (fillCcGradientLinear / fillCcGradientConcentric)
   *   => uses ditherEnabled + fillResolution + gradient bands
   *
   * Render Color Cycle output onto the provided context.
   * Applies opacity and optionally combines blend mode with transparency lock.
   */
  const renderColorCycle = useCallback((
    ctx: CanvasRenderingContext2D,
    applyOpacity: boolean = true,
    options?: { withOverlay?: boolean }
  ) => {
    renderColorCycleToContext({
      ctx,
      applyOpacity,
      withOverlay: options?.withOverlay ?? true,
      activeLayerId,
      getActiveLayerColorCycleBrush,
      isFgPending,
      refreshLayerCCSurface,
      ensureCanvasPixelSize,
      bindBrushToCanvas,
      requestGradientApply,
      flushGradientApply,
      brushSettings: {
        opacity: tools.brushSettings.opacity,
        blendMode: tools.brushSettings.blendMode,
      },
      activeLayerTransparencyLock,
      renderCCWithBlendAndLock,
      applyColorCycleRisographOverlay,
    });
  }, [
    activeLayerId,
    getActiveLayerColorCycleBrush,
    tools.brushSettings.opacity,
    tools.brushSettings.blendMode,
    activeLayerTransparencyLock,
    renderCCWithBlendAndLock,
    applyColorCycleRisographOverlay
  ]);
  
  /**
   * Draw with Color Cycle Brush - only paints to Canvas2D buffer, no immediate rendering
   */
  const drawColorCycle = useCallback((
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    pressure: number = 1.0,
    rotation: number = 0,
    options?: DrawColorCycleOptions
  ) => {
    drawColorCycleStroke({
      ctx,
      x,
      y,
      pressure,
      rotation,
      options,
      brushSettings: drawColorCycleSettings,
      activeLayerId,
      activeLayerTransparencyLock,
      getActiveLayerColorCycleBrush,
      getActiveLayerBitmapCanvas,
      maskHasAlphaNear,
      resolveBrushPressureRange,
      requestGradientApply,
      flushGradientApply,
      renderColorCycle,
      firstStampImmediateRef,
      mirrorScheduledRef,
    });
  }, [
    drawColorCycleSettings,
    activeLayerId,
    getActiveLayerColorCycleBrush,
    getActiveLayerBitmapCanvas,
    renderColorCycle,
    activeLayerTransparencyLock
  ]);
  
  /**
   * Reset Color Cycle - starts a new stroke with the existing brush
   */
  const resetColorCycle = useCallback((clearBuffer: boolean = false, options?: { skipGradientReinit?: boolean }) => {
    resetColorCycleStroke({
      clearBuffer,
      options,
      initializeColorCycleBrush,
      activeLayerId,
      getLayers: () => useAppStore.getState().layers,
      isColorCycleDesiredPlaying: () => selectColorCycleDesiredPlaying(useAppStore.getState()),
      bindBrushToCanvas,
      firstStampImmediateRef,
    });
  }, [initializeColorCycleBrush, activeLayerId]);
  
  /**
   * End color cycle stroke
   */
  const endColorCycleStroke = useCallback(() => {
    endColorCycleStrokeForLayer({
      activeLayerId,
      getActiveLayerColorCycleBrush,
    });
  }, [activeLayerId, getActiveLayerColorCycleBrush]);
  
  /**
   * Fill a shape with linear color cycle gradient in specified direction
   */
  const fillCcGradientLinear = useCallback(async (
    vertices: Array<{ x: number; y: number }>,
    direction: { x: number; y: number },
    options?: { ditherPixelSize?: number; roi?: { x: number; y: number; width: number; height: number } }
  ) => {
    await fillColorCycleLinear({
      vertices,
      direction,
      options,
      initializeColorCycleBrush: () => initializeColorCycleBrush(),
      activeLayerId,
      isCCGradientActiveLayer,
      brushSettings: fillColorCycleSettings,
      defaultBandSpacing: DEFAULT_CC_BAND_SPACING,
      clampColorCycleBandSpacing,
      requestGradientApply,
      flushGradientApply,
      renderBrushToLayerCanvas,
    });
  }, [
    initializeColorCycleBrush,
    activeLayerId,
    fillColorCycleSettings,
    isCCGradientActiveLayer,
  ]);
  
  /**
   * Fill a shape with color cycle gradient from edges to center
   */
  const fillCcGradientConcentric = useCallback(async (
    vertices: Array<{ x: number; y: number }>,
    options?: { ditherPixelSize?: number; roi?: { x: number; y: number; width: number; height: number } }
  ) => {
    await fillColorCycleConcentric({
      vertices,
      options,
      initializeColorCycleBrush: () => initializeColorCycleBrush(),
      activeLayerId,
      isCCGradientActiveLayer,
      brushSettings: fillColorCycleSettings,
      defaultBandSpacing: DEFAULT_CC_BAND_SPACING,
      clampColorCycleBandSpacing,
      requestGradientApply,
      flushGradientApply,
      renderBrushToLayerCanvas,
    });
  }, [
    initializeColorCycleBrush,
    activeLayerId,
    fillColorCycleSettings,
    isCCGradientActiveLayer,
  ]);

  // Color cycle functions removed - now defined inline in return object to avoid stale closures
  
  const resolvedColorCycleBaseSpeed = useMemo(() => {
    const perLayerSpeed = activeLayerBrushSpeed;
    const fallbackSpeed = tools.brushSettings.colorCycleSpeed;
    if (Number.isFinite(perLayerSpeed)) {
      return perLayerSpeed as number;
    }
    if (Number.isFinite(fallbackSpeed)) {
      return fallbackSpeed as number;
    }
    return null;
  }, [
    activeLayerBrushSpeed,
    tools.brushSettings.colorCycleSpeed,
  ]);

  const resolvedColorCycleLayerSpeedScale = useMemo(() => {
    const layerScaleRaw = tools.brushSettings.colorCycleLayerSpeedScale;
    return Number.isFinite(layerScaleRaw)
      ? Math.max(MIN_CC_LAYER_SPEED_SCALE, Math.min(MAX_CC_LAYER_SPEED_SCALE, layerScaleRaw as number))
      : 1;
  }, [tools.brushSettings.colorCycleLayerSpeedScale]);

  // Update color cycle speed when it changes
  useEffect(() => {
    const colorCycleBrush = getActiveLayerColorCycleBrush();
    if (colorCycleBrush && resolvedColorCycleBaseSpeed !== null) {
      colorCycleBrush.setSpeed(resolvedColorCycleBaseSpeed);
    }
  }, [
    activeLayerId,
    getActiveLayerColorCycleBrush,
    resolvedColorCycleBaseSpeed,
  ]);

  useEffect(() => {
    const manager = getColorCycleBrushManager();
    manager.brushes?.forEach((brush) => {
      if (typeof brush.setPlaybackSpeedScale === 'function') {
        brush.setPlaybackSpeedScale(resolvedColorCycleLayerSpeedScale);
      }
    });
  }, [
    activeLayerId,
    getActiveLayerColorCycleBrush,
    resolvedColorCycleLayerSpeedScale,
  ]);

  useEffect(() => {
    const recolorManager = RecolorManager.getInstance();
    const nextSeenRecolorLayerIds = new Set<string>();

    layers.forEach((layer) => {
      if (layer.layerType !== 'color-cycle' || layer.colorCycleData?.mode !== 'recolor') {
        return;
      }
      const animation = layer.colorCycleData?.recolorSettings?.animation;
      if (!animation || !Number.isFinite(animation.speed)) {
        return;
      }

      const previousScale = recolorLayerScaleByIdRef.current.get(layer.id) ?? 1;
      const ratio = resolvedColorCycleLayerSpeedScale / Math.max(MIN_CC_LAYER_SPEED_SCALE, previousScale);
      const nextSpeed = Math.max(
        MIN_RECOLOR_COLOR_CYCLE_SPEED,
        Math.min(MAX_RECOLOR_COLOR_CYCLE_SPEED, animation.speed * ratio)
      );

      if (Math.abs(nextSpeed - animation.speed) > 1e-6) {
        animation.speed = nextSpeed;
      }

      try {
        recolorManager.setLayerSpeed(layer.id, nextSpeed);
      } catch {}

      recolorLayerScaleByIdRef.current.set(layer.id, resolvedColorCycleLayerSpeedScale);
      nextSeenRecolorLayerIds.add(layer.id);
    });

    recolorLayerScaleByIdRef.current.forEach((_value, layerId) => {
      if (!nextSeenRecolorLayerIds.has(layerId)) {
        recolorLayerScaleByIdRef.current.delete(layerId);
      }
    });
  }, [layers, resolvedColorCycleLayerSpeedScale]);
  
  // Update color cycle FPS when it changes
  useEffect(() => {
    const colorCycleBrush = getActiveLayerColorCycleBrush();
    if (colorCycleBrush && tools.brushSettings.colorCycleFPS) {
      colorCycleBrush.setFPS(tools.brushSettings.colorCycleFPS);
    }
  }, [tools.brushSettings.colorCycleFPS, activeLayerId, getActiveLayerColorCycleBrush]);
  
  // Update gradient bands when it changes
  useEffect(() => {
    updateColorCycleGradientBandsForLayer({
      activeLayerId,
      getLayers: () => useAppStore.getState().layers,
      getActiveLayerColorCycleBrush,
      initializeColorCycleBrush: () => initializeColorCycleBrush(),
      gradientBands: tools.brushSettings.gradientBands,
      renderBrushToLayerCanvas,
    });
  }, [tools.brushSettings.gradientBands, getActiveLayerColorCycleBrush, activeLayerId, initializeColorCycleBrush]);

  useEffect(() => {
    updateColorCycleBandSpacingForLayer({
      activeLayerId,
      getLayers: () => useAppStore.getState().layers,
      getActiveLayerColorCycleBrush,
      initializeColorCycleBrush: () => initializeColorCycleBrush(),
      brushShape: tools.brushSettings.brushShape,
      colorCycleBandSpacingPx: tools.brushSettings.colorCycleBandSpacingPx,
      spacing: tools.brushSettings.spacing,
      defaultBandSpacing: DEFAULT_CC_BAND_SPACING,
      clampColorCycleBandSpacing,
      renderBrushToLayerCanvas,
    });
  }, [
    tools.brushSettings.colorCycleBandSpacingPx,
    tools.brushSettings.spacing,
    tools.brushSettings.brushShape,
    getActiveLayerColorCycleBrush,
    activeLayerId,
    initializeColorCycleBrush,
  ]);
  
  // Update dithering toggle for color-cycle shape fills
  useEffect(() => {
    updateColorCycleDitherSettings({
      brush: getActiveLayerColorCycleBrush(),
      isCCGradientActiveLayer,
      ditherEnabled: tools.brushSettings.ditherEnabled,
      stampDitherEnabled: tools.brushSettings.colorCycleStampDitherEnabled,
      ditherAlgorithm: tools.brushSettings.ditherAlgorithm,
      patternStyle: tools.brushSettings.patternStyle,
      stampDitherPressureLinked: tools.brushSettings.colorCycleStampDitherPressureLinked,
      stampDitherBgFill: tools.brushSettings.colorCycleStampDitherBgFill,
      stampDitherClears: tools.brushSettings.colorCycleStampDitherClears,
    });
  }, [
    isCCGradientActiveLayer,
    tools.brushSettings.ditherEnabled,
    tools.brushSettings.colorCycleStampDitherEnabled,
    tools.brushSettings.colorCycleStampDitherBgFill,
    tools.brushSettings.colorCycleStampDitherClears,
    tools.brushSettings.colorCycleStampDitherPressureLinked,
    tools.brushSettings.ditherAlgorithm,
    tools.brushSettings.patternStyle,
    activeLayerId,
    getActiveLayerColorCycleBrush
  ]);

  // Update dither pixel size (fillResolution) for color-cycle shape fills
  useEffect(() => {
    updateColorCycleFillDitherPixelSize({
      brush: getActiveLayerColorCycleBrush(),
      isCCGradientActiveLayer,
      pressureLinkedFillResolution: tools.brushSettings.pressureLinkedFillResolution,
      fillResolution: tools.brushSettings.fillResolution,
    });
  }, [
    tools.brushSettings.fillResolution,
    tools.brushSettings.pressureLinkedFillResolution,
    tools.brushSettings.ditherEnabled,
    isCCGradientActiveLayer,
    activeLayerId,
    getActiveLayerColorCycleBrush,
  ]);

  // Update stamp dithering pixel size for color-cycle strokes
  useEffect(() => {
    updateColorCycleStampDitherPixelSize({
      brush: getActiveLayerColorCycleBrush(),
      stampDitherPixelSize: tools.brushSettings.colorCycleStampDitherPixelSize,
    });
  }, [
    tools.brushSettings.colorCycleStampDitherPixelSize,
    activeLayerId,
    getActiveLayerColorCycleBrush
  ]);

  // Perceptual dithering removed
  
  // Sync brush size + pressure with debounce so rapid slider changes don't stall UI
  useEffect(() => {
    const targetSize = Math.max(1, Math.round(tools.brushSettings.size || 1));
    brushSizePendingRef.current = targetSize;
    brushPressurePendingRef.current = normalizePressureSettings(tools.brushSettings);

    cancelDeferred(brushSizeDeferredHandleRef.current);
    brushSizeDeferredHandleRef.current = scheduleDeferred(() => {
      brushSizeDeferredHandleRef.current = null;
      applyPendingBrushSizing();
    }, 150);

    return () => {
      cancelDeferred(brushSizeDeferredHandleRef.current);
      brushSizeDeferredHandleRef.current = null;
    };
  }, [
    tools.brushSettings,
    tools.brushSettings.size,
    tools.brushSettings.pressureEnabled,
    tools.brushSettings.minPressure,
    tools.brushSettings.maxPressure,
    tools.brushSettings.brushShape,
    applyPendingBrushSizing,
    activeLayerId,
  ]);

  const lastActiveLayerIdRef = useRef<string | null>(activeLayerId);
  useEffect(() => {
    if (lastActiveLayerIdRef.current !== activeLayerId) {
      lastActiveLayerIdRef.current = activeLayerId;
      applyPendingBrushSizing();
    }
  }, [activeLayerId, applyPendingBrushSizing]);

  useEffect(() => {
    let previous = selectEffectiveColorCyclePlaying(useAppStore.getState());
    ensureColorCycleAnimation(previous);

    const unsubscribe = useAppStore.subscribe((state) => {
      const next = selectEffectiveColorCyclePlaying(state);
      if (next === previous) {
        return;
      }
      previous = next;
      ensureColorCycleAnimation(next);
    });

    return () => {
      unsubscribe();
    };
  }, [ensureColorCycleAnimation, activeLayerId]);

  // Clean up resources
  useEffect(() => {
    const cache = brushStampCacheRef.current;
    return () => {
      // Clear brush stamp cache on unmount
      cache.clear();

      // DON'T cleanup color cycle brush when switching layers!
      // This was causing the crash - the brush was being destroyed
      // but the layer still thought it had a CC brush.
      // CC brushes should persist with their layers.
    };
  }, []); // Empty dependency array - only cleanup on unmount

  // Return simplified API - NO useMemo to avoid stale closures
  return {
    // Core drawing functions
    drawBrush,
    drawStamp,
    finalizeStroke,
    resetStroke,
    
    // Shape drawing
    drawRectangleGradient,
    drawPolygonGradient,
    drawContourPolygon,
    drawCrossHatchPolygon,
    drawDelaunayPolygon,
    
    // Color cycle brush
    drawColorCycle,
    renderColorCycle,
    resetColorCycle,
    endColorCycleStroke,
    fillCcGradientConcentric,
    fillCcGradientLinear,
    
    // Force immediate texture update for color cycle brush
    updateColorCycleTexture: () => {
      const colorCycleBrush = getActiveLayerColorCycleBrush();
      if (colorCycleBrush) {
        renderBrushToLayerCanvas(colorCycleBrush, activeLayerId);
      }
    },
    
    // These need fresh ref access, define inline:
    updateColorCycleGradient: (stops: Array<{ position: number; color: string }>) => {
      const colorCycleBrush = getActiveLayerColorCycleBrush();
      if (!colorCycleBrush || !activeLayerId) {
        return;
      }
      applyGradientEdit({ stops, layerId: activeLayerId, intent: 'commitRecolor' });
      renderBrushToLayerCanvas(colorCycleBrush, activeLayerId);
    },
    
    updateColorCycleSpeed: (speed: number) => {
      const colorCycleBrush = getActiveLayerColorCycleBrush();
      if (colorCycleBrush) {
        colorCycleBrush.setSpeed(speed);
      }
    },
    
    setColorCycleFlowMode: (_mode: 'forward' | 'reverse' | 'pingpong') => {
      void _mode;
      const colorCycleBrush = getActiveLayerColorCycleBrush();
      if (colorCycleBrush) {
        if (typeof colorCycleBrush.setFlowMode === 'function') {
          colorCycleBrush.setFlowMode('forward');
        } else {
          colorCycleBrush.setFlowDirection('forward');
        }
      }
    },

    ensureColorCycleAnimation: (shouldPlay: boolean) => {
      ensureColorCycleAnimation(shouldPlay);
    },
    
    updateColorCycleAnimation: () => {
      // Manually update animation state for external render loops
      const colorCycleBrush = getActiveLayerColorCycleBrush();
      if (colorCycleBrush) {
        colorCycleBrush.updateAnimation();
      }
    },
    
    isColorCycleAnimating: () => {
      const colorCycleBrush = getActiveLayerColorCycleBrush();
      if (!colorCycleBrush) return false;
      return colorCycleBrush.isPlaying();
    },
    
    clearColorCycleStrokes: () => {
      const colorCycleBrush = getActiveLayerColorCycleBrush();
      if (colorCycleBrush) {
        colorCycleBrush.clear();
      }
    },

    ensureColorCycleBrush: () => {
      // CRITICAL: Only ensure brush for color-cycle layers
      const state = useAppStore.getState();
      const activeLayer = state.layers.find(l => l.id === activeLayerId);
      if (!activeLayer || activeLayer.layerType !== 'color-cycle') {
        // Silently skip for non-CC layers
        return;
      }
      
      // Ensure brush exists without starting a stroke
      let colorCycleBrush = getActiveLayerColorCycleBrush();
      if (!colorCycleBrush) {
        initializeColorCycleBrush();
        colorCycleBrush = getActiveLayerColorCycleBrush();
      }
      // Make sure it's not in drawing mode for animation
      const layerId = activeLayerId;
      if (colorCycleBrush && layerId) {
        colorCycleBrush.endStroke(layerId);
      }
    },

    // Effects
    applyStrokeDither,
    applyDithering,
    
    // Utilities
    canDrawAt: (ctx: CanvasRenderingContext2D, x: number, y: number) => 
      brushEngine.canDrawAt(ctx, x, y),
    consumeRecentStamps: () => brushEngine.consumeRecentStamps(),
    
    // Direct access to engine for advanced use
    engine: brushEngine
  };
};

// Export type for the hook return value
export type BrushEngine = ReturnType<typeof useBrushEngineSimplified>;
