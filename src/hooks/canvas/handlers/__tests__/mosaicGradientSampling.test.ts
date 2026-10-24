import { mosaicBrushPreset } from '@/presets/brushPresets';
import { useAppStore } from '@/stores/useAppStore';
import { BrushShape, type BrushSettings, type Layer } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import { clipLineSegment } from '@/hooks/canvas/utils/lineClipping';
import { getColorCycleBrushFlags } from '@/hooks/canvas/utils/colorCycleBrushFlags';
import { initializeStrokeSamplingState } from '@/hooks/canvas/handlers/strokeSamplingStart';
import {
  processBatchedStrokes,
  type ProcessBatchedStrokesArgs,
  type ProcessBatchedStrokesDeps,
} from '@/hooks/canvas/handlers/strokeBatching';
import { runFinalizeBrushToolFlow } from '@/hooks/canvas/handlers/finalizeBrushToolFlow';
import { computeAutoSampleStops, resetAutoSampleState, sampleHexAt } from '@/hooks/canvas/handlers/brushSampling';

const originalState = useAppStore.getState();
const originalGradient = [
  { position: 0, color: '#ff0000' },
  { position: 0.5, color: '#00ff00' },
  { position: 1, color: '#0000ff' },
];
const sampledGradient = [
  { position: 0, color: '#ff0000' },
  { position: 0.25, color: '#ff0000' },
  { position: 0.5, color: '#0000ff' },
  { position: 0.75, color: '#0000ff' },
  { position: 1, color: '#0000ff' },
];
type Point = { x: number; y: number };
type FinalizeDeps = Parameters<typeof runFinalizeBrushToolFlow>[1];

