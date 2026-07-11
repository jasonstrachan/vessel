import { getAppStoreState } from '@/stores/appStoreAccess';
// Debug logs suppressed for color cycle brush
import { GradientStop } from '../../lib/GradientPalette';
import type {
  ColorCycleBrushCanvas2DOptions,
} from './colorCycleBrushContracts';
import { appendCCDebugOverlayEntry } from '@/utils/colorCycle/ccDebugOverlayStore';
import { debugLog, debugWarn } from '@/utils/debug';
import {
  COLOR_CYCLE_RUNTIME_OWNER,
  brushStateHasColorCyclePaintPayload,
  layerHasCanonicalColorCyclePaintPayload,
  setColorCycleBrushPersistenceLayerMeta,
  type ColorCycleBrushPersistenceLayerMeta,
} from '@/lib/colorCycle/document';
import { ColorCycleRuntimeMetadataApiRuntime } from '@/hooks/brushEngine/colorCycleRuntimeMetadataApiRuntime';
import {
  deserializeColorCycleCanvasRuntime,
} from './colorCycleCanvasDeserializeRuntime';
import type {
  AnimatorIndexSnapshot,
  ColorCycleBrushCanvasSerialized,
  ColorCycleRuntimeMutationReason,
  StrokeDataSnapshot,
} from './colorCycleCanvas2DTypes';
import { ColorCycleBrushSettingsApiRuntime } from './colorCycleBrushSettingsApiRuntime';
import { colorAtPosition } from './colorCycleGradientPalette';
import { ColorCyclePresentationApiRuntime } from './colorCyclePresentationApiRuntime';
import {
  enableColorCycleNonDitherPlaybackSpeed,
} from './colorCycleStrokeTimingRuntime';
import { ColorCycleStrokeCoordinatorApiRuntime } from './colorCycleStrokeCoordinatorApiRuntime';
import { ColorCyclePaintBufferClearApiRuntime } from './colorCyclePaintBufferClearApiRuntime';
import {
  ensureColorCycleStampDitherState,
  getColorCycleStampDitherStrokeData,
  markColorCycleStrokeStateContentWritten,
} from './colorCycleStrokeStateRuntime';
import {
  layerStrokeStateHasContent,
  paintBufferHasContent,
} from './colorCycleLayerStrokeBuffers';
import { ColorCycleLayerSnapshotApplyApiRuntime } from './colorCycleLayerSnapshotApplyApiRuntime';
import {
  clearColorCycleStrokeStateForSerializedRestore,
} from './colorCycleSerializedStateRestoreRuntime';
import {
  bindColorCycleRuntimeLayerStrokeBuffersToAnimator,
  createColorCycleRuntimeLayerStrokeState,
  ensureColorCycleRuntimeLayerStrokeState,
} from './colorCycleLayerDocumentRuntime';
import { ColorCycleLayerDocumentApiRuntime } from './colorCycleLayerDocumentApiRuntime';
import { ColorCycleCanvasLifecycleApiRuntime } from './colorCycleCanvasLifecycleApiRuntime';
import { ColorCycleGradientApiRuntime } from './colorCycleGradientApiRuntime';
import { ColorCycleStrokeApiRuntime } from './colorCycleStrokeApiRuntime';
import { ColorCycleShapeFillApiRuntime } from './colorCycleShapeFillApiRuntime';
import { ColorCycleSerializedStateApiRuntime } from './colorCycleSerializedStateApiRuntime';
import { ColorCycleAnimatorApiRuntime } from './colorCycleAnimatorApiRuntime';

const logCcGradientBrushPath = (event: string, data: Record<string, unknown>): void => {
  if (process.env.NODE_ENV === 'test') {
    return;
  }
  appendCCDebugOverlayEntry('log', `cc gradient brush path: ${event}`, data);
};

// Stamp dithering has two concepts:
// 1) Live stamp coverage mask / tiling (what users see during drawing)
// 2) Optional finalize-only error diffusion pass (expensive / different look)

export class ColorCycleBrushCanvas2D {
  readonly [COLOR_CYCLE_RUNTIME_OWNER] = (): object => this.layerDocumentApi.owner;

  // Core settings (match original API)
  private readonly runtimeMetadataApi = new ColorCycleRuntimeMetadataApiRuntime();

