import { startEraserStroke } from '@/hooks/canvas/handlers/startEraserStroke';
import { EraserTool } from '@/tools/EraserTool';
import type { AppState } from '@/stores/useAppStore';
import { BrushShape, type Layer } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

jest.mock('@/tools/EraserTool', () => ({
  EraserTool: jest.fn(),
}));

const createDrawCtx = (): CanvasRenderingContext2D => {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('2d context unavailable');
  }
  return ctx;
};

const createLayer = (overrides?: Partial<Layer>): Layer => {
  const framebuffer = document.createElement('canvas');
  framebuffer.width = 16;
  framebuffer.height = 16;

  return {
    id: 'layer-1',
    name: 'Layer 1',
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    locked: false,
    order: 0,
    imageData: new ImageData(16, 16),
    framebuffer,
    alignment: createDefaultLayerAlignment(),
    layerType: 'normal',
    ...overrides,
  } as Layer;
};

const createState = (layer: Layer): AppState =>
  ({
    activeLayerId: layer.id,
    layers: [layer],
    tools: {
      eraserSettings: { opacity: 1 },
      brushSettings: {},
    },
  } as unknown as AppState);

const createArgs = (state: AppState, drawCtx: CanvasRenderingContext2D) => ({
  currentState: state,
  drawCtx,
  worldPos: { x: 4, y: 5 },
  pressure: 0.8,
  isEraserV2: false,
  isColorCycleBrush: true,
  currentBrushId: null as string | null,
  userBrushEngine: {
    isUserBrush: () => false,
    setActiveBrush: jest.fn(),
    startStroke: jest.fn(),
  },
  brushEngine: null as {
    drawBrush: (
      ctx: CanvasRenderingContext2D,
      from: { x: number; y: number },
      to: { x: number; y: number },
      options?: {
        pressure: number;
      }
    ) => void;
    updateConfig?: (config: { brushSettings: AppState['tools']['brushSettings'] }) => void;
  } | null,
  drawEraserSegment: jest.fn(),
  resolveCustomBrushData: jest.fn(),
  eraserToolRef: { current: null },
  eraserRoiRef: { current: null },
  drawingCanvasHasContent: { current: false },
  maskManager: {} as ReturnType<typeof import('@/layers/MaskManager').getMaskManager>,
  createBrushStampSource: jest.fn() as unknown as () => import('@/tools/stamps/BrushStampSource').BrushStampSource,
  getBrushHalfSize: () => 6,
  getColorCycleBrushEraserSettings: () => ({
    size: 10,
    pressureEnabled: false,
    minPressure: 0,
    maxPressure: 1,
    brushShape: BrushShape.ROUND,
  }),
});

describe('startEraserStroke overlay seeding', () => {
  beforeEach(() => {
    (EraserTool as unknown as jest.Mock).mockReset();
  });

  it('prefers framebuffer over imageData for regular eraser stroke start', () => {
    const layer = createLayer();
    const state = createState(layer);
    const drawCtx = createDrawCtx();
    const drawImageSpy = jest.spyOn(drawCtx, 'drawImage');
    const putImageDataSpy = jest.spyOn(drawCtx, 'putImageData');

    const started = startEraserStroke(createArgs(state, drawCtx));

    expect(started).toBe(true);
    expect(drawImageSpy).toHaveBeenCalledWith(layer.framebuffer, 0, 0);
    expect(putImageDataSpy).not.toHaveBeenCalled();
  });

  it('falls back to imageData if framebuffer draw throws', () => {
    const layer = createLayer();
    const state = createState(layer);
    const drawCtx = createDrawCtx();
    const drawImageSpy = jest.spyOn(drawCtx, 'drawImage').mockImplementation(() => {
      throw new Error('framebuffer unavailable');
    });
    const putImageDataSpy = jest.spyOn(drawCtx, 'putImageData');

    const started = startEraserStroke(createArgs(state, drawCtx));

    expect(started).toBe(true);
    expect(drawImageSpy).toHaveBeenCalled();
    expect(putImageDataSpy).toHaveBeenCalledWith(layer.imageData as ImageData, 0, 0);
  });

  it('uses framebuffer-first seeding for eraser v2 and marks overlay content', () => {
    const layer = createLayer();
    const state = createState(layer);
    const drawCtx = createDrawCtx();
    const drawImageSpy = jest.spyOn(drawCtx, 'drawImage');
    const putImageDataSpy = jest.spyOn(drawCtx, 'putImageData');
    const begin = jest.fn();
    const getROI = jest.fn(() => ({ x: 1, y: 2, width: 3, height: 4 }));
    (EraserTool as unknown as jest.Mock).mockImplementation(() => ({
      begin,
      getROI,
    }));

    const args = createArgs(state, drawCtx);
    args.isEraserV2 = true;

    const started = startEraserStroke(args);

    expect(started).toBe(true);
    expect(drawImageSpy).toHaveBeenCalledWith(layer.framebuffer, 0, 0);
    expect(putImageDataSpy).not.toHaveBeenCalled();
    expect(args.drawingCanvasHasContent.current).toBe(true);
    expect(begin).toHaveBeenCalledWith(args.worldPos, args.pressure);
    expect(args.eraserRoiRef.current).toEqual({ x: 1, y: 2, width: 3, height: 4 });
  });

  it('never uses user/custom brush tips while erasing', () => {
    const layer = createLayer();
    const state = createState(layer);
    const drawCtx = createDrawCtx();
    const args = createArgs(state, drawCtx);
    const brushEngineDraw = jest.fn();
    const userStart = jest.fn();
    const resolveCustom = jest.fn(() => ({ imageData: new ImageData(2, 2), width: 2, height: 2, isResampler: false }));

    args.isColorCycleBrush = false;
    args.currentBrushId = 'custom-user-brush';
    args.brushEngine = {
      drawBrush: brushEngineDraw,
    };
    args.userBrushEngine = {
      ...args.userBrushEngine,
      isUserBrush: () => true,
      startStroke: userStart,
    };
    args.resolveCustomBrushData = resolveCustom;

    const started = startEraserStroke(args);

    expect(started).toBe(true);
    expect(userStart).not.toHaveBeenCalled();
    expect(resolveCustom).not.toHaveBeenCalled();
    expect(brushEngineDraw).toHaveBeenCalledWith(drawCtx, args.worldPos, args.worldPos, { pressure: args.pressure });
  });
});
