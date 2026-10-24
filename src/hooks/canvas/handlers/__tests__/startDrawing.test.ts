import { createStartDrawingCallback } from '@/hooks/canvas/handlers/startDrawingCallback';
import { prepareStrokeStartPrelude } from '@/hooks/canvas/handlers/strokeStartPrelude';
import { prepareStrokeStartBeforeStateSession } from '@/hooks/canvas/handlers/strokeStartBeforeStateSession';
import { prepareStrokeStartSamplingCanvas } from '@/hooks/canvas/handlers/strokeStartSamplingCanvas';
import { startDrawingToolStroke } from '@/hooks/canvas/handlers/startDrawingToolStroke';
import { useAppStore, type AppState } from '@/stores/useAppStore';
import { getColorCycleBrushFlags } from '@/hooks/canvas/utils/colorCycleBrushFlags';
import { BrushShape, type Layer } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

jest.mock('@/hooks/canvas/handlers/strokeStartPrelude');
jest.mock('@/hooks/canvas/handlers/strokeStartBeforeStateSession');
jest.mock('@/hooks/canvas/handlers/strokeStartSamplingCanvas');
jest.mock('@/hooks/canvas/handlers/startDrawingToolStroke');

const prelude = jest.mocked(prepareStrokeStartPrelude);
const beforeSession = jest.mocked(prepareStrokeStartBeforeStateSession);
const samplingCanvas = jest.mocked(prepareStrokeStartSamplingCanvas);
const toolStroke = jest.mocked(startDrawingToolStroke);

