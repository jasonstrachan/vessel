import type React from 'react';
import { createKeyboardHandlers } from '@/hooks/canvas/handlers/keyboardHandlers';
import { useAppStore } from '@/stores/useAppStore';

jest.mock('@/stores/useAppStore', () => ({
  useAppStore: {
    getState: jest.fn(),
    setState: jest.fn(),
  },
}));

const mockedUseAppStore = useAppStore as unknown as {
  getState: jest.Mock;
  setState: jest.Mock;
};

type KeyboardDeps = Parameters<typeof createKeyboardHandlers>[0];

const createDeps = (): KeyboardDeps => {
  const dispatch = jest.fn();
  const endPan = jest.fn(() => {
    (deps.pan.panState as { isPanning: boolean }).isPanning = false;
  });
  const overlayCanvas = document.createElement('canvas');
  overlayCanvas.width = 100;
  overlayCanvas.height = 100;
  const overlayClearRect = jest.fn();
  overlayCanvas.getContext = jest.fn(() => ({ clearRect: overlayClearRect })) as unknown as typeof overlayCanvas.getContext;
  const canvas = document.createElement('canvas');
  canvas.width = 100;
  canvas.height = 100;
  const drawContext = {} as CanvasRenderingContext2D;
  canvas.getContext = jest.fn(() => drawContext) as unknown as typeof canvas.getContext;

  const deps = {
    isSpacePressedRef: { current: false },
    setIsSpacePressed: jest.fn(),
    setShowBrushCursor: jest.fn(),
    setCursorStyle: jest.fn(),
    isMouseDownRef: { current: false },
    mousePositionRef: { current: { x: 12, y: 34 } },
    pan: {
      panState: {
        isPanning: false,
      },
      startPan: jest.fn(),
      endPan,
    },
    pauseAnimationForPan: jest.fn(),
    resumeAnimationAfterPan: jest.fn(),
    stateMachine: {
      state: { isSpacePressed: false },
      dispatch,
    },
    wrapperRef: { current: document.createElement('div') },
    canvasRef: { current: canvas },
    overlayCanvasRef: { current: overlayCanvas },
    dynamicDepsRef: {
      current: {
        tools: { currentTool: 'brush', selectionMode: 'marquee' },
        project: null,
        canvas: null,
        layers: [],
        activeLayerId: null,
        selectionStart: null,
        selectionEnd: null,
        selectionMask: null,
        selectionMaskBounds: null,
        floatingPaste: null,
        isDraggingFloatingPaste: false,
        palette: { activeSlot: 'foreground', foregroundColor: '#000', backgroundColor: '#fff' },
        polygonGradientState: { drawingState: 'idle' },
        recolorSampling: { active: false, start: null, end: null, samples: 0, target: 'recolor' },
        currentBrushPresetId: null,
      } as unknown,
    },
    selectionRuntimeRef: {
      current: {
        pendingSelectionHistory: null,
        freehandSession: { active: false, points: [] },
        clickLineSession: { active: false, points: [] },
      },
    },
    setNeedsRedraw: jest.fn(),
    draw: jest.fn(),
    viewTransformRef: { current: { scale: 1, offsetX: 0, offsetY: 0 } },
    defaultCursorStyle: 'crosshair',
    isPointerInsideCanvas: jest.fn(() => true),
  } as unknown as KeyboardDeps;

  return deps;
};

