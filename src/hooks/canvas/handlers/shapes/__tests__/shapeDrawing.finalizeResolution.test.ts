import type React from 'react';

import { BrushShape } from '@/types';
import type { AppState } from '@/stores/useAppStore';
import {
  __TESTING__,
  finalizeShapeDrawing,
  continueShapeDrawing,
  startShapeDrawing,
} from '@/hooks/canvas/handlers/shapes/shapeDrawing';
import {
  beginMarkGradientSession,
  cancelMarkGradientSession,
  getActiveMarkGradientSession,
} from '@/hooks/canvas/utils/colorCycleMarkSession';

const storeState = {
  activeLayerId: 'layer-1',
  layers: [] as Array<Record<string, unknown>>,
  tools: {
    currentTool: 'brush',
    brushSettings: {
      brushShape: BrushShape.COLOR_CYCLE_SHAPE,
      colorCycleFillMode: 'linear',
      fillResolution: 7,
      pressureLinkedFillResolution: false,
      ditherEnabled: true,
      gradientBands: 8,
      ditherAlgorithm: 'pattern',
      patternStyle: 'dots',
      colorCycleGradient: [
        { position: 0, color: '#000000' },
        { position: 1, color: '#ffffff' },
      ],
      color: '#000000',
      opacity: 1,
      blendMode: 'source-over',
    },
  },
  polygonGradientState: { drawingState: 'idle', points: [] },
  palette: { foregroundColor: '#000000', backgroundColor: '#ffffff' },
  project: { width: 64, height: 64 },
  setShapeDrawing: jest.fn(),
  updateLayer: jest.fn(),
} as unknown as AppState;

jest.mock('@/stores/useAppStore', () => {
  const mock = (selector?: (state: AppState) => unknown) => (selector ? selector(storeState) : storeState);
  mock.getState = () => storeState;
  return { useAppStore: mock };
});

const makeContext = () => ({
  clearRect: jest.fn(),
}) as unknown as CanvasRenderingContext2D;

const makePreviewContext = () => {
  const gradient = {
    addColorStop: jest.fn(),
  };
  const ctx = {
    beginPath: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    closePath: jest.fn(),
    clip: jest.fn(),
    fillRect: jest.fn(),
    save: jest.fn(),
    restore: jest.fn(),
    createLinearGradient: jest.fn(() => gradient),
    fillStyle: null as CanvasGradient | string | null,
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, gradient };
};

const makeShapeBrushRuntime = () => ({
  updateConfig: jest.fn(),
  fillCcGradientLinear: jest.fn(),
  fillCcGradientConcentric: jest.fn(),
  updateColorCycleTexture: jest.fn(),
  applyStrokeDither: jest.fn(),
  updateColorCycleGradient: jest.fn(),
  resetColorCycle: jest.fn(),
});

const ref = <T,>(current: T): React.MutableRefObject<T> => ({ current });

const makeShapeRefs = () => ({
  isDrawingShapeRef: ref(false),
  isSelectingDirectionRef: ref(false),
  directionPreviewRef: ref<{ x: number; y: number } | null>(null),
  shapePointsRef: ref<Array<{ x: number; y: number }>>([]),
  ccStrokeSamplesRef: ref([]),
  ccStrokeDirectionRef: ref<{ x: number; y: number } | null>(null),
  ccGradientDrawingGeometryRef: ref(null),
  ccGradientClickLineSessionRef: ref({ active: false, points: [], previewPoint: null, finalizeOnPointerUp: false }),
  shapeDragStartRef: ref<{ x: number; y: number } | null>(null),
  shapeDragLastRef: ref<{ x: number; y: number } | null>(null),
  shapeDragMovedRef: ref(false),
  shapeInteractionPhaseRef: ref('idle'),
  latestShapePressureRef: ref(0),
  lastStablePressureRef: ref(0.5),
  shapeBeforeImageRef: ref(null),
  strokeBoundingBoxRef: ref(null),
  strokeCapturePaddingRef: ref(0),
  drawingCtxRef: ref(null),
  drawingCanvasRef: ref(null),
  drawingCanvasHasContent: ref(false),
  autoSamplePointsRef: ref<Array<{ x: number; y: number }>>([]),
  autoSampleForkRef: ref(false),
  autoSampleLastUpdateRef: ref(0),
  ccSampledPointsRef: ref<Array<{ x: number; y: number }>>([]),
  ccGradientSampleSessionRef: ref({
    active: false,
    strokeId: null,
    tempSlot: 0,
    stops: null,
    hash: '',
    polyline: [],
  }),
  ccGradientSampleLastUpdateRef: ref(0),
  hadValidShapePressureRef: ref(false),
  latestShapePixelSizeRef: ref<number | null>(null),
  shapeMaxPressureRef: ref(0),
  ccShapePreviewPauseStartedRef: ref(false),
  activeStrokeSessionRef: ref(null),
  finalizeQueueRef: ref({ isBusy: jest.fn(() => false), enqueue: jest.fn() }),
});