describe('start drawing acceptance', () => {
  const brushSamplingPreviewActiveRef = { current: false };

  beforeEach(() => {
    jest.resetAllMocks();
    brushSamplingPreviewActiveRef.current = false;
    const currentState = useAppStore.getState();
    prelude.mockReturnValue({
      currentState,
      currentTool: 'eraser',
      currentBrushId: null,
      ccFlags: getColorCycleBrushFlags(currentState.tools.brushSettings),
      worldPos: { x: 10, y: 12 },
      runtimeProject: { width: 64, height: 64 },
    });
    beforeSession.mockReturnValue(true);
    samplingCanvas.mockReturnValue(document.createElement('canvas').getContext('2d'));
    toolStroke.mockReturnValue(true);
  });

  const createStart = () => createStartDrawingCallback({
    // Each preparation boundary is mocked; no implementation-specific dependencies are read.
    prelude: {},
    beforeSession: {},
    samplingCanvas: {
      brushSamplingPreviewActiveRef,
      pauseColorCycleForNonCCInteraction: jest.fn(),
    },
    toolStroke: {},
  } as unknown as Parameters<typeof createStartDrawingCallback>[0]);

  const createPreparedState = (
    currentTool: 'brush' | 'eraser',
    brushShape: BrushShape,
    layerType: Layer['layerType'] = 'color-cycle',
  ): AppState => {
    const state = useAppStore.getState();
    const framebuffer = document.createElement('canvas');
    framebuffer.width = framebuffer.height = 64;
    const layer: Layer = {
      id: `layer-${layerType}`, name: layerType, layerType,
      visible: true, locked: false, opacity: 1, blendMode: 'source-over', order: 0,
      imageData: null, framebuffer, alignment: createDefaultLayerAlignment(),
      colorCycleData: layerType === 'color-cycle' ? { canvas: framebuffer, mode: 'brush' } : undefined,
      sequentialData: layerType === 'sequential'
        ? { frameCount: 1, fps: 24, durationMs: 1000 / 24, events: [] }
        : undefined,
    };
    return {
      ...state,
      activeLayerId: layer.id,
      layers: [layer],
      project: {
        id: 'palette-gesture-project', name: 'Palette gesture', width: 64, height: 64,
        layers: [layer], backgroundColor: '#ffffff', customBrushes: [],
        createdAt: new Date(0), updatedAt: new Date(0),
      },
      tools: {
        ...state.tools,
        currentTool,
        brushSettings: {
          ...state.tools.brushSettings,
          brushShape,
          customBrushColorCycle: brushShape === BrushShape.CUSTOM,
          autoSampleGradient: true,
        },
      },
    };
  };

  const prepareState = (currentState: AppState) => {
    prelude.mockReturnValue({
      currentState,
      currentTool: currentState.tools.currentTool,
      currentBrushId: null,
      ccFlags: getColorCycleBrushFlags(currentState.tools.brushSettings),
      worldPos: { x: 10, y: 12 },
      runtimeProject: { width: 64, height: 64 },
    });
  };

  it('propagates prelude rejection without preparing or authoring a stroke', () => {
    brushSamplingPreviewActiveRef.current = true;
    prelude.mockReturnValue(null);

    expect(createStart()({ x: 10, y: 12 })).toBe(false);
    expect(beforeSession).not.toHaveBeenCalled();
    expect(samplingCanvas).not.toHaveBeenCalled();
    expect(toolStroke).not.toHaveBeenCalled();
  });

  it('propagates capture rejection without initializing the canvas or authoring', () => {
    brushSamplingPreviewActiveRef.current = true;
    beforeSession.mockReturnValue(false);

    expect(createStart()({ x: 10, y: 12 })).toBe(false);
    expect(samplingCanvas).not.toHaveBeenCalled();
    expect(toolStroke).not.toHaveBeenCalled();
  });

  it('propagates missing canvas rejection without authoring', () => {
    samplingCanvas.mockReturnValue(null);

    expect(createStart()({ x: 10, y: 12 })).toBe(false);
    expect(toolStroke).not.toHaveBeenCalled();
  });

  it.each([
    { tool: 'brush', shape: BrushShape.COLOR_CYCLE, active: true, accepted: true },
    { tool: 'brush', shape: BrushShape.COLOR_CYCLE_SHAPE, active: true, accepted: true },
    { tool: 'brush', shape: BrushShape.CUSTOM, active: true, accepted: true },
    { tool: 'brush', shape: BrushShape.ROUND, active: true, accepted: false },
    { tool: 'eraser', shape: BrushShape.COLOR_CYCLE, active: true, accepted: false },
    { tool: 'brush', shape: BrushShape.COLOR_CYCLE, active: false, accepted: false },
  ] as const)(
    'reports palette-only admission $accepted for $tool/$shape with initialized preview $active',
    ({ tool, shape, active, accepted }) => {
      prepareState(createPreparedState(tool, shape));
      // The sampling initializer deliberately returns no authoring context for
      // an initialized palette gesture, while its pointer lifecycle continues.
      samplingCanvas.mockImplementation((args) => {
        args.brushSamplingPreviewActiveRef.current = active;
        return null;
      });

      expect(createStart()({ x: 10, y: 12 }, 0.75)).toBe(accepted);
      expect(beforeSession).toHaveBeenCalledTimes(1);
      expect(samplingCanvas).toHaveBeenCalledTimes(1);
      expect(toolStroke).not.toHaveBeenCalled();
    },
  );

  it.each(['no-active-id', 'stale-id', 'normal', 'sequential'] as const)(
    'rejects a palette-only gesture without a finalizable active CC target: %s',
    (target) => {
      const state = createPreparedState('brush', BrushShape.COLOR_CYCLE,
        target === 'normal' || target === 'sequential' ? target : 'color-cycle');
      if (target === 'no-active-id') {
        state.activeLayerId = null;
      } else if (target === 'stale-id') {
        state.activeLayerId = 'missing-layer';
      }
      prepareState(state);
      samplingCanvas.mockImplementation((args) => {
        args.brushSamplingPreviewActiveRef.current = true;
        return null;
      });

      expect(createStart()({ x: 10, y: 12 })).toBe(false);
      expect(beforeSession).toHaveBeenCalledTimes(1);
      expect(samplingCanvas).toHaveBeenCalledTimes(1);
      expect(toolStroke).not.toHaveBeenCalled();
    },
  );

  it('preserves ordinary CC authoring on a sequential layer when a drawing context exists', () => {
    const state = createPreparedState('brush', BrushShape.COLOR_CYCLE, 'sequential');
    state.tools.brushSettings.autoSampleGradient = false;
    prepareState(state);

    expect(createStart()({ x: 10, y: 12 }, 0.75)).toBe(true);
    expect(toolStroke).toHaveBeenCalledWith(expect.objectContaining({
      currentState: state, currentTool: 'brush', pressure: 0.75,
    }));
  });

  it('propagates tool-stroke rejection', () => {
    toolStroke.mockReturnValue(false);

    expect(createStart()({ x: 10, y: 12 })).toBe(false);
  });

  it('reports acceptance only after the tool stroke starts', () => {
    expect(createStart()({ x: 10, y: 12 }, 0.75)).toBe(true);
    expect(toolStroke).toHaveBeenCalledWith(expect.objectContaining({
      currentTool: 'eraser',
      worldPos: { x: 10, y: 12 },
      pressure: 0.75,
    }));
  });
});
