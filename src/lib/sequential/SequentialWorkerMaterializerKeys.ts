import { sequentialSelectionClipKey } from '@/lib/sequential/selectionClip';
import type { SequentialSelectionClip, SequentialStrokeEvent } from '@/types';

const selectionClipFingerprints = new WeakMap<SequentialSelectionClip, string>();

const selectionClipFingerprint = (clip: SequentialSelectionClip | null | undefined): string => {
  if (!clip) {
    return '';
  }
  const cached = selectionClipFingerprints.get(clip);
  if (cached !== undefined) {
    return cached;
  }

  const key = sequentialSelectionClipKey(clip);
  let fnvHash = 2166136261;
  let jenkinsHash = 0x9e3779b9;
  for (let index = 0; index < key.length; index += 1) {
    const code = key.charCodeAt(index);
    fnvHash = Math.imul(fnvHash ^ code, 16777619) >>> 0;
    jenkinsHash = (jenkinsHash + code) >>> 0;
    jenkinsHash = (jenkinsHash + (jenkinsHash << 10)) >>> 0;
    jenkinsHash ^= jenkinsHash >>> 6;
  }
  jenkinsHash = (jenkinsHash + (jenkinsHash << 3)) >>> 0;
  jenkinsHash ^= jenkinsHash >>> 11;
  jenkinsHash = (jenkinsHash + (jenkinsHash << 15)) >>> 0;

  // Captured and decoded clips are immutable; retain only a compact worker key per live clip.
  // Distinct mixing algorithms avoid correlated hashes from reseeding the same recurrence.
  const fingerprint = `${key.length}:${fnvHash.toString(36)}:${jenkinsHash.toString(36)}`;
  selectionClipFingerprints.set(clip, fingerprint);
  return fingerprint;
};

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
    hash = addHashString(hash, selectionClipFingerprint(event.brush.selectionClip));
    hash = addHashString(hash, event.brush.color);
    hash = addHashString(hash, event.brush.size);
    hash = addHashString(hash, event.brush.opacity);
    hash = addHashString(hash, event.brush.blendMode);
    hash = addHashString(hash, event.brush.brushShape);
    hash = addHashString(hash, event.brush.tipShape);
    hash = addHashString(hash, event.brush.ditherAlgorithm);
    hash = addHashString(hash, event.brush.ditherStrokeTipShape);
    hash = addHashString(hash, event.brush.ditherBackgroundFill);
    hash = addHashString(hash, event.brush.fillResolution);
    hash = addHashString(hash, event.brush.pressureLinkedFillResolution);
    hash = addHashString(hash, event.brush.pressureLinkedFillMaxResolution);
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
