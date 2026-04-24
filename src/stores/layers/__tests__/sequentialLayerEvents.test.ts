import {
  appendSequentialLayerEventsToLayers,
  normalizeSequentialLayerMetadata,
  resetSequentialAppendLayerIndexCache,
  resolveSequentialAppendLayerIndex,
} from '@/stores/layers/sequentialLayerEvents';
import { BrushShape, type Layer, type SequentialStrokeEvent } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

const createLayer = (id: string, layerType: Layer['layerType']): Layer => ({
  id,
  name: id,
  visible: true,
  opacity: 1,
  blendMode: 'source-over',
  locked: false,
  order: 0,
  imageData: null,
  framebuffer: document.createElement('canvas'),
  alignment: createDefaultLayerAlignment(),
  layerType,
  sequentialData:
    layerType === 'sequential'
      ? {
          frameCount: 2,
          fps: 12,
          durationMs: 167,
          events: [],
        }
      : undefined,
});

const createEvent = (id: string): SequentialStrokeEvent => ({
  id,
  layerId: 'seq',
  strokeId: id,
  timestampMs: 0,
  frameIndex: 0,
  brush: {
    tool: 'brush',
    brushShape: BrushShape.ROUND,
    size: 1,
    opacity: 1,
    blendMode: 'source-over',
    rotation: 0,
    spacing: 1,
    color: '#000000',
    customStampId: null,
    customStampHash: null,
    customStamp: null,
    ditherEnabled: false,
  },
  stamps: [],
});

describe('sequentialLayerEvents', () => {
  beforeEach(() => {
    resetSequentialAppendLayerIndexCache();
  });

  it('resolves sequential layer indices and rejects non-sequential layers', () => {
    const layers = [createLayer('normal', 'normal'), createLayer('seq', 'sequential')];

    expect(resolveSequentialAppendLayerIndex(layers, 'seq')).toBe(1);
    expect(resolveSequentialAppendLayerIndex(layers, 'normal')).toBe(-1);
    expect(resolveSequentialAppendLayerIndex(layers, 'missing')).toBe(-1);
  });

  it('normalizes sequential metadata', () => {
    expect(normalizeSequentialLayerMetadata({
      frameCount: 0.2,
      fps: 12.7,
      durationMs: -10,
    })).toEqual({
      frameCount: 1,
      fps: 13,
      durationMs: 1,
    });
  });

  it('appends events and replaces only the target layer', () => {
    const normal = createLayer('normal', 'normal');
    const sequential = createLayer('seq', 'sequential');
    const layers = [normal, sequential];

    const result = appendSequentialLayerEventsToLayers(
      layers,
      'seq',
      [createEvent('event-1')],
      { frameCount: 24.4, fps: 23.5, durationMs: 999.2 }
    );

    expect(result.didAppend).toBe(true);
    expect(result.layers).not.toBe(layers);
    expect(result.layers[0]).toBe(normal);
    expect(result.layers[1]).not.toBe(sequential);
    expect(result.layers[1].sequentialData).toMatchObject({
      frameCount: 24,
      fps: 24,
      durationMs: 999,
    });
    expect(result.layers[1].sequentialData?.events.map((event) => event.id)).toEqual(['event-1']);
  });

  it('does not append when there are no events or no sequential target', () => {
    const layers = [createLayer('normal', 'normal')];

    expect(
      appendSequentialLayerEventsToLayers(
        layers,
        'normal',
        [createEvent('event-1')],
        { frameCount: 12, fps: 12, durationMs: 1000 }
      )
    ).toEqual({ didAppend: false, layers });

    expect(
      appendSequentialLayerEventsToLayers(
        layers,
        'normal',
        [],
        { frameCount: 12, fps: 12, durationMs: 1000 }
      )
    ).toEqual({ didAppend: false, layers });
  });
});
