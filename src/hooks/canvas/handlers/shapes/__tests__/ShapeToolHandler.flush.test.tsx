/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { act, fireEvent, render, renderHook } from '@testing-library/react';
import { useAppStore } from '@/stores/useAppStore';
import { shapeFillBrushPreset } from '@/presets/brushPresets';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import { useDrawingCanvasCancelOps } from '@/components/canvas/useDrawingCanvasCancelOps';
import { useDrawingCanvasFinalizeActiveShape } from '@/components/canvas/useDrawingCanvasFinalizeActiveShape';
import { performCanvasUndo } from '@/components/canvas/useDrawingCanvasKeyboard';
import { flushPendingToolWork, runToolFlush, unregisterToolFlush } from '@/utils/toolFlushRegistry';
import type { EventHandlerDependencies } from '@/hooks/canvas/utils/types';
import type { DrawingHandlers } from '@/hooks/useDrawingHandlers';
import historyManager from '@/history/historyService';
import { BrushShape, type Layer } from '@/types';

import { createShapeToolHandler } from '../ShapeToolHandler';
const SHAPE_FILL_COMMIT_KEY = 'shape-tool:shape-fill-commit';

describe('ShapeToolHandler finalize/preview flow', () => {
  it('exposes pointer handler API and no public flush hook', () => {
    const handler = createShapeToolHandler(
      {
        deps: {
          canvasRef: { current: document.createElement('canvas') },
          canvas: { zoom: 1 },
          pan: {
            screenToWorld: (x: number, y: number) => ({ x, y }),
            worldToScreen: (x: number, y: number) => ({ x, y }),
          },
          drawingHandlers: {},
          tools: {
            currentTool: 'brush',
            brushSettings: { brushShape: 'round', pressureEnabled: false, color: '#000000' },
            fillSettings: { threshold: 0, contiguous: true, eraseInstead: false },
            eraserSettings: {},
            shapeMode: false,
            customBrushCapture: { mode: 'idle', sourceLayerId: null, points: [], freehandPath: null },
          },
          overlayCanvasRef: { current: null },
          compositeCanvasRef: { current: null },
          compositeCanvasDirtyRef: { current: false },
          compositeLayersToCanvas: jest.fn(),
          setCurrentOffscreenCanvas: jest.fn(),
          project: { width: 100, height: 100 },
          stateMachine: { dispatch: jest.fn(), finalizationComplete: jest.fn(), state: { mode: 'IDLE' } },
          setNeedsRedraw: jest.fn(),
          viewTransformRef: { current: { scale: 1, offsetX: 0, offsetY: 0 } },
          sampleColorAtPosition: jest.fn(() => '#000000'),
          previewAnimationFrameRef: { current: null },
          layers: [],
          activeLayerId: null,
          interaction: { dispatch: jest.fn() },
          feedback: jest.fn(),
        } as any,
        overlayPreviewFrameMs: 16,
        getLastOverlayPreviewTs: () => 0,
        setLastOverlayPreviewTs: jest.fn(),
      },
      {}
    ) as any;

    expect(typeof handler.handlePointerDown).toBe('function');
    expect(typeof handler.handlePointerMove).toBe('function');
    expect(typeof handler.handlePointerUp).toBe('function');
    expect(handler.flush).toBeUndefined();
  });
});


// The real release/session/cancel owners run here. Canvas painting and raster
// publication are I/O boundaries; unused handler branches are not invoked.
const ioBoundary = <T extends object,>(members: Partial<T>): T => new Proxy(members, {
  get(target, key) {
    if (!(key in target)) throw new Error(`Unexpected I/O boundary access: ${String(key)}`);
    return Reflect.get(target, key);
  },
}) as T;