describe('createKeyboardHandlers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseAppStore.getState.mockReturnValue({
      ui: { keyboardScope: { active: 'canvas' } },
      brushEditor: { status: 'IDLE' },
      clearSelection: jest.fn(),
    });
  });

  it('sets space state on keydown and dispatches SPACE_DOWN', () => {
    const deps = createDeps();
    const handlers = createKeyboardHandlers(deps);

    handlers.handleKeyDown(new KeyboardEvent('keydown', { code: 'Space' }));

    expect(deps.isSpacePressedRef.current).toBe(true);
    expect(deps.setIsSpacePressed).toHaveBeenCalledWith(true);
    expect(deps.stateMachine.dispatch).toHaveBeenCalledWith({ type: 'SPACE_DOWN' });
    expect(deps.setCursorStyle).toHaveBeenCalledWith('grab');
  });

  it('releases stuck space on keyup even when scope no longer allows space', () => {
    const deps = createDeps();
    const handlers = createKeyboardHandlers(deps);

    deps.isSpacePressedRef.current = true;
    (deps.pan.panState as { isPanning: boolean }).isPanning = true;
    deps.stateMachine.state.isSpacePressed = true;
    mockedUseAppStore.getState.mockReturnValue({
      ui: { keyboardScope: { active: 'modal' } },
      brushEditor: { status: 'IDLE' },
    });

    handlers.handleKeyUp(new KeyboardEvent('keyup', { code: 'Space' }));

    expect(deps.isSpacePressedRef.current).toBe(false);
    expect(deps.pan.endPan).toHaveBeenCalledTimes(1);
    expect(deps.stateMachine.dispatch).toHaveBeenCalledWith({ type: 'SPACE_UP' });
    expect(deps.setCursorStyle).toHaveBeenCalledWith('crosshair');
  });

  it('releases space on blur based on ref state even if stateMachine is stale', () => {
    const deps = createDeps();
    const handlers = createKeyboardHandlers(deps);

    deps.isSpacePressedRef.current = true;
    deps.stateMachine.state.isSpacePressed = false;

    handlers.handleBlur({ relatedTarget: null } as unknown as React.FocusEvent);

    expect(deps.isSpacePressedRef.current).toBe(false);
    expect(deps.setCursorStyle).toHaveBeenCalledWith('crosshair');
  });

  it('finalizes click-line selection on Enter', () => {
    const deps = createDeps();
    const handlers = createKeyboardHandlers(deps);

    deps.dynamicDepsRef.current.tools.currentTool = 'selection';
    deps.dynamicDepsRef.current.tools.selectionMode = 'click-line';
    deps.dynamicDepsRef.current.project = { width: 200, height: 200 } as unknown as typeof deps.dynamicDepsRef.current.project;
    deps.dynamicDepsRef.current.activeLayerId = 'layer-1';
    deps.selectionRuntimeRef.current.pendingSelectionHistory = {
      before: { start: null, end: null, mask: null, maskBounds: null, maskLayerId: null } as unknown as
        NonNullable<typeof deps.selectionRuntimeRef.current.pendingSelectionHistory>['before'],
      description: 'Create selection',
    };
    deps.selectionRuntimeRef.current.clickLineSession = {
      active: true,
      points: [
        { x: 10, y: 10 },
        { x: 20, y: 10 },
        { x: 20, y: 20 },
      ],
    };

    handlers.handleKeyDown(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter' }));

    expect(deps.selectionRuntimeRef.current.clickLineSession.active).toBe(false);
    expect(deps.selectionRuntimeRef.current.clickLineSession.points).toHaveLength(0);
    expect(deps.setNeedsRedraw).toHaveBeenCalled();
    expect(deps.draw).toHaveBeenCalled();
  });

  it('cancels click-line selection on Escape', () => {
    const deps = createDeps();
    const handlers = createKeyboardHandlers(deps);

    deps.dynamicDepsRef.current.tools.currentTool = 'selection';
    deps.dynamicDepsRef.current.tools.selectionMode = 'click-line';
    deps.selectionRuntimeRef.current.pendingSelectionHistory = {
      before: { start: null, end: null, mask: null, maskBounds: null, maskLayerId: null } as unknown as
        NonNullable<typeof deps.selectionRuntimeRef.current.pendingSelectionHistory>['before'],
      description: 'Create selection',
    };
    deps.selectionRuntimeRef.current.clickLineSession = {
      active: true,
      points: [{ x: 10, y: 10 }],
    };

    handlers.handleKeyDown(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape' }));

    expect(deps.selectionRuntimeRef.current.clickLineSession.active).toBe(false);
    expect(deps.selectionRuntimeRef.current.clickLineSession.points).toHaveLength(0);
    expect(deps.selectionRuntimeRef.current.pendingSelectionHistory).toBeNull();
    expect(deps.setNeedsRedraw).toHaveBeenCalled();
  });
});
