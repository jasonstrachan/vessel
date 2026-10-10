import { act, renderHook } from '@testing-library/react';

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
