export type DitherMethod = 'none' | 'floyd-steinberg' | 'ordered-4x4';

export interface DitherOptions {
  method: DitherMethod;
  strength?: number; // 0..1
  alphaThreshold?: number; // pixels under this alpha treated as transparent for dithering
}

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}

function nearestIndexRGBA(
  r: number,
  g: number,
  b: number,
  a: number,
  palette: number[][]
): number {
  let best = 0;
  let bestDist = Infinity;
  const hasAlpha = palette.length > 0 && palette[0].length >= 4;
  for (let i = 0; i < palette.length; i++) {
    const p = palette[i];
    const dr = p[0] - r;
    const dg = p[1] - g;
    const db = p[2] - b;
    let dist = dr * dr + dg * dg + db * db;
    if (hasAlpha) {
      const da = (p[3] ?? 255) - a;
      dist += da * da;
    }
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

function findTransparentIndex(palette: number[][]): number {
  for (let i = 0; i < palette.length; i++) {
    if (palette[i].length >= 4 && palette[i][3] === 0) return i;
  }
  return -1;
}

// Floyd–Steinberg error diffusion dithering. Operates on RGB only; alpha is preserved.
export function ditherFloydSteinberg(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  palette: number[][],
  opts: Omit<DitherOptions, 'method'> = {}
): Uint8Array {
  const strength = Math.max(0, Math.min(1, opts.strength ?? 1));
  const alphaThreshold = opts.alphaThreshold ?? 16;
  const size = width * height;
  const out = new Uint8Array(size);
  const errR = new Float32Array(size);
  const errG = new Float32Array(size);
  const errB = new Float32Array(size);
  const transparentIndex = findTransparentIndex(palette);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const p = i * 4;
      const a = rgba[p + 3];
      if (a <= alphaThreshold && transparentIndex >= 0) {
        out[i] = transparentIndex;
        continue;
      }
      const r0 = clampByte(rgba[p + 0] + errR[i]);
      const g0 = clampByte(rgba[p + 1] + errG[i]);
      const b0 = clampByte(rgba[p + 2] + errB[i]);

      const idx = nearestIndexRGBA(r0, g0, b0, a, palette);
      out[i] = idx;
      const pr = palette[idx][0];
      const pg = palette[idx][1];
      const pb = palette[idx][2];

      // Quantization error
      const er = (r0 - pr) * strength;
      const eg = (g0 - pg) * strength;
      const eb = (b0 - pb) * strength;

      // Distribute error (Floyd–Steinberg)
      // Right
      if (x + 1 < width) {
        const j = i + 1;
        errR[j] += er * (7 / 16);
        errG[j] += eg * (7 / 16);
        errB[j] += eb * (7 / 16);
      }
      // Down-left
      if (x - 1 >= 0 && y + 1 < height) {
        const j = i + width - 1;
        errR[j] += er * (3 / 16);
        errG[j] += eg * (3 / 16);
        errB[j] += eb * (3 / 16);
      }
      // Down
      if (y + 1 < height) {
        const j = i + width;
        errR[j] += er * (5 / 16);
        errG[j] += eg * (5 / 16);
        errB[j] += eb * (5 / 16);
      }
      // Down-right
      if (x + 1 < width && y + 1 < height) {
        const j = i + width + 1;
        errR[j] += er * (1 / 16);
        errG[j] += eg * (1 / 16);
        errB[j] += eb * (1 / 16);
      }
    }
  }
  return out;
}

// Ordered Bayer 4x4 dithering. Adds a small matrix-based offset to RGB, then quantizes.
export function ditherOrdered4x4(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  palette: number[][],
  opts: Omit<DitherOptions, 'method'> = {}
): Uint8Array {
  const strength = Math.max(0, Math.min(1, opts.strength ?? 0.75));
  const alphaThreshold = opts.alphaThreshold ?? 16;
  const out = new Uint8Array(width * height);
  const transparentIndex = findTransparentIndex(palette);

  // 4x4 Bayer matrix normalized to [-0.5, 0.5]
  const M = [
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5],
  ];
  const scale = strength * 48; // tweakable amplitude

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const p = i * 4;
      const a = rgba[p + 3];
      if (a <= alphaThreshold && transparentIndex >= 0) {
        out[i] = transparentIndex;
        continue;
      }
      const t = (M[y & 3][x & 3] - 7.5) / 16; // -0.5..+0.5
      const r0 = clampByte(rgba[p + 0] + t * scale);
      const g0 = clampByte(rgba[p + 1] + t * scale);
      const b0 = clampByte(rgba[p + 2] + t * scale);

      const idx = nearestIndexRGBA(r0, g0, b0, a, palette);
      out[i] = idx;
    }
  }
  return out;
}

export function mapToIndexedWithDithering(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  palette: number[][],
  options: DitherOptions
): Uint8Array {
  switch (options.method) {
    case 'floyd-steinberg':
      return ditherFloydSteinberg(rgba, width, height, palette, options);
    case 'ordered-4x4':
      return ditherOrdered4x4(rgba, width, height, palette, options);
    case 'none':
    default:
      // Fallback: direct nearest mapping (no dithering)
      const out = new Uint8Array((rgba.length / 4) | 0);
      for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
        const idx = nearestIndexRGBA(rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3], palette);
        out[j] = idx;
      }
      return out;
  }
}
