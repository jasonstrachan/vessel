/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { createPointerHandlers } from '../pointerHandlers';
import { useAppStore } from '@/stores/useAppStore';
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
    arc: jest.fn(),
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
    selectionMode: 'marquee',
    brushSettings: {
      brushShape: BrushShape.ROUND,
      pressureEnabled: false,
      contourSpacing: 5,
    } as any,
    fillSettings: { threshold: 0, contiguous: true, eraseInstead: false },
    wandSettings: { threshold: 0, contiguous: true },
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
    suppressBootstrapUntilPointerUpRef: { current: false },
    drawAnimationFrameRef: { current: null },
    pointerMoveThrottled: { current: 0 },
    project: dynamic.project,
    canvas: dynamic.canvas,
    tools: dynamic.tools,
    layers: dynamic.layers,
    activeLayerId: dynamic.activeLayerId,
    selectionStart: dynamic.selectionStart,
    selectionEnd: dynamic.selectionEnd,
    selectionMask: dynamic.selectionMask,
    selectionMaskBounds: dynamic.selectionMaskBounds,
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
    extractSelectionToFloatingPaste: jest.fn().mockReturnValue(false),
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
      finalizeShapeDrawing: jest.fn().mockResolvedValue(undefined),
      endStrokeSession: jest.fn(),
      clearStrokeSession: jest.fn(),
      isDrawingShapeRef: { current: false },
      shapePointsRef: { current: [] },
      coerceDragShapeToPolygon: jest.fn(),
      updateDitherGradSamples: jest.fn(),
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
    selectionRuntimeRef: {
      current: {
        pendingSelectionHistory: null,
        freehandSession: { active: false, points: [] },
        clickLineSession: { active: false, points: [] },
        marqueeAutoPan: { frameId: null, screenPos: null },
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
      cb(globalThis.performance.now());
      return 1;
    };
    if (!('performance' in globalThis)) {
      Object.defineProperty(globalThis, 'performance', {
        configurable: true,
        value: { now: () => Date.now() },
      });
    }
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

  it('blurs focused editable controls before processing canvas pointer down', () => {
    const { deps } = createDeps();
    const handlers = createPointerHandlers(deps);
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    const blurSpy = jest.spyOn(input, 'blur');

    handlers.handlePointerDown(makePointerEvent());

    expect(blurSpy).toHaveBeenCalled();

    blurSpy.mockRestore();
    input.remove();
  });

  it('does not bootstrap stroke from pointermove while busy', () => {
    const { deps } = createDeps();
    deps.isBusyRef.current = true;
    const handlers = createPointerHandlers(deps);

    handlers.handlePointerMove(makePointerEvent({ buttons: 1 }));

    expect(deps.drawingHandlers.beginStrokeSession).not.toHaveBeenCalled();
    expect(deps.drawingHandlers.startDrawing).not.toHaveBeenCalled();
  });

  it('bootstraps stroke from pointermove when not busy', () => {
    const { deps } = createDeps();
    const handlers = createPointerHandlers(deps);

    handlers.handlePointerMove(makePointerEvent({ buttons: 1, clientX: 21, clientY: 22 }));

    expect(deps.drawingHandlers.beginStrokeSession).toHaveBeenCalledTimes(1);
    expect(deps.drawingHandlers.startDrawing).toHaveBeenCalledTimes(1);
    expect(deps.drawingHandlers.startDrawing).toHaveBeenCalledWith({ x: 21, y: 22 }, expect.any(Number));
  });

  it('does not bootstrap eraser stroke from pointermove while busy', () => {
    const { deps, dynamicDepsRef } = createDeps({
      tools: {
        ...baseDynamic.tools,
        currentTool: 'eraser',
      },
    });
    deps.isBusyRef.current = true;
    dynamicDepsRef.current.tools.currentTool = 'eraser';
    deps.tools = dynamicDepsRef.current.tools;
    const handlers = createPointerHandlers(deps);

    handlers.handlePointerMove(makePointerEvent({ buttons: 1 }));

    expect(deps.drawingHandlers.beginStrokeSession).not.toHaveBeenCalled();
    expect(deps.drawingHandlers.startDrawing).not.toHaveBeenCalled();
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

  it('ends active stroke when space-pan takes over on move', () => {
    const { deps } = createDeps();
    const handlers = createPointerHandlers(deps);

    deps.isSpacePressedRef.current = true;
    deps.isMouseDownRef.current = true;
    deps.interaction.state.isDrawing = true;

    handlers.handlePointerMove(makePointerEvent({ buttons: 1, clientX: 20, clientY: 20 }));

    expect(deps.interaction.dispatch).toHaveBeenCalledWith({ type: 'DRAWING_END' });
    expect(deps.drawingHandlers.endStrokeSession).not.toHaveBeenCalled();
    expect(deps.drawingHandlers.finalizeDrawing).toHaveBeenCalledWith(false);
    expect(deps.drawingHandlers.clearStrokeSession).not.toHaveBeenCalled();
    expect(deps.pan.startPan).toHaveBeenCalledWith(20, 20);
    expect(deps.drawingHandlers.continueDrawing).not.toHaveBeenCalled();
  });

  it('keeps the custom tool mounted until freehand capture is materialized', () => {
    const { deps, dynamicDepsRef } = createDeps({
      tools: {
        ...baseDynamic.tools,
        currentTool: 'custom',
        customBrushCapture: {
          mode: 'freehand',
          sampleAllLayers: false,
          freehandPath: null,
        } as any,
      },
    });
    const handlers = createPointerHandlers(deps);

    handlers.handlePointerDown(makePointerEvent({ pointerId: 7, clientX: 10, clientY: 10 }));
    handlers.handlePointerMove(
      makePointerEvent({ pointerId: 7, buttons: 1, clientX: 18, clientY: 10 })
    );
    handlers.handlePointerMove(
      makePointerEvent({ pointerId: 7, buttons: 1, clientX: 14, clientY: 18 })
    );
    handlers.handlePointerUp(makePointerEvent({ pointerId: 7, clientX: 10, clientY: 10 }));

    expect(deps.setCustomBrushFreehandPath).toHaveBeenCalled();
    expect(deps.setCurrentTool).not.toHaveBeenCalledWith('brush');
    expect(dynamicDepsRef.current.tools.currentTool).toBe('custom');
  });

  it('includes the pointer-up point when completing a custom freehand capture', () => {
    const { deps } = createDeps(
      {
        tools: {
          ...baseDynamic.tools,
          currentTool: 'custom',
          customBrushCapture: {
            mode: 'freehand',
            sampleAllLayers: false,
            freehandPath: null,
          } as any,
        },
      },
      {
        getMousePos: jest.fn((event: any) => ({
          x: event.clientX ?? 0,
          y: event.clientY ?? 0,
        })),
      }
    );
    const handlers = createPointerHandlers(deps);

    handlers.handlePointerDown(makePointerEvent({ pointerId: 9, clientX: 20, clientY: 20 }));
    handlers.handlePointerMove(
      makePointerEvent({ pointerId: 9, buttons: 1, clientX: 40, clientY: 20 })
    );
    handlers.handlePointerUp(makePointerEvent({ pointerId: 9, clientX: 30, clientY: 40 }));

    expect(deps.setCustomBrushFreehandPath).toHaveBeenLastCalledWith({
      points: [
        { x: 20, y: 20 },
        { x: 40, y: 20 },
        { x: 30, y: 40 },
      ],
      bounds: { x: 20, y: 20, width: 20, height: 20 },
    });
  });

  it('does not cancel a custom freehand capture on pointer leave', () => {
    const { deps } = createDeps({
      tools: {
        ...baseDynamic.tools,
        currentTool: 'custom',
        customBrushCapture: {
          mode: 'freehand',
          sampleAllLayers: false,
          freehandPath: null,
        } as any,
      },
    });
    const handlers = createPointerHandlers(deps);

    handlers.handlePointerDown(makePointerEvent({ pointerId: 12, clientX: 10, clientY: 10 }));
    handlers.handlePointerMove(
      makePointerEvent({ pointerId: 12, buttons: 1, clientX: 18, clientY: 18 })
    );
    handlers.handlePointerLeave();
    handlers.handlePointerMove(
      makePointerEvent({ pointerId: 12, buttons: 1, clientX: 28, clientY: 18 })
    );
    handlers.handlePointerUp(makePointerEvent({ pointerId: 12, clientX: 28, clientY: 18 }));

    expect(deps.setCustomBrushFreehandPath).toHaveBeenCalled();
    expect(deps.setShowBrushCursor).toHaveBeenCalledWith(false);
  });

  it('flushes a pending custom freehand move before completing on pointer up', () => {
    let queuedRaf: FrameRequestCallback | null = null;
    const previousRaf = global.requestAnimationFrame;
    global.requestAnimationFrame = (cb: FrameRequestCallback): number => {
      queuedRaf = cb;
      return 1;
    };
    try {
      const { deps } = createDeps(
        {
          tools: {
            ...baseDynamic.tools,
            currentTool: 'custom',
            customBrushCapture: {
              mode: 'freehand',
              sampleAllLayers: false,
              freehandPath: null,
            } as any,
          },
        },
        {
          getMousePos: jest.fn((event: any) => ({
            x: event.clientX ?? 0,
            y: event.clientY ?? 0,
          })),
        }
      );
      const handlers = createPointerHandlers(deps);

      handlers.handlePointerDown(makePointerEvent({ pointerId: 15, clientX: 20, clientY: 20 }));
      handlers.handlePointerMove(
        makePointerEvent({ pointerId: 15, buttons: 1, clientX: 40, clientY: 20 })
      );
      handlers.handlePointerUp(makePointerEvent({ pointerId: 15, clientX: 30, clientY: 40 }));

      expect(queuedRaf).not.toBeNull();
      expect(deps.setCustomBrushFreehandPath).toHaveBeenLastCalledWith({
        points: [
          { x: 20, y: 20 },
          { x: 40, y: 20 },
          { x: 30, y: 40 },
        ],
        bounds: { x: 20, y: 20, width: 20, height: 20 },
      });
    } finally {
      global.requestAnimationFrame = previousRaf;
    }
  });

  it('completes custom freehand capture even when pointer capture is already gone on pointer up', () => {
    const releasePointerCapture = jest.fn(() => {
      throw new DOMException('missing capture', 'NotFoundError');
    });
    const { deps } = createDeps(
      {
        tools: {
          ...baseDynamic.tools,
          currentTool: 'custom',
          customBrushCapture: {
            mode: 'freehand',
            sampleAllLayers: false,
            freehandPath: null,
          } as any,
        },
      },
      {
        getMousePos: jest.fn((event: any) => ({
          x: event.clientX ?? 0,
          y: event.clientY ?? 0,
        })),
      }
    );
    const handlers = createPointerHandlers(deps);

    handlers.handlePointerDown(makePointerEvent({ pointerId: 18, clientX: 20, clientY: 20 }));
    handlers.handlePointerMove(
      makePointerEvent({ pointerId: 18, buttons: 1, clientX: 40, clientY: 20 })
    );
    handlers.handlePointerUp(
      makePointerEvent({
        pointerId: 18,
        clientX: 30,
        clientY: 40,
        currentTarget: {
          releasePointerCapture,
          hasPointerCapture: jest.fn().mockReturnValue(false),
        } as any,
      })
    );

    expect(releasePointerCapture).not.toHaveBeenCalled();
    expect(deps.setCustomBrushFreehandPath).toHaveBeenLastCalledWith({
      points: [
        { x: 20, y: 20 },
        { x: 40, y: 20 },
        { x: 30, y: 40 },
      ],
      bounds: { x: 20, y: 20, width: 20, height: 20 },
    });
  });

  it('preserves custom freehand capture state across handler recreation', () => {
    const { deps } = createDeps(
      {
        tools: {
          ...baseDynamic.tools,
          currentTool: 'custom',
          customBrushCapture: {
            mode: 'freehand',
            sampleAllLayers: false,
            freehandPath: null,
          } as any,
        },
      },
      {
        getMousePos: jest.fn((event: any) => ({
          x: event.clientX ?? 0,
          y: event.clientY ?? 0,
        })),
      }
    );
    const handlersA = createPointerHandlers(deps);

    handlersA.handlePointerDown(makePointerEvent({ pointerId: 22, clientX: 20, clientY: 20 }));
    handlersA.handlePointerMove(
      makePointerEvent({ pointerId: 22, buttons: 1, clientX: 40, clientY: 20 })
    );

    const handlersB = createPointerHandlers(deps);
    handlersB.handlePointerUp(makePointerEvent({ pointerId: 22, clientX: 30, clientY: 40 }));

    expect(deps.setCustomBrushFreehandPath).toHaveBeenLastCalledWith({
      points: [
        { x: 20, y: 20 },
        { x: 40, y: 20 },
        { x: 30, y: 40 },
      ],
      bounds: { x: 20, y: 20, width: 20, height: 20 },
    });
  });

  it('does not resume drawing after space-pan release until pointer is lifted', () => {
    const { deps } = createDeps();
    const handlers = createPointerHandlers(deps);

    deps.suppressBootstrapUntilPointerUpRef.current = true;
    deps.isMouseDownRef.current = false;

    handlers.handlePointerMove(makePointerEvent({ buttons: 1, clientX: 20, clientY: 20 }));
    expect(deps.drawingHandlers.startDrawing).not.toHaveBeenCalled();

    handlers.handlePointerUp(makePointerEvent({ clientX: 21, clientY: 21 }));
    handlers.handlePointerMove(makePointerEvent({ buttons: 1, clientX: 22, clientY: 22 }));
    expect(deps.drawingHandlers.startDrawing).toHaveBeenCalledTimes(1);
  });

  it('does not pan when ref is released even if state-machine snapshot is stale', () => {
    const { deps } = createDeps();
    deps.isSpacePressedRef.current = false;
    (deps.stateMachine.state as { isSpacePressed?: boolean }).isSpacePressed = true;
    const handlers = createPointerHandlers(deps);

    handlers.handlePointerDown(makePointerEvent({ clientX: 25, clientY: 30 }));

    expect(deps.pan.startPan).not.toHaveBeenCalled();
    expect(deps.setCursorStyle).not.toHaveBeenCalledWith('grabbing');
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

  it('shows brush-size cursor for dither-stroke stroke (non-shape)', () => {
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

  it('centers even-sized pixel brush cursors on the stamp raster cells', () => {
    const { deps, dynamicDepsRef } = createDeps({
      tools: {
        ...baseDynamic.tools,
        currentTool: 'brush',
        shapeMode: false,
        brushSettings: {
          ...baseDynamic.tools.brushSettings,
          brushShape: BrushShape.PIXEL_DITHER,
          size: 2,
          shapeEnabled: false,
        } as any,
      },
    });

    dynamicDepsRef.current.tools = deps.tools;
    const handlers = createPointerHandlers(deps);

    handlers.handlePointerDown(makePointerEvent({ clientX: 10, clientY: 10 }));

    expect(deps.setCursorPosition).toHaveBeenCalledWith(10, 10);
  });

  it('uses crosshair cursor for dither-stroke shape mode', () => {
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

  it('snaps marquee selection bounds to whole pixels on pointer up', () => {
    const { deps, dynamicDepsRef } = createDeps({
      canvas: { width: 100, height: 100, scale: 2, zoom: 2 } as any,
      tools: {
        ...baseDynamic.tools,
        currentTool: 'selection',
        brushSettings: {
          ...baseDynamic.tools.brushSettings,
          brushShape: BrushShape.ROUND,
        } as any,
      },
    });

    dynamicDepsRef.current.tools.currentTool = 'selection';
    deps.tools = dynamicDepsRef.current.tools;
    deps.canvas = dynamicDepsRef.current.canvas;
    deps.pan = {
      ...deps.pan,
      screenToWorld: (x: number, y: number, scale: number) => ({ x: x / scale, y: y / scale }),
      worldToScreen: (x: number, y: number, scale: number) => ({ x: x * scale, y: y * scale }),
    } as any;
    deps.getMousePos = jest.fn((event: any) => ({
      x: event.clientX,
      y: event.clientY,
    }));

    const handlers = createPointerHandlers(deps);

    handlers.handlePointerDown(makePointerEvent({ clientX: 10, clientY: 10 }));
    (deps.interaction.state as any).isSelecting = true;

    handlers.handlePointerUp(makePointerEvent({ clientX: 21, clientY: 21 }));

    expect(deps.setSelectionBounds).toHaveBeenLastCalledWith(
      { x: 5, y: 5 },
      { x: 11, y: 11 }
    );
  });

  it('allows marquee selection to reach the project edge on pointer up', () => {
    const { deps, dynamicDepsRef } = createDeps({
      project: { ...mockProject, width: 100, height: 100 },
      canvas: { width: 100, height: 100, scale: 1, zoom: 1 } as any,
      tools: {
        ...baseDynamic.tools,
        currentTool: 'selection',
        brushSettings: {
          ...baseDynamic.tools.brushSettings,
          brushShape: BrushShape.ROUND,
        } as any,
      },
    });

    dynamicDepsRef.current.tools.currentTool = 'selection';
    deps.tools = dynamicDepsRef.current.tools;
    deps.project = dynamicDepsRef.current.project;
    deps.canvas = dynamicDepsRef.current.canvas;
    deps.pan = {
      ...deps.pan,
      screenToWorld: (x: number, y: number) => ({ x, y }),
      worldToScreen: (x: number, y: number) => ({ x, y }),
    } as any;
    deps.getMousePos = jest.fn((event: any) => ({
      x: event.clientX,
      y: event.clientY,
    }));

    const handlers = createPointerHandlers(deps);

    handlers.handlePointerDown(makePointerEvent({ clientX: 10, clientY: 10 }));
    (deps.interaction.state as any).isSelecting = true;

    handlers.handlePointerUp(makePointerEvent({ clientX: 100, clientY: 100 }));

    expect(deps.setSelectionBounds).toHaveBeenLastCalledWith(
      { x: 10, y: 10 },
      { x: 100, y: 100 }
    );
  });

  it('preserves active selection for non-selection tools', () => {
    const { deps, dynamicDepsRef } = createDeps({
      tools: {
        ...baseDynamic.tools,
        currentTool: 'brush',
      },
      selectionStart: { x: 0, y: 0 },
      selectionEnd: { x: 5, y: 5 },
    });

    dynamicDepsRef.current.tools.currentTool = 'brush';
    deps.tools = dynamicDepsRef.current.tools;
    deps.selectionStart = { x: 0, y: 0 } as any;
    deps.selectionEnd = { x: 5, y: 5 } as any;

    const handlers = createPointerHandlers(deps);
    handlers.handlePointerDown(makePointerEvent({ clientX: 90, clientY: 90 }));

    expect(deps.clearSelection).not.toHaveBeenCalled();
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

  it('extracts current selection through store action before starting floating paste drag', () => {
    const { deps, dynamicDepsRef } = createDeps({
      tools: {
        ...baseDynamic.tools,
        currentTool: 'selection',
      },
      selectionStart: { x: 0, y: 0 },
      selectionEnd: { x: 10, y: 10 },
    });

    dynamicDepsRef.current.tools.currentTool = 'selection';
    deps.tools = dynamicDepsRef.current.tools;

    (deps.extractSelectionToFloatingPaste as jest.Mock).mockImplementation(() => {
      useAppStore.setState({
        floatingPaste: {
          active: true,
          imageData: new ImageData(2, 2),
          position: { x: 4, y: 4 },
          originalPosition: { x: 4, y: 4 },
          width: 2,
          height: 2,
          displayWidth: 2,
          displayHeight: 2,
          rotation: 0,
          sourceLayerId: 'layer-1',
        },
      });
      return true;
    });

    const handlers = createPointerHandlers(deps);
    handlers.handlePointerDown(makePointerEvent({ clientX: 5, clientY: 5 }));

    expect(deps.extractSelectionToFloatingPaste).toHaveBeenCalledTimes(1);
    expect(deps.setIsDraggingFloatingPaste).toHaveBeenCalledWith(true);
    expect(deps.floatingPasteOriginalPos.current).toMatchObject({ x: 4, y: 4 });

    useAppStore.setState({ floatingPaste: null });
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
      tools: {
        ...baseDynamic.tools,
        currentTool: 'selection',
      } as any,
      selectionMask: mask,
      selectionMaskBounds: maskBounds as any,
    });
    dynamicDepsRef.current.tools = deps.tools;
    dynamicDepsRef.current.selectionMask = mask as any;
    dynamicDepsRef.current.selectionMaskBounds = maskBounds as any;

    const handlers = createPointerHandlers(deps);
    handlers.handlePointerDown(makePointerEvent({ clientX: 10, clientY: 10 }));

    expect(deps.clearSelection).toHaveBeenCalled();
    expect(deps.isMouseDownRef.current).toBe(false);
  });

  it('creates contiguous magic wand selection mask', () => {
    const imageData = new ImageData(3, 1);
    const px = imageData.data;
    // red, blue, red
    px.set([255, 0, 0, 255], 0);
    px.set([0, 0, 255, 255], 4);
    px.set([255, 0, 0, 255], 8);

    const { deps, dynamicDepsRef } = createDeps({
      tools: {
        ...baseDynamic.tools,
        currentTool: 'selection',
        selectionMode: 'magic-wand',
        wandSettings: { threshold: 0, contiguous: true },
      } as any,
      layers: [{ id: 'layer-1', imageData, layerType: 'raster' } as any],
      activeLayerId: 'layer-1',
      project: { ...mockProject, width: 3, height: 1 },
    });
    dynamicDepsRef.current.tools = deps.tools;

    const handlers = createPointerHandlers(deps);
    handlers.handlePointerDown(makePointerEvent({ clientX: 0, clientY: 0 }));

    const state = useAppStore.getState();
    expect(state.selectionMaskBounds).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    expect(state.selectionMask?.data[3]).toBe(255);

    useAppStore.setState({
      selectionStart: null,
      selectionEnd: null,
      selectionMask: null,
      selectionMaskBounds: null,
      selectionMaskLayerId: null,
    });
  });

  it('creates magic wand selection from selection tool mode on a color-cycle layer', () => {
    const imageData = new ImageData(
      new Uint8ClampedArray([
        255, 0, 0, 255,
        0, 0, 255, 255,
      ]),
      2,
      1
    );

    const { deps, dynamicDepsRef } = createDeps({
      tools: {
        ...baseDynamic.tools,
        currentTool: 'selection',
        selectionMode: 'magic-wand',
        wandSettings: { threshold: 0, contiguous: true },
      } as any,
      layers: [{
        id: 'layer-cc',
        imageData,
        layerType: 'color-cycle',
        colorCycleData: {},
      } as any],
      activeLayerId: 'layer-cc',
      project: { ...mockProject, width: 2, height: 1 },
    });
    dynamicDepsRef.current.tools = deps.tools;

    const handlers = createPointerHandlers(deps);
    handlers.handlePointerDown(makePointerEvent({ clientX: 0, clientY: 0 }));

    const state = useAppStore.getState();
    expect(state.selectionMaskBounds).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    expect(state.selectionMaskLayerId).toBe('layer-cc');

    useAppStore.setState({
      selectionStart: null,
      selectionEnd: null,
      selectionMask: null,
      selectionMaskBounds: null,
      selectionMaskLayerId: null,
    });
  });

  it('creates non-contiguous magic wand selection mask', () => {
    const imageData = new ImageData(3, 1);
    const px = imageData.data;
    // red, blue, red
    px.set([255, 0, 0, 255], 0);
    px.set([0, 0, 255, 255], 4);
    px.set([255, 0, 0, 255], 8);

    const { deps, dynamicDepsRef } = createDeps({
      tools: {
        ...baseDynamic.tools,
        currentTool: 'selection',
        selectionMode: 'magic-wand',
        wandSettings: { threshold: 0, contiguous: false },
      } as any,
      layers: [{ id: 'layer-1', imageData, layerType: 'raster' } as any],
      activeLayerId: 'layer-1',
      project: { ...mockProject, width: 3, height: 1 },
    });
    dynamicDepsRef.current.tools = deps.tools;

    const handlers = createPointerHandlers(deps);
    handlers.handlePointerDown(makePointerEvent({ clientX: 0, clientY: 0 }));

    const state = useAppStore.getState();
    expect(state.selectionMaskBounds).toEqual({ x: 0, y: 0, width: 3, height: 1 });
    const mask = state.selectionMask;
    expect(mask).toBeTruthy();
    if (!mask) {
      return;
    }
    expect(mask.data[3]).toBe(255);
    expect(mask.data[7]).toBe(0);
    expect(mask.data[11]).toBe(255);

    useAppStore.setState({
      selectionStart: null,
      selectionEnd: null,
      selectionMask: null,
      selectionMaskBounds: null,
      selectionMaskLayerId: null,
    });
  });

  it('appends magic wand selection when Shift is held', () => {
    const imageData = new ImageData(3, 1);
    const px = imageData.data;
    px.set([255, 0, 0, 255], 0);
    px.set([0, 0, 255, 255], 4);
    px.set([255, 0, 0, 255], 8);

    useAppStore.setState({
      selectionStart: { x: 2, y: 0 },
      selectionEnd: { x: 3, y: 1 },
      selectionMask: null,
      selectionMaskBounds: null,
      selectionMaskLayerId: 'layer-1',
    });

    const { deps, dynamicDepsRef } = createDeps({
      tools: {
        ...baseDynamic.tools,
        currentTool: 'selection',
        selectionMode: 'magic-wand',
        wandSettings: { threshold: 0, contiguous: true },
      } as any,
      layers: [{ id: 'layer-1', imageData, layerType: 'raster' } as any],
      activeLayerId: 'layer-1',
      project: { ...mockProject, width: 3, height: 1 },
    });
    dynamicDepsRef.current.tools = deps.tools;

    const handlers = createPointerHandlers(deps);
    handlers.handlePointerDown(makePointerEvent({ clientX: 0, clientY: 0, shiftKey: true }));

    const state = useAppStore.getState();
    expect(state.selectionMaskBounds).toEqual({ x: 0, y: 0, width: 3, height: 1 });
    expect(state.selectionMask?.data[3]).toBe(255);
    expect(state.selectionMask?.data[11]).toBe(255);

    useAppStore.setState({
      selectionStart: null,
      selectionEnd: null,
      selectionMask: null,
      selectionMaskBounds: null,
      selectionMaskLayerId: null,
    });
  });

  it('preserves the existing selection while starting a Shift-marquee append', () => {
    useAppStore.setState({
      selectionStart: { x: 40, y: 40 },
      selectionEnd: { x: 50, y: 50 },
      selectionMask: null,
      selectionMaskBounds: null,
      selectionMaskLayerId: null,
    });

    const { deps, dynamicDepsRef } = createDeps({
      tools: {
        ...baseDynamic.tools,
        currentTool: 'selection',
        selectionMode: 'marquee',
      } as any,
      selectionStart: { x: 40, y: 40 },
      selectionEnd: { x: 50, y: 50 },
    });
    dynamicDepsRef.current.tools = deps.tools;
    dynamicDepsRef.current.selectionStart = { x: 40, y: 40 } as any;
    dynamicDepsRef.current.selectionEnd = { x: 50, y: 50 } as any;

    const handlers = createPointerHandlers(deps);
    handlers.handlePointerDown(makePointerEvent({ clientX: 0, clientY: 0, shiftKey: true }));

    const state = useAppStore.getState();
    expect(state.selectionStart).toEqual({ x: 40, y: 40 });
    expect(state.selectionEnd).toEqual({ x: 50, y: 50 });

    useAppStore.setState({
      selectionStart: null,
      selectionEnd: null,
      selectionMask: null,
      selectionMaskBounds: null,
      selectionMaskLayerId: null,
    });
  });

  it('clips flood fill updates to mask-backed selections', () => {
    const framebuffer = document.createElement('canvas');
    framebuffer.width = 3;
    framebuffer.height = 1;
    framebuffer.getContext('2d')?.putImageData(new ImageData(3, 1), 0, 0);

    const mask = new ImageData(3, 1);
    mask.data[7] = 255;

    const { deps, dynamicDepsRef } = createDeps({
      tools: {
        ...baseDynamic.tools,
        currentTool: 'fill',
        fillSettings: { threshold: 0, contiguous: true, eraseInstead: false },
      } as any,
      layers: [{
        id: 'layer-1',
        imageData: new ImageData(3, 1),
        framebuffer,
        layerType: 'normal',
      } as any],
      activeLayerId: 'layer-1',
      project: { ...mockProject, width: 3, height: 1 },
      selectionStart: { x: 0, y: 0 },
      selectionEnd: { x: 3, y: 1 },
      selectionMask: mask,
      selectionMaskBounds: { x: 0, y: 0, width: 3, height: 1 } as any,
    });
    dynamicDepsRef.current.tools = deps.tools;
    dynamicDepsRef.current.selectionStart = deps.selectionStart;
    dynamicDepsRef.current.selectionEnd = deps.selectionEnd;
    dynamicDepsRef.current.selectionMask = deps.selectionMask;
    dynamicDepsRef.current.selectionMaskBounds = deps.selectionMaskBounds;

    const handlers = createPointerHandlers(deps);
    handlers.handlePointerDown(makePointerEvent({ clientX: 0, clientY: 0 }));

    expect(deps.updateLayer).toHaveBeenCalledTimes(1);
    const updatedImageData = (deps.updateLayer as jest.Mock).mock.calls[0][1].imageData as ImageData;
    expect(Array.from(updatedImageData.data)).toEqual([
      0, 0, 0, 0,
      0, 0, 0, 255,
      0, 0, 0, 0,
    ]);
  });

  it('allows dither gradient shape start outside canvas', () => {
    const store = useAppStore.getState();
    const originalShape = store.tools.brushSettings.brushShape;
    store.setBrushSettings({ brushShape: BrushShape.DITHER_GRADIENT });

    const { deps, dynamicDepsRef } = createDeps({
      tools: {
        ...baseDynamic.tools,
        currentTool: 'brush',
        brushSettings: { ...baseDynamic.tools.brushSettings, brushShape: BrushShape.DITHER_GRADIENT },
      },
    });
    dynamicDepsRef.current.tools = deps.tools;

    const handlers = createPointerHandlers(deps);
    handlers.handlePointerDown(makePointerEvent({ clientX: -5, clientY: -5 }));

    const lastSamples = (deps.drawingHandlers.updateDitherGradSamples as jest.Mock).mock.calls.at(-1)?.[0];
    expect(lastSamples?.[0]).toMatchObject({ x: -5, y: -5 });

    store.setBrushSettings({ brushShape: originalShape });
  });

  it('allows marquee selection start outside canvas', () => {
    const { deps, dynamicDepsRef } = createDeps({
      tools: {
        ...baseDynamic.tools,
        currentTool: 'selection',
        selectionMode: 'marquee',
      },
    });
    dynamicDepsRef.current.tools = deps.tools;

    const handlers = createPointerHandlers(deps);
    handlers.handlePointerDown(makePointerEvent({ clientX: -8, clientY: -12 }));

    expect(deps.setSelectionBounds).toHaveBeenCalledWith(
      { x: -8, y: -12 },
      { x: -8, y: -12 }
    );
    expect(deps.interaction.dispatch).toHaveBeenCalledWith({ type: 'SELECTION_START' });
    expect(deps.isMouseDownRef.current).toBe(true);
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

  it('updates click-line preview overlay on first click', () => {
    const { deps, dynamicDepsRef } = createDeps({
      tools: {
        ...baseDynamic.tools,
        currentTool: 'selection',
        selectionMode: 'click-line',
      },
    });

    dynamicDepsRef.current.tools = deps.tools;

    const handlers = createPointerHandlers(deps);
    handlers.handlePointerDown(makePointerEvent({ clientX: 24, clientY: 36, detail: 1 }));

    const ctx = (deps.overlayCanvasRef.current!.getContext as jest.Mock).mock.results[0].value as any;
    expect(ctx.clearRect).toHaveBeenCalled();
    expect(ctx.arc).not.toHaveBeenCalled();
  });

  it('preserves click-line session across handler recreation', () => {
    const { deps, dynamicDepsRef } = createDeps({
      tools: {
        ...baseDynamic.tools,
        currentTool: 'selection',
        selectionMode: 'click-line',
      },
    });
    dynamicDepsRef.current.tools = deps.tools;

    const firstHandlers = createPointerHandlers(deps);
    firstHandlers.handlePointerDown(makePointerEvent({ clientX: 10, clientY: 12, detail: 1 }));

    deps.interaction = {
      ...deps.interaction,
      refs: {
        ...deps.interaction.refs,
        selectionStart: { current: null },
      },
    } as any;

    const secondHandlers = createPointerHandlers(deps);
    secondHandlers.handlePointerDown(makePointerEvent({ clientX: 30, clientY: 34, detail: 1 }));

    const overlayGetContextMock = deps.overlayCanvasRef.current!.getContext as jest.Mock;
    const contexts = overlayGetContextMock.mock.results
      .map((result) => result.value)
      .filter(Boolean) as Array<{ lineTo?: jest.Mock }>;

    const linkedSecondPoint = contexts.some((ctx) =>
      (ctx.lineTo as jest.Mock | undefined)?.mock.calls.some(
        ([x, y]) => Number(x) === 30 && Number(y) === 34
      )
    );

    expect(linkedSecondPoint).toBe(true);
  });

  it('cancels stale click-line session after switching to marquee mode', () => {
    const { deps, dynamicDepsRef } = createDeps({
      tools: {
        ...baseDynamic.tools,
        currentTool: 'selection',
        selectionMode: 'click-line',
      },
    });
    dynamicDepsRef.current.tools = deps.tools;

    const handlers = createPointerHandlers(deps);
    handlers.handlePointerDown(makePointerEvent({ clientX: 10, clientY: 12, detail: 1 }));

    deps.tools = {
      ...deps.tools,
      selectionMode: 'marquee',
    } as any;
    dynamicDepsRef.current.tools = deps.tools;

    handlers.handlePointerDown(makePointerEvent({ clientX: 20, clientY: 24, detail: 1 }));
    deps.interaction.state = { ...deps.interaction.state, isSelecting: true } as any;

    handlers.handlePointerMove(makePointerEvent({ clientX: 30, clientY: 34 }));

    expect(deps.setSelectionBounds).toHaveBeenLastCalledWith(
      { x: 20, y: 24 },
      { x: 30, y: 34 }
    );
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

  it('falls back to current pressure when coalesced events omit pressure', () => {
    const { deps, dynamicDepsRef } = createDeps({
      tools: {
        ...baseDynamic.tools,
        brushSettings: {
          ...baseDynamic.tools.brushSettings,
          pressureEnabled: true,
        },
      },
    });
    deps.interaction.state = { isDrawing: true, isSelecting: false, mode: 'drawing' } as any;
    deps.isMouseDownRef.current = true;
    deps.snapStrokeStartRef!.current = { x: 0, y: 0 } as any;
    deps.snapLastBrushSampleRef!.current = { x: 0, y: 0 } as any;
    dynamicDepsRef.current.tools = deps.tools;

    const coalescedEvents: any[] = [
      { clientX: 20, clientY: 25, shiftKey: false },
      { clientX: 22, clientY: 28, shiftKey: false },
    ];

    const handlers = createPointerHandlers(deps);

    handlers.handlePointerMove(makePointerEvent({
      pointerType: 'pen',
      pressure: 0.72,
      clientX: 22,
      clientY: 28,
      nativeEvent: { getCoalescedEvents: () => coalescedEvents as unknown as PointerEvent[] } as any,
    }));

    const firstCall = (deps.drawingHandlers.continueDrawing as jest.Mock).mock.calls[0];
    expect(firstCall?.[1]).toBe(0.72);
  });

  it('preserves explicit zero pressure from pen coalesced events', () => {
    const { deps, dynamicDepsRef } = createDeps({
      tools: {
        ...baseDynamic.tools,
        brushSettings: {
          ...baseDynamic.tools.brushSettings,
          pressureEnabled: true,
        },
      },
    });
    deps.interaction.state = { isDrawing: true, isSelecting: false, mode: 'drawing' } as any;
    deps.isMouseDownRef.current = true;
    deps.snapStrokeStartRef!.current = { x: 0, y: 0 } as any;
    deps.snapLastBrushSampleRef!.current = { x: 0, y: 0 } as any;
    dynamicDepsRef.current.tools = deps.tools;

    const coalescedEvents: any[] = [
      { clientX: 20, clientY: 25, shiftKey: false, pressure: 0 },
      { clientX: 22, clientY: 28, shiftKey: false, pressure: 0 },
    ];

    const handlers = createPointerHandlers(deps);

    handlers.handlePointerMove(makePointerEvent({
      pointerType: 'pen',
      pressure: 0.61,
      clientX: 22,
      clientY: 28,
      nativeEvent: { getCoalescedEvents: () => coalescedEvents as unknown as PointerEvent[] } as any,
    }));

    const firstCall = (deps.drawingHandlers.continueDrawing as jest.Mock).mock.calls[0];
    expect(firstCall?.[1]).toBe(0);
  });

  it('applies mouse modifier pressure mapping for coalesced events', () => {
    const { deps, dynamicDepsRef } = createDeps({
      tools: {
        ...baseDynamic.tools,
        brushSettings: {
          ...baseDynamic.tools.brushSettings,
          pressureEnabled: true,
        },
      },
    });
    deps.interaction.state = { isDrawing: true, isSelecting: false, mode: 'drawing' } as any;
    deps.isMouseDownRef.current = true;
    deps.snapStrokeStartRef!.current = { x: 0, y: 0 } as any;
    deps.snapLastBrushSampleRef!.current = { x: 0, y: 0 } as any;
    dynamicDepsRef.current.tools = deps.tools;

    const coalescedEvents: any[] = [
      { clientX: 20, clientY: 25, shiftKey: true, ctrlKey: false },
      { clientX: 22, clientY: 28, shiftKey: true, ctrlKey: false },
    ];

    const handlers = createPointerHandlers(deps);

    handlers.handlePointerMove(makePointerEvent({
      pointerType: 'mouse',
      pressure: 0,
      shiftKey: true,
      clientX: 22,
      clientY: 28,
      nativeEvent: { getCoalescedEvents: () => coalescedEvents as unknown as PointerEvent[] } as any,
    }));

    const firstCall = (deps.drawingHandlers.continueDrawing as jest.Mock).mock.calls[0];
    expect(firstCall?.[1]).toBe(0.1);
  });

  it('uses base pressure for mouse input when pressure is enabled without modifiers', () => {
    const { deps, dynamicDepsRef } = createDeps({
      tools: {
        ...baseDynamic.tools,
        brushSettings: {
          ...baseDynamic.tools.brushSettings,
          pressureEnabled: true,
        },
      },
    });
    deps.interaction.state = { isDrawing: true, isSelecting: false, mode: 'drawing' } as any;
    deps.isMouseDownRef.current = true;
    deps.snapStrokeStartRef!.current = { x: 0, y: 0 } as any;
    deps.snapLastBrushSampleRef!.current = { x: 0, y: 0 } as any;
    dynamicDepsRef.current.tools = deps.tools;

    const handlers = createPointerHandlers(deps);

    handlers.handlePointerMove(makePointerEvent({
      pointerType: 'mouse',
      pressure: 0,
      clientX: 22,
      clientY: 28,
      nativeEvent: { getCoalescedEvents: () => [] as unknown as PointerEvent[] } as any,
    }));

    const firstCall = (deps.drawingHandlers.continueDrawing as jest.Mock).mock.calls[0];
    expect(firstCall?.[1]).toBe(0);
  });

  it('uses variable mouse pressure when pressure-linked fill resolution is enabled', () => {
    const { deps, dynamicDepsRef } = createDeps({
      tools: {
        ...baseDynamic.tools,
        brushSettings: {
          ...baseDynamic.tools.brushSettings,
          pressureEnabled: false,
          pressureLinkedFillResolution: true,
        },
      },
    });
    deps.interaction.state = { isDrawing: true, isSelecting: false, mode: 'drawing' } as any;
    deps.isMouseDownRef.current = true;
    deps.snapStrokeStartRef!.current = { x: 0, y: 0 } as any;
    deps.snapLastBrushSampleRef!.current = { x: 0, y: 0 } as any;
    dynamicDepsRef.current.tools = deps.tools;

    const handlers = createPointerHandlers(deps);

    handlers.handlePointerMove(makePointerEvent({
      pointerType: 'mouse',
      pressure: 0.21,
      clientX: 22,
      clientY: 28,
      nativeEvent: { getCoalescedEvents: () => [] as unknown as PointerEvent[] } as any,
    }));

    const firstCall = (deps.drawingHandlers.continueDrawing as jest.Mock).mock.calls[0];
    expect(firstCall?.[1]).toBeCloseTo(0.21, 3);
  });

  it('uses variable mouse pressure when color-cycle stamp PresRes is enabled', () => {
    const { deps, dynamicDepsRef } = createDeps({
      tools: {
        ...baseDynamic.tools,
        brushSettings: {
          ...baseDynamic.tools.brushSettings,
          pressureEnabled: false,
          pressureLinkedFillResolution: false,
          colorCycleStampDitherPressureLinked: true,
        },
      },
    });
    deps.interaction.state = { isDrawing: true, isSelecting: false, mode: 'drawing' } as any;
    deps.isMouseDownRef.current = true;
    deps.snapStrokeStartRef!.current = { x: 0, y: 0 } as any;
    deps.snapLastBrushSampleRef!.current = { x: 0, y: 0 } as any;
    dynamicDepsRef.current.tools = deps.tools;

    const handlers = createPointerHandlers(deps);

    handlers.handlePointerMove(makePointerEvent({
      pointerType: 'mouse',
      pressure: 0.18,
      clientX: 24,
      clientY: 26,
      nativeEvent: { getCoalescedEvents: () => [] as unknown as PointerEvent[] } as any,
    }));

    const firstCall = (deps.drawingHandlers.continueDrawing as jest.Mock).mock.calls[0];
    expect(firstCall?.[1]).toBeCloseTo(0.18, 3);
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
    await Promise.resolve();

    expect(deps.drawingHandlers.finalizeDrawing).toHaveBeenCalledWith(false);
    expect(deps.stateMachine.finalizationComplete).toHaveBeenCalled();
    expect(deps.compositeLayersToCanvas).toHaveBeenCalledWith(compositeCanvas);
    expect(deps.draw).toHaveBeenCalled();
  });

  it('defers sequential pointer reset until brush finalize resolves', async () => {
    let resolveFinalize: (() => void) | undefined;
    const finalizePromise = new Promise<void>((resolve) => {
      resolveFinalize = resolve;
    });
    const setSequentialPointerDown = jest.fn();
    const stateSnapshot = useAppStore.getState();
    const getStateSpy = jest
      .spyOn(useAppStore, 'getState')
      .mockReturnValue({
        ...stateSnapshot,
        setSequentialPointerDown,
      } as unknown as ReturnType<typeof useAppStore.getState>);

    const { deps } = createDeps();
    deps.interaction.state = { isDrawing: true, isSelecting: false, mode: 'drawing' } as any;
    deps.drawingHandlers.finalizeDrawing = jest.fn(() => finalizePromise);

    const handlers = createPointerHandlers(deps);
    handlers.handlePointerUp(makePointerEvent({ clientX: 2, clientY: 3 }));

    expect(setSequentialPointerDown).not.toHaveBeenCalled();
    if (resolveFinalize) {
      resolveFinalize();
    }
    await Promise.resolve();
    await Promise.resolve();
    expect(setSequentialPointerDown).toHaveBeenCalledWith(false);
    expect(getStateSpy).toHaveBeenCalled();
  });

  it('resets sequential pointer state when shape pointer-up enters direction selection', () => {
    const setSequentialPointerDown = jest.fn();
    const stateSnapshot = useAppStore.getState();
    const getStateSpy = jest
      .spyOn(useAppStore, 'getState')
      .mockReturnValue({
        ...stateSnapshot,
        setSequentialPointerDown,
      } as unknown as ReturnType<typeof useAppStore.getState>);

    const { deps, dynamicDepsRef } = createDeps({
      tools: {
        ...baseDynamic.tools,
        currentTool: 'brush',
        shapeMode: true,
        brushSettings: {
          ...baseDynamic.tools.brushSettings,
          brushShape: BrushShape.COLOR_CYCLE_SHAPE,
          colorCycleFillMode: 'linear',
        } as any,
      },
      currentBrushPresetId: 'not-color-cycle-gradient',
    });

    deps.interaction.state = { isDrawing: true, isSelecting: false, mode: 'drawing' } as any;
    deps.getMousePos = jest.fn(() => ({ x: 9, y: 11 }));
    deps.drawingHandlers.isDrawingShapeRef.current = true;
    deps.drawingHandlers.shapePointsRef.current = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }];
    deps.drawingHandlers.isSelectingDirectionRef.current = false;
    deps.drawingHandlers.finalizeShapeDrawing = jest.fn(() => {
      deps.drawingHandlers.isSelectingDirectionRef.current = true;
      return Promise.resolve();
    });
    dynamicDepsRef.current.currentBrushPresetId = 'not-color-cycle-gradient';

    const handlers = createPointerHandlers(deps);
    handlers.handlePointerUp(makePointerEvent({ clientX: 5, clientY: 5 }));

    expect(setSequentialPointerDown).toHaveBeenCalledWith(false);
    expect(deps.stateMachine.finalizationComplete).not.toHaveBeenCalled();
    expect(getStateSpy).toHaveBeenCalled();
  });

  it('commits the live pointer-up vertex before finalizing a color-cycle shape', async () => {
    const { deps } = createDeps({
      tools: {
        ...baseDynamic.tools,
        currentTool: 'brush',
        shapeMode: true,
        brushSettings: {
          ...baseDynamic.tools.brushSettings,
          brushShape: BrushShape.COLOR_CYCLE_SHAPE,
          colorCycleFillMode: 'concentric',
        } as any,
      },
    });

    deps.interaction.state = { isDrawing: true, isSelecting: false, mode: 'drawing' } as any;
    deps.drawingHandlers.isDrawingShapeRef.current = true;
    deps.drawingHandlers.shapePointsRef.current = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }];
    deps.drawingHandlers.isSelectingDirectionRef.current = false;

    const handlers = createPointerHandlers(deps);
    handlers.handlePointerUp(makePointerEvent({ clientX: 9, clientY: 11 }));

    await Promise.resolve();
    await Promise.resolve();

    expect(deps.drawingHandlers.continueShapeDrawing).toHaveBeenCalledTimes(1);
    expect((deps.drawingHandlers.continueShapeDrawing as jest.Mock).mock.calls[0][0]).toEqual(
      expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) })
    );
    expect(deps.drawingHandlers.finalizeShapeDrawing).toHaveBeenCalled();
    expect((deps.drawingHandlers.continueShapeDrawing as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
      (deps.drawingHandlers.finalizeShapeDrawing as jest.Mock).mock.invocationCallOrder[0]
    );
  });

  it('finalizes shape drawing on pointer up', async () => {
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

    await Promise.resolve();
    await Promise.resolve();

    expect(deps.drawingHandlers.finalizeShapeDrawing).toHaveBeenCalled();
    expect(deps.stateMachine.finalizationComplete).toHaveBeenCalled();
    expect(deps.compositeLayersToCanvas).toHaveBeenCalled();
    expect(deps.setNeedsRedraw).toHaveBeenCalled();
  });

  it('does not commit cached CC dither preview pixels to the layer canvas before finalize', async () => {
    const { deps } = createDeps({
      tools: {
        ...baseDynamic.tools,
        currentTool: 'brush',
        shapeMode: true,
        brushSettings: {
          ...baseDynamic.tools.brushSettings,
          brushShape: BrushShape.COLOR_CYCLE_SHAPE,
          ditherEnabled: true,
          colorCycleFillMode: 'linear',
        } as any,
      },
      project: { ...mockProject, width: 50, height: 50 },
    });

    const layerCanvas = document.createElement('canvas') as HTMLCanvasElement;
    const layerCtx = {
      save: jest.fn(),
      restore: jest.fn(),
      drawImage: jest.fn(),
    } as unknown as CanvasRenderingContext2D;
    (layerCanvas as any).getContext = jest.fn(() => layerCtx);

    useAppStore.setState({
      layers: [{
        id: 'layer-cc',
        name: 'CC',
        visible: true,
        opacity: 1,
        blendMode: 'source-over',
        locked: false,
        layerType: 'color-cycle',
        colorCycleData: { canvas: layerCanvas },
      } as any],
      activeLayerId: 'layer-cc',
    });

    deps.interaction.state = { isDrawing: true, isSelecting: false, mode: 'drawing' } as any;
    deps.drawingHandlers.isDrawingShapeRef.current = true;
    deps.drawingHandlers.shapePointsRef.current = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }];
    deps.drawingHandlers.isSelectingDirectionRef.current = false;
    deps.drawingHandlers.ccShapePreviewCacheRef = {
      current: {
        canvas: document.createElement('canvas'),
        origin: { x: 3, y: 4 },
      },
    };

    const handlers = createPointerHandlers(deps);
    handlers.handlePointerUp(makePointerEvent({ clientX: 4, clientY: 4 }));

    await Promise.resolve();
    await Promise.resolve();

    expect(layerCtx.drawImage).not.toHaveBeenCalled();
    expect(deps.drawingHandlers.finalizeShapeDrawing).toHaveBeenCalled();

    useAppStore.setState({
      layers: [],
      activeLayerId: null,
    });
  });
});
