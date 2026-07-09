
import { debugLog, logError } from '@/utils/debug';
import type {
  CCBrushSettingsPatch,
  ColorCycleBrushConstructor,
  ColorCycleClearBrushContext,
  ColorCycleCommitBrushContext,
  ColorCycleBrushRuntimeHost,
  ColorCycleCropBrushContext,
  ColorCycleExportPlaybackBrushContext,
  ColorCycleGradientApplyBrushContext,
  ColorCycleHistoryBrushContext,
  ColorCycleInitBrushContext,
  ColorCycleLayerActivationBrushContext,
  ColorCyclePlaybackBrushContext,
  ColorCycleSelectionMutationBrushContext,
  ColorCycleSerializedStateBrushContext,
  ColorCycleShapeFillBrushContext,
  ColorCycleSpeedSettingsBrushContext,
  ColorCycleSurfaceBrushContext,
} from '@/hooks/brushEngine/colorCycleBrushContracts';
import { applyColorCycleBrushSettingsPatch } from '@/hooks/brushEngine/colorCycleBrushSettingsController';
import type { ColorCycleSettingsPatchBrush } from '@/hooks/brushEngine/colorCycleBrushSettingsPatch';
import type { ColorCycleDrawBrush } from '@/hooks/brushEngine/colorCycleDrawController';
import type { ColorCycleFillBrush } from '@/hooks/brushEngine/colorCycleFillController';
import type { ColorCycleBrushLifecycle } from '@/hooks/brushEngine/colorCycleStrokeLifecycleController';
import type { ColorCycleLayerRenderBrush } from '@/hooks/brushEngine/colorCycleSurface';
import {
  ColorCycleLayerDocument,
  type ColorCycleLayerDocumentArchiveRefs,
  type ColorCycleLayerDocumentResidency,
} from '@/lib/colorCycle/document/ColorCycleLayerDocument';
import {
  registerColorCycleBrushPersistenceOwnerAlias,
  resolveColorCycleBrushPersistenceOwner,
} from '@/lib/colorCycle/document/brushPersistenceOwnerAlias';
import type { ColorCycleLayerDocumentState } from '@/lib/colorCycle/document/colorCycleDocumentContract';
import { MAX_CC_LAYER_SPEED_SCALE, MIN_CC_LAYER_SPEED_SCALE } from '@/constants/colorCycle';
import { defaultBrushSettings } from '@/presets/brushPresets';
import type { BrushSettings, Layer } from '@/types';
import { resolveBrushPressureRange } from '@/utils/pressureSettings';

export interface ColorCycleBrushRegistryDeps {
  getBrushSettings: () => BrushSettings | null | undefined;
  getPlaybackSpeedScale: () => number;
  getLayers: () => Layer[] | null | undefined;
  createCanvas: (width: number, height: number) => HTMLCanvasElement;
  getBrushClass: () => ColorCycleBrushConstructor;
  shouldForceCanvas2D: () => boolean;
  now?: () => number;
}

type BrushWithOptionalControls = ColorCycleBrushRuntimeHost & {
  usesWebGL?: boolean;
  cleanup?: () => void;
  destroy?: () => void;
  setIsolated?: (isolated: boolean) => void;
  applySettings?: (settings: CCBrushSettingsPatch) => void;
  setLayerId?: (layerId: string) => void;
  setUseCanvas2D?: (useCanvas2D: boolean) => void;
  isUsingWebGL?: () => boolean;
  setTargetCanvas?: (canvas: HTMLCanvasElement | null) => void;
  setColorCycleLayerDocument?: (layerId: string, document: ColorCycleLayerDocument) => void;
  removeColorCycleLayerDocument?: (layerId: string) => void;
};

const registerBrushContextPersistenceOwner = (
  context: object,
  brush: ColorCycleBrushRuntimeHost,
): void => {
  registerColorCycleBrushPersistenceOwnerAlias(
    context,
    resolveColorCycleBrushPersistenceOwner(brush),
  );
};

export interface ColorCycleBrushMetadata {
  layerId: string;
  created: number;
  lastUsed: number;
  width: number;
  height: number;
  gradientHash?: string;
  isActive: boolean;
}

export interface ColorCycleLayerRuntime {
  layerId: string;
  brush: ColorCycleBrushRuntimeHost;
  document: ColorCycleLayerDocument;
}

export type ColorCycleRestoredBrushRegistrationOptions = {
  width: number;
  height: number;
  isActive?: boolean;
};

export interface ColorCycleBrushManager {
  runtimes: Map<string, ColorCycleLayerRuntime>;
  brushes: Map<string, ColorCycleBrushRuntimeHost>;
  documents: Map<string, ColorCycleLayerDocument>;
  brushMetadata: Map<string, ColorCycleBrushMetadata>;
  activeResources: Set<string>;
  createBrush: (layerId: string, width: number, height: number, gradient?: Uint8Array) => ColorCycleBrushRuntimeHost;
  ensureDocument: (
    layerId: string,
    width: number,
    height: number,
    options?: {
      residency?: ColorCycleLayerDocumentResidency;
      archiveRefs?: ColorCycleLayerDocumentArchiveRefs | null;
    }
  ) => ColorCycleLayerDocument;
  /** @internal Composition-root escape hatch; controllers must use narrow facade getters. */
  getBrush: (layerId: string) => ColorCycleBrushRuntimeHost | undefined;
  hasBrush: (layerId: string) => boolean;
  registerRestoredBrush: (
    layerId: string,
    brush: ColorCycleBrushRuntimeHost,
    options: ColorCycleRestoredBrushRegistrationOptions,
  ) => void;
  applySettingsToBrushes: (patch: CCBrushSettingsPatch) => void;
  getPlaybackBrush: (layerId: string) => ColorCyclePlaybackBrushContext | null;
  getExportPlaybackBrush: (layerId: string) => ColorCycleExportPlaybackBrushContext | null;
  getSurfaceBrush: (layerId: string) => ColorCycleSurfaceBrushContext | null;
  getGradientApplyBrush: (layerId: string) => ColorCycleGradientApplyBrushContext | null;
  getShapeFillBrush: (layerId: string) => ColorCycleShapeFillBrushContext | null;
  getHistoryBrush: (layerId: string) => ColorCycleHistoryBrushContext | null;
  getSelectionMutationBrush: (layerId: string) => ColorCycleSelectionMutationBrushContext | null;
  getLayerActivationBrush: (layerId: string) => ColorCycleLayerActivationBrushContext | null;
  getClearBrush: (layerId: string) => ColorCycleClearBrushContext | null;
  getInitBrush: (layerId: string) => ColorCycleInitBrushContext | null;
  getDrawBrush: (layerId: string) => ColorCycleDrawBrush | null;
  getFillBrush: (layerId: string) => (ColorCycleFillBrush & ColorCycleLayerRenderBrush) | null;
  getStrokeLifecycleBrush: (layerId: string) => ColorCycleBrushLifecycle | null;
  getSerializedStateBrush: (layerId: string) => ColorCycleSerializedStateBrushContext | null;
  getCropBrush: (layerId: string) => ColorCycleCropBrushContext | null;
  getCommitBrush: (layerId: string) => ColorCycleCommitBrushContext | null;
  getSettingsPatchBrush: (layerId: string) => ColorCycleSettingsPatchBrush | null;
  getSpeedSettingsBrush: (layerId: string) => ColorCycleSpeedSettingsBrushContext | null;
  getDocument: (layerId: string) => ColorCycleLayerDocument | undefined;
  registerDocument: (layerId: string, document: ColorCycleLayerDocument) => void;
  getRuntime: (layerId: string) => ColorCycleLayerRuntime | undefined;
  deleteBrush: (layerId: string) => void;
  setActiveState: (layerId: string, isActive: boolean) => void;
  cleanupInactive: (maxInactiveMs?: number) => void;
  cleanupAll: () => void;
  initColorCycleForLayer: (layerId: string, width: number, height: number, gradient?: Uint8Array) => boolean;
  validateColorCycleBrush: (layerId: string) => boolean;
  removeColorCycleBrush: (layerId: string) => void;
  cleanupOrphanedBrushes: (validLayerIds: Set<string>) => void;
  transferColorCycleBrush: (fromLayerId: string, toLayerId: string) => boolean;
  setCanvasImplementation: (useCanvas2D: boolean) => void;
}

