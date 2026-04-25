import { drawVisibleCompositeStack } from '@/components/canvas/drawingCanvasCompositeStack';
import type { CompositeSegment } from '@/stores/slices/layersSlice';
import type { Layer } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

const mockGetState = jest.fn();
const mockGetSequentialLayerRenderCanvas = jest.fn();
const mockGetSequentialLivePreviewFrame = jest.fn<unknown, [unknown]>(() => null);

jest.mock('@/stores/useAppStore', () => ({
  selectSequentialPlaybackActive: (state: {
    colorCyclePlayback?: { desiredPlaying?: boolean };
    layers?: Array<{ layerType?: string }>;
  }) =>
    Boolean(state.colorCyclePlayback?.desiredPlaying) &&
    Boolean(state.layers?.some((layer) => layer.layerType === 'sequential')),
  useAppStore: {
    getState: () => mockGetState(),
  },
}));

jest.mock('@/lib/sequential/SequentialLayerRenderer', () => ({
  getSequentialLayerRenderCanvas: (...args: unknown[]) => mockGetSequentialLayerRenderCanvas(...args),
}));

jest.mock('@/lib/sequential/SequentialLivePreviewRuntime', () => ({
  getSequentialLivePreviewFrame: (args: unknown) =>
    mockGetSequentialLivePreviewFrame(args),
}));

type DrawCall = {
  source: CanvasImageSource;
  alpha: number;
  blend: GlobalCompositeOperation;
};

const createRecordingContext = () => {
  const drawCalls: DrawCall[] = [];
  const stateStack: Array<{ alpha: number; blend: GlobalCompositeOperation }> = [];

  const ctx = {
    globalAlpha: 1,
    globalCompositeOperation: 'source-over' as GlobalCompositeOperation,
    save: jest.fn(() => {
      stateStack.push({
        alpha: ctx.globalAlpha,
        blend: ctx.globalCompositeOperation,
      });
    }),
    restore: jest.fn(() => {
      const previous = stateStack.pop();
      if (!previous) {
        return;
      }
      ctx.globalAlpha = previous.alpha;
      ctx.globalCompositeOperation = previous.blend;
    }),
    beginPath: jest.fn(),
    rect: jest.fn(),
    clip: jest.fn(),
    drawImage: jest.fn((source: CanvasImageSource) => {
      drawCalls.push({
        source,
        alpha: ctx.globalAlpha,
        blend: ctx.globalCompositeOperation,
      });
    }),
  };

  return { ctx: ctx as unknown as CanvasRenderingContext2D, drawCalls };
};

const createLayer = (overrides: Partial<Layer>): Layer => {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 4;
  return {
    id: overrides.id ?? 'layer',
    name: overrides.name ?? 'layer',
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    locked: false,
    order: 0,
    imageData: null,
    framebuffer: canvas,
    alignment: createDefaultLayerAlignment(),
    layerType: 'normal',
    ...overrides,
  };
};

