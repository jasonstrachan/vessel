/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { useCanvasEventHandlers } from '../../useCanvasEventHandlers';
import type { EventHandlerDependenciesInput } from '../../canvasEventHandlerDeps';
import { captureSelectionSnapshot } from '@/history/helpers/selectionHistory';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import { createPointerHandlers } from '../pointerHandlers';
import {
  resolveDitherShapePreviewMaskOptions,
  resolveShapePreviewOpacity,
} from '../pointerHandlersRuntime';
import { useAppStore } from '@/stores/useAppStore';
import * as selectionCapture from '@/stores/helpers/selectionCapture';
import historyManager from '@/history/historyService';
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
    canvas,
    clearRect: jest.fn(),
    save: jest.fn(),
    translate: jest.fn(),
    scale: jest.fn(),
    beginPath: jest.fn(),
    arc: jest.fn(),
    rect: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    closePath: jest.fn(),
    fill: jest.fn(),
    stroke: jest.fn(),
    restore: jest.fn(),
    fillRect: jest.fn(),
    drawImage: jest.fn(),
    setTransform: jest.fn(),
    createPattern: jest.fn(() => null),
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
  const { shapeBrushRuntime = null, ...restDepOverrides } = depOverrides;
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
  const drawingCanvasHasContentRef = { current: false };

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
    rememberColorCycleGradient: jest.fn(),
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
        drawingCanvasHasContent: drawingCanvasHasContentRef,
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
      drawingCanvasHasContent: drawingCanvasHasContentRef,
      isSelectingDirectionRef: { current: false },
      beginStrokeSession: jest.fn(),
      startDrawing: jest.fn(),
      startShapeDrawing: jest.fn().mockReturnValue(true),
      continueDrawing: jest.fn(),
      continueShapeDrawing: jest.fn(),
      finalizeDrawing: jest.fn().mockResolvedValue(undefined),
      finalizeShapeDrawing: jest.fn().mockResolvedValue(undefined),
      triggerSimpleShapePreview: jest.fn(),
      endStrokeSession: jest.fn(),
      clearStrokeSession: jest.fn(),
      clearDrawingCanvas: jest.fn(() => {
        drawingCanvasHasContentRef.current = false;
      }),
      stopContinuousColorCycleAnimation: jest.fn(),
      resumeColorCycleAfterInteraction: jest.fn().mockResolvedValue(undefined),
      isDrawingShapeRef: { current: false },
      shapePointsRef: { current: [] },
      ccStrokeSamplesRef: { current: [] },
      ccStrokeDirectionRef: { current: null },
      directionPreviewRef: { current: null },
      ccGradientDrawingGeometryRef: { current: null },
      ccGradientClickLineSessionRef: {
        current: { active: false, points: [], previewPoint: null },
      },
      ccShapePreviewCacheRef: { current: null },
      coerceDragShapeToPolygon: jest.fn(),
      seedManualStrokeBoundingBox: jest.fn(),
      updateDitherGradSamples: jest.fn(),
    } as any,
    brushRuntime: null,
    shapeBrushRuntime,
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
    ...restDepOverrides,
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
  timeStamp: 0,
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

