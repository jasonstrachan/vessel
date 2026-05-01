import {
  createSelectionHandlers,
  finalizeClickLineSelectionSession,
} from '@/hooks/canvas/handlers/selectionHandlers';
import type { SelectionHandlerDeps } from '@/hooks/canvas/handlers/selectionHandlers';
import type { EventHandlerDynamicDeps } from '@/hooks/canvas/utils/types';
import type { BrushSettings, PaletteState, PolygonGradientState } from '@/types';
import { BrushShape } from '@/types';
import { useAppStore } from '@/stores/useAppStore';

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
    expect(setSelectionBounds).toHaveBeenCalledWith(
      { x: 10, y: 10 },
      { x: 98, y: 40 },
      'selection-marquee-preview'
    );
    expect(rafCallbacks).toHaveLength(1);

    rafCallbacks[0](16);

    expect(setPan).toHaveBeenCalled();
    expect(panState.offsetX).toBeLessThan(0);
    expect(setSelectionBounds).toHaveBeenLastCalledWith(
      { x: 10, y: 10 },
      expect.objectContaining({ x: expect.any(Number), y: 40 }),
      'selection-marquee-preview'
    );
    const latestEnd = setSelectionBounds.mock.calls.at(-1)?.[1];
    expect(latestEnd?.x).toBeGreaterThan(98);
    expect(draw).toHaveBeenCalled();
  });
});

describe('selectionHandlers append selection', () => {
  afterEach(() => {
    useAppStore.getState().clearSelection();
    jest.restoreAllMocks();
  });

  it('appends marquee bounds when Shift is held on pointer up', () => {
    const dynamic = createDynamicDeps();
    const deps: SelectionHandlerDeps = {
      interaction: {
        state: { isDrawing: false, isSelecting: true, drawingMode: 'idle' },
        dispatch: jest.fn(),
        refs: {
          selectionStart: { current: { x: 10, y: 10 } },
        },
      },
      setSelectionBounds: jest.fn(),
      clearSelection: jest.fn(),
      setShowBrushCursor: jest.fn(),
      canvasRef: { current: createCanvas() },
      overlayCanvasRef: { current: createCanvas() },
      viewTransformRef: { current: { scale: 1, offsetX: 0, offsetY: 0 } },
      pan: {
        screenToWorld: (x, y) => ({ x, y }),
      },
      draw: jest.fn(),
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

    useAppStore.setState({
      selectionStart: { x: 0, y: 0 },
      selectionEnd: { x: 5, y: 5 },
      selectionMask: null,
      selectionMaskBounds: null,
      selectionMaskLayerId: null,
    });

    const handlers = createSelectionHandlers(deps, () => dynamic);
    const handled = handlers.handleSelectionPointerUp({
      event: {
        pointerId: 1,
        shiftKey: true,
      } as React.PointerEvent<Element>,
      worldPos: { x: 20, y: 20 },
      dynamic,
    });

    expect(handled).toBe(true);
    expect(useAppStore.getState().selectionMaskBounds).toEqual({ x: 0, y: 0, width: 20, height: 20 });
  });

  it('appends click-line masks when Shift is held', () => {
    useAppStore.setState({
      selectionStart: { x: 0, y: 0 },
      selectionEnd: { x: 2, y: 2 },
      selectionMask: null,
      selectionMaskBounds: null,
      selectionMaskLayerId: null,
    });

    const dynamic = createDynamicDeps();
    const runtime = {
      pendingSelectionHistory: null,
      freehandSession: { active: false, points: [] },
      clickLineSession: {
        active: true,
        points: [
          { x: 10, y: 10 },
          { x: 12, y: 10 },
          { x: 12, y: 12 },
        ],
      },
      marqueeAutoPan: { frameId: null, screenPos: null },
    };

    const handled = finalizeClickLineSelectionSession({
      runtime,
      dynamic,
      outcome: 'selection-click-line',
      append: true,
    });

    expect(handled).toBe(true);
    expect(useAppStore.getState().selectionMaskBounds).toEqual({ x: 0, y: 0, width: 12, height: 12 });
  });

  it('appends freehand masks when Shift is held on pointer up', () => {
    useAppStore.setState({
      selectionStart: { x: 0, y: 0 },
      selectionEnd: { x: 2, y: 2 },
      selectionMask: null,
      selectionMaskBounds: null,
      selectionMaskLayerId: null,
    });

    const dynamic = {
      ...createDynamicDeps(),
      tools: {
        ...createDynamicDeps().tools,
        selectionMode: 'freehand',
      },
    };
    const deps: SelectionHandlerDeps = {
      interaction: {
        state: { isDrawing: false, isSelecting: true, drawingMode: 'idle' },
        dispatch: jest.fn(),
        refs: {
          selectionStart: { current: null },
        },
      },
      setSelectionBounds: jest.fn(),
      clearSelection: jest.fn(),
      setShowBrushCursor: jest.fn(),
      canvasRef: { current: createCanvas() },
      overlayCanvasRef: { current: createCanvas() },
      viewTransformRef: { current: { scale: 1, offsetX: 0, offsetY: 0 } },
      pan: {
        screenToWorld: (x, y) => ({ x, y }),
      },
      draw: jest.fn(),
      updateBrushCursorVisibility: jest.fn(),
      flushAndSetCurrentTool: jest.fn(),
      selectionRuntimeRef: {
        current: {
          pendingSelectionHistory: null,
          freehandSession: {
            active: true,
            points: [
              { x: 10, y: 10 },
              { x: 12, y: 10 },
            ],
          },
          clickLineSession: { active: false, points: [] },
          marqueeAutoPan: { frameId: null, screenPos: null },
        },
      },
    };

    const handlers = createSelectionHandlers(deps, () => dynamic as EventHandlerDynamicDeps);
    const handled = handlers.handleSelectionPointerUp({
      event: {
        pointerId: 2,
        shiftKey: true,
      } as React.PointerEvent<Element>,
      worldPos: { x: 12, y: 12 },
      dynamic: dynamic as EventHandlerDynamicDeps,
    });

    expect(handled).toBe(true);
    expect(useAppStore.getState().selectionMaskBounds).toEqual({ x: 0, y: 0, width: 12, height: 12 });
  });
});