  private readonly settingsApi = new ColorCycleBrushSettingsApiRuntime({
    getShapeFillSettings: () => this.shapeFillApi.getSettings(),
    isShapeDitherEnabled: () => this.shapeFillApi.isDitherEnabled(),
    getGradientBands: () => this.shapeFillApi.getGradientBands(),
    setGradientBands: (bands) => this.shapeFillApi.setGradientBands(bands),
    setBandSpacing: (spacing) => this.shapeFillApi.setBandSpacing(spacing),
    normalizeBandSpacingValue: (spacing) => this.shapeFillApi.normalizeBandSpacingValue(spacing),
    deriveBandCountFromDistance: (distance, spacing) =>
      this.shapeFillApi.deriveBandCountFromDistance(distance, spacing),
    setShapeDitherEnabled: (enabled) => this.shapeFillApi.setDitherEnabled(enabled),
    setDitherStrength: (strength) => this.shapeFillApi.setDitherStrength(strength),
    setDitherPixelSize: (size) => this.shapeFillApi.setDitherPixelSize(size),
    setPxlEdgeEnabled: (enabled) => this.shapeFillApi.setPxlEdgeEnabled(enabled),
    setPerceptualDither: (enabled) => this.shapeFillApi.setPerceptualDither(enabled),
    getFlowMode: () => this.runtimeMetadataApi.getFlowMode(),
    getLegacyFlowMode: () => this.runtimeMetadataApi.getLegacyFlowMode(),
    setRuntimeFlowMode: (mode) => this.runtimeMetadataApi.setFlowMode(mode),
    setRuntimeLegacyFlowMode: (mode) => this.runtimeMetadataApi.setLegacyFlowMode(mode),
    getFps: () => this.presentationApi.getFps(),
    getPlaybackSpeedScale: () => this.presentationApi.getPlaybackSpeedScale(),
    forEachAnimator: (callback) => this.presentationApi.forEachAnimator(callback),
    setPhaseValue: (phase) => this.presentationApi.setPhase(phase),
    setPlaybackSpeedScaleValue: (scale) => this.presentationApi.setPlaybackSpeedScale(scale),
    setFpsValue: (fps) => this.presentationApi.setFps(fps),
    getStrokeStateValues: () => this.layerDocumentApi.getStrokeStateValues(),
    getStrokeStateEntries: () => this.layerDocumentApi.getStrokeStateEntries(),
    getActiveLayerId: () => this.layerDocumentApi.getActiveLayerId(),
    getStrokeCounter: () => this.strokeApi.getStrokeCounter(),
    publishLayerBaseSpeed: (layerId, nextBaseSpeed, strokeData, pixelsChanged) => this.layerDocumentApi.publishLayerBaseSpeed(layerId, nextBaseSpeed, strokeData, pixelsChanged),
    getAnimator: (layerId) => this.presentationApi.getAnimator(layerId),
    render: (force) => this.render(force),
    warn: (message) => debugWarn('raw-console', message),
    logGradientBrushPath: (event, data) => logCcGradientBrushPath(event, data),
  });
  private readonly presentationApi: ColorCyclePresentationApiRuntime = new ColorCyclePresentationApiRuntime({
    ensureAnimator: (layerId) => this.animatorApi.ensureFullResolution(layerId, 'restore'),
    getStrokeState: (layerId) => this.layerDocumentApi.getStrokeState(layerId),
    restoreRuntimeFromDocument: (layerId, animator, documentRead) => this.layerDocumentApi.restoreRuntimeFromDocument(layerId, animator, documentRead),
    getStrokeStateValues: () => this.layerDocumentApi.getStrokeStateValues(),
    getLayerDocumentRead: (layerId) => this.layerDocumentApi.getLayerDocumentRead(layerId),
    getLayerColorCycleMeta: (layerId) => this.layerDocumentApi.getLayerColorCycleMeta(layerId),
    applyDefBindingsForLayer: (layerId, animator, strokeData, defs) => {
      this.gradientApi.applyDefBindingsForLayer(layerId, animator, strokeData, defs);
    },
    paintHasContent: paintBufferHasContent,
    getCanvasWidth: () => this.lifecycleApi.getCanvasWidth(),
    getCanvasHeight: () => this.lifecycleApi.getCanvasHeight(),
    finalizeCurrentStroke: (layerId) => this.finalizeCurrentStroke(layerId),
    isDrawing: () => this.strokeApi.isDrawing(),
    consumeLayerDirtyBatch: (layerId) => this.layerDocumentApi.consumeLayerDirtyBatch(layerId),
  });
  private readonly layerDocumentApi: ColorCycleLayerDocumentApiRuntime = new ColorCycleLayerDocumentApiRuntime({
    getCanvasWidth: () => this.lifecycleApi.getCanvasWidth(),
    getCanvasHeight: () => this.lifecycleApi.getCanvasHeight(),
    getLayers: () => getAppStoreState().layers,
    getLayerBaseSpeedCps: () => this.settingsApi.getLayerBaseSpeedValue(),
    getResolvedWriteCycleSpeed: () => this.settingsApi.getResolvedWriteCycleSpeed(),
    getFlowMode: () => this.runtimeMetadataApi.getFlowMode(),
    hasStrokeContent: (strokeData) => layerStrokeStateHasContent(
      strokeData,
      this.lifecycleApi.getCanvasWidth(),
      this.lifecycleApi.getCanvasHeight(),
    ),
    getDerivedSurface: (layerId) => this.presentationApi.getAnimator(layerId),
    markLayerDirty: (layerId) => this.markPresenterLayerDirty(layerId),
  });
  private readonly lifecycleApi: ColorCycleCanvasLifecycleApiRuntime = new ColorCycleCanvasLifecycleApiRuntime({
    isHistoryRestore: () => this.serializedStateApi.isHistoryRestore(),
    forEachAnimator: (callback) => this.presentationApi.forEachAnimator(callback),
    animatorValues: () => this.presentationApi.animatorValues(),
    animatorEntries: () => this.presentationApi.animatorEntries(),
    clearAnimators: () => this.presentationApi.clearAnimators(),
    cancelScheduledRender: () => this.presentationApi.cancelPresenterScheduledRender(),
    stopAnimation: () => this.stopAnimation(),
    pauseAnimation: () => this.pauseAnimation(),
    render: (force) => this.render(force),
    setPresenterTargetCanvas: (canvas) => this.presentationApi.setTargetCanvas(canvas),
    clearLayerStrokeStatesForReset: () => this.layerDocumentApi.clearRuntimeLayerStrokeStatesForReset('runtime-reset'),
    clearRuntimeDocuments: () => this.layerDocumentApi.clearAll(),
    clearGradientSlots: () => this.gradientApi.clearGradientSlots(),
    clearDefBindings: () => this.gradientApi.clearDefBindings(),
    clearCustomStampRuntime: () => this.strokeApi.clearCustomStampRuntime(),
    getStrokeStateValues: () => this.layerDocumentApi.getStrokeStateValues(),
    getActiveLayerId: () => this.layerDocumentApi.getActiveLayerId(),
    getStrokeState: (layerId) => this.layerDocumentApi.getStrokeState(layerId),
    createStrokeState: (options) => createColorCycleRuntimeLayerStrokeState(
      this.layerDocumentApi.getRuntimeContext(),
      options,
    ),
    setStrokeState: (layerId, strokeData) => this.layerDocumentApi.setRuntimeLayerStrokeState(layerId, strokeData),
    hasAnimator: (layerId) => this.presentationApi.hasAnimator(layerId),
    getPaintBuffer: (layerId) => this.layerDocumentApi.getStrokeState(layerId)?.buffers.paint,
    log: (message, ...args) => debugLog('raw-console', message, ...args),
    warn: (message, error) => debugWarn('raw-console', message, error),
    logDisposed: () => debugLog('raw-console', 'ColorCycleBrushCanvas2D disposed'),
  });
  private readonly animatorApi: ColorCycleAnimatorApiRuntime = new ColorCycleAnimatorApiRuntime({
    getAnimator: (layerId) => this.presentationApi.getAnimator(layerId),
    hasAnimator: (layerId) => this.presentationApi.hasAnimator(layerId),
    setAnimator: (layerId, animator) => this.presentationApi.setAnimator(layerId, animator),
    getStrokeState: (layerId) => this.layerDocumentApi.getStrokeState(layerId),
    ensureStrokeState: (layerId, createStrokeState) =>
      this.layerDocumentApi.ensureStrokeState(layerId, createStrokeState),
    createStrokeState: (options) => createColorCycleRuntimeLayerStrokeState(
      this.layerDocumentApi.getRuntimeContext(),
      options,
    ),
    getCanvasWidth: () => this.lifecycleApi.getCanvasWidth(),
    getCanvasHeight: () => this.lifecycleApi.getCanvasHeight(),
    getFps: () => this.presentationApi.getFps(),
    getForceCanvas2D: () => this.lifecycleApi.getForceCanvas2D(),
    getLegacyFlowMode: () => this.runtimeMetadataApi.getLegacyFlowMode(),
  });
  private readonly createAnimator = this.animatorApi.createAnimator;
  private readonly getAnimator = this.animatorApi.getAnimator;
  private readonly strokeCoordinatorApi = new ColorCycleStrokeCoordinatorApiRuntime({
    getStrokeCounter: () => this.strokeApi.getStrokeCounter(),
    getResolvedWriteCycleSpeed: (rawSpeed) => this.settingsApi.getResolvedWriteCycleSpeed(rawSpeed),
    getGradientBands: () => this.shapeFillApi.getGradientBands(),
    getActiveSlot: (layerId) => this.gradientApi.getActiveSlot(layerId),
    getCanvasWidth: () => this.lifecycleApi.getCanvasWidth(),
    getCanvasHeight: () => this.lifecycleApi.getCanvasHeight(),
  });
  private readonly gradientApi = new ColorCycleGradientApiRuntime({
    getActiveLayerId: () => this.layerDocumentApi.getActiveLayerId(),
    setActiveLayerId: (layerId) => this.layerDocumentApi.setActiveLayerId(layerId),
    getStrokeState: (layerId) => this.layerDocumentApi.getStrokeState(layerId),
    ensureStrokeState: (layerId) => ensureColorCycleRuntimeLayerStrokeState(
      this.layerDocumentApi.getRuntimeContext(),
      layerId,
    ),
    getAnimator: (layerId) => this.animatorApi.getAnimator(layerId),
    getAnimatorIfExists: (layerId) => this.presentationApi.getAnimator(layerId),
    getCanvasWidth: () => this.lifecycleApi.getCanvasWidth(),
    getCanvasHeight: () => this.lifecycleApi.getCanvasHeight(),
    getLayerColorCycleMeta: (layerId) => this.layerDocumentApi.getLayerColorCycleMeta(layerId),
    setLayerMeta: (layerId, meta) => this.layerDocumentApi.setLayerMeta(layerId, meta),
    getLayerDocumentVersion: (layerId) => this.layerDocumentApi.getLayerDocumentVersion(layerId),
    setRuntimeGradientStops: (stops, builtFromVersion) =>
      this.runtimeMetadataApi.setGradientStops(stops, builtFromVersion),
    shouldPreserveGradientPhaseOnChange: () => this.settingsApi.shouldPreserveGradientPhaseOnChange(),
    resetStampCounter: () => this.strokeApi.resetStampCounter(),
    snapshotFromBuffers: (strokeData) => this.layerDocumentApi.snapshotFromBuffers(strokeData),
    markPresenterLayerDirty: (layerId) => this.markPresenterLayerDirty(layerId),
    render: (force) => this.render(force),
    setPreserveGradientPhase: (enabled) => this.settingsApi.setPreserveGradientPhaseOnChange(enabled),
  });
  private readonly strokeApi: ColorCycleStrokeApiRuntime = new ColorCycleStrokeApiRuntime({
    warn: (message, error) => debugWarn('raw-console', message, error),
    getActiveLayerId: () => this.layerDocumentApi.getActiveLayerId(),
    getLayerDocumentVersion: (layerId) => this.layerDocumentApi.getLayerDocumentVersion(layerId),
    setActiveLayerId: (layerId) => this.layerDocumentApi.setActiveLayerId(layerId),
    ensureStrokeFullResolution: (layerId, reason) => this.animatorApi.ensureFullResolution(layerId, reason),
    getStrokeData: (layerId) => this.layerDocumentApi.getStrokeState(layerId),
    createStrokeState: (options) => createColorCycleRuntimeLayerStrokeState(
      this.layerDocumentApi.getRuntimeContext(),
      options,
    ),
    setStrokeState: (layerId, strokeData) => this.layerDocumentApi.setRuntimeLayerStrokeState(layerId, strokeData),
    getActiveSlot: (layerId) => this.gradientApi.getActiveSlot(layerId),
    applyStrokeFlowSpeed: (strokeData, speedSamplePxPerMs) =>
      this.strokeCoordinatorApi.applyStrokeFlowSpeed(strokeData, speedSamplePxPerMs),
    resolveActiveStrokeSlot: (layerId, strokeData) =>
      this.strokeCoordinatorApi.resolveActiveStrokeSlot(layerId, strokeData),
    resolveFlowSlot: (strokeData, activeSlot) => this.strokeCoordinatorApi.resolveFlowSlot(strokeData, activeSlot),
    resolveCapturedStampGradientBinding: (layerId, colorCycle) =>
      this.gradientApi.resolveCapturedStampGradientBinding(layerId, colorCycle),
    resolveGradientDefIdForSlot: (layerId, slot) => this.gradientApi.resolveGradientDefIdForSlot(layerId, slot),
    isStampDitherEnabled: () => this.settingsApi.isStampDitherEnabled(),
    getStampShape: () => this.settingsApi.getStampShapeValue(),
    computeColorBandIndex: (strokeData) => this.strokeCoordinatorApi.computeColorBandIndex(strokeData),
    getNonDitherStrokeColorIndex: (strokeData) => this.strokeCoordinatorApi.getNonDitherStrokeColorIndex(strokeData),
    advanceStrokePhase: (strokeData) => this.strokeCoordinatorApi.advanceStrokePhase(strokeData),
    getWriteSpeedByte: (strokeData) => this.strokeCoordinatorApi.getWriteSpeedByte(strokeData),
    getFlowMode: () => this.runtimeMetadataApi.getFlowMode(),
    resolvePressureBrushSize: (pressure) => this.settingsApi.resolvePressureBrushSize(pressure),
    getGradientBands: () => this.shapeFillApi.getGradientBands(),
    createStampDitherConfig: (options) => this.settingsApi.createStampDitherConfig(options),
    getStampDitherStrokeData: (strokeData) => getColorCycleStampDitherStrokeData(strokeData),
    getStampDitherRuntime: () => this.settingsApi.getStampDitherRuntime(),
    ensureStampDitherState: (strokeData) => ensureColorCycleStampDitherState(strokeData),
    getWriteCycleSpeed: (strokeData) => this.strokeCoordinatorApi.getWriteCycleSpeed(strokeData),
    markStrokeStateContentWritten: (strokeData) => markColorCycleStrokeStateContentWritten(strokeData),
    getLayerGradientDefs: (layerId) => this.layerDocumentApi.getLayerColorCycleMeta(layerId)?.gradientDefStore as
      | Array<{ id: number; hash: string; stops: GradientStop[] }>
      | undefined,
    applyDefBindingsForLayer: (layerId, animator, strokeData, defs, options) =>
      this.gradientApi.applyDefBindingsForLayer(layerId, animator, strokeData, defs, options),
    markPresenterLayerDirty: (layerId) => this.markPresenterLayerDirty(layerId),
    isAnimating: () => this.presentationApi.isAnimating(),
    hasScheduledFrame: () => this.presentationApi.hasScheduledFrame(),
    hasConnectedTarget: () => this.presentationApi.hasConnectedTarget(),
    forceLayerRender: (layerId) => this.forceRenderLayer(layerId),
    renderFromDirtyBatches: (dirtyBatches) => this.renderFromDirtyBatches(dirtyBatches),
    render: (force) => this.render(force),
    scheduleDirtyRender: (options) => this.presentationApi.scheduleDirtyRender(options),
    getCanvasWidth: () => this.lifecycleApi.getCanvasWidth(),
    getCanvasHeight: () => this.lifecycleApi.getCanvasHeight(),
    getBrushSize: () => this.settingsApi.getBrushSizeValue(),
    isHistoryRestore: () => this.serializedStateApi.isHistoryRestore(),
    getResolvedWriteCycleSpeed: () => this.settingsApi.getResolvedWriteCycleSpeed(),
    bindStrokeBuffersToAnimator: (strokeData, animator) => bindColorCycleRuntimeLayerStrokeBuffersToAnimator(
      this.layerDocumentApi.getRuntimeContext(),
      strokeData,
      animator,
    ),
    getStampDitherAlgorithm: () => this.settingsApi.getStampDitherAlgorithm(),
    getStampDitherPixelSize: () => this.settingsApi.getStampDitherPixelSize(),
    getStampDitherPatternStyle: () => this.settingsApi.getStampDitherPatternStyle(),
    getStampDitherImageTileThresholdResolver: () => (
      this.settingsApi.getStampDitherImageTileThresholdResolver(getAppStoreState().project?.ccCustomTilePatterns)
    ),
    keepsStampDitherBackgroundFill: () => this.settingsApi.keepsStampDitherBackgroundFill(),
    isStampDitherPressureLinked: () => this.settingsApi.isStampDitherPressureLinked(),
    getDitherStrength: () => this.shapeFillApi.getDitherStrength(),
    colorAtPosition: (position) => colorAtPosition(
      this.runtimeMetadataApi.getGradientStops(),
      position,
    ),
    hashStrokeDitherSeed: (r, g, b, slot, strokeCounter) =>
      this.strokeCoordinatorApi.hashStrokeDitherSeed(r, g, b, slot, strokeCounter),
    mutateLayerStrokeState: (mutation) => this.layerDocumentApi.mutateRuntimeLayerStrokeState(mutation),
    assertStrokeHandleSize: (handle, label) => this.strokeCoordinatorApi.assertStrokeHandleSize(handle, label),
    enableNonDitherPlaybackSpeed: (strokeData) => enableColorCycleNonDitherPlaybackSpeed({
      strokeData,
      speedByte: this.strokeCoordinatorApi.getWriteSpeedByte(strokeData),
    }),
    refreshStrokeContent: (strokeData) => this.layerDocumentApi.refreshStrokeContent(strokeData),
    brushStateHasColorCyclePaintPayload: (brushState, id) => this.brushStateHasColorCyclePaintPayload(brushState, id),
  });
  private readonly shapeFillApi: ColorCycleShapeFillApiRuntime = new ColorCycleShapeFillApiRuntime({
    getCanvasWidth: () => this.lifecycleApi.getCanvasWidth(),
    getCanvasHeight: () => this.lifecycleApi.getCanvasHeight(),
    getCanvasPixelCount: () => this.lifecycleApi.getCanvasPixelCount(),
    getLayerDocumentRuntimeContext: () => this.layerDocumentApi.getRuntimeContext(),
    hasStrokeState: (layerId) => this.layerDocumentApi.hasStrokeState(layerId),
    getStrokeState: (layerId) => this.layerDocumentApi.getStrokeState(layerId),
    getActiveSlot: (layerId) => this.gradientApi.getActiveSlot(layerId),
    getFlowMode: () => this.runtimeMetadataApi.getFlowMode(),
    getStampDitherAlgorithm: () => this.settingsApi.getStampDitherAlgorithm(),
    getStampDitherPatternStyle: () => this.settingsApi.getStampDitherPatternStyle(),
    getStampCounter: () => this.strokeApi.getStampCounter(),
    advanceStampCounter: (delta) => this.strokeApi.advanceStampCounter(delta),
    setLayerStrokeState: (layerId, strokeData) => this.layerDocumentApi.setRuntimeLayerStrokeState(layerId, strokeData),
    getStrokeCounter: () => this.strokeApi.getStrokeCounter(),
    getResolvedWriteCycleSpeed: () => this.settingsApi.getResolvedWriteCycleSpeed(),
    resolveFlowSlot: (strokeData, activeSlot) => this.strokeCoordinatorApi.resolveFlowSlot(strokeData, activeSlot),
    ensureFullResolution: (layerId, reason) => this.animatorApi.ensureFullResolution(layerId, reason),
    getGradientStops: () => this.runtimeMetadataApi.getGradientStops(),
    getStampDitherImageTileThresholdResolver: () => (
      this.settingsApi.getStampDitherImageTileThresholdResolver(getAppStoreState().project?.ccCustomTilePatterns)
    ),
    markPresenterLayerDirty: (layerId) => this.markPresenterLayerDirty(layerId),
    render: (force) => this.render(force),
  });
  private readonly layerSnapshotApplyApi = new ColorCycleLayerSnapshotApplyApiRuntime({
    getCanvasWidth: () => this.lifecycleApi.getCanvasWidth(),
    getCanvasHeight: () => this.lifecycleApi.getCanvasHeight(),
    getLayerDocumentRuntimeContext: () => this.layerDocumentApi.getRuntimeContext(),
    getExistingStrokeState: (layerId) => this.layerDocumentApi.getStrokeState(layerId),
    layerHasCanonicalColorCyclePaintPayload: (layerId) => this.layerHasCanonicalColorCyclePaintPayload(layerId),
    brushStateHasColorCyclePaintPayload: (brushState, layerId) =>
      this.brushStateHasColorCyclePaintPayload(brushState, layerId),
    ensureFullResolution: (layerId) => this.animatorApi.ensureFullResolution(layerId, 'restore'),
    captureAuditSnapshot: (layerId, strokeState) => this.layerDocumentApi.captureMutationAuditSnapshot({
      layerId,
      strokeData: strokeState,
      width: this.lifecycleApi.getCanvasWidth(),
      height: this.lifecycleApi.getCanvasHeight(),
      meta: this.layerDocumentApi.getLayerColorCycleMeta(layerId),
    }),
    getLayerMeta: (layerId) => this.layerDocumentApi.getLayerColorCycleMeta(layerId),
    getFlowMode: () => this.runtimeMetadataApi.getFlowMode(),
    setGradientSlotStops: (layerId, slot, stops, seamProfile) => {
      this.setGradientSlotStops(layerId, slot, stops, seamProfile);
    },
    setActiveGradientSlot: (layerId, slot) => this.setActiveGradientSlot(layerId, slot),
    publishStrokeState: (layerId, strokeState, publish) => {
      this.layerDocumentApi.setRuntimeLayerStrokeState(layerId, strokeState, {
        publishToDocument: true,
        reason: publish.reason as ColorCycleRuntimeMutationReason,
      });
    },
    recordClearAudit: (operation) => {
      this.layerDocumentApi.recordMutationIfCleared(operation);
    },
    applyDefBindingsForLayer: (layerId, animator, strokeState, defs) => {
      this.gradientApi.applyDefBindingsForLayer(layerId, animator, strokeState, defs);
    },
    markLayerDirty: (layerId) => this.markPresenterLayerDirty(layerId),
  });
  private readonly paintBufferClearApi = new ColorCyclePaintBufferClearApiRuntime({
    getActiveLayerId: () => this.layerDocumentApi.getActiveLayerId(),
    isHistoryRestore: () => this.serializedStateApi.isHistoryRestore(),
    mutateLayerStrokeState: (params) => this.layerDocumentApi.mutateRuntimeLayerStrokeState(params),
    ensureFullResolution: (layerId, reason) => this.animatorApi.ensureFullResolution(layerId, reason),
    render: (force) => this.render(force),
    isAnimating: () => this.presentationApi.isAnimating(),
    hasAnimatedContent: () => this.hasAnimatedContent(),
    stopAnimation: () => this.stopAnimation(),
  });
  private readonly serializedStateApi = new ColorCycleSerializedStateApiRuntime({
    getCurrentStrokeCounter: () => this.strokeApi.getStrokeCounter(),
    hasCanonicalPaintPayload: (layerId) => this.layerHasCanonicalColorCyclePaintPayload(layerId),
    applySettings: (settings) => this.applySettings(settings),
    applyLegacyStampDitherClears: (clears) => this.setStampDitherClears(clears),
    getLayer: (layerId) => getAppStoreState().layers.find((candidate) => candidate.id === layerId),
    getStrokeState: (layerId) => this.layerDocumentApi.getStrokeState(layerId),
    brushStateHasPaintPayload: (layerId, brushState) => this.brushStateHasColorCyclePaintPayload(brushState, layerId),
    hasStrokeState: (layerId) => this.layerDocumentApi.hasStrokeState(layerId),
    clearStrokeStateForRestore: (layerId) => {
      debugLog('raw-console', '[ColorCycleBrush] Paint buffer cleared during restore for layer:', layerId?.substring(0, 20));
      this.layerDocumentApi.mutateRuntimeLayerStrokeState({
        layerId,
        reason: 'project-load-restore',
        source: 'project-load',
        expectedDestructive: true,
        mutate: (state) => {
          clearColorCycleStrokeStateForSerializedRestore(state);
        },
        after: { hasContent: false, strokeCounter: 0 },
      });
    },
    clearAnimator: (layerId) => {
      const animator = this.presentationApi.getAnimator(layerId);
      if (animator) {
        try { animator.clear(); } catch {}
      }
    },
    clearComposite: () => this.presentationApi.clearComposite(),
    applyLayerSnapshot: (layerId, snapshot, animatorIndex, reason) => {
      this.executeLayerSnapshotApply(layerId, snapshot, animatorIndex, reason);
    },
    setHighestStrokeCounter: (strokeCounter) => {
      this.strokeApi.setStrokeCounter(strokeCounter);
    },
    getAnimators: () => this.presentationApi.getAnimatorMap(),
    getDocumentRead: (layerId) => this.layerDocumentApi.getLayerDocumentRead(layerId),
    ensureStrokeSnapshot: (strokeState) => {
      this.layerDocumentApi.snapshotFromBuffers(strokeState);
    },
    hasPaintContent: (paint) => paintBufferHasContent(
      paint && paint.byteLength > 0 ? new Uint8Array(paint) : undefined,
      this.lifecycleApi.getCanvasWidth(),
      this.lifecycleApi.getCanvasHeight(),
    ),
    hasStrokeContent: (strokeState) => layerStrokeStateHasContent(
      strokeState,
      this.lifecycleApi.getCanvasWidth(),
      this.lifecycleApi.getCanvasHeight(),
    ),
    getLayerMeta: (layerId) => (
      this.layerDocumentApi.getLayerColorCycleMeta(layerId) as ColorCycleBrushPersistenceLayerMeta | null
    ),
    getSerializeSettings: () => ({
      cycleSpeed: this.settingsApi.getCycleSpeedValue(),
      layerBaseSpeed: this.settingsApi.getLayerBaseSpeedValue(),
      playbackSpeedScale: this.presentationApi.getPlaybackSpeedScale(),
      fps: this.presentationApi.getFps(),
      brushSize: this.settingsApi.getBrushSizeValue(),
      ...this.shapeFillApi.getSettings(),
      stampShape: this.settingsApi.getStampShapeValue(),
      ...this.settingsApi.getStampDitherSettings(),
    }),
  });

