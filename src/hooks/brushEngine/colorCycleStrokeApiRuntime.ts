import {
  ColorCycleCustomStampRuntime,
  type ColorCycleCustomStampRuntimeDeps,
  type CustomStampInput,
} from './colorCycleCustomStampRuntime';
import {
  runColorCyclePaintStroke,
  type ColorCyclePaintStrokeContext,
} from './colorCyclePaintStrokeRuntime';
import {
  prepareColorCycleStrokeContext,
  type ColorCycleStrokePreparationContext,
} from './colorCycleStrokePreparationRuntime';
import {
  endColorCycleStrokeLifecycle,
  startColorCycleStrokeLifecycle,
  type ColorCycleStrokeLifecycleContext,
} from './colorCycleStrokeLifecycleRuntime';
import { ColorCycleStrokePerfState } from './colorCycleStrokePerf';
import { ColorCycleStrokeSessionState } from './colorCycleStrokeSessionState';

export type ColorCycleStrokeApiRuntimeContext = {
  warn(message: string, error: unknown): void;
  getActiveLayerId: ColorCyclePaintStrokeContext['getActiveLayerId'];
  getLayerDocumentVersion: ColorCycleCustomStampRuntimeDeps['getLayerDocumentVersion'];
  setActiveLayerId(layerId: string): void;
  ensureStrokeFullResolution: ColorCycleStrokeLifecycleContext['ensureFullResolution'];
  getStrokeData: ColorCycleStrokeLifecycleContext['getStrokeData'];
  createStrokeState: ColorCycleStrokePreparationContext['createStrokeState'];
  setStrokeState: ColorCycleStrokePreparationContext['setStrokeState'];
  getActiveSlot: ColorCycleStrokePreparationContext['getActiveSlot'];
  applyStrokeFlowSpeed: ColorCyclePaintStrokeContext['applyStrokeFlowSpeed'];
  resolveActiveStrokeSlot: ColorCyclePaintStrokeContext['resolveActiveStrokeSlot'];
  resolveFlowSlot: ColorCyclePaintStrokeContext['resolveFlowSlot'];
  resolveCapturedStampGradientBinding: ColorCycleCustomStampRuntimeDeps['resolveCapturedStampGradientBinding'];
  resolveGradientDefIdForSlot: ColorCycleCustomStampRuntimeDeps['resolveGradientDefIdForSlot'];
  isStampDitherEnabled: ColorCyclePaintStrokeContext['isStampDitherEnabled'];
  getStampShape: ColorCyclePaintStrokeContext['getStampShape'];
  computeColorBandIndex: ColorCyclePaintStrokeContext['computeColorBandIndex'];
  getNonDitherStrokeColorIndex: ColorCyclePaintStrokeContext['getNonDitherStrokeColorIndex'];
  advanceStrokePhase: ColorCyclePaintStrokeContext['advanceStrokePhase'];
  getWriteSpeedByte: ColorCyclePaintStrokeContext['getWriteSpeedByte'];
  getFlowMode: ColorCyclePaintStrokeContext['getFlowMode'];
  resolvePressureBrushSize: ColorCyclePaintStrokeContext['resolvePressureBrushSize'];
  getGradientBands: ColorCyclePaintStrokeContext['getGradientBands'];
  createStampDitherConfig: ColorCyclePaintStrokeContext['createStampDitherConfig'];
  getStampDitherStrokeData: ColorCyclePaintStrokeContext['getStampDitherStrokeData'];
  getStampDitherRuntime: ColorCyclePaintStrokeContext['getStampDitherRuntime'];
  ensureStampDitherState: ColorCyclePaintStrokeContext['ensureStampDitherState'];
  getWriteCycleSpeed: ColorCyclePaintStrokeContext['getWriteCycleSpeed'];
  markStrokeStateContentWritten: ColorCyclePaintStrokeContext['markStrokeStateContentWritten'];
  getLayerGradientDefs: ColorCycleCustomStampRuntimeDeps['getLayerGradientDefs'];
  applyDefBindingsForLayer: ColorCycleCustomStampRuntimeDeps['applyDefBindingsForLayer'];
  markPresenterLayerDirty: ColorCyclePaintStrokeContext['markPresenterLayerDirty'];
  isAnimating: ColorCyclePaintStrokeContext['isAnimating'];
  hasScheduledFrame: ColorCyclePaintStrokeContext['hasScheduledFrame'];
  hasConnectedTarget: ColorCyclePaintStrokeContext['hasConnectedTarget'];
  forceLayerRender: ColorCyclePaintStrokeContext['forceLayerRender'];
  renderFromDirtyBatches: ColorCyclePaintStrokeContext['renderFromDirtyBatches'];
  render: ColorCyclePaintStrokeContext['render'];
  scheduleDirtyRender: ColorCyclePaintStrokeContext['scheduleDirtyRender'];
  getCanvasWidth: ColorCyclePaintStrokeContext['getCanvasWidth'];
  getCanvasHeight: ColorCyclePaintStrokeContext['getCanvasHeight'];
  getBrushSize(): number;
  isHistoryRestore(): boolean;
  getResolvedWriteCycleSpeed: ColorCycleStrokeLifecycleContext['getResolvedWriteCycleSpeed'];
  bindStrokeBuffersToAnimator: ColorCycleStrokeLifecycleContext['bindStrokeBuffersToAnimator'];
  getStampDitherAlgorithm: ColorCycleStrokeLifecycleContext['stampDitherAlgorithm'];
  getStampDitherPixelSize: ColorCycleStrokeLifecycleContext['stampDitherPixelSize'];
  getStampDitherPatternStyle: ColorCycleStrokeLifecycleContext['stampDitherPatternStyle'];
  getStampDitherImageTileThresholdResolver:
    ColorCycleStrokeLifecycleContext['getStampDitherImageTileThresholdResolver'];
  keepsStampDitherBackgroundFill: ColorCycleStrokeLifecycleContext['stampDitherBgFill'];
  isStampDitherPressureLinked: ColorCycleStrokeLifecycleContext['stampDitherPressureLinked'];
  getDitherStrength: ColorCycleStrokeLifecycleContext['ditherStrength'];
  colorAtPosition: ColorCycleStrokeLifecycleContext['colorAtPosition'];
  hashStrokeDitherSeed: ColorCycleStrokeLifecycleContext['hashStrokeDitherSeed'];
  mutateLayerStrokeState: ColorCycleStrokeLifecycleContext['mutateLayerStrokeState'];
  assertStrokeHandleSize: ColorCycleStrokeLifecycleContext['assertStrokeHandleSize'];
  enableNonDitherPlaybackSpeed: ColorCycleStrokeLifecycleContext['enableNonDitherPlaybackSpeed'];
  refreshStrokeContent: ColorCycleStrokeLifecycleContext['refreshStrokeContent'];
  brushStateHasColorCyclePaintPayload:
    ColorCycleStrokeLifecycleContext['brushStateHasColorCyclePaintPayload'];
};

