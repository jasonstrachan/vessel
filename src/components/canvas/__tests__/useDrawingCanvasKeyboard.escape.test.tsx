import { act, renderHook } from '@testing-library/react';

import { useDrawingCanvasKeyboard } from '@/components/canvas/useDrawingCanvasKeyboard';
import historyManager from '@/history/historyService';
import { prepareHistoryDelta } from '@/history/actionTypes';
import { trackPendingHistoryCommit, waitForPendingHistoryCommits } from '@/history/pendingHistoryCommits';
import { registerToolFlush, unregisterToolFlush } from '@/utils/toolFlushRegistry';
import { captureSelectionSnapshot } from '@/history/helpers/selectionHistory';
import { useComprehensiveKeyboard } from '@/hooks/useComprehensiveKeyboard';
import { useAppStore } from '@/stores/useAppStore';

jest.mock('@/hooks/useComprehensiveKeyboard', () => ({
  useComprehensiveKeyboard: jest.fn(),
}));

const mockUseComprehensiveKeyboard =
  useComprehensiveKeyboard as jest.MockedFunction<typeof useComprehensiveKeyboard>;

type KeyboardOptions = Parameters<typeof useDrawingCanvasKeyboard>[0];

const mountKeyboard = (
  cancelActiveOperations = jest.fn(() => false),
  overrides: Partial<KeyboardOptions> = {},
) => {
  const canvas = document.createElement('canvas');
  jest.spyOn(canvas, 'getContext').mockImplementation(
    ((contextId: string) =>
      contextId === '2d' ? ({} as CanvasRenderingContext2D) : null) as HTMLCanvasElement['getContext']
  );
  const draw = jest.fn();
  const options: KeyboardOptions = {
    switchTool: jest.fn(),
    saveProject: jest.fn(),
    openProjectModal: jest.fn(),
    canUndo: jest.fn(),
    canRedo: jest.fn(),
    undo: jest.fn(),
    redo: jest.fn(),
    toolStateMachine: {
      completePolygonGradient: jest.fn(),
      polygonGradientState: { points: [] },
      isContourPolygon: false,
      resetPolygonGradient: jest.fn(),
    },
    drawingHandlers: {
      initDrawingCanvas: jest.fn(),
      drawingCanvasRef: { current: null },
      drawingCanvasHasContent: { current: false },
      finalizeDrawing: jest.fn(),
    },
    brushRuntime: null,
    layers: [],
    activeLayerId: null,
    tools: {
      currentTool: 'selection',
      brushSettings: {},
      shapeMode: false,
    },
    isColorCyclePlaybackActive: jest.fn(),
    wrappedStartAnimation: jest.fn(),
    compositeCanvasDirtyRef: { current: false },
    rebuildStaticComposite: jest.fn(),
    stateMachine: { finalizationComplete: jest.fn() },
    setNeedsRedraw: jest.fn(),
    cancelActiveOperations,
    interactionDispatch: jest.fn(),
    interactionStateRef: { current: { isDrawing: false } },
    isMouseDownRef: { current: false },
    suppressBootstrapUntilPointerUpRef: { current: false },
    canvasShapeEditor: { active: false, draft: null },
    commitCanvasShape: jest.fn(),
    cancelCanvasShapeEdit: jest.fn(),
    colorAdjustActive: false,
    applyColorAdjust: jest.fn(),
    crop: { marquee: null, commitInFlight: false },
    commitCrop: jest.fn(),
    finalizeActiveShape: jest.fn(),
    floatingPaste: null,
    commitFloatingPaste: jest.fn(),
    canvasRef: { current: canvas },
    draw,
    viewTransformRef: { current: { scale: 1, offsetX: 0, offsetY: 0 } },
    cancelColorAdjust: jest.fn(),
    previousTool: null,
    cancelCrop: jest.fn(),
    ...overrides,
  };

  renderHook(() => useDrawingCanvasKeyboard(options));
  const onEscapePressed = mockUseComprehensiveKeyboard.mock.calls.at(-1)?.[0].onEscapePressed;
  return { options, onEscapePressed, draw };
};

