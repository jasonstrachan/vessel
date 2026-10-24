import { act, renderHook } from '@testing-library/react';

import { useDrawingCanvasRectangleGradientFinalize } from '@/components/canvas/useDrawingCanvasRectangleGradientFinalize';
import { useToolStateMachine } from '@/hooks/useToolStateMachine';
import { useAppStore } from '@/stores/useAppStore';
import { BrushShape, type Tool } from '@/types';

type ShapeFlags = Pick<
  ReturnType<typeof useToolStateMachine>,
  'isRectangleGradient' | 'isPolygonGradient' | 'isColorCycleShape' | 'isContourPolygon'
>;

const inactiveFlags: ShapeFlags = {
  isRectangleGradient: false,
  isPolygonGradient: false,
  isColorCycleShape: false,
  isContourPolygon: false,
};

const shapeCases: Array<[BrushShape, keyof ShapeFlags]> = [
  [BrushShape.RECTANGLE_GRADIENT, 'isRectangleGradient'],
  [BrushShape.POLYGON_GRADIENT, 'isPolygonGradient'],
  [BrushShape.COLOR_CYCLE_SHAPE, 'isColorCycleShape'],
  [BrushShape.CONTOUR_POLYGON, 'isContourPolygon'],
  [BrushShape.CONTOUR_LINES2, 'isContourPolygon'],
];

const flags = (machine: ReturnType<typeof useToolStateMachine>): ShapeFlags => ({
  isRectangleGradient: machine.isRectangleGradient,
  isPolygonGradient: machine.isPolygonGradient,
  isColorCycleShape: machine.isColorCycleShape,
  isContourPolygon: machine.isContourPolygon,
});

describe('useToolStateMachine brush shape ownership', () => {
  const originalState = useAppStore.getState();

  afterEach(() => {
    act(() => useAppStore.setState(originalState, true));
  });

  it.each(shapeCases)('%s workflows follow the active brush tool', (brushShape, activeFlag) => {
    act(() => {
      useAppStore.setState(state => ({
        currentBrushPreset: null,
        tools: {
          ...state.tools,
          currentTool: 'brush',
          brushSettings: { ...state.tools.brushSettings, brushShape },
        },
      }));
    });
    const sampleColorAtPosition = () => '#112233';
    const { result } = renderHook(() => useToolStateMachine({ sampleColorAtPosition }));
    const initialHandlers = {
      rectangleDown: result.current.handleRectangleGradientMouseDown,
      polygonDown: result.current.handlePolygonGradientMouseDown,
    };

    expect(flags(result.current)).toEqual({ ...inactiveFlags, [activeFlag]: true });

    for (const tool of ['eraser', 'selection'] satisfies Tool[]) {
      act(() => useAppStore.getState().setCurrentTool(tool));
      expect(useAppStore.getState().tools.brushSettings.brushShape).toBe(brushShape);
      expect(flags(result.current)).toEqual(inactiveFlags);

      act(() => useAppStore.getState().setCurrentTool('brush'));
      expect(useAppStore.getState().tools.brushSettings.brushShape).toBe(brushShape);
      expect(flags(result.current)).toEqual({ ...inactiveFlags, [activeFlag]: true });
      expect(result.current.handleRectangleGradientMouseDown).toBe(initialHandlers.rectangleDown);
      expect(result.current.handlePolygonGradientMouseDown).toBe(initialHandlers.polygonDown);
    }
  });
});