const createHarness = (settings: Partial<BrushSettings> = {}) => {
  const overlay = document.createElement('canvas');
  const source = document.createElement('canvas');
  overlay.width = source.width = 256;
  overlay.height = source.height = 256;
  const ctx = overlay.getContext('2d');
  const sourceCtx = source.getContext('2d');
  if (!ctx || !sourceCtx) throw new Error('Canvas2D unavailable');
  // Canvas I/O boundary: committed material differs from the held overlay.
  const readSource = jest.spyOn(sourceCtx, 'getImageData').mockImplementation((x, _y, width, height) => {
    const result = new ImageData(width, height);
    result.data.set(x < 128 ? [255, 0, 0, 255] : [0, 0, 255, 255]);
    return result;
  });
  const readOverlay = jest.spyOn(ctx, 'getImageData');
  const layer: Layer = {
    id: 'mosaic-target', name: 'Target', visible: true, opacity: 1,
    blendMode: 'source-over', locked: false, order: 1,
    imageData: new ImageData(256, 256), framebuffer: document.createElement('canvas'),
    alignment: createDefaultLayerAlignment(), layerType: 'normal',
  };
  const sourceLayer: Layer = { ...layer, id: 'source', name: 'Source', order: 0, framebuffer: source };
  useAppStore.setState((state) => ({
    currentBrushPreset: mosaicBrushPreset,
    activeLayerId: layer.id,
    layers: [sourceLayer, layer],
    currentOffscreenCanvas: source,
    tools: { ...state.tools, currentTool: 'brush', shapeMode: false, brushSettings: {
      ...state.tools.brushSettings, brushShape: BrushShape.MOSAIC, size: 60,
      autoSampleGradient: true, autoSampleGradientRealtime: false,
      colorCyclePickupEnabled: false, colorCycleGradient: originalGradient, ...settings,
    } },
  }));
  const storeRef = { current: useAppStore.getState() };
  const unsubscribe = useAppStore.subscribe((state) => { storeRef.current = state; });
  const autoSamplePointsRef = { current: [] as Point[] };
  const autoSampleLastUpdateRef = { current: 99 };
  const autoSampleForkRef = { current: false };
  const brushSamplingPreviewActiveRef = { current: false };
  const renderBrushSamplingPreview = jest.fn();
  const updateCcSampledGradient = jest.fn();
  const updateAutoSampledGradient = jest.fn();
  const drawBrush = jest.fn();
  const args: ProcessBatchedStrokesArgs = {
    strokeBatchRef: { current: [] }, strokeBatchTimerRef: { current: null },
    drawingCtxRef: { current: ctx }, lastDrawPosRef: { current: null },
    lastDrawTimestampRef: { current: null }, brushSamplingPreviewActiveRef,
    autoSamplePointsRef, ccSampledPointsRef: { current: [] },
    resamplerBrushDataRef: { current: undefined }, stampCounterRef: { current: 0 },
    colorCyclePixelQueueRef: { current: null }, colorCycleDistanceRef: { current: 0 },
    colorCycleLastPosRef: { current: null }, colorCycleLastRotationRef: { current: undefined },
    ccFlowVelocityRef: { current: { smoothedPxPerMs: 0 } },
    eraserToolRef: { current: null }, eraserRoiRef: { current: null },
  };
  const batchDeps: ProcessBatchedStrokesDeps = {
    storeRef, project: { width: 256, height: 256 },
    brushRuntime: { drawBrush, drawColorCycle: jest.fn() },
    userBrushEngine: { isUserBrush: () => false, continueStroke: jest.fn() },
    drawEraserSegment: jest.fn(), updateAutoSampledGradient, updateCcSampledGradient,
    renderBrushSamplingPreview, getCCStampTargetCtx: () => null,
    scheduleRecompose: jest.fn(), extendMaskHealingStroke: jest.fn(),
    createPixelQueue: () => { throw new Error('Mosaic must not enter CC pixel queue'); },
    getColorCycleBrushManager: () => { throw new Error('Mosaic must not enter CC manager'); },
    ensureActiveColorCycleGradientSlot: jest.fn(), resolveActiveCustomBrushData: () => undefined,
    getColorCycleBrushFlags, selectEffectiveColorCyclePlaying: () => false,
    shouldPixelAlignBrush: () => false, alignPointToPixel: (point) => point, clipLineSegment,
    shouldDrawStamp: () => true, shouldApplyGridSnapPure: () => false,
    calculateGridSpacing: () => 1, snapToGridPure: (x, y) => ({ x, y }),
    resolveBrushRotation: () => ({ rotation: 0, nextRotation: undefined }),
    captureBrushFromCanvas: () => null, isEraserV2: false,
  };
  const computeStops = jest.fn((sourcePts: Point[], options?: { allowTiny?: boolean }) =>
    computeAutoSampleStops({ sourcePts, options, sampleColor: (x, y) => sampleHexAt({
      x, y, deps: { storeRef, drawingCanvasRef: { current: overlay },
        drawingCtxRef: { current: ctx }, drawingCanvasHasContent: { current: true } },
    }) }));
  const commitRasterOverlay = jest.fn(async () => {});
  const clearBrushSamplingPreview = jest.fn();
  const commitStrokeHistoryIfNeeded = jest.fn(async () => true);
  const finalizeDeps: FinalizeDeps = {
    finalizeBrushContextDeps: {
      ensureColorCycleLayerCanvas: () => ({ state: storeRef.current, activeLayer: layer }),
      resolveStrokeHistoryMetadata: () => ({ actionType: 'brush', description: 'Mosaic stroke' }),
    },
    finalizeColorCycleBrushBaseDeps: {
      storeRef, brushRuntime: { endColorCycleStroke: jest.fn(), renderColorCycle: jest.fn(),
        updateColorCycleGradient: jest.fn() },
      drawingCanvasHasContent: { current: true }, colorCycleAnimationRef: { current: null },
      brushSamplingPreviewActiveRef, autoSamplePointsRef, autoSampleLastUpdateRef,
      autoSampleLastAppliedHashRef: { current: 'existing-cc-hash' }, computeAutoSampleStops: computeStops,
      clearBrushSamplingPreview, getBrushForLayer: jest.fn(),
      getEffectiveColorCyclePlaying: () => false, startPlaybackRef: { current: null },
    },
    colorCycleCommitDeps: {
      getBrushForLayer: jest.fn(), bindBrushToCanvas: jest.fn(), markLayerHasContent: jest.fn(),
      clearEraseMaskInRegion: jest.fn(), perfMark: jest.fn(), perfMeasure: jest.fn(),
      startFinalizeVisibleTimer: jest.fn(), endFinalizeVisibleTimer: jest.fn(), dispatchFrameUpdate: jest.fn(),
    },
    finalizeRasterFallbackDeps: {
      logError: jest.fn(), applyFinalizePolygonLostEdge: jest.fn(), commitRasterOverlay,
      getOverlayCanvas: () => overlay, isDev: false,
    },
    finalizePostCommitDeps: { clearFinalizeOverlayIfNeeded: jest.fn(), commitStrokeHistoryIfNeeded },
  };
  const start = (point: Point = { x: 32, y: 64 }, ccFlags: { isAny: boolean } = getColorCycleBrushFlags(storeRef.current.tools.brushSettings)) => {
    initializeStrokeSamplingState({ currentState: storeRef.current,
      ccFlags, worldPos: point,
      autoSamplePointsRef, autoSampleLastUpdateRef, autoSampleForkRef, brushSamplingPreviewActiveRef,
      renderBrushSamplingPreview, ccSampledPointsRef: args.ccSampledPointsRef,
      ccSampledLastUpdateRef: { current: 0 }, updateCcSampledGradient });
    args.lastDrawPosRef.current = point;
  };
  const move = (points: Point[] = [{ x: 80, y: 64 }, { x: 224, y: 64 }]) => {
    args.strokeBatchRef.current = points.map((pos) => ({ pos, pressure: 1 }));
    processBatchedStrokes(args, batchDeps);
  };
  const finish = () => runFinalizeBrushToolFlow({
    currentState: storeRef.current, activeLayer: layer, drawingCanvas: overlay, drawingCtx: ctx,
    project: { width: 256, height: 256 }, strokeBoundingBox: null, strokeCapturePadding: 0,
    roiPadding: 0, enableCaptureRoi: false, applyFinalizeLostEdge: jest.fn(), skipSave: false,
    layerBeforeImage: layer.imageData, currentTool: 'brush', coalescePayload: undefined,
    captureRoi: undefined, layerBeforeColorState: null, drawingCanvasRef: { current: overlay },
    drawingCtxRef: { current: ctx }, drawingCanvasHasContent: { current: true }, releaseBusyLock: jest.fn(),
  }, finalizeDeps);
  const reset = () => resetAutoSampleState({ storeRef, autoSamplePointsRef,
    autoSampleLastUpdateRef, brushSamplingPreviewActiveRef });
  return { storeRef, unsubscribe, sourceLayer, layer, start, move, finish, reset, args, batchDeps,
    finalizeDeps, computeStops, commitRasterOverlay, commitStrokeHistoryIfNeeded, readSource, readOverlay,
    renderBrushSamplingPreview, updateCcSampledGradient, updateAutoSampledGradient, drawBrush,
    autoSamplePointsRef, autoSampleLastUpdateRef, brushSamplingPreviewActiveRef };
};

