import { act, fireEvent, renderHook } from '@testing-library/react';

import { useDrawingCanvasKeyboard } from '@/components/canvas/useDrawingCanvasKeyboard';
import { trackPendingHistoryCommit, waitForPendingHistoryCommits } from '@/history/pendingHistoryCommits';
import { useAppStore } from '@/stores/useAppStore';
import { BrushShape } from '@/types';
import { flushPendingToolWork, registerToolFlush, unregisterToolFlush } from '@/utils/toolFlushRegistry';
import { useToolSwitcher } from '@/utils/toolSwitch';

type KeyboardOptions = Parameters<typeof useDrawingCanvasKeyboard>[0];
const pendingResolutions: Array<() => void> = [];
const EXISTING_FINALIZATION_KEY = 'test:already-started-finalize';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(resolvePromise => {
    resolve = resolvePromise;
  });
  pendingResolutions.push(resolve);
  return { promise, resolve };
};

const createOptions = (): KeyboardOptions => {
  const interactionStateRef = { current: { isDrawing: false } };
  return {
    switchTool: jest.fn(),
    saveProject: jest.fn().mockResolvedValue(undefined),
    openProjectModal: jest.fn(),
    canUndo: jest.fn(() => false),
    canRedo: jest.fn(() => false),
    undo: jest.fn().mockResolvedValue(undefined),
    redo: jest.fn().mockResolvedValue(undefined),
    toolStateMachine: {
      completePolygonGradient: jest.fn(() => false),
      polygonGradientState: { points: [] },
      isContourPolygon: false,
      resetPolygonGradient: jest.fn(),
    },
    drawingHandlers: {
      initDrawingCanvas: jest.fn(),
      drawingCanvasRef: { current: null },
      drawingCanvasHasContent: { current: false },
      finalizeDrawing: jest.fn().mockResolvedValue(undefined),
    },
    brushRuntime: null,
    layers: [],
    activeLayerId: null,
    tools: { currentTool: 'brush', brushSettings: {}, shapeMode: false },
    isColorCyclePlaybackActive: jest.fn(() => false),
    wrappedStartAnimation: jest.fn(),
    compositeCanvasDirtyRef: { current: false },
    rebuildStaticComposite: jest.fn(() => false),
    stateMachine: { finalizationComplete: jest.fn() },
    setNeedsRedraw: jest.fn(),
    cancelActiveOperations: jest.fn(() => false),
    interactionDispatch: jest.fn(() => {
      interactionStateRef.current = { isDrawing: false };
    }),
    interactionStateRef,
    isMouseDownRef: { current: false },
    suppressBootstrapUntilPointerUpRef: { current: false },
    canvasShapeEditor: { active: false, draft: null },
    commitCanvasShape: jest.fn(),
    cancelCanvasShapeEdit: jest.fn(),
    colorAdjustActive: false,
    applyColorAdjust: jest.fn().mockResolvedValue(undefined),
    crop: { marquee: null, commitInFlight: false },
    commitCrop: jest.fn().mockResolvedValue(undefined),
    finalizeActiveShape: jest.fn().mockResolvedValue(false),
    floatingPaste: null,
    commitFloatingPaste: jest.fn().mockResolvedValue(undefined),
    canvasRef: { current: null },
    draw: jest.fn(),
    viewTransformRef: { current: { scale: 1, offsetX: 0, offsetY: 0 } },
    cancelColorAdjust: jest.fn(),
    previousTool: null,
    cancelCrop: jest.fn(),
  };
};

const dispatchE = async (event: 'keydown' | 'keyup', repeat = false) => {
  await act(async () => {
    fireEvent(window, new KeyboardEvent(event, { key: 'e', code: 'KeyE', repeat }));
  });
};

const startStroke = (options: KeyboardOptions) => {
  options.interactionStateRef.current = { isDrawing: true };
  options.isMouseDownRef.current = true;
  options.drawingHandlers.drawingCanvasHasContent.current = true;
};

const holdFinalization = (options: KeyboardOptions) => {
  const finalize = deferred();
  const history = deferred();
  options.drawingHandlers.finalizeDrawing = jest.fn(() => {
    trackPendingHistoryCommit(history.promise);
    return finalize.promise;
  });
  return { finalize, history };
};

