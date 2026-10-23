import { act, renderHook } from '@testing-library/react';
import { useRef } from 'react';

import { useShapePressureResetEffects } from '@/hooks/canvas/useShapePressureResetEffects';
import { useDrawingHandlerRefs } from '@/hooks/canvas/useDrawingHandlerRefs';
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

  const mountDraft = (directionStage = false, finalizing = false) => {
    const resetShapePressureState = jest.fn();
    const resetShapeDragRefs = jest.fn();
    const clearRect = jest.fn();
    const hook = renderHook(() => {
      const refs = useDrawingHandlerRefs();
      refs.shapePointsRef.current = [{ x: 40, y: 40 }, { x: 100, y: 40 }, { x: 100, y: 100 }];
      refs.ccStrokeSamplesRef.current = [{ x: 40, y: 40, pressure: 0.5 }];
      refs.ccStrokeDirectionRef.current = { x: 1, y: 0 };
      refs.ccGradientDrawingGeometryRef.current = {
        shapePoints: refs.shapePointsRef.current,
        sampleSourcePoints: refs.shapePointsRef.current,
        bounds: { minX: 40, minY: 40, maxX: 100, maxY: 100 },
      };
      refs.isDrawingShapeRef.current = true;
      refs.shapeInteractionPhaseRef.current = finalizing ? 'finalizing' : 'drawing';
      refs.isSelectingDirectionRef.current = directionStage;
      refs.directionPreviewRef.current = directionStage ? { x: 120, y: 80 } : null;
      refs.shapeBeforeSnapshotCapturedRef.current = true;
      refs.strokeBoundingBoxRef.current = { minX: 40, minY: 40, maxX: 100, maxY: 100 };
      refs.strokeCapturePaddingRef.current = 8;
      refs.drawingCanvasHasContent.current = true;
      refs.ccShapePreviewPauseStartedRef.current = true;
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 256;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas context fixture missing');
      context.clearRect = clearRect;
      refs.drawingCanvasRef.current = canvas;
      refs.drawingCtxRef.current = context;
      const args = {
        resetShapePressureState,
        resetShapeDragRefs,
        strokeBoundingBoxRef: refs.strokeBoundingBoxRef,
        strokeCapturePaddingRef: refs.strokeCapturePaddingRef,
        shapePointsRef: refs.shapePointsRef,
        ccStrokeSamplesRef: refs.ccStrokeSamplesRef,
        ccStrokeDirectionRef: refs.ccStrokeDirectionRef,
        ccGradientDrawingGeometryRef: refs.ccGradientDrawingGeometryRef,
        ccGradientClickLineSessionRef: refs.ccGradientClickLineSessionRef,
        isDrawingShapeRef: refs.isDrawingShapeRef,
        shapeInteractionPhaseRef: refs.shapeInteractionPhaseRef,
        ccDraftRefs: refs,
      };
      useShapePressureResetEffects(args);
      return refs;
    });
    return { ...hook, clearRect, resetShapePressureState, resetShapeDragRefs };
  };

  it.each([
    ['color-cycle-gradient', 'polygon', 'rectangle'],
    ['color-cycle-flat-dither', 'polygon', 'rectangle'],
    ['color-cycle-gradient', 'rectangle', 'line'],
    ['color-cycle-flat-dither', 'rectangle', 'line'],
  ] as const)('cancels the %s %s draft before choosing %s', (presetId, from, to) => {
    useAppStore.setState(state => ({
      currentBrushPreset: { ...state.currentBrushPreset!, id: presetId },
      tools: { ...state.tools, brushSettings: { ...state.tools.brushSettings, ccGradientDrawingShape: from } },
    }));
    beginMarkGradientSession({ layerId: 'cc-a', markKind: 'shape', gradientKind: 'linear', source: 'sampled', stops: [{ position: 0, color: '#000000' }, { position: 1, color: '#ffffff' }] });
    const { result, clearRect, resetShapePressureState, resetShapeDragRefs } = mountDraft(from === 'rectangle');
    act(() => { useAppStore.getState().setBrushSettings({ ccGradientDrawingShape: to }); });
    const refs = result.current;
    expect(refs.shapePointsRef.current).toEqual([]);
    expect(refs.ccStrokeSamplesRef.current).toEqual([]);
    expect(refs.ccStrokeDirectionRef.current).toBeNull();
    expect(refs.ccGradientDrawingGeometryRef.current).toBeNull();
    expect(refs.isSelectingDirectionRef.current).toBe(false);
    expect(refs.directionPreviewRef.current).toBeNull();
    expect(refs.isDrawingShapeRef.current).toBe(false);
    expect(refs.shapeInteractionPhaseRef.current).toBe('idle');
    expect(refs.shapeBeforeSnapshotCapturedRef.current).toBe(false);
    expect(refs.strokeBoundingBoxRef.current).toBeNull();
    expect(refs.strokeCapturePaddingRef.current).toBe(0);
    expect(refs.drawingCanvasHasContent.current).toBe(false);
    expect(refs.ccShapePreviewPauseStartedRef.current).toBe(false);
    expect(clearRect).toHaveBeenCalledWith(0, 0, 256, 256);
    expect(resetShapePressureState).toHaveBeenCalledTimes(1);
    expect(resetShapeDragRefs).toHaveBeenCalledTimes(1);
    expect(getActiveMarkGradientSession('cc-a')).toBeNull();
    expect(useAppStore.getState().shapeState.isDrawing).toBe(false);
    expect(useAppStore.getState().tools.brushSettings.ccGradientDrawingShape).toBe(to);
  });

  it.each(['fill-mode', 'tool-switch', 'finalizing'] as const)('preserves the existing %s contract', transition => {
    useAppStore.getState().setBrushSettings({ ccGradientDrawingShape: 'polygon', colorCycleFillMode: 'concentric' });
    const { result, clearRect, resetShapeDragRefs } = mountDraft(false, transition === 'finalizing');
    const originalPoints = result.current.shapePointsRef.current;
    act(() => {
      if (transition === 'fill-mode') useAppStore.getState().setBrushSettings({ colorCycleFillMode: 'stroke' });
      else if (transition === 'tool-switch') useAppStore.getState().setCurrentTool('selection');
      else useAppStore.getState().setBrushSettings({ ccGradientDrawingShape: 'rectangle' });
    });
    expect(result.current.shapePointsRef.current).toBe(originalPoints);
    expect(result.current.isDrawingShapeRef.current).toBe(true);
    expect(clearRect).not.toHaveBeenCalled();
    expect(resetShapeDragRefs).not.toHaveBeenCalled();
  });


  it.each([false, true])('releases only an owned preview suspension (owned=%s), preserving toolbar pause', owned => {
    const originalPlayback = useAppStore.getState().colorCyclePlayback;
    useAppStore.getState().setBrushSettings({ ccGradientDrawingShape: 'polygon' });
    useAppStore.getState().pauseColorCycle('toolbar');
    // Another interaction owns the first suspension; this draft may own one more.
    useAppStore.getState().suspendColorCycle('brush-stroke');
    const baselineDepth = useAppStore.getState().colorCyclePlayback.suspendDepth;
    if (owned) useAppStore.getState().suspendColorCycle('shape-preview');
    const { result } = mountDraft();
    result.current.shouldResumeColorCycleAfterInteractionRef.current = owned;
    act(() => { useAppStore.getState().setBrushSettings({ ccGradientDrawingShape: 'rectangle' }); });
    expect(useAppStore.getState().colorCyclePlayback.suspendDepth).toBe(baselineDepth);
    expect(useAppStore.getState().colorCyclePlayback.desiredPlaying).toBe(false);
    expect(result.current.shouldResumeColorCycleAfterInteractionRef.current).toBe(false);
    useAppStore.setState({ colorCyclePlayback: originalPlayback });
  });

  it('leaves non-CC shape drafts to their existing owner', () => {
    useAppStore.setState(state => ({
      currentBrushPreset: null,
      tools: { ...state.tools, brushSettings: { ...state.tools.brushSettings, brushShape: BrushShape.SQUARE, ccGradientDrawingShape: 'polygon' } },
    }));
    const { result, clearRect, resetShapeDragRefs } = mountDraft();
    const originalPoints = result.current.shapePointsRef.current;
    act(() => { useAppStore.getState().setBrushSettings({ ccGradientDrawingShape: 'rectangle' }); });
    expect(result.current.shapePointsRef.current).toBe(originalPoints);
    expect(clearRect).not.toHaveBeenCalled();
    expect(resetShapeDragRefs).not.toHaveBeenCalled();
  });

});
