import { setFeatureFlag } from '@/config/featureFlags';
import type { PixelQueue } from '@/hooks/brushEngine/types';
import {
  __TESTING__ as sequentialCaptureTesting,
  flushBufferedSequentialEvents,
} from '@/hooks/canvas/handlers/sequential/sequentialCapture';
import { startBrushToolStroke } from '@/hooks/canvas/handlers/startBrushToolStroke';
import { processBatchedStrokes, type ProcessBatchedStrokesArgs, type ProcessBatchedStrokesDeps } from '@/hooks/canvas/handlers/strokeBatching';
import { useAppStore, type AppState } from '@/stores/useAppStore';
import { BrushShape, type Layer } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

const createLayer = (): Layer => {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  return {
    id: 'layer-seq',
    name: 'Sequential',
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    locked: false,
    order: 0,
    imageData: null,
    framebuffer: canvas,
    alignment: createDefaultLayerAlignment(),
    layerType: 'sequential',
    sequentialData: {
      frameCount: 12,
      fps: 12,
      durationMs: 1000,
      events: [],
    },
  };
};

const createPixelQueue = (): PixelQueue => ({
  initialized: false,
  lastDrawnX: 0,
  lastDrawnY: 0,
  waitingPixelX: 0,
  waitingPixelY: 0,
  spacingCounter: 0,
  lastStrokePosition: { x: 0, y: 0 },
  accumulatedDistance: 0,
  stampedGridPositions: new Set<string>(),
  dashPhasePx: 0,
  dashVelocityEma: 0,
  dashStampCounter: 0,
  drawnPixels: new Set<string>(),
  enqueue: (fn: () => void) => fn(),
  flushNow: () => {},
  onIdle: () => {},
});

const createSequentialState = (): AppState => {
  const layer = createLayer();
  useAppStore.setState((state) => ({
    colorCyclePlayback: {
      ...state.colorCyclePlayback,
      desiredPlaying: true,
      suspendDepth: 0,
    },
    layers: [layer],
    activeLayerId: layer.id,
    sequentialRecord: {
      ...state.sequentialRecord,
      fps: 12,
      frameCount: 12,
      timeSmear: 1,
      currentFrame: 2,
      durationMs: 1000,
      isPointerDown: true,
      isCaptureActive: true,
      sessionStartMs: 1000,
    },
    tools: {
      ...state.tools,
      currentTool: 'brush',
      brushSettings: {
        ...state.tools.brushSettings,
        brushShape: BrushShape.COLOR_CYCLE,
        size: 6,
        opacity: 0.8,
        spacing: 1,
        color: '#00ff00',
        blendMode: 'source-over',
      },
    },
    ui: {
      ...state.ui,
      notifications: [],
    },
  }));
  return useAppStore.getState();
};

const createPausedSequentialState = (): AppState => {
  const layer = createLayer();
  useAppStore.setState((state) => ({
    colorCyclePlayback: {
      ...state.colorCyclePlayback,
      desiredPlaying: false,
      suspendDepth: 0,
    },
    layers: [layer],
    activeLayerId: layer.id,
    sequentialRecord: {
      ...state.sequentialRecord,
      fps: 12,
      frameCount: 12,
      timeSmear: 1,
      currentFrame: 2,
      durationMs: 1000,
      isPointerDown: true,
      isCaptureActive: false,
      sessionStartMs: 1000,
    },
    tools: {
      ...state.tools,
      currentTool: 'brush',
      brushSettings: {
        ...state.tools.brushSettings,
        brushShape: BrushShape.COLOR_CYCLE,
        size: 6,
        opacity: 0.8,
        spacing: 1,
        color: '#00ff00',
        blendMode: 'source-over',
      },
    },
    ui: {
      ...state.ui,
      notifications: [],
    },
  }));
  return useAppStore.getState();
};

