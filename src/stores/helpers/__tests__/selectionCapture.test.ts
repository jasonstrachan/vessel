import { BrushShape, type Layer, type Project, type SequentialStrokeEvent } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import { setFeatureFlag } from '@/config/featureFlags';
import { clearSequentialLayerRendererAll, getSequentialLayerRenderCanvas } from '@/lib/sequential/SequentialLayerRenderer';
import { setSequentialFrameCursor } from '@/runtime/playback/sequentialFrameCursor';
import type { AppState } from '@/stores/useAppStore';

const mockGetDocument = jest.fn<unknown | null, [string]>(() => null);

jest.mock('@/stores/colorCycleBrushManager', () => ({
  __esModule: true,
  setColorCycleStoreStateGetter: jest.fn(),
  setLayerIdGetter: jest.fn(),
  getColorCycleBrushManager: () => ({
    getDocument: (layerId: string) => mockGetDocument(layerId),
  }),
}));

const { attachLegacyColorCycleTopLevelBuffers } = jest.requireActual(
  '@/lib/colorCycle/document',
) as typeof import('@/lib/colorCycle/document');

import {
  captureSelectionBitmap,
  captureSelectionBitmapFromMask,
  resolveLayerImageData,
} from '@/stores/helpers/selectionCapture';

const createProject = (): Project => ({
  id: 'project-selection-capture',
  name: 'Selection Capture',
  width: 4,
  height: 4,
  layers: [],
  backgroundColor: '#000000',
  createdAt: new Date(),
  updatedAt: new Date(),
  customBrushes: [],
});

