import { isFeatureFlagEnabled, setFeatureFlag } from '@/config/featureFlags';
import {
  clearSequentialLayerRendererAll,
  clearSequentialLayerRendererLayer,
  getSequentialLayerRenderCanvas,
} from '@/lib/sequential/SequentialLayerRenderer';
import { buildSequentialBitmapPasteEvent } from '@/lib/sequential/sequentialEdit';
import { BrushShape, type Layer, type Rectangle, type SequentialStrokeEvent } from '@/types';
import { cropSequentialLayerData } from '@/utils/crop/sequential';
import { readLayerSourcesForCrop } from '@/utils/crop/read';
import { captureSequentialLayerFrameTextures } from '@/utils/export/goblet/gobletSequentialSerializer';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

const paint = (id: string, frameIndex: number, color = '#ff0000'): SequentialStrokeEvent => ({
  id, layerId: 'crop-seq', strokeId: id, timestampMs: frameIndex * 100, frameIndex,
  brush: {
    tool: 'brush', brushShape: BrushShape.SQUARE, size: 12, opacity: 1,
    blendMode: 'source-over', rotation: 0, spacing: 1, color,
  },
  stamps: [{ x: 8, y: 7, pressure: 1, rotation: 0, size: 12, alpha: 1 }],
});

const makeLayer = (events: SequentialStrokeEvent[]): Layer => ({
  id: 'crop-seq', name: 'Sequence', layerType: 'sequential',
  visible: true, opacity: 1, blendMode: 'source-over', locked: false, order: 0,
  imageData: null, framebuffer: document.createElement('canvas'),
  alignment: createDefaultLayerAlignment(),
  sequentialData: { frameCount: 6, fps: 12, durationMs: 500, events },
});

const pixels = (layer: Layer, width: number, height: number, frameIndex: number, hold = false) => {
  clearSequentialLayerRendererLayer(layer.id);
  const canvas = getSequentialLayerRenderCanvas({
    layer, width, height, frameIndex, holdPreviousOnEmptyFrames: hold,
  })!;
  return (canvas.getContext('2d') as CanvasRenderingContext2D).getImageData(0, 0, width, height).data;
};

const project = (source: Uint8ClampedArray, width: number, height: number, rect: Rectangle) => {
  const result = new Uint8ClampedArray(rect.width * rect.height * 4);
  for (let y = 0; y < rect.height; y += 1) {
    for (let x = 0; x < rect.width; x += 1) {
      const sx = rect.x + x;
      const sy = rect.y + y;
      if (sx >= 0 && sy >= 0 && sx < width && sy < height) {
        const from = (sy * width + sx) * 4;
        result.set(source.subarray(from, from + 4), (y * rect.width + x) * 4);
      }
    }
  }
  return result;
};

