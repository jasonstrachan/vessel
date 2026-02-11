import { BrushShape, type Layer, type SequentialStrokeEvent } from '@/types';
import { setFeatureFlag } from '@/config/featureFlags';
import {
  clearSequentialLayerRendererAll,
  getSequentialLayerRenderCanvas,
  getSequentialLayerRendererStats,
} from '@/lib/sequential/SequentialLayerRenderer';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

const createEvent = (
  id: string,
  frameIndex: number,
  color: string
): SequentialStrokeEvent => ({
  id,
  layerId: 'layer-seq',
  strokeId: 'stroke-1',
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
});

const createLayer = (events: SequentialStrokeEvent[]): Layer => {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;

  return {
    id: 'layer-seq',
    name: 'SEQ',
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    locked: false,
    order: 0,
    imageData: null,
    framebuffer: canvas,
    alignment: createDefaultLayerAlignment(),
    layerType: 'sequential',
    sequentialData: {
      frameCount: 2,
      fps: 12,
      durationMs: 167,
      events,
    },
  };
};

const createLayerWithFrameCount = (
  events: SequentialStrokeEvent[],
  frameCount: number
): Layer => {
  const layer = createLayer(events);
  return {
    ...layer,
    sequentialData: {
      ...layer.sequentialData!,
      frameCount,
      durationMs: Math.round((frameCount * 1000) / Math.max(1, layer.sequentialData?.fps ?? 12)),
    },
  };
};

const readCenterPixel = (
  canvas: HTMLCanvasElement | OffscreenCanvas
): [number, number, number, number] => {
  const ctx = canvas.getContext('2d');
  if (!ctx || typeof (ctx as CanvasRenderingContext2D).getImageData !== 'function') {
    return [0, 0, 0, 0];
  }
  const sample = (ctx as CanvasRenderingContext2D).getImageData(8, 8, 1, 1).data;
  return [sample[0], sample[1], sample[2], sample[3]];
};

