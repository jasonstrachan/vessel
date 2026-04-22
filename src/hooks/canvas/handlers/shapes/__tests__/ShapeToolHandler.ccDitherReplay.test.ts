/* eslint-disable @typescript-eslint/no-explicit-any */
import { createShapeToolHandler } from '../ShapeToolHandler';
import { runSampledCcDitherPreviewRuntime } from '../ccShapePreviewDitherRuntime';
import { BrushShape } from '@/types';

const fillCcGradientDither = jest.fn<Promise<void>, [unknown]>();
const buildSampledStops = jest.fn();

jest.mock('@/utils/colorCycle/ccGradientDither', () => ({
  fillCcGradientDither: (...args: unknown[]) => fillCcGradientDither(...(args as [unknown])),
}));

jest.mock('@/hooks/canvas/handlers/colorCycle/ccSampling', () => ({
  buildSampledStops: (...args: unknown[]) => buildSampledStops(...args),
}));

const makeMockContext = () => {
  const gradient = { addColorStop: jest.fn() };
  return {
    canvas: { width: 256, height: 256 },
    save: jest.fn(),
    restore: jest.fn(),
    translate: jest.fn(),
    scale: jest.fn(),
    clearRect: jest.fn(),
    drawImage: jest.fn(),
    beginPath: jest.fn(),
    arc: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    closePath: jest.fn(),
    fill: jest.fn(),
    stroke: jest.fn(),
    setTransform: jest.fn(),
    createLinearGradient: jest.fn(() => gradient),
    createImageData: jest.fn((width: number, height: number) => new ImageData(width, height)),
    putImageData: jest.fn(),
    imageSmoothingEnabled: false,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
  } as unknown as CanvasRenderingContext2D;
};

const tempCtx = makeMockContext();

jest.mock('@/utils/canvasPool', () => ({
  canvasPool: {
    acquire: jest.fn((width: number, height: number) => ({
      width,
      height,
      getContext: jest.fn(() => tempCtx),
    })),
    release: jest.fn(),
  },
}));

const storeState: any = {
  tools: {
    currentTool: 'brush',
    shapeMode: true,
    brushSettings: {
      brushShape: BrushShape.COLOR_CYCLE_SHAPE,
      pressureEnabled: false,
      colorCycleFillMode: 'linear',
      ditherEnabled: true,
      gradientBands: 8,
      fillResolution: 1,
      ditherAlgorithm: 'sierra-lite',
      patternStyle: 'dots',
      ditherPaletteSpread: 0,
      colorCycleGradient: [
        { position: 0, color: '#000000' },
        { position: 1, color: '#ffffff' },
      ],
      color: '#000000',
    },
  },
  polygonGradientState: { drawingState: 'idle', points: [] },
  palette: { foregroundColor: '#000000', backgroundColor: '#ffffff' },
  shapeFill: { session: null },
};

jest.mock('@/stores/useAppStore', () => {
  const mock = (selector?: any) => (selector ? selector(storeState) : storeState);
  mock.getState = () => storeState;
  return { useAppStore: mock };
});