describe('Sequence crop projection', () => {
  const canvasState = globalThis as typeof globalThis & { __VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__?: boolean };
  let previousRasterize: boolean | undefined;
  let gpu: boolean;
  let worker: boolean;

  beforeEach(() => {
    gpu = isFeatureFlagEnabled('enableSequentialGpuAcceleration');
    worker = isFeatureFlagEnabled('enableSequentialWorkerMaterialization');
    setFeatureFlag('enableSequentialGpuAcceleration', false);
    setFeatureFlag('enableSequentialWorkerMaterialization', false);
    previousRasterize = canvasState.__VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__;
    canvasState.__VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__ = true;
    clearSequentialLayerRendererAll();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    clearSequentialLayerRendererAll();
    setFeatureFlag('enableSequentialGpuAcceleration', gpu);
    setFeatureFlag('enableSequentialWorkerMaterialization', worker);
    canvasState.__VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__ = previousRasterize;
  });

  it.each([
    { x: 3, y: 5, width: 8, height: 6 },
    { x: -3, y: -2, width: 12, height: 11 },
    { x: 3, y: 1, width: 16, height: 16 },
  ])('preserves patterns, clipping, alpha and erasure at %j', (rect) => {
    const pattern = paint('pattern', 1);
    pattern.brush.ditherEnabled = true;
    pattern.brush.ditherAlgorithm = 'bayer';
    pattern.stamps[0].alpha = 0.5;
    pattern.brush.selectionClip = { kind: 'rect', minX: 3, minY: 2, maxX: 13, maxY: 12 };
    const erase = paint('erase', 1);
    erase.brush.tool = 'eraser';
    erase.brush.blendMode = 'destination-out';
    erase.brush.size = 3;
    erase.stamps = [{ x: 6, y: 6, size: 3, pressure: 1, rotation: 0, alpha: 1 }];
    const image = new ImageData(5, 3);
    for (let i = 0; i < image.data.length; i += 4) {
      image.data.set(i % 8 === 0 ? [255, 0, 0, 128] : [0, 0, 0, 0], i);
    }
    const bitmap = buildSequentialBitmapPasteEvent({
      layerId: 'crop-seq', frameIndex: 3, imageData: image,
      bounds: { x: 4, y: 6, width: 5, height: 3 }, timestampMs: 300, id: 'bitmap', strokeId: 'bitmap',
    });
    const layer = makeLayer([pattern, erase, bitmap]);
    layer.sequentialData!.eventChunks = [{ id: 'original-chunk', startEventIndex: 0, eventCount: 3, frameIndexes: [1, 3] }];
    const original = JSON.stringify(layer.sequentialData);
    const before = [1, 3].map((frame) => pixels(layer, 16, 16, frame));
    const data = cropSequentialLayerData({ layer, sourceWidth: 16, sourceHeight: 16, rect })!;
    expect(data).toMatchObject({ frameCount: 6, fps: 12, durationMs: 500 });
    expect(data.events.map((event) => event.frameIndex)).toEqual([1, 3]);
    expect(data.eventChunks).toEqual([{ id: expect.any(String), startEventIndex: 0, eventCount: 2, frameIndexes: [1, 3] }]);
    expect(data.eventChunks![0].id).not.toBe('original-chunk');
    expect(data.events.every((event) => !layer.sequentialData!.events.some((old) => old.id === event.id))).toBe(true);
    const cropped = { ...layer, sequentialData: data };
    for (const [index, frame] of [1, 3].entries()) {
      expect(pixels(cropped, rect.width, rect.height, frame)).toEqual(project(before[index], 16, 16, rect));
    }
    expect(JSON.stringify(layer.sequentialData)).toBe(original);
  });

  it('keeps absent frames absent and cropped-away authored frames explicitly blank for held playback', () => {
    const inside = paint('inside', 1);
    const outside = paint('outside', 3, '#00ff00');
    outside.stamps = [{ x: 15, y: 15, size: 2, pressure: 1, rotation: 0, alpha: 1 }];
    const layer = makeLayer([inside, outside]);
    const rect = { x: 2, y: 2, width: 8, height: 8 };
    const before = [0, 1, 2, 3, 4, 5].map((frame) => pixels(layer, 16, 16, frame, true));
    const cropped = { ...layer, sequentialData: cropSequentialLayerData({ layer, sourceWidth: 16, sourceHeight: 16, rect }) };
    expect(cropped.sequentialData!.events.map((event) => event.frameIndex)).toEqual([1, 3]);
    for (let frame = 0; frame < 6; frame += 1) {
      expect(pixels(cropped, 8, 8, frame, true)).toEqual(project(before[frame], 16, 16, rect));
    }
    expect(pixels(cropped, 8, 8, 2, true).some((value) => value > 0)).toBe(true);
    expect(pixels(cropped, 8, 8, 4, true).some((value) => value > 0)).toBe(false);
  });

  it('invalidates a warm same-size frame cache and reads source dimensions from the crop contract', () => {
    const layer = makeLayer([paint('red', 0)]);
    const rect = { x: 4, y: 3, width: 16, height: 16 };
    const source = pixels(layer, 16, 16, 0);
    const { updatedLayer } = readLayerSourcesForCrop(layer, rect, {
      activeLayerId: layer.id, sourceWidth: 16, sourceHeight: 16,
    });
    // Deliberately retain the renderer cache here: publication must invalidate it.
    const result = getSequentialLayerRenderCanvas({ layer: updatedLayer, width: 16, height: 16, frameIndex: 0 })!;
    expect((result.getContext('2d') as CanvasRenderingContext2D).getImageData(0, 0, 16, 16).data)
      .toEqual(project(source, 16, 16, rect));
  });

  it('exports cropped authored and absent frames through the Goblet serializer', async () => {
    const layer = makeLayer([paint('red', 1), paint('green', 3, '#00ff00')]);
    const rect = { x: 3, y: 4, width: 7, height: 5 };
    const expected = Array.from({ length: 6 }, (_, frame) => project(pixels(layer, 16, 16, frame), 16, 16, rect));
    const cropped = { ...layer, sequentialData: cropSequentialLayerData({ layer, sourceWidth: 16, sourceHeight: 16, rect }) };
    const encoded: Uint8ClampedArray[] = [];
    jest.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, callback, type) {
      const bytes = this.getContext('2d')!.getImageData(0, 0, this.width, this.height).data.slice();
      encoded.push(bytes);
      callback(new Blob([new Uint8Array(bytes)], { type: type ?? 'image/png' }));
    });
    const result = await captureSequentialLayerFrameTextures({
      layer: cropped, width: rect.width, height: rect.height, frameCount: 6,
    });
    expect(encoded).toEqual(expected);
    expect(result?.sourceSize).toEqual({ width: 7, height: 5 });
  });

  it('preserves an empty Sequence timeline', () => {
    const layer = makeLayer([]);
    expect(cropSequentialLayerData({
      layer, sourceWidth: 16, sourceHeight: 16, rect: { x: -1, y: -1, width: 4, height: 4 },
    })).toEqual(layer.sequentialData);
  });
});
