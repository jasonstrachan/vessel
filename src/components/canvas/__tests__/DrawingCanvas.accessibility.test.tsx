import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import DrawingCanvas from '../DrawingCanvas';
import type { AppState } from '@/stores/useAppStore';
import type { Layer } from '@/types';
import { BrushShape } from '@/types';
import { selectActiveLayerId, selectLayersNeedRecomposition } from '@/stores/selectors/layersSelectors';

function createBaseState(): AppState {
  const mockLayer = ({
    id: 'layer-1',
    name: 'Layer 1',
    layerType: 'normal',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'source-over',
    imageData: null,
  } as unknown) as Layer;
  return ({
  project: { id: 'proj', name: 'Demo', width: 800, height: 600 } as unknown,
  layers: [mockLayer],
  referenceLayerId: null,
  activeLayerId: 'layer-1',
  selectionStart: null,
  selectionEnd: null,
  selectionClipboard: null,
  floatingPaste: null,
  layersNeedRecomposition: true,
  canvas: { zoom: 1, offsetX: 0, offsetY: 0 } as unknown,
  currentCompositeBitmap: null,
  tools: {
    currentTool: 'brush',
    previousTool: 'brush',
    brushSettings: { brushShape: 'round' as BrushShape, antialiasing: true, size: 12 },
    eraserSettings: { size: 8 },
    fillSettings: {},
    shapeMode: null,
  } as unknown,
  colorAdjust: { active: false } as unknown,
  palette: { activeSlot: 'foreground', foregroundColor: '#000', backgroundColor: '#fff' } as unknown,
  polygonGradientState: { points: [] } as unknown,
  recolorSampling: { active: false } as unknown,
  currentBrushPreset: null,
  setActiveColor: jest.fn(),
  setBrushSettings: jest.fn(),
  updateRecolorSampling: jest.fn(),
  stopRecolorSampling: jest.fn(),
  setRectangleBrushState: jest.fn(),
  setLayersNeedRecomposition: jest.fn(),
  setSelectionBounds: jest.fn(),
  clearSelection: jest.fn(),
  setFloatingPaste: jest.fn(),
  updateFloatingPastePosition: jest.fn(),
  commitFloatingPaste: jest.fn(),
  cancelFloatingPaste: jest.fn(),
  setCurrentOffscreenCanvas: jest.fn(),
  compositeLayersToCanvas: jest.fn(),
  setCanvasDimensions: jest.fn(),
  setZoom: jest.fn(),
  setCanvasOffset: jest.fn(),
  setCanvasViewport: jest.fn(),
  undo: jest.fn().mockResolvedValue(null),
  redo: jest.fn().mockResolvedValue(null),
  canUndo: jest.fn(() => true),
  canRedo: jest.fn(() => true),
  updateLayer: jest.fn(),
  applyColorAdjust: jest.fn(),
  cancelColorAdjust: jest.fn(),
  setColorCycleRuntimeHandlers: jest.fn(),
  saveProject: jest.fn().mockResolvedValue(undefined),
  toggleModal: jest.fn(),
  newProject: jest.fn(),
  ensureCustomBrushHydrated: jest.fn().mockResolvedValue(undefined),
  colorCyclePlayback: { desiredPlaying: true, suspendDepth: 0, lastReason: null, recentReasons: [] } as unknown,
  history: { undoStack: [], redoStack: [] } as unknown,
  autosave: {
    isEnabled: false,
    hasUnsavedChanges: false,
    isRunning: false,
    lastSaveTime: null,
    interval: 30,
    lastDirtyReason: null,
    lastDirtyAt: null,
    fileBackup: {
      enabled: false,
      mode: 'single-file',
      fileHandle: null,
      directoryHandle: null,
      backupPath: null,
      lastBackupTime: null,
    },
  } as unknown,
  canvasViewport: { left: 0, top: 0, width: 1, height: 1 } as unknown,
  crop: { active: false } as unknown,
  ui: { keyboardScope: { active: 'global' }, modals: { document: false, settings: false, export: false, loadProject: false }, panels: {}, notifications: [] } as unknown,
  setCurrentTool: jest.fn(),
} as unknown as AppState);
}

