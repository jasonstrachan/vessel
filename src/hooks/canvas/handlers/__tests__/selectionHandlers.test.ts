import {
  createSelectionHandlers,
  cancelSelectionSession,
  finalizeClickLineSelectionSession,
} from '@/hooks/canvas/handlers/selectionHandlers';
import type { SelectionHandlerDeps, SelectionRuntimeDynamicDeps } from '@/hooks/canvas/handlers/selectionHandlers';
import type { EventHandlerDynamicDeps } from '@/hooks/canvas/utils/types';
import type { BrushSettings, PaletteState, PolygonGradientState } from '@/types';
import { BrushShape } from '@/types';
import { useAppStore } from '@/stores/useAppStore';
import historyManager from '@/history/historyService';
import { captureSelectionSnapshot } from '@/history/helpers/selectionHistory';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import type { Layer } from '@/types';

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

describe('marquee gesture baseline and exact history', () => {
  afterEach(() => {
    historyManager.clear();
    useAppStore.getState().clearSelection();
    jest.restoreAllMocks();
  });

  it.each([false, true].flatMap((masked) => [
    { masked, initialShift: false, finalShift: false },
    { masked, initialShift: true, finalShift: true },
    { masked, initialShift: false, finalShift: true },
    { masked, initialShift: true, finalShift: false },
  ]))('preserves $masked baseline with Shift $initialShift -> $finalShift through moves and replay', async ({ masked, initialShift, finalShift }) => {
    historyManager.clear();
    const framebuffer = document.createElement('canvas');
    framebuffer.width = framebuffer.height = 32;
    const ctx = framebuffer.getContext('2d')!;
    ctx.fillStyle = '#ff3300';
    ctx.fillRect(0, 0, 32, 32);
    const canonicalPixels = ctx.getImageData(0, 0, 32, 32).data.slice();
    const layer: Layer = {
      id: 'marquee-owner', name: 'Marquee owner', visible: true, opacity: 1,
      blendMode: 'source-over', locked: false, order: 0, layerType: 'normal',
      imageData: ctx.getImageData(0, 0, 32, 32), framebuffer,
      alignment: createDefaultLayerAlignment(),
    };
    const baseDynamic = createDynamicDeps();
    useAppStore.setState({
      project: { ...baseDynamic.project!, width: 32, height: 32, layers: [layer] },
      layers: [layer], activeLayerId: layer.id, floatingPaste: null,
    });
    useAppStore.getState().clearSelection();
    useAppStore.getState().setSelectionBounds({ x: 2, y: 2 }, { x: 6, y: 6 }, 'selection-marquee-final');
    const originalMask = new ImageData(4, 4);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      originalMask.data.set([12, 34, 56, x >= 1 && x < 3 && y >= 1 && y < 3 ? 0 : 128], (y * 4 + x) * 4);
    }
    if (masked) useAppStore.setState({
      selectionMask: originalMask, selectionMaskBounds: { x: 2, y: 2, width: 4, height: 4 },
      selectionMaskLayerId: layer.id,
      selectionVectorPath: { mode: 'freehand', points: [{ x: 2, y: 2 }, { x: 6, y: 2 }, { x: 6, y: 6 }] },
    });
    const maskBytes = originalMask.data.slice();
    const baseline = captureSelectionSnapshot();
    const getDynamic = (): SelectionRuntimeDynamicDeps => {
      const state = useAppStore.getState();
      return {
        tools: baseDynamic.tools, canvas: baseDynamic.canvas, project: state.project,
        selectionStart: state.selectionStart, selectionEnd: state.selectionEnd,
        selectionMask: state.selectionMask, selectionMaskBounds: state.selectionMaskBounds,
        floatingPaste: state.floatingPaste, activeLayerId: state.activeLayerId,
      };
    };
    const deps: SelectionHandlerDeps = {
      interaction: {
        state: { isDrawing: false, isSelecting: false, drawingMode: 'idle' },
        dispatch: (action) => { deps.interaction.state.isSelecting = action.type === 'SELECTION_START'; },
        refs: { selectionStart: { current: null } },
      },
      setSelectionBounds: (start, end, source) => useAppStore.getState().setSelectionBounds(start, end, source),
      clearSelection: () => useAppStore.getState().clearSelection(),
      setShowBrushCursor: jest.fn(), canvasRef: { current: createCanvas() },
      overlayCanvasRef: { current: createCanvas() },
      viewTransformRef: { current: { scale: 1, offsetX: 0, offsetY: 0 } },
      pan: { screenToWorld: (x, y) => ({ x, y }) }, draw: jest.fn(),
      selectionRuntimeRef: { current: {
        pendingSelectionHistory: null, freehandSession: { active: false, points: [] },
        clickLineSession: { active: false, points: [] }, marqueeAutoPan: { frameId: null, screenPos: null },
      } },
    };
    const selectionAlpha = () => {
      const state = useAppStore.getState();
      return Array.from({ length: 1024 }, (_, i) => {
        const x = i % 32; const y = Math.floor(i / 32);
        if (state.selectionMask && state.selectionMaskBounds) {
          const localX = x - state.selectionMaskBounds.x; const localY = y - state.selectionMaskBounds.y;
          return localX >= 0 && localY >= 0 && localX < state.selectionMask.width && localY < state.selectionMask.height
            ? state.selectionMask.data[(localY * state.selectionMask.width + localX) * 4 + 3] : 0;
        }
        return state.selectionStart && state.selectionEnd && x >= state.selectionStart.x && y >= state.selectionStart.y &&
          x < state.selectionEnd.x && y < state.selectionEnd.y ? 255 : 0;
      });
    };
    const expectedAlpha = (end: number, append: boolean) => Array.from({ length: 1024 }, (_, i) => {
      const x = i % 32; const y = Math.floor(i / 32);
      if (x >= 12 && y >= 12 && x < end && y < end) return 255;
      if (!append || x < 2 || y < 2 || x >= 6 || y >= 6) return 0;
      // Selection union uses binary membership; Undo still restores the original fractional bytes.
      return masked && maskBytes[((y - 2) * 4 + x - 2) * 4 + 3] === 0 ? 0 : 255;
    });
    const expectCanonical = () => {
      expect(ctx.getImageData(0, 0, 32, 32).data).toEqual(canonicalPixels);
      expect(useAppStore.getState().layers[0].imageData?.data).toEqual(canonicalPixels);
      expect(originalMask.data).toEqual(maskBytes);
    };
    let handlers = createSelectionHandlers(deps, getDynamic);
    if (!initialShift) handlers.handleSelectionHitTest({ worldPos: { x: 12, y: 12 }, dynamic: getDynamic() });
    handlers.handleSelectionToolPointerDown({
      worldPos: { x: 12, y: 12 }, pointerId: 5, clickCount: 1,
      shiftKey: initialShift, tools: baseDynamic.tools, dynamic: getDynamic(),
    });
    handlers.handleSelectionPointerMove({ worldPos: { x: 20, y: 20 }, screenPos: { x: 50, y: 50 }, shiftKey: initialShift });
    expect(selectionAlpha()).toEqual(expectedAlpha(20, initialShift));
    // React may recreate the owner between moves; the gesture baseline must remain authoritative.
    handlers = createSelectionHandlers(deps, getDynamic);
    handlers.handleSelectionPointerMove({ worldPos: { x: 16, y: 16 }, screenPos: { x: 50, y: 50 }, shiftKey: finalShift });
    expect(selectionAlpha()).toEqual(expectedAlpha(16, finalShift));
    expect(historyManager.entries()).toHaveLength(0);
    expectCanonical();
    if (masked && !initialShift && finalShift) {
      const frames: FrameRequestCallback[] = [];
      jest.spyOn(global, 'requestAnimationFrame').mockImplementation((callback) => { frames.push(callback); return frames.length; });
      deps.pan.screenToWorld = () => ({ x: 18, y: 18 });
      handlers.handleSelectionPointerMove({ worldPos: { x: 16, y: 16 }, screenPos: { x: 98, y: 50 }, shiftKey: true });
      expect(frames).toHaveLength(1);
      handlers = createSelectionHandlers(deps, getDynamic);
      frames.shift()!(16);
      expect(selectionAlpha()).toEqual(expectedAlpha(18, true));
      expectCanonical();
    }
    // Final modifier is independent of the last move's flag.
    handlers.handleSelectionPointerMove({ worldPos: { x: 16, y: 16 }, screenPos: { x: 50, y: 50 }, shiftKey: !finalShift });
    handlers.handleSelectionPointerUp({ event: { pointerId: 5, shiftKey: finalShift } as React.PointerEvent<Element>,
      worldPos: { x: 16, y: 16 }, dynamic: getDynamic() });
    expect(selectionAlpha()).toEqual(expectedAlpha(16, finalShift));
    expect(historyManager.entries()).toHaveLength(1);
    const { provenance: finalProvenance, ...finalSelection } = captureSelectionSnapshot();
    expect(finalProvenance?.source).toBe(finalShift ? 'append-selection-bounds' : 'selection-marquee-final');
    await historyManager.undo();
    const { provenance: restoredProvenance, ...restored } = captureSelectionSnapshot();
    const { provenance: baselineProvenance, ...original } = baseline;
    expect(restored).toEqual(original);
    expect(restoredProvenance).toMatchObject({
      t: baselineProvenance?.t, activeLayerId: layer.id, ownerKind: 'history-restored', restoredFromHistory: true,
    });
    expect(historyManager.entries()).toHaveLength(0);
    expect(historyManager.redoEntries()).toHaveLength(1);
    expectCanonical();
    await historyManager.redo();
    const { provenance: replayedProvenance, ...replayed } = captureSelectionSnapshot();
    expect(replayed).toEqual(finalSelection);
    expect(replayedProvenance?.restoredFromHistory).toBe(true);
    expect(selectionAlpha()).toEqual(expectedAlpha(16, finalShift));
    expectCanonical();
  });
});

