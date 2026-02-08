import { BrushShape, type SequentialStrokeEvent } from '@/types';
import { SequentialEventLog } from '@/lib/sequential/SequentialEventLog';

const createEvent = (id: string, frameIndex: number, stampCount = 1): SequentialStrokeEvent => ({
  id,
  layerId: 'layer-1',
  strokeId: 'stroke-1',
  timestampMs: 10,
  frameIndex,
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

describe('SequentialEventLog', () => {
  it('appends and filters events by layer/frame/stroke', () => {
    const log = new SequentialEventLog();
    log.append('layer-1', [createEvent('e1', 0), createEvent('e2', 1)]);
    log.append('layer-1', [createEvent('e3', 1)]);

    expect(log.getLayerEventCount('layer-1')).toBe(3);
    expect(log.getLayerFrameEvents('layer-1', 1).map((event) => event.id)).toEqual(['e2', 'e3']);
    expect(log.getLayerStrokeEvents('layer-1', 'stroke-1')).toHaveLength(3);
  });

  it('returns cloned events to preserve immutability', () => {
    const log = new SequentialEventLog();
    log.append('layer-1', [createEvent('e1', 0)]);

    const events = log.getLayerEvents('layer-1');
    events[0].stamps[0].x = 999;

    const next = log.getLayerEvents('layer-1');
    expect(next[0].stamps[0].x).toBe(0);
  });
});