export class ColorCycleStrokeApiRuntime {
  private readonly customStampRuntime = new ColorCycleCustomStampRuntime();
  private readonly strokePerf = new ColorCycleStrokePerfState();
  private readonly strokeSession = new ColorCycleStrokeSessionState();

  constructor(
    private readonly context: ColorCycleStrokeApiRuntimeContext,
  ) {}

  readonly paint = (
    x: number,
    y: number,
    layerId?: string,
    pressure: number = 1.0,
    rotation: number = 0,
    speedSamplePxPerMs?: number,
  ): void => {
    runColorCyclePaintStroke(
      this.getPaintStrokeContext(),
      x,
      y,
      layerId,
      pressure,
      rotation,
      speedSamplePxPerMs,
    );
  };

  readonly paintCustomStamp = (
    stamp: CustomStampInput,
    x: number,
    y: number,
    layerId?: string,
    pressure: number = 1.0,
    rotation: number = 0,
    speedSamplePxPerMs?: number,
  ): void => {
    this.customStampRuntime.paint(
      stamp,
      x,
      y,
      this.getCustomStampRuntimeDeps(),
      layerId,
      pressure,
      rotation,
      speedSamplePxPerMs,
    );
  };

  readonly startStroke = (
    layerId?: string,
    clearBuffer: boolean = false,
  ): void => {
    startColorCycleStrokeLifecycle(
      this.getStrokeLifecycleContext(),
      layerId,
      clearBuffer,
    );
  };

