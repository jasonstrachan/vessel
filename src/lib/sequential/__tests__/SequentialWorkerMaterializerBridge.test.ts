import { BrushShape, type SequentialStrokeEvent } from '@/types';
import {
  buildSequentialWorkerEventsSignature,
  buildSequentialWorkerMaterializeKey,
} from '@/lib/sequential/SequentialWorkerMaterializerKeys';
import type { FrameTileSet } from '@/lib/sequential/types';
import { SequentialWorkerResultCache } from '@/lib/sequential/SequentialWorkerResultCache';

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

  it('bounds completed worker frames by bytes', () => {
    const cache = new SequentialWorkerResultCache({ maxEntries: 64, maxBytes: 2_000_000 });
    const createTileSet = (frameIndex: number): FrameTileSet => ({
      frameIndex,
      tileSize: 500,
      pixelFormat: 'rgba8',
      premultipliedAlpha: true,
      colorSpace: 'srgb',
      tiles: [{
        x: 0,
        y: 0,
        width: 500,
        height: 500,
        data: new Uint8ClampedArray(1_000_000),
      }],
    });

    cache.set('frame:0', createTileSet(0));
    cache.set('frame:1', createTileSet(1));
    cache.set('frame:2', createTileSet(2));

    expect(cache.getStats()).toEqual({ entries: 2, bytes: 2_000_000, maxBytes: 2_000_000 });
    expect(cache.take('frame:0')).toBeNull();
    expect(cache.take('frame:2')?.frameIndex).toBe(2);
  });

  it('rejects a single worker frame that exceeds the byte budget', () => {
    const cache = new SequentialWorkerResultCache({ maxEntries: 64, maxBytes: 4 });
    const tileSet: FrameTileSet = {
      frameIndex: 0,
      tileSize: 2,
      pixelFormat: 'rgba8',
      premultipliedAlpha: true,
      colorSpace: 'srgb',
      tiles: [{
        x: 0,
        y: 0,
        width: 2,
        height: 1,
        data: new Uint8ClampedArray(8),
      }],
    };

    expect(cache.set('oversized', tileSet)).toBe(false);
    expect(cache.getStats()).toEqual({ entries: 0, bytes: 0, maxBytes: 4 });
    expect(cache.take('oversized')).toBeNull();
  });
});