  private brushStateHasColorCyclePaintPayload(brushState: unknown, layerId?: string): boolean {
    return brushStateHasColorCyclePaintPayload(brushState, layerId);
  }

  private layerHasCanonicalColorCyclePaintPayload(layerId: string): boolean {
    try {
      const state = getAppStoreState();
      const layer = state.layers.find((candidate) => candidate.id === layerId);
      return layerHasCanonicalColorCyclePaintPayload(layer);
    } catch {
      return false;
    }
  }

  constructor(canvas: HTMLCanvasElement, options: ColorCycleBrushCanvas2DOptions = {}) {
    // Validate canvas
    if (!canvas) {
      throw new Error('Canvas element is required');
    }

    if (!canvas.width || !canvas.height) {
      throw new Error('Canvas must have valid dimensions');
    }

    this.presentationApi.configurePresenter(canvas);
    this.lifecycleApi.configureTarget(canvas, options.forceCanvas2D ?? false);
    this.shapeFillApi.configure(options);

    this.settingsApi.setInitialBrushSize(options.brushSize);
    this.presentationApi.configurePlayback({
      initialFps: options.fps || 60,
      initialPlaybackSpeedScale: 1,
      hasAnimatedContent: () => this.hasAnimatedContent(),
      getDocumentRead: (layerId) => this.layerDocumentApi.getLayerDocumentRead(layerId),
      shouldUpdateAnimator: (layerId) => (
        this.layerDocumentApi.getStrokeState(layerId)?.hasContent ?? false
      ),
      render: () => this.render(false),
      flushScheduledRender: () => this.flushScheduledRender(),
    });
    this.settingsApi.clearStampDitherRuntime();
    this.layerDocumentApi.registerPersistenceContexts({
      applyLayerSnapshot: (layerId, snapshot, animatorIndex, reason, options) => {
        this.executeLayerSnapshotApply(layerId, snapshot, animatorIndex, reason, options);
      },
      ensureAnimator: (layerId) => this.animatorApi.ensureFullResolution(layerId, 'restore'),
      readSerializedState: () => this.readSerializedState(),
      restoreSerializedState: (state, options) => this.restoreSerializedState(state, options),
    });
  }

