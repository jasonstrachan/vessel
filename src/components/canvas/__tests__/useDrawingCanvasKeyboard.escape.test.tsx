import { renderHook } from '@testing-library/react';

import { useDrawingCanvasKeyboard } from '@/components/canvas/useDrawingCanvasKeyboard';
import { useComprehensiveKeyboard } from '@/hooks/useComprehensiveKeyboard';

jest.mock('@/hooks/useComprehensiveKeyboard', () => ({
  useComprehensiveKeyboard: jest.fn(),
}));

const mockUseComprehensiveKeyboard =
  useComprehensiveKeyboard as jest.MockedFunction<typeof useComprehensiveKeyboard>;

describe('useDrawingCanvasKeyboard Escape', () => {
  it('cancels a floating paste without synchronously redrawing the stale paste', () => {
    const canvas = document.createElement('canvas');
    jest.spyOn(canvas, 'getContext').mockImplementation(
      ((contextId: string) =>
        contextId === '2d' ? ({} as CanvasRenderingContext2D) : null) as HTMLCanvasElement['getContext']
    );
    const cancelActiveOperations = jest.fn(() => true);
    const draw = jest.fn();
    const options = {
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
        currentTool: 'select',
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
      canvasShapeEditor: { active: false, draft: null },
      commitCanvasShape: jest.fn(),
      cancelCanvasShapeEdit: jest.fn(),
      colorAdjustActive: false,
      applyColorAdjust: jest.fn(),
      crop: { marquee: null, commitInFlight: false },
      commitCrop: jest.fn(),
      finalizeActiveShape: jest.fn(),
      floatingPaste: { active: true },
      commitFloatingPaste: jest.fn(),
      canvasRef: { current: canvas },
      draw,
      viewTransformRef: { current: { scale: 1, offsetX: 0, offsetY: 0 } },
      cancelColorAdjust: jest.fn(),
      previousTool: null,
      cancelCrop: jest.fn(),
    } as unknown as Parameters<typeof useDrawingCanvasKeyboard>[0];

    renderHook(() => useDrawingCanvasKeyboard(options));
    const onEscapePressed = mockUseComprehensiveKeyboard.mock.calls[0]?.[0].onEscapePressed;

    onEscapePressed?.();

    expect(cancelActiveOperations).toHaveBeenCalledWith({
      includeFloatingPaste: true,
      dispatchInteractionEnd: true,
    });
    expect(draw).not.toHaveBeenCalled();
  });
});
