import { BrushShape, type SequentialStrokeEvent } from '@/types';
import { snapshotSequentialSelectionClip, resolveSequentialSelectionClip, isSequentialPixelSelected } from '@/lib/sequential/selectionClip';
import { encodeSequentialEventsToChunks, decodeSequentialChunksToEvents } from '@/lib/sequential/SequentialStrokeChunk';
import { estimateSequentialStrokeEventPayloadBytes } from '@/lib/sequential/SequentialPayloadBudget';
import { buildSequentialWorkerEventsSignature } from '@/lib/sequential/SequentialWorkerMaterializerKeys';

const noSelection = { selectionStart: null, selectionEnd: null, selectionMask: null, selectionMaskBounds: null };
const event: SequentialStrokeEvent = {
  id: 'a', strokeId: 'stroke', layerId: 'seq', timestampMs: 0, frameIndex: 0,
  brush: { tool: 'brush', brushShape: BrushShape.SQUARE, size: 1, opacity: 1, blendMode: 'source-over', rotation: 0, spacing: 1, color: '#ff0000' },
  stamps: [{ x: 3, y: 2, size: 1, alpha: 1, rotation: 0, pressure: 1 }],
};

describe('Sequence selection snapshot transport', () => {
  it('retains unrestricted legacy/no-selection events and reversed rectangles', () => {
    expect(snapshotSequentialSelectionClip(noSelection)).toBeNull();
    expect(isSequentialPixelSelected(null, -4, 10)).toBe(true);
    const clip = snapshotSequentialSelectionClip({ ...noSelection, selectionStart: { x: 8.2, y: 7.8 }, selectionEnd: { x: -2.1, y: 1.2 } });
    expect(clip).toEqual({ kind: 'rect', minX: -2.1, minY: 1.2, maxX: 8.2, maxY: 7.8 });
    expect(Object.isFrozen(clip)).toBe(true);
    const resolved = resolveSequentialSelectionClip(clip);
    expect(isSequentialPixelSelected(resolved, 8, 7)).toBe(true);
    expect(isSequentialPixelSelected(resolved, 9, 7)).toBe(false);
    expect(isSequentialPixelSelected(resolved, 0, 1)).toBe(false);
  });

  it('snapshots nonwhite partial alpha as binary membership, gives masks precedence, and survives mutations', () => {
    const selectionMask = new ImageData(new Uint8ClampedArray([1, 2, 3, 80, 250, 2, 7, 0, 3, 4, 5, 1, 255, 255, 255, 255]), 2, 2);
    const clip = snapshotSequentialSelectionClip({
      selectionStart: { x: 50, y: 50 }, selectionEnd: { x: 60, y: 60 },
      selectionMask, selectionMaskBounds: { x: 2.5, y: -0.5, width: 999, height: 999 },
    });
    selectionMask.data.fill(0);
    expect(clip).toEqual({ kind: 'mask', x: 2.5, y: -0.5, width: 2, height: 2, alphaBase64: Buffer.from([1, 0, 1, 1]).toString('base64') });
    const resolved = resolveSequentialSelectionClip(clip);
    expect(isSequentialPixelSelected(resolved, 3, 0)).toBe(true);
    expect(isSequentialPixelSelected(resolved, 4, 0)).toBe(false);
    expect(isSequentialPixelSelected(resolved, 3, 1)).toBe(true);
    expect(isSequentialPixelSelected(resolved, 2, 0)).toBe(false);
    expect(resolveSequentialSelectionClip(clip)).toBe(resolved);
  });

  it('keeps an empty selection mask blocked and fails closed on malformed mask payload', () => {
    const empty = snapshotSequentialSelectionClip({ ...noSelection, selectionMask: new ImageData(2, 2), selectionMaskBounds: { x: 0, y: 0, width: 2, height: 2 } });
    expect(isSequentialPixelSelected(resolveSequentialSelectionClip(empty), 0, 0)).toBe(false);
    expect(isSequentialPixelSelected(resolveSequentialSelectionClip({ kind: 'mask', x: 0, y: 0, width: 2, height: 2, alphaBase64: '' }), 1, 1)).toBe(false);
  });

  it('preserves distinct scopes through chunk save/load and isolates decoded snapshots', () => {
    const rectangle = snapshotSequentialSelectionClip({ ...noSelection, selectionStart: { x: 0, y: 0 }, selectionEnd: { x: 4, y: 4 } });
    const mask = snapshotSequentialSelectionClip({ ...noSelection, selectionMask: new ImageData(new Uint8ClampedArray([0, 0, 0, 1]), 1, 1), selectionMaskBounds: { x: 3, y: 2, width: 1, height: 1 } });
    const events = [
      event,
      { ...event, id: 'b', strokeId: 'b', brush: { ...event.brush, selectionClip: rectangle } },
      { ...event, id: 'c', strokeId: 'c', brush: { ...event.brush, selectionClip: mask } },
    ];
    const encoded = encodeSequentialEventsToChunks({ layerId: 'seq', fps: 1, frameCount: 2, events });
    expect(Object.keys(encoded.brushSnapshots)).toHaveLength(3);
    const decoded = decodeSequentialChunksToEvents(JSON.parse(JSON.stringify(encoded)));
    expect(decoded.map((item) => item.brush.selectionClip)).toEqual([undefined, rectangle, mask]);
    expect(decoded[1].brush.selectionClip).not.toBe(rectangle);
    expect(Object.isFrozen(decoded[1].brush.selectionClip)).toBe(true);
    expect(buildSequentialWorkerEventsSignature([events[0]])).not.toBe(buildSequentialWorkerEventsSignature([{ ...event, brush: events[1].brush }]));
    expect(buildSequentialWorkerEventsSignature([{ ...event, brush: events[1].brush }])).not.toBe(buildSequentialWorkerEventsSignature([{ ...event, brush: events[2].brush }]));
    expect(estimateSequentialStrokeEventPayloadBytes(events[1])).toBeGreaterThan(estimateSequentialStrokeEventPayloadBytes(event));
    expect(estimateSequentialStrokeEventPayloadBytes({ ...event, brush: events[2].brush }) - estimateSequentialStrokeEventPayloadBytes(event)).toBe(40 + (mask?.kind === 'mask' ? mask.alphaBase64.length * 2 : 0));
  });
});