describe('selection gesture cancellation authority', () => {
  afterEach(() => {
    historyManager.clear();
    useAppStore.getState().clearSelection();
    jest.restoreAllMocks();
  });

  it.each((['marquee', 'freehand', 'click-line'] as const).flatMap((selectionMode) =>
    [false, true].map((hasBaseline) => ({ selectionMode, hasBaseline }))))(
    'rolls back $selectionMode gesture (original mask: $hasBaseline) and stops stale callbacks without history',
    ({ selectionMode, hasBaseline }) => {
    historyManager.clear();
    const dynamic = createDynamicDeps();
    dynamic.tools.selectionMode = selectionMode;
    useAppStore.getState().clearSelection();
    useAppStore.setState({ project: dynamic.project, activeLayerId: 'cancel-owner', floatingPaste: null });
    useAppStore.getState().setSelectionBounds({ x: 2, y: 2 }, { x: 6, y: 6 }, 'selection-marquee-final');
    const mask = new ImageData(new Uint8ClampedArray(64).fill(128), 4, 4);
    mask.data[3] = 0;
    useAppStore.setState({ selectionMask: mask,
      selectionMaskBounds: { x: 2, y: 2, width: 4, height: 4 }, selectionMaskLayerId: 'cancel-owner',
      selectionVectorPath: { mode: 'freehand', points: [{ x: 2, y: 2 }, { x: 6, y: 6 }] },
    });
    if (!hasBaseline) useAppStore.getState().clearSelection();
    const before = captureSelectionSnapshot();
    const beforeLayers = useAppStore.getState().layers;
    const originalMask = mask.data.slice();
    const frames: FrameRequestCallback[] = [];
    jest.spyOn(global, 'requestAnimationFrame').mockImplementation((callback) => { frames.push(callback); return frames.length; });
    const cancelFrame = jest.spyOn(global, 'cancelAnimationFrame').mockImplementation(() => {});
    const overlayCanvas = document.createElement('canvas');
    const clearOverlay = jest.fn();
    const deps: SelectionHandlerDeps = {
      interaction: {
        state: { isDrawing: false, isSelecting: false, drawingMode: 'idle' },
        dispatch: jest.fn(), refs: { selectionStart: { current: null } },
      },
      setSelectionBounds: (start, end, source) => useAppStore.getState().setSelectionBounds(start, end, source),
      clearSelection: () => useAppStore.getState().clearSelection(),
      setShowBrushCursor: jest.fn(), canvasRef: { current: createCanvas() }, overlayCanvasRef: { current: overlayCanvas },
      viewTransformRef: { current: { scale: 1, offsetX: 0, offsetY: 0 } },
      pan: { screenToWorld: (x, y) => ({ x, y }) }, draw: jest.fn(),
      selectionRuntimeRef: { current: {
        pendingSelectionHistory: null, freehandSession: { active: false, points: [] },
        clickLineSession: { active: false, points: [] }, marqueeAutoPan: { frameId: null, screenPos: null },
      } },
    };
    const handlers = createSelectionHandlers(deps, () => dynamic);
    handlers.handleSelectionToolPointerDown({ worldPos: { x: 20, y: 20 }, pointerId: 7, clickCount: 1,
      shiftKey: true, tools: dynamic.tools, dynamic });
    deps.interaction.state.isSelecting = true;
    handlers.handleSelectionPointerMove({ worldPos: { x: 40, y: 40 }, screenPos: { x: 98, y: 50 }, shiftKey: true });
    const runtime = deps.selectionRuntimeRef.current;
    const retainedBefore = runtime.pendingSelectionHistory!.before;
    const freehandSession = runtime.freehandSession;
    const clickLineSession = runtime.clickLineSession;
    const previousFrame = runtime.marqueeAutoPan.frameId;
    const beforeCancelOffsets = { ...deps.viewTransformRef.current };
    expect(cancelSelectionSession({ runtime, interaction: deps.interaction, clearOverlay })).toBe(true);
    expect(captureSelectionSnapshot()).toEqual(before);
    expect(useAppStore.getState().layers).toBe(beforeLayers);
    expect(runtime.pendingSelectionHistory).toBeNull();
    expect(deps.interaction.refs.selectionStart.current).toBeNull();
    expect(runtime.freehandSession).toBe(freehandSession);
    expect(runtime.clickLineSession).toBe(clickLineSession);
    expect(freehandSession).toEqual({ active: false, points: [] });
    expect(clickLineSession).toEqual({ active: false, points: [] });
    expect(runtime.marqueeAutoPan).toEqual({ frameId: null, screenPos: null });
    if (previousFrame !== null) expect(cancelFrame).toHaveBeenCalledWith(previousFrame);
    expect(deps.interaction.dispatch).toHaveBeenCalledWith({ type: 'SELECTION_END' });
    expect(clearOverlay).toHaveBeenCalledTimes(1);
    expect(cancelSelectionSession({ runtime, interaction: deps.interaction, clearOverlay })).toBe(false);
    // Intentionally retain stale React state and captured callbacks after synchronous cancellation.
    frames[0]?.(16);
    expect(deps.viewTransformRef.current).toEqual(beforeCancelOffsets);
    expect(frames.length).toBe(selectionMode === 'marquee' ? 1 : 0);
    handlers.handleSelectionPointerMove({ worldPos: { x: 60, y: 60 }, screenPos: { x: 50, y: 50 }, shiftKey: true });
    handlers.handleSelectionPointerUp({ event: { pointerId: 7, shiftKey: true } as React.PointerEvent<Element>,
      worldPos: { x: 60, y: 60 }, dynamic });
    expect(captureSelectionSnapshot()).toEqual(before);
    expect(historyManager.entries()).toHaveLength(0);
    expect(historyManager.redoEntries()).toHaveLength(0);
    expect(mask.data).toEqual(originalMask);
    if (hasBaseline) {
      useAppStore.getState().selectionMask!.data[0] = 42;
      expect(retainedBefore.mask!.data).toEqual(originalMask);
      expect(mask.data).toEqual(originalMask);
    } else {
      expect(retainedBefore.mask).toBeNull();
    }
    dynamic.tools.selectionMode = 'marquee';
    handlers.handleSelectionToolPointerDown({ worldPos: { x: 20, y: 20 }, pointerId: 8, clickCount: 1,
      shiftKey: false, tools: dynamic.tools, dynamic });
    handlers.handleSelectionPointerMove({ worldPos: { x: 30, y: 30 }, screenPos: { x: 50, y: 50 }, shiftKey: false });
    handlers.handleSelectionPointerUp({ event: { pointerId: 8, shiftKey: false } as React.PointerEvent<Element>,
      worldPos: { x: 30, y: 30 }, dynamic });
    expect(historyManager.entries()).toHaveLength(1);
    expect(useAppStore.getState().selectionStart).toEqual({ x: 20, y: 20 });
  });
});
