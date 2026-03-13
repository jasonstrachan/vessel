"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import DrawingCanvas from '../DrawingCanvas';

const handlers = {
  handlePointerDown: jest.fn(),
  handlePointerUp: jest.fn(),
  handlePointerMove: jest.fn(),
  handlePointerEnter: jest.fn(),
  handlePointerLeave: jest.fn(),
  handlePointerCancel: jest.fn(),
};

jest.mock('@/hooks/useDrawingHandlers', () => ({
  useDrawingHandlers: () => ({
    drawingCanvasRef: { current: document.createElement('canvas') },
    overlayCanvasRef: { current: document.createElement('canvas') },
    isCapturing: { current: false },
  initDrawingCanvas: jest.fn(),
  startDrawing: jest.fn(),
  continueDrawing: jest.fn(),
  finalizeDrawing: jest.fn(),
  clearDrawingCanvas: jest.fn(),
  beginStrokeSession: jest.fn(),
  endStrokeSession: jest.fn(),
  clearStrokeSession: jest.fn(),
  setSimpleShapePreviewRenderer: jest.fn(),
  setContourLinesPreviewRenderer: jest.fn(),
  setContourLinesSnapRenderer: jest.fn(),
  seedManualStrokeBoundingBox: jest.fn(),
  drawingCanvasHasContent: { current: false },
  setFeedbackCallback: jest.fn(),
  startShapeDrawing: jest.fn(),
  continueShapeDrawing: jest.fn(),
  finalizeShapeDrawing: jest.fn(),
  shapePointsRef: { current: [] },
  isDrawingShapeRef: { current: false },
  isSelectingDirectionRef: { current: false },
    startContinuousColorCycleAnimation: jest.fn(),
    stopContinuousColorCycleAnimation: jest.fn(),
    resumeColorCycleAfterInteraction: jest.fn(),
    commitRasterOverlay: jest.fn(),
    ...handlers,
  }),
}));

jest.mock('@/hooks/canvas/useCanvasEventHandlers', () => ({
  useCanvasEventHandlers: () => handlers,
}));

jest.mock('@/stores/useAppStore', () => {
  const mockState = {
    project: { width: 100, height: 80 },
    layers: [],
    referenceLayerId: null,
    activeLayerId: null,
    selectionStart: null,
    selectionEnd: null,
    floatingPaste: null,
    layersNeedRecomposition: false,
    canvas: { zoom: 1, offsetX: 0, offsetY: 0 },
    currentCompositeBitmap: null,
    compositeSegmentsVersion: 0,
    tools: {
      currentTool: 'brush',
      previousTool: 'brush',
      brushSettings: { brushShape: 'round', size: 12, antialiasing: true },
      eraserSettings: { size: 8 },
      fillSettings: {},
      shapeMode: false,
    },
    colorAdjust: { active: false },
    palette: { activeSlot: 'foreground', foregroundColor: '#000', backgroundColor: '#fff' },
    polygonGradientState: { drawingState: 'idle' },
    recolorSampling: { active: false },
    globalBrushSize: null,
    history: { undoStack: [], redoStack: [] },
    historyMaxSize: 50,
    getCompositeSegmentsSnapshot: jest.fn(() => []),
    setLayersNeedRecomposition: jest.fn(),
    setCanvasMessage: jest.fn(),
    clearCanvasMessage: jest.fn(),
    setCanvasCursor: jest.fn(),
    setBrushSettings: jest.fn(),
    setEraserSettings: jest.fn(),
    setCurrentBrushPreset: jest.fn(),
    setCurrentTool: jest.fn(),
    setCanvasViewport: jest.fn(),
    setColorCycleRuntimeHandlers: jest.fn(),
    suspendColorCycle: jest.fn(),
    resumeColorCycle: jest.fn(),
    renderStaticComposite: jest.fn(() => true),
    setCurrentOffscreenCanvas: jest.fn(),
    setHistorySize: jest.fn(),
  } as any;

  const useAppStore = (selector?: any) => (selector ? selector(mockState) : mockState);
  useAppStore.getState = () => mockState;
  useAppStore.subscribe = jest.fn(() => () => {});
  useAppStore.setState = jest.fn();
  return {
    useAppStore,
    selectEffectiveColorCyclePlaying: jest.fn(() => false),
    selectSequentialPlaybackActive: jest.fn(() => false),
    selectSequentialCaptureActive: jest.fn(() => false),
  };
});