describe('selectionCapture sequential presentation', () => {
  let sourceState: AppState;
  const canvasMockState = globalThis as typeof globalThis & {
    __VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__?: boolean;
  };
  let previousRasterize: boolean | undefined;

  const createSequentialLayer = (): Layer => {
    const events: SequentialStrokeEvent[] = ['#ff0000', '#0000ff'].map((color, frameIndex) => ({
      id: `selection-frame-${frameIndex}`,
      layerId: 'selection-sequence',
      strokeId: `stroke-${frameIndex}`,
      timestampMs: 0,
      frameIndex,
      brush: {
        tool: 'brush',
        brushShape: BrushShape.ROUND,
        size: 6,
        opacity: 1,
        blendMode: 'source-over',
        rotation: 0,
        spacing: 1,
        color,
        customStampId: null,
      },
      stamps: [{ x: 8, y: 8, pressure: 1, rotation: 0, size: 6, alpha: 1 }],
    }));
    const framebuffer = document.createElement('canvas');
    framebuffer.width = 16;
    framebuffer.height = 16;
    return {
      id: 'selection-sequence',
      name: 'Sequence',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      order: 0,
      imageData: new ImageData(16, 16),
      framebuffer,
      alignment: createDefaultLayerAlignment(),
      layerType: 'sequential',
      sequentialData: { frameCount: 2, fps: 12, durationMs: 167, events },
    };
  };

  beforeEach(() => {
    previousRasterize = canvasMockState.__VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__;
    canvasMockState.__VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__ = true;
    setFeatureFlag('enableSequentialGpuAcceleration', false);
    setFeatureFlag('enableSequentialWorkerMaterialization', false);
    clearSequentialLayerRendererAll();
    setSequentialFrameCursor({ nextFrame: 0, nextFrameCount: 2, nextFps: 12 });
  });

  afterEach(() => {
    canvasMockState.__VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__ = previousRasterize;
    clearSequentialLayerRendererAll();
    setSequentialFrameCursor({ nextFrame: 0, nextFrameCount: 1, nextFps: 12 });
  });

  it.each<[number, number[]]>([
    [0, [255, 0, 0, 255]],
    [1, [0, 0, 255, 255]],
  ])('reads and captures the displayed paused frame %s instead of the blank fallback', (frameIndex, rgba) => {
    const layer = createSequentialLayer();
    const project = { ...createProject(), width: 16, height: 16, layers: [layer] };
    sourceState = {
      project,
      layers: [layer],
      activeLayerId: layer.id,
      sequentialRecord: { currentFrame: frameIndex, isPointerDown: false },
      colorCyclePlayback: { desiredPlaying: false },
    } as AppState;

    const rendered = getSequentialLayerRenderCanvas({ layer, width: 16, height: 16, frameIndex });
    const ctx = rendered?.getContext('2d') as CanvasRenderingContext2D | null;
    expect(Array.from(ctx?.getImageData(8, 8, 1, 1).data ?? [])).toEqual(rgba);
    const resolved = resolveLayerImageData(layer, sourceState);
    expect(resolved?.width).toBe(16);
    expect(resolved?.height).toBe(16);
    expect(Array.from(resolved?.data.slice((8 * 16 + 8) * 4, (8 * 16 + 8) * 4 + 4) ?? [])).toEqual(rgba);
    expect(Array.from(resolved?.data.slice(0, 4) ?? [])).toEqual([0, 0, 0, 0]);

    const capture = captureSelectionBitmap({
      selectionStart: { x: 8, y: 8 },
      selectionEnd: { x: 9, y: 9 },
      project,
      layer,
      sourceState,
    });
    expect(Array.from(capture?.selectionImageData.data ?? [])).toEqual(rgba);
    const maskedCapture = captureSelectionBitmapFromMask({
      mask: new ImageData(new Uint8ClampedArray([0, 0, 0, 255]), 1, 1),
      maskBounds: { x: 8, y: 8, width: 1, height: 1 },
      project,
      layer,
      sourceState,
    });
    expect(Array.from(maskedCapture?.selectionImageData.data ?? [])).toEqual(rgba);
    expect(layer.imageData?.data.every((value) => value === 0)).toBe(true);
  });

  it('uses the playback cursor while playing rather than the paused editing frame', () => {
    const layer = createSequentialLayer();
    sourceState = {
      project: { ...createProject(), width: 16, height: 16 },
      layers: [layer],
      activeLayerId: layer.id,
      sequentialRecord: { currentFrame: 0, isPointerDown: false },
      colorCyclePlayback: { desiredPlaying: true },
    } as AppState;
    setSequentialFrameCursor({ nextFrame: 1, nextFrameCount: 2, nextFps: 12 });

    const resolved = resolveLayerImageData(layer, sourceState);
    expect(Array.from(resolved?.data.slice((8 * 16 + 8) * 4, (8 * 16 + 8) * 4 + 4) ?? [])).toEqual([0, 0, 255, 255]);
  });

  it('includes the held presentation on an empty sequential frame', () => {
    const originalLayer = createSequentialLayer();
    const layer: Layer = {
      ...originalLayer,
      sequentialData: { ...originalLayer.sequentialData!, frameCount: 3 },
    };
    sourceState = {
      project: { ...createProject(), width: 16, height: 16 },
      layers: [layer],
      activeLayerId: layer.id,
      sequentialRecord: { currentFrame: 2, isPointerDown: false },
      colorCyclePlayback: { desiredPlaying: false },
    } as AppState;

    const resolved = resolveLayerImageData(layer, sourceState);
    expect(Array.from(resolved?.data.slice((8 * 16 + 8) * 4, (8 * 16 + 8) * 4 + 4) ?? [])).toEqual([0, 0, 255, 255]);
  });

  it('keeps an empty current frame transparent during playback instead of holding the previous frame', () => {
    const originalLayer = createSequentialLayer();
    const layer: Layer = {
      ...originalLayer,
      sequentialData: { ...originalLayer.sequentialData!, frameCount: 3 },
    };
    sourceState = {
      project: { ...createProject(), width: 16, height: 16 },
      layers: [layer],
      activeLayerId: layer.id,
      sequentialRecord: { currentFrame: 0, isPointerDown: false },
      colorCyclePlayback: { desiredPlaying: true },
    } as AppState;
    setSequentialFrameCursor({ nextFrame: 2, nextFrameCount: 3, nextFps: 12 });

    const rendered = getSequentialLayerRenderCanvas({
      layer,
      width: 16,
      height: 16,
      frameIndex: 2,
      holdPreviousOnEmptyFrames: false,
    });
    const ctx = rendered?.getContext('2d') as CanvasRenderingContext2D | null;
    expect(Array.from(ctx?.getImageData(8, 8, 1, 1).data ?? [])).toEqual([0, 0, 0, 0]);

    const resolved = resolveLayerImageData(layer, sourceState);
    expect(Array.from(resolved?.data.slice((8 * 16 + 8) * 4, (8 * 16 + 8) * 4 + 4) ?? [])).toEqual([0, 0, 0, 0]);
  });

  it('preserves normal imageData priority and color-cycle live canvas priority', () => {
    const layer = createSequentialLayer();
    const liveCanvas = document.createElement('canvas');
    liveCanvas.width = 16;
    liveCanvas.height = 16;
    const liveImage = createOpaqueImage(16, 16);
    liveCanvas.getContext('2d')?.putImageData(liveImage, 0, 0);

    expect(resolveLayerImageData({ ...layer, layerType: 'normal' })).toBe(layer.imageData);
    const resolved = resolveLayerImageData({
      ...layer,
      layerType: 'color-cycle',
      colorCycleData: { canvas: liveCanvas },
    });
    expect(Array.from(resolved?.data.slice(0, 4) ?? [])).toEqual([255, 255, 255, 255]);
  });

  it('retains imageData fallback when no project is available', () => {
    const layer = createSequentialLayer();
    sourceState = { project: null } as AppState;
    expect(resolveLayerImageData(layer, sourceState)).toBe(layer.imageData);
    expect(resolveLayerImageData(layer)).toBe(layer.imageData);
  });
});