const seedSelection = (masked = false) => {
  useAppStore.getState().setSelectionBounds(
    { x: 4, y: 5 }, { x: 10, y: 12 }, 'selection-marquee-final',
  );
  if (masked) {
    const mask = new ImageData(6, 7);
    mask.data[3] = 255;
    mask.data[7] = 80;
    useAppStore.setState({
      selectionMask: mask,
      selectionMaskBounds: { x: 4, y: 5, width: 6, height: 7 },
      selectionMaskLayerId: 'mask-owner',
      selectionVectorPath: {
        mode: 'freehand',
        points: [{ x: 4, y: 5 }, { x: 10, y: 5 }, { x: 4, y: 12 }],
      },
    });
  }
  return captureSelectionSnapshot();
};

const expectClearedSelection = () => {
  expect(useAppStore.getState()).toMatchObject({
    selectionStart: null,
    selectionEnd: null,
    selectionMask: null,
    selectionMaskBounds: null,
    selectionMaskLayerId: null,
    selectionVectorPath: null,
    selectionLastAction: null,
  });
};

describe('useDrawingCanvasKeyboard Escape', () => {
  beforeEach(() => {
    mockUseComprehensiveKeyboard.mockClear();
    historyManager.clear();
    useAppStore.getState().clearSelection();
  });

  afterEach(() => {
    historyManager.clear();
    useAppStore.getState().clearSelection();
    jest.restoreAllMocks();
  });

  it('cancels a floating paste without synchronously redrawing the stale paste', async () => {
    const cancelActiveOperations = jest.fn(() => true);
    const { onEscapePressed, draw } = mountKeyboard(cancelActiveOperations, { floatingPaste: { active: true } });

    await onEscapePressed?.();

    expect(cancelActiveOperations).toHaveBeenCalledWith({
      includeFloatingPaste: true,
      dispatchInteractionEnd: true,
    });
    expect(draw).not.toHaveBeenCalled();
  });

  it.each([false, true])('clears a completed selection and replays its exact shape (masked %s)', async masked => {
    const before = seedSelection(masked);
    const { onEscapePressed, options, draw } = mountKeyboard();

    await onEscapePressed?.();

    expectClearedSelection();
    expect(historyManager.entries()).toHaveLength(1);
    expect(historyManager.peekUndo()?.action).toBe('selection-change');
    expect(options.setNeedsRedraw).toHaveBeenCalledTimes(1);
    expect(draw).not.toHaveBeenCalled();

    await onEscapePressed?.();
    expect(historyManager.entries()).toHaveLength(1);
    expect(options.setNeedsRedraw).toHaveBeenCalledTimes(1);

    await historyManager.undo();
    expect(captureSelectionSnapshot()).toEqual({
      ...before,
      provenance: {
        ...before.provenance,
        source: 'history-selection-backward',
        ownerKind: 'history-restored',
        restoredFromHistory: true,
        restoredOwnerKind: before.provenance?.ownerKind,
        maskLayerId: before.provenance?.maskLayerId ?? before.maskLayerId ?? null,
      },
    });
    await historyManager.redo();
    expectClearedSelection();
  });

  it('leaves a selection restored by active-operation cancellation intact', async () => {
    let restored: ReturnType<typeof captureSelectionSnapshot> | undefined;
    const cancelActiveOperations = jest.fn(() => {
      restored = seedSelection(true);
      return true;
    });
    const { onEscapePressed, options } = mountKeyboard(cancelActiveOperations);

    await onEscapePressed?.();

    expect(captureSelectionSnapshot()).toEqual(restored);
    expect(historyManager.entries()).toHaveLength(0);
    expect(options.setNeedsRedraw).not.toHaveBeenCalled();
  });

  it('waits for passive finalization and its queued history before deselecting', async () => {
    const before = seedSelection(true);
    const { onEscapePressed, options } = mountKeyboard();
    let releaseFinalize!: () => void;
    let releaseHistory!: () => void;
    let markFinalized!: () => void;
    const finalization = new Promise<void>(resolve => { releaseFinalize = resolve; });
    const finalized = new Promise<void>(resolve => { markFinalized = resolve; });
    const history = new Promise<void>(resolve => { releaseHistory = resolve; }).then(() => {
      const txn = historyManager.begin('brush-stroke');
      txn.push({
        _tag: 'pending-stroke-fixture',
        prepare: () => prepareHistoryDelta('pending-stroke-fixture', () => {}, () => false, () => {}),
      });
      txn.commit('Pending source stroke');
    });
    const activeShapeFlush = jest.fn();
    const passiveKey = 'test:escape-passive-finalization';
    const shapeKey = 'test:escape-must-not-finalize-shape';
    registerToolFlush(passiveKey, async () => {
      await finalization;
      trackPendingHistoryCommit(history);
      markFinalized();
    });
    registerToolFlush(shapeKey, activeShapeFlush, { passive: false });
    let pendingEscape: Promise<void> | undefined;
    try {
      pendingEscape = Promise.resolve(onEscapePressed?.());
      expect(captureSelectionSnapshot()).toEqual(before);
      expect(historyManager.entries()).toHaveLength(0);

      await act(async () => { releaseFinalize(); await finalized; });
      expect(captureSelectionSnapshot()).toEqual(before);
      expect(historyManager.entries()).toHaveLength(0);
      expect(options.setNeedsRedraw).not.toHaveBeenCalled();
      expect(activeShapeFlush).not.toHaveBeenCalled();

      await act(async () => { releaseHistory(); await pendingEscape; });
      expectClearedSelection();
      expect(historyManager.entries().map(entry => entry.label)).toEqual(['Pending source stroke', 'Clear selection']);
      await historyManager.undo();
      expect(captureSelectionSnapshot().mask?.data).toEqual(before.mask?.data);
      expect(historyManager.peekUndo()?.label).toBe('Pending source stroke');
    } finally {
      unregisterToolFlush(passiveKey);
      unregisterToolFlush(shapeKey);
      await act(async () => { releaseFinalize(); releaseHistory(); await history; await pendingEscape; await waitForPendingHistoryCommits(); });
    }
  });

  it('does nothing when there is no selection or active operation', async () => {
    const { onEscapePressed, options } = mountKeyboard();

    await onEscapePressed?.();

    expectClearedSelection();
    expect(historyManager.entries()).toHaveLength(0);
    expect(options.setNeedsRedraw).not.toHaveBeenCalled();
  });

  it.each(['canvas-shape', 'crop', 'color-adjust'] as const)(
    'keeps the selection when Escape belongs to %s', async mode => {
      const before = seedSelection(true);
      const cancelActiveOperations = jest.fn(() => false);
      const { onEscapePressed, options } = mountKeyboard(cancelActiveOperations, {
        canvasShapeEditor: { active: mode === 'canvas-shape', draft: null },
        tools: {
          currentTool: mode === 'canvas-shape' ? 'selection' : mode,
          brushSettings: {},
          shapeMode: false,
        },
        colorAdjustActive: mode === 'color-adjust',
      });

      await onEscapePressed?.();

      expect(captureSelectionSnapshot()).toEqual(before);
      expect(historyManager.entries()).toHaveLength(0);
      expect(cancelActiveOperations).not.toHaveBeenCalled();
      if (mode === 'canvas-shape') {
        expect(options.cancelCanvasShapeEdit).toHaveBeenCalledTimes(1);
      } else if (mode === 'crop') {
        expect(options.cancelCrop).toHaveBeenCalledTimes(1);
      } else {
        expect(options.cancelColorAdjust).toHaveBeenCalledTimes(1);
      }
    },
  );
});
