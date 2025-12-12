/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { createPointerHandlers } from '../pointerHandlers';
import { BrushShape, type Project } from '@/types';
import { RecolorManager } from '@/lib/colorCycle/RecolorManager';
import type { EventHandlerDynamicDeps, EventHandlerDependencies } from '../../utils/types';

type PartialDeps = Partial<EventHandlerDependencies>;
type PartialDynamic = Partial<EventHandlerDynamicDeps>;

const createCanvas = () => {
  const canvas = document.createElement('canvas') as HTMLCanvasElement & {
    getContext: (type: string) => CanvasRenderingContext2D | null;
    getBoundingClientRect: () => DOMRect;
  };

  canvas.getContext = jest.fn(() => ({
    clearRect: jest.fn(),
    save: jest.fn(),
    translate: jest.fn(),
    scale: jest.fn(),
    beginPath: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    closePath: jest.fn(),
    fill: jest.fn(),
    stroke: jest.fn(),
    restore: jest.fn(),
    fillRect: jest.fn(),
    drawImage: jest.fn(),
    getImageData: jest.fn(() => ({ data: new Uint8ClampedArray(), width: 0, height: 0 })),
    putImageData: jest.fn(),
    setLineDash: jest.fn(),
  })) as any;

  canvas.getBoundingClientRect = jest.fn(() =>
    ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0 } as DOMRect)
  );

  return canvas;
};

const mockProject: Project = {
  id: 'proj-1',
  name: 'demo',
  width: 100,
  height: 100,
  layers: [],
  backgroundColor: '#000000',
  createdAt: new Date(),
  updatedAt: new Date(),
  customBrushes: [],
  palette: { foregroundColor: '#000000', backgroundColor: '#ffffff', activeSlot: 'foreground' },
};

const baseDynamic: EventHandlerDynamicDeps = {
  project: mockProject,
  canvas: { width: 100, height: 100, scale: 1, zoom: 1 },
  tools: {
    currentTool: 'brush',
    brushSettings: {
      brushShape: BrushShape.ROUND,
      pressureEnabled: false,
      contourSpacing: 5,
    } as any,
    fillSettings: { threshold: 0, contiguous: true, eraseInstead: false },
    eraserSettings: {},
    shapeMode: false,
    customBrushCapture: { freehandPath: null } as any,
  },
  layers: [],
  activeLayerId: null,
  selectionStart: null,
  selectionEnd: null,
  selectionMask: null,
  selectionMaskBounds: null,
  floatingPaste: null,
  isDraggingFloatingPaste: false,
  palette: { activeSlot: 'foreground', foregroundColor: '#000000', backgroundColor: '#ffffff' } as any,
  polygonGradientState: { drawingState: 'idle' } as any,
  recolorSampling: { active: false, start: null, end: null, samples: 0, target: 'recolor' } as any,
  currentBrushPresetId: null,
};

