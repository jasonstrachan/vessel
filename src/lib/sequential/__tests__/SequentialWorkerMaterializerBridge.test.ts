import { BrushShape, type SequentialStrokeEvent } from '@/types';
import {
  buildSequentialWorkerEventsSignature,
  buildSequentialWorkerMaterializeKey,
} from '@/lib/sequential/SequentialWorkerMaterializerKeys';

const createEvent = (id: string, frameIndex: number): SequentialStrokeEvent => ({
  id,
  layerId: 'layer-seq',
  strokeId: 'stroke-1',
  timestampMs: 0,
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
  stamps: [{ x: 4, y: 4, pressure: 1, rotation: 0, size: 8, alpha: 1 }],
});

describe('SequentialWorkerMaterializerBridge', () => {
  it('includes frame event content in worker materialization keys', () => {
    const emptySignature = buildSequentialWorkerEventsSignature([]);
    const eventSignature = buildSequentialWorkerEventsSignature([createEvent('event-1', 1)]);

    const emptyKey = buildSequentialWorkerMaterializeKey({
      layerId: 'layer-seq',
      renderSignature: '16|16|12|12',
      frameIndex: 1,
      eventSignature: emptySignature,
    });
    const eventKey = buildSequentialWorkerMaterializeKey({
      layerId: 'layer-seq',
      renderSignature: '16|16|12|12',
      frameIndex: 1,
      eventSignature,
    });

    expect(eventSignature).not.toBe(emptySignature);
    expect(eventKey).not.toBe(emptyKey);
  });

  it('changes event signatures when stamp content changes without changing event count', () => {
    const first = createEvent('event-1', 1);
    const second: SequentialStrokeEvent = {
      ...first,
      stamps: [{ ...first.stamps[0], x: 9 }],
    };

    expect(buildSequentialWorkerEventsSignature([second])).not.toBe(
      buildSequentialWorkerEventsSignature([first])
    );
  });
});