  markLayerHasExternalBase(layerId: string) {
    this.layerDocumentApi.markLayerHasExternalBase(layerId);
  }

  private readonly computeColorBandIndex = this.strokeCoordinatorApi.computeColorBandIndex;
  private readonly getWriteSpeedByte = this.strokeCoordinatorApi.getWriteSpeedByte;
  private readonly getCcGradientFillSpeedByte = this.strokeCoordinatorApi.getCcGradientFillSpeedByte;
  private readonly getResolvedWriteCycleSpeed = this.settingsApi.getResolvedWriteCycleSpeed;
  private readonly resolvePressureBrushSize = this.settingsApi.resolvePressureBrushSize;
  private readonly ensureFullResolution = this.animatorApi.ensureFullResolution;
  private readonly resolvePhaseAdvancePerStamp = this.strokeCoordinatorApi.resolvePhaseAdvancePerStamp;
  private readonly applyDefBindingsForLayer = this.gradientApi.applyDefBindingsForLayer;

  readonly paint = this.strokeApi.paint;
  readonly paintCustomStamp = this.strokeApi.paintCustomStamp;

  readonly setPreserveGradientPhase = this.gradientApi.setPreserveGradientPhase;
  readonly setGradient = this.gradientApi.setGradient;
  readonly setGradientSlot = this.gradientApi.setGradientSlot;
  readonly setGradientSlotStops = this.gradientApi.setGradientSlotStops;
  readonly setActiveGradientSlot = this.gradientApi.setActiveGradientSlot;
  readonly getActiveGradientSlot = this.gradientApi.getActiveGradientSlot;
  readonly syncGradientDefRuntime = this.gradientApi.syncGradientDefRuntime;