const makeMouseEvent = (overrides: Partial<React.MouseEvent<Element>> = {}) => ({
  preventDefault: jest.fn(),
  stopPropagation: jest.fn(),
  clientX: 10,
  clientY: 10,
  timeStamp: 0,
  ...overrides,
} as unknown as React.MouseEvent<Element>);

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

  it('uses the standardized opacity for every shape preview', () => {
    expect(resolveShapePreviewOpacity()).toBe(0.6);
  });

  it.each([
    [true, false], [true, true], [false, false], [false, true],
  ])('admits rectangle world width before preview RAF (drawing=%s, queued=%s)', (isDrawing, queued) => {
    const { deps } = createDeps({
      tools: {
        ...baseDynamic.tools,
        brushSettings: { ...baseDynamic.tools.brushSettings, brushShape: BrushShape.RECTANGLE_GRADIENT },
      },
    });
    deps.interaction.state.isDrawing = isDrawing;
    deps.toolStateMachine.isRectangleGradient = true;
    deps.toolStateMachine.rectangleBrushState = {
      drawingState: 'definingWidth', startPos: { x: 64, y: 128 }, endPos: { x: 192, y: 128 },
      currentPos: { x: 192, y: 128 }, width: 0, startColor: '#000000', endColor: '#ffffff',
    };
    deps.pan.screenToWorld = (x, y) => ({ x: x * 2 - 32, y: y * 2 - 20 });
    deps.pan.worldToScreen = (x, y) => ({ x: (x + 32) / 2, y: (y + 20) / 2 });
    const move = jest.mocked(deps.toolStateMachine.handleRectangleGradientMouseMove).mockReturnValue('width');
    const previewCallbacks: FrameRequestCallback[] = [];
    jest.spyOn(global, 'requestAnimationFrame').mockImplementation(callback => {
      previewCallbacks.push(callback);
      return previewCallbacks.length;
    });
    jest.spyOn(performance, 'now').mockReturnValue(1000);
    deps.previewAnimationFrameRef!.current = queued ? 99 : null;
    const handlers = createPointerHandlers(deps);
    handlers.handlePointerMove(makePointerEvent({ clientX: 80, clientY: 90, buttons: 0 }));

    expect(move).toHaveBeenCalledTimes(1);
    expect(move).toHaveBeenCalledWith({ x: 128, y: 160 });
    expect(deps.setRectangleBrushState).not.toHaveBeenCalled();
    if (queued) {
      expect(previewCallbacks).toHaveLength(0);
    } else {
      const overlay = deps.overlayCanvasRef.current!;
      const context = overlay.getContext('2d')!;
      context.createLinearGradient = jest.fn(() => ({ addColorStop: jest.fn() }) as unknown as CanvasGradient);
      const overlay2d: { getContext(id: '2d'): CanvasRenderingContext2D | null } = overlay;
      jest.spyOn(overlay2d, 'getContext').mockReturnValue(context);
      jest.mocked(deps.sampleColorsAlongLine).mockReturnValue(['#000000', '#ffffff']);
      // A delayed old preview must not regain authority over newer world state.
      deps.toolStateMachine.rectangleBrushState.currentPos = { x: 128, y: 180 };
      deps.toolStateMachine.rectangleBrushState.width = 104;
      expect(previewCallbacks).toHaveLength(1);
      previewCallbacks[0](1000);
      expect(deps.setRectangleBrushState).not.toHaveBeenCalled();
    }
  });

  it('promotes dither-shape preview masks to whole cells only for Pxl Edge', () => {
    expect(resolveDitherShapePreviewMaskOptions({
      isDitherShapePreview: true,
      pixelSize: 7,
      pxlEdge: true,
    })).toEqual({
      hardEdges: true,
      pixelSize: 7,
      wholeCells: true,
    });
    expect(resolveDitherShapePreviewMaskOptions({
      isDitherShapePreview: true,
      pixelSize: 7,
      pxlEdge: false,
    })).toEqual({
      hardEdges: true,
      pixelSize: undefined,
      wholeCells: false,
    });
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

  it('does not bootstrap the selected brush while a floating paste owns the pointer', () => {
    const { deps } = createDeps({
      floatingPaste: {
        active: true,
        imageData: null,
        position: { x: 10, y: 10 },
        width: 20,
        height: 30,
        displayWidth: 20,
        displayHeight: 30,
        rotation: 0,
        originalPosition: { x: 10, y: 10 },
      },
    });
    const handlers = createPointerHandlers(deps);

    // The overlay captures pointerdown, then its captured pointermove bubbles to
    // the canvas wrapper with the primary button held.
    handlers.handlePointerMove(makePointerEvent({ buttons: 1, clientX: 21, clientY: 22 }));

    expect(deps.drawingHandlers.beginStrokeSession).not.toHaveBeenCalled();
    expect(deps.drawingHandlers.startDrawing).not.toHaveBeenCalled();
  });

  it('starts a regular brush stroke at its outside-document anchor', () => {
    const { deps } = createDeps();
    deps.stateMachine.state.mode = 'IDLE';
    const handlers = createPointerHandlers(deps);

    handlers.handlePointerDown(makePointerEvent({ clientX: -12, clientY: 24, buttons: 1 }));

    expect(deps.isMouseDownRef.current).toBe(true);
    expect(deps.drawingHandlers.beginStrokeSession).toHaveBeenCalledTimes(1);
    expect(deps.drawingHandlers.startDrawing).toHaveBeenCalledWith(
      { x: -12, y: 24 },
      expect.any(Number),
    );
  });

  it('starts an eraser stroke at its outside-document anchor', () => {
    const { deps, dynamicDepsRef } = createDeps({
      tools: { ...baseDynamic.tools, currentTool: 'eraser' },
    });
    dynamicDepsRef.current.tools = deps.tools;
    deps.stateMachine.state.mode = 'IDLE';
    const handlers = createPointerHandlers(deps);

    handlers.handlePointerDown(makePointerEvent({ clientX: 18, clientY: -9, buttons: 1 }));

    expect(deps.isMouseDownRef.current).toBe(true);
    expect(deps.drawingHandlers.startDrawing).toHaveBeenCalledWith(
      { x: 18, y: -9 },
      expect.any(Number),
    );
  });

  it.each(['brush', 'eraser'] as const)(
    'does not enter drawing or finalize a rejected %s start',
    (currentTool) => {
      const { deps } = createDeps({
        tools: { ...baseDynamic.tools, currentTool },
      });
      deps.stateMachine.state.mode = 'IDLE';
      deps.drawingHandlers.startDrawing = jest.fn().mockReturnValue(false);
      deps.interaction.dispatch = jest.fn((action) => {
        deps.interaction.state.isDrawing = action.type === 'DRAWING_START';
      });
      const handlers = createPointerHandlers(deps);

      handlers.handlePointerDown(makePointerEvent({ buttons: 1 }));
      handlers.handlePointerMove(makePointerEvent({ buttons: 1, clientX: 20 }));
      handlers.handlePointerUp(makePointerEvent({ buttons: 0 }));

      expect(deps.drawingHandlers.startDrawing).toHaveBeenCalledTimes(1);
      expect(deps.interaction.dispatch).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'DRAWING_START' }),
      );
      expect(deps.stateMachine.dispatch).toHaveBeenCalledWith({ type: 'FORCE_IDLE' });
      expect(deps.drawingHandlers.clearStrokeSession).toHaveBeenCalledTimes(1);
      expect(deps.isMouseDownRef.current).toBe(false);
      expect(deps.drawingHandlers.continueDrawing).not.toHaveBeenCalled();
      expect(deps.drawingHandlers.finalizeDrawing).not.toHaveBeenCalled();
    },
  );

  it.each(['brush', 'eraser'] as const)(
    'enters drawing only after the %s start accepts',
    (currentTool) => {
      const { deps } = createDeps({
        tools: { ...baseDynamic.tools, currentTool },
      });
      deps.stateMachine.state.mode = 'IDLE';
      deps.drawingHandlers.startDrawing = jest.fn(() => {
        expect(deps.interaction.state.isDrawing).toBe(false);
        return true;
      });
      deps.interaction.dispatch = jest.fn((action) => {
        deps.interaction.state.isDrawing = action.type === 'DRAWING_START';
      });
      const handlers = createPointerHandlers(deps);

      handlers.handlePointerDown(makePointerEvent({ buttons: 1 }));

      expect(deps.drawingHandlers.startDrawing).toHaveBeenCalledTimes(1);
      expect(deps.interaction.state.isDrawing).toBe(true);
      expect(deps.drawingHandlers.clearStrokeSession).not.toHaveBeenCalled();
    },
  );

  it.each(['brush', 'eraser'] as const)(
    'does not bootstrap or finalize a rejected %s start on canvas entry',
    (currentTool) => {
      const { deps } = createDeps({
        tools: { ...baseDynamic.tools, currentTool },
      });
      deps.drawingHandlers.startDrawing = jest.fn().mockReturnValue(false);
      deps.interaction.dispatch = jest.fn((action) => {
        deps.interaction.state.isDrawing = action.type === 'DRAWING_START';
      });
      const handlers = createPointerHandlers(deps);

      handlers.handlePointerMove(makePointerEvent({ buttons: 1, clientX: 20 }));
      handlers.handlePointerMove(makePointerEvent({ buttons: 1, clientX: 25 }));
      handlers.handlePointerUp(makePointerEvent({ buttons: 0 }));

      expect(deps.drawingHandlers.startDrawing).toHaveBeenCalledTimes(1);
      expect(deps.interaction.dispatch).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'DRAWING_START' }),
      );
      expect(deps.stateMachine.dispatch).toHaveBeenCalledWith({ type: 'FORCE_IDLE' });
      expect(deps.drawingHandlers.clearStrokeSession).toHaveBeenCalledTimes(1);
      expect(deps.isMouseDownRef.current).toBe(false);
      expect(deps.drawingHandlers.continueDrawing).not.toHaveBeenCalled();
      expect(deps.drawingHandlers.finalizeDrawing).not.toHaveBeenCalled();
    },
  );

  it('starts a regular shape at its outside-document anchor', () => {
    const { deps, dynamicDepsRef } = createDeps({
      tools: { ...baseDynamic.tools, shapeMode: true },
    });
    dynamicDepsRef.current.tools = deps.tools;
    const handlers = createPointerHandlers(deps);

    handlers.handlePointerDown(makePointerEvent({ clientX: -14, clientY: 28, buttons: 1 }));

    expect(deps.drawingHandlers.startShapeDrawing).toHaveBeenCalledWith(
      { x: -14, y: 28 },
      expect.any(Number),
    );
  });

  it('does not leak an extension overlay gesture into the normal stroke bootstrap', () => {
    const { deps, dynamicDepsRef } = createDeps({
      tools: {
        ...baseDynamic.tools,
        currentTool: 'brush',
        brushSettings: {
          ...baseDynamic.tools.brushSettings,
          brushShape: BrushShape.EXTENSION,
        },
      },
    });
    dynamicDepsRef.current.tools = deps.tools;
    const handlers = createPointerHandlers(deps);

    handlers.handlePointerDown(makePointerEvent({ clientX: -5, clientY: 20, buttons: 1 }));
    handlers.handlePointerMove(makePointerEvent({ clientX: 20, clientY: 20, buttons: 1 }));

    expect(deps.suppressBootstrapUntilPointerUpRef.current).toBe(true);
    expect(deps.drawingHandlers.beginStrokeSession).not.toHaveBeenCalled();
    expect(deps.drawingHandlers.startDrawing).not.toHaveBeenCalled();
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

  it('starts erasing while the selected brush preset is CC gradient shape mode', () => {
    const { deps } = createDeps({
      tools: {
        ...baseDynamic.tools,
        currentTool: 'eraser',
        shapeMode: true,
        brushSettings: {
          ...baseDynamic.tools.brushSettings,
          brushShape: BrushShape.COLOR_CYCLE_SHAPE,
          colorCycleFillMode: 'linear',
        } as any,
      },
      currentBrushPresetId: 'color-cycle-gradient',
    });
    deps.stateMachine.state = { mode: 'IDLE' } as any;
    const handlers = createPointerHandlers(deps);

    handlers.handlePointerDown(makePointerEvent({ clientX: 12, clientY: 14 }));

    expect(deps.setCursorStyle).toHaveBeenCalledWith('none');
    expect(deps.setShowBrushCursor).toHaveBeenCalledWith(true);
    expect(deps.drawingHandlers.beginStrokeSession).toHaveBeenCalledWith({
      pointerId: 1,
      layerId: null,
      tool: 'eraser',
      brushId: 'color-cycle-gradient',
    });
    expect(deps.drawingHandlers.startDrawing).toHaveBeenCalledWith({ x: 12, y: 14 }, expect.any(Number));
    expect(deps.drawingHandlers.startShapeDrawing).not.toHaveBeenCalled();
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

  it('adds an exact CC pixel gradient to the shared palette instead of sampling one color', () => {
    const layer = {
      id: 'cc-layer',
      visible: true,
      layerType: 'color-cycle',
    } as any;
    const { deps, dynamicDepsRef } = createDeps({
      layers: [layer],
      activeLayerId: layer.id,
      tools: {
        ...baseDynamic.tools,
        currentTool: 'color-picker',
        brushSettings: {
          ...baseDynamic.tools.brushSettings,
          ccGradientSource: 'sampled',
        } as any,
      },
    });
    const stops = [
      { position: 0, color: '#ff0000' },
      { position: 0.5, color: '#00ff00', opacity: 0.75 },
      { position: 1, color: '#0000ff' },
    ];
    const runtimeStops = stops.map((stop) => ({ ...stop }));
    deps.resolvePickedColorCycleGradientAtPosition = jest.fn(() => ({
      stops,
      runtimeStops,
      seamProfile: 'soft',
      motion: { phaseByte: 91, speedByte: 17, flowByte: 2 },
    }));
    dynamicDepsRef.current.tools.currentTool = 'color-picker';
    deps.tools = dynamicDepsRef.current.tools;

    const handlers = createPointerHandlers(deps);
    handlers.handlePointerDown(makePointerEvent({ clientX: 5, clientY: 6 }));

    expect(deps.resolvePickedColorCycleGradientAtPosition).toHaveBeenCalledWith(
      layer.id,
      5,
      6,
    );
    expect(deps.rememberColorCycleGradient).toHaveBeenCalledWith({
      stops,
      runtimeStops,
      seamProfile: 'soft',
      motion: { phaseByte: 91, speedByte: 17, flowByte: 2 },
    });
    expect(deps.setBrushSettings).not.toHaveBeenCalled();
    expect(deps.setActiveColor).not.toHaveBeenCalled();
    expect(deps.sampleColorAtPosition).not.toHaveBeenCalled();
  });

  it('picks from the active CC layer while regular pixels target the reference layer', () => {
    const activeLayer = {
      id: 'cc-layer',
      visible: true,
      layerType: 'color-cycle',
    } as any;
    const referenceLayer = {
      id: 'reference-layer',
      visible: true,
      layerType: 'normal',
    } as any;
    const { deps, dynamicDepsRef } = createDeps({
      layers: [activeLayer, referenceLayer],
      activeLayerId: activeLayer.id,
      tools: {
        ...baseDynamic.tools,
        currentTool: 'color-picker',
      },
    });
    const stateSnapshot = useAppStore.getState();
    jest.spyOn(useAppStore, 'getState').mockReturnValue({
      ...stateSnapshot,
      colorPickerPreferReferenceLayer: true,
      project: {
        ...stateSnapshot.project,
        referenceLayerId: referenceLayer.id,
      } as Project,
    });
    const pickedGradient = {
      stops: [{ position: 0, color: '#123456' }, { position: 1, color: '#abcdef' }],
      runtimeStops: [{ position: 0, color: '#123456' }, { position: 1, color: '#abcdef' }],
      seamProfile: 'soft' as const,
    };
    deps.sampleColorAtPosition = jest.fn(() => '#123456');
    deps.resolvePickedColorCycleGradientAtPosition = jest.fn(() => pickedGradient);
    dynamicDepsRef.current.tools.currentTool = 'color-picker';
    deps.tools = dynamicDepsRef.current.tools;

    const handlers = createPointerHandlers(deps);
    handlers.handlePointerDown(makePointerEvent({ clientX: 5, clientY: 6 }));

    expect(deps.resolvePickedColorCycleGradientAtPosition).toHaveBeenCalledWith(
      activeLayer.id,
      5,
      6,
    );
    expect(deps.rememberColorCycleGradient).toHaveBeenCalledWith(pickedGradient);
    expect(deps.setActiveColor).not.toHaveBeenCalled();
    expect(deps.sampleColorAtPosition).not.toHaveBeenCalled();
  });

  it('lets the palette owner deduplicate repeated CC gradient picks', () => {
    const stops = [
      { position: 0, color: '#112233' },
      { position: 1, color: '#ddeeff' },
    ];
    const layer = {
      id: 'cc-layer',
      visible: true,
      layerType: 'color-cycle',
    } as any;
    const { deps, dynamicDepsRef } = createDeps({
      layers: [layer],
      activeLayerId: layer.id,
      tools: {
        ...baseDynamic.tools,
        currentTool: 'color-picker',
        brushSettings: {
          ...baseDynamic.tools.brushSettings,
          ccGradientSource: 'manual',
          colorCycleGradient: stops,
          colorCycleGradientSeamProfile: 'hard',
          colorCycleGradientIsRuntimePalette: true,
        } as any,
      },
    });
    deps.resolvePickedColorCycleGradientAtPosition = jest.fn(() => ({
      stops: stops.map((stop) => ({ ...stop })),
      runtimeStops: stops.map((stop) => ({ ...stop })),
      seamProfile: 'hard',
    }));
    dynamicDepsRef.current.tools.currentTool = 'color-picker';
    deps.tools = dynamicDepsRef.current.tools;

    const handlers = createPointerHandlers(deps);
    handlers.handlePointerDown(makePointerEvent({ clientX: 5, clientY: 6 }));

    expect(deps.rememberColorCycleGradient).toHaveBeenCalledWith({
      stops,
      runtimeStops: stops,
      seamProfile: 'hard',
    });
    expect(deps.setBrushSettings).not.toHaveBeenCalled();
    expect(deps.setActiveColor).not.toHaveBeenCalled();
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

    expect(deps.setCursorPosition).toHaveBeenCalledWith(10, 10, {
      pressure: 0.5,
      isDrawing: true,
    });
  });

  it('propagates cursor pressure state across pointer down, up, and cancel', () => {
    const { deps, dynamicDepsRef } = createDeps(
      {
        tools: {
          ...baseDynamic.tools,
          currentTool: 'brush',
          shapeMode: false,
          brushSettings: {
            ...baseDynamic.tools.brushSettings,
            brushShape: BrushShape.ROUND,
            pressureEnabled: true,
          } as any,
        },
      },
      {
        getMousePos: jest.fn(() => ({ x: 10, y: 10 })),
      }
    );

    dynamicDepsRef.current.tools = deps.tools;
    const handlers = createPointerHandlers(deps);
    const event = makePointerEvent({
      clientX: 10,
      clientY: 10,
      pointerType: 'pen',
      pressure: 0.8,
    });

    handlers.handlePointerDown(event);
    expect(deps.setCursorPosition).toHaveBeenLastCalledWith(10, 10, {
      pressure: 0.8,
      isDrawing: true,
    });

    (deps.setCursorPosition as jest.Mock).mockClear();
    handlers.handlePointerUp(event);
    expect(deps.setCursorPosition).toHaveBeenLastCalledWith(10, 10, {
      pressure: 0.8,
      isDrawing: false,
    });

    (deps.setCursorPosition as jest.Mock).mockClear();
    handlers.handlePointerCancel(event);
    expect(deps.setCursorPosition).toHaveBeenLastCalledWith(10, 10, {
      pressure: 0,
      isDrawing: false,
    });
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

  it('starts a replacement marquee without clearing its history baseline on an outside click', () => {
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

    expect(deps.clearSelection).not.toHaveBeenCalled();
    expect(deps.setSelectionBounds).toHaveBeenCalledWith(
      { x: 90, y: 90 },
      { x: 90, y: 90 },
      'selection-marquee-start'
    );
    expect(deps.interaction.dispatch).toHaveBeenCalledWith({ type: 'SELECTION_START' });
    expect(deps.isMouseDownRef.current).toBe(true);
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
      { x: 11, y: 11 },
      'selection-marquee-final'
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
      { x: 100, y: 100 },
      'selection-marquee-final'
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

    handlers.handlePointerMove(makePointerEvent({
      clientX: 8,
      clientY: 9,
      buttons: 1,
    }));
    expect(deps.updateFloatingPastePosition).toHaveBeenCalledWith(7, 8);

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

  it('starts a replacement marquee without clearing the original mask before admission', () => {
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

    expect(deps.clearSelection).not.toHaveBeenCalled();
    expect(deps.setSelectionBounds).toHaveBeenCalledWith(
      { x: 10, y: 10 },
      { x: 10, y: 10 },
      'selection-marquee-start'
    );
    expect(deps.interaction.dispatch).toHaveBeenCalledWith({ type: 'SELECTION_START' });
    expect(deps.isMouseDownRef.current).toBe(true);
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

  it('fills only visible pixels in a mask-backed selection', () => {
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
    expect((deps.updateLayer as jest.Mock).mock.calls[0][2]).toEqual({
      dirtyRects: [{ x: 1, y: 0, width: 1, height: 1 }],
    });
    const updatedImageData = (deps.updateLayer as jest.Mock).mock.calls[0][1].imageData as ImageData;
    expect(Array.from(updatedImageData.data)).toEqual([
      0, 0, 0, 0,
      0, 0, 0, 255,
      0, 0, 0, 0,
    ]);
  });

  it('fills the whole rectangular selection even when clicking outside it', () => {
    const framebuffer = document.createElement('canvas');
    framebuffer.width = 4;
    framebuffer.height = 1;
    const initialImage = new ImageData(
      new Uint8ClampedArray([
        255, 0, 0, 255,
        0, 255, 0, 255,
        0, 0, 255, 255,
        255, 255, 0, 255,
      ]),
      4,
      1,
    );
    framebuffer.getContext('2d')?.putImageData(initialImage, 0, 0);

    const { deps, dynamicDepsRef } = createDeps({
      tools: {
        ...baseDynamic.tools,
        currentTool: 'fill',
        fillSettings: { threshold: 0, contiguous: true, eraseInstead: false },
      } as any,
      layers: [{
        id: 'layer-1',
        imageData: initialImage,
        framebuffer,
        layerType: 'normal',
      } as any],
      activeLayerId: 'layer-1',
      project: { ...mockProject, width: 4, height: 1 },
      selectionStart: { x: 1, y: 0 },
      selectionEnd: { x: 3, y: 1 },
    });
    dynamicDepsRef.current.tools = deps.tools;
    dynamicDepsRef.current.selectionStart = deps.selectionStart;
    dynamicDepsRef.current.selectionEnd = deps.selectionEnd;

    const handlers = createPointerHandlers(deps);
    handlers.handlePointerDown(makePointerEvent({ clientX: 0, clientY: 0 }));

    expect(deps.updateLayer).toHaveBeenCalledTimes(1);
    expect((deps.updateLayer as jest.Mock).mock.calls[0][2]).toEqual({
      dirtyRects: [{ x: 1, y: 0, width: 2, height: 1 }],
    });
    const updatedImageData = (deps.updateLayer as jest.Mock).mock.calls[0][1].imageData as ImageData;
    expect(Array.from(updatedImageData.data)).toEqual([
      255, 0, 0, 255,
      0, 0, 0, 255,
      0, 0, 0, 255,
      255, 255, 0, 255,
    ]);
    expect(Array.from(initialImage.data)).toEqual([
      255, 0, 0, 255,
      0, 255, 0, 255,
      0, 0, 255, 255,
      255, 255, 0, 255,
    ]);
  });

  it('does not update a layer when the selected pixels already match the fill color', () => {
    const framebuffer = document.createElement('canvas');
    framebuffer.width = 2;
    framebuffer.height = 1;
    const initialImage = new ImageData(
      new Uint8ClampedArray([
        0, 0, 0, 255,
        0, 0, 0, 255,
      ]),
      2,
      1,
    );
    framebuffer.getContext('2d')?.putImageData(initialImage, 0, 0);

    const { deps, dynamicDepsRef } = createDeps({
      tools: {
        ...baseDynamic.tools,
        currentTool: 'fill',
        fillSettings: { threshold: 0, contiguous: true, eraseInstead: false },
      } as any,
      layers: [{
        id: 'layer-1',
        imageData: initialImage,
        framebuffer,
        layerType: 'normal',
      } as any],
      activeLayerId: 'layer-1',
      project: { ...mockProject, width: 2, height: 1 },
      selectionStart: { x: 0, y: 0 },
      selectionEnd: { x: 2, y: 1 },
    });
    dynamicDepsRef.current.tools = deps.tools;
    dynamicDepsRef.current.selectionStart = deps.selectionStart;
    dynamicDepsRef.current.selectionEnd = deps.selectionEnd;

    const handlers = createPointerHandlers(deps);
    handlers.handlePointerDown(makePointerEvent({ clientX: 0, clientY: 0 }));

    expect(deps.updateLayer).not.toHaveBeenCalled();
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

  it('keeps dither gradient pointer capture after starting outside canvas', () => {
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
    const target = {
      setPointerCapture: jest.fn(),
      releasePointerCapture: jest.fn(),
      hasPointerCapture: jest.fn().mockReturnValue(true),
    } as unknown as EventTarget & {
      setPointerCapture: jest.Mock;
      releasePointerCapture: jest.Mock;
      hasPointerCapture: jest.Mock;
    };
    handlers.handlePointerDown(makePointerEvent({ clientX: -5, clientY: -5, target }));

    expect(target.releasePointerCapture).not.toHaveBeenCalled();

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
      { x: -8, y: -12 },
      'selection-marquee-start'
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
    handlers.handlePointerDown(makePointerEvent({ pointerType: 'pen', clientX: 24, clientY: 36, detail: 1 }));

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
    firstHandlers.handlePointerDown(makePointerEvent({ pointerType: 'pen', clientX: 10, clientY: 12, detail: 1 }));

    deps.interaction = {
      ...deps.interaction,
      refs: {
        ...deps.interaction.refs,
        selectionStart: { current: null },
      },
    } as any;

    const secondHandlers = createPointerHandlers(deps);
    secondHandlers.handlePointerDown(makePointerEvent({ pointerType: 'pen', clientX: 30, clientY: 34, detail: 1 }));

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
    handlers.handlePointerDown(makePointerEvent({ pointerType: 'pen', clientX: 10, clientY: 12, detail: 1 }));

    deps.tools = {
      ...deps.tools,
      selectionMode: 'marquee',
    } as any;
    dynamicDepsRef.current.tools = deps.tools;

    handlers.handlePointerDown(makePointerEvent({ pointerType: 'pen', clientX: 20, clientY: 24, detail: 1 }));
    deps.interaction.state = { ...deps.interaction.state, isSelecting: true } as any;

    handlers.handlePointerMove(makePointerEvent({ pointerType: 'pen', clientX: 30, clientY: 34 }));

    expect(deps.setSelectionBounds).toHaveBeenLastCalledWith(
      { x: 20, y: 24 },
      { x: 30, y: 34 },
      'selection-marquee-preview'
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

  it('preserves coalesced freehand Color Cycle shape boundary points', () => {
    const { deps, dynamicDepsRef } = createDeps({
      tools: {
        ...baseDynamic.tools,
        shapeMode: true,
        brushSettings: {
          ...baseDynamic.tools.brushSettings,
          brushShape: BrushShape.COLOR_CYCLE_SHAPE,
        } as any,
      },
    });
    dynamicDepsRef.current.tools = deps.tools;
    deps.toolStateMachine.isColorCycleShape = true;
    deps.drawingHandlers.isDrawingShapeRef.current = true;
    deps.interaction.state = { isDrawing: true, isSelecting: false, mode: 'drawing' } as any;
    deps.isMouseDownRef.current = true;

    const handlers = createPointerHandlers(deps);
    handlers.handlePointerMove(makePointerEvent({
      clientX: 40,
      clientY: 45,
      nativeEvent: {
        getCoalescedEvents: () => [
          { clientX: 20, clientY: 25, shiftKey: false, pressure: 0.8 },
          { clientX: 30, clientY: 35, shiftKey: false, pressure: 0.8 },
          { clientX: 40, clientY: 45, shiftKey: false, pressure: 0.8 },
        ] as unknown as PointerEvent[],
      } as any,
    }));

    expect(deps.drawingHandlers.continueShapeDrawing).toHaveBeenNthCalledWith(1, { x: 20, y: 25 });
    expect(deps.drawingHandlers.continueShapeDrawing).toHaveBeenNthCalledWith(2, { x: 30, y: 35 });
  });

  it('processes rapid Color Cycle shape moves without dropping them to the RAF aggregator', () => {
    const queuedFrames: FrameRequestCallback[] = [];
    const previousRaf = global.requestAnimationFrame;
    global.requestAnimationFrame = (callback: FrameRequestCallback): number => {
      queuedFrames.push(callback);
      return queuedFrames.length;
    };
    try {
      const { deps, dynamicDepsRef } = createDeps({
        tools: {
          ...baseDynamic.tools,
          shapeMode: true,
          brushSettings: {
            ...baseDynamic.tools.brushSettings,
            brushShape: BrushShape.COLOR_CYCLE_SHAPE,
          } as any,
        },
      });
      dynamicDepsRef.current.tools = deps.tools;
      deps.toolStateMachine.isColorCycleShape = true;
      deps.drawingHandlers.isDrawingShapeRef.current = true;
      deps.interaction.state = { isDrawing: true, isSelecting: false, mode: 'drawing' } as any;
      deps.isMouseDownRef.current = true;

      const handlers = createPointerHandlers(deps);
      handlers.handlePointerMove(makePointerEvent({
        buttons: 1,
        clientX: 20,
        clientY: 25,
        pointerType: 'pen',
        pressure: 1,
      }));
      handlers.handlePointerMove(makePointerEvent({
        buttons: 1,
        clientX: 30,
        clientY: 35,
        pointerType: 'pen',
        pressure: 1,
      }));

      expect(deps.drawingHandlers.continueShapeDrawing).toHaveBeenNthCalledWith(
        1,
        { x: 20, y: 25 },
        1,
        0,
        1,
      );
      expect(deps.drawingHandlers.continueShapeDrawing).toHaveBeenNthCalledWith(
        2,
        { x: 30, y: 35 },
        1,
        0,
        1,
      );
      expect(queuedFrames).toHaveLength(0);
    } finally {
      global.requestAnimationFrame = previousRaf;
    }
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

  it.each([
    { rawPressure: 0, expectedPressure: 0.5, label: 'missing' },
    { rawPressure: 0.2, expectedPressure: 0.2, label: 'low' },
    { rawPressure: 0.5, expectedPressure: 0.5, label: 'neutral' },
    { rawPressure: 1, expectedPressure: 1, label: 'full' },
  ])(
    'preserves $label mouse-classified tablet pressure without collapsing the stroke',
    ({ rawPressure, expectedPressure }) => {
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
        pressure: rawPressure,
        clientX: 22,
        clientY: 28,
        nativeEvent: { getCoalescedEvents: () => [] as unknown as PointerEvent[] } as any,
      }));

      const firstCall = (deps.drawingHandlers.continueDrawing as jest.Mock).mock.calls[0];
      expect(firstCall?.[1]).toBeCloseTo(expectedPressure, 3);
    },
  );

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

  it('uses variable mouse pressure when only Pencil is enabled', () => {
    const { deps, dynamicDepsRef } = createDeps({
      tools: {
        ...baseDynamic.tools,
        brushSettings: {
          ...baseDynamic.tools.brushSettings,
          pressureEnabled: false,
          pressureLinkedFillResolution: false,
          colorCycleStampDitherPressureLinked: false,
          colorCyclePencilEnabled: true,
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
    expect(deps.compositeLayersToCanvas).not.toHaveBeenCalledWith(compositeCanvas);
    expect(deps.draw).not.toHaveBeenCalled();
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

  it('enters direction selection for linear CC Gradient shapes when visible Colors is greater than 1', () => {
    const setSequentialPointerDown = jest.fn();
    const stateSnapshot = useAppStore.getState();
    const getStateSpy = jest
      .spyOn(useAppStore, 'getState')
      .mockReturnValue({
        ...stateSnapshot,
        setSequentialPointerDown,
      } as unknown as ReturnType<typeof useAppStore.getState>);

    const { deps } = createDeps({
      currentBrushPresetId: 'color-cycle-gradient',
      tools: {
        ...baseDynamic.tools,
        currentTool: 'brush',
        shapeMode: true,
        brushSettings: {
          ...baseDynamic.tools.brushSettings,
          brushShape: BrushShape.COLOR_CYCLE_SHAPE,
          colorCycleFillMode: 'linear',
          ccGradientDrawingShape: 'freehand',
          colors: 1,
          gradientBands: 2,
        } as any,
      },
    });

    deps.interaction.state = { isDrawing: true, isSelecting: false, mode: 'drawing' } as any;
    deps.drawingHandlers.isDrawingShapeRef.current = true;
    deps.drawingHandlers.shapePointsRef.current = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }];
    deps.drawingHandlers.isSelectingDirectionRef.current = false;
    deps.drawingHandlers.ccShapePreviewCacheRef.current = {
      canvas: document.createElement('canvas'),
      origin: { x: 0, y: 0 },
      width: 20,
      height: 20,
      key: 'stale-preview',
    } as any;
    const overlayGetContext = deps.overlayCanvasRef.current!.getContext as jest.Mock;

    const handlers = createPointerHandlers(deps);
    handlers.handlePointerUp(makePointerEvent({ clientX: 30, clientY: 30 }));
    const overlayCtx = overlayGetContext.mock.results[overlayGetContext.mock.results.length - 1].value as any;

    expect(deps.drawingHandlers.isSelectingDirectionRef.current).toBe(true);
    expect(deps.drawingHandlers.ccShapePreviewCacheRef.current).toBeNull();
    expect(overlayCtx.clearRect).toHaveBeenCalledWith(
      0,
      0,
      deps.overlayCanvasRef.current!.width,
      deps.overlayCanvasRef.current!.height
    );
    expect(deps.drawingHandlers.stopContinuousColorCycleAnimation).toHaveBeenCalledWith('shape-preview');
    expect(deps.drawingHandlers.continueShapeDrawing).toHaveBeenCalledWith(
      { x: 0, y: 0 },
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      { renderPreview: false }
    );
    expect(deps.drawingHandlers.drawingCanvasHasContent.current).toBe(true);
    expect(deps.drawingHandlers.finalizeShapeDrawing).not.toHaveBeenCalled();
    expect(deps.stateMachine.finalizationComplete).toHaveBeenCalled();
    expect(setSequentialPointerDown).toHaveBeenCalledWith(false);
    expect(getStateSpy).toHaveBeenCalled();
  });

  it('previews linear CC Gradient direction on hover after shape mouse up', () => {
    const stateSnapshot = useAppStore.getState();
    jest
      .spyOn(useAppStore, 'getState')
      .mockReturnValue({
        ...stateSnapshot,
        tools: {
          ...stateSnapshot.tools,
          currentTool: 'brush',
          brushSettings: {
            ...stateSnapshot.tools.brushSettings,
            brushShape: BrushShape.COLOR_CYCLE_SHAPE,
          },
        },
      } as unknown as ReturnType<typeof useAppStore.getState>);

    const { deps } = createDeps({
      currentBrushPresetId: 'color-cycle-gradient',
      tools: {
        ...baseDynamic.tools,
        currentTool: 'brush',
        shapeMode: true,
        brushSettings: {
          ...baseDynamic.tools.brushSettings,
          brushShape: BrushShape.COLOR_CYCLE_SHAPE,
          colorCycleFillMode: 'linear',
          ccGradientDrawingShape: 'freehand',
          colors: 2,
        } as any,
      },
    });

    deps.interaction.state = { isDrawing: false, isSelecting: false, mode: 'idle' } as any;
    deps.drawingHandlers.isSelectingDirectionRef.current = true;
    deps.drawingHandlers.isDrawingShapeRef.current = true;
    deps.drawingHandlers.shapePointsRef.current = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
    ];
    deps.drawingHandlers.drawingCanvasHasContent.current = false;

    const handlers = createPointerHandlers(deps);
    handlers.handlePointerMove(makePointerEvent({
      clientX: 40,
      clientY: 10,
      buttons: 0,
      timeStamp: 123,
    }));

    expect(deps.drawingHandlers.continueShapeDrawing).toHaveBeenCalledWith(
      { x: 40, y: 10 },
      expect.any(Number),
      123,
      expect.any(Number),
      { renderPreview: false }
    );
    expect(deps.drawingHandlers.drawingCanvasHasContent.current).toBe(true);
    expect(deps.draw).toHaveBeenCalled();
  });

  it('previews Dither Gradient direction on hover after shape mouse up', () => {
    const { deps } = createDeps({
      tools: {
        ...baseDynamic.tools,
        currentTool: 'brush',
        shapeMode: false,
        brushSettings: {
          ...baseDynamic.tools.brushSettings,
          brushShape: BrushShape.DITHER_GRADIENT,
        } as any,
      },
    });

    deps.interaction.state = { isDrawing: false, isSelecting: false, mode: 'idle' } as any;
    deps.drawingHandlers.isSelectingDirectionRef.current = true;
    deps.drawingHandlers.isDrawingShapeRef.current = true;
    deps.drawingHandlers.shapePointsRef.current = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
    ];
    const handlers = createPointerHandlers(deps);
    handlers.handlePointerMove(makePointerEvent({
      clientX: 40,
      clientY: 10,
      buttons: 0,
      timeStamp: 123,
    }));

    expect(deps.drawingHandlers.continueShapeDrawing).toHaveBeenCalledWith(
      { x: 40, y: 10 },
      expect.any(Number),
      123,
      expect.any(Number),
      { renderPreview: false }
    );
    expect(deps.drawingHandlers.drawingCanvasHasContent.current).toBe(true);
  });

  it('commits Shift-snapped direction for linear CC Gradient direction selection', async () => {
    const { deps } = createDeps({
      currentBrushPresetId: 'color-cycle-gradient',
      tools: {
        ...baseDynamic.tools,
        currentTool: 'brush',
        shapeMode: true,
        brushSettings: {
          ...baseDynamic.tools.brushSettings,
          brushShape: BrushShape.COLOR_CYCLE_SHAPE,
          colorCycleFillMode: 'linear',
          ccGradientDrawingShape: 'freehand',
          colors: 2,
        } as any,
      },
    });

    deps.drawingHandlers.isSelectingDirectionRef.current = true;
    deps.drawingHandlers.shapePointsRef.current = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
    ];
    const finalizationDone = new Promise<void>((resolve) => {
      (deps.stateMachine.finalizationComplete as jest.Mock).mockImplementation(() => {
        resolve();
      });
    });

    const handlers = createPointerHandlers(deps);
    handlers.handlePointerDown(makePointerEvent({ clientX: 40, clientY: 10, shiftKey: true }));

    expect(deps.drawingHandlers.startShapeDrawing).toHaveBeenCalledTimes(1);
    const committedPoint = (deps.drawingHandlers.startShapeDrawing as jest.Mock).mock.calls[0][0];
    const rawPoint = { x: 40, y: 10 };
    const centroidY = (0 + 0 + 20) / 3;
    expect(committedPoint).not.toEqual(rawPoint);
    expect(committedPoint.x).toBeGreaterThan(39);
    expect(committedPoint.y).toBeCloseTo(centroidY, 5);
    expect(deps.drawingHandlers.finalizeShapeDrawing).toHaveBeenCalled();
    await finalizationDone;
    expect(deps.stateMachine.finalizationComplete).toHaveBeenCalled();
    expect(deps.setNeedsRedraw).toHaveBeenCalled();
    expect(deps.restartColorCycleAnimation).toHaveBeenCalled();
  });

  it('commits Dither Gradient direction without starting a new pressure sample', async () => {
    const { deps } = createDeps({
      tools: {
        ...baseDynamic.tools,
        currentTool: 'brush',
        shapeMode: false,
        brushSettings: {
          ...baseDynamic.tools.brushSettings,
          brushShape: BrushShape.DITHER_GRADIENT,
        } as any,
      },
    });

    deps.drawingHandlers.isSelectingDirectionRef.current = true;
    deps.drawingHandlers.shapePointsRef.current = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
    ];
    const finalizationDone = new Promise<void>((resolve) => {
      (deps.stateMachine.finalizationComplete as jest.Mock).mockImplementation(() => {
        resolve();
      });
    });

    const handlers = createPointerHandlers(deps);
    handlers.handlePointerDown(makePointerEvent({ clientX: 40, clientY: 10 }));

    expect(deps.drawingHandlers.startShapeDrawing).not.toHaveBeenCalled();
    expect(deps.drawingHandlers.directionPreviewRef.current).toEqual({ x: 40, y: 10 });
    expect(deps.drawingHandlers.finalizeShapeDrawing).toHaveBeenCalledTimes(1);
    await finalizationDone;
    expect(deps.stateMachine.finalizationComplete).toHaveBeenCalled();
  });

  it('keeps linear CC Gradient direction selection active for centroid clicks', () => {
    const { deps } = createDeps({
      currentBrushPresetId: 'color-cycle-gradient',
      tools: {
        ...baseDynamic.tools,
        currentTool: 'brush',
        shapeMode: true,
        brushSettings: {
          ...baseDynamic.tools.brushSettings,
          brushShape: BrushShape.COLOR_CYCLE_SHAPE,
          colorCycleFillMode: 'linear',
          ccGradientDrawingShape: 'freehand',
          colors: 2,
        } as any,
      },
    });

    deps.drawingHandlers.isSelectingDirectionRef.current = true;
    deps.drawingHandlers.shapePointsRef.current = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
    ];

    const centroid = { x: 40 / 3, y: 20 / 3 };
    const handlers = createPointerHandlers(deps);
    handlers.handlePointerDown(makePointerEvent({
      clientX: centroid.x,
      clientY: centroid.y,
      pressure: 0.5,
    } as any));

    expect(deps.drawingHandlers.startShapeDrawing).not.toHaveBeenCalled();
    expect(deps.drawingHandlers.finalizeShapeDrawing).not.toHaveBeenCalled();
    expect(deps.stateMachine.finalizationComplete).not.toHaveBeenCalled();
    expect(deps.drawingHandlers.isSelectingDirectionRef.current).toBe(true);
    expect(deps.drawingHandlers.continueShapeDrawing).toHaveBeenCalledWith(
      centroid,
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      { renderPreview: false }
    );
    expect(deps.drawingHandlers.drawingCanvasHasContent.current).toBe(true);
  });

  it('finalizes linear CC Gradient shapes directly when visible Colors is 1', async () => {
    const { deps } = createDeps({
      currentBrushPresetId: 'color-cycle-gradient',
      tools: {
        ...baseDynamic.tools,
        currentTool: 'brush',
        shapeMode: true,
        brushSettings: {
          ...baseDynamic.tools.brushSettings,
          brushShape: BrushShape.COLOR_CYCLE_SHAPE,
          colorCycleFillMode: 'linear',
          ccGradientDrawingShape: 'freehand',
          colors: 2,
          gradientBands: 1,
        } as any,
      },
    });

    deps.interaction.state = { isDrawing: true, isSelecting: false, mode: 'drawing' } as any;
    deps.drawingHandlers.isDrawingShapeRef.current = true;
    deps.drawingHandlers.shapePointsRef.current = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }];
    deps.drawingHandlers.isSelectingDirectionRef.current = false;

    const handlers = createPointerHandlers(deps);
    handlers.handlePointerUp(makePointerEvent({ clientX: 30, clientY: 30 }));

    await Promise.resolve();
    await Promise.resolve();

    expect(deps.drawingHandlers.isSelectingDirectionRef.current).toBe(false);
    expect(deps.drawingHandlers.finalizeShapeDrawing).toHaveBeenCalled();
    expect(deps.stateMachine.finalizationComplete).toHaveBeenCalled();
  });

  it.each(['rectangle', 'ellipse', 'line', 'triangle'] as const)(
    'enters direction selection for %s CC Gradient shapes when visible Colors is greater than 1',
    async (ccGradientDrawingShape) => {
      const { deps } = createDeps({
        currentBrushPresetId: 'color-cycle-gradient',
        tools: {
          ...baseDynamic.tools,
          currentTool: 'brush',
          shapeMode: true,
          brushSettings: {
            ...baseDynamic.tools.brushSettings,
            brushShape: BrushShape.COLOR_CYCLE_SHAPE,
            colorCycleFillMode: 'linear',
            ccGradientDrawingShape,
            colors: 1,
            gradientBands: 2,
          } as any,
        },
      });

      deps.interaction.state = { isDrawing: true, isSelecting: false, mode: 'drawing' } as any;
      deps.drawingHandlers.isDrawingShapeRef.current = true;
      deps.drawingHandlers.shapePointsRef.current = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }];
      deps.drawingHandlers.isSelectingDirectionRef.current = false;

      const handlers = createPointerHandlers(deps);
      handlers.handlePointerUp(makePointerEvent({ clientX: 30, clientY: 30 }));

      expect(deps.drawingHandlers.isSelectingDirectionRef.current).toBe(true);
      expect(deps.drawingHandlers.finalizeShapeDrawing).not.toHaveBeenCalled();
      expect(deps.stateMachine.finalizationComplete).toHaveBeenCalled();
    }
  );

  it('cancels pending CC Gradient direction selection on right click', () => {
    const setSequentialPointerDown = jest.fn();
    const stateSnapshot = useAppStore.getState();
    jest
      .spyOn(useAppStore, 'getState')
      .mockReturnValue({
        ...stateSnapshot,
        setSequentialPointerDown,
      } as unknown as ReturnType<typeof useAppStore.getState>);

    const { deps } = createDeps({
      currentBrushPresetId: 'color-cycle-gradient',
      activeLayerId: 'cc-layer',
      tools: {
        ...baseDynamic.tools,
        currentTool: 'brush',
        shapeMode: true,
        brushSettings: {
          ...baseDynamic.tools.brushSettings,
          brushShape: BrushShape.COLOR_CYCLE_SHAPE,
          colorCycleFillMode: 'linear',
          ccGradientDrawingShape: 'freehand',
          colors: 2,
        } as any,
      },
    });

    deps.drawingHandlers.isSelectingDirectionRef.current = true;
    deps.drawingHandlers.isDrawingShapeRef.current = true;
    deps.drawingHandlers.shapePointsRef.current = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }];
    deps.drawingHandlers.ccStrokeSamplesRef.current = [{ x: 0, y: 0, pressure: 0.5 }];
    deps.drawingHandlers.ccStrokeDirectionRef.current = { x: 1, y: 0 };
    deps.drawingHandlers.directionPreviewRef.current = { x: 20, y: 10 };
    deps.drawingHandlers.drawingCanvasHasContent.current = true;
    deps.drawingHandlers.ccGradientDrawingGeometryRef.current = {
      shapePoints: deps.drawingHandlers.shapePointsRef.current,
      sampleSourcePoints: [{ x: 0, y: 0 }, { x: 20, y: 20 }],
      direction: { x: 1, y: 0 },
      bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
    };

    const handlers = createPointerHandlers(deps);
    handlers.handlePointerDown(makePointerEvent({ clientX: 30, clientY: 30, button: 2 }));

    expect(deps.drawingHandlers.isSelectingDirectionRef.current).toBe(false);
    expect(deps.drawingHandlers.isDrawingShapeRef.current).toBe(false);
    expect(deps.drawingHandlers.shapePointsRef.current).toEqual([]);
    expect(deps.drawingHandlers.ccStrokeSamplesRef.current).toEqual([]);
    expect(deps.drawingHandlers.ccStrokeDirectionRef.current).toBeNull();
    expect(deps.drawingHandlers.directionPreviewRef.current).toBeNull();
    expect(deps.drawingHandlers.ccGradientDrawingGeometryRef.current).toBeNull();
    expect(deps.drawingHandlers.clearDrawingCanvas).toHaveBeenCalled();
    expect(deps.drawingHandlers.drawingCanvasHasContent.current).toBe(false);
    expect(deps.interaction.dispatch).toHaveBeenCalledWith({ type: 'DRAWING_END' });
    expect(setSequentialPointerDown).toHaveBeenCalledWith(false);
    expect(deps.setNeedsRedraw).toHaveBeenCalled();
    expect(deps.stateMachine.finalizationComplete).toHaveBeenCalled();
  });

  it('cancels pending Dither Gradient direction selection and resets its polygon', () => {
    const stateSnapshot = useAppStore.getState();
    jest
      .spyOn(useAppStore, 'getState')
      .mockReturnValue({
        ...stateSnapshot,
        polygonGradientState: {
          ...stateSnapshot.polygonGradientState,
          drawingState: 'drawing',
          points: [
            { x: 0, y: 0 },
            { x: 20, y: 0 },
            { x: 20, y: 20 },
          ],
        },
        tools: {
          ...stateSnapshot.tools,
          brushSettings: {
            ...stateSnapshot.tools.brushSettings,
            brushShape: BrushShape.DITHER_GRADIENT,
          },
        },
      } as unknown as ReturnType<typeof useAppStore.getState>);

    const { deps } = createDeps({
      tools: {
        ...baseDynamic.tools,
        currentTool: 'brush',
        shapeMode: false,
        brushSettings: {
          ...baseDynamic.tools.brushSettings,
          brushShape: BrushShape.DITHER_GRADIENT,
        } as any,
      },
    });

    deps.drawingHandlers.isSelectingDirectionRef.current = true;
    deps.drawingHandlers.isDrawingShapeRef.current = true;
    deps.drawingHandlers.shapePointsRef.current = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
    ];

    const handlers = createPointerHandlers(deps);
    handlers.handlePointerDown(makePointerEvent({ clientX: 30, clientY: 30, button: 2 }));

    expect(deps.toolStateMachine.resetPolygonGradient).toHaveBeenCalledTimes(1);
    expect(deps.drawingHandlers.isSelectingDirectionRef.current).toBe(false);
    expect(deps.drawingHandlers.shapePointsRef.current).toEqual([]);
    expect(deps.drawingHandlers.clearDrawingCanvas).toHaveBeenCalled();
    expect(deps.stateMachine.finalizationComplete).toHaveBeenCalled();
  });

  it('discards a pending gradient direction stage after switching brushes', () => {
    const stateSnapshot = useAppStore.getState();
    jest
      .spyOn(useAppStore, 'getState')
      .mockReturnValue({
        ...stateSnapshot,
        polygonGradientState: {
          ...stateSnapshot.polygonGradientState,
          drawingState: 'drawing',
          points: [
            { x: 0, y: 0 },
            { x: 20, y: 0 },
            { x: 20, y: 20 },
          ],
        },
      } as unknown as ReturnType<typeof useAppStore.getState>);

    const { deps } = createDeps({
      tools: {
        ...baseDynamic.tools,
        currentTool: 'brush',
        shapeMode: false,
        brushSettings: {
          ...baseDynamic.tools.brushSettings,
          brushShape: BrushShape.ROUND,
        } as any,
      },
    });

    deps.drawingHandlers.isSelectingDirectionRef.current = true;
    deps.drawingHandlers.isDrawingShapeRef.current = true;
    deps.drawingHandlers.shapePointsRef.current = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
    ];
    deps.stateMachine.state = { mode: 'DRAWING' } as any;
    deps.stateMachine.finalizationComplete = jest.fn(() => {
      deps.stateMachine.state = { mode: 'IDLE' } as any;
    });

    const handlers = createPointerHandlers(deps);
    handlers.handlePointerDown(makePointerEvent({ clientX: 30, clientY: 30 }));

    expect(deps.toolStateMachine.resetPolygonGradient).toHaveBeenCalledTimes(1);
    expect(deps.drawingHandlers.isSelectingDirectionRef.current).toBe(false);
    expect(deps.drawingHandlers.shapePointsRef.current).toEqual([]);
    expect(deps.drawingHandlers.finalizeShapeDrawing).not.toHaveBeenCalled();
    expect(deps.drawingHandlers.startDrawing).toHaveBeenCalled();
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

  it('does not angle-snap Shift pointer-up for drag-defined CC gradient shapes', async () => {
    const { deps } = createDeps({
      currentBrushPresetId: 'color-cycle-gradient',
      tools: {
        ...baseDynamic.tools,
        currentTool: 'brush',
        shapeMode: true,
        brushSettings: {
          ...baseDynamic.tools.brushSettings,
          brushShape: BrushShape.COLOR_CYCLE_SHAPE,
          colorCycleFillMode: 'linear',
          ccGradientDrawingShape: 'rectangle',
        } as any,
      },
    });

    deps.interaction.state = { isDrawing: true, isSelecting: false, mode: 'drawing' } as any;
    deps.getMousePos = jest.fn(() => ({ x: 20, y: 8 }));
    deps.drawingHandlers.isDrawingShapeRef.current = true;
    deps.drawingHandlers.shapePointsRef.current = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    deps.drawingHandlers.isSelectingDirectionRef.current = false;

    const handlers = createPointerHandlers(deps);
    handlers.handlePointerUp(makePointerEvent({ clientX: 20, clientY: 8, shiftKey: true, timeStamp: 123 }));

    await Promise.resolve();
    await Promise.resolve();

    expect(deps.drawingHandlers.continueShapeDrawing).toHaveBeenCalledWith(
      expect.objectContaining({ x: 20, y: 8 }),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      { constrainAspect: true }
    );
  });

  it('keeps CC gradient polygon drawing open until an explicit completion gesture', async () => {
    const { deps } = createDeps({
      currentBrushPresetId: 'color-cycle-gradient',
      tools: {
        ...baseDynamic.tools,
        currentTool: 'brush',
        shapeMode: true,
        brushSettings: {
          ...baseDynamic.tools.brushSettings,
          brushShape: BrushShape.COLOR_CYCLE_SHAPE,
          colorCycleFillMode: 'linear',
          ccGradientDrawingShape: 'polygon',
        } as any,
      },
    });

    deps.interaction.state = { isDrawing: true, isSelecting: false, mode: 'drawing' } as any;
    deps.getMousePos = jest.fn(() => ({ x: 30, y: 30 }));
    deps.drawingHandlers.isDrawingShapeRef.current = true;
    deps.drawingHandlers.shapePointsRef.current = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }];

    const handlers = createPointerHandlers(deps);
    handlers.handlePointerUp(makePointerEvent({ clientX: 30, clientY: 30, detail: 1 }));

    await Promise.resolve();
    expect(deps.drawingHandlers.finalizeShapeDrawing).not.toHaveBeenCalled();
    expect(deps.stateMachine.finalizationComplete).not.toHaveBeenCalled();
  });

  it.each([
    ['color-cycle-gradient', 1],
    ['color-cycle-flat-dither', 1],
    ['color-cycle-flat-dither', 2],
    ['color-cycle-flat-dither', 0.25],
  ] as const)('keeps %s polygon open after a distant click with hidden size 500 (zoom %s)', async (preset, zoom) => {
    const { deps } = createDeps({
      currentBrushPresetId: preset,
      canvas: { width: 100, height: 100, scale: 1, zoom },
      tools: {
        ...baseDynamic.tools,
        currentTool: 'brush',
        shapeMode: true,
        brushSettings: {
          ...baseDynamic.tools.brushSettings,
          brushShape: BrushShape.COLOR_CYCLE_SHAPE,
          colorCycleFillMode: 'linear',
          ccGradientDrawingShape: 'polygon',
          size: 500,
        },
      },
    });
    deps.interaction.state = { ...deps.interaction.state, isDrawing: true, isSelecting: false };
    deps.getMousePos = jest.fn(() => ({ x: 30, y: 30 }));
    deps.drawingHandlers.isDrawingShapeRef.current = true;
    deps.drawingHandlers.isSelectingDirectionRef.current = false;
    const points = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 30, y: 30 }];
    deps.drawingHandlers.shapePointsRef.current = points;

    createPointerHandlers(deps).handlePointerUp(makePointerEvent({ clientX: 30, clientY: 30, detail: 1 }));
    await Promise.resolve();
    expect(deps.drawingHandlers.finalizeShapeDrawing).not.toHaveBeenCalled();
    expect(deps.drawingHandlers.isSelectingDirectionRef.current).toBe(false);
    expect(deps.drawingHandlers.shapePointsRef.current).toEqual(points);
  });

  it('keeps CC gradient click-line open after ordinary third and fourth committed points', async () => {
    const ccLayer = { id: 'cc-layer', layerType: 'color-cycle' } as any;
    const brushSettings = {
      ...baseDynamic.tools.brushSettings,
      brushShape: BrushShape.COLOR_CYCLE_SHAPE,
      colorCycleFillMode: 'linear',
      ccGradientDrawingShape: 'click-line',
      size: 10,
      pressureEnabled: false,
    } as any;
    useAppStore.setState((state) => ({
      ...state,
      currentBrushPreset: { id: 'color-cycle-gradient', name: 'CC Gradient' } as any,
      activeLayerId: 'cc-layer',
      layers: [ccLayer],
      tools: {
        ...state.tools,
        currentTool: 'brush',
        shapeMode: true,
        brushSettings,
      },
    }));
    const { deps } = createDeps({
      currentBrushPresetId: 'color-cycle-gradient',
      activeLayerId: 'cc-layer',
      layers: [ccLayer],
      tools: {
        ...baseDynamic.tools,
        currentTool: 'brush',
        shapeMode: true,
        brushSettings,
      },
    });

    const handlers = createPointerHandlers(deps);
    handlers.handlePointerDown(makePointerEvent({ clientX: 10, clientY: 10, detail: 1 }));
    handlers.handlePointerUp(makePointerEvent({ clientX: 10, clientY: 10, detail: 1 }));
    (deps.drawingHandlers.triggerSimpleShapePreview as jest.Mock).mockClear();
    handlers.handlePointerMove(makePointerEvent({ clientX: 20, clientY: 20, buttons: 0 } as any));
    expect(deps.drawingHandlers.triggerSimpleShapePreview).toHaveBeenCalledTimes(1);
    expect(deps.drawingHandlers.shapePointsRef.current).toEqual([
      { x: 10, y: 10 },
      { x: 20, y: 20 },
    ]);
    handlers.handlePointerDown(makePointerEvent({ clientX: 30, clientY: 10, detail: 1 }));
    (deps.drawingHandlers.triggerSimpleShapePreview as jest.Mock).mockClear();
    handlers.handlePointerUp(makePointerEvent({ clientX: 30, clientY: 10, detail: 1 }));
    expect(deps.drawingHandlers.triggerSimpleShapePreview).toHaveBeenCalledTimes(1);
    (deps.restartColorCycleAnimation as jest.Mock).mockClear();
    handlers.handlePointerMove(makePointerEvent({ clientX: 30, clientY: 30, buttons: 0 } as any));
    handlers.handlePointerDown(makePointerEvent({ clientX: 30, clientY: 30, detail: 1 }));
    handlers.handlePointerUp(makePointerEvent({ clientX: 30, clientY: 30, detail: 1 }));
    handlers.handlePointerDown(makePointerEvent({ clientX: 10, clientY: 30, detail: 1 }));
    handlers.handlePointerUp(makePointerEvent({ clientX: 10, clientY: 30, detail: 1 }));

    await Promise.resolve();
    expect(deps.drawingHandlers.ccGradientClickLineSessionRef.current.active).toBe(true);
    expect(deps.drawingHandlers.ccGradientClickLineSessionRef.current.points).toEqual([
      { x: 10, y: 10 },
      { x: 30, y: 10 },
      { x: 30, y: 30 },
      { x: 10, y: 30 },
    ]);
    expect(deps.drawingHandlers.shapePointsRef.current).toEqual([
      { x: 10, y: 10 },
      { x: 30, y: 10 },
      { x: 30, y: 30 },
      { x: 10, y: 30 },
    ]);
    expect(deps.drawingHandlers.finalizeShapeDrawing).not.toHaveBeenCalled();
    expect(deps.drawingHandlers.triggerSimpleShapePreview).toHaveBeenCalled();
    expect(deps.restartColorCycleAnimation).not.toHaveBeenCalled();
  });

  it('snaps CC gradient click-line preview segments to 45 degree increments while Shift is held', async () => {
    const ccLayer = { id: 'cc-layer', layerType: 'color-cycle' } as any;
    const brushSettings = {
      ...baseDynamic.tools.brushSettings,
      brushShape: BrushShape.COLOR_CYCLE_SHAPE,
      colorCycleFillMode: 'linear',
      ccGradientDrawingShape: 'click-line',
      size: 10,
      pressureEnabled: false,
    } as any;
    useAppStore.setState((state) => ({
      ...state,
      currentBrushPreset: { id: 'color-cycle-gradient', name: 'CC Gradient' } as any,
      activeLayerId: 'cc-layer',
      layers: [ccLayer],
      tools: {
        ...state.tools,
        currentTool: 'brush',
        shapeMode: true,
        brushSettings,
      },
    }));
    const { deps } = createDeps({
      currentBrushPresetId: 'color-cycle-gradient',
      activeLayerId: 'cc-layer',
      layers: [ccLayer],
      tools: {
        ...baseDynamic.tools,
        currentTool: 'brush',
        shapeMode: true,
        brushSettings,
      },
    });

    const handlers = createPointerHandlers(deps);
    handlers.handlePointerDown(makePointerEvent({ clientX: 10, clientY: 10, detail: 1 }));
    handlers.handlePointerUp(makePointerEvent({ clientX: 10, clientY: 10, detail: 1 }));
    handlers.handlePointerDown(makePointerEvent({ clientX: 30, clientY: 10, detail: 1 }));
    handlers.handlePointerUp(makePointerEvent({ clientX: 30, clientY: 10, detail: 1 }));
    handlers.handlePointerMove(makePointerEvent({ clientX: 50, clientY: 20, buttons: 0, shiftKey: true } as any));

    await Promise.resolve();
    const snappedPreviewPoint = deps.drawingHandlers.shapePointsRef.current[2];
    const segmentLength = Math.hypot(20, 10);
    const snappedDelta = Math.cos(Math.PI / 4) * segmentLength;
    expect(snappedPreviewPoint.x).toBeCloseTo(30 + snappedDelta, 6);
    expect(snappedPreviewPoint.y).toBeCloseTo(10 + snappedDelta, 6);
    expect(deps.drawingHandlers.triggerSimpleShapePreview).toHaveBeenCalled();
  });

  it('does not intercept CC gradient click-line when shape mode is disabled', async () => {
    const ccLayer = { id: 'cc-layer', layerType: 'color-cycle' } as any;
    const brushSettings = {
      ...baseDynamic.tools.brushSettings,
      brushShape: BrushShape.COLOR_CYCLE_SHAPE,
      colorCycleFillMode: 'linear',
      ccGradientDrawingShape: 'click-line',
      size: 10,
      pressureEnabled: false,
    } as any;
    useAppStore.setState((state) => ({
      ...state,
      currentBrushPreset: { id: 'color-cycle-gradient', name: 'CC Gradient' } as any,
      activeLayerId: 'cc-layer',
      layers: [ccLayer],
      tools: {
        ...state.tools,
        currentTool: 'brush',
        shapeMode: false,
        brushSettings,
      },
    }));
    const { deps } = createDeps({
      currentBrushPresetId: 'color-cycle-gradient',
      activeLayerId: 'cc-layer',
      layers: [ccLayer],
      tools: {
        ...baseDynamic.tools,
        currentTool: 'brush',
        shapeMode: false,
        brushSettings,
      },
    });

    const handlers = createPointerHandlers(deps);
    handlers.handlePointerDown(makePointerEvent({ clientX: 10, clientY: 10, detail: 1 }));

    await Promise.resolve();
    expect(deps.drawingHandlers.ccGradientClickLineSessionRef.current.active).toBe(false);
    expect(deps.drawingHandlers.shapePointsRef.current).toEqual([]);
  });

  it('blocks CC gradient click-line on raster layers with feedback', async () => {
    const feedback = jest.fn();
    const rasterLayer = { id: 'raster-layer', layerType: 'raster' } as any;
    const brushSettings = {
      ...baseDynamic.tools.brushSettings,
      brushShape: BrushShape.COLOR_CYCLE_SHAPE,
      colorCycleFillMode: 'linear',
      ccGradientDrawingShape: 'click-line',
      size: 10,
      pressureEnabled: false,
    } as any;
    useAppStore.setState((state) => ({
      ...state,
      currentBrushPreset: { id: 'color-cycle-gradient', name: 'CC Gradient' } as any,
      activeLayerId: 'raster-layer',
      layers: [rasterLayer],
      tools: {
        ...state.tools,
        currentTool: 'brush',
        shapeMode: true,
        brushSettings,
      },
    }));
    const { deps } = createDeps({
      currentBrushPresetId: 'color-cycle-gradient',
      activeLayerId: 'raster-layer',
      layers: [rasterLayer],
      tools: {
        ...baseDynamic.tools,
        currentTool: 'brush',
        shapeMode: true,
        brushSettings,
      },
    }, {
      feedback,
    });

    const handlers = createPointerHandlers(deps);
    handlers.handlePointerDown(makePointerEvent({ clientX: 10, clientY: 10, detail: 1 }));

    await Promise.resolve();
    expect(feedback).toHaveBeenCalledWith("Can't use Color Cycle shape on a normal layer. Create/select a Color Cycle layer.");
    expect(deps.drawingHandlers.ccGradientClickLineSessionRef.current.active).toBe(false);
    expect(deps.drawingHandlers.shapePointsRef.current).toEqual([]);
    expect(deps.drawingHandlers.finalizeShapeDrawing).not.toHaveBeenCalled();
  });

  it('restarts color-cycle animation after invalid early click-line double click', async () => {
    const ccLayer = { id: 'cc-layer', layerType: 'color-cycle' } as any;
    const brushSettings = {
      ...baseDynamic.tools.brushSettings,
      brushShape: BrushShape.COLOR_CYCLE_SHAPE,
      colorCycleFillMode: 'linear',
      ccGradientDrawingShape: 'click-line',
      size: 10,
      pressureEnabled: false,
    } as any;
    useAppStore.setState((state) => ({
      ...state,
      currentBrushPreset: { id: 'color-cycle-gradient', name: 'CC Gradient' } as any,
      activeLayerId: 'cc-layer',
      layers: [ccLayer],
      tools: {
        ...state.tools,
        currentTool: 'brush',
        shapeMode: true,
        brushSettings,
      },
    }));
    const { deps } = createDeps({
      currentBrushPresetId: 'color-cycle-gradient',
      activeLayerId: 'cc-layer',
      layers: [ccLayer],
      tools: {
        ...baseDynamic.tools,
        currentTool: 'brush',
        shapeMode: true,
        brushSettings,
      },
    });

    const handlers = createPointerHandlers(deps);
    handlers.handlePointerDown(makePointerEvent({ clientX: 10, clientY: 10, detail: 1 }));
    handlers.handlePointerUp(makePointerEvent({ clientX: 10, clientY: 10, detail: 1 }));
    handlers.handlePointerDown(makePointerEvent({ clientX: 30, clientY: 10, detail: 1 }));
    handlers.handlePointerUp(makePointerEvent({ clientX: 30, clientY: 10, detail: 1 }));
    (deps.restartColorCycleAnimation as jest.Mock).mockClear();
    handlers.handlePointerDown(makePointerEvent({ clientX: 30, clientY: 10, detail: 0 }));
    handlers.handlePointerUp(makePointerEvent({ clientX: 30, clientY: 10, detail: 0 }));
    handlers.handleDoubleClick(makeMouseEvent({ clientX: 30, clientY: 10 }));

    await Promise.resolve();
    expect(deps.drawingHandlers.finalizeShapeDrawing).not.toHaveBeenCalled();
    expect(deps.drawingHandlers.ccGradientClickLineSessionRef.current.active).toBe(true);
    expect(deps.drawingHandlers.ccGradientClickLineSessionRef.current.points).toEqual([
      { x: 10, y: 10 },
      { x: 30, y: 10 },
    ]);
    expect(deps.restartColorCycleAnimation).toHaveBeenCalled();
  });

  it('enters direction selection for CC gradient click-line on double click when visible Colors is greater than 1', async () => {
    const ccLayer = { id: 'cc-layer', layerType: 'color-cycle' } as any;
    const brushSettings = {
      ...baseDynamic.tools.brushSettings,
      brushShape: BrushShape.COLOR_CYCLE_SHAPE,
      colorCycleFillMode: 'linear',
      ccGradientDrawingShape: 'click-line',
      gradientBands: 2,
      size: 10,
      pressureEnabled: false,
    } as any;
    useAppStore.setState((state) => ({
      ...state,
      currentBrushPreset: { id: 'color-cycle-gradient', name: 'CC Gradient' } as any,
      activeLayerId: 'cc-layer',
      layers: [ccLayer],
      tools: {
        ...state.tools,
        currentTool: 'brush',
        shapeMode: true,
        brushSettings,
      },
    }));
    const { deps } = createDeps({
      currentBrushPresetId: 'color-cycle-gradient',
      activeLayerId: 'cc-layer',
      layers: [ccLayer],
      tools: {
        ...baseDynamic.tools,
        currentTool: 'brush',
        shapeMode: true,
        brushSettings,
      },
    });

    const handlers = createPointerHandlers(deps);
    handlers.handlePointerDown(makePointerEvent({ clientX: 10, clientY: 10, detail: 1 }));
    handlers.handlePointerUp(makePointerEvent({ clientX: 10, clientY: 10, detail: 1 }));
    handlers.handlePointerDown(makePointerEvent({ clientX: 30, clientY: 10, detail: 1 }));
    handlers.handlePointerUp(makePointerEvent({ clientX: 30, clientY: 10, detail: 1 }));
    handlers.handlePointerDown(makePointerEvent({ clientX: 30, clientY: 30, detail: 0 }));
    handlers.handlePointerUp(makePointerEvent({ clientX: 30, clientY: 30, detail: 0 }));
    handlers.handlePointerDown(makePointerEvent({ clientX: 30, clientY: 30, detail: 0 }));
    handlers.handlePointerUp(makePointerEvent({ clientX: 30, clientY: 30, detail: 0 }));
    handlers.handleDoubleClick(makeMouseEvent({ clientX: 30, clientY: 30 }));

    await Promise.resolve();
    await Promise.resolve();
    expect(deps.drawingHandlers.startShapeDrawing).toHaveBeenCalledTimes(1);
    expect(deps.drawingHandlers.startShapeDrawing).toHaveBeenCalledWith(
      { x: 10, y: 10 },
      expect.any(Number),
      expect.any(Number),
      undefined,
      { renderPreview: false },
    );
    expect(deps.drawingHandlers.isSelectingDirectionRef.current).toBe(true);
    expect(deps.drawingHandlers.finalizeShapeDrawing).not.toHaveBeenCalled();
    expect(deps.drawingHandlers.continueShapeDrawing).toHaveBeenCalledWith(
      expect.objectContaining({ x: 30, y: 30 }),
      expect.any(Number),
      expect.any(Number),
      0,
      { renderPreview: false }
    );
    expect(deps.stateMachine.finalizationComplete).toHaveBeenCalled();
    expect(deps.drawingHandlers.ccGradientClickLineSessionRef.current.active).toBe(false);
  });

  it('finalizes CC gradient click-line from dblclick when pointer event detail stays zero', async () => {
    const ccLayer = { id: 'cc-layer', layerType: 'color-cycle' } as any;
    const brushSettings = {
      ...baseDynamic.tools.brushSettings,
      brushShape: BrushShape.COLOR_CYCLE_SHAPE,
      colorCycleFillMode: 'linear',
      ccGradientDrawingShape: 'click-line',
      gradientBands: 1,
      size: 10,
      pressureEnabled: false,
    } as any;
    useAppStore.setState((state) => ({
      ...state,
      currentBrushPreset: { id: 'color-cycle-gradient', name: 'CC Gradient' } as any,
      activeLayerId: 'cc-layer',
      layers: [ccLayer],
      tools: {
        ...state.tools,
        currentTool: 'brush',
        shapeMode: true,
        brushSettings,
      },
    }));
    const { deps } = createDeps({
      currentBrushPresetId: 'color-cycle-gradient',
      activeLayerId: 'cc-layer',
      layers: [ccLayer],
      tools: {
        ...baseDynamic.tools,
        currentTool: 'brush',
        shapeMode: true,
        brushSettings,
      },
    });

    const handlers = createPointerHandlers(deps);
    handlers.handlePointerDown(makePointerEvent({ clientX: 10, clientY: 10, detail: 1 }));
    handlers.handlePointerUp(makePointerEvent({ clientX: 10, clientY: 10, detail: 1 }));
    handlers.handlePointerDown(makePointerEvent({ clientX: 30, clientY: 10, detail: 1 }));
    handlers.handlePointerUp(makePointerEvent({ clientX: 30, clientY: 10, detail: 1 }));
    handlers.handlePointerDown(makePointerEvent({ clientX: 30, clientY: 30, detail: 0 }));
    handlers.handlePointerUp(makePointerEvent({ clientX: 30, clientY: 30, detail: 0 }));
    handlers.handlePointerDown(makePointerEvent({ clientX: 30, clientY: 30, detail: 0 }));
    handlers.handlePointerUp(makePointerEvent({ clientX: 30, clientY: 30, detail: 0 }));
    handlers.handleDoubleClick(makeMouseEvent({ clientX: 30, clientY: 30 }));

    await Promise.resolve();
    await Promise.resolve();
    expect(deps.drawingHandlers.finalizeShapeDrawing).toHaveBeenCalled();
    expect(deps.drawingHandlers.ccGradientClickLineSessionRef.current.active).toBe(false);
  });

  it.each([
    ['color-cycle-gradient', 'linear', 2, true],
    ['color-cycle-gradient', 'linear', 1, false],
    ['color-cycle-gradient', 'concentric', 2, false],
    ['color-cycle-gradient', 'stroke', 2, false],
    ['color-cycle-flat-dither', 'linear', 2, true],
    ['color-cycle-flat-dither', 'linear', 1, false],
    ['color-cycle-flat-dither', 'concentric', 2, false],
    ['color-cycle-flat-dither', 'stroke', 2, false],
  ] as const)(
    'completes %s Poly %s (Colors %s) from native dblclick after pointer-up detail stays zero',
    async (preset, fillMode, gradientBands, expectsDirection) => {
      const { deps } = createDeps({
        currentBrushPresetId: preset,
        tools: {
          ...baseDynamic.tools,
          currentTool: 'brush',
          shapeMode: true,
          brushSettings: {
            ...baseDynamic.tools.brushSettings,
            brushShape: BrushShape.COLOR_CYCLE_SHAPE,
            colorCycleFillMode: fillMode,
            ccGradientDrawingShape: 'polygon',
            gradientBands,
          } as any,
        },
      });
      deps.interaction.state = { isDrawing: true, isSelecting: false, mode: 'drawing' } as any;
      deps.getMousePos = jest.fn(() => ({ x: 10, y: 30 }));
      deps.drawingHandlers.isDrawingShapeRef.current = true;
      deps.drawingHandlers.shapePointsRef.current = [
        { x: 10, y: 10 }, { x: 30, y: 10 }, { x: 30, y: 30 },
      ];
      deps.drawingHandlers.continueShapeDrawing = jest.fn((point) => {
        if (!deps.drawingHandlers.isSelectingDirectionRef.current) {
          deps.drawingHandlers.shapePointsRef.current.push({ ...point });
        }
      });
      deps.drawingHandlers.finalizeShapeDrawing = jest.fn(async () => {
        deps.drawingHandlers.isDrawingShapeRef.current = false;
      });
      const handlers = createPointerHandlers(deps);
      // Native pointer-up has detail zero for both presses in a double click.
      handlers.handlePointerUp(makePointerEvent({ clientX: 10, clientY: 30, detail: 0 }));
      handlers.handlePointerUp(makePointerEvent({ clientX: 10, clientY: 30, detail: 0 }));
      expect(deps.drawingHandlers.finalizeShapeDrawing).not.toHaveBeenCalled();
      expect(deps.drawingHandlers.isSelectingDirectionRef.current).toBe(false);
      const event = makeMouseEvent({ clientX: 10, clientY: 30, detail: 2 });
      handlers.handleDoubleClick(event);
      await Promise.resolve();
      await Promise.resolve();
      expect(deps.drawingHandlers.shapePointsRef.current).toEqual([
        { x: 10, y: 10 }, { x: 30, y: 10 }, { x: 30, y: 30 }, { x: 10, y: 30 },
      ]);
      expect(deps.drawingHandlers.isSelectingDirectionRef.current).toBe(expectsDirection);
      expect(deps.drawingHandlers.finalizeShapeDrawing).toHaveBeenCalledTimes(expectsDirection ? 0 : 1);
      expect(deps.stateMachine.finalizationComplete).toHaveBeenCalled();
      expect(event.preventDefault).toHaveBeenCalled();
      expect(event.stopPropagation).toHaveBeenCalled();
    },
  );

  it.each([
    ['color-cycle-gradient', { x: 60, y: 60 }],
    ['color-cycle-gradient', { x: 65, y: 60 }],
    ['color-cycle-flat-dither', { x: 60, y: 60 }],
    ['color-cycle-flat-dither', { x: 65, y: 60 }],
  ] as const)('snaps %s Shift-close initial guide around the retained polygon centroid at %j', (preset, closePoint) => {
    const { deps } = createDeps({
      currentBrushPresetId: preset,
      project: { ...mockProject, width: 256, height: 256 },
      tools: {
        ...baseDynamic.tools,
        currentTool: 'brush',
        shapeMode: true,
        brushSettings: {
          ...baseDynamic.tools.brushSettings,
          brushShape: BrushShape.COLOR_CYCLE_SHAPE,
          colorCycleFillMode: 'linear',
          ccGradientDrawingShape: 'polygon',
          gradientBands: 2,
        },
      },
    });
    const retainedPoints = [
      { x: 60, y: 60 }, { x: 180, y: 60 }, { x: 180, y: 100 }, { x: 60, y: 100 },
    ];
    deps.interaction.state = { isDrawing: true, isSelecting: false, mode: 'drawing' } as any;
    deps.getMousePos = jest.fn(() => ({ ...closePoint }));
    deps.drawingHandlers.isDrawingShapeRef.current = true;
    deps.drawingHandlers.shapePointsRef.current = retainedPoints.map(point => ({ ...point }));
    const continueShapeDrawing = jest.fn((point: { x: number; y: number }) => {
      if (!deps.drawingHandlers.isSelectingDirectionRef.current) {
        deps.drawingHandlers.shapePointsRef.current.push({ ...point });
      }
    });
    deps.drawingHandlers.continueShapeDrawing = continueShapeDrawing;

    createPointerHandlers(deps).handlePointerUp(makePointerEvent({
      clientX: closePoint.x, clientY: closePoint.y, shiftKey: true, detail: 0,
    }));

    expect(deps.drawingHandlers.shapePointsRef.current).toEqual(retainedPoints);
    expect(deps.drawingHandlers.isSelectingDirectionRef.current).toBe(true);
    expect(deps.drawingHandlers.finalizeShapeDrawing).not.toHaveBeenCalled();
    const guide = continueShapeDrawing.mock.calls.at(-1)![0];
    // Both closing positions snap left around the retained four-corner centre.
    const expectedLength = Math.hypot(closePoint.x - 120, closePoint.y - 80);
    expect(guide.x).toBeCloseTo(120 - expectedLength, 9);
    expect(guide.y).toBeCloseTo(80, 9);
  });

  it('drops the near-start close click before finalizing a CC gradient polygon', async () => {
    const { deps } = createDeps({
      currentBrushPresetId: 'color-cycle-gradient',
      tools: {
        ...baseDynamic.tools,
        currentTool: 'brush',
        shapeMode: true,
        brushSettings: {
          ...baseDynamic.tools.brushSettings,
          brushShape: BrushShape.COLOR_CYCLE_SHAPE,
          colorCycleFillMode: 'linear',
          ccGradientDrawingShape: 'polygon',
          size: 10,
        } as any,
      },
    });

    deps.interaction.state = { isDrawing: true, isSelecting: false, mode: 'drawing' } as any;
    deps.getMousePos = jest.fn(() => ({ x: 3, y: 4 }));
    deps.drawingHandlers.isDrawingShapeRef.current = true;
    deps.drawingHandlers.shapePointsRef.current = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }];
    deps.drawingHandlers.continueShapeDrawing = jest.fn((point) => {
      deps.drawingHandlers.shapePointsRef.current = [
        ...deps.drawingHandlers.shapePointsRef.current,
        { x: point.x, y: point.y },
      ];
    });

    const handlers = createPointerHandlers(deps);
    handlers.handlePointerUp(makePointerEvent({ clientX: 3, clientY: 4, detail: 1 }));

    await Promise.resolve();
    await Promise.resolve();

    expect(deps.drawingHandlers.finalizeShapeDrawing).toHaveBeenCalled();
    expect(deps.drawingHandlers.shapePointsRef.current).toEqual([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
    ]);
  });

  it('does not derive hidden dither variation from raw shape geometry', () => {
    const rawPoints = Array.from({ length: 501 }, (_, index) => ({
      x: 20 + Math.cos(index / 11) * 12 + index * 0.03,
      y: 20 + Math.sin(index / 13) * 12,
    }));
    const applyStrokeDither = jest.fn();
    const { deps, dynamicDepsRef } = createDeps(
      {
        currentBrushPresetId: 'dither-shape',
        tools: {
          ...baseDynamic.tools,
          currentTool: 'brush',
          shapeMode: true,
          brushSettings: {
            ...baseDynamic.tools.brushSettings,
            brushShape: BrushShape.PIXEL_DITHER,
            color: '#b34a22',
            ditherEnabled: true,
            ditherBackgroundFill: true,
            fillResolution: 4,
            ditherPatternDiversity: 100,
          } as any,
        },
      },
      {
        brushRuntime: {
          applyStrokeDither,
        } as any,
      }
    );
    deps.drawingHandlers.shapePointsRef.current = rawPoints;
    dynamicDepsRef.current.currentBrushPresetId = 'dither-shape';

    createPointerHandlers(deps);
    const renderer = (deps.drawingHandlers.setSimpleShapePreviewRenderer as jest.Mock).mock.calls[0]?.[0];
    expect(typeof renderer).toBe('function');

    renderer();

    expect(applyStrokeDither).toHaveBeenCalled();
    const options = applyStrokeDither.mock.calls[0]?.[3];
    expect(options).not.toHaveProperty('regularDitherVariety');
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
        builtFromVersion: null,
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

it.each([
  ['normal', false],
  ['color-cycle', false],
  ['sequential', false],
  ['normal', true],
  ['color-cycle', true],
  ['sequential', true],
] as const)('finalizes a cancelled %s eraser with inherited shape mode %s before clearing its overlay', async (layerType, shapeMode) => {
  const overlay = createCanvas();
  const overlayCtx = overlay.getContext('2d')!;
  overlay.getContext = jest.fn(() => overlayCtx) as unknown as typeof overlay.getContext;
  const layer = { id: 'interrupted-layer', layerType } as EventHandlerDynamicDeps['layers'][number];
  const { deps, dynamicDepsRef } = createDeps({
    layers: [layer],
    activeLayerId: layer.id,
  }, { overlayCanvasRef: { current: overlay } });
  const tools = { ...dynamicDepsRef.current.tools, currentTool: 'eraser' as const, shapeMode };
  dynamicDepsRef.current.tools = tools;
  deps.tools = tools;
  deps.interaction.state.isDrawing = true;
  (deps.interaction.dispatch as jest.Mock).mockImplementation((action) => {
    if (action.type === 'DRAWING_END') deps.interaction.state.isDrawing = false;
  });
  let finish!: () => void;
  (deps.drawingHandlers.finalizeDrawing as jest.Mock).mockImplementation(() => {
    deps.isBusyRef.current = true;
    return new Promise<void>((resolve) => { finish = resolve; });
  });
  const handlers = createPointerHandlers(deps);
  const event = makePointerEvent({ clientX: 10, clientY: 10 });

  handlers.handlePointerCancel(event);

  expect(deps.drawingHandlers.finalizeDrawing).toHaveBeenCalledTimes(1);
  expect(deps.drawingHandlers.finalizeDrawing).toHaveBeenCalledWith(false);
  expect(deps.drawingHandlers.clearStrokeSession).not.toHaveBeenCalled();
  expect(deps.interaction.dispatch).toHaveBeenCalledWith({ type: 'DRAWING_END' });
  expect(deps.compositeCanvasDirtyRef.current).toBe(true);
  expect(overlayCtx.clearRect).not.toHaveBeenCalled();
  expect(deps.stateMachine.finalizationComplete).not.toHaveBeenCalled();

  // A repeated cancellation must not destroy pixels/session needed by the pending capture.
  handlers.handlePointerCancel(event);
  expect(deps.drawingHandlers.finalizeDrawing).toHaveBeenCalledTimes(1);
  expect(deps.drawingHandlers.clearStrokeSession).not.toHaveBeenCalled();
  expect(overlayCtx.clearRect).not.toHaveBeenCalled();

  finish();
  await Promise.resolve();
  deps.isBusyRef.current = false;
  expect(deps.stateMachine.finalizationComplete).toHaveBeenCalledTimes(1);
  handlers.handlePointerUp(event);
  handlers.handlePointerCancel(event);
  expect(deps.drawingHandlers.finalizeDrawing).toHaveBeenCalledTimes(1);
});

it('finalizes a cancelled CC stroke before clearing its session so playback cleanup runs', async () => {
  const { deps, dynamicDepsRef } = createDeps();
  const tools = { ...dynamicDepsRef.current.tools, currentTool: 'brush' as const, shapeMode: false,
    brushSettings: { ...dynamicDepsRef.current.tools.brushSettings, brushShape: BrushShape.COLOR_CYCLE } };
  dynamicDepsRef.current.tools = tools;
  deps.tools = tools;
  deps.interaction.state.isDrawing = true;
  let finish!: () => void;
  (deps.drawingHandlers.finalizeDrawing as jest.Mock).mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  const handlers = createPointerHandlers(deps);
  handlers.handlePointerCancel(makePointerEvent({ clientX: 10, clientY: 10 }));
  expect(deps.drawingHandlers.finalizeDrawing).toHaveBeenCalledWith(false);
  expect(deps.drawingHandlers.clearStrokeSession).not.toHaveBeenCalled();
  expect(deps.interaction.dispatch).toHaveBeenCalledWith({ type: 'DRAWING_END' });
  expect(deps.stateMachine.finalizationComplete).not.toHaveBeenCalled();
  finish();
  await Promise.resolve();
  expect(deps.stateMachine.finalizationComplete).toHaveBeenCalledTimes(1);
});

it.each(['complete', 'cancel'] as const)('forwards live marquee Shift and preserves the baseline through %s', async (outcome) => {
  const previousRaf = global.requestAnimationFrame;
  const callbacks: FrameRequestCallback[] = [];
  global.requestAnimationFrame = (callback) => { callbacks.push(callback); return callbacks.length; };
  historyManager.clear();
  useAppStore.getState().clearSelection();
  useAppStore.setState({ activeLayerId: null, layers: [], project: mockProject, floatingPaste: null });
  useAppStore.getState().setSelectionBounds({ x: 20, y: 20 }, { x: 30, y: 30 }, 'selection-marquee-final');
  const { deps, dynamicDepsRef } = createDeps({
    tools: { ...baseDynamic.tools, currentTool: 'selection' },
    selectionStart: useAppStore.getState().selectionStart,
    selectionEnd: useAppStore.getState().selectionEnd,
  }, {
    setSelectionBounds: (start, end, source) => useAppStore.getState().setSelectionBounds(start, end, source),
    clearSelection: () => useAppStore.getState().clearSelection(),
    getMousePos: (event) => ({ x: event.clientX, y: event.clientY }),
  });
  deps.interaction.dispatch = (action) => { deps.interaction.state.isSelecting = action.type === 'SELECTION_START'; };
  const unsubscribe = useAppStore.subscribe((state) => {
    dynamicDepsRef.current = { ...dynamicDepsRef.current,
      selectionStart: state.selectionStart, selectionEnd: state.selectionEnd,
      selectionMask: state.selectionMask, selectionMaskBounds: state.selectionMaskBounds,
    };
  });
  const alphaAt = (x: number, y: number) => {
    const state = useAppStore.getState();
    if (state.selectionMask && state.selectionMaskBounds) {
      const lx = x - state.selectionMaskBounds.x; const ly = y - state.selectionMaskBounds.y;
      return lx >= 0 && ly >= 0 && lx < state.selectionMask.width && ly < state.selectionMask.height
        ? state.selectionMask.data[(ly * state.selectionMask.width + lx) * 4 + 3] : 0;
    }
    return state.selectionStart && state.selectionEnd && x >= state.selectionStart.x && x < state.selectionEnd.x &&
      y >= state.selectionStart.y && y < state.selectionEnd.y ? 255 : 0;
  };
  try {
    const handlers = createPointerHandlers(deps);
    handlers.handlePointerDown(makePointerEvent({ clientX: 40, clientY: 40, shiftKey: false }));
    expect(deps.selectionRuntimeRef.current.pendingSelectionHistory?.before.start).toEqual({ x: 20, y: 20 });
    handlers.handlePointerMove(makePointerEvent({ clientX: 60, clientY: 60, buttons: 1, shiftKey: true }));
    callbacks.shift()!(0);
    expect(alphaAt(25, 25)).toBe(255);
    expect(alphaAt(55, 55)).toBe(255);
    handlers.handlePointerMove(makePointerEvent({ clientX: 50, clientY: 50, buttons: 1, shiftKey: false }));
    callbacks.shift()!(1);
    expect(alphaAt(25, 25)).toBe(0);
    expect(alphaAt(45, 45)).toBe(255);
    expect(alphaAt(55, 55)).toBe(0);
    handlers.handlePointerMove(makePointerEvent({ clientX: 50, clientY: 50, buttons: 1, shiftKey: true }));
    callbacks.shift()!(2);
    expect(alphaAt(25, 25)).toBe(255);
    expect(alphaAt(55, 55)).toBe(0);
    if (outcome === 'cancel') {
      deps.stateMachine.state.mode = 'SELECTING';
      handlers.handlePointerMove(makePointerEvent({ clientX: 70, clientY: 70, buttons: 1, shiftKey: true }));
      const lateMove = callbacks.shift()!;
      handlers.handlePointerCancel(makePointerEvent({ clientX: 50, clientY: 50 }));
      expect(alphaAt(25, 25)).toBe(255);
      expect(alphaAt(45, 45)).toBe(0);
      expect(deps.suppressBootstrapUntilPointerUpRef.current).toBe(true);
      expect(deps.selectionRuntimeRef.current.pendingSelectionHistory).toBeNull();
      expect(deps.interaction.refs.selectionStart.current).toBeNull();
      expect(deps.stateMachine.dispatch).toHaveBeenCalledWith({ type: 'END_INTERACTION' });
      deps.interaction.state.isSelecting = true;
      lateMove(3);
      handlers.handlePointerUp(makePointerEvent({ clientX: 70, clientY: 70, shiftKey: true }));
      expect(alphaAt(25, 25)).toBe(255);
      expect(alphaAt(65, 65)).toBe(0);
      expect(historyManager.entries()).toHaveLength(0);
      return;
    }
    handlers.handlePointerUp(makePointerEvent({ clientX: 50, clientY: 50, shiftKey: false }));
    expect(alphaAt(25, 25)).toBe(0);
    expect(historyManager.entries()).toHaveLength(1);
    await historyManager.undo();
    expect(useAppStore.getState().selectionStart).toEqual({ x: 20, y: 20 });
    expect(useAppStore.getState().selectionEnd).toEqual({ x: 30, y: 30 });
    await historyManager.redo();
    expect(useAppStore.getState().selectionStart).toEqual({ x: 40, y: 40 });
    expect(useAppStore.getState().selectionEnd).toEqual({ x: 50, y: 50 });
  } finally {
    unsubscribe();
    global.requestAnimationFrame = previousRaf;
    historyManager.clear();
    useAppStore.getState().clearSelection();
  }
});


// Rasterization is the Canvas I/O boundary; geometry, application, and history
// below run through the real pointer/selection/store owners.
const installPointerPolygonRaster = () => {
  const prototype = Object.getPrototypeOf(document.createElement('canvas').getContext('2d')) as CanvasRenderingContext2D;
  const paths = new WeakMap<CanvasRenderingContext2D, Array<{ x: number; y: number }>>();
  jest.spyOn(prototype, 'beginPath').mockImplementation(function (this: CanvasRenderingContext2D) {
    paths.set(this, []);
  });
  jest.spyOn(prototype, 'moveTo').mockImplementation(function (this: CanvasRenderingContext2D, x, y) {
    paths.set(this, [{ x, y }]);
  });
  jest.spyOn(prototype, 'lineTo').mockImplementation(function (this: CanvasRenderingContext2D, x, y) {
    paths.get(this)?.push({ x, y });
  });
  jest.spyOn(prototype, 'fill').mockImplementation(function (this: CanvasRenderingContext2D) {
    const points = paths.get(this) ?? [];
    const image = this.getImageData(0, 0, this.canvas.width, this.canvas.height);
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      let winding = 0;
      const px = x + 0.5; const py = y + 0.5;
      for (let i = 0; i < points.length; i++) {
        const a = points[i]; const b = points[(i + 1) % points.length];
        const cross = (b.x - a.x) * (py - a.y) - (px - a.x) * (b.y - a.y);
        if (a.y <= py && b.y > py && cross > 0) winding++;
        if (a.y > py && b.y <= py && cross < 0) winding--;
      }
      if (winding !== 0) image.data.set([255, 255, 255, 255], (y * image.width + x) * 4);
    }
    this.putImageData(image, 0, 0);
  });
};

const pointerSelectionAlpha = () => {
  const state = useAppStore.getState();
  const alpha = new Uint8ClampedArray(mockProject.width * mockProject.height);
  for (let y = 0; y < mockProject.height; y++) for (let x = 0; x < mockProject.width; x++) {
    if (state.selectionMask && state.selectionMaskBounds) {
      const lx = x - state.selectionMaskBounds.x; const ly = y - state.selectionMaskBounds.y;
      if (lx >= 0 && ly >= 0 && lx < state.selectionMask.width && ly < state.selectionMask.height) {
        alpha[y * mockProject.width + x] = state.selectionMask.data[(ly * state.selectionMask.width + lx) * 4 + 3];
      }
    } else if (state.selectionStart && state.selectionEnd && x >= state.selectionStart.x && x < state.selectionEnd.x &&
      y >= state.selectionStart.y && y < state.selectionEnd.y) alpha[y * mockProject.width + x] = 255;
  }
  return alpha;
};

const createFreehandPointerFixture = () => {
  const framebuffer = document.createElement('canvas');
  framebuffer.width = framebuffer.height = 100;
  const context = framebuffer.getContext('2d')!;
  context.fillStyle = '#c03020';
  context.fillRect(0, 0, 100, 100);
  const imageData = context.getImageData(0, 0, 100, 100);
  const layer = {
    id: 'lasso-pointer-owner', name: 'Lasso pointer owner', visible: true, opacity: 1,
    blendMode: 'source-over' as const, locked: false, order: 0, layerType: 'normal' as const,
    imageData, framebuffer, alignment: createDefaultLayerAlignment(),
  };
  historyManager.clear();
  useAppStore.getState().clearSelection();
  useAppStore.setState({ layers: [layer], activeLayerId: layer.id, project: { ...mockProject, layers: [layer] }, floatingPaste: null });
  const { deps, dynamicDepsRef } = createDeps({
    project: useAppStore.getState().project!, layers: [layer], activeLayerId: layer.id,
    tools: { ...baseDynamic.tools, currentTool: 'selection', selectionMode: 'freehand' },
  }, {
    setSelectionBounds: (start, end, source) => useAppStore.getState().setSelectionBounds(start, end, source),
    clearSelection: () => useAppStore.getState().clearSelection(),
    getMousePos: (event) => ({ x: event.clientX, y: event.clientY }),
  });
  deps.interaction.dispatch = (action) => {
    if (action.type === 'SELECTION_START') deps.interaction.state.isSelecting = true;
    if (action.type === 'SELECTION_END') deps.interaction.state.isSelecting = false;
  };
  const syncSelection = () => {
    const state = useAppStore.getState();
    dynamicDepsRef.current = { ...dynamicDepsRef.current,
      selectionStart: state.selectionStart, selectionEnd: state.selectionEnd,
      selectionMask: state.selectionMask, selectionMaskBounds: state.selectionMaskBounds,
    };
    Object.assign(deps, dynamicDepsRef.current);
  };
  const unsubscribe = useAppStore.subscribe(syncSelection);
  const overlayContext = deps.overlayCanvasRef.current!.getContext('2d')!;
  (deps.overlayCanvasRef.current!.getContext as jest.Mock).mockReturnValue(overlayContext);
  return { deps, dynamicDepsRef, syncSelection, unsubscribe, context, overlayContext, canonical: imageData.data.slice(), layer };
};

describe('magic wand pointer transaction regressions', () => {
  afterEach(() => {
    historyManager.clear();
    useAppStore.getState().clearSelection();
    jest.restoreAllMocks();
  });

  const expectReplaySnapshot = (snapshot: ReturnType<typeof captureSelectionSnapshot>, direction: 'backward' | 'forward') => {
    expect(captureSelectionSnapshot()).toEqual({
      ...snapshot,
      provenance: snapshot.start && snapshot.end ? {
        ...snapshot.provenance,
        source: `history-selection-${direction}`,
        ownerKind: 'history-restored',
        restoredFromHistory: true,
        restoredOwnerKind: snapshot.provenance?.ownerKind === 'history-restored'
          ? snapshot.provenance.restoredOwnerKind
          : snapshot.provenance?.ownerKind,
        maskLayerId: snapshot.provenance?.maskLayerId ?? snapshot.maskLayerId ?? null,
      } : null,
    });
  };

  const setup = (baseline: 'none' | 'disjoint' | 'hole' = 'disjoint') => {
    const fixture = createFreehandPointerFixture();
    fixture.context.fillStyle = '#2030c0';
    fixture.context.fillRect(40, 40, 20, 20);
    fixture.layer.imageData = fixture.context.getImageData(0, 0, 100, 100);
    const canonical = fixture.layer.imageData.data.slice();
    fixture.deps.tools = { ...fixture.deps.tools, selectionMode: 'magic-wand' };
    fixture.dynamicDepsRef.current.tools = fixture.deps.tools;
    if (baseline !== 'none') {
      const start = baseline === 'hole' ? 40 : 10;
      const end = baseline === 'hole' ? 60 : 20;
      useAppStore.getState().setSelectionBounds({ x: start, y: start }, { x: end, y: end }, 'selection-marquee-final');
      const mask = new ImageData(end - start, end - start);
      for (let y = 0; y < mask.height; y++) for (let x = 0; x < mask.width; x++) {
        const alpha = baseline === 'hole' && x >= 5 && x < 15 && y >= 5 && y < 15 ? 0 : 128;
        mask.data.set([12, 34, 56, alpha], (y * mask.width + x) * 4);
      }
      useAppStore.setState({ selectionMask: mask,
        selectionMaskBounds: { x: start, y: start, width: end - start, height: end - start },
        selectionMaskLayerId: fixture.layer.id,
        selectionVectorPath: { mode: 'freehand', points: [{ x: start, y: start }, { x: end, y: start }, { x: end, y: end }] },
      });
    }
    fixture.syncSelection();
    const press = (x: number, y: number, shiftKey = false) => {
      const handlers = createPointerHandlers(fixture.deps);
      handlers.handlePointerDown(makePointerEvent({ clientX: x, clientY: y, shiftKey }));
      handlers.handlePointerUp(makePointerEvent({ clientX: x, clientY: y, shiftKey }));
    };
    const expectCanonical = () => {
      expect(fixture.layer.imageData.data).toEqual(canonical);
      expect(fixture.context.getImageData(0, 0, 100, 100).data).toEqual(canonical);
      expect(useAppStore.getState().floatingPaste).toBeNull();
    };
    return { ...fixture, press, expectCanonical };
  };

  it.each(['none', 'disjoint', 'hole'] as const)('records exact %s replacement and Undo/Redo without changing artwork', async baseline => {
    const f = setup(baseline);
    try {
      const before = captureSelectionSnapshot();
      const beforeAlpha = pointerSelectionAlpha();
      f.press(50, 50);
      const after = captureSelectionSnapshot();
      const expected = new Uint8ClampedArray(10000);
      for (let y = 40; y < 60; y++) for (let x = 40; x < 60; x++) expected[y * 100 + x] = 255;
      expect(pointerSelectionAlpha()).toEqual(expected);
      expect(after.maskBounds).toEqual({ x: 40, y: 40, width: 20, height: 20 });
      expect(after.maskLayerId).toBe(f.layer.id);
      expect(after.vectorPath).toBeNull();
      expect(historyManager.entries()).toHaveLength(1);
      await historyManager.undo();
      expect(pointerSelectionAlpha()).toEqual(beforeAlpha);
      expectReplaySnapshot(before, 'backward');
      await historyManager.redo();
      expect(pointerSelectionAlpha()).toEqual(expected);
      expectReplaySnapshot(after, 'forward');
      f.expectCanonical();
    } finally { f.unsubscribe(); }
  });

  it('records Shift union and preserves exact mask/vector ownership through Undo/Redo', async () => {
    const f = setup();
    try {
      const before = captureSelectionSnapshot();
      const expected = pointerSelectionAlpha().map(alpha => alpha > 0 ? 255 : 0);
      for (let y = 40; y < 60; y++) for (let x = 40; x < 60; x++) expected[y * 100 + x] = 255;
      f.press(50, 50, true);
      const after = captureSelectionSnapshot();
      expect(pointerSelectionAlpha()).toEqual(expected);
      expect(after.maskLayerId).toBe(f.layer.id);
      expect(after.vectorPath).toBeNull();
      expect(historyManager.entries()).toHaveLength(1);
      await historyManager.undo();
      expectReplaySnapshot(before, 'backward');
      await historyManager.redo();
      expectReplaySnapshot(after, 'forward');
      f.expectCanonical();
    } finally { f.unsubscribe(); }
  });

  it.each([false, true].flatMap(shiftKey => [
    { x: 100, y: 50, shiftKey }, { x: 50, y: 100, shiftKey },
  ]))('rejects exact outside-source seed ($x, $y), Shift=$shiftKey without clearing A', ({ x, y, shiftKey }) => {
    const f = setup();
    try {
      const before = captureSelectionSnapshot();
      f.press(x, y, shiftKey);
      expect(captureSelectionSnapshot()).toEqual(before);
      expect(historyManager.entries()).toHaveLength(0);
      f.expectCanonical();
    } finally { f.unsubscribe(); }
  });

  it.each([false, true])('preserves A when its active layer has no sample source, Shift=%s', shiftKey => {
    const f = setup();
    try {
      jest.spyOn(selectionCapture, 'resolveLayerImageData').mockReturnValue(null);
      const before = captureSelectionSnapshot();
      f.press(50, 50, shiftKey);
      expect(captureSelectionSnapshot()).toEqual(before);
      expect(historyManager.entries()).toHaveLength(0);
      f.expectCanonical();
    } finally { f.unsubscribe(); }
  });

  it('retains initial selected-alpha extraction ahead of wand authoring', () => {
    const f = setup();
    try {
      (f.deps.extractSelectionToFloatingPaste as jest.Mock).mockReturnValue(true);
      const before = captureSelectionSnapshot();
      f.press(15, 15);
      expect(f.deps.extractSelectionToFloatingPaste).toHaveBeenCalledTimes(1);
      expect(captureSelectionSnapshot()).toEqual(before);
      expect(historyManager.entries()).toHaveLength(0);
      f.expectCanonical();
    } finally { f.unsubscribe(); }
  });
});

describe('lasso pointer sample and composition lifetime regressions', () => {
  const originalRaf = global.requestAnimationFrame;
  const originalCancelRaf = global.cancelAnimationFrame;
  let frames: FrameRequestCallback[];
  beforeEach(() => {
    frames = [];
    global.requestAnimationFrame = (callback) => { frames.push(callback); return frames.length; };
    global.cancelAnimationFrame = jest.fn();
    installPointerPolygonRaster();
  });
  afterEach(() => {
    global.requestAnimationFrame = originalRaf;
    global.cancelAnimationFrame = originalCancelRaf;
    historyManager.clear();
    useAppStore.getState().clearSelection();
    jest.restoreAllMocks();
  });

  it.each([false, true])('discards a queued pre-admission hover across handler recreation %s', async (recreate) => {
    const fixture = createFreehandPointerFixture();
    const { deps } = fixture;
    try {
      const handlers = createPointerHandlers(deps);
      handlers.handlePointerMove(makePointerEvent({ clientX: 80, clientY: 80, buttons: 0 }));
      expect(frames).toHaveLength(1);
      const staleHover = frames[0];
      const admittedHandlers = recreate ? createPointerHandlers(deps) : handlers;
      admittedHandlers.handlePointerDown(makePointerEvent({ clientX: 40, clientY: 40 }));
      // Deliver the older closure's queued callback after admission, before any active move.
      staleHover(0);
      expect(deps.selectionRuntimeRef.current.freehandSession.points).toEqual([{ x: 40, y: 40 }]);
      admittedHandlers.handlePointerMove(makePointerEvent({ clientX: 60, clientY: 40, buttons: 1 }));
      admittedHandlers.handlePointerMove(makePointerEvent({ clientX: 40, clientY: 60, buttons: 1 }));
      expect(deps.selectionRuntimeRef.current.freehandSession.points).toEqual([
        { x: 40, y: 40 }, { x: 60, y: 40 }, { x: 40, y: 60 },
      ]);
      admittedHandlers.handlePointerUp(makePointerEvent({ clientX: 40, clientY: 60 }));
      const expected = new Uint8ClampedArray(10000);
      for (let y = 40; y < 60; y++) for (let x = 40; x < 60; x++) {
        if (x + y < 99) expected[y * 100 + x] = 255;
      }
      expect(pointerSelectionAlpha()).toEqual(expected);
      expect(historyManager.entries()).toHaveLength(1);
      await historyManager.undo();
      expect(pointerSelectionAlpha()).toEqual(new Uint8ClampedArray(10000));
      await historyManager.redo();
      expect(pointerSelectionAlpha()).toEqual(expected);
      expect(fixture.context.getImageData(0, 0, 100, 100).data).toEqual(fixture.canonical);
      expect(fixture.layer.imageData.data).toEqual(fixture.canonical);
    } finally { fixture.unsubscribe(); }
  });

  it('keeps Space pan ahead of immediate freehand geometry', () => {
    const fixture = createFreehandPointerFixture();
    const { deps } = fixture;
    try {
      const handlers = createPointerHandlers(deps);
      handlers.handlePointerDown(makePointerEvent({ clientX: 40, clientY: 40 }));
      deps.isSpacePressedRef.current = true;
      handlers.handlePointerMove(makePointerEvent({ clientX: 60, clientY: 60, buttons: 1 }));
      expect(deps.pan.startPan).toHaveBeenCalledWith(60, 60);
      expect(deps.selectionRuntimeRef.current.freehandSession.points).toEqual([{ x: 40, y: 40 }]);
      expect(historyManager.entries()).toHaveLength(0);
      expect(fixture.layer.imageData.data).toEqual(fixture.canonical);
      handlers.handlePointerCancel(makePointerEvent());
    } finally { fixture.unsubscribe(); }
  });

  it.each([
    { name: 'triangle', points: [{ x: 40, y: 40 }, { x: 60, y: 40 }, { x: 40, y: 60 }] },
    { name: 'concave', points: [{ x: 40, y: 40 }, { x: 60, y: 40 }, { x: 60, y: 48 }, { x: 48, y: 48 }, { x: 48, y: 60 }, { x: 40, y: 60 }] },
  ])('retains every delivered $name corner with RAF held through completion and replay', async ({ name, points }) => {
    const fixture = createFreehandPointerFixture();
    const { deps } = fixture;
    try {
      const handlers = createPointerHandlers(deps);
      handlers.handlePointerDown(makePointerEvent({ clientX: points[0].x, clientY: points[0].y }));
      for (const point of points.slice(1)) {
        const event = makePointerEvent({ clientX: point.x, clientY: point.y, buttons: 1 });
        handlers.handlePointerMove(event);
        handlers.handlePointerMove(event); // Stationary delivered duplicates are deduplicated by the owner.
      }
      expect(deps.selectionRuntimeRef.current.freehandSession.points).toEqual(points);
      const last = points[points.length - 1];
      handlers.handlePointerUp(makePointerEvent({ clientX: last.x, clientY: last.y }));
      const expected = new Uint8ClampedArray(10000);
      for (let y = 40; y < 60; y++) for (let x = 40; x < 60; x++) {
        if (name === 'concave' ? x < 48 || y < 48 : x + y < 99) expected[y * 100 + x] = 255;
      }
      expect(pointerSelectionAlpha()).toEqual(expected);
      expect(useAppStore.getState().selectionMaskBounds).toEqual({ x: 40, y: 40, width: 20, height: 20 });
      expect(useAppStore.getState().selectionVectorPath).toEqual({ mode: 'freehand', points: [...points, last] });
      expect(historyManager.entries()).toHaveLength(1);
      await historyManager.undo();
      expect(pointerSelectionAlpha()).toEqual(new Uint8ClampedArray(10000));
      await historyManager.redo();
      expect(pointerSelectionAlpha()).toEqual(expected);
      expect(fixture.context.getImageData(0, 0, 100, 100).data).toEqual(fixture.canonical);
      expect(fixture.layer.imageData.data).toEqual(fixture.canonical);
    } finally { fixture.unsubscribe(); }
  });

  it.each([
    { change: 'tool', moveWhileAway: false },
    { change: 'tool', moveWhileAway: true },
    { change: 'mode', moveWhileAway: false },
  ] as const)('cancels freehand immediately on $change change (move while away: $moveWhileAway), then accepts a fresh gesture', async ({ change, moveWhileAway }) => {
    const fixture = createFreehandPointerFixture();
    const { deps } = fixture;
    useAppStore.getState().setSelectionBounds({ x: 10, y: 10 }, { x: 20, y: 20 }, 'selection-marquee-final');
    fixture.syncSelection();
    const before = captureSelectionSnapshot();
    const hook = renderHook((input: EventHandlerDependenciesInput) => useCanvasEventHandlers(input), { initialProps: deps });
    const rerender = (tools: EventHandlerDynamicDeps['tools']) => {
      deps.tools = tools;
      hook.rerender({ ...deps, tools });
    };
    try {
      act(() => hook.result.current.handlePointerDown(makePointerEvent({ clientX: 40, clientY: 40 })));
      expect(deps.isMouseDownRef.current).toBe(true);
      expect(deps.interaction.state.isSelecting).toBe(true);
      deps.stateMachine.state.mode = 'SELECTING';
      (fixture.overlayContext.clearRect as jest.Mock).mockClear();
      const freehandTools = deps.tools;
      const changedTools = change === 'tool' ? { ...freehandTools, currentTool: 'brush' as const } : { ...freehandTools, selectionMode: 'marquee' as const };
      act(() => rerender(changedTools));
      expect(captureSelectionSnapshot()).toEqual(before);
      expect(deps.isMouseDownRef.current).toBe(false);
      expect(deps.interaction.state.isSelecting).toBe(false);
      expect(deps.interaction.refs.selectionStart.current).toBeNull();
      expect(deps.suppressBootstrapUntilPointerUpRef.current).toBe(true);
      expect(deps.stateMachine.dispatch).toHaveBeenCalledWith({ type: 'END_INTERACTION' });
      expect(fixture.overlayContext.clearRect).toHaveBeenCalled();
      if (moveWhileAway) {
        act(() => hook.result.current.handlePointerMove(makePointerEvent({ clientX: 50, clientY: 50, buttons: 1 })));
        frames.splice(0).forEach((callback) => act(() => callback(0)));
        expect(deps.drawingHandlers.startDrawing).not.toHaveBeenCalled();
      }
      act(() => rerender(freehandTools)); // No pointer event between mode-away and mode-back.
      act(() => {
        hook.result.current.handlePointerMove(makePointerEvent({ clientX: 60, clientY: 40, buttons: 1 }));
        hook.result.current.handlePointerMove(makePointerEvent({ clientX: 60, clientY: 60, buttons: 1 }));
        hook.result.current.handlePointerUp(makePointerEvent({ clientX: 40, clientY: 60 }));
      });
      frames.splice(0).forEach((callback) => act(() => callback(0)));
      expect(captureSelectionSnapshot()).toEqual(before);
      expect(historyManager.entries()).toHaveLength(0);
      expect(deps.drawingHandlers.startDrawing).not.toHaveBeenCalled();
      act(() => {
        hook.result.current.handlePointerDown(makePointerEvent({ clientX: 40, clientY: 40 }));
        hook.result.current.handlePointerMove(makePointerEvent({ clientX: 60, clientY: 40, buttons: 1 }));
        hook.result.current.handlePointerMove(makePointerEvent({ clientX: 60, clientY: 60, buttons: 1 }));
        hook.result.current.handlePointerUp(makePointerEvent({ clientX: 40, clientY: 60 }));
      });
      expect(historyManager.entries()).toHaveLength(1);
      const expected = new Uint8ClampedArray(10000);
      for (let y = 40; y < 60; y++) for (let x = 40; x < 60; x++) expected[y * 100 + x] = 255;
      expect(pointerSelectionAlpha()).toEqual(expected);
      await act(async () => { await historyManager.undo(); });
      expect(captureSelectionSnapshot()).toEqual({ ...before, provenance: { ...before.provenance,
        source: 'history-selection-backward', ownerKind: 'history-restored', restoredFromHistory: true,
        restoredOwnerKind: before.provenance?.ownerKind,
      } });
      await act(async () => { await historyManager.redo(); });
      expect(pointerSelectionAlpha()).toEqual(expected);
      expect(fixture.context.getImageData(0, 0, 100, 100).data).toEqual(fixture.canonical);
      expect(fixture.layer.imageData.data).toEqual(fixture.canonical);
    } finally { hook.unmount(); fixture.unsubscribe(); }
  });
});

// Native mouse count is observed at mousedown; the actual PointerEvent retains
// capture/device identity. Pen/touch continue to author directly.
describe('Click Line native press authority', () => {
  const originalRaf = global.requestAnimationFrame;
  beforeEach(() => {
    global.requestAnimationFrame = jest.fn(() => 1);
    installPointerPolygonRaster();
  });
  afterEach(() => {
    global.requestAnimationFrame = originalRaf;
    historyManager.clear();
    useAppStore.getState().clearSelection();
    jest.restoreAllMocks();
  });
  const fixtureForClickLine = () => {
    const fixture = createFreehandPointerFixture();
    fixture.deps.tools = { ...fixture.deps.tools, selectionMode: 'click-line' };
    fixture.dynamicDepsRef.current.tools = fixture.deps.tools;
    return fixture;
  };
  const mouseDown = (handlers: ReturnType<typeof createPointerHandlers>, event: MouseEvent) => {
    const nativeHandlers = handlers as typeof handlers & { handleMouseDown?: (event: MouseEvent) => void };
    nativeHandlers.handleMouseDown?.(event);
  };
  const press = (handlers: ReturnType<typeof createPointerHandlers>, x: number, y: number, detail = 1, shiftKey = false) => {
    const down = makePointerEvent({ clientX: x, clientY: y, detail: 0, buttons: 1, shiftKey });
    handlers.handlePointerDown(down);
    expect(down.preventDefault).not.toHaveBeenCalled();
    mouseDown(handlers, new MouseEvent('mousedown', { clientX: x, clientY: y, button: 0, detail, shiftKey }));
    handlers.handlePointerUp(makePointerEvent({ clientX: x, clientY: y, buttons: 0, shiftKey }));
  };

  it.each([0, 3])('consumes the native second press after near-start closure (%s px offset), then accepts a fresh polygon', async offset => {
    const f = fixtureForClickLine();
    try {
      let handlers = createPointerHandlers(f.deps);
      for (const [x, y] of [[60, 80], [80, 20], [20, 20]]) press(handlers, x, y);
      press(handlers, 60 + offset, 80);
      const completed = captureSelectionSnapshot();
      const alpha = pointerSelectionAlpha();
      expect(alpha.some(value => value > 0)).toBe(true);
      expect(historyManager.entries()).toHaveLength(1);
      // React can recreate the runtime between constituent native presses.
      handlers = createPointerHandlers(f.deps);
      press(handlers, 60 + offset, 80, 2);
      expect(captureSelectionSnapshot()).toEqual(completed);
      expect(pointerSelectionAlpha()).toEqual(alpha);
      expect(f.deps.selectionRuntimeRef.current.clickLineSession.active).toBe(false);
      expect(f.deps.extractSelectionToFloatingPaste).not.toHaveBeenCalled();
      expect(historyManager.entries()).toHaveLength(1);
      for (const [x, y] of [[40, 40], [60, 40], [60, 60], [40, 60], [40, 40]]) press(handlers, x, y);
      const fresh = new Uint8ClampedArray(10000);
      for (let y = 40; y < 60; y++) for (let x = 40; x < 60; x++) fresh[y * 100 + x] = 255;
      expect(pointerSelectionAlpha()).toEqual(fresh);
      expect(historyManager.entries()).toHaveLength(2);
      await historyManager.undo();
      expect(pointerSelectionAlpha()).toEqual(alpha);
      await historyManager.redo();
      expect(pointerSelectionAlpha()).toEqual(fresh);
      expect(f.context.getImageData(0, 0, 100, 100).data).toEqual(f.canonical);
      expect(f.layer.imageData.data).toEqual(f.canonical);
    } finally { f.unsubscribe(); }
  });

  it('retains both committed native double-click terminal points and one reversible entry', async () => {
    const f = fixtureForClickLine();
    try {
      const handlers = createPointerHandlers(f.deps);
      for (const [x, y] of [[40, 40], [60, 40], [60, 60], [40, 60]]) press(handlers, x, y);
      press(handlers, 40, 60, 2);
      expect(useAppStore.getState().selectionVectorPath).toEqual({ mode: 'click-line', points: [
        { x: 40, y: 40 }, { x: 60, y: 40 }, { x: 60, y: 60 }, { x: 40, y: 60 }, { x: 40, y: 60 },
      ] });
      const expected = new Uint8ClampedArray(10000);
      for (let y = 40; y < 60; y++) for (let x = 40; x < 60; x++) expected[y * 100 + x] = 255;
      expect(pointerSelectionAlpha()).toEqual(expected);
      expect(historyManager.entries()).toHaveLength(1);
      await historyManager.undo();
      expect(pointerSelectionAlpha()).toEqual(new Uint8ClampedArray(10000));
      await historyManager.redo();
      expect(pointerSelectionAlpha()).toEqual(expected);
    } finally { f.unsubscribe(); }
  });

  it.each(['mouse', 'pen', 'touch'] as const)('keeps an admitted %s polygon vertex over retained alpha in the selection workflow', pointerType => {
    const f = fixtureForClickLine();
    try {
      useAppStore.getState().setSelectionBounds({ x: 10, y: 10 }, { x: 30, y: 30 }, 'selection-marquee-final');
      f.syncSelection();
      const handlers = createPointerHandlers(f.deps);
      if (pointerType === 'mouse') {
        press(handlers, 50, 50, 1, true);
        press(handlers, 80, 50);
        press(handlers, 20, 20);
      } else {
        for (const [x, y, shiftKey] of [[50, 50, true], [80, 50, false], [20, 20, false]] as const) {
          handlers.handlePointerDown(makePointerEvent({ clientX: x, clientY: y, pointerType, shiftKey, buttons: 1 }));
          // Native pen can emit compatibility mouse-down before pointer-up.
          mouseDown(handlers, new MouseEvent('mousedown', { clientX: x, clientY: y, detail: 1, button: 0 }));
          handlers.handlePointerUp(makePointerEvent({ clientX: x, clientY: y, pointerType, buttons: 0 }));
          // Native touch compatibility mouse-down can arrive after pointer-up.
          mouseDown(handlers, new MouseEvent('mousedown', { clientX: x, clientY: y, detail: 1, button: 0 }));
        }
      }
      expect(f.deps.extractSelectionToFloatingPaste).not.toHaveBeenCalled();
      expect(f.deps.selectionRuntimeRef.current.clickLineSession.points).toEqual([
        { x: 50, y: 50 }, { x: 80, y: 50 }, { x: 20, y: 20 },
      ]);
      expect(historyManager.entries()).toHaveLength(0);
      expect(f.context.getImageData(0, 0, 100, 100).data).toEqual(f.canonical);
    } finally { f.unsubscribe(); }
  });

  it('rejects an outside-project native second press before appending or completing the active path', () => {
    const f = fixtureForClickLine();
    try {
      const handlers = createPointerHandlers(f.deps);
      for (const [x, y] of [[60, 40], [99, 40], [99, 60]]) press(handlers, x, y);
      press(handlers, 101, 60, 2);
      expect(f.deps.selectionRuntimeRef.current.clickLineSession.points).toEqual([
        { x: 60, y: 40 }, { x: 99, y: 40 }, { x: 99, y: 60 },
      ]);
      expect(f.deps.selectionRuntimeRef.current.clickLineSession.active).toBe(true);
      expect(historyManager.entries()).toHaveLength(0);
      expect(pointerSelectionAlpha()).toEqual(new Uint8ClampedArray(10000));
    } finally { f.unsubscribe(); }
  });

  it('preserves first-press selected-alpha extraction and cancels unconsumed native admission on pointer cancel', () => {
    const f = fixtureForClickLine();
    try {
      useAppStore.getState().setSelectionBounds({ x: 10, y: 10 }, { x: 30, y: 30 }, 'selection-marquee-final');
      f.syncSelection();
      const handlers = createPointerHandlers(f.deps);
      (f.deps.extractSelectionToFloatingPaste as jest.Mock).mockImplementation(() => useAppStore.getState().extractSelectionToFloatingPaste());
      press(handlers, 20, 20);
      expect(f.deps.extractSelectionToFloatingPaste).toHaveBeenCalledTimes(1);
      expect(f.deps.selectionRuntimeRef.current.clickLineSession.active).toBe(false);
      handlers.handlePointerDown(makePointerEvent({ clientX: 50, clientY: 50, buttons: 1 }));
      handlers.handlePointerCancel(makePointerEvent({ clientX: 50, clientY: 50 }));
      mouseDown(handlers, new MouseEvent('mousedown', { clientX: 50, clientY: 50, detail: 1, button: 0 }));
      expect(f.deps.selectionRuntimeRef.current.clickLineSession.active).toBe(false);
    } finally { f.unsubscribe(); }
  });
});

it.each(['tool', 'mode'] as const)('cancels Click Line immediately on %s change between released vertices, without resurrecting the draft', async change => {
  const oldRaf = global.requestAnimationFrame;
  global.requestAnimationFrame = jest.fn(() => 1);
  installPointerPolygonRaster();
  const f = createFreehandPointerFixture();
  f.deps.tools = { ...f.deps.tools, selectionMode: 'click-line' };
  f.dynamicDepsRef.current.tools = f.deps.tools;
  useAppStore.getState().setSelectionBounds({ x: 10, y: 10 }, { x: 20, y: 20 }, 'selection-marquee-final');
  f.syncSelection();
  const before = captureSelectionSnapshot();
  const hook = renderHook((input: EventHandlerDependenciesInput) => useCanvasEventHandlers(input), { initialProps: f.deps });
  const vertex = (x: number, y: number) => {
    hook.result.current.handlePointerDown(makePointerEvent({ clientX: x, clientY: y, pointerType: 'pen', buttons: 1 }));
    hook.result.current.handlePointerUp(makePointerEvent({ clientX: x, clientY: y, pointerType: 'pen', buttons: 0 }));
  };
  try {
    act(() => { vertex(40, 40); vertex(60, 40); });
    expect(f.deps.interaction.refs.selectionStart.current).toBeNull();
    (f.overlayContext.clearRect as jest.Mock).mockClear();
    const originalTools = f.deps.tools;
    const changedTools = change === 'tool' ? { ...originalTools, currentTool: 'brush' } : { ...originalTools, selectionMode: 'marquee' as const };
    act(() => { f.deps.tools = changedTools; hook.rerender({ ...f.deps, tools: changedTools }); });
    expect(captureSelectionSnapshot()).toEqual(before);
    expect(f.overlayContext.clearRect).toHaveBeenCalled();
    expect(f.deps.isMouseDownRef.current).toBe(false);
    act(() => { f.deps.tools = originalTools; hook.rerender({ ...f.deps, tools: originalTools }); });
    act(() => hook.result.current.handleKeyDown(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter' })));
    expect(captureSelectionSnapshot()).toEqual(before);
    expect(historyManager.entries()).toHaveLength(0);
    act(() => { for (const [x, y] of [[40, 40], [60, 40], [60, 60], [40, 60], [40, 40]]) vertex(x, y); });
    const expected = new Uint8ClampedArray(10000);
    for (let y = 40; y < 60; y++) for (let x = 40; x < 60; x++) expected[y * 100 + x] = 255;
    expect(pointerSelectionAlpha()).toEqual(expected);
    expect(historyManager.entries()).toHaveLength(1);
    await act(async () => { await historyManager.undo(); });
    expect(pointerSelectionAlpha().filter(value => value > 0)).toHaveLength(100);
    await act(async () => { await historyManager.redo(); });
    expect(pointerSelectionAlpha()).toEqual(expected);
    expect(f.context.getImageData(0, 0, 100, 100).data).toEqual(f.canonical);
  } finally {
    hook.unmount(); f.unsubscribe(); global.requestAnimationFrame = oldRaf; jest.restoreAllMocks();
    historyManager.clear(); useAppStore.getState().clearSelection();
  }
});