const createDeps = (dynamicOverrides: PartialDynamic = {}, depOverrides: PartialDeps = {}) => {
  const project: Project = { ...mockProject, ...(dynamicOverrides.project as Partial<Project>) };
  const canvasState = { ...baseDynamic.canvas, ...dynamicOverrides.canvas } as any;
  const dynamic: EventHandlerDynamicDeps = {
    ...baseDynamic,
    ...dynamicOverrides,
    tools: { ...baseDynamic.tools, ...dynamicOverrides.tools },
    palette: { ...baseDynamic.palette, ...dynamicOverrides.palette },
    canvas: canvasState,
    project,
  };

  const dynamicDepsRef = { current: dynamic };
  const canvasEl = createCanvas();
  const overlay = createCanvas();
  const composite = createCanvas();

  const deps: EventHandlerDependencies = {
    canvasRef: { current: canvasEl },
    wrapperRef: { current: document.createElement('div') },
    overlayCanvasRef: { current: overlay },
    compositeCanvasRef: { current: composite },
    dynamicDepsRef,
    isBusyRef: { current: false },
    isMouseDownRef: { current: false },
    isSpacePressedRef: { current: false },
    drawAnimationFrameRef: { current: null },
    pointerMoveThrottled: { current: 0 },
    project: dynamic.project,
    canvas: dynamic.canvas,
    tools: dynamic.tools,
    layers: dynamic.layers,
    activeLayerId: dynamic.activeLayerId,
    selectionStart: dynamic.selectionStart,
    selectionEnd: dynamic.selectionEnd,
    floatingPaste: dynamic.floatingPaste,
    isDraggingFloatingPaste: dynamic.isDraggingFloatingPaste,
    palette: dynamic.palette,
    polygonGradientState: dynamic.polygonGradientState,
    recolorSampling: dynamic.recolorSampling,
    currentBrushPresetId: dynamic.currentBrushPresetId,
    setSelectionBounds: jest.fn(),
    clearSelection: jest.fn(),
    setCurrentTool: jest.fn(),
    setActiveColor: jest.fn(),
    setCurrentOffscreenCanvas: jest.fn(),
    compositeLayersToCanvas: jest.fn(),
    updateLayer: jest.fn(),
    setBrushSettings: jest.fn(),
    updateRecolorSampling: jest.fn(),
    stopRecolorSampling: jest.fn(),
    setRectangleBrushState: jest.fn(),
    setCustomBrushFreehandPath: jest.fn(),
    setFloatingPaste: jest.fn(),
    updateFloatingPastePosition: jest.fn(),
    commitFloatingPaste: jest.fn().mockResolvedValue(undefined),
    cancelFloatingPaste: jest.fn(),
    setIsDraggingFloatingPaste: jest.fn(),
    floatingPasteDragStart: { current: null },
    floatingPasteOriginalPos: { current: null },
    setCursorStyle: jest.fn(),
    setShowBrushCursor: jest.fn(),
    setCursorPosition: jest.fn(),
    interaction: {
      state: { isDrawing: false, isSelecting: false, mode: 'idle' } as any,
      dispatch: jest.fn(),
      refs: {
        selectionStart: { current: null },
        drawAnimationFrame: { current: null },
        lastDrawPos: { current: null },
        drawingCanvas: { current: null },
        drawingCanvasHasContent: { current: false },
        isCapturing: { current: false },
      },
    },
    stateMachine: {
      state: { mode: 'idle' },
      isAwaitingPan: false,
      isPanning: false,
      dispatch: jest.fn(),
      finalizationComplete: jest.fn(),
    } as any,
    pan: {
      panState: { isPanning: false, offsetX: 0, offsetY: 0 },
      screenToWorld: (x: number, y: number) => ({ x, y }),
      worldToScreen: (x: number, y: number) => ({ x, y }),
      startPan: jest.fn(),
      updatePan: jest.fn(),
      endPan: jest.fn(),
    } as any,
    toolStateMachine: {
      isRectangleGradient: false,
      isPolygonGradient: false,
      isColorCycleShape: false,
      isContourPolygon: false,
      rectangleBrushState: { drawingState: 'idle', startPos: { x: 0, y: 0 } },
      handleRectangleGradientMouseDown: jest.fn(),
      handleRectangleGradientMouseMove: jest.fn(),
      handleRectangleGradientMouseUp: jest.fn(),
      resetRectangleGradient: jest.fn(),
      resetPolygonGradient: jest.fn(),
    } as any,
    drawingHandlers: {
      setSimpleShapePreviewRenderer: jest.fn(),
      setContourLinesPreviewRenderer: jest.fn(),
      setContourLinesSnapRenderer: jest.fn(),
      clearOverlay: jest.fn(),
      isSelectingDirectionRef: { current: false },
      beginStrokeSession: jest.fn(),
      startDrawing: jest.fn(),
      startShapeDrawing: jest.fn(),
      continueDrawing: jest.fn(),
      continueShapeDrawing: jest.fn(),
      finalizeDrawing: jest.fn().mockResolvedValue(undefined),
      finalizeShapeDrawing: jest.fn(),
      endStrokeSession: jest.fn(),
      clearStrokeSession: jest.fn(),
      isDrawingShapeRef: { current: false },
      shapePointsRef: { current: [] },
      coerceDragShapeToPolygon: jest.fn(),
    } as any,
    brushEngine: null,
    sampleColorAtPosition: jest.fn().mockReturnValue('#000000'),
    sampleColorsAlongLine: jest.fn(),
    getMousePos: jest.fn(() => ({ x: 0, y: 0 })),
    compositeCanvasDirtyRef: { current: false },
    setNeedsRedraw: jest.fn(),
    setLayersNeedRecomposition: jest.fn(),
    viewTransformRef: { current: { scale: 1, offsetX: 0, offsetY: 0 } },
    draw: jest.fn(),
    drawingAnimationFrameRef: { current: null },
    previewAnimationFrameRef: { current: null },
    snapStrokeStartRef: { current: null },
    snapShiftAnchorRef: { current: null },
    snapLastBrushSampleRef: { current: null },
    restartColorCycleAnimation: jest.fn(),
    pauseAnimationForPan: jest.fn(),
    resumeAnimationAfterPan: jest.fn(),
    previewSessionIdRef: { current: 0 },
    newPreviewSession: jest.fn(() => 1),
    isCurrentPreviewSession: jest.fn(() => true),
    contourLinesStateRef: { current: { stage: 'idle', shapePoints: [], randomSeed: null } as any },
    contourLinesDefaultsCacheRef: { current: null },
    contourLinesFinalizingRef: { current: false },
    defaultCursorStyle: 'none',
    ...depOverrides,
  };

  return { deps, dynamicDepsRef };
};