  readonly endStroke = (layerId?: string): void => {
    endColorCycleStrokeLifecycle(this.getStrokeLifecycleContext(), layerId);
  };

  readonly finalizeCurrentStroke = (layerId?: string): void => {
    if (!this.strokeSession.isDrawing()) {
      return;
    }

    const targetLayerId = layerId ?? this.context.getActiveLayerId();
    const strokeData = targetLayerId
      ? this.context.getStrokeData(targetLayerId)
      : undefined;
    if (!strokeData || !this.context.refreshStrokeContent(strokeData)) {
      return;
    }

    try {
      this.endStroke(layerId);
    } catch (error) {
      this.context.warn('[ColorCycleBrush.finalizeCurrentStroke] Failed to end stroke:', error);
    }
  };

  readonly clearCustomStampRuntime = (): void => {
    this.customStampRuntime.clear();
  };

  readonly isDrawing = (): boolean => (
    this.strokeSession.isDrawing()
  );

  readonly setIsDrawing = (isDrawing: boolean): void => {
    this.strokeSession.setDrawing(isDrawing);
  };

  readonly incrementStrokeCounter = (): number => (
    this.strokeSession.incrementStrokeCounter()
  );

  readonly getStrokeCounter = (): number => (
    this.strokeSession.getStrokeCounter()
  );

  readonly setStrokeCounter = (strokeCounter: number): void => {
    this.strokeSession.setStrokeCounter(strokeCounter);
  };

  readonly getStampCounter = (): number => (
    this.strokeSession.getStampCounter()
  );

  readonly resetStampCounter = (): void => {
    this.strokeSession.resetStampCounter();
  };

  readonly advanceStampCounter = (delta: number): number => (
    this.strokeSession.advanceStampCounter(delta)
  );

  readonly resetPerfStroke = (params: { width: number; height: number; brushSize: number }): void => {
    this.strokePerf.reset(params);
  };

  readonly getPerfStroke = (): ReturnType<ColorCycleStrokePerfState['get']> => (
    this.strokePerf.get()
  );

  readonly updateStampPerfBounds = (bounds: { minX: number; minY: number; maxX: number; maxY: number }): void => {
    this.strokePerf.updateStampBounds(bounds);
  };

  readonly logPerfStroke = (layerId: string): void => {
    this.strokePerf.logStroke(layerId);
  };

  private getPaintStrokeContext(): ColorCyclePaintStrokeContext {
    return {
      getActiveLayerId: () => this.context.getActiveLayerId(),
      prepareStrokeContext: (layerId) => this.prepareStrokeContext(layerId),
      applyStrokeFlowSpeed: (strokeData, speedSamplePxPerMs) => {
        this.context.applyStrokeFlowSpeed(strokeData, speedSamplePxPerMs);
      },
      resolveActiveStrokeSlot: (layerId, strokeData) =>
        this.context.resolveActiveStrokeSlot(layerId, strokeData),
      resolveFlowSlot: (strokeData, activeSlot) => this.context.resolveFlowSlot(strokeData, activeSlot),
      isStampDitherEnabled: () => this.context.isStampDitherEnabled(),
      getStampShape: () => this.context.getStampShape(),
      computeColorBandIndex: (strokeData) => this.context.computeColorBandIndex(strokeData),
      getNonDitherStrokeColorIndex: (strokeData) => this.context.getNonDitherStrokeColorIndex(strokeData),
      advanceStrokePhase: (strokeData) => this.context.advanceStrokePhase(strokeData),
      getWriteSpeedByte: (strokeData) => this.context.getWriteSpeedByte(strokeData),
      getFlowMode: () => this.context.getFlowMode(),
      resolvePressureBrushSize: (pressure) => this.context.resolvePressureBrushSize(pressure),
      getGradientBands: () => this.context.getGradientBands(),
      createStampDitherConfig: (options) => this.context.createStampDitherConfig(options),
      getPerfStroke: () => this.getPerfStroke(),
      getStampDitherStrokeData: (strokeData) => this.context.getStampDitherStrokeData(strokeData),
      getStampDitherRuntime: () => this.context.getStampDitherRuntime(),
      ensureStampDitherState: (strokeData) => this.context.ensureStampDitherState(strokeData),
      getWriteCycleSpeed: (strokeData) => this.context.getWriteCycleSpeed(strokeData),
      updateStampPerfBounds: (bounds) => this.updateStampPerfBounds(bounds),
      markStrokeStateContentWritten: (strokeData) => this.context.markStrokeStateContentWritten(strokeData),
      markPresenterLayerDirty: (layerId) => this.context.markPresenterLayerDirty(layerId),
      isAnimating: () => this.context.isAnimating(),
      hasScheduledFrame: () => this.context.hasScheduledFrame(),
      hasConnectedTarget: () => this.context.hasConnectedTarget(),
      forceLayerRender: (layerId) => this.context.forceLayerRender(layerId),
      renderFromDirtyBatches: (dirtyBatches) => this.context.renderFromDirtyBatches(dirtyBatches),
      render: (force) => this.context.render(force),
      scheduleDirtyRender: (options) => this.context.scheduleDirtyRender(options),
      getCanvasWidth: () => this.context.getCanvasWidth(),
      getCanvasHeight: () => this.context.getCanvasHeight(),
    };
  }

