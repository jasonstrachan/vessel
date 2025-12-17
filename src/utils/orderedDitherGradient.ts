export type Vec2 = { x: number; y: number };
export type RGBA = [number, number, number, number];

export type OrderedDitherAxis = {
  start: Vec2;
  end: Vec2;
  dir: Vec2;
  length: number;
};

/**
 * Scale a gradient axis length around its midpoint.
 * factor 1 = unchanged, <1 compresses toward center, >1 extends past endpoints.
 */
export function scaleOrderedAxis(axis: OrderedDitherAxis, factor: number): OrderedDitherAxis {
  const safeFactor = Math.max(0.05, Math.min(2, factor));
  const half = (axis.length * safeFactor) / 2;
  const center = {
    x: (axis.start.x + axis.end.x) / 2,
    y: (axis.start.y + axis.end.y) / 2,
  };
  const dx = axis.dir.x * half;
  const dy = axis.dir.y * half;
  return {
    start: { x: center.x - dx, y: center.y - dy },
    end: { x: center.x + dx, y: center.y + dy },
    dir: { ...axis.dir },
    length: Math.max(1e-6, axis.length * safeFactor),
  };
}

export type OrderedDitherGradientParams = {
  width: number;
  height: number;
  axis: OrderedDitherAxis;
  paletteRGBA: Array<RGBA>;
  tileSize?: number;
  tile?: Float32Array;
  pixelSize?: number;
  /**
   * World-space origin for tile phase anchoring. When provided, dither cells
   * stay locked to the canvas even if the polygon bounds or pixelSize change.
   */
  origin?: Vec2;
};

const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);

const parseHexToRgba = (hex: string, fallback: RGBA): RGBA => {
  const normalized = hex.trim().toLowerCase();
  const shortMatch = /^#([0-9a-f]{3})$/i.exec(normalized);
  if (shortMatch) {
    const [r, g, b] = shortMatch[1].split('').map((c) => parseInt(`${c}${c}`, 16));
    return [r, g, b, 255];
  }
  const longMatch = /^#([0-9a-f]{6})$/i.exec(normalized);
  if (longMatch) {
    const intVal = longMatch[1];
    const r = parseInt(intVal.slice(0, 2), 16);
    const g = parseInt(intVal.slice(2, 4), 16);
    const b = parseInt(intVal.slice(4, 6), 16);
    return [r, g, b, 255];
  }
  return fallback;
};

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

const lerpColor = (a: RGBA, b: RGBA, t: number): RGBA => [
  Math.round(lerp(a[0], b[0], t)),
  Math.round(lerp(a[1], b[1], t)),
  Math.round(lerp(a[2], b[2], t)),
  Math.round(lerp(a[3] ?? 255, b[3] ?? 255, t)),
];

export const resolveDitherGradPalette = (
  fg: RGBA,
  bg: RGBA,
  bgFill: boolean | undefined,
  stopHex?: string[],
  transparentCount?: number
): Array<RGBA> => {
  const fallbackStops = [fg, bg];
  const parsedStops = Array.isArray(stopHex)
    ? stopHex
        .filter(Boolean)
        .slice(0, 6)
        .map((hex) => parseHexToRgba(hex, fg))
    : [];

  const palette = parsedStops.length >= 2 ? parsedStops : fallbackStops;
  const targetLength = Math.max(2, Math.min(6, palette.length));
  const first = palette[0] ?? fg;
  const last = palette[palette.length - 1] ?? bg;

  const normalizeStops = (source: RGBA[], length: number): RGBA[] => {
    const evenStops: RGBA[] = [];
    for (let i = 0; i < length; i += 1) {
      const t = length === 1 ? 0 : i / (length - 1);
      const samplePos = (source.length - 1) * t;
      const idx = Math.floor(samplePos);
      const nextIdx = Math.min(source.length - 1, idx + 1);
      const localT = samplePos - idx;
      const base = source[idx] ?? first;
      const next = source[nextIdx] ?? last;
      evenStops.push(localT <= 0 ? base : lerpColor(base, next, localT));
    }
    return evenStops;
  };

  const evenStops = normalizeStops(palette, targetLength);
  const hasTransparentCount = typeof transparentCount === 'number' && Number.isFinite(transparentCount);

  if (hasTransparentCount) {
    const safeCount = Math.max(0, Math.min(targetLength - 1, Math.round(transparentCount)));
    if (safeCount > 0) {
      for (let i = targetLength - safeCount; i < targetLength; i += 1) {
        evenStops[i] = [0, 0, 0, 0];
      }
    }
    return evenStops;
  }

  if (targetLength === 2) {
    // Preserve legacy behavior and avoid extra allocations for the common case
    if (bgFill === false) {
      return [evenStops[0], [0, 0, 0, 0]];
    }
    return evenStops;
  }

  if (bgFill === false) {
    evenStops[targetLength - 1] = [0, 0, 0, 0];
  }

  return evenStops;
};

