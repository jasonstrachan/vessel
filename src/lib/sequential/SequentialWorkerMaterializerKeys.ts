import type { SequentialStrokeEvent } from '@/types';

export const buildSequentialWorkerMaterializeKey = ({
  layerId,
  renderSignature,
  frameIndex,
  eventSignature,
}: {
  layerId: string;
  renderSignature: string;
  frameIndex: number;
  eventSignature: string;
}): string => `${layerId}:${renderSignature}:${frameIndex}:${eventSignature}`;

const addHashString = (hash: number, value: unknown): number => {
  const text = String(value ?? '');
  let nextHash = hash;
  for (let i = 0; i < text.length; i += 1) {
    nextHash ^= text.charCodeAt(i);
    nextHash = Math.imul(nextHash, 16777619) >>> 0;
  }
  return nextHash;
};

export const buildSequentialWorkerEventsSignature = (
  events: ReadonlyArray<SequentialStrokeEvent>
): string => {
  let hash = 2166136261;
  let stampCount = 0;
  for (let eventIndex = 0; eventIndex < events.length; eventIndex += 1) {
    const event = events[eventIndex];
    hash = addHashString(hash, event.id);
    hash = addHashString(hash, event.strokeId);
    hash = addHashString(hash, event.frameIndex);
    hash = addHashString(hash, event.brush.color);
    hash = addHashString(hash, event.brush.size);
    hash = addHashString(hash, event.brush.opacity);
    hash = addHashString(hash, event.brush.blendMode);
    hash = addHashString(hash, event.brush.brushShape);
    hash = addHashString(hash, event.brush.tipShape);
    hash = addHashString(hash, event.brush.pluginBrushId);
    hash = addHashString(hash, event.brush.customStampHash);
    hash = addHashString(hash, event.brush.customStampId);
    hash = addHashString(hash, event.stamps.length);
    stampCount += event.stamps.length;
    for (let stampIndex = 0; stampIndex < event.stamps.length; stampIndex += 1) {
      const stamp = event.stamps[stampIndex];
      hash = addHashString(hash, stamp.x);
      hash = addHashString(hash, stamp.y);
      hash = addHashString(hash, stamp.size);
      hash = addHashString(hash, stamp.alpha);
      hash = addHashString(hash, stamp.rotation);
      hash = addHashString(hash, stamp.pressure);
    }
  }
  return `${events.length}:${stampCount}:${hash.toString(36)}`;
};
