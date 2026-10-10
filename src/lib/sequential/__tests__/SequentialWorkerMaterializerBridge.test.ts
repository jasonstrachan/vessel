import { BrushShape, type SequentialSelectionClip, type SequentialStrokeEvent } from '@/types';
import {
  buildSequentialWorkerEventsSignature,
  buildSequentialWorkerMaterializeKey,
} from '@/lib/sequential/SequentialWorkerMaterializerKeys';
import type { FrameTileSet } from '@/lib/sequential/types';
import { SequentialWorkerResultCache } from '@/lib/sequential/SequentialWorkerResultCache';
import { sequentialSelectionClipKey } from '@/lib/sequential/selectionClip';

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

  it('preserves the unrestricted worker signature for absent selection clips', () => {
    const event = createEvent('event-1', 1);
    expect(buildSequentialWorkerEventsSignature([event])).toBe('1:1:myna9h');
    expect(buildSequentialWorkerEventsSignature([{
      ...event,
      brush: { ...event.brush, selectionClip: null },
    }])).toBe('1:1:myna9h');
  });

  it('scans a shared immutable selection once and reuses it across worker signatures', () => {
    const clip: SequentialSelectionClip = Object.freeze({
      kind: 'mask', x: 0, y: 0, width: 64, height: 64,
      alphaBase64: Buffer.from(new Uint8Array(64 * 64).fill(1)).toString('base64'),
    });
    const fullKey = sequentialSelectionClipKey(clip);
    const events = Array.from({ length: 25 }, (_, index) => {
      const event = createEvent(`event-${index}`, 1);
      return { ...event, brush: { ...event.brush, selectionClip: clip } };
    });
    const originalCharCodeAt = String.prototype.charCodeAt;
    let largeStringReads = 0;
    let coldReads = 0;
    let warmReads = 0;
    let coldSignature = '';
    let warmSignature = '';
    try {
      String.prototype.charCodeAt = function (index: number): number {
        if (this.length >= fullKey.length) {
          largeStringReads += 1;
        }
        return originalCharCodeAt.call(this, index);
      };
      coldSignature = buildSequentialWorkerEventsSignature(events);
      coldReads = largeStringReads;
      largeStringReads = 0;
      warmSignature = buildSequentialWorkerEventsSignature(events);
      warmReads = largeStringReads;
    } finally {
      String.prototype.charCodeAt = originalCharCodeAt;
    }

    expect({ coldReads, warmReads }).toEqual({ coldReads: fullKey.length, warmReads: 0 });
    expect(warmSignature).toBe(coldSignature);
    expect(sequentialSelectionClipKey(clip)).toBe(JSON.stringify(clip));
  });

  it('retains clip content, bounds, and per-event assignment in worker identity', () => {
    const alpha = new Uint8Array(64).fill(1);
    const clip: SequentialSelectionClip = Object.freeze({
      kind: 'mask', x: 0, y: 0, width: 8, height: 8,
      alphaBase64: Buffer.from(alpha).toString('base64'),
    });
    alpha[alpha.length - 1] = 0;
    const changedMask: SequentialSelectionClip = Object.freeze({
      ...clip, alphaBase64: Buffer.from(alpha).toString('base64'),
    });
    const shiftedClip: SequentialSelectionClip = Object.freeze({ ...clip, x: 1 });
    const signature = (clips: SequentialSelectionClip[]) => buildSequentialWorkerEventsSignature(
      clips.map((selectionClip, index) => {
        const event = createEvent(`event-${index}`, 1);
        return { ...event, brush: { ...event.brush, selectionClip } };
      })
    );

    expect(signature([Object.freeze({ ...clip })])).toBe(signature([clip]));
    expect(signature([changedMask])).not.toBe(signature([clip]));
    expect(signature([shiftedClip])).not.toBe(signature([clip]));
    expect(signature([clip, changedMask])).not.toBe(signature([changedMask, clip]));
  });

  it('distinguishes mask keys that collide under the first fingerprint hash', () => {
    // These full JSON keys both have FNV-1a hash 1353422769 and equal length.
    const masks = [
      'AAEAAQABAAABAAAAAAABAQEAAAABAAABAQABAAABAAAAAAAAAQEBAQEAAAABAQEAAQABAAABAAABAQABAAEAAQ==',
      'AAEAAQAAAAAAAAAAAAAAAQAAAAAAAAEBAQAAAAEAAQEAAQABAAEAAQEAAQEBAQABAQABAAEBAQEBAAABAQEBAQ==',
    ];
    const signatures = masks.map((alphaBase64) => {
      const event = createEvent('event-1', 1);
      const selectionClip: SequentialSelectionClip = Object.freeze({
        kind: 'mask', x: 0, y: 0, width: 8, height: 8, alphaBase64,
      });
      return buildSequentialWorkerEventsSignature([{
        ...event, brush: { ...event.brush, selectionClip },
      }]);
    });

    expect(signatures[0]).not.toBe(signatures[1]);
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