const makePointerEvent = (overrides: Partial<React.PointerEvent<HTMLCanvasElement>> = {}) => ({
  preventDefault: jest.fn(),
  clientX: 10,
  clientY: 10,
  button: 0,
  pointerId: 1,
  pointerType: 'mouse',
  shiftKey: false,
  ctrlKey: false,
  target: {
    setPointerCapture: jest.fn(),
    releasePointerCapture: jest.fn(),
    hasPointerCapture: jest.fn().mockReturnValue(true),
  },
  persist: jest.fn(),
  nativeEvent: { getCoalescedEvents: () => [] as any[] } as any,
  ...overrides,
} as unknown as React.PointerEvent<HTMLCanvasElement>);

describe('pointerHandlers main flows', () => {
  const originalRaf = global.requestAnimationFrame;

  beforeAll(() => {
    global.requestAnimationFrame = (cb: FrameRequestCallback): number => {
      cb(performance.now());
      return 1;
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    global.requestAnimationFrame = originalRaf;
  });

  it('skips pointer down when busy and not adjusting', () => {
    const { deps } = createDeps();
    deps.isBusyRef.current = true;
    const handlers = createPointerHandlers(deps);

    handlers.handlePointerDown(makePointerEvent());

    expect(deps.isMouseDownRef.current).toBe(false);
    expect(deps.setCursorStyle).not.toHaveBeenCalled();
  });

  it('starts panning when space is held', () => {
    const { deps } = createDeps();
    deps.isSpacePressedRef.current = true;
    const handlers = createPointerHandlers(deps);

    handlers.handlePointerDown(makePointerEvent({ clientX: 25, clientY: 30 }));

    expect(deps.pan.startPan).toHaveBeenCalledWith(25, 30);
    expect(deps.setCursorStyle).toHaveBeenCalledWith('grabbing');
    expect(deps.setShowBrushCursor).toHaveBeenCalledWith(false);
    expect(deps.pauseAnimationForPan).toHaveBeenCalled();
  });

  it('applies color picker sample and hides brush cursor', () => {
    const { deps, dynamicDepsRef } = createDeps({
      tools: {
        ...baseDynamic.tools,
        currentTool: 'color-picker',
      },
    });

    const sampled = '#112233';
    deps.sampleColorAtPosition = jest.fn(() => sampled);
    dynamicDepsRef.current.tools.currentTool = 'color-picker';
    deps.tools = dynamicDepsRef.current.tools;

    const handlers = createPointerHandlers(deps);
    handlers.handlePointerDown(makePointerEvent({ clientX: 5, clientY: 5 }));

    expect(deps.setActiveColor).toHaveBeenCalledWith(sampled.toLowerCase());
    expect(deps.setCursorStyle).toHaveBeenCalledWith('crosshair');
    expect(deps.setShowBrushCursor).toHaveBeenCalledWith(false);
  });

  it('shows brush-size cursor for pixel-dither stroke (non-shape)', () => {
    const { deps, dynamicDepsRef } = createDeps({
      tools: {
        ...baseDynamic.tools,
        currentTool: 'brush',
        shapeMode: false,
        brushSettings: {
          ...baseDynamic.tools.brushSettings,
          brushShape: BrushShape.PIXEL_DITHER,
          shapeEnabled: false,
        } as any,
      },
    });

    dynamicDepsRef.current.tools = deps.tools;
    const handlers = createPointerHandlers(deps);

    handlers.handlePointerDown(makePointerEvent({ clientX: 10, clientY: 10 }));

    expect(deps.setCursorStyle).toHaveBeenCalledWith('none');
    expect(deps.setShowBrushCursor).toHaveBeenCalledWith(true);
  });

  it('uses crosshair cursor for pixel-dither shape mode', () => {
    const { deps, dynamicDepsRef } = createDeps({
      tools: {
        ...baseDynamic.tools,
        currentTool: 'brush',
        shapeMode: true,
        brushSettings: {
          ...baseDynamic.tools.brushSettings,
          brushShape: BrushShape.PIXEL_DITHER,
          shapeEnabled: true,
        } as any,
      },
    });

    dynamicDepsRef.current.tools = deps.tools;
    const handlers = createPointerHandlers(deps);

    handlers.handlePointerDown(makePointerEvent({ clientX: 12, clientY: 12 }));

    expect(deps.setCursorStyle).toHaveBeenCalledWith('crosshair');
    expect(deps.setShowBrushCursor).toHaveBeenCalledWith(false);
  });

  it('clears selection when clicking outside marquee', () => {
    const { deps, dynamicDepsRef } = createDeps({
      tools: {
        ...baseDynamic.tools,
        currentTool: 'selection',
      },
      selectionStart: { x: 0, y: 0 },
      selectionEnd: { x: 5, y: 5 },
    });

    dynamicDepsRef.current.tools.currentTool = 'selection';
    deps.tools = dynamicDepsRef.current.tools;
    deps.selectionStart = { x: 0, y: 0 } as any;
    deps.selectionEnd = { x: 5, y: 5 } as any;

    const handlers = createPointerHandlers(deps);
    handlers.handlePointerDown(makePointerEvent({ clientX: 90, clientY: 90 }));

    expect(deps.clearSelection).toHaveBeenCalledTimes(1);
    expect(deps.isMouseDownRef.current).toBe(false);
  });

  it('blocks mismatched brush/layer with feedback', () => {
    const feedback = jest.fn();
    const { deps, dynamicDepsRef } = createDeps({
      layers: [{ id: 'cc', layerType: 'color-cycle' } as any],
      activeLayerId: 'cc',
      tools: {
        ...baseDynamic.tools,
        currentTool: 'brush',
        shapeMode: false,
        brushSettings: { ...baseDynamic.tools.brushSettings, brushShape: BrushShape.ROUND },
      },
    }, {
      feedback,
      stateMachine: { state: { mode: 'IDLE' }, isAwaitingPan: false, isPanning: false, dispatch: jest.fn(), finalizationComplete: jest.fn() } as any,
    });

    dynamicDepsRef.current.tools.currentTool = 'brush';
    deps.tools = dynamicDepsRef.current.tools;

    const handlers = createPointerHandlers(deps);
    handlers.handlePointerDown(makePointerEvent({ clientX: 15, clientY: 15 }));

    expect(feedback).toHaveBeenCalledWith(expect.stringContaining("Color Cycle layer"));
    expect(deps.drawingHandlers.beginStrokeSession).not.toHaveBeenCalled();
  });

  it('starts floating paste drag when clicking inside paste', () => {
    const { deps } = createDeps({
      floatingPaste: {
        active: true,
        imageData: null,
        position: { x: 10, y: 10 },
        width: 20,
        height: 30,
        displayWidth: 20,
        displayHeight: 30,
        originalPosition: { x: 10, y: 10 },
      } as any,
    });

    const handlers = createPointerHandlers(deps);
    handlers.handlePointerDown(makePointerEvent({ clientX: 12, clientY: 12 }));

    expect(deps.setIsDraggingFloatingPaste).toHaveBeenCalledWith(true);
    expect(deps.setCursorStyle).toHaveBeenCalledWith('move');
    expect(deps.floatingPasteDragStart.current).toMatchObject({ x: 12, y: 12 });
    expect(deps.floatingPasteOriginalPos.current).toMatchObject({ x: 10, y: 10 });
  });

  it('begins recolor sampling when active', () => {
    const { deps, dynamicDepsRef } = createDeps({
      recolorSampling: { active: true, start: null, end: null, samples: 8, target: 'recolor' } as any,
    });

    dynamicDepsRef.current.recolorSampling = { active: true, start: null, end: null, samples: 8, target: 'recolor' } as any;
    deps.recolorSampling = dynamicDepsRef.current.recolorSampling;

    const handlers = createPointerHandlers(deps);

    handlers.handlePointerDown(makePointerEvent({ clientX: 30, clientY: 40 }));

    expect(deps.updateRecolorSampling).toHaveBeenCalledWith({ start: { x: 30, y: 40 }, end: null });
    const ctx = (deps.overlayCanvasRef.current!.getContext as jest.Mock).mock.results[0].value as any;
    expect(ctx.clearRect).toHaveBeenCalled();
  });

  it('handles contour spacing adjust session routing', () => {
    const { deps, dynamicDepsRef } = createDeps({
      polygonGradientState: { drawingState: 'adjustingSpacing' } as any,
      tools: {
        ...baseDynamic.tools,
        brushSettings: { ...baseDynamic.tools.brushSettings, brushShape: BrushShape.CONTOUR_LINES2 },
      },
    });

    dynamicDepsRef.current.polygonGradientState = { drawingState: 'adjustingSpacing' } as any;
    deps.polygonGradientState = dynamicDepsRef.current.polygonGradientState;

    const handlers = createPointerHandlers(deps);
    handlers.handlePointerDown(makePointerEvent({ clientX: 5, clientY: 5 }));

    expect(deps.toolStateMachine.handleRectangleGradientMouseDown).not.toHaveBeenCalled();
  });

  it('clears selection when mask hit test fails', () => {
    const mask = new ImageData(2, 2);
    mask.data.fill(0);
    const maskBounds = { x: 0, y: 0, width: 2, height: 2 };

    const { deps, dynamicDepsRef } = createDeps({
      selectionMask: mask,
      selectionMaskBounds: maskBounds as any,
    });
    dynamicDepsRef.current.selectionMask = mask as any;
    dynamicDepsRef.current.selectionMaskBounds = maskBounds as any;

    const handlers = createPointerHandlers(deps);
    handlers.handlePointerDown(makePointerEvent({ clientX: 10, clientY: 10 }));

    expect(deps.clearSelection).toHaveBeenCalled();
    expect(deps.isMouseDownRef.current).toBe(false);
  });

  it('updates pan offsets while panning on move', () => {
    const { deps } = createDeps();
    deps.isMouseDownRef.current = true;
    deps.isSpacePressedRef.current = true;
    (deps.pan.panState as any).isPanning = true;
    deps.pan.updatePan = jest.fn((x: number, y: number) => {
      (deps.pan.panState as any).offsetX = x;
      (deps.pan.panState as any).offsetY = y;
    }) as any;

    const handlers = createPointerHandlers(deps);
    handlers.handlePointerMove(makePointerEvent({ clientX: 50, clientY: 60 }));

    expect(deps.pan.updatePan).toHaveBeenCalledWith(50, 60);
    expect(deps.viewTransformRef.current.offsetX).toBe(50);
    expect(deps.viewTransformRef.current.offsetY).toBe(60);
    expect(deps.draw).toHaveBeenCalled();
  });

  it('draws recolor preview line on move when sampling', () => {
    const { deps, dynamicDepsRef } = createDeps({
      recolorSampling: { active: true, start: { x: 10, y: 10 }, end: null, samples: 8, target: 'recolor' } as any,
    });
    deps.isMouseDownRef.current = true;
    dynamicDepsRef.current.recolorSampling = deps.recolorSampling;

    const handlers = createPointerHandlers(deps);
    handlers.handlePointerMove(makePointerEvent({ clientX: 40, clientY: 50 }));

    const ctx = (deps.overlayCanvasRef.current!.getContext as jest.Mock).mock.results[0].value as any;
    expect(ctx.beginPath).toHaveBeenCalled();
    expect(ctx.moveTo).toHaveBeenCalledWith(10, 10);
    expect(ctx.lineTo).toHaveBeenCalledWith(40, 50);
    expect(ctx.stroke).toHaveBeenCalled();
  });

  it('processes coalesced pointer moves and continues drawing', () => {
    const { deps } = createDeps();
    deps.interaction.state = { isDrawing: true, isSelecting: false, mode: 'drawing' } as any;
    deps.isMouseDownRef.current = true;
    deps.snapStrokeStartRef!.current = { x: 0, y: 0 } as any;
    deps.snapLastBrushSampleRef!.current = { x: 0, y: 0 } as any;

    const coalescedEvents: any[] = [
      { clientX: 20, clientY: 25, shiftKey: true, pressure: 0.8 },
      { clientX: 22, clientY: 28, shiftKey: true, pressure: 0.9 },
    ];

    const handlers = createPointerHandlers(deps);

    handlers.handlePointerMove(makePointerEvent({
      clientX: 22,
      clientY: 28,
      nativeEvent: { getCoalescedEvents: () => coalescedEvents as unknown as PointerEvent[] } as any,
    }));

    expect(deps.drawingHandlers.continueDrawing).toHaveBeenCalled();
  });

  it('ends pan and restores cursor on pointer up', () => {
    const { deps } = createDeps();
    (deps.pan.panState as any).isPanning = true;
    deps.isSpacePressedRef.current = false;

    const handlers = createPointerHandlers(deps);
    handlers.handlePointerUp(makePointerEvent({ clientX: 5, clientY: 5 }));

    expect(deps.pan.endPan).toHaveBeenCalled();
    expect(deps.setCursorStyle).toHaveBeenCalledWith('none');
    expect(deps.resumeAnimationAfterPan).toHaveBeenCalled();
  });

  it('finalizes recolor sampling on pointer up', () => {
    const manager = {
      processLayer: jest.fn().mockResolvedValue(true),
      updateGradient: jest.fn(),
      playSingle: jest.fn(),
      setPaletteDirectionalOrder: jest.fn(),
      autoSetAnimationDirection: jest.fn(),
    };
    jest.spyOn(RecolorManager, 'getInstance').mockReturnValue(manager as any);

    const { deps, dynamicDepsRef } = createDeps({
      recolorSampling: { active: true, start: { x: 0, y: 0 }, end: null, samples: 4, target: 'recolor' } as any,
      layers: [{ id: 'layer1', layerType: 'color-cycle', colorCycleData: { recolorSettings: null } } as any],
      activeLayerId: 'layer1',
    });
    deps.sampleColorsAlongLine = jest.fn(() => ['#111111', '#222222']);
    dynamicDepsRef.current.recolorSampling = deps.recolorSampling;

    const handlers = createPointerHandlers(deps);
    handlers.handlePointerUp(makePointerEvent({ clientX: 10, clientY: 0 }));

    expect(deps.stopRecolorSampling).toHaveBeenCalled();
    expect(RecolorManager.getInstance).toHaveBeenCalled();
  });

  it('clears floating paste drag state on pointer up', () => {
    const { deps } = createDeps();
    deps.isDraggingFloatingPaste = true;
    deps.floatingPasteDragStart.current = { x: 1, y: 2 };
    deps.floatingPasteOriginalPos.current = { x: 3, y: 4 } as any;

    const handlers = createPointerHandlers(deps);
    handlers.handlePointerUp(makePointerEvent({ clientX: 6, clientY: 6 }));

    expect(deps.setIsDraggingFloatingPaste).toHaveBeenCalledWith(false);
    expect(deps.floatingPasteDragStart.current).toBeNull();
    expect(deps.floatingPasteOriginalPos.current).toBeNull();
    expect(deps.setCursorStyle).toHaveBeenCalledWith('none');
  });

  it('cancels stroke cleanly on pointer cancel', () => {
    const { deps } = createDeps();
    (deps.pan.panState as any).isPanning = true;

    const handlers = createPointerHandlers(deps);
    handlers.handlePointerCancel(makePointerEvent({ clientX: 7, clientY: 8 }));

    expect(deps.drawingHandlers.endStrokeSession).toHaveBeenCalled();
    expect(deps.drawingHandlers.clearStrokeSession).toHaveBeenCalled();
    expect(deps.pan.endPan).toHaveBeenCalled();
  });

  it('finalizes regular drawing on pointer up', async () => {
    const compositeCtx = { clearRect: jest.fn(), save: jest.fn(), restore: jest.fn() } as any;
    const compositeCanvas = Object.assign(createCanvas(), {
      getContext: jest.fn(() => compositeCtx),
    });

    const { deps } = createDeps({
      project: { ...mockProject, width: 100, height: 100 },
      canvas: { width: 100, height: 100, scale: 1, zoom: 1 },
    }, {
      compositeCanvasRef: { current: compositeCanvas },
    });

    deps.interaction.state = { isDrawing: true, isSelecting: false, mode: 'drawing' } as any;
    deps.drawingHandlers.finalizeDrawing = jest.fn().mockResolvedValue(undefined);

    const handlers = createPointerHandlers(deps);
    handlers.handlePointerUp(makePointerEvent({ clientX: 2, clientY: 3 }));

    await Promise.resolve();

    expect(deps.drawingHandlers.finalizeDrawing).toHaveBeenCalledWith(false);
    expect(deps.stateMachine.finalizationComplete).toHaveBeenCalled();
    expect(deps.compositeLayersToCanvas).toHaveBeenCalledWith(compositeCanvas);
    expect(deps.draw).toHaveBeenCalled();
  });

  it('finalizes shape drawing on pointer up', () => {
    const { deps } = createDeps({
      tools: {
        ...baseDynamic.tools,
        currentTool: 'brush',
        shapeMode: true,
        brushSettings: { ...baseDynamic.tools.brushSettings, brushShape: BrushShape.ROUND },
      },
      project: { ...mockProject, width: 50, height: 50 },
    });

    deps.interaction.state = { isDrawing: true, isSelecting: false, mode: 'drawing' } as any;
    deps.drawingHandlers.isDrawingShapeRef.current = true;
    deps.drawingHandlers.shapePointsRef.current = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }];
    deps.drawingHandlers.isSelectingDirectionRef.current = false;

    const handlers = createPointerHandlers(deps);
    handlers.handlePointerUp(makePointerEvent({ clientX: 4, clientY: 4 }));

    expect(deps.drawingHandlers.finalizeShapeDrawing).toHaveBeenCalled();
    expect(deps.stateMachine.finalizationComplete).toHaveBeenCalled();
    expect(deps.compositeLayersToCanvas).toHaveBeenCalled();
    expect(deps.setNeedsRedraw).toHaveBeenCalled();
  });
});