const DEFAULT_TILE_SIZE = 8;
/**
 * Compute a gradient axis for an ordered dither polygon fill.
 * Start is the first vertex, end is the farthest vertex from start.
 */
export function computeGradientAxisFromPolygon(vertices: Vec2[]): OrderedDitherAxis {
  const start = vertices[0] ?? { x: 0, y: 0 };
  if (vertices.length <= 1) {
    return {
      start,
      end: { ...start },
      dir: { x: 1, y: 0 },
      length: 1,
    };
  }

  let farthest = vertices[1];
  let maxDistSq = (farthest.x - start.x) ** 2 + (farthest.y - start.y) ** 2;
  for (let i = 2; i < vertices.length; i += 1) {
    const v = vertices[i];
    const distSq = (v.x - start.x) ** 2 + (v.y - start.y) ** 2;
    if (distSq > maxDistSq) {
      maxDistSq = distSq;
      farthest = v;
    }
  }

  const length = Math.max(Math.sqrt(maxDistSq), 1e-6);
  const dir = { x: (farthest.x - start.x) / length, y: (farthest.y - start.y) / length };

  return { start, end: farthest, dir, length };
}

const bayerCache: Map<number, Float32Array> = new Map();

/**
 * Return a normalized Bayer threshold tile (0..1) of the requested size.
 * Size must be a power of two; defaults to 8.
 */
export function getBayerTile(size: number = DEFAULT_TILE_SIZE): Float32Array {
  const cached = bayerCache.get(size);
  if (cached) return cached;

  // Generates a classic Bayer matrix via recursive construction.
  const buildBayer = (n: number): number[][] => {
    if (n === 2) {
      return [
        [0, 2],
        [3, 1],
      ];
    }
    const prev = buildBayer(n / 2);
    const result: number[][] = Array.from({ length: n }, () => Array<number>(n).fill(0));
    for (let y = 0; y < n / 2; y += 1) {
      for (let x = 0; x < n / 2; x += 1) {
        const base = prev[y][x] * 4;
        result[y][x] = base;
        result[y][x + n / 2] = base + 2;
        result[y + n / 2][x] = base + 3;
        result[y + n / 2][x + n / 2] = base + 1;
      }
    }
    return result;
  };

  const matrix = buildBayer(size);
  const normalizer = size * size;
  const flat = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      flat[y * size + x] = (matrix[y][x] + 0.5) / normalizer; // center thresholds in bins
    }
  }

  bayerCache.set(size, flat);
  return flat;
}

const writePixel = (data: Uint8ClampedArray, offset: number, color: RGBA) => {
  const alpha = color[3] ?? 255;
  if (alpha <= 0) {
    data[offset] = 0;
    data[offset + 1] = 0;
    data[offset + 2] = 0;
    data[offset + 3] = 0;
    return;
  }

  data[offset] = color[0];
  data[offset + 1] = color[1];
  data[offset + 2] = color[2];
  data[offset + 3] = alpha;
};

/**
 * Render an ordered dither gradient into a new ImageData.
 * - Axis is expressed in bounds-local coordinates (0,0 is top-left of bounds).
 * - Palette entries are RGBA tuples; index 0 is used when coverage < threshold, index 1 when coverage >= threshold.
 */