const baseState = createBaseState();

const useAppStoreMock = Object.assign(
  jest.fn((selector?: (store: AppState) => unknown) => {
    if (selector) {
      return selector(baseState);
    }
    return baseState;
  }),
  {
    getState: () => baseState,
    setState: jest.fn(),
    subscribe: jest.fn(() => () => {}),
  }
);

jest.mock('@/stores/useAppStore', () => {
  const actual = jest.requireActual('@/stores/useAppStore');
  return {
    __esModule: true,
    ...actual,
    useAppStore: useAppStoreMock as typeof actual.useAppStore,
    selectEffectiveColorCyclePlaying: jest.fn(() => false),
  };
});

const brushEngineStub = {
  updateColorCycleGradient: jest.fn(),
  setColorCycleFlowMode: jest.fn(),
  resetColorCycle: jest.fn(),
  fillColorCycleShape: jest.fn().mockResolvedValue(undefined),
  renderColorCycle: jest.fn(),
  drawContourPolygon: jest.fn(),
  drawPolygonGradient: jest.fn(),
  drawRectangleGradient: jest.fn(),
};

jest.mock('@/hooks/useBrushEngineSimplified', () => ({
  useBrushEngineSimplified: () => brushEngineStub,
}));

const interactionStub = {
  dispatch: jest.fn(),
  state: { isDrawing: false, isSelecting: false },
  refs: {
    selectionStart: { current: null },
    selectionEnd: { current: null },
  },
};

jest.mock('@/hooks/useCanvasInteraction', () => ({
  useCanvasInteraction: () => interactionStub,
}));

const stateMachineStub = {
  setTool: jest.fn(),
  forceIdle: jest.fn(),
  finalizationComplete: jest.fn(),
  dispatch: jest.fn(),
  state: { isSpacePressed: false, mode: 'IDLE' },
};

jest.mock('@/hooks/useCanvasStateMachine', () => ({
  useCanvasStateMachine: () => stateMachineStub,
}));

const panState = { offsetX: 0, offsetY: 0, isPanning: false };

jest.mock('@/hooks/useSimplePan', () => ({
  useSimplePan: () => ({
    setPan: jest.fn(),
    getState: jest.fn(() => ({ ...panState })),
    panState,
    subscribe: jest.fn(() => () => {}),
  }),
}));

jest.mock('@/hooks/useToolStateMachine', () => ({
  useToolStateMachine: () => ({
    resetRectangleGradient: jest.fn(),
    resetPolygonGradient: jest.fn(),
    completePolygonGradient: jest.fn(() => false),
    polygonGradientState: { points: [] },
    isContourPolygon: false,
  }),
}));

jest.mock('@/hooks/useComprehensiveKeyboard', () => ({
  useComprehensiveKeyboard: jest.fn(),
}));

const createContextStub = () => ({
  clearRect: jest.fn(),
  drawImage: jest.fn(),
  getImageData: jest.fn(() => ({ data: new Uint8ClampedArray(4) })),
  canvas: { width: 1, height: 1 },
  save: jest.fn(),
  restore: jest.fn(),
  beginPath: jest.fn(),
  arc: jest.fn(),
  fill: jest.fn(),
  strokeRect: jest.fn(),
  setLineDash: jest.fn(),
  clip: jest.fn(),
  translate: jest.fn(),
  scale: jest.fn(),
  setTransform: jest.fn(),
  stroke: jest.fn(),
  fillRect: jest.fn(),
  moveTo: jest.fn(),
  lineTo: jest.fn(),
  rect: jest.fn(),
  closePath: jest.fn(),
  createPattern: jest.fn(() => ({})),
});

