/* eslint-disable @typescript-eslint/no-explicit-any */
import { createShapeToolHandler } from '../ShapeToolHandler';
import { BrushShape } from '@/types';

const fillCcGradientDither = jest.fn<Promise<void>, [unknown]>();

jest.mock('@/utils/colorCycle/ccGradientDither', () => ({
  fillCcGradientDither: (...args: unknown[]) => fillCcGradientDither(...(args as [unknown])),
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

  beforeEach(() => {
    fillCcGradientDither.mockReset();
    rafQueue.length = 0;
    rafId = 1;
    originalRaf = global.requestAnimationFrame;
    global.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      return rafId++;
    }) as typeof requestAnimationFrame;
  });

  afterEach(() => {
    global.requestAnimationFrame = originalRaf;
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
});