const hashGradient = (gradient: Uint8Array): string => {
  let hash = 0;
  for (let i = 0; i < gradient.length; i += 16) {
    hash = ((hash << 5) - hash) + gradient[i];
    hash = hash & hash;
  }
  return hash.toString(36);
};

const createEmptyRegistryColorCycleLayerDocumentState = ({
  layerId,
  width,
  height,
}: {
  layerId: string;
  width: number;
  height: number;
}): ColorCycleLayerDocumentState => {
  const safeWidth = Math.max(1, Math.floor(width));
  const safeHeight = Math.max(1, Math.floor(height));
  const pixelCount = safeWidth * safeHeight;
  return {
    layerId,
    width: safeWidth,
    height: safeHeight,
    paintBuffer: new Uint8Array(pixelCount).buffer,
    gradientIdBuffer: new Uint8Array(pixelCount).buffer,
    gradientDefIdBuffer: new Uint16Array(pixelCount).buffer,
    speedBuffer: new Uint8Array(pixelCount).buffer,
    flowBuffer: new Uint8Array(pixelCount).buffer,
    phaseBuffer: new Uint8Array(pixelCount).buffer,
    hasContent: false,
    sources: {
      brushStateSnapshot: false,
      topLevelBuffers: false,
      legacyStateRefs: false,
    },
  };
};

const buildColorCycleBrushSettingsPatch = (
  settings: BrushSettings | null | undefined,
  playbackSpeedScale: number,
): CCBrushSettingsPatch => {
  const currentSettings = settings ?? defaultBrushSettings;
  const baseSize = Math.max(1, Math.round(currentSettings.size ?? defaultBrushSettings.size ?? 1));
  const pressureRange = resolveBrushPressureRange(currentSettings);
  const pressureActive = pressureRange.enabled;
  const playbackLayerScale = Number.isFinite(playbackSpeedScale)
    ? Math.max(
        MIN_CC_LAYER_SPEED_SCALE,
        Math.min(MAX_CC_LAYER_SPEED_SCALE, playbackSpeedScale)
      )
    : 1;
  const patch: CCBrushSettingsPatch = {
    brushSize: baseSize,
    fps: currentSettings.colorCycleFPS ?? 60,
    bandSpacing: currentSettings.colorCycleBandSpacingPx ?? currentSettings.spacing ?? 12,
    pressureEnabled: pressureActive,
    minPressure: pressureActive ? pressureRange.minPercent : 100,
    maxPressure: pressureActive ? pressureRange.maxPercent : 100,
    stampDitherEnabled: Boolean(currentSettings.colorCycleStampDitherEnabled),
    stampDitherAlgorithm: currentSettings.ditherAlgorithm ?? 'sierra-lite',
    stampDitherPatternStyle: currentSettings.patternStyle ?? 'dots',
    stampDitherPatternTileId: currentSettings.patternTileId ?? null,
    stampDitherPatternTileScale: Number.isFinite(currentSettings.patternTileScale)
      ? Number(currentSettings.patternTileScale)
      : null,
    stampDitherPatternTileInvert: typeof currentSettings.patternTileInvert === 'boolean'
      ? currentSettings.patternTileInvert
      : null,
    stampDitherPatternTileThreshold: Number.isFinite(currentSettings.patternTileThreshold)
      ? Number(currentSettings.patternTileThreshold)
      : null,
    stampDitherPatternTileOffsetX: Number.isFinite(currentSettings.patternTileOffsetX)
      ? Number(currentSettings.patternTileOffsetX)
      : null,
    stampDitherPatternTileOffsetY: Number.isFinite(currentSettings.patternTileOffsetY)
      ? Number(currentSettings.patternTileOffsetY)
      : null,
    stampDitherPressureLinked: Boolean(currentSettings.colorCycleStampDitherPressureLinked),
    stampDitherBgFill: typeof currentSettings.colorCycleStampDitherBgFill === 'boolean'
      ? currentSettings.colorCycleStampDitherBgFill
      : !Boolean(currentSettings.colorCycleStampDitherClears),
    playbackSpeedScale: playbackLayerScale,
    legacyFlowMode: 'forward',
    flowMode: 'forward',
  };

  if (typeof currentSettings.gradientBands === 'number') {
    patch.gradientBands = currentSettings.gradientBands;
  }
  if (typeof currentSettings.ditherEnabled === 'boolean') {
    patch.ditherEnabled = currentSettings.ditherEnabled;
  }
  if (typeof currentSettings.fillResolution === 'number') {
    patch.ditherPixelSize = Math.max(1, Math.floor(currentSettings.fillResolution));
  }
  if (typeof currentSettings.colorCycleStampDitherPixelSize === 'number') {
    patch.stampDitherPixelSize = Math.max(
      1,
      Math.floor(currentSettings.colorCycleStampDitherPixelSize),
    );
  }
  if (typeof currentSettings.colorCycleSpeed === 'number') {
    patch.cycleSpeed = currentSettings.colorCycleSpeed;
  }

  return patch;
};

/**
 * Composition root for color-cycle runtime hosts.
 *
 * Full `ColorCycleBrushRuntimeHost` instances are stored here only so the
 * registry can own lifecycle, documents, and narrow facade construction.
 * Controller/service callers must use the `get*Brush(...)` facade methods.
 */