export function renderOrderedDitherGradientToImageData(params: OrderedDitherGradientParams): ImageData {
  const { width, height, axis, paletteRGBA } = params;
  const tileSize = params.tileSize ?? DEFAULT_TILE_SIZE;
  const tile = params.tile ?? getBayerTile(tileSize);
  const pixelSize = Math.max(1, Math.floor(params.pixelSize ?? 1));
  const origin = params.origin ?? { x: 0, y: 0 };

  const imageData = new ImageData(width, height);
  const data = imageData.data;

  const safeDir = axis.length > 1e-6 ? axis.dir : { x: 1, y: 0 };
  const safeLength = axis.length > 1e-6 ? axis.length : 1e-6;
  const levelCount = Math.max(2, paletteRGBA.length);

  const mod = (value: number, modulo: number) =>
    ((value % modulo) + modulo) % modulo;
  const axisStartWorldX = origin.x + axis.start.x;
  const axisStartWorldY = origin.y + axis.start.y;
  for (let yy = 0; yy < height; yy += 1) {
    const worldY = origin.y + yy + 0.5;
    const cellY = Math.floor(worldY / pixelSize);
    const cellCenterWorldY = (cellY + 0.5) * pixelSize;
    const tileY = mod(cellY, tileSize);

    let lastCellX = Number.NaN;
    let cachedColor: RGBA = paletteRGBA[0] ?? [0, 0, 0, 0];
    for (let xx = 0; xx < width; xx += 1) {
      const worldX = origin.x + xx + 0.5;
      const cellX = Math.floor(worldX / pixelSize);
      if (cellX !== lastCellX) {
        const cellCenterWorldX = (cellX + 0.5) * pixelSize;
        const tileX = mod(cellX, tileSize);
        const tileVal = tile[tileY * tileSize + tileX];

        const proj =
          ((cellCenterWorldX - axisStartWorldX) * safeDir.x +
            (cellCenterWorldY - axisStartWorldY) * safeDir.y) /
          safeLength;
        const coverage = clamp01(proj);
        const scaled = coverage * (levelCount - 1);
        const baseIndex = Math.floor(scaled);
        const frac = scaled - baseIndex;
        const stepUp = baseIndex < levelCount - 1 && tileVal < frac;
        const paletteIndex = Math.min(levelCount - 1, stepUp ? baseIndex + 1 : baseIndex);
        cachedColor = paletteRGBA[paletteIndex] ?? paletteRGBA[paletteRGBA.length - 1];
        lastCellX = cellX;
      }

      const offset = (yy * width + xx) * 4;
      writePixel(data, offset, cachedColor);
    }
  }

  return imageData;
}

/**
 * Nearest-neighbor pixelation of an ImageData.
 * Leaves content unchanged when blockSize <= 1.
 */
export function pixelateImageData(
  source: ImageData,
  blockSize: number,
  origin?: Vec2
): ImageData {
  const size = Math.max(1, Math.floor(blockSize));
  if (size <= 1) return source;

  const { width, height } = source;
  const src = source.data;
  const out = new ImageData(width, height);
  const dst = out.data;

  const baseOriginX = origin ? Math.floor(origin.x) : 0;
  const baseOriginY = origin ? Math.floor(origin.y) : 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const srcX = baseOriginX + Math.floor((x - baseOriginX) / size) * size;
      const srcY = baseOriginY + Math.floor((y - baseOriginY) / size) * size;
      const clampedX = Math.max(0, Math.min(width - 1, srcX));
      const clampedY = Math.max(0, Math.min(height - 1, srcY));
      const srcIdx = (clampedY * width + clampedX) * 4;
      const dstIdx = (y * width + x) * 4;
      dst[dstIdx] = src[srcIdx];
      dst[dstIdx + 1] = src[srcIdx + 1];
      dst[dstIdx + 2] = src[srcIdx + 2];
      dst[dstIdx + 3] = src[srcIdx + 3];
    }
  }

  return out;
}

/**
 * Convenience to build palette from fg/bg RGBA tuples while allowing transparent BG.
 */
export function buildFgBgPalette(fg: RGBA, bg: RGBA): Array<RGBA> {
  return [bg, fg];
}