const createOpaqueImage = (width: number, height: number): ImageData => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const base = i * 4;
    data[base] = 255;
    data[base + 1] = 255;
    data[base + 2] = 255;
    data[base + 3] = 255;
  }
  return new ImageData(data, width, height);
};

describe('selectionCapture color-cycle fallback', () => {
  afterEach(() => {
    mockGetDocument.mockReset();
    mockGetDocument.mockReturnValue(null);
  });

  it('captures color-cycle indices from persisted gradientIdBuffer when runtime brush is missing', () => {
    const gradientIds = new Uint8Array([
      0, 1, 2, 3,
      4, 5, 6, 7,
      8, 9, 10, 11,
      12, 13, 14, 15,
    ]);
    const layer: Layer = {
      id: 'layer-cc',
      name: 'CC',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      order: 0,
      imageData: createOpaqueImage(4, 4),
      framebuffer: document.createElement('canvas'),
      alignment: createDefaultLayerAlignment(),
      layerType: 'color-cycle',
      colorCycleData: attachLegacyColorCycleTopLevelBuffers({
        canvasWidth: 4,
        canvasHeight: 4,
      }, {
        gradientIdBuffer: gradientIds.buffer.slice(0),
      }),
    };

    const capture = captureSelectionBitmap({
      selectionStart: { x: 1, y: 1 },
      selectionEnd: { x: 3, y: 2 },
      project: createProject(),
      layer,
      clearSource: false,
    });

    expect(capture).not.toBeNull();
    expect(capture?.bounds).toEqual({ x: 1, y: 1, width: 2, height: 1 });
    expect(Array.from(capture?.colorCycleIndices ?? [])).toEqual([5, 6]);
  });

  it('captures full CC payload from the document snapshot', () => {
    mockGetDocument.mockReturnValue({
      read: () => ({
        snapshot: {
          paintBuffer: Uint8Array.from([
            0, 1, 2, 3,
            4, 5, 6, 7,
            8, 9, 10, 11,
            12, 13, 14, 15,
          ]).buffer,
          gradientIdBuffer: Uint8Array.from([
            10, 11, 12, 13,
            14, 15, 16, 17,
            18, 19, 20, 21,
            22, 23, 24, 25,
          ]).buffer,
          gradientDefIdBuffer: Uint16Array.from([
            100, 101, 102, 103,
            104, 105, 106, 107,
            108, 109, 110, 111,
            112, 113, 114, 115,
          ]).buffer,
          speedBuffer: Uint8Array.from([
            30, 31, 32, 33,
            34, 35, 36, 37,
            38, 39, 40, 41,
            42, 43, 44, 45,
          ]).buffer,
          flowBuffer: Uint8Array.from([
            50, 51, 52, 53,
            54, 55, 56, 57,
            58, 59, 60, 61,
            62, 63, 64, 65,
          ]).buffer,
          phaseBuffer: Uint8Array.from([
            70, 71, 72, 73,
            74, 75, 76, 77,
            78, 79, 80, 81,
            82, 83, 84, 85,
          ]).buffer,
          hasContent: true,
        },
        version: 1,
      }),
    });

    const layer: Layer = {
      id: 'layer-cc-live',
      name: 'CC Live',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      order: 0,
      imageData: createOpaqueImage(4, 4),
      framebuffer: document.createElement('canvas'),
      alignment: createDefaultLayerAlignment(),
      layerType: 'color-cycle',
      colorCycleData: {
        canvasWidth: 4,
        canvasHeight: 4,
      },
    };

    const capture = captureSelectionBitmap({
      selectionStart: { x: 1, y: 1 },
      selectionEnd: { x: 3, y: 3 },
      project: createProject(),
      layer,
      clearSource: false,
    });

    expect(capture).not.toBeNull();
    expect(Array.from(capture?.colorCycleIndices ?? [])).toEqual([5, 6, 9, 10]);
    expect(Array.from(capture?.colorCycleGradientIds ?? [])).toEqual([15, 16, 19, 20]);
    expect(Array.from(capture?.colorCycleGradientDefIds ?? [])).toEqual([105, 106, 109, 110]);
    expect(Array.from(capture?.colorCycleSpeed ?? [])).toEqual([35, 36, 39, 40]);
    expect(Array.from(capture?.colorCycleFlow ?? [])).toEqual([55, 56, 59, 60]);
    expect(Array.from(capture?.colorCyclePhase ?? [])).toEqual([75, 76, 79, 80]);
  });
});