const makeShapeDeps = (updateCcSampledGradient = jest.fn()) => ({
  storeRef: ref(storeState),
  toolsRef: ref(storeState.tools),
  project: storeState.project,
  isBusyRef: ref(false),
  drawingCtxRef: ref(null),
  drawingCanvasRef: ref(null),
  drawingCanvasHasContent: ref(false),
  strokeBoundingBoxRef: ref(null),
  strokeCapturePaddingRef: ref(0),
  shapeBeforeImageRef: ref(null),
  latestShapePixelSizeRef: ref<number | null>(null),
  hadValidShapePressureRef: ref(false),
  lastStablePressureRef: ref(0.5),
  shapeBrushRuntime: makeShapeBrushRuntime(),
  getColorCycleBrushManager: jest.fn(() => ({ getShapeFillBrush: jest.fn() })),
  getColorCycleBrushFlags: jest.fn(() => ({ isAny: true, isShapeVariant: false })),
  sampleColorAt: jest.fn(() => '#000000'),
  sampleHexAt: jest.fn(() => '#000000'),
  initDrawingCanvas: jest.fn(),
  startDrawing: jest.fn(),
  continueDrawing: jest.fn(),
  seedManualStrokeBoundingBox: jest.fn(),
  triggerSimpleShapePreview: jest.fn(),
  resetShapeDragRefs: jest.fn(),
  resetCcGradientSample: jest.fn(),
  updateShapePressure: jest.fn(),
  pauseColorCycleForNonCCInteraction: jest.fn(),
  resumeColorCycleAfterInteraction: jest.fn(async () => undefined),
  updateAutoSampledGradient: jest.fn(),
  updateCcSampledGradient,
  updateCcGradientSample: jest.fn(),
  updateDitherGradSamples: jest.fn(),
  capturePendingShapeSnapshot: jest.fn(),
  clearShapeBeforeSnapshot: jest.fn(),
  createBoundingBox: jest.fn((point: { x: number; y: number }) => ({
    minX: point.x,
    minY: point.y,
    maxX: point.x,
    maxY: point.y,
  })),
  mergeBoundingBox: jest.fn((bbox, point: { x: number; y: number }) => ({
    minX: Math.min(bbox?.minX ?? point.x, point.x),
    minY: Math.min(bbox?.minY ?? point.y, point.y),
    maxX: Math.max(bbox?.maxX ?? point.x, point.x),
    maxY: Math.max(bbox?.maxY ?? point.y, point.y),
  })),
  appendSegmentWithDynamicResampling: jest.fn((points: Array<{ x: number; y: number }>, worldPos: { x: number; y: number }) => {
    points.push(worldPos);
    return 1;
  }),
  computeAutoSampleStops: jest.fn(() => null),
  computeShapePixelSize: jest.fn(() => 1),
  finalizeDrawing: jest.fn(async () => undefined),
  finalizeDitherGradientShape: jest.fn(),
  finalizeRasterShapeFill: jest.fn(),
  runColorCycleShapeFill: jest.fn(),
  computeFallbackLinearDirection: jest.fn(() => ({ x: 1, y: 0 })),
  ensureActiveColorCycleGradientSlot: jest.fn(),
  captureRegionFromPoints: jest.fn(),
  boundingBoxToCaptureRegion: jest.fn(),
  commitRasterShapeFill: jest.fn(),
  runIdle: jest.fn((task: () => void) => task()),
  scheduleDeferredColorCycleSaveWithState: jest.fn(async () => undefined),
  bindBrushToCanvas: jest.fn(),
  captureColorCycleBrushState: jest.fn(() => null),
  isColorCycleLayerWithData: jest.fn(() => true),
  setSharedColorCycleGradient: jest.fn(),
  logError: jest.fn(),
  feedbackMessageRef: ref(null),
  withTiming: jest.fn(async (_label: string, task: () => unknown) => task()),
  timeAsync: jest.fn(async (_label: string, task: () => Promise<unknown>) => task()),
  timeSync: jest.fn((_label: string, task: () => unknown) => task()),
  ccLog: jest.fn(),
  ccDebug: { on: false, timing: false, verbose: false },
  perfMark: jest.fn(),
  perfMeasure: jest.fn(),
  debugTime: jest.fn(),
  debugTimeEnd: jest.fn(),
  resetAutoSampleState: jest.fn(),
  resetShapePressureState: jest.fn(),
  resetPolygonState: jest.fn(),
  inflateShapeBeforeSnapshot: jest.fn(),
  ensureLayerSnapshotWithRetry: jest.fn(),
  applyBackdropFromSnapshot: jest.fn(),
  captureCanvasToActiveLayer: jest.fn(),
  scheduleHistoryCommit: jest.fn(),
  ROI_PADDING_PX: 2,
  FF: { CC_CAPTURE_ROI: false },
}) as unknown as Parameters<typeof startShapeDrawing>[1];

