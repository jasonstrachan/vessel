import type React from 'react';

import { BrushShape } from '@/types';
import type { AppState } from '@/stores/useAppStore';
import { finalizeShapeDrawing } from '@/hooks/canvas/handlers/shapes/shapeDrawing';

const storeState = {
  activeLayerId: 'layer-1',
  layers: [] as Array<Record<string, unknown>>,
  tools: {
    currentTool: 'brush',
    brushSettings: {
      brushShape: BrushShape.COLOR_CYCLE_SHAPE,
      colorCycleFillMode: 'linear',
      fillResolution: 7,
      pressureLinkedFillResolution: false,
      ditherEnabled: true,
      gradientBands: 8,
      ditherAlgorithm: 'pattern',
      patternStyle: 'dots',
      colorCycleGradient: [
        { position: 0, color: '#000000' },
        { position: 1, color: '#ffffff' },
      ],
      color: '#000000',
      opacity: 1,
      blendMode: 'source-over',
    },
  },
  polygonGradientState: { drawingState: 'idle', points: [] },
  palette: { foregroundColor: '#000000', backgroundColor: '#ffffff' },
  project: { width: 64, height: 64 },
  setShapeDrawing: jest.fn(),
} as unknown as AppState;

jest.mock('@/stores/useAppStore', () => {
  const mock = (selector?: (state: AppState) => unknown) => (selector ? selector(storeState) : storeState);
  mock.getState = () => storeState;
  return { useAppStore: mock };
});

const makeContext = () => ({
  clearRect: jest.fn(),
}) as unknown as CanvasRenderingContext2D;

describe('finalizeShapeDrawing CC dither resolution', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const layerCanvas = document.createElement('canvas');
    layerCanvas.width = 64;
    layerCanvas.height = 64;
    storeState.layers = [
      {
        id: 'layer-1',
        layerType: 'color-cycle',
        colorCycleData: {
          canvas: layerCanvas,
          gradient: storeState.tools.brushSettings.colorCycleGradient,
        },
      },
    ] as unknown as AppState['layers'];
  });

  it('passes the fill-resolution slider value to CC shape finalize even when no brush instance is found', async () => {
    let queued: Promise<void> | null = null;
    const finalizeQueue = {
      isBusy: jest.fn(() => false),
      enqueue: jest.fn((task: () => Promise<void>) => {
        queued = task();
        return queued;
      }),
    };
    const runColorCycleShapeFill = jest.fn(async () => undefined);
    const refs = {
      isDrawingShapeRef: { current: true },
      isSelectingDirectionRef: { current: true },
      directionPreviewRef: { current: { x: 32, y: 16 } },
      shapePointsRef: {
        current: [
          { x: 8, y: 8 },
          { x: 24, y: 8 },
          { x: 8, y: 24 },
        ],
      },
      shapeDragStartRef: { current: null },
      shapeDragLastRef: { current: null },
      shapeDragMovedRef: { current: false },
      shapeInteractionPhaseRef: { current: 'drawing' },
      latestShapePressureRef: { current: 0.5 },
      lastStablePressureRef: { current: 0.5 },
      shapeBeforeImageRef: { current: null },
      strokeBoundingBoxRef: { current: null },
      strokeCapturePaddingRef: { current: 0 },
      drawingCtxRef: { current: makeContext() },
      drawingCanvasRef: { current: document.createElement('canvas') },
      drawingCanvasHasContent: { current: true },
      autoSamplePointsRef: { current: [] },
      autoSampleForkRef: { current: false },
      autoSampleLastUpdateRef: { current: 0 },
      ccSampledPointsRef: { current: [] },
      ccGradientSampleSessionRef: {
        current: {
          active: false,
          strokeId: null,
          tempSlot: -1,
          stops: null,
          hash: '',
          polyline: [],
        },
      },
      ccGradientSampleLastUpdateRef: { current: 0 },
      hadValidShapePressureRef: { current: false },
      latestShapePixelSizeRef: { current: null },
      shapeMaxPressureRef: { current: 0 },
      ccShapePreviewPauseStartedRef: { current: false },
      activeStrokeSessionRef: { current: null },
      finalizeQueueRef: { current: finalizeQueue },
    };
    const deps = {
      storeRef: { current: storeState },
      brushEngine: {},
      drawingCtxRef: refs.drawingCtxRef,
      drawingCanvasRef: refs.drawingCanvasRef,
      drawingCanvasHasContent: refs.drawingCanvasHasContent,
      project: storeState.project,
      isBusyRef: { current: false },
      latestShapePixelSizeRef: refs.latestShapePixelSizeRef,
      hadValidShapePressureRef: refs.hadValidShapePressureRef,
      lastStablePressureRef: refs.lastStablePressureRef,
      computeShapePixelSize: jest.fn(() => 3),
      getColorCycleBrushManager: () => ({ getBrush: () => null }),
      ensureActiveColorCycleGradientSlot: jest.fn(),
      runColorCycleShapeFill,
      bindBrushToCanvas: jest.fn(),
      timeAsync: async (_label: string, task: () => Promise<unknown>) => task(),
      timeSync: (_label: string, task: () => unknown) => task(),
      ccLog: jest.fn(),
      scheduleDeferredColorCycleSaveWithState: jest.fn(),
      logError: jest.fn(),
      ccDebug: { on: false, timing: false, verbose: false },
      perfMark: jest.fn(),
      perfMeasure: jest.fn(),
      debugTime: jest.fn(),
      debugTimeEnd: jest.fn(),
      FF: { CC_CAPTURE_ROI: false },
      ROI_PADDING_PX: 2,
      captureRegionFromPoints: jest.fn(),
      isColorCycleLayerWithData: jest.fn(() => true),
      captureColorCycleBrushState: jest.fn(() => null),
      resumeColorCycleAfterInteraction: jest.fn(async () => undefined),
      triggerSimpleShapePreview: jest.fn(),
      resetShapeDragRefs: jest.fn(),
      resetCcGradientSample: jest.fn(),
      resetShapePressureState: jest.fn(),
      clearShapeBeforeSnapshot: jest.fn(),
      finalizeDrawing: jest.fn(async () => undefined),
      finalizeDitherGradientShape: jest.fn(),
      finalizeRasterShapeFill: jest.fn(),
      resetPolygonState: jest.fn(),
      sampleColorAt: jest.fn(),
      sampleHexAt: jest.fn(() => '#000000'),
    };

    await finalizeShapeDrawing(
      {
        shapeMode: true,
        refs: refs as unknown as Parameters<typeof finalizeShapeDrawing>[0]['refs'],
        toolsRef: { current: storeState.tools } as React.MutableRefObject<AppState['tools']>,
      },
      deps as unknown as Parameters<typeof finalizeShapeDrawing>[1]
    );
    await queued;

    expect(runColorCycleShapeFill).toHaveBeenCalledWith(
      expect.objectContaining({
        ditherPixelSize: 7,
      }),
      expect.any(Object)
    );
    expect(refs.latestShapePixelSizeRef.current).toBe(7);
  });
});
