import { createStartDrawingCallback } from '@/hooks/canvas/handlers/startDrawingCallback';
import { prepareStrokeStartPrelude } from '@/hooks/canvas/handlers/strokeStartPrelude';
import { prepareStrokeStartBeforeStateSession } from '@/hooks/canvas/handlers/strokeStartBeforeStateSession';
import { prepareStrokeStartSamplingCanvas } from '@/hooks/canvas/handlers/strokeStartSamplingCanvas';
import { startDrawingToolStroke } from '@/hooks/canvas/handlers/startDrawingToolStroke';
import { useAppStore } from '@/stores/useAppStore';
import { getColorCycleBrushFlags } from '@/hooks/canvas/utils/colorCycleBrushFlags';

jest.mock('@/hooks/canvas/handlers/strokeStartPrelude');
jest.mock('@/hooks/canvas/handlers/strokeStartBeforeStateSession');
jest.mock('@/hooks/canvas/handlers/strokeStartSamplingCanvas');
jest.mock('@/hooks/canvas/handlers/startDrawingToolStroke');

const prelude = jest.mocked(prepareStrokeStartPrelude);
const beforeSession = jest.mocked(prepareStrokeStartBeforeStateSession);
const samplingCanvas = jest.mocked(prepareStrokeStartSamplingCanvas);
const toolStroke = jest.mocked(startDrawingToolStroke);

describe('start drawing acceptance', () => {
  beforeEach(() => {
    jest.resetAllMocks();
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
    samplingCanvas: {},
    toolStroke: {},
  } as unknown as Parameters<typeof createStartDrawingCallback>[0]);

  it('propagates prelude rejection without preparing or authoring a stroke', () => {
    prelude.mockReturnValue(null);

    expect(createStart()({ x: 10, y: 12 })).toBe(false);
    expect(beforeSession).not.toHaveBeenCalled();
    expect(samplingCanvas).not.toHaveBeenCalled();
    expect(toolStroke).not.toHaveBeenCalled();
  });

  it('propagates capture rejection without initializing the canvas or authoring', () => {
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
