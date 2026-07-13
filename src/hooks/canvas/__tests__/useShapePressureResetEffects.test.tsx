import { act, renderHook } from '@testing-library/react';
import { useRef } from 'react';

import { useShapePressureResetEffects } from '@/hooks/canvas/useShapePressureResetEffects';
import {
  beginMarkGradientSession,
  cancelMarkGradientSession,
  getActiveMarkGradientSession,
} from '@/hooks/canvas/utils/colorCycleMarkSession';
import { useAppStore, type AppState } from '@/stores/useAppStore';
import { BrushShape, type Layer } from '@/types';

const makeLayer = (id: string, layerType: Layer['layerType']): Layer => ({
  id,
  name: id,
  visible: true,
  opacity: 1,
  blendMode: 'normal' as Layer['blendMode'],
  locked: false,
  order: 0,
  imageData: null,
  framebuffer: document.createElement('canvas'),
  alignment: {} as Layer['alignment'],
  layerType,
});

const setClickLineToolState = (): void => {
  useAppStore.setState((state) => ({
    ...state,
    layers: [
      makeLayer('cc-a', 'color-cycle'),
      makeLayer('cc-b', 'color-cycle'),
      makeLayer('normal-a', 'normal'),
    ],
    activeLayerId: 'cc-a',
    currentBrushPreset: {
      id: 'color-cycle-gradient',
      name: 'CC Gradient',
    } as AppState['currentBrushPreset'],
    shapeState: {
      ...state.shapeState,
      isDrawing: true,
    },
    tools: {
      ...state.tools,
      currentTool: 'brush',
      previousTool: 'brush',
      shapeMode: true,
      brushSettings: {
        ...state.tools.brushSettings,
        brushShape: BrushShape.COLOR_CYCLE_SHAPE,
        ccGradientDrawingShape: 'click-line',
      },
    },
  }));
};

const resetToolState = (): void => {
  useAppStore.setState((state) => ({
    ...state,
    layers: [],
    activeLayerId: null,
    currentBrushPreset: null,
    shapeState: {
      ...state.shapeState,
      isDrawing: false,
    },
    tools: {
      ...state.tools,
      currentTool: 'brush',
      previousTool: 'brush',
      shapeMode: false,
      brushSettings: {
        ...state.tools.brushSettings,
        brushShape: BrushShape.SQUARE,
        ccGradientDrawingShape: 'polygon',
      },
    },
  }));
};

