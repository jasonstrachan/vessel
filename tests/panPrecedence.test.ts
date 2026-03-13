import { TextDecoder, TextEncoder } from 'util';

(global as unknown as { TextEncoder?: typeof TextEncoder }).TextEncoder = TextEncoder;
(global as unknown as { TextDecoder?: typeof TextDecoder }).TextDecoder = TextDecoder;

import { createPointerHandlers, createDefaultContourLinesState } from '../src/hooks/canvas/handlers/pointerHandlers';
import type { EventHandlerDependencies, EventHandlerDynamicDeps } from '../src/hooks/canvas/utils/types';

function makeCanvas(width = 800, height = 600) {
  const canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'width', { value: width, writable: true });
  Object.defineProperty(canvas, 'height', { value: height, writable: true });
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width, height, right: width, bottom: height, x: 0, y: 0, toJSON(){} } as any);
  (canvas as any).getContext = () => ({}) as any;
  // Needed by pointer capture path
  (canvas as any).setPointerCapture = jest.fn();
  return canvas;
}

function makeDeps(overrides: Partial<EventHandlerDependencies> = {}): EventHandlerDependencies {
  const canvas = makeCanvas();
  const overlay = makeCanvas();
  const composite = makeCanvas();

  const panState = { offsetX: 0, offsetY: 0, isPanning: false };
  const dynamicDeps: EventHandlerDynamicDeps = {
    project: { width: 800, height: 600 },
    canvas: { width: 800, height: 600, scale: 1, zoom: 1 },
    tools: {
      currentTool: 'brush',
      selectionMode: 'marquee',
      brushSettings: {
        size: 10,
        color: '#000000',
        opacity: 1,
        brushShape: ({} as any).ROUND || 'round',
        pressureEnabled: false,
      },
      fillSettings: { threshold: 0, contiguous: true, eraseInstead: false },
      eraserSettings: { opacity: 1 },
      shapeMode: false,
    },
    layers: [],
    activeLayerId: null,
    selectionStart: null,
    selectionEnd: null,
    selectionMask: null,
    selectionMaskBounds: null,
    floatingPaste: null,
    isDraggingFloatingPaste: false,
  };

  const deps: any = {
    // Refs
    canvasRef: { current: canvas },
    wrapperRef: { current: document.createElement('div') },
    overlayCanvasRef: { current: overlay },
    compositeCanvasRef: { current: composite },
    dynamicDepsRef: { current: dynamicDeps },

    isBusyRef: { current: false },
    isMouseDownRef: { current: false },
    isSpacePressedRef: { current: false },
    drawAnimationFrameRef: { current: null },
    pointerMoveThrottled: { current: 0 },

    // Actions
    setSelectionBounds: jest.fn(),
    clearSelection: jest.fn(),
    setCurrentTool: jest.fn(),
    setCurrentOffscreenCanvas: jest.fn(),
    compositeLayersToCanvas: jest.fn(),
    updateLayer: jest.fn(),
    setFloatingPaste: jest.fn(),
    updateFloatingPastePosition: jest.fn(),
    commitFloatingPaste: jest.fn(),
    cancelFloatingPaste: jest.fn(),

    // Drawing state
    setIsDraggingFloatingPaste: jest.fn(),
    floatingPasteDragStart: { current: null },
    floatingPasteOriginalPos: { current: null },

    // Cursor state
    setCursorStyle: jest.fn(),
    setShowBrushCursor: jest.fn(),
    setCursorPosition: jest.fn(),

    // Hooks stubs
    interaction: { state: { isDrawing: false, isSelecting: false, mode: 'idle' }, dispatch: jest.fn(), refs: { selectionStart: { current: null }, drawAnimationFrame: { current: null }, lastDrawPos: { current: null }, drawingCanvas: { current: null }, drawingCanvasHasContent: { current: false }, isCapturing: { current: false } } },
    stateMachine: { dispatch: jest.fn(), state: { mode: 'IDLE' }, isAwaitingPan: false, isPanning: false, finalizationComplete: jest.fn() },
    pan: {
      panState,
      startPan: jest.fn(() => { panState.isPanning = true; }),
      updatePan: jest.fn(),
      endPan: jest.fn(() => { panState.isPanning = false; }),
      screenToWorld: (x: number, y: number, s: number) => ({ x: x / (s || 1), y: y / (s || 1) }),
      worldToScreen: (x: number, y: number, s: number) => ({ x: x * (s || 1), y: y * (s || 1) }),
    },
    toolStateMachine: { isRectangleGradient: false, isPolygonGradient: false, isColorCycleShape: false, isContourPolygon: false },
    drawingHandlers: {
      isDrawingShapeRef: { current: false },
      continueShapeDrawing: jest.fn(),
      startShapeDrawing: jest.fn(),
      drawingCanvasHasContent: { current: false },
      finalizeShapeDrawing: jest.fn().mockResolvedValue(undefined),
      updateDitherGradSamples: jest.fn(),
    },
    brushEngine: {},

    sampleColorAtPosition: jest.fn(() => '#000000'),
    sampleColorsAlongLine: jest.fn(() => ['#000000', '#ffffff']),
    getMousePos: jest.fn((e: any) => ({ x: e.clientX, y: e.clientY })),

    compositeCanvasDirtyRef: { current: false },
    setNeedsRedraw: jest.fn(),

    viewTransformRef: { current: { scale: 1, offsetX: 0, offsetY: 0 } },
    draw: jest.fn(),
    drawingAnimationFrameRef: { current: null },
    previewAnimationFrameRef: { current: null },

    defaultCursorStyle: 'none',
    restartColorCycleAnimation: jest.fn(),

    feedback: jest.fn(),

    snapStrokeStartRef: { current: null },
    snapShiftAnchorRef: { current: null },
    snapLastBrushSampleRef: { current: null },
    contourLinesStateRef: { current: createDefaultContourLinesState() },
    contourLinesDefaultsCacheRef: { current: null },
    contourLinesFinalizingRef: { current: false },
    suppressBootstrapUntilPointerUpRef: { current: false },
    selectionRuntimeRef: {
      current: {
        pendingSelectionHistory: null,
        freehandSession: { active: false, points: [] },
        clickLineSession: { active: false, points: [] },
      },
    },
    customFreehandCaptureRuntimeRef: {
      current: {
        active: false,
        pointerId: null,
        points: [],
        bounds: null,
      },
    },
  };

  deps.previewSessionIdRef = { current: 0 };
  deps.newPreviewSession = () => {
    deps.previewSessionIdRef.current += 1;
    deps.contourLinesFinalizingRef.current = false;
    return deps.previewSessionIdRef.current;
  };
  deps.isCurrentPreviewSession = (sessionId: number) => sessionId === deps.previewSessionIdRef.current;

  Object.defineProperties(deps, {
    project: {
      get: () => deps.dynamicDepsRef.current.project,
      set: (value) => { deps.dynamicDepsRef.current.project = value; },
    },
    canvas: {
      get: () => deps.dynamicDepsRef.current.canvas,
      set: (value) => { deps.dynamicDepsRef.current.canvas = value; },
    },
    tools: {
      get: () => deps.dynamicDepsRef.current.tools,
      set: (value) => { deps.dynamicDepsRef.current.tools = value; },
    },
    layers: {
      get: () => deps.dynamicDepsRef.current.layers,
      set: (value) => { deps.dynamicDepsRef.current.layers = value; },
    },
    activeLayerId: {
      get: () => deps.dynamicDepsRef.current.activeLayerId,
      set: (value) => { deps.dynamicDepsRef.current.activeLayerId = value; },
    },
    selectionStart: {
      get: () => deps.dynamicDepsRef.current.selectionStart,
      set: (value) => { deps.dynamicDepsRef.current.selectionStart = value; },
    },
    selectionEnd: {
      get: () => deps.dynamicDepsRef.current.selectionEnd,
      set: (value) => { deps.dynamicDepsRef.current.selectionEnd = value; },
    },
    floatingPaste: {
      get: () => deps.dynamicDepsRef.current.floatingPaste,
      set: (value) => { deps.dynamicDepsRef.current.floatingPaste = value; },
    },
    isDraggingFloatingPaste: {
      get: () => deps.dynamicDepsRef.current.isDraggingFloatingPaste,
      set: (value) => { deps.dynamicDepsRef.current.isDraggingFloatingPaste = value; },
    },
  });

  return { ...deps, ...overrides } as EventHandlerDependencies;
}