jest.mock('@/hooks/useCanvasInteraction', () => ({
  useCanvasInteraction: () => ({
    dispatch: jest.fn(),
    state: { isDrawing: false, isSelecting: false },
    refs: {
      selectionStart: { current: null },
      selectionEnd: { current: null },
    },
  }),
}));

jest.mock('@/hooks/useCanvasStateMachine', () => ({
  useCanvasStateMachine: () => ({
    state: { mode: 'IDLE', isSpacePressed: false },
    dispatch: jest.fn(),
    finalizationComplete: jest.fn(),
  }),
}));

jest.mock('@/hooks/useSimplePan', () => ({
  useSimplePan: () => ({
    panState: { isPanning: false, offsetX: 0, offsetY: 0 },
    setPan: jest.fn(),
    getState: jest.fn(() => ({ isPanning: false, offsetX: 0, offsetY: 0 })),
    subscribe: jest.fn(() => () => {}),
    subscribeToPan: jest.fn(() => () => {}),
  }),
}));

jest.mock('@/hooks/useToolStateMachine', () => ({
  useToolStateMachine: () => ({
    isRectangleGradient: false,
    isPolygonGradient: false,
    isColorCycleShape: false,
    isContourPolygon: false,
    rectangleBrushState: { drawingState: 'idle' },
    handleRectangleGradientMouseDown: jest.fn(),
    handleRectangleGradientMouseMove: jest.fn(),
    handleRectangleGradientMouseUp: jest.fn(),
    resetRectangleGradient: jest.fn(),
    resetPolygonGradient: jest.fn(),
    completePolygonGradient: jest.fn(() => false),
  }),
}));

jest.mock('@/hooks/useComprehensiveKeyboard', () => ({ useComprehensiveKeyboard: jest.fn() }));
const brushEngineStub = {
  updateColorCycleGradient: jest.fn(),
  setColorCycleFlowMode: jest.fn(),
  resetColorCycle: jest.fn(),
  fillCcGradientConcentric: jest.fn(),
  renderColorCycle: jest.fn(),
  drawContourPolygon: jest.fn(),
  drawPolygonGradient: jest.fn(),
  drawRectangleGradient: jest.fn(),
};

jest.mock('@/hooks/useBrushEngineSimplified', () => ({ refreshLayerCCSurface: jest.fn(), useBrushEngineSimplified: () => brushEngineStub }));
jest.mock('@/hooks/useCropState', () => ({ useCropState: () => ({ isCropping: false }) }));
jest.mock('@/hooks/canvas/useCanvasEventHandlers', () => ({ useCanvasEventHandlers: () => handlers }));

jest.mock('@/layers/MaskManager', () => ({
  configureMaskManager: jest.fn(),
  getMaskManager: jest.fn(() => ({ applyMask: jest.fn() })),
}));

jest.mock('@/stores/colorCycleBrushManager', () => ({ getColorCycleBrushManager: jest.fn(() => null) }));
jest.mock('@/lib/colorCycle/RecolorManager', () => ({ RecolorManager: { getInstance: () => ({ updateGradient: jest.fn(), processLayer: jest.fn() }) } }));
jest.mock('@/workers/colorCycleCompositorClient', () => ({ getColorCycleCompositorClient: () => null }));

describe('DrawingCanvas smoke', () => {
  const resizeObserverMock = jest.fn(() => ({ observe: jest.fn(), unobserve: jest.fn(), disconnect: jest.fn() }));

  beforeAll(() => {
    global.ResizeObserver = resizeObserverMock as any;
  });

  it('renders canvases and wires pointer handlers', () => {
    try {
      render(<DrawingCanvas />);
    } catch (e) {
      // Surface underlying error for debugging
      console.error('Render error', e);
      throw e;
    }
    const surface = screen.getByLabelText('Drawing surface');
    fireEvent.pointerDown(surface);
    fireEvent.pointerUp(surface);
    fireEvent.pointerMove(surface);
    fireEvent.pointerEnter(surface);
    fireEvent.pointerLeave(surface);
    fireEvent.pointerCancel(surface);

    expect(handlers.handlePointerDown).toHaveBeenCalled();
    expect(handlers.handlePointerUp).toHaveBeenCalled();
    expect(handlers.handlePointerMove).toHaveBeenCalled();
    expect(screen.getByLabelText('Drawing canvas workspace')).toBeInTheDocument();
  });
});
