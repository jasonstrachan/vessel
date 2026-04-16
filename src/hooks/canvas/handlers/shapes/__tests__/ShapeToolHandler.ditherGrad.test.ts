/* eslint-disable @typescript-eslint/no-explicit-any */
import { createShapeToolHandler } from '../ShapeToolHandler';
import { BrushShape } from '@/types';

const storeState: any = {
  tools: {
    currentTool: 'brush',
    brushSettings: {
      brushShape: BrushShape.DITHER_GRADIENT,
      pressureEnabled: false,
      ditherGradSampleEnabled: true,
      ditherGradStops: ['#000000', '#ffffff'],
      color: '#000000',
    },
  },
  polygonGradientState: { drawingState: 'idle', points: [] },
  palette: { foregroundColor: '#000000', backgroundColor: '#ffffff' },
  shapeFill: { session: null },
  setPolygonGradientState: jest.fn((update) => {
    storeState.polygonGradientState = {
      ...storeState.polygonGradientState,
      ...update,
    };
  }),
  cancelShapeFillSession: jest.fn(),
  setBrushSettings: jest.fn(),
};

jest.mock('@/stores/useAppStore', () => {
  const mock = (selector?: any) => (selector ? selector(storeState) : storeState);
  mock.getState = () => storeState;
  return { useAppStore: mock };
});

const makeCanvas = () => {
  const canvas = document.createElement('canvas');
  canvas.getBoundingClientRect = jest.fn(() =>
    ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 } as DOMRect)
  );
  return canvas as HTMLCanvasElement;
};

const createDeps = () => {
  const canvas = makeCanvas();
  return {
    canvasRef: { current: canvas },
    canvas: { zoom: 1 },
    pan: {
      screenToWorld: (x: number, y: number) => ({ x, y }),
      worldToScreen: (x: number, y: number) => ({ x, y }),
    },
    drawingHandlers: {
      updateDitherGradSamples: jest.fn(),
      resetShapePressureState: jest.fn(),
      updateShapePressure: jest.fn(),
      startShapeDrawing: jest.fn(),
      stopContinuousColorCycleAnimation: jest.fn(),
      continueShapeDrawing: jest.fn(),
      drawingCanvasRef: { current: null },
      drawingCanvasHasContent: { current: false },
      isDrawingShapeRef: { current: false },
      shapePointsRef: { current: [] },
      latestShapePixelSizeRef: { current: 1 },
      lastStablePressureRef: { current: 0.5 },
      computeShapePixelSize: jest.fn(() => 1),
    },
    tools: storeState.tools,
    overlayCanvasRef: { current: null },
    compositeCanvasRef: { current: null },
    compositeCanvasDirtyRef: { current: false },
    compositeLayersToCanvas: jest.fn(),
    setCurrentOffscreenCanvas: jest.fn(),
    project: { width: 100, height: 100 },
    stateMachine: { dispatch: jest.fn() },
    setNeedsRedraw: jest.fn(),
    viewTransformRef: { current: { scale: 1, offsetX: 0, offsetY: 0 } },
    sampleColorAtPosition: jest.fn(() => '#000000'),
    dynamicDepsRef: { current: { currentBrushPresetId: 'color-cycle-gradient' } },
    previewAnimationFrameRef: { current: null },
    layers: [],
    activeLayerId: null,
    interaction: { dispatch: jest.fn() },
    feedback: jest.fn(),
  } as any;
};