function makePointerEvent(type: 'down' | 'move' | 'up', target: HTMLCanvasElement, x = 100, y = 100): any {
  return {
    type,
    button: 0,
    clientX: x,
    clientY: y,
    pointerId: 1,
    pressure: 0.5,
    pointerType: 'mouse',
    preventDefault: jest.fn(),
    stopPropagation: jest.fn(),
    nativeEvent: { getCoalescedEvents: () => [] },
    target,
    currentTarget: target,
    // @ts-ignore
    persist: () => {},
    // setPointerCapture is called on pointerdown path
    // @ts-ignore
    setPointerCapture: jest.fn(),
  } as any;
}

describe('Space pan precedence', () => {
  it('starts pan on pointerdown when space is held (shape mode on) and skips shape branch', () => {
    const deps = makeDeps();
    (deps.dynamicDepsRef.current.tools as any).shapeMode = true;
    const { handlePointerDown } = createPointerHandlers(deps);

    deps.isSpacePressedRef.current = true;
    deps.isMouseDownRef.current = false;

    const evt = makePointerEvent('down', deps.canvasRef.current!);
    handlePointerDown(evt);

    expect(deps.pan.startPan).toHaveBeenCalled();
    expect(deps.drawingHandlers.startShapeDrawing).not.toHaveBeenCalled();
  });

  it('when already drawing shape, holding space then moving starts pan and does not add shape points', () => {
    const deps = makeDeps();
    (deps.dynamicDepsRef.current.tools as any).shapeMode = true;
    const { handlePointerMove } = createPointerHandlers(deps);

    deps.isMouseDownRef.current = true;
    deps.isSpacePressedRef.current = true;
    deps.drawingHandlers.isDrawingShapeRef.current = true; // simulate in-shape drawing

    const evt = makePointerEvent('move', deps.canvasRef.current!);
    handlePointerMove(evt);

    expect(deps.pan.startPan).toHaveBeenCalled();
    expect(deps.drawingHandlers.continueShapeDrawing).not.toHaveBeenCalled();
  });
});
