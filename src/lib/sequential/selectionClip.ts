import type { SequentialSelectionClip } from '@/types';
import type { SelectionRasterScopeInput } from '@/stores/helpers/selectionRoi';

export type ResolvedSequentialSelectionClip = {
  clip: SequentialSelectionClip;
  alpha: Uint8Array | null;
};

const clipKeys = new WeakMap<SequentialSelectionClip, string>();
const resolvedClips = new WeakMap<SequentialSelectionClip, ResolvedSequentialSelectionClip>();

export const snapshotSequentialSelectionClip = ({
  selectionMask,
  selectionMaskBounds,
  selectionStart,
  selectionEnd,
}: SelectionRasterScopeInput): SequentialSelectionClip | null => {
  if (selectionMask && selectionMaskBounds) {
    const alpha = new Uint8Array(selectionMask.width * selectionMask.height);
    for (let index = 0; index < alpha.length; index += 1) {
      alpha[index] = selectionMask.data[index * 4 + 3] > 0 ? 1 : 0;
    }
    let alphaBase64: string;
    if (typeof Buffer !== 'undefined') {
      alphaBase64 = Buffer.from(alpha).toString('base64');
    } else {
      let binary = '';
      for (let offset = 0; offset < alpha.length; offset += 0x8000) {
        binary += String.fromCharCode(...alpha.subarray(offset, offset + 0x8000));
      }
      alphaBase64 = btoa(binary);
    }
    return Object.freeze({
      kind: 'mask', x: selectionMaskBounds.x, y: selectionMaskBounds.y,
      width: selectionMask.width, height: selectionMask.height, alphaBase64,
    });
  }
  if (!selectionStart || !selectionEnd) {
    return null;
  }
  return Object.freeze({
    kind: 'rect',
    minX: Math.min(selectionStart.x, selectionEnd.x),
    minY: Math.min(selectionStart.y, selectionEnd.y),
    maxX: Math.max(selectionStart.x, selectionEnd.x),
    maxY: Math.max(selectionStart.y, selectionEnd.y),
  });
};

export const sequentialSelectionClipKey = (clip: SequentialSelectionClip | null | undefined): string => {
  if (!clip) {
    return '';
  }
  const cached = clipKeys.get(clip);
  if (cached !== undefined) {
    return cached;
  }
  const key = JSON.stringify(clip);
  clipKeys.set(clip, key);
  return key;
};

export const resolveSequentialSelectionClip = (
  clip: SequentialSelectionClip | null | undefined,
): ResolvedSequentialSelectionClip | null => {
  if (!clip) {
    return null;
  }
  const cached = resolvedClips.get(clip);
  if (cached) {
    return cached;
  }
  let alpha: Uint8Array | null = null;
  if (clip.kind === 'mask') {
    try {
      if (typeof Buffer !== 'undefined') {
        alpha = new Uint8Array(Buffer.from(clip.alphaBase64, 'base64'));
      } else {
        const binary = atob(clip.alphaBase64);
        alpha = Uint8Array.from(binary, (value) => value.charCodeAt(0));
      }
    } catch {
      alpha = new Uint8Array(0);
    }
  }
  const resolved = { clip, alpha };
  resolvedClips.set(clip, resolved);
  return resolved;
};

export const isSequentialPixelSelected = (
  resolved: ResolvedSequentialSelectionClip | null,
  x: number,
  y: number,
): boolean => {
  if (!resolved) {
    return true;
  }
  const { clip, alpha } = resolved;
  if (clip.kind === 'rect') {
    return x >= clip.minX && x < clip.maxX && y >= clip.minY && y < clip.maxY;
  }
  const maskX = Math.floor(x - clip.x);
  const maskY = Math.floor(y - clip.y);
  return maskX >= 0 && maskY >= 0 && maskX < clip.width && maskY < clip.height &&
    (alpha?.[maskY * clip.width + maskX] ?? 0) > 0;
};
