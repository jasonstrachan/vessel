import type React from 'react';

import { BrushShape } from '@/types';
import type { AppState } from '@/stores/useAppStore';
import {
  __TESTING__,
  finalizeShapeDrawing,
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

const makeShapeBrushRuntime = () => ({
  updateConfig: jest.fn(),
  fillCcGradientLinear: jest.fn(),
  fillCcGradientConcentric: jest.fn(),
  updateColorCycleTexture: jest.fn(),
  applyStrokeDither: jest.fn(),
  updateColorCycleGradient: jest.fn(),
  resetColorCycle: jest.fn(),
});

describe('finalizeShapeDrawing CC dither resolution', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cancelMarkGradientSession('layer-1');
    (storeState as unknown as { currentBrushPreset: { id: string } | null }).currentBrushPreset = null;
    storeState.tools.ccGradientSource = 'fg';
    storeState.tools.brushSettings.colorCycleFillMode = 'linear';
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