  /**
   * Clear paint buffer for a layer (used for shape mode)
   */
  clearPaintBuffer(
    layerId?: string,
    reason: ColorCycleRuntimeMutationReason = 'manual-clear-layer'
  ) {
    this.paintBufferClearApi.clearPaintBuffer(layerId, reason);
  }

  /**
   * Bind committed gradient def ids to pixels that match a slot.
   * This updates the authoritative def buffer without reading from animator state.
   */
  readonly bindGradientDefIdToSlot = this.gradientApi.bindGradientDefIdToSlot;

  /** Enable/disable perceptual dithering for shape fills. */
  readonly setPerceptualDither = this.settingsApi.setPerceptualDither;

  readonly fillShapeDispatch = this.shapeFillApi.fillShapeDispatch;

  readonly startStroke = this.strokeApi.startStroke;
  readonly endStroke = this.strokeApi.endStroke;
  readonly finalizeCurrentStroke = this.strokeApi.finalizeCurrentStroke;

  readonly fillShapeLinear = this.shapeFillApi.fillShapeLinear;
  readonly fillShape = this.shapeFillApi.fillShape;

  readonly clear = this.lifecycleApi.clear;

  readonly render = this.presentationApi.render;
  readonly renderDirectToCanvas = this.presentationApi.renderDirectToCanvas;
  readonly commitCurrentStroke = this.presentationApi.commitCurrentStroke;
  readonly commitToLayer = this.presentationApi.commitToLayer;
  private readonly hasAnimatedContent = this.presentationApi.hasAnimatedContent;
  private readonly markPresenterLayerDirty = this.presentationApi.markLayerDirty;
  private readonly renderFromDirtyBatches = this.presentationApi.renderFromDirtyBatches;
  private readonly forceRenderLayer = this.presentationApi.forceRenderLayer;
  private readonly flushScheduledRender = this.presentationApi.flushScheduledRender;
  readonly flush = this.presentationApi.flush;
  readonly getColorCycleDerivedSurface = (layerId: string) => this.presentationApi.getAnimator(layerId) ?? null;
  readonly startAnimation = this.presentationApi.startAnimation;
  readonly stopAnimation = this.presentationApi.stopAnimation;
  readonly togglePlayPause = this.presentationApi.togglePlayPause;
  readonly pause = this.presentationApi.pause;
  readonly resume = this.presentationApi.resume;
  readonly pauseAnimation = this.presentationApi.pauseAnimation;
  readonly resumeAnimation = this.presentationApi.resumeAnimation;
  readonly updateAnimation = this.presentationApi.updateAnimation;