describe('ShapeToolHandler CC dither preview replay', () => {
  const rafQueue: Array<FrameRequestCallback> = [];
  let rafId = 1;
  let originalRaf: typeof requestAnimationFrame;
  let originalCancelRaf: typeof cancelAnimationFrame;
  let cancelAnimationFrameMock: jest.Mock;

  beforeEach(() => {
    fillCcGradientDither.mockReset();
    buildSampledStops.mockReset();
    buildSampledStops.mockReturnValue({
      stops: [
        { position: 0, color: '#000000' },
        { position: 1, color: '#ffffff' },
      ],
    });
    rafQueue.length = 0;
    rafId = 1;
    storeState.tools.brushSettings.fillResolution = 1;
    storeState.tools.brushSettings.ccGradientSource = undefined;
    originalRaf = global.requestAnimationFrame;
    originalCancelRaf = global.cancelAnimationFrame;
    cancelAnimationFrameMock = jest.fn();
    global.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      return rafId++;
    }) as typeof requestAnimationFrame;
    global.cancelAnimationFrame = cancelAnimationFrameMock as unknown as typeof cancelAnimationFrame;
  });

  afterEach(() => {
    jest.useRealTimers();
    global.requestAnimationFrame = originalRaf;
    global.cancelAnimationFrame = originalCancelRaf;
  });

  it('replays the latest preview after an in-flight CC dither job becomes dirty', async () => {
    let resolveFirst!: () => void;
    fillCcGradientDither.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveFirst = resolve;
        })
    );
    fillCcGradientDither.mockResolvedValueOnce();

    const overlayCtx = makeMockContext();
    const overlayCanvas = document.createElement('canvas');
    overlayCanvas.width = 256;
    overlayCanvas.height = 256;
    (overlayCanvas as any).getContext = jest.fn(() => overlayCtx);

    const canvas = document.createElement('canvas');
    canvas.getBoundingClientRect = jest.fn(
      () => ({ left: 0, top: 0, width: 256, height: 256, right: 256, bottom: 256 } as DOMRect)
    );

    const deps = {
      canvasRef: { current: canvas },
      canvas: { zoom: 1 },
      pan: {
        screenToWorld: (x: number, y: number) => ({ x, y }),
        worldToScreen: (x: number, y: number) => ({ x, y }),
      },
      drawingHandlers: {
        continueShapeDrawing: jest.fn(),
        isDrawingShapeRef: { current: true },
        shapePointsRef: { current: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] },
        latestShapePixelSizeRef: { current: 1 },
        lastStablePressureRef: { current: 0.5 },
        hadValidShapePressureRef: { current: false },
        computeShapePixelSize: jest.fn(() => 1),
        ccShapePreviewCacheRef: { current: null },
      },
      dynamicDepsRef: { current: { currentBrushPresetId: 'color-cycle-gradient' } },
      currentBrushPresetId: 'color-cycle-gradient',
      tools: storeState.tools,
      overlayCanvasRef: { current: overlayCanvas },
      compositeCanvasRef: { current: null },
      compositeCanvasDirtyRef: { current: false },
      compositeLayersToCanvas: jest.fn(),
      setCurrentOffscreenCanvas: jest.fn(),
      project: { width: 256, height: 256 },
      stateMachine: { dispatch: jest.fn(), finalizationComplete: jest.fn(), state: { mode: 'IDLE' } },
      setNeedsRedraw: jest.fn(),
      viewTransformRef: { current: { scale: 1, offsetX: 0, offsetY: 0 } },
      sampleColorAtPosition: jest.fn(() => '#000000'),
      previewAnimationFrameRef: { current: null },
      layers: [],
      activeLayerId: null,
      interaction: { dispatch: jest.fn() },
      feedback: jest.fn(),
      palette: storeState.palette,
    } as any;

    const handler = createShapeToolHandler(
      {
        deps,
        overlayPreviewFrameMs: 0,
        getLastOverlayPreviewTs: () => 0,
        setLastOverlayPreviewTs: jest.fn(),
      },
      {}
    );

    const moveEvent = (x: number, y: number) =>
      ({
        clientX: x,
        clientY: y,
        buttons: 1,
        pointerType: 'mouse',
        pressure: 0.5,
        shiftKey: false,
        ctrlKey: false,
        target: canvas,
      }) as any;

    handler.handlePointerMove(moveEvent(20, 20));
    expect(rafQueue).toHaveLength(1);

    rafQueue.shift()?.(0);
    expect(fillCcGradientDither).toHaveBeenCalledTimes(1);
    await Promise.resolve();

    handler.handlePointerMove(moveEvent(30, 30));
    expect(rafQueue).toHaveLength(1);

    rafQueue.shift()?.(0);
    expect(fillCcGradientDither).toHaveBeenCalledTimes(1);

    resolveFirst();
    await Promise.resolve();
    await Promise.resolve();

    expect(rafQueue).toHaveLength(1);
    rafQueue.shift()?.(0);
    await Promise.resolve();

    expect(fillCcGradientDither).toHaveBeenCalledTimes(2);
  });

  it('keeps a stale cached cc preview visible without drawing mismatched live geometry', async () => {
    let resolveFirst!: () => void;
    fillCcGradientDither.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveFirst = resolve;
        })
    );

    const overlayCtx = makeMockContext();
    const overlayCanvas = document.createElement('canvas');
    overlayCanvas.width = 256;
    overlayCanvas.height = 256;
    (overlayCanvas as any).getContext = jest.fn(() => overlayCtx);

    const canvas = document.createElement('canvas');
    canvas.getBoundingClientRect = jest.fn(
      () => ({ left: 0, top: 0, width: 256, height: 256, right: 256, bottom: 256 } as DOMRect)
    );

    const deps = {
      canvasRef: { current: canvas },
      canvas: { zoom: 1 },
      pan: {
        screenToWorld: (x: number, y: number) => ({ x, y }),
        worldToScreen: (x: number, y: number) => ({ x, y }),
      },
      drawingHandlers: {
        continueShapeDrawing: jest.fn(),
        isDrawingShapeRef: { current: true },
        shapePointsRef: { current: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] },
        latestShapePixelSizeRef: { current: 1 },
        lastStablePressureRef: { current: 0.5 },
        hadValidShapePressureRef: { current: false },
        computeShapePixelSize: jest.fn(() => 1),
        ccShapePreviewCacheRef: { current: null },
      },
      dynamicDepsRef: { current: { currentBrushPresetId: 'color-cycle-gradient' } },
      currentBrushPresetId: 'color-cycle-gradient',
      tools: storeState.tools,
      overlayCanvasRef: { current: overlayCanvas },
      compositeCanvasRef: { current: null },
      compositeCanvasDirtyRef: { current: false },
      compositeLayersToCanvas: jest.fn(),
      setCurrentOffscreenCanvas: jest.fn(),
      project: { width: 256, height: 256 },
      stateMachine: { dispatch: jest.fn(), finalizationComplete: jest.fn(), state: { mode: 'IDLE' } },
      setNeedsRedraw: jest.fn(),
      viewTransformRef: { current: { scale: 1, offsetX: 0, offsetY: 0 } },
      sampleColorAtPosition: jest.fn(() => '#000000'),
      previewAnimationFrameRef: { current: null },
      layers: [],
      activeLayerId: null,
      interaction: { dispatch: jest.fn() },
      feedback: jest.fn(),
      palette: storeState.palette,
    } as any;

    const handler = createShapeToolHandler(
      {
        deps,
        overlayPreviewFrameMs: 0,
        getLastOverlayPreviewTs: () => 0,
        setLastOverlayPreviewTs: jest.fn(),
      },
      {}
    );

    const moveEvent = (x: number, y: number) =>
      ({
        clientX: x,
        clientY: y,
        buttons: 1,
        pointerType: 'mouse',
        pressure: 0.5,
        shiftKey: false,
        ctrlKey: false,
        target: canvas,
      }) as any;

    handler.handlePointerMove(moveEvent(20, 20));
    rafQueue.shift()?.(0);
    await Promise.resolve();

    resolveFirst();
    await Promise.resolve();
    await Promise.resolve();

    (overlayCtx.clearRect as jest.Mock).mockClear();
    (overlayCtx.drawImage as jest.Mock).mockClear();
    (overlayCtx.beginPath as jest.Mock).mockClear();

    handler.handlePointerMove(moveEvent(30, 30));
    rafQueue.shift()?.(0);

    expect(overlayCtx.clearRect as jest.Mock).toHaveBeenCalled();
    expect(overlayCtx.drawImage as jest.Mock).toHaveBeenCalled();
    expect(overlayCtx.beginPath as jest.Mock).not.toHaveBeenCalled();
  });

  it('clears the CC preview immediately on pointer up', () => {
    const overlayCtx = makeMockContext();
    const overlayCanvas = document.createElement('canvas');
    overlayCanvas.width = 256;
    overlayCanvas.height = 256;
    (overlayCanvas as any).getContext = jest.fn(() => overlayCtx);

    const canvas = document.createElement('canvas');
    canvas.getBoundingClientRect = jest.fn(
      () => ({ left: 0, top: 0, width: 256, height: 256, right: 256, bottom: 256 } as DOMRect)
    );

    const deps = {
      canvasRef: { current: canvas },
      canvas: { zoom: 1 },
      pan: {
        screenToWorld: (x: number, y: number) => ({ x, y }),
        worldToScreen: (x: number, y: number) => ({ x, y }),
      },
      drawingHandlers: {
        continueShapeDrawing: jest.fn(),
        isDrawingShapeRef: { current: true },
        shapePointsRef: { current: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] },
        latestShapePixelSizeRef: { current: 1 },
        lastStablePressureRef: { current: 0.5 },
        hadValidShapePressureRef: { current: false },
        computeShapePixelSize: jest.fn(() => 1),
        ccShapePreviewCacheRef: { current: null },
      },
      dynamicDepsRef: { current: { currentBrushPresetId: 'color-cycle-gradient' } },
      currentBrushPresetId: 'color-cycle-gradient',
      tools: storeState.tools,
      overlayCanvasRef: { current: overlayCanvas },
      compositeCanvasRef: { current: null },
      compositeCanvasDirtyRef: { current: false },
      compositeLayersToCanvas: jest.fn(),
      setCurrentOffscreenCanvas: jest.fn(),
      project: { width: 256, height: 256 },
      stateMachine: { dispatch: jest.fn(), finalizationComplete: jest.fn(), state: { mode: 'IDLE' } },
      setNeedsRedraw: jest.fn(),
      viewTransformRef: { current: { scale: 1, offsetX: 0, offsetY: 0 } },
      sampleColorAtPosition: jest.fn(() => '#000000'),
      previewAnimationFrameRef: { current: 7 },
      layers: [],
      activeLayerId: null,
      interaction: { dispatch: jest.fn() },
      feedback: jest.fn(),
      palette: storeState.palette,
    } as any;

    const handler = createShapeToolHandler(
      {
        deps,
        overlayPreviewFrameMs: 0,
        getLastOverlayPreviewTs: () => 0,
        setLastOverlayPreviewTs: jest.fn(),
      },
      {}
    );

    const pointerUpEvent = {
      clientX: 20,
      clientY: 20,
      buttons: 0,
      pointerType: 'mouse',
      pressure: 0,
      shiftKey: false,
      ctrlKey: false,
      target: canvas,
    } as any;

    handler.handlePointerUp(pointerUpEvent);

    expect(cancelAnimationFrameMock).toHaveBeenCalledWith(7);
    expect(deps.previewAnimationFrameRef.current).toBeNull();
    expect(overlayCtx.clearRect).toHaveBeenCalled();
  });

  it('defers sampled cc preview recompute until after the live preview frame', async () => {
    jest.useFakeTimers();
    fillCcGradientDither.mockResolvedValueOnce();

    const overlayCtx = makeMockContext();
    const overlayCanvas = document.createElement('canvas');
    overlayCanvas.width = 256;
    overlayCanvas.height = 256;
    (overlayCanvas as any).getContext = jest.fn(() => overlayCtx);

    runSampledCcDitherPreviewRuntime({
      overlayCtx,
      overlayCanvas,
      committedPolygon: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
      brushSettings: {
        ...storeState.tools.brushSettings,
        ccGradientSource: 'sampled',
      },
      ditherGradPreviewState: {
        origin: null,
        lastPx: -1,
        resState: {} as any,
        ccJobInFlight: false,
        ccJobDirty: false,
        ccJobSeq: 0,
      },
      drawingHandlers: {
        isDrawingShapeRef: { current: true },
        shapePointsRef: { current: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] },
        ccShapePreviewCacheRef: { current: null },
      },
      shouldKeepCachedCcPreviewVisible: () => false,
      previewOpacity: 0.8,
      previewRenderSettings: {
        pixelSize: 1,
        levels: 8,
        algorithm: 'sierra-lite',
        patternStyle: 'dots',
        isFastPreview: false,
      },
      sampleColor: jest.fn(() => '#000000'),
      fallbackStops: [
        { position: 0, color: '#000000' },
        { position: 1, color: '#ffffff' },
      ],
      schedulePolygonShapePreviewFrame: jest.fn(),
      getLatestPolygonPreviewPoint: () => ({ x: 10, y: 10 }),
    });

    expect(buildSampledStops).not.toHaveBeenCalled();
    expect(fillCcGradientDither).not.toHaveBeenCalled();

    jest.runOnlyPendingTimers();
    await Promise.resolve();
    await Promise.resolve();

    expect(buildSampledStops).toHaveBeenCalledTimes(1);
    expect(fillCcGradientDither).toHaveBeenCalledTimes(1);
  });

  it('does not publish a sampled preview result after the preview seq is invalidated', async () => {
    jest.useFakeTimers();
    let resolveFill!: () => void;
    fillCcGradientDither.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveFill = resolve;
        })
    );

    const overlayCtx = makeMockContext();
    const overlayCanvas = document.createElement('canvas');
    overlayCanvas.width = 256;
    overlayCanvas.height = 256;
    (overlayCanvas as any).getContext = jest.fn(() => overlayCtx);

    const previewState = {
      origin: null,
      lastPx: -1,
      resState: {} as any,
      ccJobInFlight: false,
      ccJobDirty: false,
      ccJobSeq: 0,
    } as any;
    const cacheRef = { current: null as any };

    runSampledCcDitherPreviewRuntime({
      overlayCtx,
      overlayCanvas,
      committedPolygon: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
      brushSettings: {
        ...storeState.tools.brushSettings,
        ccGradientSource: 'sampled',
      },
      ditherGradPreviewState: previewState,
      drawingHandlers: {
        isDrawingShapeRef: { current: true },
        shapePointsRef: { current: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] },
        ccShapePreviewCacheRef: cacheRef,
      },
      shouldKeepCachedCcPreviewVisible: () => false,
      previewOpacity: 0.8,
      previewRenderSettings: {
        pixelSize: 1,
        levels: 8,
        algorithm: 'sierra-lite',
        patternStyle: 'dots',
        isFastPreview: false,
      },
      sampleColor: jest.fn(() => '#000000'),
      fallbackStops: [
        { position: 0, color: '#000000' },
        { position: 1, color: '#ffffff' },
      ],
      schedulePolygonShapePreviewFrame: jest.fn(),
      getLatestPolygonPreviewPoint: () => ({ x: 10, y: 10 }),
    });

    jest.runOnlyPendingTimers();
    await Promise.resolve();
    expect(fillCcGradientDither).toHaveBeenCalledTimes(1);

    previewState.ccJobSeq += 1;
    previewState.ccPendingSampledRequest = undefined;
    resolveFill();
    await Promise.resolve();
    await Promise.resolve();

    expect(cacheRef.current).toBeNull();
    expect(previewState.ccLastReplayKey).toBeUndefined();
  });

  it('renders CC dither previews at reduced cell resolution before scaling back to the ROI', async () => {
    fillCcGradientDither.mockResolvedValueOnce();

    const overlayCtx = makeMockContext();
    const overlayCanvas = document.createElement('canvas');
    overlayCanvas.width = 512;
    overlayCanvas.height = 512;
    (overlayCanvas as any).getContext = jest.fn(() => overlayCtx);

    const canvas = document.createElement('canvas');
    canvas.getBoundingClientRect = jest.fn(
      () => ({ left: 0, top: 0, width: 512, height: 512, right: 512, bottom: 512 } as DOMRect)
    );

    storeState.tools.brushSettings.fillResolution = 8;

    const deps = {
      canvasRef: { current: canvas },
      canvas: { zoom: 1 },
      pan: {
        screenToWorld: (x: number, y: number) => ({ x, y }),
        worldToScreen: (x: number, y: number) => ({ x, y }),
      },
      drawingHandlers: {
        continueShapeDrawing: jest.fn(),
        isDrawingShapeRef: { current: true },
        shapePointsRef: {
          current: [
            { x: 0, y: 0 },
            { x: 240, y: 0 },
            { x: 240, y: 240 },
            { x: 0, y: 240 },
          ],
        },
        latestShapePixelSizeRef: { current: 8 },
        lastStablePressureRef: { current: 0.5 },
        hadValidShapePressureRef: { current: false },
        computeShapePixelSize: jest.fn(() => 8),
        ccShapePreviewCacheRef: { current: null },
      },
      dynamicDepsRef: { current: { currentBrushPresetId: 'color-cycle-gradient' } },
      currentBrushPresetId: 'color-cycle-gradient',
      tools: storeState.tools,
      overlayCanvasRef: { current: overlayCanvas },
      compositeCanvasRef: { current: null },
      compositeCanvasDirtyRef: { current: false },
      compositeLayersToCanvas: jest.fn(),
      setCurrentOffscreenCanvas: jest.fn(),
      project: { width: 512, height: 512 },
      stateMachine: { dispatch: jest.fn(), finalizationComplete: jest.fn(), state: { mode: 'IDLE' } },
      setNeedsRedraw: jest.fn(),
      viewTransformRef: { current: { scale: 1, offsetX: 0, offsetY: 0 } },
      sampleColorAtPosition: jest.fn(() => '#000000'),
      previewAnimationFrameRef: { current: null },
      layers: [],
      activeLayerId: null,
      interaction: { dispatch: jest.fn() },
      feedback: jest.fn(),
      palette: storeState.palette,
    } as any;

    const handler = createShapeToolHandler(
      {
        deps,
        overlayPreviewFrameMs: 0,
        getLastOverlayPreviewTs: () => 0,
        setLastOverlayPreviewTs: jest.fn(),
      },
      {}
    );

    handler.handlePointerMove(
      ({
        clientX: 250,
        clientY: 250,
        buttons: 1,
        pointerType: 'mouse',
        pressure: 0.5,
        shiftKey: false,
        ctrlKey: false,
        target: canvas,
      }) as any
    );

    expect(rafQueue).toHaveLength(1);
    rafQueue.shift()?.(0);
    await Promise.resolve();
    await Promise.resolve();

    expect(fillCcGradientDither).toHaveBeenCalledTimes(1);
    expect(fillCcGradientDither.mock.calls[0][0]).toMatchObject({
      minX: 0,
      minY: 0,
      maxX: 30,
      maxY: 30,
      pixelSize: 1,
    });
  });

  it('caps oversized CC preview polygons before dispatching the dither job', async () => {
    fillCcGradientDither.mockResolvedValueOnce();

    const overlayCtx = makeMockContext();
    const overlayCanvas = document.createElement('canvas');
    overlayCanvas.width = 512;
    overlayCanvas.height = 512;
    (overlayCanvas as any).getContext = jest.fn(() => overlayCtx);

    const canvas = document.createElement('canvas');
    canvas.getBoundingClientRect = jest.fn(
      () => ({ left: 0, top: 0, width: 512, height: 512, right: 512, bottom: 512 } as DOMRect)
    );

    const densePolygon = Array.from({ length: 600 }, (_, index) => {
      const angle = (index / 600) * Math.PI * 2;
      return {
        x: 220 + Math.cos(angle) * 140,
        y: 220 + Math.sin(angle) * 140,
      };
    });

    const deps = {
      canvasRef: { current: canvas },
      canvas: { zoom: 1 },
      pan: {
        screenToWorld: (x: number, y: number) => ({ x, y }),
        worldToScreen: (x: number, y: number) => ({ x, y }),
      },
      drawingHandlers: {
        continueShapeDrawing: jest.fn(),
        isDrawingShapeRef: { current: true },
        shapePointsRef: { current: densePolygon },
        latestShapePixelSizeRef: { current: 1 },
        lastStablePressureRef: { current: 0.5 },
        hadValidShapePressureRef: { current: false },
        computeShapePixelSize: jest.fn(() => 1),
        ccShapePreviewCacheRef: { current: null },
      },
      dynamicDepsRef: { current: { currentBrushPresetId: 'color-cycle-gradient' } },
      currentBrushPresetId: 'color-cycle-gradient',
      tools: storeState.tools,
      overlayCanvasRef: { current: overlayCanvas },
      compositeCanvasRef: { current: null },
      compositeCanvasDirtyRef: { current: false },
      compositeLayersToCanvas: jest.fn(),
      setCurrentOffscreenCanvas: jest.fn(),
      project: { width: 512, height: 512 },
      stateMachine: { dispatch: jest.fn(), finalizationComplete: jest.fn(), state: { mode: 'IDLE' } },
      setNeedsRedraw: jest.fn(),
      viewTransformRef: { current: { scale: 1, offsetX: 0, offsetY: 0 } },
      sampleColorAtPosition: jest.fn(() => '#000000'),
      previewAnimationFrameRef: { current: null },
      layers: [],
      activeLayerId: null,
      interaction: { dispatch: jest.fn() },
      feedback: jest.fn(),
      palette: storeState.palette,
    } as any;

    const handler = createShapeToolHandler(
      {
        deps,
        overlayPreviewFrameMs: 0,
        getLastOverlayPreviewTs: () => 0,
        setLastOverlayPreviewTs: jest.fn(),
      },
      {}
    );

    handler.handlePointerMove(
      ({
        clientX: 360,
        clientY: 220,
        buttons: 1,
        pointerType: 'mouse',
        pressure: 0.5,
        shiftKey: false,
        ctrlKey: false,
        target: canvas,
      }) as any
    );

    expect(rafQueue).toHaveLength(1);
    rafQueue.shift()?.(0);
    await Promise.resolve();
    await Promise.resolve();

    expect(fillCcGradientDither).toHaveBeenCalledTimes(1);
    const callArgs = fillCcGradientDither.mock.calls[0]?.[0] as { vertices: Array<{ x: number; y: number }> };
    expect(callArgs).toBeDefined();
    const { vertices } = callArgs;
    expect(vertices.length).toBeLessThanOrEqual(256);
  });

  it('caps oversized CC preview render buffers by increasing preview scale', async () => {
    fillCcGradientDither.mockResolvedValueOnce();

    const overlayCtx = makeMockContext();
    const overlayCanvas = document.createElement('canvas');
    overlayCanvas.width = 2048;
    overlayCanvas.height = 2048;
    (overlayCanvas as any).getContext = jest.fn(() => overlayCtx);

    const canvas = document.createElement('canvas');
    canvas.getBoundingClientRect = jest.fn(
      () => ({ left: 0, top: 0, width: 2048, height: 2048, right: 2048, bottom: 2048 } as DOMRect)
    );

    const deps = {
      canvasRef: { current: canvas },
      canvas: { zoom: 1 },
      pan: {
        screenToWorld: (x: number, y: number) => ({ x, y }),
        worldToScreen: (x: number, y: number) => ({ x, y }),
      },
      drawingHandlers: {
        continueShapeDrawing: jest.fn(),
        isDrawingShapeRef: { current: true },
        shapePointsRef: {
          current: [
            { x: 0, y: 0 },
            { x: 1800, y: 0 },
            { x: 1800, y: 1800 },
            { x: 0, y: 1800 },
          ],
        },
        latestShapePixelSizeRef: { current: 1 },
        lastStablePressureRef: { current: 0.5 },
        hadValidShapePressureRef: { current: false },
        computeShapePixelSize: jest.fn(() => 1),
        ccShapePreviewCacheRef: { current: null },
      },
      dynamicDepsRef: { current: { currentBrushPresetId: 'color-cycle-gradient' } },
      currentBrushPresetId: 'color-cycle-gradient',
      tools: storeState.tools,
      overlayCanvasRef: { current: overlayCanvas },
      compositeCanvasRef: { current: null },
      compositeCanvasDirtyRef: { current: false },
      compositeLayersToCanvas: jest.fn(),
      setCurrentOffscreenCanvas: jest.fn(),
      project: { width: 2048, height: 2048 },
      stateMachine: { dispatch: jest.fn(), finalizationComplete: jest.fn(), state: { mode: 'IDLE' } },
      setNeedsRedraw: jest.fn(),
      viewTransformRef: { current: { scale: 1, offsetX: 0, offsetY: 0 } },
      sampleColorAtPosition: jest.fn(() => '#000000'),
      previewAnimationFrameRef: { current: null },
      layers: [],
      activeLayerId: null,
      interaction: { dispatch: jest.fn() },
      feedback: jest.fn(),
      palette: storeState.palette,
    } as any;

    const handler = createShapeToolHandler(
      {
        deps,
        overlayPreviewFrameMs: 0,
        getLastOverlayPreviewTs: () => 0,
        setLastOverlayPreviewTs: jest.fn(),
      },
      {}
    );

    handler.handlePointerMove(
      ({
        clientX: 1800,
        clientY: 1800,
        buttons: 1,
        pointerType: 'mouse',
        pressure: 0.5,
        shiftKey: false,
        ctrlKey: false,
        target: canvas,
      }) as any
    );

    expect(rafQueue).toHaveLength(1);
    rafQueue.shift()?.(0);
    await Promise.resolve();
    await Promise.resolve();

    expect(fillCcGradientDither).toHaveBeenCalledTimes(1);
    expect(fillCcGradientDither.mock.calls[0][0]).toMatchObject({
      minX: 0,
      minY: 0,
      maxX: 450,
      maxY: 450,
    });
  });
});