  readonly prepareStrokeContext = (
    layerId: string,
  ): ReturnType<ColorCyclePaintStrokeContext['prepareStrokeContext']> => {
    return prepareColorCycleStrokeContext({
      ensureFullResolution: (id, reason) => this.context.ensureStrokeFullResolution(id, reason),
      getStrokeState: (id) => this.context.getStrokeData(id),
      createStrokeState: (options) => this.context.createStrokeState(options),
      setStrokeState: (id, strokeData) => this.context.setStrokeState(id, strokeData),
      bindStrokeBuffersToAnimator: (strokeData, animator) => {
        this.context.bindStrokeBuffersToAnimator(strokeData, animator);
      },
      getCanvasBufferSize: () => this.context.getCanvasWidth() * this.context.getCanvasHeight(),
      getActiveSlot: (id) => this.context.getActiveSlot(id),
    }, layerId);
  };

  private getCustomStampRuntimeDeps(): ColorCycleCustomStampRuntimeDeps {
    return {
      width: this.context.getCanvasWidth(),
      height: this.context.getCanvasHeight(),
      getActiveLayerId: () => this.context.getActiveLayerId(),
      getLayerDocumentVersion: (layerId) => this.context.getLayerDocumentVersion(layerId),
      prepareStrokeContext: (layerId) => this.prepareStrokeContext(layerId),
      applyStrokeFlowSpeed: (strokeData, speed) => {
        this.context.applyStrokeFlowSpeed(strokeData, speed);
      },
      isStampDitherEnabled: () => this.context.isStampDitherEnabled(),
      getWriteSpeedByte: (strokeData) => this.context.getWriteSpeedByte(strokeData),
      getFlowMode: () => this.context.getFlowMode(),
      resolvePressureBrushSize: (pressure) => this.context.resolvePressureBrushSize(pressure),
      advanceStrokePhase: (strokeData) => this.context.advanceStrokePhase(strokeData),
      computeColorBandIndexPerStamp: (strokeData) => this.context.computeColorBandIndex(strokeData),
      getNonDitherStrokeColorIndex: (strokeData) => this.context.getNonDitherStrokeColorIndex(strokeData),
      resolveCapturedStampGradientBinding: (layerId, colorCycle) =>
        this.context.resolveCapturedStampGradientBinding(layerId, colorCycle),
      resolveActiveStrokeSlot: (layerId, strokeData) => this.context.resolveActiveStrokeSlot(layerId, strokeData),
      resolveFlowSlot: (strokeData, activeSlot) => this.context.resolveFlowSlot(strokeData, activeSlot),
      resolveGradientDefIdForSlot: (layerId, slot) => this.context.resolveGradientDefIdForSlot(layerId, slot),
      logSetIndexSample: () => undefined,
      markStrokeStateContentWritten: (strokeData) => this.context.markStrokeStateContentWritten(strokeData),
      getLayerGradientDefs: (layerId) => this.context.getLayerGradientDefs(layerId),
      applyDefBindingsForLayer: (layerId, animator, strokeData, defs, options) => {
        this.context.applyDefBindingsForLayer(layerId, animator, strokeData, defs, options);
      },
      markPresenterLayerDirty: (layerId) => this.context.markPresenterLayerDirty(layerId),
      scheduleDirtyRender: () => {
        this.context.scheduleDirtyRender({
          isAnimating: this.context.isAnimating(),
          forceLayerRender: (dirtyLayerId) => this.context.forceLayerRender(dirtyLayerId),
          render: (dirtyBatches) => this.context.renderFromDirtyBatches(dirtyBatches),
        });
      },
    };
  }

