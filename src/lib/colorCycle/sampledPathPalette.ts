/** One immutable ordered source sequence, shared by all its 255-band sections. */
export type SampledPathPalette = {
  rgba: string;
  offset: number;
};

export const SAMPLED_PATH_SECTION_SIZE = 255;
export const SAMPLED_PATH_FLOW = 5;

export const encodeSampledPathColors = (rgba: Uint8Array | Uint8ClampedArray): string => {
  let binary = '';
  for (let i = 0; i < rgba.length; i++) binary += String.fromCharCode(rgba[i]);
  return btoa(binary);
};

export const decodeSampledPathColors = (encoded: string): Uint8Array => {
  const binary = atob(encoded);
  if (!binary.length || binary.length % 4) throw new Error('Invalid sampled stroke colours.');
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

/** Fill one section from the full source ring; motion crosses section boundaries. */
export const renderSampledPathPalette = (
  source: Uint8Array,
  offset: number,
  phase: number,
  target: Uint8ClampedArray,
): void => {
  const count = source.length / 4;
  const shift = (((phase % 1) + 1) % 1) * count;
  for (let i = 0; i < 256; i++) {
    const position = ((offset + i - shift) % count + count) % count;
    const lower = Math.floor(position);
    const upper = (lower + 1) % count;
    const blend = position - lower;
    for (let channel = 0; channel < 4; channel++) {
      target[i * 4 + channel] = Math.round(source[lower * 4 + channel] * (1 - blend)
        + source[upper * 4 + channel] * blend);
    }
  }
};


const signatures = new WeakMap<SampledPathPalette, { rgba: string; hash: number }>();
export const sampledPathSignature = (path: SampledPathPalette): string => {
  let cached = signatures.get(path);
  if (!cached || cached.rgba !== path.rgba) {
    let hash = 2166136261;
    for (let i = 0; i < path.rgba.length; i++) hash = Math.imul(hash ^ path.rgba.charCodeAt(i), 16777619);
    cached = { rgba: path.rgba, hash: hash >>> 0 };
    signatures.set(path, cached);
  }
  return `${cached.hash}:${path.rgba.length}:${path.offset}`;
};