describe('Mosaic one-use gradient sampling', () => {
  afterEach(() => { useAppStore.setState(originalState, true); jest.restoreAllMocks(); });

  it.each([false, true])('samples the clean full path before normal commit despite retained CC preferences: %s', async (latentCcPreferences) => {
    const h = createHarness({ colorCyclePickupEnabled: latentCcPreferences,
      autoSampleGradientRealtime: latentCcPreferences });
    try {
      const layersBefore = h.storeRef.current.layers;
      const ccSourceBefore = h.storeRef.current.tools.ccGradientSource;
      h.start();
      h.move();
      expect(h.autoSamplePointsRef.current).toEqual([{ x: 32, y: 64 }, { x: 80, y: 64 }, { x: 224, y: 64 }]);
      expect(h.drawBrush).toHaveBeenCalledTimes(2);
      expect(h.brushSamplingPreviewActiveRef.current).toBe(false);
      expect(h.renderBrushSamplingPreview).not.toHaveBeenCalled();
      expect(h.updateAutoSampledGradient).not.toHaveBeenCalled();
      expect(h.updateCcSampledGradient).not.toHaveBeenCalled();
      h.commitRasterOverlay.mockImplementation(async () => {
        expect(h.storeRef.current.tools.brushSettings.colorCycleGradient).toEqual(sampledGradient);
        expect(h.storeRef.current.tools.brushSettings.autoSampleGradient).toBe(false);
        expect(h.readSource).toHaveBeenCalledTimes(5);
      });
      await h.finish();
      expect(h.computeStops).toHaveBeenCalledWith([{ x: 32, y: 64 }, { x: 80, y: 64 }, { x: 224, y: 64 }], { allowTiny: true });
      expect(h.readOverlay).not.toHaveBeenCalled();
      expect(h.commitRasterOverlay).toHaveBeenCalledWith(expect.objectContaining({
        layer: h.layer, beforeImage: h.layer.imageData, historyAction: 'brush', skipHistory: false, deferHistory: true,
      }));
      expect(h.commitStrokeHistoryIfNeeded).not.toHaveBeenCalled();
      expect(h.storeRef.current.layers).toBe(layersBefore);
      expect(h.storeRef.current.tools.ccGradientSource).toBe(ccSourceBefore);
      expect(h.storeRef.current.tools.brushSettings.colorCyclePickupEnabled).toBe(latentCcPreferences);
      expect(h.storeRef.current.tools.brushSettings.autoSampleGradientRealtime).toBe(latentCcPreferences);
      expect(h.autoSamplePointsRef.current).toEqual([]);
      expect(h.autoSampleLastUpdateRef.current).toBe(0);
      expect(h.finalizeDeps.finalizeColorCycleBrushBaseDeps.autoSampleLastAppliedHashRef.current).toBe('existing-cc-hash');
      expect(h.finalizeDeps.finalizeColorCycleBrushBaseDeps.brushRuntime.endColorCycleStroke).not.toHaveBeenCalled();
      expect(h.finalizeDeps.colorCycleCommitDeps.getBrushForLayer).not.toHaveBeenCalled();
      h.start({ x: 64, y: 192 });
      h.move([{ x: 128, y: 192 }]);
      expect(h.storeRef.current.tools.brushSettings.colorCycleGradient).toEqual(sampledGradient);
      expect(h.autoSamplePointsRef.current).toEqual([]);
      await h.finish();
      expect(h.computeStops).toHaveBeenCalledTimes(1);
      expect(h.commitRasterOverlay).toHaveBeenCalledTimes(2);
    } finally { h.unsubscribe(); }
  });

  it.each([{ points: [] }, { points: [{ x: 32, y: 64 }] }, { points: [{ x: 32, y: 64 }, { x: 32, y: 64 }] }])('does not invent a palette for a degenerate path: $points', async ({ points }) => {
    const h = createHarness();
    try {
      h.start(); h.autoSamplePointsRef.current = points;
      await h.finish();
      expect(h.storeRef.current.tools.brushSettings.colorCycleGradient).toEqual(originalGradient);
      expect(h.storeRef.current.tools.brushSettings.autoSampleGradient).toBe(false);
      expect(h.autoSamplePointsRef.current).toEqual([]);
      expect(h.commitRasterOverlay).toHaveBeenCalledTimes(1);
      expect(h.readSource).not.toHaveBeenCalled();
    } finally { h.unsubscribe(); }
  });

  it('keeps same-palette repeated sampling as an ordinary painted stroke', async () => {
    const h = createHarness({ colorCycleGradient: sampledGradient });
    try {
      h.start(); h.move(); await h.finish();
      expect(h.storeRef.current.tools.brushSettings.colorCycleGradient).toEqual(sampledGradient);
      expect(h.storeRef.current.tools.brushSettings.autoSampleGradient).toBe(false);
      expect(h.commitRasterOverlay).toHaveBeenCalledTimes(1);
      useAppStore.getState().setBrushSettings({ autoSampleGradient: true });
      h.start(); h.move(); await h.finish();
      expect(h.computeStops).toHaveBeenCalledTimes(2);
      expect(h.commitRasterOverlay).toHaveBeenCalledTimes(2);
    } finally { h.unsubscribe(); }
  });

  it('discards cancelled points before a newly armed sampling contact', async () => {
    const h = createHarness();
    try {
      h.start({ x: 240, y: 0 }); h.move([{ x: 240, y: 128 }]); h.reset();
      expect(h.autoSamplePointsRef.current).toEqual([]);
      expect(h.storeRef.current.tools.brushSettings.colorCycleGradient).toEqual(originalGradient);
      expect(h.commitRasterOverlay).not.toHaveBeenCalled();
      useAppStore.getState().setBrushSettings({ autoSampleGradient: true });
      h.start(); h.move(); await h.finish();
      expect(h.computeStops).toHaveBeenLastCalledWith([{ x: 32, y: 64 }, { x: 80, y: 64 }, { x: 224, y: 64 }], { allowTiny: true });
      expect(h.storeRef.current.tools.brushSettings.colorCycleGradient).toEqual(sampledGradient);
    } finally { h.unsubscribe(); }
  });

  it('retains the palette and normal commit if the sampling read fails', async () => {
    const h = createHarness();
    try {
      h.start(); h.move();
      h.computeStops.mockImplementation(() => { throw new Error('Canvas read unavailable'); });
      await h.finish();
      expect(h.storeRef.current.tools.brushSettings.colorCycleGradient).toEqual(originalGradient);
      expect(h.storeRef.current.tools.brushSettings.autoSampleGradient).toBe(false);
      expect(h.autoSamplePointsRef.current).toEqual([]);
      expect(h.commitRasterOverlay).toHaveBeenCalledTimes(1);
    } finally { h.unsubscribe(); }
  });

  it('gives explicit CC pickup classification priority over a stale Mosaic brush shape', () => {
    const h = createHarness({ colorCyclePickupEnabled: true, autoSampleGradientRealtime: true });
    try {
      useAppStore.setState((state) => ({ tools: { ...state.tools, ccGradientSource: 'sampled' } }));
      h.batchDeps.getColorCycleBrushFlags = () => ({ isAny: true, isCustom: false });
      h.start({ x: 32, y: 64 }, { isAny: true });
      expect(h.autoSamplePointsRef.current).toEqual([]);
      expect(h.renderBrushSamplingPreview).not.toHaveBeenCalled();
      expect(h.updateCcSampledGradient).toHaveBeenCalledWith([{ x: 32, y: 64 }], { markKind: 'stroke' });
      h.move();
      expect(h.autoSamplePointsRef.current).toEqual([]);
      expect(h.updateAutoSampledGradient).not.toHaveBeenCalled();
      expect(h.drawBrush).not.toHaveBeenCalled();
      expect(h.args.ccSampledPointsRef.current).toEqual([{ x: 32, y: 64 }, { x: 80, y: 64 }, { x: 224, y: 64 }]);
    } finally { h.unsubscribe(); }
  });

  it('keeps Color Cycle one-use preview admission unchanged', () => {
    const h = createHarness({ brushShape: BrushShape.COLOR_CYCLE });
    try {
      h.start(); h.move();
      expect(h.autoSamplePointsRef.current).toEqual([{ x: 32, y: 64 }, { x: 80, y: 64 }, { x: 224, y: 64 }]);
      expect(h.brushSamplingPreviewActiveRef.current).toBe(true);
      expect(h.renderBrushSamplingPreview).toHaveBeenCalledTimes(3);
      expect(h.updateAutoSampledGradient).not.toHaveBeenCalled();
      expect(h.drawBrush).not.toHaveBeenCalled();
    } finally { h.unsubscribe(); }
  });
});
