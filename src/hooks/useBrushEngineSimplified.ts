/**
 * Simplified Brush Engine Hook
 * Clean interface using the facade pattern
 */

import { getAppStoreState } from '@/stores/appStoreAccess';
import { debugWarn, logError } from '@/utils/debug';
import { useCallback, useMemo, useRef, useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  selectEffectiveColorCyclePlaying,
  selectPlaybackSpeedScale,
  useAppStore
} from '../stores/useAppStore';
import { resolveExplicitLayerColorCycleBaseSpeed } from '@/utils/colorCycleLayerSpeed';
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
import { isCcGradientPreset } from '@/presets/brushPresets';
import { createCcCustomTileThresholdResolver } from '@/utils/colorCycle/ccCustomTilePattern';
import {
  computePressureResolution,
  createPressureResolutionState,
  resolvePressureLinkedFillMaxResolution,
  type PressureResolutionState,
} from '@/utils/pressureResolution';
import type {
  ColorCycleBrushLayerSnapshot,
} from '@/lib/colorCycle/document';
import {
  bindBrushToCanvas,
  refreshLayerCCSurface,
  renderBrushToLayerCanvas,
  type ColorCycleLayerRenderBrush,
  type ColorCycleSurfaceBrush,
} from './brushEngine/colorCycleSurface';
import type {
  ColorCycleClearBrushContext,
  ColorCycleInitBrushContext,
  ColorCycleLayerActivationBrushContext,
  ColorCyclePlaybackBrushContext,
  ColorCycleSpeedSettingsBrushContext,
} from './brushEngine/colorCycleBrushContracts';
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
  bindActiveColorCycleFramePublication,
  ensureColorCycleAnimationForLayers,
  initializeColorCycleBrushForActiveLayer,
} from './brushEngine/colorCycleInitController';
import {
  drawColorCycleStroke,
  type ColorCycleDrawBrush,
  renderColorCycleToContext,
} from './brushEngine/colorCycleDrawController';
import {
  createColorCyclePixelPerfectStrokeState,
  flushColorCyclePixelPerfectStroke,
} from './brushEngine/colorCycleStrokeRouting';
import type { ColorCycleRenderBrush } from './brushEngine/colorCycleRenderController';
import { getMaskManager } from '@/layers/MaskManager';
import type { ColorCyclePaintMask } from '@/lib/colorCycle/document';
import {
  createColorCycleTransparencyLockMaskCanvas,
  renderColorCycleWithBlendAndLock,
} from './brushEngine/colorCycleBlendLockController';
import { applyColorCycleRisographOverlay as applyColorCycleRisographOverlayController } from './brushEngine/colorCycleRisographOverlayController';
import {
  endColorCycleStrokeForLayer,
  resetColorCycleStroke,
  type ColorCycleBrushLifecycle,
} from './brushEngine/colorCycleStrokeLifecycleController';
import {
  updateColorCycleBandSpacingForLayer,
  applyColorCycleBrushSettingsPatch,
  updateColorCycleDitherPaletteSpreadForLayer,
  updateColorCycleDitherSettings,
  updateColorCycleFillDitherPixelSize,
  updateColorCycleGradientBandsForLayer,
  updateColorCycleStampDitherPixelSize,
} from './brushEngine/colorCycleBrushSettingsController';
import type { ColorCycleSettingsPatchBrush } from './brushEngine/colorCycleBrushSettingsPatch';
import {
  fillColorCycleConcentric,
  fillColorCycleLinear,
  type ColorCycleFillBrush,
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
import {
  flushGradientApply,
  requestGradientApply,
} from '@/hooks/brushEngine/ccGradientApplyScheduler';
import { applyGradientEdit } from '@/hooks/brushEngine/ccGradientController';
import { sanitizeEraserTipSettings } from '@/stores/helpers/eraserSettings';

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

type ActiveColorCycleSettingsSurfaceBrush =
  ColorCycleSettingsPatchBrush &
  ColorCycleSurfaceBrush;

type ActiveColorCycleFillBrush =
  ColorCycleFillBrush &
  ColorCycleLayerRenderBrush;

/**
 * Simplified brush engine hook with facade pattern
 */
type DrawColorCycleOptions = {
  customStamp?: CustomBrushStrokeData;
  speedSamplePxPerMs?: number;
};

type ShapeFillOptions = Record<string, unknown>;
export type { StrokeBounds } from './brushEngine/engineShared';
export { refreshLayerCCSurface } from './brushEngine/colorCycleSurface';

export const useBrushEngineSimplified = () => {
  const { tools, project, activeLayerId } = useAppStore(
    useShallow((state) => ({
      tools: state.tools,
      project: state.project,
      activeLayerId: state.activeLayerId,
    })),
  );
  const layers = useAppStore((state) => state.layers);
  const playbackSpeedScale = useAppStore(selectPlaybackSpeedScale);
  const activeLayerBaseSpeed = useAppStore((state) => {
    const layer = state.layers.find(l => l.id === state.activeLayerId);
    return resolveExplicitLayerColorCycleBaseSpeed(layer?.colorCycleData);
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
  const colorCycleGridSnapStrokePointRef = useRef<{ x: number; y: number } | null>(null);
  const colorCyclePixelPerfectStrokeStateRef = useRef(
    createColorCyclePixelPerfectStrokeState(),
  );
  const colorCycleRoundedCornerAnchorsRef = useRef<Array<{ x: number; y: number }>>([]);
  const colorCycleRoundedCornerBaselineSnapshotRef = useRef<ColorCycleBrushLayerSnapshot | null>(null);
  const colorCycleTransparencyLockMaskCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const captureColorCycleTransparencyLockMask = useCallback((): void => {
    const documentSnapshot = activeLayerId
      ? getColorCycleBrushManager().getDocument?.(activeLayerId)?.read().snapshot
      : null;
    colorCycleTransparencyLockMaskCanvasRef.current = activeLayerTransparencyLock && documentSnapshot
      ? createColorCycleTransparencyLockMaskCanvas({
          paintMask: documentSnapshot.paintBuffer
            ? new Uint8Array(documentSnapshot.paintBuffer)
            : null,
          width: documentSnapshot.width,
          height: documentSnapshot.height,
        })
      : null;
  }, [activeLayerId, activeLayerTransparencyLock]);

  useEffect(() => {
    captureColorCycleTransparencyLockMask();
  }, [captureColorCycleTransparencyLockMask]);

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

  const resolvedEngineBrushSettings = useMemo(() => {
    if (tools.currentTool !== 'eraser') {
      return tools.brushSettings;
    }
    return {
      ...tools.brushSettings,
      ...tools.eraserSettings,
      ...sanitizeEraserTipSettings(tools.eraserSettings),
    };
  }, [tools.brushSettings, tools.currentTool, tools.eraserSettings]);

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
  const liveStrokeBaseRef = useRef<HTMLCanvasElement | OffscreenCanvas | null>(null);
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
    return ensureLiveStrokeBuffersForContext(
      ctx,
      liveStrokeRawRef,
      liveStrokeDitherRef,
      liveStrokeBaseRef,
      tools.brushSettings.brushShape === BrushShape.PIXEL_DITHER &&
        tools.brushSettings.ditherBackgroundFill === false &&
        strokeBoundsRef.current === null &&
        liveStrokeBoundsRef.current === null,
    );
  }, [
    tools.brushSettings.brushShape,
    tools.brushSettings.ditherBackgroundFill,
  ]);

  const clearLiveStrokeBuffers = useCallback(() => {
    clearLiveStrokeBufferCanvases(liveStrokeRawRef, liveStrokeDitherRef, liveStrokeBaseRef);
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
  }, [
    tools.brushSettings.pressureLinkedFillMaxResolution,
    tools.brushSettings.pressureLinkedFillResolution,
    runResetPressureDitherRuntime,
  ]);

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
      transparencyLockMaskCanvas: colorCycleTransparencyLockMaskCanvasRef.current,
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
  const PRES_RES_HOLD_ON_ZERO_MS = 120;
  const presResLastLogAtRef = useRef(0);
  const presResLastLoggedPixelSizeRef = useRef<number | null>(null);
  const brushSizeDeferredHandleRef = useRef<IdleHandle>(null);

  const getActiveLayerPlaybackBrush = useCallback((): ColorCyclePlaybackBrushContext | null => {
    if (!activeLayerId) return null;
    return getColorCycleBrushManager().getPlaybackBrush(activeLayerId);
  }, [activeLayerId]);

  const getActiveLayerSurfaceBrush = useCallback((): ColorCycleSurfaceBrush | null => {
    if (!activeLayerId) return null;
    return getColorCycleBrushManager().getSurfaceBrush(activeLayerId);
  }, [activeLayerId]);

  const getActiveLayerRenderBrush = useCallback((): ColorCycleRenderBrush | null => {
    if (!activeLayerId) return null;
    const brush = getColorCycleBrushManager().getSurfaceBrush(activeLayerId);
    if (!brush || typeof brush.renderDirectToCanvas !== 'function') {
      return null;
    }
    return brush as ColorCycleRenderBrush;
  }, [activeLayerId]);

  const getActiveLayerSettingsBrush = useCallback((): ColorCycleSettingsPatchBrush | null => {
    if (!activeLayerId) return null;
    return getColorCycleBrushManager().getSettingsPatchBrush(activeLayerId);
  }, [activeLayerId]);

  const getActiveLayerSettingsSurfaceBrush = useCallback((): ActiveColorCycleSettingsSurfaceBrush | null => {
    if (!activeLayerId) return null;
    const manager = getColorCycleBrushManager();
    const settingsBrush = manager.getSettingsPatchBrush(activeLayerId);
    const surfaceBrush = manager.getSurfaceBrush(activeLayerId);
    if (!settingsBrush && !surfaceBrush) {
      return null;
    }
    return {
      ...(surfaceBrush ?? {}),
      ...(settingsBrush ?? {}),
    };
  }, [activeLayerId]);

  const getActiveLayerActivationBrush = useCallback((): ColorCycleLayerActivationBrushContext | null => {
    if (!activeLayerId) return null;
    return getColorCycleBrushManager().getLayerActivationBrush(activeLayerId);
  }, [activeLayerId]);

  const getActiveLayerClearBrush = useCallback((): ColorCycleClearBrushContext | null => {
    if (!activeLayerId) return null;
    return getColorCycleBrushManager().getClearBrush(activeLayerId);
  }, [activeLayerId]);

  const getActiveLayerInitBrush = useCallback((): ColorCycleInitBrushContext | null => {
    if (!activeLayerId) return null;
    return getColorCycleBrushManager().getInitBrush(activeLayerId);
  }, [activeLayerId]);

  const getActiveLayerDrawBrush = useCallback((): ColorCycleDrawBrush | null => {
    if (!activeLayerId) return null;
    return getColorCycleBrushManager().getDrawBrush(activeLayerId);
  }, [activeLayerId]);

  const getActiveLayerFillBrush = useCallback((): ActiveColorCycleFillBrush | null => {
    if (!activeLayerId) return null;
    return getColorCycleBrushManager().getFillBrush(activeLayerId);
  }, [activeLayerId]);

  const getActiveLayerStrokeLifecycleBrush = useCallback((): ColorCycleBrushLifecycle | null => {
    if (!activeLayerId) return null;
    return getColorCycleBrushManager().getStrokeLifecycleBrush(activeLayerId);
  }, [activeLayerId]);

  const getActiveLayerSpeedSettingsBrush = useCallback((): ColorCycleSpeedSettingsBrushContext | null => {
    if (!activeLayerId) return null;
    return getColorCycleBrushManager().getSpeedSettingsBrush(activeLayerId);
  }, [activeLayerId]);

  const applyPendingBrushSizing = useCallback(() => {
    const colorCycleBrush = getActiveLayerSettingsBrush();
    if (!colorCycleBrush) {
      return;
    }
    const pressure = brushPressurePendingRef.current;
    try {
      applyColorCycleBrushSettingsPatch(colorCycleBrush, {
        brushSize: brushSizePendingRef.current,
        pressureEnabled: pressure.enabled,
        minPressure: pressure.min,
        maxPressure: pressure.max,
      });
    } catch (error) {
      logError('[CC Effect] Failed to sync pressure settings:', error);
    }
  }, [getActiveLayerSettingsBrush]);

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
      brushSettings: resolvedEngineBrushSettings,
      clamp,
      inflateRect,
    });
  }, [resolvedEngineBrushSettings]);

  // Create brush engine facade - only recreate when structural dependencies change
  const brushEngine = useMemo(() => {
    const config: BrushEngineConfig = {
      brushSettings: resolvedEngineBrushSettings,
      transparencyLockEnabled: Boolean(activeLayerTransparencyLock),
      getPatternTempContext,
      brushStampCache: brushStampCacheRef.current,
      createPixelCircleStamp,
      createPixelSquareStamp,
      getRotationTempContext,
      customBrushes: project?.customBrushes || []
    };

    return createBrushEngineFacade(config);
  }, [resolvedEngineBrushSettings, project?.customBrushes, getPatternTempContext, createPixelCircleStamp, createPixelSquareStamp, getRotationTempContext, activeLayerTransparencyLock]);

  // Update engine config when settings change
  useEffect(() => {
    brushEngine.updateConfig({
      brushSettings: resolvedEngineBrushSettings,
      transparencyLockEnabled: Boolean(activeLayerTransparencyLock),
      getPatternTempContext,
      brushStampCache: brushStampCacheRef.current,
      getRotationTempContext
    });

    // Initialize spam text when the Spam Text brush is selected
    if (resolvedEngineBrushSettings.brushShape === BrushShape.SPAM_TEXT) {
      const contentType = resolvedEngineBrushSettings.spamContentType || 'mixed';
      const customText = resolvedEngineBrushSettings.spamCustomText;
      brushEngine.initializeSpamText(contentType, customText);
    }
  }, [brushEngine, resolvedEngineBrushSettings, getPatternTempContext, getRotationTempContext, activeLayerTransparencyLock]);

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
  const strokeImageTileThresholdResolver = useMemo(() => (
    createCcCustomTileThresholdResolver(project?.ccCustomTilePatterns, {
      patternTileId: tools.brushSettings.patternTileId,
      patternTileScale: tools.brushSettings.patternTileScale,
      patternTileInvert: tools.brushSettings.patternTileInvert,
      patternTileThreshold: tools.brushSettings.patternTileThreshold,
      patternTileOffsetX: tools.brushSettings.patternTileOffsetX,
      patternTileOffsetY: tools.brushSettings.patternTileOffsetY,
    })
  ), [
    project?.ccCustomTilePatterns,
    tools.brushSettings.patternTileId,
    tools.brushSettings.patternTileInvert,
    tools.brushSettings.patternTileOffsetX,
    tools.brushSettings.patternTileOffsetY,
    tools.brushSettings.patternTileScale,
    tools.brushSettings.patternTileThreshold,
  ]);

  const currentBrushPreset = useAppStore((state) => state.currentBrushPreset);
  const activeLayer = useMemo(() => {
    return layers.find((layer) => layer.id === activeLayerId) ?? null;
  }, [layers, activeLayerId]);
  const isCCGradient = isCcGradientPreset(currentBrushPreset?.id);
  const isCCStrokePreset = currentBrushPreset?.id === 'color-cycle-stroke';
  const isCCGradientActiveLayer = isCCGradient && activeLayer?.layerType === 'color-cycle';
  const shouldApplyToolbarColorCycleSettings = (isCCGradient || isCCStrokePreset) && activeLayer?.layerType === 'color-cycle';
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
    debugWarn('raw-console', '[Dither] Legacy Dither Stroke path hit by non-dither brush', {
      context,
      brushShape: tools.brushSettings.brushShape,
      presetId: currentBrushPreset?.id ?? null,
    });
  }, [currentBrushPreset?.id, isDitherStrokeBrush, tools.brushSettings.brushShape]);

  const isPixelDitherNoBg = useMemo(() => {
    return (
      isDitherStrokeBrush &&
      shouldApplyStrokeDither &&
      tools.brushSettings.ditherBackgroundFill === false
    );
  }, [isDitherStrokeBrush, shouldApplyStrokeDither, tools.brushSettings.ditherBackgroundFill]);

  const computePressureScaledResolution = useCallback((pressure: number) => {
    const baseResolution = tools.brushSettings.fillResolution || 1;
    const maxResolution = resolvePressureLinkedFillMaxResolution({
      fillResolution: baseResolution,
      pressureLinkedFillMaxResolution: tools.brushSettings.pressureLinkedFillMaxResolution,
    });
    return computePressureResolution(
      baseResolution,
      pressure,
      tools.brushSettings.pressureLinkedFillResolution ?? false,
      strokePressureResStateRef.current,
      undefined,
      maxResolution
    );
  }, [
    tools.brushSettings,
  ]);

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
    lostEdgePercent?: number,
    tileSize?: number,
  ) => {
    applyLostEdgeToStrokeAlphaData(
      data,
      width,
      height,
      lostEdgePercent,
      tileSize,
    );
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
      imageTileThresholdResolver: strokeImageTileThresholdResolver ?? undefined,
      DD,
    });
  }, [
    applyLostEdgeToStrokeAlpha,
    computePressureScaledResolution,
    getStrokeDitherPixelSize,
    tools.brushSettings,
    transparentInk,
    strokeDitherPalette,
    strokeImageTileThresholdResolver,
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
      quantizeSourceAlpha?: boolean;
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
      liveStrokeBaseRef,
      liveStrokeBoundsRef,
      strokeBoundsRef,
      liveDirtyRectRef,
      shouldApplyStrokeDither,
      brushSettings: tools.brushSettings,
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
      pressureDitherSmoosh: tools.brushSettings.pressureDitherSmoosh === true,
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
    tools.brushSettings.pressureDitherSmoosh,
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
      liveStrokeBaseRef,
      clearLiveStrokeBuffers,
      clearCoverageMaps,
      finalizeStroke: (targetCtx) => brushEngine.finalizeStroke(targetCtx),
      withAlphaLock,
      shouldApplyStrokeDither,
      finalizeStrokeSettings,
      applyLostEdgeMaskInRegion,
      committedPixelSizeRef,
      lastPressureDitherPixelSizeRef,
      getStrokeDitherPixelSize,
      ditherRegionWithCurrentPressure,
      applyStrokeDither,
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
      resetStroke: () => brushEngine.resetStroke(),
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
    customPalette?: string[],
    imageTileThresholdResolver?: (x: number, y: number) => number | null
  ) => {
    return brushEngine.applyDithering(
      imageData,
      numColors,
      algorithm,
      patternStyle,
      customPalette,
      imageTileThresholdResolver
    );
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
    patternTileId: tools.brushSettings.patternTileId,
    patternTileScale: tools.brushSettings.patternTileScale,
    patternTileInvert: tools.brushSettings.patternTileInvert,
    patternTileThreshold: tools.brushSettings.patternTileThreshold,
    patternTileOffsetX: tools.brushSettings.patternTileOffsetX,
    patternTileOffsetY: tools.brushSettings.patternTileOffsetY,
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
    tools.brushSettings.patternTileId,
    tools.brushSettings.patternTileScale,
    tools.brushSettings.patternTileInvert,
    tools.brushSettings.patternTileThreshold,
    tools.brushSettings.patternTileOffsetX,
    tools.brushSettings.patternTileOffsetY,
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
    patternTileId: tools.brushSettings.patternTileId,
    patternTileScale: tools.brushSettings.patternTileScale,
    patternTileInvert: tools.brushSettings.patternTileInvert,
    patternTileThreshold: tools.brushSettings.patternTileThreshold,
    patternTileOffsetX: tools.brushSettings.patternTileOffsetX,
    patternTileOffsetY: tools.brushSettings.patternTileOffsetY,
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
    tools.brushSettings.patternTileId,
    tools.brushSettings.patternTileScale,
    tools.brushSettings.patternTileInvert,
    tools.brushSettings.patternTileThreshold,
    tools.brushSettings.patternTileOffsetX,
    tools.brushSettings.patternTileOffsetY,
  ]);

  const drawColorCycleSettings = useMemo(() => ({
    size: tools.brushSettings.size,
    brushShape: tools.brushSettings.brushShape,
    colorCycleStampShape: tools.brushSettings.colorCycleStampShape,
    color: tools.brushSettings.color,
    colorCycleGradient: tools.brushSettings.colorCycleGradient,
    gridSnapEnabled: tools.brushSettings.gridSnapEnabled,
    gridSnapSize: tools.brushSettings.gridSnapSize,
    customBrushSnapEnabled: tools.brushSettings.customBrushSnapEnabled,
    roundedCornersEnabled: tools.brushSettings.roundedCornersEnabled,
    cornerRadiusPx: tools.brushSettings.cornerRadiusPx,
    pressureEnabled: tools.brushSettings.pressureEnabled,
    minPressure: tools.brushSettings.minPressure,
    maxPressure: tools.brushSettings.maxPressure,
  }), [
    tools.brushSettings.size,
    tools.brushSettings.brushShape,
    tools.brushSettings.colorCycleStampShape,
    tools.brushSettings.color,
    tools.brushSettings.colorCycleGradient,
    tools.brushSettings.gridSnapEnabled,
    tools.brushSettings.gridSnapSize,
    tools.brushSettings.customBrushSnapEnabled,
    tools.brushSettings.roundedCornersEnabled,
    tools.brushSettings.cornerRadiusPx,
    tools.brushSettings.pressureEnabled,
    tools.brushSettings.minPressure,
    tools.brushSettings.maxPressure,
  ]);

  const fillColorCycleSettings = useMemo(() => ({
    ditherEnabled: tools.brushSettings.ditherEnabled,
    gradientBands: tools.brushSettings.gradientBands,
    brushShape: tools.brushSettings.brushShape,
    gridSnapEnabled: tools.brushSettings.gridSnapEnabled,
    gridSnapSize: tools.brushSettings.gridSnapSize,
    colorCycleBandSpacingPx: tools.brushSettings.colorCycleBandSpacingPx,
    spacing: tools.brushSettings.spacing,
    lostEdge: tools.brushSettings.lostEdge,
    ditherBackgroundFill: tools.brushSettings.ditherBackgroundFill,
    ditherGradBgFill: tools.brushSettings.ditherGradBgFill,
    ditherPaletteSpread: tools.brushSettings.ditherPaletteSpread,
    ditherPatternDiversity: tools.brushSettings.ditherPatternDiversity,
    ccFlatCycleDither: tools.brushSettings.ccFlatCycleDither,
    ccFlatCycleBands: tools.brushSettings.ccFlatCycleBands,
  }), [
    tools.brushSettings.ditherEnabled,
    tools.brushSettings.gradientBands,
    tools.brushSettings.brushShape,
    tools.brushSettings.gridSnapEnabled,
    tools.brushSettings.gridSnapSize,
    tools.brushSettings.colorCycleBandSpacingPx,
    tools.brushSettings.spacing,
    tools.brushSettings.lostEdge,
    tools.brushSettings.ditherBackgroundFill,
    tools.brushSettings.ditherGradBgFill,
    tools.brushSettings.ditherPaletteSpread,
    tools.brushSettings.ditherPatternDiversity,
    tools.brushSettings.ccFlatCycleDither,
    tools.brushSettings.ccFlatCycleBands,
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

  const ensureColorCycleBrushInitialized = useCallback((options?: { skipGradientReinit?: boolean }): boolean => {
    return Boolean(initializeColorCycleBrushForActiveLayer<ColorCycleInitBrushContext>({
      activeLayerId,
      projectWidth: project?.width,
      projectHeight: project?.height,
      brushSettings: tools.brushSettings,
      playbackSpeedScale,
      isCCGradientActiveLayer,
      defaultBandSpacing: DEFAULT_CC_BAND_SPACING,
      clampColorCycleBandSpacing,
      resolveBrushPressureRange,
      getLayers: () => getAppStoreState().layers,
      initColorCycleForLayer: (layerId, width, height) => getAppStoreState().initColorCycleForLayer(layerId, width, height),
      getActiveLayerColorCycleBrush: getActiveLayerInitBrush,
      requestGradientApply,
      skipGradientReinit: options?.skipGradientReinit,
    }));
  }, [
    tools.brushSettings,
    playbackSpeedScale,
    project?.width,
    project?.height,
    activeLayerId,
    getActiveLayerInitBrush,
    isCCGradientActiveLayer,
  ]);

  const ensureColorCycleAnimation = useCallback((shouldPlay: boolean) => {
    ensureColorCycleAnimationForLayers({
      shouldPlay,
      layers: getAppStoreState().layers,
      getPlaybackBrush: (layerId) =>
        getColorCycleBrushManager().getPlaybackBrush(layerId) ?? undefined,
    });
  }, []);

  useEffect(() => {
    const colorCycleBrush = getActiveLayerPlaybackBrush();
    if (!colorCycleBrush) {
      return;
    }
    const flowMode = 'forward' as const;
    if (typeof colorCycleBrush.setFlowMode === 'function') {
      colorCycleBrush.setFlowMode(flowMode);
    } else if (typeof colorCycleBrush.setFlowDirection === 'function') {
      colorCycleBrush.setFlowDirection('forward');
    }
  }, [getActiveLayerPlaybackBrush, activeLayerId, activeLayerFlowMode]);

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
      getActiveLayerColorCycleBrush: getActiveLayerRenderBrush,
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
    getActiveLayerRenderBrush,
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
    const healColorCycleEraseMask = (layerId: string, paintMask: ColorCyclePaintMask): void => {
      try {
        const layer = getAppStoreState().layers.find((entry) => entry.id === layerId);
        const colorCycleData = layer?.colorCycleData;
        const shouldHealEraseMask = Boolean(
          colorCycleData?.eraseMask &&
          ((colorCycleData.eraseMaskVersion ?? 0) > 0 || colorCycleData.eraseMaskImageData)
        );
        if (!shouldHealEraseMask) {
          return;
        }
        getMaskManager().addPendingHealMask(layerId, paintMask);
      } catch {}
    };
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
      getActiveLayerColorCycleBrush: () => (
        ensureColorCycleBrushInitialized()
          ? getActiveLayerDrawBrush()
          : null
      ),
      getActiveLayerBitmapCanvas,
      getTransparencyLockMaskCanvas: () => colorCycleTransparencyLockMaskCanvasRef.current,
      maskHasAlphaNear,
      resolveBrushPressureRange,
      requestGradientApply,
      flushGradientApply,
      renderColorCycle,
      healColorCycleEraseMask,
      firstStampImmediateRef,
      mirrorScheduledRef,
      gridSnapStrokePointRef: colorCycleGridSnapStrokePointRef,
      pixelPerfectStrokeStateRef: colorCyclePixelPerfectStrokeStateRef,
      roundedCornerAnchorsRef: colorCycleRoundedCornerAnchorsRef,
      roundedCornerBaselineSnapshotRef: colorCycleRoundedCornerBaselineSnapshotRef,
    });
  }, [
    drawColorCycleSettings,
    activeLayerId,
    ensureColorCycleBrushInitialized,
    getActiveLayerDrawBrush,
    getActiveLayerBitmapCanvas,
    renderColorCycle,
    activeLayerTransparencyLock,
    colorCycleGridSnapStrokePointRef
  ]);

  /**
   * Reset Color Cycle - starts a new stroke with the existing brush
   */
  const resetColorCycle = useCallback((clearBuffer: boolean = false, options?: { skipGradientReinit?: boolean }) => {
    flushColorCyclePixelPerfectStroke(colorCyclePixelPerfectStrokeStateRef);
    colorCycleGridSnapStrokePointRef.current = null;
    colorCycleRoundedCornerAnchorsRef.current = [];
    colorCycleRoundedCornerBaselineSnapshotRef.current = null;
    const strokeBrush = ensureColorCycleBrushInitialized(options)
      ? getActiveLayerStrokeLifecycleBrush()
      : null;
    captureColorCycleTransparencyLockMask();
    resetColorCycleStroke({
      clearBuffer,
      options,
      initializeColorCycleBrush: () => strokeBrush,
      activeLayerId,
      getLayers: () => getAppStoreState().layers,
      bindBrushToCanvas,
      beforeStartStroke: () => flushGradientApply(activeLayerId ?? undefined),
      firstStampImmediateRef,
    });
  }, [
    ensureColorCycleBrushInitialized,
    getActiveLayerStrokeLifecycleBrush,
    activeLayerId,
    captureColorCycleTransparencyLockMask,
  ]);

  /**
   * End color cycle stroke
   */
  const endColorCycleStroke = useCallback(() => {
    flushColorCyclePixelPerfectStroke(colorCyclePixelPerfectStrokeStateRef);
    colorCycleGridSnapStrokePointRef.current = null;
    colorCycleRoundedCornerAnchorsRef.current = [];
    colorCycleRoundedCornerBaselineSnapshotRef.current = null;
    endColorCycleStrokeForLayer({
      activeLayerId,
      getActiveLayerColorCycleBrush: getActiveLayerActivationBrush,
    });
  }, [activeLayerId, getActiveLayerActivationBrush]);

  /**
   * Fill a shape with linear color cycle gradient in specified direction
   */
  const fillCcGradientLinear = useCallback(async (
    vertices: Array<{ x: number; y: number }>,
    direction: { x: number; y: number },
    options?: {
      ditherLevels?: number;
      ditherPixelSize?: number;
      ditherPairBandCount?: number;
      ditherSampledStops?: import('@/utils/colorCycleGradientDefs').StoredStop[];
      ditherBaseOffsetOverride?: number;
      paintSlotOverride?: number;
      paintDefIdOverride?: number;
      shapePhaseSeedMarkId?: string | null;
      sampledMotionOverride?: import('@/types').ColorCycleSampledMotion;
      roi?: { x: number; y: number; width: number; height: number };
      linearGradientSpan?: number;
      skipPostRender?: boolean;
    }
  ) => {
    await fillColorCycleLinear({
      vertices,
      direction,
      options,
      initializeColorCycleBrush: () => (
        ensureColorCycleBrushInitialized()
          ? getActiveLayerFillBrush()
          : null
      ),
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
    ensureColorCycleBrushInitialized,
    getActiveLayerFillBrush,
    activeLayerId,
    fillColorCycleSettings,
    isCCGradientActiveLayer,
  ]);

  /**
   * Fill a shape with color cycle gradient from edges to center
   */
  const fillCcGradientConcentric = useCallback(async (
    vertices: Array<{ x: number; y: number }>,
    options?: {
      ditherLevels?: number;
      ditherPixelSize?: number;
      ditherPairBandCount?: number;
      ditherSampledStops?: import('@/utils/colorCycleGradientDefs').StoredStop[];
      ditherBaseOffsetOverride?: number;
      paintSlotOverride?: number;
      paintDefIdOverride?: number;
      shapePhaseSeedMarkId?: string | null;
      sampledMotionOverride?: import('@/types').ColorCycleSampledMotion;
      roi?: { x: number; y: number; width: number; height: number };
      skipPostRender?: boolean;
    }
  ) => {
    await fillColorCycleConcentric({
      vertices,
      options,
      initializeColorCycleBrush: () => (
        ensureColorCycleBrushInitialized()
          ? getActiveLayerFillBrush()
          : null
      ),
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
    ensureColorCycleBrushInitialized,
    getActiveLayerFillBrush,
    activeLayerId,
    fillColorCycleSettings,
    isCCGradientActiveLayer,
  ]);

  // Color cycle functions removed - now defined inline in return object to avoid stale closures

  const resolvedColorCycleWriteSpeed = useMemo(() => {
    const fallbackSpeed = tools.brushSettings.colorCycleSpeed;
    if (Number.isFinite(fallbackSpeed)) {
      return fallbackSpeed as number;
    }
    return null;
  }, [
    tools.brushSettings.colorCycleSpeed,
  ]);

  const resolvedColorCycleBaseSpeed = useMemo(() => {
    const perLayerSpeed = activeLayerBaseSpeed;
    if (Number.isFinite(perLayerSpeed)) {
      return perLayerSpeed as number;
    }
    return 1;
  }, [
    activeLayerBaseSpeed,
  ]);

  const resolvedColorCycleLayerSpeedScale = useMemo(() => {
    return Number.isFinite(playbackSpeedScale)
      ? Math.max(MIN_CC_LAYER_SPEED_SCALE, Math.min(MAX_CC_LAYER_SPEED_SCALE, playbackSpeedScale))
      : 1;
  }, [playbackSpeedScale]);

  const lastAppliedColorCycleLayerIdRef = useRef<string | null>(null);
  const lastAppliedColorCycleBaseSpeedRef = useRef<number | null>(null);

  useEffect(() => {
    bindActiveColorCycleFramePublication({
      activeLayerId,
      getActiveLayerColorCycleBrush: getActiveLayerInitBrush,
    });
  }, [activeLayerId, getActiveLayerInitBrush, layers]);

  useEffect(() => {
    const colorCycleBrush = getActiveLayerSpeedSettingsBrush();
    if (!colorCycleBrush || resolvedColorCycleWriteSpeed === null) {
      return;
    }
    applyColorCycleBrushSettingsPatch(colorCycleBrush, {
      cycleSpeed: resolvedColorCycleWriteSpeed,
    });
  }, [
    getActiveLayerSpeedSettingsBrush,
    resolvedColorCycleWriteSpeed,
  ]);

  useEffect(() => {
    const colorCycleBrush = getActiveLayerSpeedSettingsBrush();
    if (!colorCycleBrush || resolvedColorCycleBaseSpeed === null || !activeLayerId) {
      return;
    }

    const previousLayerId = lastAppliedColorCycleLayerIdRef.current;
    const previousBaseSpeed = lastAppliedColorCycleBaseSpeedRef.current;
    const isSameLayer = previousLayerId === activeLayerId;
    const hasPreviousBaseSpeed = Number.isFinite(previousBaseSpeed);
    const didBaseSpeedChange = hasPreviousBaseSpeed
      && Math.abs((previousBaseSpeed as number) - resolvedColorCycleBaseSpeed) > Number.EPSILON;

    if (isSameLayer && didBaseSpeedChange) {
      applyColorCycleBrushSettingsPatch(colorCycleBrush, {
        layerBaseSpeed: resolvedColorCycleBaseSpeed,
      });
    } else {
      applyColorCycleBrushSettingsPatch(colorCycleBrush, {
        layerBaseSpeed: resolvedColorCycleBaseSpeed,
      });
    }

    lastAppliedColorCycleLayerIdRef.current = activeLayerId;
    lastAppliedColorCycleBaseSpeedRef.current = resolvedColorCycleBaseSpeed;
  }, [
    activeLayerId,
    getActiveLayerSpeedSettingsBrush,
    resolvedColorCycleBaseSpeed,
  ]);

  useEffect(() => {
    const manager = getColorCycleBrushManager();
    manager.applySettingsToBrushes({
      playbackSpeedScale: resolvedColorCycleLayerSpeedScale,
    });
  }, [resolvedColorCycleLayerSpeedScale]);

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
    const colorCycleBrush = getActiveLayerSettingsBrush();
    if (colorCycleBrush && tools.brushSettings.colorCycleFPS) {
      applyColorCycleBrushSettingsPatch(colorCycleBrush, {
        fps: tools.brushSettings.colorCycleFPS,
      });
    }
  }, [tools.brushSettings.colorCycleFPS, activeLayerId, getActiveLayerSettingsBrush]);

  // Update gradient bands when it changes
  useEffect(() => {
    updateColorCycleGradientBandsForLayer({
      activeLayerId,
      getLayers: () => getAppStoreState().layers,
      getActiveLayerColorCycleBrush: getActiveLayerSettingsSurfaceBrush,
      initializeColorCycleBrush: () => (
        ensureColorCycleBrushInitialized()
          ? getActiveLayerSettingsSurfaceBrush()
          : null
      ),
      gradientBands: tools.brushSettings.gradientBands,
      renderBrushToLayerCanvas,
    });
  }, [
    tools.brushSettings.gradientBands,
    getActiveLayerSettingsSurfaceBrush,
    activeLayerId,
    ensureColorCycleBrushInitialized,
  ]);

  useEffect(() => {
    updateColorCycleDitherPaletteSpreadForLayer({
      activeLayerId,
      getLayers: () => getAppStoreState().layers,
      getActiveLayerColorCycleBrush: getActiveLayerSettingsSurfaceBrush,
      initializeColorCycleBrush: () => (
        ensureColorCycleBrushInitialized()
          ? getActiveLayerSettingsSurfaceBrush()
          : null
      ),
      renderBrushToLayerCanvas,
    });
  }, [
    tools.brushSettings.ditherPaletteSpread,
    getActiveLayerSettingsSurfaceBrush,
    activeLayerId,
    ensureColorCycleBrushInitialized,
  ]);

  useEffect(() => {
    updateColorCycleBandSpacingForLayer({
      activeLayerId,
      getLayers: () => getAppStoreState().layers,
      getActiveLayerColorCycleBrush: getActiveLayerSettingsSurfaceBrush,
      initializeColorCycleBrush: () => (
        ensureColorCycleBrushInitialized()
          ? getActiveLayerSettingsSurfaceBrush()
          : null
      ),
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
    getActiveLayerSettingsSurfaceBrush,
    activeLayerId,
    ensureColorCycleBrushInitialized,
  ]);

  // Update dithering toggle for color-cycle shape fills
  useEffect(() => {
    updateColorCycleDitherSettings({
      brush: getActiveLayerSettingsBrush(),
      isCCGradientActiveLayer,
      shouldApplyToolbarSettings: shouldApplyToolbarColorCycleSettings,
      ditherEnabled: tools.brushSettings.ditherEnabled,
      stampDitherEnabled: tools.brushSettings.colorCycleStampDitherEnabled,
      ditherAlgorithm: tools.brushSettings.ditherAlgorithm,
      patternStyle: tools.brushSettings.patternStyle,
      patternTileId: tools.brushSettings.patternTileId,
      patternTileScale: tools.brushSettings.patternTileScale,
      patternTileInvert: tools.brushSettings.patternTileInvert,
      patternTileThreshold: tools.brushSettings.patternTileThreshold,
      patternTileOffsetX: tools.brushSettings.patternTileOffsetX,
      patternTileOffsetY: tools.brushSettings.patternTileOffsetY,
      stampDitherPressureLinked: tools.brushSettings.colorCycleStampDitherPressureLinked,
      stampDitherBgFill: tools.brushSettings.colorCycleStampDitherBgFill,
      stampDitherClears: tools.brushSettings.colorCycleStampDitherClears,
      pxlEdge: tools.brushSettings.pxlEdge,
    });
  }, [
    isCCGradientActiveLayer,
    shouldApplyToolbarColorCycleSettings,
    tools.brushSettings.ditherEnabled,
    tools.brushSettings.colorCycleStampDitherEnabled,
    tools.brushSettings.colorCycleStampDitherBgFill,
    tools.brushSettings.colorCycleStampDitherClears,
    tools.brushSettings.colorCycleStampDitherPressureLinked,
    tools.brushSettings.pxlEdge,
    tools.brushSettings.ditherAlgorithm,
    tools.brushSettings.patternStyle,
    tools.brushSettings.patternTileId,
    tools.brushSettings.patternTileScale,
    tools.brushSettings.patternTileInvert,
    tools.brushSettings.patternTileThreshold,
    tools.brushSettings.patternTileOffsetX,
    tools.brushSettings.patternTileOffsetY,
    activeLayerId,
    getActiveLayerSettingsBrush
  ]);

  // Update dither pixel size (fillResolution) for color-cycle shape fills
  useEffect(() => {
    updateColorCycleFillDitherPixelSize({
      brush: getActiveLayerSettingsBrush(),
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
    getActiveLayerSettingsBrush,
  ]);

  // Update stamp dithering pixel size for color-cycle strokes
  useEffect(() => {
    updateColorCycleStampDitherPixelSize({
      brush: getActiveLayerSettingsBrush(),
      shouldApplyToolbarSettings: shouldApplyToolbarColorCycleSettings,
      stampDitherPixelSize: tools.brushSettings.colorCycleStampDitherPixelSize,
    });
  }, [
    tools.brushSettings.colorCycleStampDitherPixelSize,
    shouldApplyToolbarColorCycleSettings,
    activeLayerId,
    getActiveLayerSettingsBrush
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
    let previous = selectEffectiveColorCyclePlaying(getAppStoreState());
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
  }, [ensureColorCycleAnimation]);

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
      const colorCycleBrush = getActiveLayerSurfaceBrush();
      if (colorCycleBrush) {
        renderBrushToLayerCanvas(colorCycleBrush, activeLayerId);
      }
    },

    // These need fresh ref access, define inline:
    updateColorCycleGradient: (stops: Array<{ position: number; color: string; opacity?: number }>) => {
      const colorCycleBrush = getActiveLayerSurfaceBrush();
      if (!colorCycleBrush || !activeLayerId) {
        return;
      }
      applyGradientEdit({ stops, layerId: activeLayerId, intent: 'commitRecolor' });
      renderBrushToLayerCanvas(colorCycleBrush, activeLayerId);
    },

    updateColorCycleSpeed: (speed: number) => {
      const colorCycleBrush = getActiveLayerSpeedSettingsBrush();
      if (colorCycleBrush) {
        applyColorCycleBrushSettingsPatch(colorCycleBrush, {
          cycleSpeed: speed,
        });
      }
    },

    setColorCycleFlowMode: (_mode: 'forward' | 'reverse' | 'pingpong') => {
      void _mode;
      const colorCycleBrush = getActiveLayerPlaybackBrush();
      if (colorCycleBrush) {
        colorCycleBrush.setFlowMode?.('forward');
        colorCycleBrush.setLegacyFlowMode?.('forward');
        if (!colorCycleBrush.setFlowMode && !colorCycleBrush.setLegacyFlowMode) {
          colorCycleBrush.setFlowDirection?.('forward');
        }
      }
    },

    ensureColorCycleAnimation: (shouldPlay: boolean) => {
      ensureColorCycleAnimation(shouldPlay);
    },

    updateColorCycleAnimation: () => {
      // Manually update animation state for external render loops
      const colorCycleBrush = getActiveLayerPlaybackBrush();
      if (colorCycleBrush) {
        colorCycleBrush.updateAnimation?.();
      }
    },

    isColorCycleAnimating: () => {
      const colorCycleBrush = getActiveLayerPlaybackBrush();
      if (!colorCycleBrush) return false;
      return colorCycleBrush.isPlaying?.() ?? false;
    },

    clearColorCycleStrokes: () => {
      const colorCycleBrush = getActiveLayerClearBrush();
      if (colorCycleBrush) {
        colorCycleBrush.clear?.();
      }
    },

    ensureColorCycleBrush: () => {
      // CRITICAL: Only ensure brush for color-cycle layers
      const state = getAppStoreState();
      const activeLayer = state.layers.find(l => l.id === activeLayerId);
      if (!activeLayer || activeLayer.layerType !== 'color-cycle') {
        // Silently skip for non-CC layers
        return;
      }

      // Ensure brush exists without starting a stroke
      const manager = getColorCycleBrushManager();
      if (!activeLayerId || !manager.hasBrush(activeLayerId)) {
        ensureColorCycleBrushInitialized();
      }
      // Make sure it's not in drawing mode for animation
      const layerId = activeLayerId;
      const activationBrush = getActiveLayerActivationBrush();
      if (activationBrush && layerId) {
        activationBrush.endStroke?.(layerId);
      }
    },

    // Effects
    applyStrokeDither,
    applyDithering,

    // Utilities
    canDrawAt: (ctx: CanvasRenderingContext2D, x: number, y: number) =>
      brushEngine.canDrawAt(ctx, x, y),
    consumeRecentStamps: () => brushEngine.consumeRecentStamps(),
    updateConfig: (config: Parameters<typeof brushEngine.updateConfig>[0]) =>
      brushEngine.updateConfig(config)
  };
};

// Export type for the hook return value
export type BrushEngine = ReturnType<typeof useBrushEngineSimplified>;