describe('ShapeToolHandler dither gradient sampling', () => {
  beforeEach(() => {
    storeState.tools.brushSettings.brushShape = BrushShape.DITHER_GRADIENT;
    storeState.polygonGradientState = { drawingState: 'idle', points: [] };
    storeState.setPolygonGradientState.mockClear();
  });

  it('calls updateDitherGradSamples on polygon start', () => {
    const deps = createDeps();
    const handler = createShapeToolHandler(
      {
        deps,
        overlayPreviewFrameMs: 16,
        getLastOverlayPreviewTs: () => 0,
        setLastOverlayPreviewTs: jest.fn(),
      },
      {}
    );

    const event = {
      button: 0,
      clientX: 10,
      clientY: 15,
      pointerType: 'mouse',
      pressure: 0.5,
      shiftKey: false,
      ctrlKey: false,
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
      target: deps.canvasRef.current,
    } as any;

    handler.handlePointerDown(event);

    expect(deps.drawingHandlers.updateDitherGradSamples).toHaveBeenCalledWith([
      { x: 10, y: 15 },
    ]);
  });

  it('updates samples when adding polygon points', () => {
    const deps = createDeps();
    const handler = createShapeToolHandler(
      {
        deps,
        overlayPreviewFrameMs: 16,
        getLastOverlayPreviewTs: () => 0,
        setLastOverlayPreviewTs: jest.fn(),
      },
      {}
    );

    const downEvent = {
      button: 0,
      clientX: 10,
      clientY: 15,
      pointerType: 'mouse',
      pressure: 0.5,
      shiftKey: false,
      ctrlKey: false,
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
      target: deps.canvasRef.current,
    } as any;
    handler.handlePointerDown(downEvent);

    const moveEvent = {
      clientX: 30,
      clientY: 35,
      buttons: 1,
      pointerType: 'mouse',
      pressure: 0.5,
      shiftKey: false,
      ctrlKey: false,
      target: deps.canvasRef.current,
    } as any;
    handler.handlePointerMove(moveEvent);

    const lastCall = deps.drawingHandlers.updateDitherGradSamples.mock.calls.at(-1)?.[0];
    expect(lastCall).toBeDefined();
    const normalize = (color?: string) => color?.replace(/\s+/g, '').toLowerCase();
    expect(lastCall).toEqual([
      { x: 10, y: 15, color: lastCall?.[0]?.color },
      { x: 30, y: 35, color: lastCall?.[1]?.color },
    ]);
    expect(['#000000', 'rgb(0,0,0)']).toContain(normalize(lastCall?.[0]?.color));
    expect(['#000000', 'rgb(0,0,0)']).toContain(normalize(lastCall?.[1]?.color));
  });

  it('does not append points below minimum spacing', () => {
    const deps = createDeps();
    const handler = createShapeToolHandler(
      {
        deps,
        overlayPreviewFrameMs: 16,
        getLastOverlayPreviewTs: () => 0,
        setLastOverlayPreviewTs: jest.fn(),
      },
      {}
    );

    const downEvent = {
      button: 0,
      clientX: 10,
      clientY: 15,
      pointerType: 'mouse',
      pressure: 0.5,
      shiftKey: false,
      ctrlKey: false,
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
      target: deps.canvasRef.current,
    } as any;
    handler.handlePointerDown(downEvent);

    const moveEvent = {
      clientX: 12,
      clientY: 16,
      buttons: 1,
      pointerType: 'mouse',
      pressure: 0.5,
      shiftKey: false,
      ctrlKey: false,
      target: deps.canvasRef.current,
    } as any;
    handler.handlePointerMove(moveEvent);

    expect(deps.drawingHandlers.updateDitherGradSamples).toHaveBeenCalledTimes(1);
  });

  it('does not enter drawing state when cc shape start is rejected', () => {
    storeState.tools.brushSettings.brushShape = BrushShape.COLOR_CYCLE_SHAPE;
    const deps = createDeps();
    deps.layers = [{ id: 'cc-layer', layerType: 'color-cycle' }];
    deps.activeLayerId = 'cc-layer';
    deps.drawingHandlers.startShapeDrawing.mockReturnValue(false);

    const handler = createShapeToolHandler(
      {
        deps,
        overlayPreviewFrameMs: 16,
        getLastOverlayPreviewTs: () => 0,
        setLastOverlayPreviewTs: jest.fn(),
      },
      {}
    );

    const event = {
      button: 0,
      clientX: 10,
      clientY: 15,
      pointerType: 'mouse',
      pressure: 0.5,
      shiftKey: false,
      ctrlKey: false,
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
      target: deps.canvasRef.current,
    } as any;

    handler.handlePointerDown(event);

    expect(deps.drawingHandlers.startShapeDrawing).toHaveBeenCalled();
    expect(deps.interaction.dispatch).not.toHaveBeenCalledWith({ type: 'DRAWING_START' });
  });
});