const createColorCycleState = (): AppState => {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;

  const layer: Layer = {
    id: 'layer-cc',
    name: 'Color Cycle',
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    locked: false,
    order: 0,
    imageData: null,
    framebuffer: canvas,
    alignment: createDefaultLayerAlignment(),
    layerType: 'color-cycle',
    colorCycleData: {
      canvas,
      hasContent: true,
      gradient: [
        { position: 0, color: '#000000' },
        { position: 1, color: '#ffffff' },
      ],
    },
  };

  useAppStore.setState((state) => ({
    colorCyclePlayback: {
      ...state.colorCyclePlayback,
      desiredPlaying: true,
      suspendDepth: 0,
    },
    layers: [layer],
    activeLayerId: layer.id,
    tools: {
      ...state.tools,
      currentTool: 'brush',
      brushSettings: {
        ...state.tools.brushSettings,
        brushShape: BrushShape.COLOR_CYCLE,
        size: 8,
        opacity: 1,
        spacing: 1,
        color: '#00ff00',
        blendMode: 'source-over',
      },
    },
  }));

  return useAppStore.getState();
};

describe('sequential color-cycle routing', () => {
  beforeEach(() => {
    sequentialCaptureTesting.resetDefaultRuntime();
    setFeatureFlag('enableSequentialRecordMode', true);
  });

  afterEach(() => {
    setFeatureFlag('enableSequentialRecordMode', false);
  });

  it('starts color-cycle stroke on sequential layer and captures canonical stamps', () => {
    const currentState = createSequentialState();
    const drawCtx = document.createElement('canvas').getContext('2d');
    if (!drawCtx) {
      throw new Error('2d context unavailable');
    }

    const drawColorCycle = jest.fn();
    const colorCycleLastPosRef = { current: null as { x: number; y: number } | null };
    const colorCycleDistanceRef = { current: 0 };
    const colorCycleLastRotationRef = { current: undefined as number | undefined };

    startBrushToolStroke({
      currentState,
      currentBrushId: null,
      worldPos: { x: 4, y: 5 },
      pressure: 0.7,
      drawCtx,
      userBrushEngine: {
        isUserBrush: () => false,
        setActiveBrush: jest.fn(),
        startStroke: jest.fn(),
      },
      brushEngine: {
        drawColorCycle,
        drawBrush: jest.fn(),
      },
      resolveCustomBrushData: () => undefined,
      captureResamplerSingleSample: jest.fn(),
      resamplerBrushDataRef: { current: undefined },
      colorCyclePixelQueue: { current: null },
      createPixelQueue,
      scheduleRecompose: jest.fn(),
      colorCycleLastPosRef,
      colorCycleDistanceRef,
      colorCycleLastRotationRef,
      getCCStampTargetCtx: () => null,
      resolveBrushRotation: () => ({ rotation: 0, nextRotation: 0 }),
      getColorCycleBrushManager: () => ({ getBrush: () => null }),
      ensureActiveColorCycleGradientSlot: jest.fn(),
      debugLog: jest.fn(),
      beginMaskHealingStroke: jest.fn(),
    });

    expect(drawColorCycle).toHaveBeenCalledTimes(1);
    expect(colorCycleLastPosRef.current).toEqual({ x: 4, y: 5 });
    flushBufferedSequentialEvents({ state: useAppStore.getState() });
    const layer = useAppStore.getState().layers.find((entry) => entry.id === 'layer-seq');
    const events = layer?.sequentialData?.events ?? [];
    expect(events).toHaveLength(1);
    expect(events[0].brush.brushShape).toBe(BrushShape.COLOR_CYCLE);
    expect(events[0].stamps).toHaveLength(1);
  });

  it('captures sequential strokes on sequential layer even when playback is paused', () => {
    const currentState = createPausedSequentialState();
    const drawCtx = document.createElement('canvas').getContext('2d');
    if (!drawCtx) {
      throw new Error('2d context unavailable');
    }

    const drawColorCycle = jest.fn();

    startBrushToolStroke({
      currentState,
      currentBrushId: null,
      worldPos: { x: 4, y: 5 },
      pressure: 0.7,
      drawCtx,
      userBrushEngine: {
        isUserBrush: () => false,
        setActiveBrush: jest.fn(),
        startStroke: jest.fn(),
      },
      brushEngine: {
        drawColorCycle,
        drawBrush: jest.fn(),
      },
      resolveCustomBrushData: () => undefined,
      captureResamplerSingleSample: jest.fn(),
      resamplerBrushDataRef: { current: undefined },
      colorCyclePixelQueue: { current: null },
      createPixelQueue,
      scheduleRecompose: jest.fn(),
      colorCycleLastPosRef: { current: null },
      colorCycleDistanceRef: { current: 0 },
      colorCycleLastRotationRef: { current: undefined },
      getCCStampTargetCtx: () => null,
      resolveBrushRotation: () => ({ rotation: 0, nextRotation: 0 }),
      getColorCycleBrushManager: () => ({ getBrush: () => null }),
      ensureActiveColorCycleGradientSlot: jest.fn(),
      debugLog: jest.fn(),
      beginMaskHealingStroke: jest.fn(),
    });

    expect(drawColorCycle).toHaveBeenCalledTimes(1);
    flushBufferedSequentialEvents({ state: useAppStore.getState() });
    const layer = useAppStore.getState().layers.find((entry) => entry.id === 'layer-seq');
    const events = layer?.sequentialData?.events ?? [];
    expect(events).toHaveLength(1);
  });

  it('captures sequential stamp from latest store state even when start snapshot is stale', () => {
    const currentState = createSequentialState();
    const staleState = {
      ...currentState,
      sequentialRecord: {
        ...currentState.sequentialRecord,
        isPointerDown: false,
        isCaptureActive: false,
      },
    };
    const drawCtx = document.createElement('canvas').getContext('2d');
    if (!drawCtx) {
      throw new Error('2d context unavailable');
    }

    startBrushToolStroke({
      currentState: staleState,
      currentBrushId: 'user-brush',
      worldPos: { x: 6, y: 7 },
      pressure: 0.7,
      drawCtx,
      userBrushEngine: {
        isUserBrush: () => true,
        setActiveBrush: jest.fn(),
        startStroke: jest.fn(),
      },
      brushEngine: {
        drawColorCycle: jest.fn(),
        drawBrush: jest.fn(),
      },
      resolveCustomBrushData: () => undefined,
      captureResamplerSingleSample: jest.fn(),
      resamplerBrushDataRef: { current: undefined },
      colorCyclePixelQueue: { current: null },
      createPixelQueue,
      scheduleRecompose: jest.fn(),
      colorCycleLastPosRef: { current: null },
      colorCycleDistanceRef: { current: 0 },
      colorCycleLastRotationRef: { current: undefined },
      getCCStampTargetCtx: () => null,
      resolveBrushRotation: () => ({ rotation: 0, nextRotation: 0 }),
      getColorCycleBrushManager: () => ({ getBrush: () => null }),
      ensureActiveColorCycleGradientSlot: jest.fn(),
      debugLog: jest.fn(),
      beginMaskHealingStroke: jest.fn(),
    });

    flushBufferedSequentialEvents({ state: useAppStore.getState() });
    const layer = useAppStore.getState().layers.find((entry) => entry.id === 'layer-seq');
    expect(layer?.sequentialData?.events ?? []).toHaveLength(1);
  });

  it('continues color-cycle stroke batches on sequential layer and appends sequential events', () => {
    createSequentialState();
    const drawCtx = document.createElement('canvas').getContext('2d');
    if (!drawCtx) {
      throw new Error('2d context unavailable');
    }

    const drawColorCycle = jest.fn();
    const args: ProcessBatchedStrokesArgs = {
      strokeBatchRef: {
        current: [
          { pos: { x: 0, y: 0 }, pressure: 1 },
          { pos: { x: 8, y: 0 }, pressure: 1 },
        ],
      },
      strokeBatchTimerRef: { current: 1 },
      drawingCtxRef: { current: drawCtx },
      lastDrawPosRef: { current: { x: 0, y: 0 } },
      lastDrawTimestampRef: { current: null },
      brushSamplingPreviewActiveRef: { current: false },
      autoSamplePointsRef: { current: [] },
      ccSampledPointsRef: { current: [] },
      resamplerBrushDataRef: { current: undefined },
      stampCounterRef: { current: 0 },
      colorCyclePixelQueueRef: { current: null },
      colorCycleDistanceRef: { current: 0 },
      colorCycleLastPosRef: { current: { x: 0, y: 0 } },
      colorCycleLastRotationRef: { current: 0 },
      eraserToolRef: { current: null },
      eraserRoiRef: { current: null },
    };

    const deps: ProcessBatchedStrokesDeps = {
      storeRef: { current: useAppStore.getState() },
      project: { width: 32, height: 32 },
      brushEngine: {
        drawBrush: jest.fn(),
        consumeRecentStamps: jest.fn(() => []),
        drawColorCycle,
      },
      userBrushEngine: {
        isUserBrush: () => false,
        continueStroke: jest.fn(),
      },
      drawEraserSegment: jest.fn(),
      updateAutoSampledGradient: jest.fn(),
      updateCcSampledGradient: jest.fn(),
      renderBrushSamplingPreview: jest.fn(),
      getCCStampTargetCtx: () => null,
      scheduleRecompose: jest.fn(),
      extendMaskHealingStroke: jest.fn(),
      createPixelQueue,
      getColorCycleBrushManager: () => ({ getBrush: () => null }),
      ensureActiveColorCycleGradientSlot: jest.fn(),
      resolveActiveCustomBrushData: () => undefined,
      getColorCycleBrushFlags: () => ({ isAny: true, isCustom: false }),
      selectEffectiveColorCyclePlaying: () => true,
      shouldPixelAlignBrush: () => false,
      alignPointToPixel: (point) => point,
      clipLineSegment: (start, end) => [start, end],
      shouldDrawStamp: () => true,
      shouldApplyGridSnapPure: () => false,
      calculateGridSpacing: () => 1,
      snapToGridPure: (x, y) => ({ x, y }),
      resolveBrushRotation: () => ({ rotation: 0, nextRotation: 0 }),
      captureBrushFromCanvas: jest.fn(() => null),
      isEraserV2: false,
    };

    processBatchedStrokes(args, deps);

    expect(drawColorCycle).toHaveBeenCalled();
    flushBufferedSequentialEvents({ state: useAppStore.getState() });
    const layer = useAppStore.getState().layers.find((entry) => entry.id === 'layer-seq');
    const events = layer?.sequentialData?.events ?? [];
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].brush.brushShape).toBe(BrushShape.COLOR_CYCLE);
  });

  it('keeps custom sequential stamps painting when live custom brush lookup temporarily drops', () => {
    createSequentialState();
    useAppStore.setState((state) => ({
      tools: {
        ...state.tools,
        brushSettings: {
          ...state.tools.brushSettings,
          brushShape: BrushShape.CUSTOM,
          size: 12,
          opacity: 1,
          spacing: 1,
          color: '#ff00aa',
        },
      },
    }));

    const drawCtx = document.createElement('canvas').getContext('2d');
    if (!drawCtx) {
      throw new Error('2d context unavailable');
    }

    const customBrushData = {
      imageData: new ImageData(
        new Uint8ClampedArray([
          255, 255, 255, 255,
          255, 255, 255, 255,
          255, 255, 255, 255,
          255, 255, 255, 255,
        ]),
        2,
        2
      ),
      width: 2,
      height: 2,
      isColorizable: true,
      cacheKey: 'test-custom-tip',
    };

    const drawBrush = jest.fn();
    const args: ProcessBatchedStrokesArgs = {
      strokeBatchRef: {
        current: [
          { pos: { x: 2, y: 2 }, pressure: 1 },
          { pos: { x: 9, y: 2 }, pressure: 1 },
        ],
      },
      strokeBatchTimerRef: { current: 1 },
      drawingCtxRef: { current: drawCtx },
      lastDrawPosRef: { current: { x: 2, y: 2 } },
      lastDrawTimestampRef: { current: null },
      brushSamplingPreviewActiveRef: { current: false },
      autoSamplePointsRef: { current: [] },
      ccSampledPointsRef: { current: [] },
      resamplerBrushDataRef: { current: customBrushData },
      stampCounterRef: { current: 0 },
      colorCyclePixelQueueRef: { current: null },
      colorCycleDistanceRef: { current: 0 },
      colorCycleLastPosRef: { current: { x: 2, y: 2 } },
      colorCycleLastRotationRef: { current: 0 },
      eraserToolRef: { current: null },
      eraserRoiRef: { current: null },
    };

    const deps: ProcessBatchedStrokesDeps = {
      storeRef: { current: useAppStore.getState() },
      project: { width: 32, height: 32 },
      brushEngine: {
        drawBrush,
        consumeRecentStamps: jest.fn(() => []),
        drawColorCycle: jest.fn(),
      },
      userBrushEngine: {
        isUserBrush: () => false,
        continueStroke: jest.fn(),
      },
      drawEraserSegment: jest.fn(),
      updateAutoSampledGradient: jest.fn(),
      updateCcSampledGradient: jest.fn(),
      renderBrushSamplingPreview: jest.fn(),
      getCCStampTargetCtx: () => null,
      scheduleRecompose: jest.fn(),
      extendMaskHealingStroke: jest.fn(),
      createPixelQueue,
      getColorCycleBrushManager: () => ({ getBrush: () => null }),
      ensureActiveColorCycleGradientSlot: jest.fn(),
      resolveActiveCustomBrushData: () => undefined,
      getColorCycleBrushFlags: () => ({ isAny: false, isCustom: false }),
      selectEffectiveColorCyclePlaying: () => true,
      shouldPixelAlignBrush: () => false,
      alignPointToPixel: (point) => point,
      clipLineSegment: (start, end) => [start, end],
      shouldDrawStamp: () => true,
      shouldApplyGridSnapPure: () => false,
      calculateGridSpacing: () => 1,
      snapToGridPure: (x, y) => ({ x, y }),
      resolveBrushRotation: () => ({ rotation: 0, nextRotation: 0 }),
      captureBrushFromCanvas: jest.fn(() => null),
      isEraserV2: false,
    };

    processBatchedStrokes(args, deps);

    expect(drawBrush).toHaveBeenCalled();
    expect(drawBrush.mock.calls[0]?.[3]?.customBrushData).toEqual(customBrushData);

    flushBufferedSequentialEvents({ state: useAppStore.getState() });
    const layer = useAppStore.getState().layers.find((entry) => entry.id === 'layer-seq');
    const events = layer?.sequentialData?.events ?? [];
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].brush.brushShape).toBe(BrushShape.CUSTOM);
    expect(events[0].brush.customStamp).toBeTruthy();
  });

  it('skips CC mask healing when stamp target context is unavailable', () => {
    createColorCycleState();
    const drawCtx = document.createElement('canvas').getContext('2d');
    if (!drawCtx) {
      throw new Error('2d context unavailable');
    }

    const extendMaskHealingStroke = jest.fn();
    const drawColorCycle = jest.fn();
    const args: ProcessBatchedStrokesArgs = {
      strokeBatchRef: {
        current: [
          { pos: { x: 1, y: 1 }, pressure: 1 },
          { pos: { x: 10, y: 1 }, pressure: 1 },
        ],
      },
      strokeBatchTimerRef: { current: 1 },
      drawingCtxRef: { current: drawCtx },
      lastDrawPosRef: { current: { x: 1, y: 1 } },
      lastDrawTimestampRef: { current: null },
      brushSamplingPreviewActiveRef: { current: false },
      autoSamplePointsRef: { current: [] },
      ccSampledPointsRef: { current: [] },
      resamplerBrushDataRef: { current: undefined },
      stampCounterRef: { current: 0 },
      colorCyclePixelQueueRef: { current: null },
      colorCycleDistanceRef: { current: 0 },
      colorCycleLastPosRef: { current: { x: 1, y: 1 } },
      colorCycleLastRotationRef: { current: 0 },
      eraserToolRef: { current: null },
      eraserRoiRef: { current: null },
    };

    const deps: ProcessBatchedStrokesDeps = {
      storeRef: { current: useAppStore.getState() },
      project: { width: 32, height: 32 },
      brushEngine: {
        drawBrush: jest.fn(),
        consumeRecentStamps: jest.fn(() => []),
        drawColorCycle,
      },
      userBrushEngine: {
        isUserBrush: () => false,
        continueStroke: jest.fn(),
      },
      drawEraserSegment: jest.fn(),
      updateAutoSampledGradient: jest.fn(),
      updateCcSampledGradient: jest.fn(),
      renderBrushSamplingPreview: jest.fn(),
      getCCStampTargetCtx: () => null,
      scheduleRecompose: jest.fn(),
      extendMaskHealingStroke,
      createPixelQueue,
      getColorCycleBrushManager: () => ({ getBrush: () => null }),
      ensureActiveColorCycleGradientSlot: jest.fn(),
      resolveActiveCustomBrushData: () => undefined,
      getColorCycleBrushFlags: () => ({ isAny: true, isCustom: false }),
      selectEffectiveColorCyclePlaying: () => true,
      shouldPixelAlignBrush: () => false,
      alignPointToPixel: (point) => point,
      clipLineSegment: (start, end) => [start, end],
      shouldDrawStamp: () => true,
      shouldApplyGridSnapPure: () => false,
      calculateGridSpacing: () => 1,
      snapToGridPure: (x, y) => ({ x, y }),
      resolveBrushRotation: () => ({ rotation: 0, nextRotation: 0 }),
      captureBrushFromCanvas: jest.fn(() => null),
      isEraserV2: false,
    };

    processBatchedStrokes(args, deps);

    expect(extendMaskHealingStroke).not.toHaveBeenCalled();
    expect(drawColorCycle).not.toHaveBeenCalled();
  });

  it('skips CC mask healing when clipping rejects the movement segment', () => {
    createColorCycleState();
    const drawCtx = document.createElement('canvas').getContext('2d');
    if (!drawCtx) {
      throw new Error('2d context unavailable');
    }

    const extendMaskHealingStroke = jest.fn();
    const args: ProcessBatchedStrokesArgs = {
      strokeBatchRef: {
        current: [
          { pos: { x: 3, y: 3 }, pressure: 0.5 },
          { pos: { x: 9, y: 3 }, pressure: 0.75 },
        ],
      },
      strokeBatchTimerRef: { current: 1 },
      drawingCtxRef: { current: drawCtx },
      lastDrawPosRef: { current: { x: 3, y: 3 } },
      lastDrawTimestampRef: { current: null },
      brushSamplingPreviewActiveRef: { current: false },
      autoSamplePointsRef: { current: [] },
      ccSampledPointsRef: { current: [] },
      resamplerBrushDataRef: { current: undefined },
      stampCounterRef: { current: 0 },
      colorCyclePixelQueueRef: { current: null },
      colorCycleDistanceRef: { current: 0 },
      colorCycleLastPosRef: { current: { x: 3, y: 3 } },
      colorCycleLastRotationRef: { current: 0 },
      eraserToolRef: { current: null },
      eraserRoiRef: { current: null },
    };

    const deps: ProcessBatchedStrokesDeps = {
      storeRef: { current: useAppStore.getState() },
      project: { width: 32, height: 32 },
      brushEngine: {
        drawBrush: jest.fn(),
        consumeRecentStamps: jest.fn(() => []),
        drawColorCycle: jest.fn(),
      },
      userBrushEngine: {
        isUserBrush: () => false,
        continueStroke: jest.fn(),
      },
      drawEraserSegment: jest.fn(),
      updateAutoSampledGradient: jest.fn(),
      updateCcSampledGradient: jest.fn(),
      renderBrushSamplingPreview: jest.fn(),
      getCCStampTargetCtx: () => null,
      scheduleRecompose: jest.fn(),
      extendMaskHealingStroke,
      createPixelQueue,
      getColorCycleBrushManager: () => ({ getBrush: () => null }),
      ensureActiveColorCycleGradientSlot: jest.fn(),
      resolveActiveCustomBrushData: () => undefined,
      getColorCycleBrushFlags: () => ({ isAny: true, isCustom: false }),
      selectEffectiveColorCyclePlaying: () => true,
      shouldPixelAlignBrush: () => false,
      alignPointToPixel: (point) => point,
      clipLineSegment: () => null,
      shouldDrawStamp: () => true,
      shouldApplyGridSnapPure: () => false,
      calculateGridSpacing: () => 1,
      snapToGridPure: (x, y) => ({ x, y }),
      resolveBrushRotation: () => ({ rotation: 0, nextRotation: 0 }),
      captureBrushFromCanvas: jest.fn(() => null),
      isEraserV2: false,
    };

    processBatchedStrokes(args, deps);

    expect(extendMaskHealingStroke).not.toHaveBeenCalled();
    expect(deps.scheduleRecompose).not.toHaveBeenCalled();
  });

  it('expands clipping bounds by brush radius to keep edge strokes continuous', () => {
    createSequentialState();
    useAppStore.setState((state) => ({
      tools: {
        ...state.tools,
        currentTool: 'brush',
        brushSettings: {
          ...state.tools.brushSettings,
          brushShape: BrushShape.ROUND,
          size: 20,
        },
      },
    }));

    const drawCtx = document.createElement('canvas').getContext('2d');
    if (!drawCtx) {
      throw new Error('2d context unavailable');
    }

    const clipLineSegment = jest.fn<
      ReturnType<ProcessBatchedStrokesDeps['clipLineSegment']>,
      Parameters<ProcessBatchedStrokesDeps['clipLineSegment']>
    >(() => null);
    const args: ProcessBatchedStrokesArgs = {
      strokeBatchRef: {
        current: [
          { pos: { x: 2, y: 2 }, pressure: 0.5 },
          { pos: { x: -6, y: 4 }, pressure: 0.5 },
        ],
      },
      strokeBatchTimerRef: { current: 1 },
      drawingCtxRef: { current: drawCtx },
      lastDrawPosRef: { current: { x: 2, y: 2 } },
      lastDrawTimestampRef: { current: null },
      brushSamplingPreviewActiveRef: { current: false },
      autoSamplePointsRef: { current: [] },
      ccSampledPointsRef: { current: [] },
      resamplerBrushDataRef: { current: undefined },
      stampCounterRef: { current: 0 },
      colorCyclePixelQueueRef: { current: null },
      colorCycleDistanceRef: { current: 0 },
      colorCycleLastPosRef: { current: { x: 2, y: 2 } },
      colorCycleLastRotationRef: { current: 0 },
      eraserToolRef: { current: null },
      eraserRoiRef: { current: null },
    };

    const deps: ProcessBatchedStrokesDeps = {
      storeRef: { current: useAppStore.getState() },
      project: { width: 32, height: 32 },
      brushEngine: {
        drawBrush: jest.fn(),
        consumeRecentStamps: jest.fn(() => []),
        drawColorCycle: jest.fn(),
      },
      userBrushEngine: {
        isUserBrush: () => false,
        continueStroke: jest.fn(),
      },
      drawEraserSegment: jest.fn(),
      updateAutoSampledGradient: jest.fn(),
      updateCcSampledGradient: jest.fn(),
      renderBrushSamplingPreview: jest.fn(),
      getCCStampTargetCtx: () => null,
      scheduleRecompose: jest.fn(),
      extendMaskHealingStroke: jest.fn(),
      createPixelQueue,
      getColorCycleBrushManager: () => ({ getBrush: () => null }),
      ensureActiveColorCycleGradientSlot: jest.fn(),
      resolveActiveCustomBrushData: () => undefined,
      getColorCycleBrushFlags: () => ({ isAny: false, isCustom: false }),
      selectEffectiveColorCyclePlaying: () => true,
      shouldPixelAlignBrush: () => false,
      alignPointToPixel: (point) => point,
      clipLineSegment,
      shouldDrawStamp: () => true,
      shouldApplyGridSnapPure: () => false,
      calculateGridSpacing: () => 1,
      snapToGridPure: (x, y) => ({ x, y }),
      resolveBrushRotation: () => ({ rotation: 0, nextRotation: 0 }),
      captureBrushFromCanvas: jest.fn(() => null),
      isEraserV2: false,
    };

    processBatchedStrokes(args, deps);

    expect(clipLineSegment).toHaveBeenCalled();
    expect(clipLineSegment.mock.calls[0]?.[2]).toEqual({
      x: -12,
      y: -12,
      width: 56,
      height: 56,
    });
  });
});