describe('useShapePressureResetEffects', () => {
  beforeEach(() => {
    setClickLineToolState();
  });

  afterEach(() => {
    cancelMarkGradientSession('cc-a');
    cancelMarkGradientSession('cc-b');
    resetToolState();
  });

  it('clears an active CC Gradient click-line session when leaving the brush tool', () => {
    const resetShapePressureState = jest.fn();
    const resetShapeDragRefs = jest.fn();

    const { result, unmount } = renderHook(() => {
      const strokeBoundingBoxRef = useRef(null);
      const strokeCapturePaddingRef = useRef(0);
      const shapePointsRef = useRef([{ x: 1, y: 1 }]);
      const ccStrokeDirectionRef = useRef<{ x: number; y: number } | null>({ x: 1, y: 0 });
      const ccGradientDrawingGeometryRef = useRef({
        shapePoints: [{ x: 1, y: 1 }],
        sampleSourcePoints: [{ x: 1, y: 1 }],
        bounds: { minX: 1, minY: 1, maxX: 1, maxY: 1 },
      });
      const ccGradientClickLineSessionRef = useRef({
        active: true,
        points: [{ x: 1, y: 1 }],
        previewPoint: { x: 2, y: 2 },
      });
      const isDrawingShapeRef = useRef(true);
      const shapeInteractionPhaseRef = useRef<'idle' | 'drawing' | 'finalizing'>('drawing');

      useShapePressureResetEffects({
        resetShapePressureState,
        resetShapeDragRefs,
        strokeBoundingBoxRef,
        strokeCapturePaddingRef,
        shapePointsRef,
        ccStrokeDirectionRef,
        ccGradientDrawingGeometryRef,
        ccGradientClickLineSessionRef,
        isDrawingShapeRef,
        shapeInteractionPhaseRef,
      });

      return {
        ccGradientClickLineSessionRef,
        ccGradientDrawingGeometryRef,
        ccStrokeDirectionRef,
        isDrawingShapeRef,
        shapeInteractionPhaseRef,
        shapePointsRef,
      };
    });

    act(() => {
      useAppStore.getState().setCurrentTool('eraser');
    });

    expect(result.current.ccGradientClickLineSessionRef.current).toEqual({
      active: false,
      points: [],
      previewPoint: null,
    });
    expect(result.current.shapePointsRef.current).toEqual([]);
    expect(result.current.ccStrokeDirectionRef.current).toBeNull();
    expect(result.current.ccGradientDrawingGeometryRef.current).toBeNull();
    expect(result.current.isDrawingShapeRef.current).toBe(false);
    expect(result.current.shapeInteractionPhaseRef.current).toBe('idle');
    expect(useAppStore.getState().shapeState.isDrawing).toBe(false);
    expect(resetShapeDragRefs).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('does not recurse when clearing shape drawing from a store subscription', () => {
    const resetShapePressureState = jest.fn();
    const resetShapeDragRefs = jest.fn();

    const { result, unmount } = renderHook(() => {
      const strokeBoundingBoxRef = useRef(null);
      const strokeCapturePaddingRef = useRef(0);
      const shapePointsRef = useRef([{ x: 1, y: 1 }]);
      const ccStrokeDirectionRef = useRef<{ x: number; y: number } | null>({ x: 1, y: 0 });
      const ccGradientDrawingGeometryRef = useRef({
        shapePoints: [{ x: 1, y: 1 }],
        sampleSourcePoints: [{ x: 1, y: 1 }],
        bounds: { minX: 1, minY: 1, maxX: 1, maxY: 1 },
      });
      const ccGradientClickLineSessionRef = useRef({
        active: true,
        points: [{ x: 1, y: 1 }],
        previewPoint: { x: 2, y: 2 },
      });
      const isDrawingShapeRef = useRef(true);
      const shapeInteractionPhaseRef = useRef<'idle' | 'drawing' | 'finalizing'>('drawing');

      useShapePressureResetEffects({
        resetShapePressureState,
        resetShapeDragRefs,
        strokeBoundingBoxRef,
        strokeCapturePaddingRef,
        shapePointsRef,
        ccStrokeDirectionRef,
        ccGradientDrawingGeometryRef,
        ccGradientClickLineSessionRef,
        isDrawingShapeRef,
        shapeInteractionPhaseRef,
      });

      return {
        ccGradientClickLineSessionRef,
      };
    });

    expect(() => {
      act(() => {
        useAppStore.setState((state) => ({
          ...state,
          canvas: {
            ...state.canvas,
            zoom: (state.canvas?.zoom ?? 1) + 0.25,
          },
        }));
      });
    }).not.toThrow();

    expect(result.current.ccGradientClickLineSessionRef.current.active).toBe(false);
    expect(useAppStore.getState().shapeState.isDrawing).toBe(false);
    expect(resetShapeDragRefs).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('clears an active CC Gradient click-line session when the active layer changes', () => {
    const resetShapePressureState = jest.fn();
    const resetShapeDragRefs = jest.fn();
    const firstMarkSession = beginMarkGradientSession({
      layerId: 'cc-a',
      markKind: 'shape',
      gradientKind: 'linear',
      source: 'sampled',
      stops: [
        { position: 0, color: '#000000' },
        { position: 1, color: '#ffffff' },
      ],
    });
    expect(firstMarkSession).not.toBeNull();

    const { result, unmount } = renderHook(() => {
      const strokeBoundingBoxRef = useRef(null);
      const strokeCapturePaddingRef = useRef(0);
      const shapePointsRef = useRef([{ x: 1, y: 1 }]);
      const ccStrokeDirectionRef = useRef<{ x: number; y: number } | null>({ x: 1, y: 0 });
      const ccGradientDrawingGeometryRef = useRef({
        shapePoints: [{ x: 1, y: 1 }],
        sampleSourcePoints: [{ x: 1, y: 1 }],
        bounds: { minX: 1, minY: 1, maxX: 1, maxY: 1 },
      });
      const ccGradientClickLineSessionRef = useRef({
        active: true,
        points: [{ x: 1, y: 1 }],
        previewPoint: { x: 2, y: 2 },
      });
      const isDrawingShapeRef = useRef(true);
      const shapeInteractionPhaseRef = useRef<'idle' | 'drawing' | 'finalizing'>('drawing');

      useShapePressureResetEffects({
        resetShapePressureState,
        resetShapeDragRefs,
        strokeBoundingBoxRef,
        strokeCapturePaddingRef,
        shapePointsRef,
        ccStrokeDirectionRef,
        ccGradientDrawingGeometryRef,
        ccGradientClickLineSessionRef,
        isDrawingShapeRef,
        shapeInteractionPhaseRef,
      });

      return {
        ccGradientClickLineSessionRef,
        ccGradientDrawingGeometryRef,
        ccStrokeDirectionRef,
        isDrawingShapeRef,
        shapeInteractionPhaseRef,
        shapePointsRef,
      };
    });

    act(() => {
      useAppStore.getState().setActiveLayer('cc-b');
    });

    expect(result.current.ccGradientClickLineSessionRef.current).toEqual({
      active: false,
      points: [],
      previewPoint: null,
    });
    expect(result.current.shapePointsRef.current).toEqual([]);
    expect(result.current.ccStrokeDirectionRef.current).toBeNull();
    expect(result.current.ccGradientDrawingGeometryRef.current).toBeNull();
    expect(result.current.isDrawingShapeRef.current).toBe(false);
    expect(result.current.shapeInteractionPhaseRef.current).toBe('idle');
    expect(useAppStore.getState().shapeState.isDrawing).toBe(false);
    expect(resetShapeDragRefs).toHaveBeenCalledTimes(1);
    expect(getActiveMarkGradientSession('cc-a')).toBeNull();
    let secondMarkSession: ReturnType<typeof beginMarkGradientSession> = null;
    expect(() => {
      secondMarkSession = beginMarkGradientSession({
        layerId: 'cc-a',
        markKind: 'shape',
        gradientKind: 'linear',
        source: 'sampled',
        stops: [
          { position: 0, color: '#ff0000' },
          { position: 1, color: '#0000ff' },
        ],
      });
    }).not.toThrow();
    expect(secondMarkSession).not.toBeNull();

    unmount();
  });
});