const createShapeFillHandoff = () => {
  const points = [{ x: 8, y: 8 }, { x: 24, y: 8 }, { x: 24, y: 24 }, { x: 8, y: 24 }];
  const drawingCanvas = document.createElement('canvas');
  drawingCanvas.width = drawingCanvas.height = 32;
  const ctx = drawingCanvas.getContext('2d');
  if (!ctx) throw new Error('Canvas2D unavailable');
  jest.spyOn(ctx, 'getImageData').mockImplementation((_x, _y, width, height) => {
    const image = new ImageData(width, height);
    if (image.data.length) image.data[3] = 255;
    return image;
  });
  const framebuffer = document.createElement('canvas');
  framebuffer.width = framebuffer.height = 32;
  const layer: Layer = {
    id: 'shape-handoff-target', name: 'Target', visible: true, opacity: 1,
    blendMode: 'source-over', locked: false, order: 0, layerType: 'normal',
    alignment: createDefaultLayerAlignment(), imageData: new ImageData(32, 32), framebuffer,
  };
  useAppStore.setState((state) => ({
    project: { id: 'shape-handoff', name: 'Handoff', width: 32, height: 32, layers: [layer],
      backgroundColor: '#fff', createdAt: new Date(0), updatedAt: new Date(0), customBrushes: [] },
    layers: [layer], activeLayerId: layer.id, currentBrushPreset: shapeFillBrushPreset,
    tools: { ...state.tools, currentTool: 'brush', shapeMode: true,
      brushSettings: { ...state.tools.brushSettings, brushShape: BrushShape.SHAPE_FILL, opacity: 1, pressureEnabled: false } },
  }));
  const store = useAppStore.getState();
  store.setShapeFillActiveFill('hatch');
  store.setShapeFillSampleUnderShape(false);
  store.setShapeFillUseBackground(false);
  store.setShapeFillPixelPerfect(true);
  store.setShapeFillShowOutline(false);
  store.setShapeFillParamValue('hatch', 'lostEdge', 0);
  store.setShapeFillParamValue('hatch', 'variance', 0);
  store.setShapeFillParamValue('hatch', 'organic', 0);
  store.setShapeFillParamValue('hatch', 'segments', 1);
  store.setShapeDrawing(true);
  points.forEach(point => store.addShapePoint(point));
  const shapePointsRef = { current: points.map(point => ({ ...point })) };
  const isDrawingShapeRef = { current: true };
  const isSelectingDirectionRef = { current: false };
  const overlayCanvasRef = { current: document.createElement('canvas') };
  const clearDrawingCanvas = jest.fn();
  const commitRasterOverlay = jest.fn(async () => {});
  const finalizeDrawing = jest.fn(async () => {});
  const drawingHandlers = ioBoundary<DrawingHandlers>({
    drawingCanvasRef: { current: drawingCanvas }, drawingCanvasHasContent: { current: true },
    isDrawingShapeRef, shapePointsRef, isSelectingDirectionRef,
    initDrawingCanvas: jest.fn(), clearDrawingCanvas, commitRasterOverlay, finalizeDrawing,
    finalizeShapeDrawing: jest.fn(async () => {}),
  });
  const stateMachine = { finalizationComplete: jest.fn() };
  const interactionDispatch = jest.fn();
  const setNeedsRedraw = jest.fn();
  const state = useAppStore.getState();
  const deps = ioBoundary<EventHandlerDependencies>({
    canvasRef: { current: document.createElement('canvas') }, canvas: { width: 32, height: 32, scale: 1, zoom: 1 },
    drawingHandlers, shapeBrushRuntime: null,
    tools: state.tools, project: state.project, layers: state.layers, activeLayerId: state.activeLayerId,
    overlayCanvasRef, compositeCanvasRef: { current: null }, compositeCanvasDirtyRef: { current: false },
    compositeLayersToCanvas: jest.fn(), setCurrentOffscreenCanvas: jest.fn(),
    stateMachine: ioBoundary<EventHandlerDependencies['stateMachine']>(stateMachine), setNeedsRedraw, viewTransformRef: { current: { scale: 1, offsetX: 0, offsetY: 0 } },
    sampleColorAtPosition: () => '#000000', interaction: ioBoundary<EventHandlerDependencies['interaction']>({ dispatch: interactionDispatch }),
    feedback: jest.fn(), pan: ioBoundary<EventHandlerDependencies['pan']>({ screenToWorld: (x: number, y: number) => ({ x, y }) }),
    previewAnimationFrameRef: { current: null }, restartColorCycleAnimation: undefined,
  });
  const handler = createShapeToolHandler({
    deps, overlayPreviewFrameMs: 16,
    getLastOverlayPreviewTs: () => 0, setLastOverlayPreviewTs: jest.fn(),
  }, {});
  const view = render(<canvas onPointerUp={event => handler.handlePointerUp(event)} onPointerDown={event => handler.handlePointerDown(event)} />);
  const canvas = view.container.querySelector('canvas');
  if (!canvas) throw new Error('Release input boundary unavailable');
  const cancel = renderHook(() => useDrawingCanvasCancelOps({
    clearDrawingCanvas, interactionDispatch, resetPolygonGradient: jest.fn(), resetRectangleGradient: jest.fn(),
    setNeedsRedraw, overlayCanvasRef, isDrawingShapeRef, shapePointsRef, isSelectingDirectionRef,
  }));
  const enter = renderHook(() => useDrawingCanvasFinalizeActiveShape({
    finalizeRectangleGradientFromState: jest.fn(async () => false), drawingHandlers,
    sampleColorAtPosition: () => '#000000', stateMachine, overlayCanvasRef,
    rebuildStaticComposite: () => true, compositeCanvasDirtyRef: deps.compositeCanvasDirtyRef,
    setNeedsRedraw, interactionDispatch, tools: state.tools,
  }));
  const release = () => { act(() => { fireEvent.pointerUp(canvas); }); };
  return { points, release, canvas, ctx, shapePointsRef, isDrawingShapeRef, cancel, enter,
    commitRasterOverlay, finalizeDrawing };
};