  readonly getSettings = this.settingsApi.getSettings;
  readonly applySettings = this.settingsApi.applySettings;
  readonly setPhase = this.settingsApi.setPhase;
  readonly setSpeed = this.settingsApi.setSpeed;
  readonly setLayerBaseSpeed = this.settingsApi.setLayerBaseSpeed;
  readonly setPlaybackSpeedScale = this.settingsApi.setPlaybackSpeedScale;
  readonly setFPS = this.settingsApi.setFPS;
  readonly setBrushSize = this.settingsApi.setBrushSize;
  readonly setGradientBands = this.settingsApi.setGradientBands;
  readonly setBandSpacing = this.settingsApi.setBandSpacing;
  private readonly normalizeBandSpacingValue = this.settingsApi.normalizeBandSpacingValue;
  private readonly deriveBandCountFromDistance = this.settingsApi.deriveBandCountFromDistance;
  readonly setStampShape = this.settingsApi.setStampShape;
  readonly setPressureEnabled = this.settingsApi.setPressureEnabled;
  readonly setMinPressure = this.settingsApi.setMinPressure;
  readonly setMaxPressure = this.settingsApi.setMaxPressure;
  readonly setDitherEnabled = this.settingsApi.setDitherEnabled;
  readonly setDitherStrength = this.settingsApi.setDitherStrength;
  readonly setDitherPixelSize = this.settingsApi.setDitherPixelSize;
  readonly setPxlEdgeEnabled = this.settingsApi.setPxlEdgeEnabled;
  readonly setStampDitherEnabled = this.settingsApi.setStampDitherEnabled;
  readonly setStampDitherAlgorithm = this.settingsApi.setStampDitherAlgorithm;
  readonly setStampDitherPatternStyle = this.settingsApi.setStampDitherPatternStyle;
  readonly setStampDitherPatternTileSettings = this.settingsApi.setStampDitherPatternTileSettings;
  readonly setStampDitherPixelSize = this.settingsApi.setStampDitherPixelSize;
  readonly setStampDitherPressureLinked = this.settingsApi.setStampDitherPressureLinked;
  readonly setStampDitherBgFill = this.settingsApi.setStampDitherBgFill;
  readonly setStampDitherClears = this.settingsApi.setStampDitherClears;

