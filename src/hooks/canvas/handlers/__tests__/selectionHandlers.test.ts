import { createSelectionHandlers } from '@/hooks/canvas/handlers/selectionHandlers';
import type { SelectionHandlerDeps } from '@/hooks/canvas/handlers/selectionHandlers';
import type { EventHandlerDynamicDeps } from '@/hooks/canvas/utils/types';
import type { BrushSettings, PaletteState, PolygonGradientState } from '@/types';
import { BrushShape } from '@/types';

const createCanvas = () => {
  const canvas = document.createElement('canvas') as HTMLCanvasElement & {
    getContext: jest.Mock;
    getBoundingClientRect: () => DOMRect;
  };

  canvas.getContext = jest.fn(() => ({
    clearRect: jest.fn(),
  })) as unknown as jest.Mock;
  canvas.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0 } as DOMRect);

  return canvas;
};

const createDynamicDeps = (): EventHandlerDynamicDeps => ({
  project: {
    id: 'project-1',
    name: 'demo',
    width: 300,
    height: 200,
    layers: [],
    backgroundColor: '#000',
    createdAt: new Date(),
    updatedAt: new Date(),
    customBrushes: [],
    palette: { foregroundColor: '#000', backgroundColor: '#fff', activeSlot: 'foreground' },
  },
  canvas: { width: 100, height: 100, scale: 1, zoom: 1 },
  tools: {
    currentTool: 'selection',
    selectionMode: 'marquee',
    brushSettings: {
      brushShape: BrushShape.ROUND,
      pressureEnabled: false,
      contourSpacing: 5,
    } as BrushSettings,
    fillSettings: { threshold: 0, contiguous: true, eraseInstead: false },
    wandSettings: { threshold: 0, contiguous: true },
    eraserSettings: {},
    shapeMode: false,
    customBrushCapture: { freehandPath: null } as EventHandlerDynamicDeps['tools']['customBrushCapture'],
  },
  layers: [],
  activeLayerId: null,
  selectionStart: null,
  selectionEnd: null,
  selectionMask: null,
  selectionMaskBounds: null,
  floatingPaste: null,
  isDraggingFloatingPaste: false,
  palette: { foregroundColor: '#000', backgroundColor: '#fff', activeSlot: 'foreground' } as PaletteState,
  polygonGradientState: { drawingState: 'idle' } as PolygonGradientState,
  recolorSampling: { active: false, start: null, end: null, samples: 0, target: 'recolor' } as EventHandlerDynamicDeps['recolorSampling'],
  currentBrushPresetId: null,
});

describe('selectionHandlers marquee auto-pan', () => {
  const originalRequestAnimationFrame = global.requestAnimationFrame;
  const originalCancelAnimationFrame = global.cancelAnimationFrame;

  afterEach(() => {
    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
    jest.restoreAllMocks();
  });

  it('pans the viewport and extends marquee bounds while dragging near the canvas edge', () => {
    const canvas = createCanvas();
    const overlayCanvas = createCanvas();
    const dynamic = createDynamicDeps();
    const dynamicDepsRef = { current: dynamic };
    const rafCallbacks: FrameRequestCallback[] = [];
    const panState = { offsetX: 0, offsetY: 0 };
    const setSelectionBounds = jest.fn();
    const draw = jest.fn();
    const setPan = jest.fn((offsetX: number, offsetY: number) => {
      panState.offsetX = offsetX;
      panState.offsetY = offsetY;
    });

    global.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    }) as typeof requestAnimationFrame;
    global.cancelAnimationFrame = jest.fn() as typeof cancelAnimationFrame;

    const deps: SelectionHandlerDeps = {
      interaction: {
        state: { isDrawing: false, isSelecting: true, drawingMode: 'idle' },
        dispatch: jest.fn(),
        refs: {
          selectionStart: { current: { x: 10, y: 10 } },
        },
      },
      setSelectionBounds,
      clearSelection: jest.fn(),
      setShowBrushCursor: jest.fn(),
      canvasRef: { current: canvas },
      overlayCanvasRef: { current: overlayCanvas },
      viewTransformRef: { current: { scale: 1, offsetX: 0, offsetY: 0 } },
      pan: {
        setPan,
        screenToWorld: (x, y, scale = 1) => ({
          x: (x - panState.offsetX) / scale,
          y: (y - panState.offsetY) / scale,
        }),
      },
      setPan,
      draw,
      updateBrushCursorVisibility: jest.fn(),
      flushAndSetCurrentTool: jest.fn(),
      selectionRuntimeRef: {
        current: {
          pendingSelectionHistory: null,
          freehandSession: { active: false, points: [] },
          clickLineSession: { active: false, points: [] },
          marqueeAutoPan: { frameId: null, screenPos: null },
        },
      },
    };

    const handlers = createSelectionHandlers(deps, () => dynamicDepsRef.current);

    const handled = handlers.handleSelectionPointerMove({
      worldPos: { x: 98, y: 40 },
      screenPos: { x: 98, y: 40 },
    });

    expect(handled).toBe(true);
    expect(setSelectionBounds).toHaveBeenCalledWith({ x: 10, y: 10 }, { x: 98, y: 40 });
    expect(rafCallbacks).toHaveLength(1);

    rafCallbacks[0](16);

    expect(setPan).toHaveBeenCalled();
    expect(panState.offsetX).toBeLessThan(0);
    expect(setSelectionBounds).toHaveBeenLastCalledWith(
      { x: 10, y: 10 },
      expect.objectContaining({ x: expect.any(Number), y: 40 })
    );
    const latestEnd = setSelectionBounds.mock.calls.at(-1)?.[1];
    expect(latestEnd?.x).toBeGreaterThan(98);
    expect(draw).toHaveBeenCalled();
  });
});