describe('finalizeShapeDrawing CC dither resolution', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cancelMarkGradientSession('layer-1');
    (storeState as unknown as { currentBrushPreset: { id: string } | null }).currentBrushPreset = null;
    storeState.tools.ccGradientSource = 'fg';
    storeState.tools.brushSettings.colorCycleFillMode = 'linear';
    storeState.tools.brushSettings.ditherEnabled = true;
    storeState.tools.brushSettings.gradientBands = 8;
    storeState.tools.brushSettings.ditherAlgorithm = 'pattern';
    storeState.tools.brushSettings.ditherPaletteSpread = undefined;
    storeState.tools.brushSettings.colorCycleGradient = [
      { position: 0, color: '#000000' },
      { position: 1, color: '#ffffff' },
    ];
    storeState.updateLayer = jest.fn((layerId: string, patch: Partial<AppState['layers'][number]>) => {
      storeState.layers = storeState.layers.map((layer) =>
        layer.id === layerId
          ? ({ ...layer, ...patch } as AppState['layers'][number])
          : layer
      );
    });
    const layerCanvas = document.createElement('canvas');
    layerCanvas.width = 64;
    layerCanvas.height = 64;
    storeState.layers = [
      {
        id: 'layer-1',
        layerType: 'color-cycle',
        visible: true,
        colorCycleData: {
          canvas: layerCanvas,
          gradient: storeState.tools.brushSettings.colorCycleGradient,
        },
      },
    ] as unknown as AppState['layers'];
  });

  afterEach(() => {
    cancelMarkGradientSession('layer-1');
  });

  it('updates sampled shape preview stops while the first-stage shape is being drawn', () => {
    storeState.tools.ccGradientSource = 'sampled';
    storeState.tools.brushSettings.ccGradientDrawingShape = 'rectangle';
    storeState.tools.brushSettings.colorCycleFillMode = 'linear';
    storeState.tools.brushSettings.autoSampleGradient = false;
    storeState.tools.brushSettings.autoSampleGradientRealtime = false;
    (storeState as unknown as { currentBrushPreset: { id: string } }).currentBrushPreset = {
      id: 'color-cycle-gradient',
    };
    const updateCcSampledGradient = jest.fn();
    const refs = makeShapeRefs();
    const deps = makeShapeDeps(updateCcSampledGradient);

    const didStart = startShapeDrawing(
      {
        worldPos: { x: 4, y: 5 },
        pressure: 0.5,
        timestamp: 1,
        shapeMode: true,
        refs: refs as unknown as Parameters<typeof startShapeDrawing>[0]['refs'],
        renderPreview: false,
      },
      deps
    );

    expect(didStart).toBe(true);
    expect(updateCcSampledGradient).not.toHaveBeenCalled();

    continueShapeDrawing(
      {
        worldPos: { x: 24, y: 15 },
        pressure: 0.5,
        timestamp: 2,
        rawPressure: 0.5,
        shapeMode: true,
        refs: refs as unknown as Parameters<typeof continueShapeDrawing>[0]['refs'],
        renderPreview: false,
      },
      deps as unknown as Parameters<typeof continueShapeDrawing>[1]
    );

    expect(updateCcSampledGradient).toHaveBeenCalledTimes(1);
    const [sourcePoints, options] = updateCcSampledGradient.mock.calls[0];
    expect(sourcePoints.length).toBeGreaterThan(1);
    expect(sourcePoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ x: 4, y: 5 }),
        expect.objectContaining({ x: 24, y: 15 }),
      ])
    );
    expect(options).toEqual({ layerId: 'layer-1', markKind: 'shape' });
  });

  it('reuses an active sampled mark session when preparing sampled shape finalize stops', () => {
    storeState.tools.ccGradientSource = 'sampled';
    const layer = storeState.layers[0];
    const fallbackStops = [
      { position: 0, color: '#111111' },
      { position: 1, color: '#eeeeee' },
    ];
    const activeSession = beginMarkGradientSession({
      layerId: 'layer-1',
      markKind: 'shape',
      gradientKind: 'linear',
      source: 'sampled',
      stops: fallbackStops,
      speedCps: 1,
    });

    const prepared = __TESTING__.prepareFinalSampledShapeSession({
      layer,
      state: storeState,
      shapePoints: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
      deps: {
        sampleColorAt: jest.fn(),
        sampleHexAt: jest.fn((x: number) => (x < 5 ? '#ff0000' : '#0000ff')),
        ccLog: jest.fn(),
      },
    });

    expect(prepared).toBe(activeSession);
    expect(getActiveMarkGradientSession('layer-1')).toBe(activeSession);
    expect(prepared?.previewStopsStored?.map((stop) => stop.color)).toContain('#ff0000');
    expect(prepared?.previewStopsStored?.map((stop) => stop.color)).toContain('#0000ff');
    expect(prepared?.previewHash).toBeTruthy();
  });

  it('renders stage-2 linear direction preview with live gradient stops clipped to the shape', () => {
    storeState.tools.ccGradientSource = 'manual';
    storeState.tools.brushSettings.ditherEnabled = false;
    storeState.tools.brushSettings.colorCycleGradient = [
      { position: 0, color: '#ff0000' },
      { position: 1, color: '#0000ff' },
    ];
    const existingColorCycleData =
      (storeState.layers[0] as { colorCycleData?: Record<string, unknown> }).colorCycleData ?? {};
    storeState.layers = [
      {
        ...storeState.layers[0],
        colorCycleData: {
          ...existingColorCycleData,
          gradient: storeState.tools.brushSettings.colorCycleGradient,
          slotPalettes: [
            {
              slot: 0,
              stops: storeState.tools.brushSettings.colorCycleGradient,
            },
          ],
          gradientDefs: [{ id: 'g0', currentSlot: 0 }],
          activeGradientId: 'g0',
          paintSlot: 0,
        },
      },
    ] as unknown as AppState['layers'];
    const { ctx, gradient } = makePreviewContext();

    const didRender = __TESTING__.renderCcLinearDirectionPreview({
      ctx,
      points: [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 20 },
        { x: 0, y: 20 },
      ],
      directionPoint: { x: 30, y: 10 },
      state: storeState,
    });

    expect(didRender).toBe(true);
    expect(ctx.createLinearGradient).toHaveBeenCalled();
    expect(gradient.addColorStop).toHaveBeenNthCalledWith(1, 0, 'rgba(255, 0, 0, 1)');
    expect(gradient.addColorStop).toHaveBeenNthCalledWith(2, 1, 'rgba(0, 0, 255, 1)');
    expect(ctx.clip).toHaveBeenCalled();
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 20, 20);
  });

  it('uses dither-expanded runtime stops for stage-2 linear direction preview when dither is enabled', () => {
    storeState.tools.ccGradientSource = 'manual';
    storeState.tools.brushSettings.ditherEnabled = true;
    storeState.tools.brushSettings.gradientBands = 8;
    storeState.tools.brushSettings.ditherAlgorithm = 'sierra-lite';
    storeState.tools.brushSettings.ditherPaletteSpread = 80;
    storeState.tools.brushSettings.colorCycleGradient = [
      { position: 0, color: '#ff0000' },
      { position: 1, color: '#0000ff' },
    ];
    const existingColorCycleData =
      (storeState.layers[0] as { colorCycleData?: Record<string, unknown> }).colorCycleData ?? {};
    storeState.layers = [
      {
        ...storeState.layers[0],
        colorCycleData: {
          ...existingColorCycleData,
          gradient: storeState.tools.brushSettings.colorCycleGradient,
          slotPalettes: [
            {
              slot: 0,
              stops: storeState.tools.brushSettings.colorCycleGradient,
            },
          ],
          gradientDefs: [{ id: 'g0', currentSlot: 0 }],
          activeGradientId: 'g0',
          paintSlot: 0,
        },
      },
    ] as unknown as AppState['layers'];
    const { ctx, gradient } = makePreviewContext();

    const didRender = __TESTING__.renderCcLinearDirectionPreview({
      ctx,
      points: [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 20 },
        { x: 0, y: 20 },
      ],
      directionPoint: { x: 30, y: 10 },
      state: storeState,
    });

    expect(didRender).toBe(true);
    expect(gradient.addColorStop).toHaveBeenCalled();
    expect(gradient.addColorStop.mock.calls.length).toBeGreaterThan(2);
    expect(gradient.addColorStop.mock.calls).not.toEqual([
      [0, 'rgba(255, 0, 0, 1)'],
      [1, 'rgba(0, 0, 255, 1)'],
    ]);
  });

  it('replaces an active non-sampled mark session when preparing sampled shape finalize stops', () => {
    storeState.tools.ccGradientSource = 'sampled';
    const layer = storeState.layers[0];
    const staleSession = beginMarkGradientSession({
      layerId: 'layer-1',
      markKind: 'shape',
      gradientKind: 'linear',
      source: 'fg',
      stops: [
        { position: 0, color: '#111111' },
        { position: 1, color: '#eeeeee' },
      ],
      speedCps: 1,
    });

    const prepared = __TESTING__.prepareFinalSampledShapeSession({
      layer,
      state: storeState,
      shapePoints: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
      deps: {
        sampleColorAt: jest.fn(),
        sampleHexAt: jest.fn((x: number) => (x < 5 ? '#ff0000' : '#0000ff')),
        ccLog: jest.fn(),
      },
    });

    expect(staleSession).toBeTruthy();
    expect(prepared).toBeTruthy();
    expect(prepared).not.toBe(staleSession);
    expect(prepared?.source).toBe('sampled');
    expect(getActiveMarkGradientSession('layer-1')).toBe(prepared);
    expect(prepared?.previewStopsStored?.map((stop) => stop.color)).toContain('#ff0000');
    expect(prepared?.previewStopsStored?.map((stop) => stop.color)).toContain('#0000ff');
    expect(prepared?.previewHash).toBeTruthy();
  });

  it('replaces an active sampled stroke session when preparing sampled shape finalize stops', () => {
    storeState.tools.ccGradientSource = 'sampled';
    const layer = storeState.layers[0];
    const staleSession = beginMarkGradientSession({
      layerId: 'layer-1',
      markKind: 'stroke',
      gradientKind: 'linear',
      source: 'sampled',
      stops: [
        { position: 0, color: '#111111' },
        { position: 1, color: '#eeeeee' },
      ],
      speedCps: 1,
    });

    const prepared = __TESTING__.prepareFinalSampledShapeSession({
      layer,
      state: storeState,
      shapePoints: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
      deps: {
        sampleColorAt: jest.fn(),
        sampleHexAt: jest.fn((x: number) => (x < 5 ? '#ff0000' : '#0000ff')),
        ccLog: jest.fn(),
      },
    });

    expect(staleSession).toBeTruthy();
    expect(prepared).toBeTruthy();
    expect(prepared).not.toBe(staleSession);
    expect(prepared?.source).toBe('sampled');
    expect(prepared?.markKind).toBe('shape');
    expect(getActiveMarkGradientSession('layer-1')).toBe(prepared);
    expect(prepared?.previewStopsStored?.map((stop) => stop.color)).toContain('#ff0000');
    expect(prepared?.previewStopsStored?.map((stop) => stop.color)).toContain('#0000ff');
    expect(prepared?.previewHash).toBeTruthy();
  });

  it('replaces an active sampled mark session when the finalize fill mode changes', () => {
    storeState.tools.ccGradientSource = 'sampled';
    const layer = storeState.layers[0];
    const activeSession = beginMarkGradientSession({
      layerId: 'layer-1',
      markKind: 'shape',
      gradientKind: 'linear',
      source: 'sampled',
      stops: [
        { position: 0, color: '#111111' },
        { position: 1, color: '#eeeeee' },
      ],
      speedCps: 1,
    });
    storeState.tools.brushSettings.colorCycleFillMode = 'concentric';

    const prepared = __TESTING__.prepareFinalSampledShapeSession({
      layer,
      state: storeState,
      shapePoints: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
      deps: {
        sampleColorAt: jest.fn(),
        sampleHexAt: jest.fn((x: number) => (x < 5 ? '#ff0000' : '#0000ff')),
        ccLog: jest.fn(),
      },
    });

    expect(activeSession).toBeTruthy();
    expect(prepared).toBeTruthy();
    expect(prepared).not.toBe(activeSession);
    expect(prepared?.source).toBe('sampled');
    expect(prepared?.gradientKind).toBe('concentric');
    expect(getActiveMarkGradientSession('layer-1')).toBe(prepared);
    expect(prepared?.previewStopsStored?.map((stop) => stop.color)).toContain('#ff0000');
    expect(prepared?.previewStopsStored?.map((stop) => stop.color)).toContain('#0000ff');
    expect(prepared?.previewHash).toBeTruthy();
  });

  it('passes the fill-resolution slider value to CC shape finalize even when no brush instance is found', async () => {
    let queued: Promise<void> | null = null;
    const finalizeQueue = {
      isBusy: jest.fn(() => false),
      enqueue: jest.fn((task: () => Promise<void>) => {
        queued = task();
        return queued;
      }),
    };
    const runColorCycleShapeFill = jest.fn(async () => undefined);
    const refs = {
      isDrawingShapeRef: { current: true },
      isSelectingDirectionRef: { current: true },
      directionPreviewRef: { current: { x: 32, y: 16 } },
      shapePointsRef: {
        current: [
          { x: 8, y: 8 },
          { x: 24, y: 8 },
          { x: 8, y: 24 },
        ],
      },
      shapeDragStartRef: { current: null },
      shapeDragLastRef: { current: null },
      shapeDragMovedRef: { current: false },
      shapeInteractionPhaseRef: { current: 'drawing' },
      latestShapePressureRef: { current: 0.5 },
      lastStablePressureRef: { current: 0.5 },
      shapeBeforeImageRef: { current: null },
      strokeBoundingBoxRef: { current: null },
      strokeCapturePaddingRef: { current: 0 },
      drawingCtxRef: { current: makeContext() },
      drawingCanvasRef: { current: document.createElement('canvas') },
      drawingCanvasHasContent: { current: true },
      autoSamplePointsRef: { current: [] },
      autoSampleForkRef: { current: false },
      autoSampleLastUpdateRef: { current: 0 },
      ccSampledPointsRef: { current: [] },
      ccGradientSampleSessionRef: {
        current: {
          active: false,
          strokeId: null,
          tempSlot: -1,
          stops: null,
          hash: '',
          polyline: [],
        },
      },
      ccGradientSampleLastUpdateRef: { current: 0 },
      hadValidShapePressureRef: { current: false },
      latestShapePixelSizeRef: { current: null },
      shapeMaxPressureRef: { current: 0 },
      ccShapePreviewPauseStartedRef: { current: false },
      activeStrokeSessionRef: { current: null },
      finalizeQueueRef: { current: finalizeQueue },
    };
    const deps = {
      storeRef: { current: storeState },
      shapeBrushRuntime: makeShapeBrushRuntime(),
      drawingCtxRef: refs.drawingCtxRef,
      drawingCanvasRef: refs.drawingCanvasRef,
      drawingCanvasHasContent: refs.drawingCanvasHasContent,
      project: storeState.project,
      isBusyRef: { current: false },
      latestShapePixelSizeRef: refs.latestShapePixelSizeRef,
      hadValidShapePressureRef: refs.hadValidShapePressureRef,
      lastStablePressureRef: refs.lastStablePressureRef,
      computeShapePixelSize: jest.fn(() => 3),
      getColorCycleBrushManager: () => ({ getShapeFillBrush: () => null }),
      ensureActiveColorCycleGradientSlot: jest.fn(),
      runColorCycleShapeFill,
      bindBrushToCanvas: jest.fn(),
      timeAsync: async (_label: string, task: () => Promise<unknown>) => task(),
      timeSync: (_label: string, task: () => unknown) => task(),
      ccLog: jest.fn(),
      scheduleDeferredColorCycleSaveWithState: jest.fn(),
      logError: jest.fn(),
      ccDebug: { on: false, timing: false, verbose: false },
      perfMark: jest.fn(),
      perfMeasure: jest.fn(),
      debugTime: jest.fn(),
      debugTimeEnd: jest.fn(),
      FF: { CC_CAPTURE_ROI: false },
      ROI_PADDING_PX: 2,
      captureRegionFromPoints: jest.fn(),
      isColorCycleLayerWithData: jest.fn(() => true),
      captureColorCycleBrushState: jest.fn(() => null),
      resumeColorCycleAfterInteraction: jest.fn(async () => undefined),
      triggerSimpleShapePreview: jest.fn(),
      resetShapeDragRefs: jest.fn(),
      resetCcGradientSample: jest.fn(),
      resetShapePressureState: jest.fn(),
      clearShapeBeforeSnapshot: jest.fn(),
      finalizeDrawing: jest.fn(async () => undefined),
      finalizeDitherGradientShape: jest.fn(),
      finalizeRasterShapeFill: jest.fn(),
      resetPolygonState: jest.fn(),
      sampleColorAt: jest.fn(),
      sampleHexAt: jest.fn(() => '#000000'),
    };

    await finalizeShapeDrawing(
      {
        shapeMode: true,
        refs: refs as unknown as Parameters<typeof finalizeShapeDrawing>[0]['refs'],
        toolsRef: { current: storeState.tools } as React.MutableRefObject<AppState['tools']>,
      },
      deps as unknown as Parameters<typeof finalizeShapeDrawing>[1]
    );
    await queued;

    expect(runColorCycleShapeFill).toHaveBeenCalledWith(
      expect.objectContaining({
        ditherPixelSize: 7,
      }),
      expect.any(Object)
    );
    expect(refs.latestShapePixelSizeRef.current).toBe(7);
  });

  it('preserves constrained drag geometry when finalizing CC gradient rectangles', async () => {
    (storeState as unknown as { currentBrushPreset: { id: string } }).currentBrushPreset = {
      id: 'color-cycle-gradient',
    };
    storeState.tools.brushSettings = {
      ...storeState.tools.brushSettings,
      colorCycleFillMode: 'linear',
      ccGradientDrawingShape: 'rectangle',
    };

    let queued: Promise<void> | null = null;
    const finalizeQueue = {
      isBusy: jest.fn(() => false),
      enqueue: jest.fn((task: () => Promise<void>) => {
        queued = task();
        return queued;
      }),
    };
    const constrainedSquare = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
      { x: 0, y: 20 },
    ];
    const runColorCycleShapeFill = jest.fn(async () => undefined);
    const refs = {
      isDrawingShapeRef: { current: true },
      isSelectingDirectionRef: { current: false },
      directionPreviewRef: { current: null },
      shapePointsRef: { current: constrainedSquare.map(point => ({ ...point })) },
      ccStrokeSamplesRef: { current: [] },
      ccStrokeDirectionRef: { current: null },
      ccGradientDrawingGeometryRef: {
        current: {
          shapePoints: constrainedSquare.map(point => ({ ...point })),
          sampleSourcePoints: [{ x: 0, y: 0 }, { x: 20, y: 20 }],
          direction: { x: Math.SQRT1_2, y: Math.SQRT1_2 },
          bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
        },
      },
      shapeDragStartRef: { current: { x: 0, y: 0 } },
      shapeDragLastRef: { current: { x: 20, y: 8 } },
      shapeDragMovedRef: { current: true },
      shapeInteractionPhaseRef: { current: 'drawing' },
      latestShapePressureRef: { current: 0.5 },
      lastStablePressureRef: { current: 0.5 },
      shapeBeforeImageRef: { current: null },
      strokeBoundingBoxRef: { current: null },
      strokeCapturePaddingRef: { current: 0 },
      drawingCtxRef: { current: makeContext() },
      drawingCanvasRef: { current: document.createElement('canvas') },
      drawingCanvasHasContent: { current: true },
      autoSamplePointsRef: { current: [] },
      autoSampleForkRef: { current: false },
      autoSampleLastUpdateRef: { current: 0 },
      ccSampledPointsRef: { current: [] },
      ccGradientSampleSessionRef: {
        current: {
          active: false,
          strokeId: null,
          tempSlot: -1,
          stops: null,
          hash: '',
          polyline: [],
        },
      },
      ccGradientSampleLastUpdateRef: { current: 0 },
      hadValidShapePressureRef: { current: false },
      latestShapePixelSizeRef: { current: null },
      shapeMaxPressureRef: { current: 0 },
      ccShapePreviewPauseStartedRef: { current: false },
      activeStrokeSessionRef: { current: null },
      finalizeQueueRef: { current: finalizeQueue },
    };
    const deps = {
      storeRef: { current: storeState },
      shapeBrushRuntime: makeShapeBrushRuntime(),
      drawingCtxRef: refs.drawingCtxRef,
      drawingCanvasRef: refs.drawingCanvasRef,
      drawingCanvasHasContent: refs.drawingCanvasHasContent,
      project: storeState.project,
      isBusyRef: { current: false },
      latestShapePixelSizeRef: refs.latestShapePixelSizeRef,
      hadValidShapePressureRef: refs.hadValidShapePressureRef,
      lastStablePressureRef: refs.lastStablePressureRef,
      computeShapePixelSize: jest.fn(() => 3),
      getColorCycleBrushManager: () => ({ getShapeFillBrush: () => null }),
      ensureActiveColorCycleGradientSlot: jest.fn(),
      runColorCycleShapeFill,
      bindBrushToCanvas: jest.fn(),
      timeAsync: async (_label: string, task: () => Promise<unknown>) => task(),
      timeSync: (_label: string, task: () => unknown) => task(),
      ccLog: jest.fn(),
      scheduleDeferredColorCycleSaveWithState: jest.fn(),
      logError: jest.fn(),
      ccDebug: { on: false, timing: false, verbose: false },
      perfMark: jest.fn(),
      perfMeasure: jest.fn(),
      debugTime: jest.fn(),
      debugTimeEnd: jest.fn(),
      FF: { CC_CAPTURE_ROI: false },
      ROI_PADDING_PX: 2,
      captureRegionFromPoints: jest.fn(),
      isColorCycleLayerWithData: jest.fn(() => true),
      captureColorCycleBrushState: jest.fn(() => null),
      resumeColorCycleAfterInteraction: jest.fn(async () => undefined),
      triggerSimpleShapePreview: jest.fn(),
      resetShapeDragRefs: jest.fn(),
      resetCcGradientSample: jest.fn(),
      resetShapePressureState: jest.fn(),
      clearShapeBeforeSnapshot: jest.fn(),
      finalizeDrawing: jest.fn(async () => undefined),
      finalizeDitherGradientShape: jest.fn(),
      finalizeRasterShapeFill: jest.fn(),
      resetPolygonState: jest.fn(),
      sampleColorAt: jest.fn(),
      sampleHexAt: jest.fn(() => '#000000'),
      resetAutoSampleState: jest.fn(),
      commitRasterShapeFill: jest.fn(async () => false),
      computeFallbackLinearDirection: jest.fn(() => ({ x: 1, y: 0 })),
    };

    await finalizeShapeDrawing(
      {
        shapeMode: true,
        refs: refs as unknown as Parameters<typeof finalizeShapeDrawing>[0]['refs'],
        toolsRef: { current: storeState.tools } as React.MutableRefObject<AppState['tools']>,
      },
      deps as unknown as Parameters<typeof finalizeShapeDrawing>[1]
    );
    await queued;

    expect(runColorCycleShapeFill).toHaveBeenCalledWith(
      expect.objectContaining({
        shapePoints: constrainedSquare,
      }),
      expect.any(Object)
    );
  });

  it('uses stored drag-axis direction when finalizing CC gradient lines', async () => {
    (storeState as unknown as { currentBrushPreset: { id: string } }).currentBrushPreset = {
      id: 'color-cycle-gradient',
    };
    storeState.tools.brushSettings = {
      ...storeState.tools.brushSettings,
      colorCycleFillMode: 'linear',
      ccGradientDrawingShape: 'line',
    };

    let queued: Promise<void> | null = null;
    const finalizeQueue = {
      isBusy: jest.fn(() => false),
      enqueue: jest.fn((task: () => Promise<void>) => {
        queued = task();
        return queued;
      }),
    };
    const lineDirection = { x: 1, y: 0 };
    const lineOutline = [
      { x: 0, y: -3 },
      { x: 24, y: -3 },
      { x: 24, y: 3 },
      { x: 0, y: 3 },
    ];
    const runColorCycleShapeFill = jest.fn(async () => undefined);
    const refs = {
      isDrawingShapeRef: { current: true },
      isSelectingDirectionRef: { current: false },
      directionPreviewRef: { current: null },
      shapePointsRef: { current: lineOutline.map(point => ({ ...point })) },
      ccStrokeSamplesRef: { current: [] },
      ccStrokeDirectionRef: { current: lineDirection },
      ccGradientDrawingGeometryRef: {
        current: {
          shapePoints: lineOutline.map(point => ({ ...point })),
          sampleSourcePoints: [{ x: 0, y: 0 }, { x: 24, y: 0 }],
          direction: lineDirection,
          bounds: { minX: 0, minY: -3, maxX: 24, maxY: 3 },
        },
      },
      shapeDragStartRef: { current: { x: 0, y: 0 } },
      shapeDragLastRef: { current: { x: 24, y: 0 } },
      shapeDragMovedRef: { current: true },
      shapeInteractionPhaseRef: { current: 'drawing' },
      latestShapePressureRef: { current: 0.5 },
      lastStablePressureRef: { current: 0.5 },
      shapeBeforeImageRef: { current: null },
      strokeBoundingBoxRef: { current: null },
      strokeCapturePaddingRef: { current: 0 },
      drawingCtxRef: { current: makeContext() },
      drawingCanvasRef: { current: document.createElement('canvas') },
      drawingCanvasHasContent: { current: true },
      autoSamplePointsRef: { current: [] },
      autoSampleForkRef: { current: false },
      autoSampleLastUpdateRef: { current: 0 },
      ccSampledPointsRef: { current: [] },
      ccGradientSampleSessionRef: {
        current: {
          active: false,
          strokeId: null,
          tempSlot: -1,
          stops: null,
          hash: '',
          polyline: [],
        },
      },
      ccGradientSampleLastUpdateRef: { current: 0 },
      hadValidShapePressureRef: { current: false },
      latestShapePixelSizeRef: { current: null },
      shapeMaxPressureRef: { current: 0 },
      ccShapePreviewPauseStartedRef: { current: false },
      activeStrokeSessionRef: { current: null },
      finalizeQueueRef: { current: finalizeQueue },
    };
    const deps = {
      storeRef: { current: storeState },
      shapeBrushRuntime: makeShapeBrushRuntime(),
      drawingCtxRef: refs.drawingCtxRef,
      drawingCanvasRef: refs.drawingCanvasRef,
      drawingCanvasHasContent: refs.drawingCanvasHasContent,
      project: storeState.project,
      isBusyRef: { current: false },
      latestShapePixelSizeRef: refs.latestShapePixelSizeRef,
      hadValidShapePressureRef: refs.hadValidShapePressureRef,
      lastStablePressureRef: refs.lastStablePressureRef,
      computeShapePixelSize: jest.fn(() => 3),
      getColorCycleBrushManager: () => ({ getShapeFillBrush: () => null }),
      ensureActiveColorCycleGradientSlot: jest.fn(),
      runColorCycleShapeFill,
      bindBrushToCanvas: jest.fn(),
      timeAsync: async (_label: string, task: () => Promise<unknown>) => task(),
      timeSync: (_label: string, task: () => unknown) => task(),
      ccLog: jest.fn(),
      scheduleDeferredColorCycleSaveWithState: jest.fn(),
      logError: jest.fn(),
      ccDebug: { on: false, timing: false, verbose: false },
      perfMark: jest.fn(),
      perfMeasure: jest.fn(),
      debugTime: jest.fn(),
      debugTimeEnd: jest.fn(),
      FF: { CC_CAPTURE_ROI: false },
      ROI_PADDING_PX: 2,
      captureRegionFromPoints: jest.fn(),
      isColorCycleLayerWithData: jest.fn(() => true),
      captureColorCycleBrushState: jest.fn(() => null),
      resumeColorCycleAfterInteraction: jest.fn(async () => undefined),
      triggerSimpleShapePreview: jest.fn(),
      resetShapeDragRefs: jest.fn(),
      resetCcGradientSample: jest.fn(),
      resetShapePressureState: jest.fn(),
      clearShapeBeforeSnapshot: jest.fn(),
      finalizeDrawing: jest.fn(async () => undefined),
      finalizeDitherGradientShape: jest.fn(),
      finalizeRasterShapeFill: jest.fn(),
      resetPolygonState: jest.fn(),
      sampleColorAt: jest.fn(),
      sampleHexAt: jest.fn(() => '#000000'),
      resetAutoSampleState: jest.fn(),
      commitRasterShapeFill: jest.fn(async () => false),
      computeFallbackLinearDirection: jest.fn(() => ({ x: 0, y: 1 })),
    };

    await finalizeShapeDrawing(
      {
        shapeMode: true,
        refs: refs as unknown as Parameters<typeof finalizeShapeDrawing>[0]['refs'],
        toolsRef: { current: storeState.tools } as React.MutableRefObject<AppState['tools']>,
      },
      deps as unknown as Parameters<typeof finalizeShapeDrawing>[1]
    );
    await queued;

    expect(runColorCycleShapeFill).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: lineDirection,
      }),
      expect.any(Object)
    );
  });
});