describe('rectangle gradient gesture geometry', () => {
  const originalState = useAppStore.getState();

  afterEach(() => {
    act(() => useAppStore.setState(originalState, true));
  });

  const mountWorkflow = () => {
    act(() => {
      useAppStore.setState(state => ({
        tools: { ...state.tools, currentTool: 'brush', brushSettings: {
          ...state.tools.brushSettings, brushShape: BrushShape.RECTANGLE_GRADIENT,
        } },
        rectangleBrushState: {
          drawingState: 'idle', startPos: { x: 0, y: 0 }, endPos: { x: 0, y: 0 },
          currentPos: { x: 0, y: 0 }, width: 0, startColor: '#000000', endColor: '#ffffff',
        },
        canvas: { ...state.canvas, cursor: { x: 1000, y: 900, pressure: 0 } },
      }));
    });
    const canvas = document.createElement('canvas');
    const drawRectangleGradient = jest.fn();
    const finalizeDrawing = jest.fn().mockResolvedValue(undefined);
    const drawingHandlers = {
      initDrawingCanvas: jest.fn(), drawingCanvasRef: { current: canvas },
      drawingCanvasHasContent: { current: false }, finalizeDrawing,
    };
    const { result } = renderHook(() => {
      const machine = useToolStateMachine({ sampleColorAtPosition: () => '#112233' });
      const finalize = useDrawingCanvasRectangleGradientFinalize({
        brushRuntime: { drawRectangleGradient }, toolStateMachine: machine,
        drawingHandlers, interactionDispatch: jest.fn(),
        tools: { brushSettings: { color: '#000000', colors: 2 } },
        sampleColorsAlongLine: () => ['#000000', '#ffffff'], resampleStopsToColors: () => [],
        compositeCanvasDirtyRef: { current: false }, rebuildStaticComposite: () => true,
        setNeedsRedraw: jest.fn(), overlayCanvasRef: { current: null },
        stateMachine: { finalizationComplete: jest.fn() },
      });
      return { machine, finalize };
    });
    const axis = (start = { x: 64, y: 128 }, end = { x: 192, y: 128 }) => {
      act(() => {
        result.current.machine.handleRectangleGradientMouseDown(start);
        result.current.machine.handleRectangleGradientMouseMove(end);
        result.current.machine.handleRectangleGradientMouseUp();
      });
    };
    return { result, axis, drawRectangleGradient, finalizeDrawing };
  };

  it.each(['fresh', 'committed', 'cancelled'] as const)(
    'keeps a zero-move endpoint local to the %s gesture', async prior => {
      const { result, axis, drawRectangleGradient, finalizeDrawing } = mountWorkflow();
      if (prior !== 'fresh') {
        axis();
        if (prior === 'committed') await act(async () => { await result.current.finalize(); });
        else act(() => result.current.machine.resetRectangleGradient());
        drawRectangleGradient.mockClear();
        finalizeDrawing.mockClear();
      }
      const contact = { x: 112, y: 112 };
      act(() => {
        result.current.machine.handleRectangleGradientMouseDown(contact);
        result.current.machine.handleRectangleGradientMouseUp();
      });
      expect(useAppStore.getState().rectangleBrushState).toMatchObject({
        drawingState: 'definingWidth', startPos: contact, endPos: contact, width: 0,
      });
      await act(async () => { expect(await result.current.finalize()).toBe(false); });
      expect(drawRectangleGradient).not.toHaveBeenCalled();
      expect(finalizeDrawing).not.toHaveBeenCalled();
      expect(useAppStore.getState().rectangleBrushState.drawingState).toBe('idle');
    },
  );

  it('retains exact sub-threshold axis movement through the endpoint ref', () => {
    const { result } = mountWorkflow();
    act(() => {
      result.current.machine.handleRectangleGradientMouseDown({ x: 112, y: 112 });
      result.current.machine.handleRectangleGradientMouseMove({ x: 113, y: 114 });
      result.current.machine.handleRectangleGradientMouseUp();
    });
    expect(useAppStore.getState().rectangleBrushState.endPos).toEqual({ x: 113, y: 114 });
  });

  it.each([
    [{ x: 64, y: 128 }, { x: 192, y: 128 }, { x: 128, y: 160 }, 64],
    [{ x: 192, y: 128 }, { x: 64, y: 128 }, { x: 128, y: 96 }, 64],
    [{ x: 64, y: 64 }, { x: 128, y: 128 }, { x: 64, y: 128 }, 64 * Math.SQRT2],
  ] as const)('commits gesture-owned perpendicular width for axis %j -> %j', async (start, end, hover, width) => {
    const { result, axis, drawRectangleGradient, finalizeDrawing } = mountWorkflow();
    axis(start, end);
    act(() => { result.current.machine.handleRectangleGradientMouseMove(hover); });
    expect(useAppStore.getState().rectangleBrushState.currentPos).toEqual(hover);
    expect(useAppStore.getState().rectangleBrushState.width).toBeCloseTo(width);
    await act(async () => { expect(await result.current.finalize()).toBe(true); });
    expect(drawRectangleGradient).toHaveBeenCalledTimes(1);
    expect(drawRectangleGradient.mock.calls[0].slice(1, 5)).toEqual([start.x, start.y, end.x, end.y]);
    expect(drawRectangleGradient.mock.calls[0][5]).toBeCloseTo(width);
    expect(finalizeDrawing).toHaveBeenCalledWith(false);
    expect(useAppStore.getState().rectangleBrushState).toMatchObject({
      drawingState: 'idle', width: 0, currentPos: { x: 0, y: 0 },
    });
  });

  it.each([
    [{ x: 128, y: 160 }, 64],
    [{ x: 128, y: 128 }, 1],
  ] as const)('uses world position %j for width fallback and keeps the minimum', async (currentPos, width) => {
    const { result, axis, drawRectangleGradient } = mountWorkflow();
    axis();
    act(() => useAppStore.getState().setRectangleBrushState({ currentPos, width: 0 }));
    await act(async () => { expect(await result.current.finalize()).toBe(true); });
    expect(drawRectangleGradient.mock.calls[0][5]).toBeCloseTo(width);
  });
});