describe('drawVisibleCompositeStack', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSequentialLivePreviewFrame.mockReturnValue(null);
  });

  it('draws static, color-cycle, and sequential segments in order with layer blend and opacity', () => {
    const staticCanvas = document.createElement('canvas');
    const ccCanvas = document.createElement('canvas');
    const seqCanvas = document.createElement('canvas');
    const compositeCanvas = document.createElement('canvas');

    mockGetState.mockReturnValue({
      project: { width: 16, height: 16 },
      colorCyclePlayback: { desiredPlaying: false },
      layers: [],
      sequentialRecord: { currentFrame: 7 },
    });
    mockGetSequentialLayerRenderCanvas.mockReturnValue(seqCanvas);

    const segments: CompositeSegment[] = [
      {
        kind: 'static',
        id: 'static-1',
        layerIds: ['layer-static'],
        includeBackground: true,
        orderRange: { start: 0, end: 0 },
        canvas: staticCanvas,
        bitmap: null,
        dirty: false,
      },
      {
        kind: 'color-cycle',
        id: 'cc-1',
        layerId: 'layer-cc',
        blendMode: 'multiply',
        opacity: 0.4,
      },
      {
        kind: 'sequential',
        id: 'seq-1',
        layerId: 'layer-seq',
        blendMode: 'screen',
        opacity: 0.7,
      },
    ];

    const layerMap = new Map<string, Layer>([
      [
        'layer-cc',
        createLayer({
          id: 'layer-cc',
          layerType: 'color-cycle',
          colorCycleData: {
            canvas: ccCanvas,
          },
        }),
      ],
      [
        'layer-seq',
        createLayer({
          id: 'layer-seq',
          layerType: 'sequential',
          sequentialData: {
            frameCount: 12,
            fps: 12,
            durationMs: 1000,
            events: [],
          },
        }),
      ],
    ]);

    const { ctx, drawCalls } = createRecordingContext();

    drawVisibleCompositeStack({
      ctx,
      visibleRect: { x: 0, y: 0, width: 16, height: 16 },
      useSplitOverlay: false,
      underCompositeCanvas: null,
      isActivelyErasing: false,
      drawNonActiveVisibleLayers: jest.fn(),
      segments,
      layerMap,
      compositeBitmap: null,
      compositeCanvas,
    });

    expect(drawCalls).toHaveLength(3);
    expect(drawCalls[0]).toEqual({
      source: staticCanvas,
      alpha: 1,
      blend: 'source-over',
    });
    expect(drawCalls[1]).toEqual({
      source: ccCanvas,
      alpha: 0.4,
      blend: 'multiply',
    });
    expect(drawCalls[2]).toEqual({
      source: seqCanvas,
      alpha: 0.7,
      blend: 'screen',
    });

    expect(mockGetSequentialLayerRenderCanvas).toHaveBeenCalledWith({
      layer: layerMap.get('layer-seq'),
      width: 16,
      height: 16,
      frameIndex: 7,
      holdPreviousOnEmptyFrames: true,
    });
  });

  it('keeps sequential-below-cc blend ordering stable across playback and capture draws', () => {
    const ccCanvas = document.createElement('canvas');
    const seqCanvas = document.createElement('canvas');
    const compositeCanvas = document.createElement('canvas');

    mockGetState
      .mockReturnValueOnce({
        project: { width: 16, height: 16 },
        colorCyclePlayback: { desiredPlaying: true },
        layers: [{ layerType: 'sequential' }, { layerType: 'color-cycle' }],
        sequentialRecord: { currentFrame: 2, isCaptureActive: false },
      })
      .mockReturnValueOnce({
        project: { width: 16, height: 16 },
        colorCyclePlayback: { desiredPlaying: true },
        layers: [{ layerType: 'sequential' }, { layerType: 'color-cycle' }],
        sequentialRecord: { currentFrame: 3, isCaptureActive: true },
      });
    mockGetSequentialLayerRenderCanvas.mockReturnValue(seqCanvas);

    const segments: CompositeSegment[] = [
      {
        kind: 'sequential',
        id: 'seq-1',
        layerId: 'layer-seq',
        blendMode: 'screen',
        opacity: 0.65,
      },
      {
        kind: 'color-cycle',
        id: 'cc-1',
        layerId: 'layer-cc',
        blendMode: 'multiply',
        opacity: 0.45,
      },
    ];

    const layerMap = new Map<string, Layer>([
      [
        'layer-seq',
        createLayer({
          id: 'layer-seq',
          layerType: 'sequential',
          sequentialData: {
            frameCount: 12,
            fps: 12,
            durationMs: 1000,
            events: [],
          },
        }),
      ],
      [
        'layer-cc',
        createLayer({
          id: 'layer-cc',
          layerType: 'color-cycle',
          colorCycleData: {
            canvas: ccCanvas,
          },
        }),
      ],
    ]);

    const firstPass = createRecordingContext();
    drawVisibleCompositeStack({
      ctx: firstPass.ctx,
      visibleRect: { x: 0, y: 0, width: 16, height: 16 },
      useSplitOverlay: false,
      underCompositeCanvas: null,
      isActivelyErasing: false,
      drawNonActiveVisibleLayers: jest.fn(),
      segments,
      layerMap,
      compositeBitmap: null,
      compositeCanvas,
    });

    const secondPass = createRecordingContext();
    drawVisibleCompositeStack({
      ctx: secondPass.ctx,
      visibleRect: { x: 0, y: 0, width: 16, height: 16 },
      useSplitOverlay: false,
      underCompositeCanvas: null,
      isActivelyErasing: false,
      drawNonActiveVisibleLayers: jest.fn(),
      segments,
      layerMap,
      compositeBitmap: null,
      compositeCanvas,
    });

    expect(firstPass.drawCalls).toHaveLength(2);
    expect(firstPass.drawCalls[0]).toEqual({
      source: seqCanvas,
      alpha: 0.65,
      blend: 'screen',
    });
    expect(firstPass.drawCalls[1]).toEqual({
      source: ccCanvas,
      alpha: 0.45,
      blend: 'multiply',
    });

    expect(secondPass.drawCalls).toHaveLength(2);
    expect(secondPass.drawCalls[0]).toEqual({
      source: seqCanvas,
      alpha: 0.65,
      blend: 'screen',
    });
    expect(secondPass.drawCalls[1]).toEqual({
      source: ccCanvas,
      alpha: 0.45,
      blend: 'multiply',
    });

    expect(mockGetSequentialLayerRenderCanvas).toHaveBeenNthCalledWith(1, {
      layer: layerMap.get('layer-seq'),
      width: 16,
      height: 16,
      frameIndex: 2,
      holdPreviousOnEmptyFrames: false,
    });
    expect(mockGetSequentialLayerRenderCanvas).toHaveBeenNthCalledWith(2, {
      layer: layerMap.get('layer-seq'),
      width: 16,
      height: 16,
      frameIndex: 3,
      holdPreviousOnEmptyFrames: false,
    });
  });

  it('skips hidden sequential layers and does not draw sequential segment when no render canvas exists', () => {
    const staticCanvas = document.createElement('canvas');
    const compositeCanvas = document.createElement('canvas');

    mockGetState.mockReturnValue({
      project: { width: 16, height: 16 },
      colorCyclePlayback: { desiredPlaying: false },
      layers: [],
      sequentialRecord: { currentFrame: 3 },
    });
    mockGetSequentialLayerRenderCanvas.mockReturnValue(null);

    const segments: CompositeSegment[] = [
      {
        kind: 'static',
        id: 'static-1',
        layerIds: ['layer-static'],
        includeBackground: true,
        orderRange: { start: 0, end: 0 },
        canvas: staticCanvas,
        bitmap: null,
        dirty: false,
      },
      {
        kind: 'sequential',
        id: 'seq-1',
        layerId: 'layer-seq-hidden',
        blendMode: 'screen',
        opacity: 0.7,
      },
    ];

    const layerMap = new Map<string, Layer>([
      [
        'layer-seq-hidden',
        createLayer({
          id: 'layer-seq-hidden',
          visible: false,
          layerType: 'sequential',
          sequentialData: {
            frameCount: 12,
            fps: 12,
            durationMs: 1000,
            events: [],
          },
        }),
      ],
    ]);

    const { ctx, drawCalls } = createRecordingContext();

    drawVisibleCompositeStack({
      ctx,
      visibleRect: { x: 0, y: 0, width: 16, height: 16 },
      useSplitOverlay: false,
      underCompositeCanvas: null,
      isActivelyErasing: false,
      drawNonActiveVisibleLayers: jest.fn(),
      segments,
      layerMap,
      compositeBitmap: null,
      compositeCanvas,
    });

    expect(drawCalls).toHaveLength(1);
    expect(drawCalls[0].source).toBe(staticCanvas);
    expect(mockGetSequentialLayerRenderCanvas).not.toHaveBeenCalled();
  });

  it('flags invalid composite bitmaps without throwing when drawImage hits InvalidStateError', () => {
    const compositeBitmap = {} as ImageBitmap;
    const compositeCanvas = document.createElement('canvas');
    const invalidStateError = {
      message: 'stale bitmap',
      name: 'InvalidStateError',
    };
    const { ctx } = createRecordingContext();

    (ctx.drawImage as jest.Mock).mockImplementationOnce(() => {
      throw invalidStateError;
    });

    const result = drawVisibleCompositeStack({
      ctx,
      visibleRect: { x: 0, y: 0, width: 16, height: 16 },
      useSplitOverlay: false,
      underCompositeCanvas: null,
      isActivelyErasing: false,
      drawNonActiveVisibleLayers: jest.fn(),
      segments: [],
      layerMap: new Map(),
      compositeBitmap,
      compositeCanvas,
    });

    expect(result.invalidCompositeBitmap).toBe(true);
  });

  it('does not draw stale full-composite fallback during active sequential capture', () => {
    const compositeCanvas = document.createElement('canvas');
    const { ctx, drawCalls } = createRecordingContext();

    mockGetState.mockReturnValue({
      project: { width: 16, height: 16 },
      colorCyclePlayback: { desiredPlaying: false },
      layers: [{ layerType: 'sequential' }],
      activeLayerId: 'layer-seq',
      sequentialRecord: { currentFrame: 4, isPointerDown: true },
    });

    const result = drawVisibleCompositeStack({
      ctx,
      visibleRect: { x: 0, y: 0, width: 16, height: 16 },
      useSplitOverlay: false,
      underCompositeCanvas: null,
      isActivelyErasing: false,
      drawNonActiveVisibleLayers: jest.fn(),
      segments: [],
      layerMap: new Map([
        [
          'layer-seq',
          createLayer({
            id: 'layer-seq',
            layerType: 'sequential',
            sequentialData: {
              frameCount: 12,
              fps: 12,
              durationMs: 1000,
              events: [],
            },
          }),
        ],
      ]),
      compositeBitmap: null,
      compositeCanvas,
    });

    expect(result.invalidCompositeBitmap).toBe(false);
    expect(drawCalls).toHaveLength(0);
  });

  it('allows full-composite fallback when pointer is down on a non-sequential layer', () => {
    const compositeCanvas = document.createElement('canvas');
    const { ctx, drawCalls } = createRecordingContext();

    mockGetState.mockReturnValue({
      project: { width: 16, height: 16 },
      colorCyclePlayback: { desiredPlaying: false },
      layers: [{ layerType: 'normal' }],
      activeLayerId: 'layer-normal',
      sequentialRecord: { currentFrame: 4, isPointerDown: true },
    });

    const layer = createLayer({
      id: 'layer-normal',
      layerType: 'normal',
    });

    const result = drawVisibleCompositeStack({
      ctx,
      visibleRect: { x: 0, y: 0, width: 16, height: 16 },
      useSplitOverlay: false,
      underCompositeCanvas: null,
      isActivelyErasing: false,
      drawNonActiveVisibleLayers: jest.fn(),
      segments: [],
      layerMap: new Map([[layer.id, layer]]),
      compositeBitmap: null,
      compositeCanvas,
    });

    expect(result.invalidCompositeBitmap).toBe(false);
    expect(drawCalls).toHaveLength(1);
    expect(drawCalls[0].source).toBe(compositeCanvas);
  });

  it('draws active sequential preview fallback when segments are not ready during capture', () => {
    const compositeCanvas = document.createElement('canvas');
    const seqCanvas = document.createElement('canvas');
    const livePreviewCanvas = document.createElement('canvas');
    const { ctx, drawCalls } = createRecordingContext();
    const drawNonActiveVisibleLayers = jest.fn();

    mockGetState.mockReturnValue({
      project: { width: 16, height: 16 },
      colorCyclePlayback: { desiredPlaying: false },
      layers: [{ layerType: 'sequential' }],
      activeLayerId: 'layer-seq',
      sequentialRecord: { currentFrame: 4, isPointerDown: true, sessionStartMs: 1000 },
    });
    mockGetSequentialLivePreviewFrame.mockReturnValue({
      canvas: livePreviewCanvas,
      bounds: { x: 2, y: 3, width: 10, height: 8 },
    });
    mockGetSequentialLayerRenderCanvas.mockReturnValue(seqCanvas);

    const layer = createLayer({
      id: 'layer-seq',
      layerType: 'sequential',
      opacity: 0.6,
      blendMode: 'multiply',
      sequentialData: {
        frameCount: 12,
        fps: 12,
        durationMs: 1000,
        events: [],
      },
    });

    const result = drawVisibleCompositeStack({
      ctx,
      visibleRect: { x: 0, y: 0, width: 16, height: 16 },
      useSplitOverlay: false,
      underCompositeCanvas: null,
      isActivelyErasing: false,
      drawNonActiveVisibleLayers,
      segments: [],
      layerMap: new Map([[layer.id, layer]]),
      compositeBitmap: null,
      compositeCanvas,
    });

    expect(result.invalidCompositeBitmap).toBe(false);
    expect(drawNonActiveVisibleLayers).toHaveBeenCalledWith(ctx);
    expect(mockGetSequentialLivePreviewFrame).toHaveBeenCalledWith({
      layerId: 'layer-seq',
      sessionKey: 'layer-seq:1000',
      width: 16,
      height: 16,
      frameIndex: 4,
      frameCount: 12,
    });
    expect(mockGetSequentialLayerRenderCanvas).toHaveBeenCalledWith({
      layer,
      width: 16,
      height: 16,
      frameIndex: 4,
      holdPreviousOnEmptyFrames: true,
    });
    expect(drawCalls).toHaveLength(2);
    expect(drawCalls[0]).toEqual({
      source: seqCanvas,
      alpha: 0.6,
      blend: 'multiply',
    });
    expect(drawCalls[1]).toEqual({
      source: livePreviewCanvas,
      alpha: 0.6,
      blend: 'multiply',
    });
  });
});