describe('Shape Pattern contact handoff and native Undo ownership', () => {
  const before = useAppStore.getState();
  beforeEach(() => { historyManager.clear(); });
  afterEach(() => {
    unregisterToolFlush('shape-tool:shape-fill-finalize');
    unregisterToolFlush(SHAPE_FILL_COMMIT_KEY);
    historyManager.clear();
    useAppStore.setState(before, true);
    jest.restoreAllMocks();
  });

  it.each(['pointer', 'Enter'] as const)('allows the first history Undo after %s completion', async mode => {
    const h = createShapeFillHandoff();
    h.release();
    const releasedSession = useAppStore.getState().shapeFill.session;
    expect(releasedSession?.stage).toBe('AdjustingParam');
    expect(releasedSession?.shape?.points).toEqual(h.points);
    expect(h.isDrawingShapeRef.current).toBe(false);
    expect(h.shapePointsRef.current).toEqual([]);
    if (mode === 'pointer') {
      await act(async () => { fireEvent(h.canvas, new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 8, clientY: 8 })); await flushPendingToolWork(); });
      expect(h.commitRasterOverlay).toHaveBeenCalledTimes(1);
    } else {
      await act(async () => { await h.enter.result.current(); });
      expect(h.commitRasterOverlay).toHaveBeenCalledTimes(1);
      expect(h.finalizeDrawing).not.toHaveBeenCalled();
    }
    expect(useAppStore.getState().shapeFill.session).toBeNull();
    const canUndo = jest.fn(() => true);
    const undo = jest.fn(async () => undefined);
    await act(async () => { await performCanvasUndo({ cancelActiveOperations: h.cancel.result.current, canUndo, undo }); });
    expect(canUndo).toHaveBeenCalledTimes(1);
    expect(undo).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().shapeState.isDrawing).toBe(false);
    expect(useAppStore.getState().shapeState.points).toEqual([]);
  });

  it('recomputes a post-release width edit through the active owner instead of the stale Enter canvas', async () => {
    const h = createShapeFillHandoff();
    useAppStore.getState().setShapeFillPixelPerfect(false);
    useAppStore.getState().setShapeFillParamValue('hatch', 'thickness', 1);
    h.release();
    const widths: number[] = [];
    jest.spyOn(h.ctx, 'stroke').mockImplementation(() => { widths.push(h.ctx.lineWidth); });
    useAppStore.getState().setShapeFillParamValue('hatch', 'thickness', 4);

    await act(async () => { await expect(runToolFlush(SHAPE_FILL_COMMIT_KEY)).resolves.toBe(true); });

    expect(widths).toContain(4);
    expect(h.commitRasterOverlay).toHaveBeenCalledTimes(1);
    expect(h.finalizeDrawing).not.toHaveBeenCalled();
    expect(useAppStore.getState().shapeFill.lastFinalize?.params.thickness).toBe(4);
    expect(useAppStore.getState().shapeFill.session).toBeNull();
  });

  it('keeps passive flush nonauthoring and awaits an in-flight active commit without duplication', async () => {
    const h = createShapeFillHandoff();
    h.release();
    await flushPendingToolWork({ passiveOnly: true });
    expect(h.commitRasterOverlay).not.toHaveBeenCalled();
    expect(useAppStore.getState().shapeFill.session?.stage).toBe('AdjustingParam');
    let release = () => {};
    h.commitRasterOverlay.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
    const first = runToolFlush(SHAPE_FILL_COMMIT_KEY);
    await Promise.resolve();
    expect(h.commitRasterOverlay).toHaveBeenCalledTimes(1);
    let passiveDone = false, secondDone = false;
    const passive = flushPendingToolWork({ passiveOnly: true }).then(() => { passiveDone = true; });
    const second = runToolFlush(SHAPE_FILL_COMMIT_KEY).then(() => { secondDone = true; });
    await Promise.resolve();
    expect(passiveDone).toBe(false);
    expect(secondDone).toBe(false);
    release();
    await act(async () => { await Promise.all([first, passive, second]); });
    expect(h.commitRasterOverlay).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().shapeFill.session).toBeNull();
  });

  it('uses the shared target validator before finalizing a draft when its target is missing', async () => {
    const h = createShapeFillHandoff();
    h.release();
    useAppStore.setState({ activeLayerId: 'missing-target' });
    const finalizePayload = jest.spyOn(useAppStore.getState(), 'finalizeShapeFillSession');
    const commitParameter = jest.spyOn(useAppStore.getState(), 'commitShapeFillParameter');

    await act(async () => { await expect(runToolFlush(SHAPE_FILL_COMMIT_KEY)).resolves.toBe(true); });

    expect(commitParameter).not.toHaveBeenCalled();
    expect(finalizePayload).not.toHaveBeenCalled();
    expect(h.commitRasterOverlay).not.toHaveBeenCalled();
    expect(h.finalizeDrawing).not.toHaveBeenCalled();
    expect(useAppStore.getState().shapeFill.session).toBeNull();
  });

  it('still cancels a real post-release adjustment session before history', async () => {
    const h = createShapeFillHandoff();
    h.release();
    expect(useAppStore.getState().shapeFill.session?.stage).toBe('AdjustingParam');
    const canUndo = jest.fn(() => true);
    const undo = jest.fn(async () => undefined);
    await act(async () => { await performCanvasUndo({ cancelActiveOperations: h.cancel.result.current, canUndo, undo }); });
    expect(useAppStore.getState().shapeFill.session).toBeNull();
    expect(canUndo).not.toHaveBeenCalled();
    expect(undo).not.toHaveBeenCalled();
    expect(h.commitRasterOverlay).not.toHaveBeenCalled();
    expect(h.finalizeDrawing).not.toHaveBeenCalled();
  });
});