  readonly isPlaying = this.presentationApi.isPlaying;
  readonly setOnFrameRendered = this.presentationApi.setOnFrameRendered;

  get activeGradientSlots(): ReadonlyMap<string, number> {
    return this.gradientApi.getActiveGradientSlots();
  }

  readonly setActiveLayer = this.layerDocumentApi.setActiveLayer;

  readonly setPlaying = this.presentationApi.setPlaying;

  readonly setLayerId = this.layerDocumentApi.setLayerId;
  readonly setColorCycleLayerDocument = this.layerDocumentApi.setColorCycleLayerDocument;
  readonly getColorCycleLayerDocument = this.layerDocumentApi.getColorCycleLayerDocument;
  readonly rebaseColorCycleLayerDocument = this.layerDocumentApi.rebaseColorCycleLayerDocument;
  readonly removeColorCycleLayerDocument = this.layerDocumentApi.removeColorCycleLayerDocument;
  readonly getLayerId = this.layerDocumentApi.getLayerId;
  readonly setIsolated = this.layerDocumentApi.setIsolated;

  readonly getCanvas = this.lifecycleApi.getCanvas;
  readonly setTargetCanvas = this.lifecycleApi.setTargetCanvas;
  readonly setUseCanvas2D = this.lifecycleApi.setUseCanvas2D;
  readonly isUsingWebGL = this.lifecycleApi.isUsingWebGL;
  readonly isContextLost = this.lifecycleApi.isContextLost;
  readonly hasValidBuffers = this.lifecycleApi.hasValidBuffers;
  readonly cleanup = this.lifecycleApi.cleanup;
  readonly destroy = this.lifecycleApi.destroy;