beforeAll(() => {
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    value: function getContext() {
      return createContextStub();
    },
  });
  Object.defineProperty(HTMLCanvasElement.prototype, 'toDataURL', {
    value: () => 'data:image/png;base64,'
  });
  class MockResizeObserver {
    observe() {}
    disconnect() {}
  }
  (global as unknown as { ResizeObserver?: typeof MockResizeObserver }).ResizeObserver = MockResizeObserver;
});

const drawingCanvas = document.createElement('canvas');

const drawingHandlersStub = {
  clearDrawingCanvas: jest.fn(),
  shapePointsRef: { current: [] },
  isDrawingShapeRef: { current: false },
  isSelectingDirectionRef: { current: false },
  drawingCanvasRef: { current: drawingCanvas },
  drawingCanvasHasContent: { current: false },
  finalizeDrawing: jest.fn().mockResolvedValue(undefined),
  finalizeShapeDrawing: jest.fn().mockResolvedValue(undefined),
  resumeColorCycleAfterInteraction: jest.fn().mockResolvedValue(undefined),
  initDrawingCanvas: jest.fn(),
  setFeedbackCallback: jest.fn(),
  startContinuousColorCycleAnimation: jest.fn(),
  stopContinuousColorCycleAnimation: jest.fn(),
};

jest.mock('@/hooks/useDrawingHandlers', () => ({
  useDrawingHandlers: () => drawingHandlersStub,
}));

const eventHandlersStub = {
  handlePointerDown: jest.fn(),
  handlePointerMove: jest.fn(),
  handlePointerUp: jest.fn(),
  handlePointerEnter: jest.fn(),
  handlePointerLeave: jest.fn(),
  handlePointerCancel: jest.fn(),
};

jest.mock('@/hooks/canvas/useCanvasEventHandlers', () => ({
  useCanvasEventHandlers: () => eventHandlersStub,
}));

jest.mock('@/hooks/useCropState', () => ({
  useCropState: () => ({ crop: { active: false }, commitCrop: jest.fn(), cancelCrop: jest.fn() }),
}));

jest.mock('@/hooks/useStoreSelectorRef', () => ({
  useStoreSelectorRef: (selector: (state: AppState) => unknown) => ({ current: selector(baseState) }),
}));

jest.mock('../SimplifiedColorCycleManager', () => ({
  SimplifiedColorCycleManager: class {
    start = jest.fn();
    stop = jest.fn();
    dispose = jest.fn();
    destroy = jest.fn();
  },
}));

jest.mock('../BrushCursor', () => {
  const MockBrushCursor = React.forwardRef<HTMLDivElement>(() => null);
  MockBrushCursor.displayName = 'MockBrushCursor';
  return {
    __esModule: true,
    default: MockBrushCursor,
  };
});

jest.mock('@/lib/colorCycle/RecolorManager', () => ({
  RecolorManager: class {
    dispose = jest.fn();
    destroy = jest.fn();
  },
}));

const renderCanvas = () => render(<DrawingCanvas />);

describe('DrawingCanvas accessibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    baseState.layersNeedRecomposition = true;
  });

  it('exposes an accessible workspace and drawing surface', () => {
    renderCanvas();

    const region = screen.getByRole('region', { name: /drawing canvas workspace/i });
    expect(region).toHaveAttribute('tabindex', '0');

    const canvasElement = screen.getByLabelText('Drawing surface');
    expect(canvasElement.tagName).toBe('CANVAS');
  });

  it('clears recomposition flags via the store setter on mount', async () => {
    renderCanvas();

    await waitFor(() => {
      expect(baseState.setLayersNeedRecomposition).toHaveBeenCalledWith(false);
    });
  });

  it('subscribes to key selectors for stable rendering', () => {
    renderCanvas();

    const selectorCalls = useAppStoreMock.mock.calls.map(([selector]) => selector);

    expect(selectorCalls).toContain(selectActiveLayerId);
    expect(selectorCalls).toContain(selectLayersNeedRecomposition);
  });
});