export const createColorCycleBrushRegistry = (deps: ColorCycleBrushRegistryDeps): ColorCycleBrushManager => {
  const runtimes = new Map<string, ColorCycleLayerRuntime>();
  const brushes = new Map<string, ColorCycleBrushRuntimeHost>();
  const documents = new Map<string, ColorCycleLayerDocument>();
  const brushMetadata = new Map<string, ColorCycleBrushMetadata>();
  const activeResources = new Set<string>();
  const playbackBrushContexts = new WeakMap<ColorCycleBrushRuntimeHost, ColorCyclePlaybackBrushContext>();
  const exportPlaybackBrushContexts = new WeakMap<ColorCycleBrushRuntimeHost, ColorCycleExportPlaybackBrushContext>();
  const surfaceBrushContexts = new WeakMap<ColorCycleBrushRuntimeHost, ColorCycleSurfaceBrushContext>();
  const gradientApplyBrushContexts = new WeakMap<ColorCycleBrushRuntimeHost, ColorCycleGradientApplyBrushContext>();
  const shapeFillBrushContexts = new WeakMap<ColorCycleBrushRuntimeHost, ColorCycleShapeFillBrushContext>();
  const historyBrushContexts = new WeakMap<ColorCycleBrushRuntimeHost, ColorCycleHistoryBrushContext>();
  const selectionMutationBrushContexts = new WeakMap<ColorCycleBrushRuntimeHost, ColorCycleSelectionMutationBrushContext>();
  const layerActivationBrushContexts = new WeakMap<ColorCycleBrushRuntimeHost, ColorCycleLayerActivationBrushContext>();
  const clearBrushContexts = new WeakMap<ColorCycleBrushRuntimeHost, ColorCycleClearBrushContext>();
  const initBrushContexts = new WeakMap<ColorCycleBrushRuntimeHost, ColorCycleInitBrushContext>();
  const drawBrushContexts = new WeakMap<ColorCycleBrushRuntimeHost, ColorCycleDrawBrush>();
  const fillBrushContexts = new WeakMap<ColorCycleBrushRuntimeHost, ColorCycleFillBrush & ColorCycleLayerRenderBrush>();
  const strokeLifecycleBrushContexts = new WeakMap<ColorCycleBrushRuntimeHost, ColorCycleBrushLifecycle>();
  const serializedStateBrushContexts = new WeakMap<ColorCycleBrushRuntimeHost, ColorCycleSerializedStateBrushContext>();
  const cropBrushContexts = new WeakMap<ColorCycleBrushRuntimeHost, ColorCycleCropBrushContext>();
  const commitBrushContexts = new WeakMap<ColorCycleBrushRuntimeHost, ColorCycleCommitBrushContext>();
  const settingsPatchBrushContexts = new WeakMap<ColorCycleBrushRuntimeHost, ColorCycleSettingsPatchBrush>();
  const speedSettingsBrushContexts = new WeakMap<ColorCycleBrushRuntimeHost, ColorCycleSpeedSettingsBrushContext>();
  const now = () => (deps.now ?? Date.now)();

  const shouldLogRegistry = (): boolean => {
    if (process.env.NODE_ENV === 'production') {
      return false;
    }
    try {
      return Boolean((globalThis as { __TB_DEBUG?: { logCC?: boolean } }).__TB_DEBUG?.logCC);
    } catch {
      return false;
    }
  };

  const shouldIncludeStack = (): boolean => {
    if (process.env.NODE_ENV === 'production') {
      return false;
    }
    try {
      return Boolean((globalThis as { __TB_DEBUG?: { logCCVerbose?: boolean } }).__TB_DEBUG?.logCCVerbose);
    } catch {
      return false;
    }
  };

  const devLog = (message: string, payload: Record<string, unknown>): void => {
    if (!shouldLogRegistry()) {
      return;
    }
    debugLog('raw-console', message, payload);
  };

  const getBrushSettings = (): BrushSettings => {
    return deps.getBrushSettings() ?? defaultBrushSettings;
  };

  const getLayers = (): Layer[] => {
    return deps.getLayers() ?? [];
  };

  const updateBrushWebGLState = (
    layerId: string,
    brush: BrushWithOptionalControls,
    useCanvas2DOverride?: boolean
  ) => {
    const wantsCanvas2D = useCanvas2DOverride ?? deps.shouldForceCanvas2D();
    const usingWebGL = !wantsCanvas2D && (brush.isUsingWebGL?.() ?? brush.usesWebGL ?? false);
    brush.usesWebGL = usingWebGL;

    if (usingWebGL) {
      activeResources.add(`webgl_${layerId}`);
    } else {
      activeResources.delete(`webgl_${layerId}`);
    }
  };

  const attachDocumentToBrush = (
    layerId: string,
    brush: ColorCycleBrushRuntimeHost,
    document: ColorCycleLayerDocument,
  ): void => {
    (brush as BrushWithOptionalControls).setColorCycleLayerDocument?.(layerId, document);
  };

  const setRuntime = (
    layerId: string,
    brush: ColorCycleBrushRuntimeHost,
    document: ColorCycleLayerDocument,
  ): ColorCycleLayerRuntime => {
    const runtime = { layerId, brush, document };
    runtimes.set(layerId, runtime);
    brushes.set(layerId, brush);
    documents.set(layerId, document);
    attachDocumentToBrush(layerId, brush, document);
    return runtime;
  };

  const getPlaybackBrushContext = (
    brush: ColorCycleBrushRuntimeHost,
  ): ColorCyclePlaybackBrushContext => {
    const existing = playbackBrushContexts.get(brush);
    if (existing) {
      return existing;
    }

    const context: ColorCyclePlaybackBrushContext = {
      isPlaying: typeof brush.isPlaying === 'function'
        ? brush.isPlaying.bind(brush)
        : undefined,
      setPlaying: typeof brush.setPlaying === 'function'
        ? brush.setPlaying.bind(brush)
        : undefined,
      startAnimation: typeof brush.startAnimation === 'function'
        ? brush.startAnimation.bind(brush)
        : undefined,
      stopAnimation: typeof brush.stopAnimation === 'function'
        ? brush.stopAnimation.bind(brush)
        : undefined,
      updateAnimation: typeof brush.updateAnimation === 'function'
        ? brush.updateAnimation.bind(brush)
        : undefined,
      pause: typeof brush.pause === 'function'
        ? brush.pause.bind(brush)
        : undefined,
      setLegacyFlowMode: typeof brush.setLegacyFlowMode === 'function'
        ? brush.setLegacyFlowMode.bind(brush)
        : undefined,
      setFlowMode: typeof brush.setFlowMode === 'function'
        ? brush.setFlowMode.bind(brush)
        : undefined,
      setFlowDirection: typeof brush.setFlowDirection === 'function'
        ? brush.setFlowDirection.bind(brush)
        : undefined,
    };
    playbackBrushContexts.set(brush, context);
    return context;
  };

  const getExportPlaybackBrushContext = (
    brush: ColorCycleBrushRuntimeHost,
  ): ColorCycleExportPlaybackBrushContext => {
    const existing = exportPlaybackBrushContexts.get(brush);
    if (existing) {
      return existing;
    }

    const playbackContext = getPlaybackBrushContext(brush);
    const context: ColorCycleExportPlaybackBrushContext = {
      ...playbackContext,
      setPhase: typeof brush.setPhase === 'function'
        ? brush.setPhase.bind(brush)
        : undefined,
      applySettings: typeof brush.applySettings === 'function'
        ? (settings) => brush.applySettings?.({ fps: settings.fps })
        : undefined,
    };
    exportPlaybackBrushContexts.set(brush, context);
    return context;
  };

  const getSurfaceBrushContext = (
    brush: ColorCycleBrushRuntimeHost,
  ): ColorCycleSurfaceBrushContext => {
    const existing = surfaceBrushContexts.get(brush);
    if (existing) {
      return existing;
    }

    const playbackContext = getPlaybackBrushContext(brush);
    const context: ColorCycleSurfaceBrushContext = {
      ...playbackContext,
      getCanvas: typeof brush.getCanvas === 'function'
        ? brush.getCanvas.bind(brush)
        : undefined,
      setTargetCanvas: typeof brush.setTargetCanvas === 'function'
        ? brush.setTargetCanvas.bind(brush)
        : undefined,
      renderDirectToCanvas: typeof brush.renderDirectToCanvas === 'function'
        ? brush.renderDirectToCanvas.bind(brush)
        : undefined,
    };
    surfaceBrushContexts.set(brush, context);
    return context;
  };

  const getGradientApplyBrushContext = (
    brush: ColorCycleBrushRuntimeHost,
  ): ColorCycleGradientApplyBrushContext => {
    const existing = gradientApplyBrushContexts.get(brush);
    if (existing) {
      return existing;
    }

    const context: ColorCycleGradientApplyBrushContext = {
      commitCurrentStroke: typeof brush.commitCurrentStroke === 'function'
        ? brush.commitCurrentStroke.bind(brush)
        : undefined,
      flush: typeof brush.flush === 'function'
        ? brush.flush.bind(brush)
        : undefined,
      setGradientSlotStops: typeof brush.setGradientSlotStops === 'function'
        ? brush.setGradientSlotStops.bind(brush)
        : undefined,
      setGradientSlot: typeof brush.setGradientSlot === 'function'
        ? brush.setGradientSlot.bind(brush)
        : undefined,
      setActiveGradientSlot: typeof brush.setActiveGradientSlot === 'function'
        ? brush.setActiveGradientSlot.bind(brush)
        : undefined,
      syncGradientDefRuntime: typeof brush.syncGradientDefRuntime === 'function'
        ? brush.syncGradientDefRuntime.bind(brush)
        : undefined,
    };
    gradientApplyBrushContexts.set(brush, context);
    return context;
  };

  const getShapeFillBrushContext = (
    brush: ColorCycleBrushRuntimeHost,
  ): ColorCycleShapeFillBrushContext => {
    const existing = shapeFillBrushContexts.get(brush);
    if (existing) {
      return existing;
    }

    const surfaceContext = getSurfaceBrushContext(brush);
    const gradientApplyContext = getGradientApplyBrushContext(brush);
    const shapeFillBrush = brush as ColorCycleShapeFillBrushContext;
    const context: ColorCycleShapeFillBrushContext = {
      ...surfaceContext,
      commitCurrentStroke: gradientApplyContext.commitCurrentStroke,
      flush: gradientApplyContext.flush,
      setGradientSlotStops: gradientApplyContext.setGradientSlotStops,
      setGradientSlot: gradientApplyContext.setGradientSlot,
      setActiveGradientSlot: gradientApplyContext.setActiveGradientSlot,
      applySettings: typeof brush.applySettings === 'function'
        ? brush.applySettings.bind(brush)
        : undefined,
      setDitherPixelSize: typeof brush.setDitherPixelSize === 'function'
        ? brush.setDitherPixelSize.bind(brush)
        : undefined,
      setGradient: typeof brush.setGradient === 'function'
        ? brush.setGradient.bind(brush)
        : undefined,
      bindGradientDefIdToSlot: typeof shapeFillBrush.bindGradientDefIdToSlot === 'function'
        ? shapeFillBrush.bindGradientDefIdToSlot.bind(brush)
        : undefined,
      commitToLayer: typeof shapeFillBrush.commitToLayer === 'function'
        ? shapeFillBrush.commitToLayer.bind(brush)
        : undefined,
      getColorCycleLayerDocument: typeof brush.getColorCycleLayerDocument === 'function'
        ? brush.getColorCycleLayerDocument.bind(brush)
        : undefined,
    };
    registerBrushContextPersistenceOwner(context, brush);
    shapeFillBrushContexts.set(brush, context);
    return context;
  };

  const getHistoryBrushContext = (
    brush: ColorCycleBrushRuntimeHost,
  ): ColorCycleHistoryBrushContext => {
    const existing = historyBrushContexts.get(brush);
    if (existing) {
      return existing;
    }

    const historyBrush = brush as ColorCycleHistoryBrushContext;
    const context: ColorCycleHistoryBrushContext = {
      getCanvas: typeof brush.getCanvas === 'function'
        ? brush.getCanvas.bind(brush)
        : undefined,
      setTargetCanvas: typeof brush.setTargetCanvas === 'function'
        ? brush.setTargetCanvas.bind(brush)
        : undefined,
      renderDirectToCanvas: typeof brush.renderDirectToCanvas === 'function'
        ? brush.renderDirectToCanvas.bind(brush)
        : undefined,
      getColorCycleLayerDocument: typeof brush.getColorCycleLayerDocument === 'function'
        ? brush.getColorCycleLayerDocument.bind(brush)
        : undefined,
      commitToLayer: typeof historyBrush.commitToLayer === 'function'
        ? historyBrush.commitToLayer.bind(brush)
        : undefined,
      updateColorCycleTexture: typeof historyBrush.updateColorCycleTexture === 'function'
        ? historyBrush.updateColorCycleTexture.bind(brush)
        : undefined,
      render: typeof brush.render === 'function'
        ? brush.render.bind(brush)
        : undefined,
      flush: typeof brush.flush === 'function'
        ? brush.flush.bind(brush)
        : undefined,
    };
    registerBrushContextPersistenceOwner(context, brush);
    historyBrushContexts.set(brush, context);
    return context;
  };

  const getSerializedStateBrushContext = (
    brush: ColorCycleBrushRuntimeHost,
  ): ColorCycleSerializedStateBrushContext => {
    const existing = serializedStateBrushContexts.get(brush);
    if (existing) {
      return existing;
    }

    const context: ColorCycleSerializedStateBrushContext = {
      getColorCycleLayerDocument: typeof brush.getColorCycleLayerDocument === 'function'
        ? brush.getColorCycleLayerDocument.bind(brush)
        : undefined,
    };
    registerBrushContextPersistenceOwner(context, brush);
    serializedStateBrushContexts.set(brush, context);
    return context;
  };

  const getSelectionMutationBrushContext = (
    brush: ColorCycleBrushRuntimeHost,
  ): ColorCycleSelectionMutationBrushContext => {
    const existing = selectionMutationBrushContexts.get(brush);
    if (existing) {
      return existing;
    }

    const serializedStateContext = getSerializedStateBrushContext(brush);
    const context: ColorCycleSelectionMutationBrushContext = {
      ...serializedStateContext,
      getCanvas: typeof brush.getCanvas === 'function'
        ? brush.getCanvas.bind(brush)
        : undefined,
      renderDirectToCanvas: typeof brush.renderDirectToCanvas === 'function'
        ? brush.renderDirectToCanvas.bind(brush)
        : undefined,
    };
    registerBrushContextPersistenceOwner(context, brush);
    selectionMutationBrushContexts.set(brush, context);
    return context;
  };

  const getLayerActivationBrushContext = (
    brush: ColorCycleBrushRuntimeHost,
  ): ColorCycleLayerActivationBrushContext => {
    const existing = layerActivationBrushContexts.get(brush);
    if (existing) {
      return existing;
    }

    const context: ColorCycleLayerActivationBrushContext = {
      endStroke: typeof brush.endStroke === 'function'
        ? brush.endStroke.bind(brush)
        : undefined,
      setActiveLayer: typeof brush.setActiveLayer === 'function'
        ? brush.setActiveLayer.bind(brush)
        : undefined,
    };
    layerActivationBrushContexts.set(brush, context);
    return context;
  };

  const getClearBrushContext = (
    brush: ColorCycleBrushRuntimeHost,
  ): ColorCycleClearBrushContext => {
    const existing = clearBrushContexts.get(brush);
    if (existing) {
      return existing;
    }

    const context: ColorCycleClearBrushContext = {
      clear: typeof brush.clear === 'function'
        ? brush.clear.bind(brush)
        : undefined,
    };
    clearBrushContexts.set(brush, context);
    return context;
  };

  const getInitBrushContext = (
    brush: ColorCycleBrushRuntimeHost,
  ): ColorCycleInitBrushContext => {
    const existing = initBrushContexts.get(brush);
    if (existing) {
      return existing;
    }

    const context: ColorCycleInitBrushContext = {
      applySettings: typeof brush.applySettings === 'function'
        ? brush.applySettings.bind(brush)
        : undefined,
      setOnFrameRendered: brush.setOnFrameRendered.bind(brush),
      endStroke: brush.endStroke.bind(brush),
    };
    initBrushContexts.set(brush, context);
    return context;
  };

  const getDrawBrushContext = (
    brush: ColorCycleBrushRuntimeHost,
  ): ColorCycleDrawBrush => {
    const existing = drawBrushContexts.get(brush);
    if (existing) {
      return existing;
    }

    const settingsContext = getSettingsPatchBrushContext(brush);
    const lifecycleBrush = brush as { startStroke?: (layerId: string, clearBuffer?: boolean) => void };
    const context: ColorCycleDrawBrush = {
      ...settingsContext,
      getCanvas: brush.getCanvas.bind(brush),
      setTargetCanvas: typeof brush.setTargetCanvas === 'function'
        ? brush.setTargetCanvas.bind(brush)
        : undefined,
      renderDirectToCanvas: brush.renderDirectToCanvas.bind(brush),
      getColorCycleLayerDocument: typeof brush.getColorCycleLayerDocument === 'function'
        ? brush.getColorCycleLayerDocument.bind(brush)
        : undefined,
      startStroke: typeof lifecycleBrush.startStroke === 'function'
        ? lifecycleBrush.startStroke.bind(brush)
        : undefined,
      paint: brush.paint.bind(brush),
      paintCustomStamp: typeof brush.paintCustomStamp === 'function'
        ? brush.paintCustomStamp.bind(brush)
        : undefined,
    };
    registerBrushContextPersistenceOwner(context, brush);
    drawBrushContexts.set(brush, context);
    return context;
  };

  const getFillBrushContext = (
    brush: ColorCycleBrushRuntimeHost,
  ): ColorCycleFillBrush & ColorCycleLayerRenderBrush => {
    const existing = fillBrushContexts.get(brush);
    if (existing) {
      return existing;
    }

    const settingsContext = getSettingsPatchBrushContext(brush);
    const context: ColorCycleFillBrush & ColorCycleLayerRenderBrush = {
      ...settingsContext,
      getCanvas: brush.getCanvas.bind(brush),
      setTargetCanvas: typeof brush.setTargetCanvas === 'function'
        ? brush.setTargetCanvas.bind(brush)
        : undefined,
      renderDirectToCanvas: brush.renderDirectToCanvas.bind(brush),
      setLayerId: typeof brush.setLayerId === 'function'
        ? brush.setLayerId.bind(brush)
        : undefined,
      setActiveLayer: typeof brush.setActiveLayer === 'function'
        ? brush.setActiveLayer.bind(brush)
        : undefined,
      getLayerId: typeof brush.getLayerId === 'function'
        ? brush.getLayerId.bind(brush)
        : undefined,
      endStroke: brush.endStroke.bind(brush),
      fillShapeDispatch: typeof brush.fillShapeDispatch === 'function'
        ? brush.fillShapeDispatch.bind(brush)
        : undefined,
    };
    fillBrushContexts.set(brush, context);
    return context;
  };

  const getStrokeLifecycleBrushContext = (
    brush: ColorCycleBrushRuntimeHost,
  ): ColorCycleBrushLifecycle => {
    const existing = strokeLifecycleBrushContexts.get(brush);
    if (existing) {
      return existing;
    }

    const commitBrush = brush as ColorCycleCommitBrushContext;
    const lifecycleBrush = brush as {
      startStroke?: (layerId: string, clearBuffer?: boolean) => void;
      finalizeCurrentStroke?: (layerId: string) => void;
      clearPaintBuffer?: (layerId: string) => void;
    };
    const context: ColorCycleBrushLifecycle = {
      getCanvas: brush.getCanvas.bind(brush),
      setTargetCanvas: typeof brush.setTargetCanvas === 'function'
        ? brush.setTargetCanvas.bind(brush)
        : undefined,
      setLayerId: typeof brush.setLayerId === 'function'
        ? brush.setLayerId.bind(brush)
        : undefined,
      setActiveLayer: typeof brush.setActiveLayer === 'function'
        ? brush.setActiveLayer.bind(brush)
        : undefined,
      commitCurrentStroke: typeof brush.commitCurrentStroke === 'function'
        ? brush.commitCurrentStroke.bind(brush)
        : undefined,
      commitToLayer: typeof commitBrush.commitToLayer === 'function'
        ? commitBrush.commitToLayer.bind(brush)
        : undefined,
      renderDirectToCanvas: typeof brush.renderDirectToCanvas === 'function'
        ? brush.renderDirectToCanvas.bind(brush)
        : undefined,
      clearPaintBuffer: typeof lifecycleBrush.clearPaintBuffer === 'function'
        ? lifecycleBrush.clearPaintBuffer.bind(brush)
        : undefined,
      finalizeCurrentStroke: typeof lifecycleBrush.finalizeCurrentStroke === 'function'
        ? lifecycleBrush.finalizeCurrentStroke.bind(brush)
        : undefined,
      endStroke: typeof brush.endStroke === 'function'
        ? brush.endStroke.bind(brush)
        : undefined,
      startStroke: typeof lifecycleBrush.startStroke === 'function'
        ? lifecycleBrush.startStroke.bind(brush)
        : undefined,
    };
    strokeLifecycleBrushContexts.set(brush, context);
    return context;
  };

  const getCropBrushContext = (
    brush: ColorCycleBrushRuntimeHost,
  ): ColorCycleCropBrushContext => {
    const existing = cropBrushContexts.get(brush);
    if (existing) {
      return existing;
    }

    const serializedStateContext = getSerializedStateBrushContext(brush);
    const context: ColorCycleCropBrushContext = {
      ...serializedStateContext,
      isPlaying: typeof brush.isPlaying === 'function'
        ? brush.isPlaying.bind(brush)
        : undefined,
    };
    registerBrushContextPersistenceOwner(context, brush);
    cropBrushContexts.set(brush, context);
    return context;
  };

  const getCommitBrushContext = (
    brush: ColorCycleBrushRuntimeHost,
  ): ColorCycleCommitBrushContext => {
    const existing = commitBrushContexts.get(brush);
    if (existing) {
      return existing;
    }

    const surfaceContext = getSurfaceBrushContext(brush);
    const commitBrush = brush as ColorCycleCommitBrushContext;
    const context: ColorCycleCommitBrushContext = {
      ...surfaceContext,
      getColorCycleLayerDocument: typeof brush.getColorCycleLayerDocument === 'function'
        ? brush.getColorCycleLayerDocument.bind(brush)
        : undefined,
      commitCurrentStroke: typeof brush.commitCurrentStroke === 'function'
        ? brush.commitCurrentStroke.bind(brush)
        : undefined,
      finalizeCurrentStroke: typeof commitBrush.finalizeCurrentStroke === 'function'
        ? commitBrush.finalizeCurrentStroke.bind(brush)
        : undefined,
      commitToLayer: typeof commitBrush.commitToLayer === 'function'
        ? commitBrush.commitToLayer.bind(brush)
        : undefined,
      clearPaintBuffer: typeof commitBrush.clearPaintBuffer === 'function'
        ? commitBrush.clearPaintBuffer.bind(brush)
        : undefined,
      flush: typeof brush.flush === 'function'
        ? brush.flush.bind(brush)
        : undefined,
      updateColorCycleTexture: typeof commitBrush.updateColorCycleTexture === 'function'
        ? commitBrush.updateColorCycleTexture.bind(brush)
        : undefined,
      setGradientSlotStops: typeof brush.setGradientSlotStops === 'function'
        ? brush.setGradientSlotStops.bind(brush)
        : undefined,
      bindGradientDefIdToSlot: typeof commitBrush.bindGradientDefIdToSlot === 'function'
        ? commitBrush.bindGradientDefIdToSlot.bind(brush)
        : undefined,
    };
    registerBrushContextPersistenceOwner(context, brush);
    commitBrushContexts.set(brush, context);
    return context;
  };

  const getSpeedSettingsBrushContext = (
    brush: ColorCycleBrushRuntimeHost,
  ): ColorCycleSpeedSettingsBrushContext => {
    const existing = speedSettingsBrushContexts.get(brush);
    if (existing) {
      return existing;
    }

    const context: ColorCycleSpeedSettingsBrushContext = {
      applySettings: typeof brush.applySettings === 'function'
        ? brush.applySettings.bind(brush)
        : undefined,
      setSpeed: typeof brush.setSpeed === 'function'
        ? brush.setSpeed.bind(brush)
        : undefined,
    };
    speedSettingsBrushContexts.set(brush, context);
    return context;
  };

  const getSettingsPatchBrushContext = (
    brush: ColorCycleBrushRuntimeHost,
  ): ColorCycleSettingsPatchBrush => {
    const existing = settingsPatchBrushContexts.get(brush);
    if (existing) {
      return existing;
    }

    const context: ColorCycleSettingsPatchBrush = {
      applySettings: typeof brush.applySettings === 'function'
        ? brush.applySettings.bind(brush)
        : undefined,
    };
    settingsPatchBrushContexts.set(brush, context);
    return context;
  };

  const disposeLayerRuntime = (
    layerId: string,
    options: { removeDocument: boolean },
  ): void => {
    const brush = brushes.get(layerId) as BrushWithOptionalControls | undefined;
    if (brush) {
      brush.cleanup?.();
    }

    brushes.delete(layerId);
    if (options.removeDocument) {
      documents.delete(layerId);
    }
    runtimes.delete(layerId);
    brushMetadata.delete(layerId);
    activeResources.delete(layerId);
    activeResources.delete(`canvas_${layerId}`);
    activeResources.delete(`webgl_${layerId}`);
  };

  return {
    runtimes,
    brushes,
    documents,
    brushMetadata,
    activeResources,

    createBrush(layerId: string, width: number, height: number, gradient?: Uint8Array) {
      const existingDocument = this.getDocument(layerId);
      this.deleteBrush(layerId);

      const canvas = deps.createCanvas(width, height);
      canvas.width = width;
      canvas.height = height;

      // Layer lookup no longer needed here; keep flow logic focused on brush setup.

      const currentSettings = getBrushSettings();
      const BrushCanvas = deps.getBrushClass();
      const brush = new BrushCanvas(canvas, {
        brushSize: currentSettings.size ?? defaultBrushSettings.size,
        fps: currentSettings.colorCycleFPS ?? 60,
        forceCanvas2D: deps.shouldForceCanvas2D()
      });

      const brushWithOptionalControls: BrushWithOptionalControls = brush;
      applyColorCycleBrushSettingsPatch(brush, buildColorCycleBrushSettingsPatch(
        currentSettings,
        deps.getPlaybackSpeedScale(),
      ));
      const document = existingDocument ?? new ColorCycleLayerDocument(
        createEmptyRegistryColorCycleLayerDocumentState({ layerId, width, height }),
      );
      document.replaceResidency('resident', {
        reason: 'project-load-restore',
        archiveRefs: null,
      });
      setRuntime(layerId, brush, document);
      brushWithOptionalControls.setLayerId?.(layerId);
      brushWithOptionalControls.setTargetCanvas?.(canvas);
      brushMetadata.set(layerId, {
        layerId,
        created: now(),
        lastUsed: now(),
        width,
        height,
        gradientHash: gradient ? hashGradient(gradient) : undefined,
        isActive: true
      });

      activeResources.add(layerId);
      updateBrushWebGLState(layerId, brushWithOptionalControls);

      return brush;
    },

    ensureDocument(layerId, width, height, options) {
      const existingDocument = this.getDocument(layerId);
      if (existingDocument) {
        if (options?.residency) {
          existingDocument.replaceResidency(options.residency, {
            reason: 'project-load-restore',
            archiveRefs: options.archiveRefs,
          });
        }
        documents.set(layerId, existingDocument);
        return existingDocument;
      }

      const document = new ColorCycleLayerDocument(
        createEmptyRegistryColorCycleLayerDocumentState({ layerId, width, height }),
        {
          residency: options?.residency,
          archiveRefs: options?.archiveRefs ?? undefined,
        },
      );
      documents.set(layerId, document);
      return document;
    },

    getBrush(layerId: string): ColorCycleBrushRuntimeHost | undefined {
      const brush = runtimes.get(layerId)?.brush ?? brushes.get(layerId);
      if (brush) {
        const metadata = brushMetadata.get(layerId);
        if (metadata) {
          metadata.lastUsed = now();
        }
      }
      return brush;
    },

    hasBrush(layerId: string): boolean {
      return runtimes.has(layerId) || brushes.has(layerId);
    },

    registerRestoredBrush(
      layerId: string,
      brush: ColorCycleBrushRuntimeHost,
      options: ColorCycleRestoredBrushRegistrationOptions,
    ): void {
      const restoredBrush = brush as BrushWithOptionalControls;
      const restoredDocument = restoredBrush.getColorCycleLayerDocument?.(layerId);
      const existingDocument = this.getDocument(layerId);
      const document = restoredDocument instanceof ColorCycleLayerDocument
        ? restoredDocument
        : (
            existingDocument ?? new ColorCycleLayerDocument(
              createEmptyRegistryColorCycleLayerDocumentState({
                layerId,
                width: options.width,
                height: options.height,
              }),
            )
          );

      setRuntime(layerId, brush, document);
      try {
        restoredBrush.setLayerId?.(layerId);
      } catch (error) {
        debugLog('[ccBrushRegistry] failed to set restored brush layer id', { layerId, error });
      }
      brushMetadata.set(layerId, {
        layerId,
        created: now(),
        lastUsed: now(),
        width: options.width,
        height: options.height,
        gradientHash: undefined,
        isActive: Boolean(options.isActive),
      });
      activeResources.add(layerId);
      activeResources.add(`canvas_${layerId}`);
      updateBrushWebGLState(layerId, restoredBrush);
    },

    applySettingsToBrushes(patch: CCBrushSettingsPatch): void {
      brushes.forEach((brush) => {
        applyColorCycleBrushSettingsPatch(brush, patch);
      });
    },

    getPlaybackBrush(layerId: string): ColorCyclePlaybackBrushContext | null {
      const brush = this.getBrush(layerId);
      return brush ? getPlaybackBrushContext(brush) : null;
    },

    getExportPlaybackBrush(layerId: string): ColorCycleExportPlaybackBrushContext | null {
      const brush = this.getBrush(layerId);
      return brush ? getExportPlaybackBrushContext(brush) : null;
    },

    getSurfaceBrush(layerId: string): ColorCycleSurfaceBrushContext | null {
      const brush = this.getBrush(layerId);
      return brush ? getSurfaceBrushContext(brush) : null;
    },

    getGradientApplyBrush(layerId: string): ColorCycleGradientApplyBrushContext | null {
      const brush = this.getBrush(layerId);
      return brush ? getGradientApplyBrushContext(brush) : null;
    },

    getShapeFillBrush(layerId: string): ColorCycleShapeFillBrushContext | null {
      const brush = this.getBrush(layerId);
      return brush ? getShapeFillBrushContext(brush) : null;
    },

    getHistoryBrush(layerId: string): ColorCycleHistoryBrushContext | null {
      const brush = this.getBrush(layerId);
      return brush ? getHistoryBrushContext(brush) : null;
    },

    getSelectionMutationBrush(layerId: string): ColorCycleSelectionMutationBrushContext | null {
      const brush = this.getBrush(layerId);
      return brush ? getSelectionMutationBrushContext(brush) : null;
    },

    getLayerActivationBrush(layerId: string): ColorCycleLayerActivationBrushContext | null {
      const brush = this.getBrush(layerId);
      return brush ? getLayerActivationBrushContext(brush) : null;
    },

    getClearBrush(layerId: string): ColorCycleClearBrushContext | null {
      const brush = this.getBrush(layerId);
      return brush ? getClearBrushContext(brush) : null;
    },

    getInitBrush(layerId: string): ColorCycleInitBrushContext | null {
      const brush = this.getBrush(layerId);
      return brush ? getInitBrushContext(brush) : null;
    },

    getDrawBrush(layerId: string): ColorCycleDrawBrush | null {
      const brush = this.getBrush(layerId);
      return brush ? getDrawBrushContext(brush) : null;
    },

    getFillBrush(layerId: string): (ColorCycleFillBrush & ColorCycleLayerRenderBrush) | null {
      const brush = this.getBrush(layerId);
      return brush ? getFillBrushContext(brush) : null;
    },

    getStrokeLifecycleBrush(layerId: string): ColorCycleBrushLifecycle | null {
      const brush = this.getBrush(layerId);
      return brush ? getStrokeLifecycleBrushContext(brush) : null;
    },

    getSerializedStateBrush(layerId: string): ColorCycleSerializedStateBrushContext | null {
      const brush = this.getBrush(layerId);
      return brush ? getSerializedStateBrushContext(brush) : null;
    },

    getCropBrush(layerId: string): ColorCycleCropBrushContext | null {
      const brush = this.getBrush(layerId);
      return brush ? getCropBrushContext(brush) : null;
    },

    getCommitBrush(layerId: string): ColorCycleCommitBrushContext | null {
      const brush = this.getBrush(layerId);
      return brush ? getCommitBrushContext(brush) : null;
    },

    getSettingsPatchBrush(layerId: string): ColorCycleSettingsPatchBrush | null {
      const brush = this.getBrush(layerId);
      return brush ? getSettingsPatchBrushContext(brush) : null;
    },

    getSpeedSettingsBrush(layerId: string): ColorCycleSpeedSettingsBrushContext | null {
      const brush = this.getBrush(layerId);
      return brush ? getSpeedSettingsBrushContext(brush) : null;
    },

    getDocument(layerId: string): ColorCycleLayerDocument | undefined {
      return runtimes.get(layerId)?.document ?? documents.get(layerId);
    },

    registerDocument(layerId: string, document: ColorCycleLayerDocument): void {
      documents.set(layerId, document);
    },

    getRuntime(layerId: string): ColorCycleLayerRuntime | undefined {
      return runtimes.get(layerId);
    },

    deleteBrush(layerId: string) {
      disposeLayerRuntime(layerId, { removeDocument: true });
    },

    setActiveState(layerId: string, isActive: boolean) {
      const metadata = brushMetadata.get(layerId);
      if (metadata) {
        metadata.isActive = isActive;
        if (isActive) {
          metadata.lastUsed = now();
          activeResources.add(layerId);
        } else {
          activeResources.delete(layerId);
        }
      }
    },

    cleanupInactive(maxInactiveMs: number = 60000) {
      const currentTime = now();
      const toDelete: string[] = [];
      const layers = getLayers();

      brushMetadata.forEach((metadata, layerId) => {
        if (metadata.isActive) {
          return;
        }

        if (currentTime - metadata.lastUsed <= maxInactiveMs) {
          return;
        }

        let shouldPreserve = false;
        const layer = layers.find(candidate => candidate.id === layerId);
        if (layer && layer.layerType === 'color-cycle' && layer.colorCycleData?.mode !== 'recolor') {
          const hydrationState = layer.colorCycleData?.runtimeHydrationState
            ?? (layer.colorCycleData?.deferredRuntimeRestore ? 'cold' : 'warm');
          const isAnimating = Boolean(layer.colorCycleData?.isAnimating);
          if (hydrationState === 'active' || isAnimating) {
            shouldPreserve = true;
          }
        }

        if (shouldPreserve) {
          metadata.lastUsed = currentTime;
          return;
        }

        toDelete.push(layerId);
      });

      toDelete.forEach(layerId => {
        disposeLayerRuntime(layerId, { removeDocument: false });
      });
    },

    cleanupAll() {
      Array.from(runtimes.keys()).forEach((layerId) => {
        this.deleteBrush(layerId);
      });
      Array.from(brushes.keys()).forEach((layerId) => {
        this.deleteBrush(layerId);
      });
    },

    setCanvasImplementation(useCanvas2D: boolean) {
      brushes.forEach((brush, layerId) => {
        const brushControls = brush as BrushWithOptionalControls;
        brushControls.setUseCanvas2D?.(useCanvas2D);
        updateBrushWebGLState(layerId, brushControls, !useCanvas2D);
      });
    },

    initColorCycleForLayer(layerId: string, width: number, height: number, gradient?: Uint8Array) {
      const payload: Record<string, unknown> = {
        layerId,
        width,
        height,
        gradientBytes: gradient?.length ?? 0,
      };
      if (shouldIncludeStack()) {
        payload.stack = new Error().stack?.split('\n').slice(0, 4).join('\n');
      }
      devLog('[ccBrushRegistry] initColorCycleForLayer', payload);
      try {
      const existingBrush = this.getBrush(layerId);
        if (existingBrush) {
          return true;
        }

        this.createBrush(layerId, width, height, gradient);
        activeResources.add(`canvas_${layerId}`);
        return true;
      } catch (error) {
        logError(`❌ Failed to create CC brush for layer ${layerId}:`, error);
        return false;
      }
    },

    validateColorCycleBrush(layerId: string): boolean {
      const brush = this.getBrush(layerId);
      if (!brush) return false;

      try {
        if ('getCanvas' in brush && typeof brush.getCanvas === 'function') {
          const canvas = brush.getCanvas();
          if (!canvas || canvas.width <= 0 || canvas.height <= 0) {
            return false;
          }
        }

        if ('isContextLost' in brush && typeof brush.isContextLost === 'function') {
          if (brush.isContextLost()) {
            return false;
          }
        }

        if ('hasValidBuffers' in brush && typeof brush.hasValidBuffers === 'function') {
          if (!brush.hasValidBuffers()) {
            return false;
          }
        }

        if ('getLayerId' in brush && typeof brush.getLayerId === 'function') {
          if (brush.getLayerId() !== layerId) {
            return false;
          }
        }

        return true;
      } catch (error) {
        logError(`❌ Validation error for layer ${layerId}:`, error);
        return false;
      }
    },

    removeColorCycleBrush(layerId: string): void {
      devLog('[ccBrushRegistry] removeColorCycleBrush', {
        layerId,
        stack: new Error().stack?.split('\n').slice(0, 4).join('\n'),
      });
      const brush = this.getBrush(layerId) as BrushWithOptionalControls | undefined;

      if (brush) {
        if (typeof brush.destroy === 'function') {
          try {
            brush.destroy();
          } catch (error) {
            logError(`Error destroying brush for layer ${layerId}:`, error);
          }
        }

        if (typeof brush.cleanup === 'function') {
          try {
            brush.cleanup();
          } catch (error) {
            logError(`Error cleaning up brush for layer ${layerId}:`, error);
          }
        }

        brushes.delete(layerId);
        documents.delete(layerId);
        runtimes.delete(layerId);
        brushMetadata.delete(layerId);

        activeResources.delete(layerId);
        activeResources.delete(`canvas_${layerId}`);
        activeResources.delete(`webgl_${layerId}`);
      }
    },

    cleanupOrphanedBrushes(validLayerIds: Set<string>): void {
      const orphaned = Array.from(new Set([...runtimes.keys(), ...brushes.keys()]))
        .filter(id => !validLayerIds.has(id));

      if (orphaned.length === 0) return;

      orphaned.forEach(layerId => {
        this.removeColorCycleBrush(layerId);
      });
    },

    transferColorCycleBrush(fromLayerId: string, toLayerId: string): boolean {
      devLog('[ccBrushRegistry] transferColorCycleBrush', {
        fromLayerId,
        toLayerId,
        stack: new Error().stack?.split('\n').slice(0, 4).join('\n'),
      });
      const sourceRuntime = this.getRuntime(fromLayerId);
      const sourceBrush = (sourceRuntime?.brush ?? brushes.get(fromLayerId)) as BrushWithOptionalControls | undefined;
      const sourceDocument = sourceRuntime?.document ?? documents.get(fromLayerId);
      const sourceMetadata = brushMetadata.get(fromLayerId);

      if (!sourceBrush || !sourceDocument || !sourceMetadata) {
        return false;
      }

      if (!this.validateColorCycleBrush(fromLayerId)) {
        return false;
      }

      if (brushes.has(toLayerId)) {
        this.removeColorCycleBrush(toLayerId);
      }

      sourceBrush.removeColorCycleLayerDocument?.(fromLayerId);
      const sourceDocumentRead = sourceDocument.read();
      sourceDocument.replaceState({
        ...sourceDocumentRead.snapshot,
        layerId: toLayerId,
        sources: { ...sourceDocumentRead.snapshot.sources },
      }, 'layer-transfer');
      sourceBrush.setColorCycleLayerDocument?.(toLayerId, sourceDocument);

      setRuntime(toLayerId, sourceBrush, sourceDocument);
      sourceBrush.setLayerId?.(toLayerId);
      brushMetadata.set(toLayerId, {
        ...sourceMetadata,
        layerId: toLayerId,
        lastUsed: now()
      });

      if (activeResources.has(fromLayerId)) {
        activeResources.delete(fromLayerId);
        activeResources.add(toLayerId);
      }
      if (activeResources.has(`canvas_${fromLayerId}`)) {
        activeResources.delete(`canvas_${fromLayerId}`);
        activeResources.add(`canvas_${toLayerId}`);
      }
      if (activeResources.has(`webgl_${fromLayerId}`)) {
        activeResources.delete(`webgl_${fromLayerId}`);
        activeResources.add(`webgl_${toLayerId}`);
      }

      brushes.delete(fromLayerId);
      documents.delete(fromLayerId);
      runtimes.delete(fromLayerId);
      brushMetadata.delete(fromLayerId);

      return true;
    }
  };
};