  private getStrokeLifecycleContext(): ColorCycleStrokeLifecycleContext {
    return {
      activeLayerId: this.context.getActiveLayerId(),
      setActiveLayerId: (id) => {
        this.context.setActiveLayerId(id);
      },
      setIsDrawing: (isDrawing) => {
        this.setIsDrawing(isDrawing);
      },
      incrementStrokeCounter: () => this.incrementStrokeCounter(),
      strokeCounter: () => this.getStrokeCounter(),
      resetPerfStroke: () => this.resetPerfStroke({
        width: this.context.getCanvasWidth(),
        height: this.context.getCanvasHeight(),
        brushSize: this.context.getBrushSize(),
      }),
      getPerfStroke: () => this.getPerfStroke(),
      isHistoryRestore: () => this.context.isHistoryRestore(),
      ensureFullResolution: (id, reason) => this.context.ensureStrokeFullResolution(id, reason),
      getStrokeData: (id) => this.context.getStrokeData(id),
      getResolvedWriteCycleSpeed: () => this.context.getResolvedWriteCycleSpeed(),
      getWriteCycleSpeed: (strokeData) => this.context.getWriteCycleSpeed(strokeData),
      bindStrokeBuffersToAnimator: (strokeData, animator) => {
        this.context.bindStrokeBuffersToAnimator(strokeData, animator);
      },
      stampDitherEnabled: () => this.context.isStampDitherEnabled(),
      stampDitherAlgorithm: () => this.context.getStampDitherAlgorithm(),
      stampDitherPixelSize: () => this.context.getStampDitherPixelSize(),
      stampDitherPatternStyle: () => this.context.getStampDitherPatternStyle(),
      getStampDitherImageTileThresholdResolver: () =>
        this.context.getStampDitherImageTileThresholdResolver(),
      stampDitherBgFill: () => this.context.keepsStampDitherBackgroundFill(),
      stampDitherPressureLinked: () => this.context.isStampDitherPressureLinked(),
      ditherStrength: () => this.context.getDitherStrength(),
      flowMode: () => this.context.getFlowMode(),
      width: () => this.context.getCanvasWidth(),
      height: () => this.context.getCanvasHeight(),
      resolveActiveStrokeSlot: (id, strokeData) => this.context.resolveActiveStrokeSlot(id, strokeData),
      resolveFlowSlot: (strokeData, activeSlot) => this.context.resolveFlowSlot(strokeData, activeSlot),
      computeColorBandIndex: (strokeData) => this.context.computeColorBandIndex(strokeData),
      colorAtPosition: (position) => this.context.colorAtPosition(position),
      hashStrokeDitherSeed: (r, g, b, slot, strokeCounter) =>
        this.context.hashStrokeDitherSeed(r, g, b, slot, strokeCounter),
      mutateLayerStrokeState: (mutation) => this.context.mutateLayerStrokeState(mutation),
      ensureStampDitherState: (strokeData) => this.context.ensureStampDitherState(strokeData),
      getStampDitherStrokeData: (strokeData) => this.context.getStampDitherStrokeData(strokeData),
      getStampDitherRuntime: () => this.context.getStampDitherRuntime(),
      assertStrokeHandleSize: (handle, label) => this.context.assertStrokeHandleSize(handle, label),
      isAnimating: () => this.context.isAnimating(),
      enableNonDitherPlaybackSpeed: (strokeData) => this.context.enableNonDitherPlaybackSpeed(strokeData),
      refreshStrokeContent: (strokeData) => this.context.refreshStrokeContent(strokeData),
      logPerfStroke: (id) => this.logPerfStroke(id),
      brushStateHasColorCyclePaintPayload: (brushState, id) =>
        this.context.brushStateHasColorCyclePaintPayload(brushState, id),
      render: (force) => this.context.render(force),
    };
  }
}