describe('canvas keyboard held eraser stroke transitions', () => {
  let now: number;

  beforeEach(() => {
    now = 1000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    act(() => {
      useAppStore.setState(state => ({
        currentBrushPreset: null,
        tools: {
          ...state.tools,
          currentTool: 'brush',
          previousTool: 'brush',
          shapeMode: false,
          lastRegularShapeMode: false,
          lastColorCycleShapeMode: false,
          brushSettings: { ...state.tools.brushSettings, brushShape: BrushShape.SQUARE },
        },
      }));
    });
  });

  afterEach(async () => {
    unregisterToolFlush(EXISTING_FINALIZATION_KEY);
    await act(async () => {
      pendingResolutions.splice(0).forEach(resolve => resolve());
      await waitForPendingHistoryCommits();
    });
    jest.restoreAllMocks();
  });

  it('finishes a live paint stroke and its queued history before E selects the eraser', async () => {
    const options = createOptions();
    const pending = holdFinalization(options);
    const keyboard = renderHook(() => useDrawingCanvasKeyboard(options));
    // The stroke starts after render, as it does for the real pointer handler.
    startStroke(options);

    await dispatchE('keydown');
    expect(options.suppressBootstrapUntilPointerUpRef.current).toBe(true);
    expect(options.isMouseDownRef.current).toBe(false);
    expect(options.interactionDispatch).toHaveBeenCalledWith({ type: 'DRAWING_END' });
    expect(options.drawingHandlers.finalizeDrawing).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().tools.currentTool).toBe('brush');

    await dispatchE('keydown', true);
    expect(options.drawingHandlers.finalizeDrawing).toHaveBeenCalledTimes(1);
    await act(async () => pending.finalize.resolve());
    expect(useAppStore.getState().tools.currentTool).toBe('brush');
    expect(options.stateMachine.finalizationComplete).not.toHaveBeenCalled();

    await act(async () => pending.history.resolve());
    expect(useAppStore.getState().tools.currentTool).toBe('eraser');
    expect(options.stateMachine.finalizationComplete).toHaveBeenCalledTimes(1);
    expect(options.compositeCanvasDirtyRef.current).toBe(true);
    expect(options.setNeedsRedraw).toHaveBeenCalledTimes(1);
    expect(options.cancelActiveOperations).not.toHaveBeenCalled();
    keyboard.unmount();
  });

  it('finishes a held eraser stroke and its queued history before E release restores the brush', async () => {
    const options = createOptions();
    const keyboard = renderHook(() => useDrawingCanvasKeyboard(options));
    await dispatchE('keydown');
    expect(useAppStore.getState().tools.currentTool).toBe('eraser');
    startStroke(options);
    const pending = holdFinalization(options);
    now += 300;

    await dispatchE('keyup');
    expect(options.suppressBootstrapUntilPointerUpRef.current).toBe(true);
    expect(options.isMouseDownRef.current).toBe(false);
    expect(options.interactionDispatch).toHaveBeenCalledTimes(1);
    expect(options.drawingHandlers.finalizeDrawing).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().tools.currentTool).toBe('eraser');

    // A second release must not finish the same stroke or restore the tool early.
    await dispatchE('keyup');
    expect(options.drawingHandlers.finalizeDrawing).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().tools.currentTool).toBe('eraser');
    await act(async () => pending.finalize.resolve());
    expect(useAppStore.getState().tools.currentTool).toBe('eraser');
    expect(options.stateMachine.finalizationComplete).not.toHaveBeenCalled();

    await act(async () => pending.history.resolve());
    expect(useAppStore.getState().tools.currentTool).toBe('brush');
    expect(options.stateMachine.finalizationComplete).toHaveBeenCalledTimes(1);
    expect(options.setNeedsRedraw).toHaveBeenCalledTimes(1);
    expect(options.cancelActiveOperations).not.toHaveBeenCalled();
    keyboard.unmount();
  });

  it('switches and restores an idle held eraser without authoring or suppressing a stroke', async () => {
    const options = createOptions();
    const keyboard = renderHook(() => useDrawingCanvasKeyboard(options));

    await dispatchE('keydown');
    expect(useAppStore.getState().tools.currentTool).toBe('eraser');
    now += 300;
    await dispatchE('keyup');

    expect(useAppStore.getState().tools.currentTool).toBe('brush');
    expect(options.drawingHandlers.finalizeDrawing).not.toHaveBeenCalled();
    expect(options.interactionDispatch).not.toHaveBeenCalled();
    expect(options.suppressBootstrapUntilPointerUpRef.current).toBe(false);
    expect(options.isMouseDownRef.current).toBe(false);
    expect(options.stateMachine.finalizationComplete).not.toHaveBeenCalled();
    expect(options.setNeedsRedraw).not.toHaveBeenCalled();
    expect(options.cancelActiveOperations).not.toHaveBeenCalled();
    keyboard.unmount();
  });

  it('restores the brush when held E is released while the paint stroke is still finalizing', async () => {
    const options = createOptions();
    const pending = holdFinalization(options);
    const keyboard = renderHook(() => useDrawingCanvasKeyboard(options));
    startStroke(options);

    await dispatchE('keydown');
    expect(useAppStore.getState().tools.currentTool).toBe('brush');
    now += 300;
    await dispatchE('keyup');
    expect(options.drawingHandlers.finalizeDrawing).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().tools.currentTool).toBe('brush');

    await act(async () => pending.finalize.resolve());
    expect(useAppStore.getState().tools.currentTool).toBe('brush');
    await act(async () => pending.history.resolve());

    expect(options.stateMachine.finalizationComplete).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().tools.currentTool).toBe('brush');
    expect(options.drawingHandlers.finalizeDrawing).toHaveBeenCalledTimes(1);
    keyboard.unmount();
  });

  it('finishes an active eraser and its history before native B selects Brush', async () => {
    act(() => useAppStore.getState().setCurrentTool('eraser'));
    const options = createOptions();
    const pending = holdFinalization(options);
    const keyboard = renderHook(() => useDrawingCanvasKeyboard(options));
    startStroke(options);

    await act(async () => fireEvent.keyDown(window, { key: 'b', code: 'KeyB' }));

    expect(options.suppressBootstrapUntilPointerUpRef.current).toBe(true);
    expect(options.isMouseDownRef.current).toBe(false);
    expect(options.interactionDispatch).toHaveBeenCalledWith({ type: 'DRAWING_END' });
    expect(options.drawingHandlers.finalizeDrawing).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().tools.currentTool).toBe('eraser');

    await act(async () => pending.finalize.resolve());
    expect(useAppStore.getState().tools.currentTool).toBe('eraser');
    await act(async () => pending.history.resolve());
    expect(useAppStore.getState().tools.currentTool).toBe('brush');
    expect(options.stateMachine.finalizationComplete).toHaveBeenCalledTimes(1);
    expect(options.setNeedsRedraw).toHaveBeenCalledTimes(1);
    keyboard.unmount();
  });

  it.each([
    ['eraser', 'brush'],
    ['eraser', 'selection'],
    ['brush', 'eraser'],
  ] as const)('uses the toolbar coordinator to complete %s before selecting %s', async (from, to) => {
    act(() => useAppStore.getState().setCurrentTool(from));
    const options = createOptions();
    const pending = holdFinalization(options);
    const toolbar = renderHook(() => {
      useDrawingCanvasKeyboard(options);
      return useToolSwitcher();
    });
    startStroke(options);
    let switched!: Promise<void>;

    await act(async () => { switched = toolbar.result.current(to); });

    expect(options.drawingHandlers.finalizeDrawing).toHaveBeenCalledTimes(1);
    expect(options.suppressBootstrapUntilPointerUpRef.current).toBe(true);
    expect(useAppStore.getState().tools.currentTool).toBe(from);
    await act(async () => pending.finalize.resolve());
    expect(useAppStore.getState().tools.currentTool).toBe(from);
    await act(async () => {
      pending.history.resolve();
      await switched;
    });
    expect(useAppStore.getState().tools.currentTool).toBe(to);
    expect(options.stateMachine.finalizationComplete).toHaveBeenCalledTimes(1);
    toolbar.unmount();
  });

  it('shares pending E finalization with an overlapping toolbar transition', async () => {
    const options = createOptions();
    const pending = holdFinalization(options);
    const toolbar = renderHook(() => {
      useDrawingCanvasKeyboard(options);
      return useToolSwitcher();
    });
    await dispatchE('keydown');
    startStroke(options);
    now += 300;
    await dispatchE('keyup');
    let switched!: Promise<void>;
    await act(async () => { switched = toolbar.result.current('selection'); });

    expect(options.drawingHandlers.finalizeDrawing).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().tools.currentTool).toBe('eraser');
    await act(async () => pending.finalize.resolve());
    expect(useAppStore.getState().tools.currentTool).toBe('eraser');
    await act(async () => {
      pending.history.resolve();
      await switched;
    });
    expect(options.stateMachine.finalizationComplete).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().tools.currentTool).toBe('selection');
    toolbar.unmount();
  });

  it.each(['selection', 'brush'] as const)('cancels a pending E press when the toolbar selects %s', async (to) => {
    const options = createOptions();
    const pending = holdFinalization(options);
    const toolbar = renderHook(() => {
      useDrawingCanvasKeyboard(options);
      return useToolSwitcher();
    });
    startStroke(options);
    await dispatchE('keydown');
    let switched!: Promise<void>;
    await act(async () => { switched = toolbar.result.current(to); });

    expect(useAppStore.getState().tools.currentTool).toBe('brush');
    await act(async () => pending.finalize.resolve());
    expect(useAppStore.getState().tools.currentTool).toBe('brush');
    await act(async () => {
      pending.history.resolve();
      await switched;
    });
    expect(useAppStore.getState().tools.currentTool).toBe(to);
    now += 300;
    await dispatchE('keyup');
    expect(useAppStore.getState().tools.currentTool).toBe(to);
    expect(options.drawingHandlers.finalizeDrawing).toHaveBeenCalledTimes(1);
    toolbar.unmount();
  });

  it.each(['press', 'release'] as const)('lets native M supersede a pending E %s', async (phase) => {
    const options = createOptions();
    const pending = holdFinalization(options);
    const keyboard = renderHook(() => useDrawingCanvasKeyboard(options));
    if (phase === 'press') startStroke(options);
    await dispatchE('keydown');
    if (phase === 'release') {
      startStroke(options);
      now += 300;
      await dispatchE('keyup');
    }
    await act(async () => fireEvent.keyDown(window, { key: 'm', code: 'KeyM' }));
    const originalTool = phase === 'press' ? 'brush' : 'eraser';
    expect(useAppStore.getState().tools.currentTool).toBe(originalTool);
    await act(async () => pending.finalize.resolve());
    expect(useAppStore.getState().tools.currentTool).toBe(originalTool);
    await act(async () => pending.history.resolve());
    expect(useAppStore.getState().tools.currentTool).toBe('selection');
    await dispatchE('keyup');
    expect(useAppStore.getState().tools.currentTool).toBe('selection');
    expect(options.drawingHandlers.finalizeDrawing).toHaveBeenCalledTimes(1);
    keyboard.unmount();
  });

  it.each(['press', 'release'] as const)('revokes pending E %s inside the final tool-flush await', async (phase) => {
    const options = createOptions();
    const toolbar = renderHook(() => {
      useDrawingCanvasKeyboard(options);
      return useToolSwitcher();
    });
    if (phase === 'release') {
      await dispatchE('keydown');
      now += 300;
    }
    const gate = deferred();
    let enteredFlush = false;
    registerToolFlush(EXISTING_FINALIZATION_KEY, () => {
      enteredFlush = true;
      return gate.promise;
    });
    await dispatchE(phase === 'press' ? 'keydown' : 'keyup');
    expect(enteredFlush).toBe(true);
    const originalTool = phase === 'press' ? 'brush' : 'eraser';
    expect(useAppStore.getState().tools.currentTool).toBe(originalTool);
    const observedTools: string[] = [];
    const unsubscribe = useAppStore.subscribe((next, previous) => {
      if (next.tools.currentTool !== previous.tools.currentTool) observedTools.push(next.tools.currentTool);
    });
    let switched!: Promise<void>;
    await act(async () => { switched = toolbar.result.current('selection'); });
    await act(async () => {
      gate.resolve();
      await switched;
    });

    expect(observedTools).toEqual(['selection']);
    expect(useAppStore.getState().tools.currentTool).toBe('selection');
    unsubscribe();
    await dispatchE('keyup');
    toolbar.unmount();
  });

  it('revokes a pending E press when its keyboard owner unmounts', async () => {
    const options = createOptions();
    const pending = holdFinalization(options);
    const keyboard = renderHook(() => useDrawingCanvasKeyboard(options));
    startStroke(options);
    await dispatchE('keydown');
    keyboard.unmount();
    await act(async () => {
      pending.finalize.resolve();
      pending.history.resolve();
      await waitForPendingHistoryCommits();
    });

    expect(useAppStore.getState().tools.currentTool).toBe('brush');
    expect(options.drawingHandlers.finalizeDrawing).toHaveBeenCalledTimes(1);
  });

  it('leaves active erasing alone during passive flush and removes its registration on unmount', async () => {
    act(() => useAppStore.getState().setCurrentTool('eraser'));
    const options = createOptions();
    const keyboard = renderHook(() => useDrawingCanvasKeyboard(options));
    startStroke(options);

    await act(async () => flushPendingToolWork({ passiveOnly: true }));
    expect(options.drawingHandlers.finalizeDrawing).not.toHaveBeenCalled();
    expect(options.interactionStateRef.current.isDrawing).toBe(true);
    expect(options.suppressBootstrapUntilPointerUpRef.current).toBe(false);

    keyboard.unmount();
    await act(async () => flushPendingToolWork());
    expect(options.drawingHandlers.finalizeDrawing).not.toHaveBeenCalled();
  });

  it('waits queued history after an already-started pointerup finalization completes', async () => {
    act(() => useAppStore.getState().setCurrentTool('eraser'));
    const options = createOptions();
    const pending = holdFinalization(options);
    // The existing drawing-handlers registration waits a finalization already in flight.
    registerToolFlush(EXISTING_FINALIZATION_KEY, () => pending.finalize.promise);
    const toolbar = renderHook(() => {
      useDrawingCanvasKeyboard(options);
      return useToolSwitcher();
    });
    await act(async () => { void options.drawingHandlers.finalizeDrawing(); });
    let switched!: Promise<void>;
    await act(async () => { switched = toolbar.result.current('brush'); });

    expect(useAppStore.getState().tools.currentTool).toBe('eraser');
    await act(async () => pending.finalize.resolve());
    expect(useAppStore.getState().tools.currentTool).toBe('eraser');
    expect(options.drawingHandlers.finalizeDrawing).toHaveBeenCalledTimes(1);
    expect(options.suppressBootstrapUntilPointerUpRef.current).toBe(false);
    await act(async () => {
      pending.history.resolve();
      await switched;
    });
    expect(useAppStore.getState().tools.currentTool).toBe('brush');
    toolbar.unmount();
  });

  it('uses the current finalizer after rerender and switches idle tools without authoring', async () => {
    act(() => useAppStore.getState().setCurrentTool('eraser'));
    const options = createOptions();
    const toolbar = renderHook(({ currentOptions }) => {
      useDrawingCanvasKeyboard(currentOptions);
      return useToolSwitcher();
    }, { initialProps: { currentOptions: options } });
    await act(async () => toolbar.result.current('brush'));
    expect(options.drawingHandlers.finalizeDrawing).not.toHaveBeenCalled();
    expect(options.suppressBootstrapUntilPointerUpRef.current).toBe(false);

    const nextOptions = {
      ...options,
      drawingHandlers: {
        ...options.drawingHandlers,
        finalizeDrawing: jest.fn().mockResolvedValue(undefined),
      },
    };
    toolbar.rerender({ currentOptions: nextOptions });
    startStroke(nextOptions);
    await act(async () => toolbar.result.current('eraser'));

    expect(nextOptions.drawingHandlers.finalizeDrawing).toHaveBeenCalledTimes(1);
    expect(options.drawingHandlers.finalizeDrawing).not.toHaveBeenCalled();
    toolbar.unmount();
  });

  it.each([
    [BrushShape.SQUARE, true],
    [BrushShape.RECTANGLE_GRADIENT, false],
    [BrushShape.DITHER_GRADIENT, false],
    [BrushShape.SHAPE_FILL, false],
  ] as const)('leaves %s shapeMode=%s to the existing shape flusher', async (brushShape, shapeMode) => {
    act(() => useAppStore.setState(state => ({
      tools: { ...state.tools, shapeMode, brushSettings: { ...state.tools.brushSettings, brushShape } },
    })));
    const options = createOptions();
    const keyboard = renderHook(() => useDrawingCanvasKeyboard(options));
    startStroke(options);

    await act(async () => flushPendingToolWork());

    expect(options.drawingHandlers.finalizeDrawing).not.toHaveBeenCalled();
    expect(options.interactionDispatch).not.toHaveBeenCalled();
    expect(options.suppressBootstrapUntilPointerUpRef.current).toBe(false);
    keyboard.unmount();
  });
});