  /**
   * Set flow direction (API compatible)
   */
  readonly setFlowMode = this.settingsApi.setFlowMode;
  readonly setLegacyFlowMode = this.settingsApi.setLegacyFlowMode;
  readonly setFlowDirection = this.settingsApi.setFlowDirection;
  readonly getFlowMode = this.settingsApi.getFlowMode;

  get flowDirection(): 'forward' | 'backward' {
    return this.settingsApi.getFlowDirection();
  }

  set flowDirection(direction: 'forward' | 'backward') {
    this.settingsApi.setFlowDirection(direction);
  }

  /**
   * Toggle flow direction (API compatible)
   */
  readonly toggleFlowDirection = this.settingsApi.toggleFlowDirection;

  private readonly restoreSerializedState = this.serializedStateApi.restoreSerializedState;

  readonly verifyPaintBufferCleared = this.lifecycleApi.verifyPaintBufferCleared;

  private readonly readSerializedState = this.serializedStateApi.readSerializedState;

  /**
   * Deserialize state (API compatible simplified)
   */
  static deserialize(data: ColorCycleBrushCanvasSerialized, canvas: HTMLCanvasElement): ColorCycleBrushCanvas2D {
    let instance: ColorCycleBrushCanvas2D;
    return deserializeColorCycleCanvasRuntime(
      {
        createInstance: (targetCanvas, options) => {
          instance = new ColorCycleBrushCanvas2D(targetCanvas, options);
        },
        applySettings: (settings) => instance.applySettings(settings),
        setLayerMeta: (layerId, meta) => {
          setColorCycleBrushPersistenceLayerMeta(instance.layerDocumentApi.owner, layerId, meta);
        },
        applyLayerSnapshot: (layerId, snapshot, animatorIndex) =>
          instance.executeLayerSnapshotApply(layerId, snapshot, animatorIndex),
        getResult: () => instance,
      },
      data,
      canvas,
    );
  }

  private executeLayerSnapshotApply(
    layerId: string,
    snapshot: StrokeDataSnapshot,
    animatorIndex?: AnimatorIndexSnapshot,
    reason: ColorCycleRuntimeMutationReason = 'snapshot-apply',
    options?: { suppressClearAudit?: boolean },
  ) {
    this.layerSnapshotApplyApi.apply(
      layerId,
      snapshot,
      animatorIndex,
      reason,
      options,
    );
  }

  /**
   * Update gradient (async version for compatibility with tests)
   */
  readonly updateGradient = this.gradientApi.updateGradient;

  readonly startCycling = this.presentationApi.startCycling;
  readonly stopCycling = this.presentationApi.stopCycling;

  readonly dispose = this.lifecycleApi.dispose;
}
