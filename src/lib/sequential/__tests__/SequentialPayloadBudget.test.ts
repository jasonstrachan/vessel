import { BrushShape, type Layer, type SequentialStrokeEvent } from '@/types';
import {
  appendSequentialEventPayloadBytes,
  createSequentialPayloadBudgetRuntime,
  estimateSequentialProjectPayloadBytes,
  estimateSequentialStrokeEventPayloadBytes,
  readSequentialProjectPayloadBytes,
} from '@/lib/sequential/SequentialPayloadBudget';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

const createEvent = (id: string, stampCount: number): SequentialStrokeEvent => ({
  id,
  layerId: 'layer-seq',
  strokeId: 'stroke-1',
  timestampMs: 10,
  frameIndex: 0,
  brush: {
    tool: 'brush',
    brushShape: BrushShape.ROUND,
    size: 8,
    opacity: 1,
    blendMode: 'source-over',
    rotation: 0,
    spacing: 1,
    color: '#ff0000',
    customStampId: null,
  },
  stamps: Array.from({ length: stampCount }, (_, index) => ({
    x: index,
    y: index,
    pressure: 1,
    rotation: 0,
    size: 8,
    alpha: 1,
  })),
});

const createLayer = (events: SequentialStrokeEvent[]): Layer => {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;

  return {
    id: 'layer-seq',
    name: 'layer-seq',
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
      frameCount: 12,
      fps: 12,
      durationMs: 1000,
      events,
    },
  };
};

describe('SequentialPayloadBudget', () => {
  it('scales event payload estimate by stamp count', () => {
    const singleStamp = estimateSequentialStrokeEventPayloadBytes(createEvent('a', 1));
    const tenStamps = estimateSequentialStrokeEventPayloadBytes(createEvent('b', 10));

    expect(tenStamps).toBeGreaterThan(singleStamp);
    expect(tenStamps - singleStamp).toBeGreaterThan(0);
  });

  it('includes plugin config strings in payload estimates', () => {
    const base = createEvent('plugin-base', 1);
    const withPluginConfig: SequentialStrokeEvent = {
      ...base,
      brush: {
        ...base.brush,
        pluginBrushId: 'spam-brush',
        pluginConfig: {
          spamFont: 'courier',
          spamContentType: 'mixed',
          spamCustomText: 'LIMITED TIME OFFER',
          ditherAlgorithm: 'pattern',
          ditherIntensity: 42,
          ditherBayerMatrixSize: 8,
          particleDensity: 52,
          particleScatterRadius: 2.4,
          customNibMode: 'spray-v2',
          customSeed: 1337,
          customEnabled: true,
        },
      },
    };

    expect(estimateSequentialStrokeEventPayloadBytes(withPluginConfig)).toBeGreaterThan(
      estimateSequentialStrokeEventPayloadBytes(base)
    );
  });

  it('tracks payload bytes incrementally when appending events', () => {
    const firstEvent = createEvent('first', 2);
    const layer = createLayer([firstEvent]);
    const runtime = createSequentialPayloadBudgetRuntime();

    const baseBytes = readSequentialProjectPayloadBytes({
      layers: [layer],
      runtime,
    });
    expect(baseBytes).toBe(estimateSequentialProjectPayloadBytes([layer]));

    const nextEvent = createEvent('second', 3);
    const nextBytes = appendSequentialEventPayloadBytes({
      layerId: layer.id,
      event: nextEvent,
      runtime,
    });

    const layerWithNextEvent = createLayer([firstEvent, nextEvent]);
    expect(nextBytes).toBe(estimateSequentialProjectPayloadBytes([layerWithNextEvent]));
  });
});