describe('SequentialLayerRenderer', () => {
  beforeEach(() => {
    setFeatureFlag('enableSequentialGpuAcceleration', false);
    clearSequentialLayerRendererAll();
  });

  afterEach(() => {
    setFeatureFlag('enableSequentialGpuAcceleration', false);
  });

  it('materializes frame-specific canvases and updates cache stats', () => {
    const layer = createLayer([
      createEvent('f0', 0, '#ff0000'),
      createEvent('f1', 1, '#00ff00'),
    ]);

    const frame0 = getSequentialLayerRenderCanvas({
      layer,
      width: 16,
      height: 16,
      frameIndex: 0,
    });
    expect(frame0).not.toBeNull();
    const p0 = readCenterPixel(frame0!);

    const frame1 = getSequentialLayerRenderCanvas({
      layer,
      width: 16,
      height: 16,
      frameIndex: 1,
    });
    expect(frame1).not.toBeNull();
    const p1 = readCenterPixel(frame1!);
    expect(p0[0]).toBeGreaterThan(p0[1]);
    expect(p1[1]).toBeGreaterThan(p1[0]);

    const statsAfterMisses = getSequentialLayerRendererStats();
    expect(statsAfterMisses.entries).toBeGreaterThan(0);
    expect(statsAfterMisses.misses).toBeGreaterThan(0);

    void getSequentialLayerRenderCanvas({
      layer,
      width: 16,
      height: 16,
      frameIndex: 1,
    });
    const statsAfterHit = getSequentialLayerRendererStats();
    expect(statsAfterHit.hits).toBeGreaterThan(statsAfterMisses.hits);
  });

  it('falls back to CPU materializer when GPU backend is unavailable', () => {
    setFeatureFlag('enableSequentialGpuAcceleration', true);
    const layer = createLayer([createEvent('f0', 0, '#ff0000')]);

    const canvas = getSequentialLayerRenderCanvas({
      layer,
      width: 16,
      height: 16,
      frameIndex: 0,
    });

    expect(canvas).not.toBeNull();
    const pixel = readCenterPixel(canvas!);
    expect(pixel[3]).toBeGreaterThan(0);
    expect(pixel[0]).toBeGreaterThan(pixel[1]);
  });

  it('keeps sequential frame cache bounded under long multi-frame playback workloads', () => {
    const frameCount = 220;
    const events = Array.from({ length: frameCount }, (_, frameIndex) =>
      createEvent(`f-${frameIndex}`, frameIndex, frameIndex % 2 === 0 ? '#ff0000' : '#00ff00')
    );
    const layer = createLayerWithFrameCount(events, frameCount);

    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      const canvas = getSequentialLayerRenderCanvas({
        layer,
        width: 16,
        height: 16,
        frameIndex,
      });
      expect(canvas).not.toBeNull();
    }

    const statsAfterWarmup = getSequentialLayerRendererStats();
    expect(statsAfterWarmup.entries).toBeLessThanOrEqual(128);

    for (let frameIndex = frameCount; frameIndex < frameCount + 80; frameIndex += 1) {
      const canvas = getSequentialLayerRenderCanvas({
        layer,
        width: 16,
        height: 16,
        frameIndex,
      });
      expect(canvas).not.toBeNull();
    }

    const statsAfterStress = getSequentialLayerRendererStats();
    expect(statsAfterStress.entries).toBeLessThanOrEqual(128);
    expect(statsAfterStress.misses).toBeGreaterThan(0);
  });

  it('patches cached frame tiles incrementally when appending events to an existing frame', () => {
    const initialLayer = createLayer([createEvent('f0-initial', 0, '#ff0000')]);

    const first = getSequentialLayerRenderCanvas({
      layer: initialLayer,
      width: 16,
      height: 16,
      frameIndex: 0,
    });
    expect(first).not.toBeNull();
    const statsAfterFirst = getSequentialLayerRendererStats();

    const appendedLayer: Layer = {
      ...initialLayer,
      sequentialData: {
        ...initialLayer.sequentialData!,
        events: [
          ...initialLayer.sequentialData!.events,
          createEvent('f0-appended', 0, '#00ff00'),
        ],
      },
    };

    const second = getSequentialLayerRenderCanvas({
      layer: appendedLayer,
      width: 16,
      height: 16,
      frameIndex: 0,
    });
    expect(second).not.toBeNull();
    const statsAfterSecond = getSequentialLayerRendererStats();

    expect(statsAfterSecond.misses).toBe(statsAfterFirst.misses);
    expect(statsAfterSecond.hits).toBeGreaterThan(statsAfterFirst.hits);
  });

  it('renders preview events transiently without mutating committed frame cache output', () => {
    const layer = createLayer([createEvent('f0-base', 0, '#ff0000')]);

    const committed = getSequentialLayerRenderCanvas({
      layer,
      width: 16,
      height: 16,
      frameIndex: 0,
    });
    expect(committed).not.toBeNull();
    const committedPixel = readCenterPixel(committed!);
    expect(committedPixel[0]).toBeGreaterThan(committedPixel[1]);

    const previewCanvas = getSequentialLayerRenderCanvas({
      layer,
      width: 16,
      height: 16,
      frameIndex: 0,
      previewEvents: [createEvent('f0-preview', 0, '#00ff00')],
    });
    expect(previewCanvas).not.toBeNull();
    const previewPixel = readCenterPixel(previewCanvas!);
    expect(previewPixel[1]).toBeGreaterThan(previewPixel[0]);

    const committedAgain = getSequentialLayerRenderCanvas({
      layer,
      width: 16,
      height: 16,
      frameIndex: 0,
    });
    expect(committedAgain).not.toBeNull();
    const committedAgainPixel = readCenterPixel(committedAgain!);
    expect(committedAgainPixel[0]).toBeGreaterThan(committedAgainPixel[1]);
  });

  it('holds the most recent stamped frame briefly when the current frame is empty', () => {
    const layer = createLayerWithFrameCount([createEvent('f0', 0, '#ff0000')], 4);

    const immediateNext = getSequentialLayerRenderCanvas({
      layer,
      width: 16,
      height: 16,
      frameIndex: 1,
    });
    expect(immediateNext).not.toBeNull();
    const immediatePixel = readCenterPixel(immediateNext!);
    expect(immediatePixel[3]).toBeGreaterThan(0);
    expect(immediatePixel[0]).toBeGreaterThan(immediatePixel[1]);

    const fartherFrame = getSequentialLayerRenderCanvas({
      layer,
      width: 16,
      height: 16,
      frameIndex: 3,
    });
    expect(fartherFrame).not.toBeNull();
    const fartherPixel = readCenterPixel(fartherFrame!);
    expect(fartherPixel[3]).toBe(0);
  });
});
