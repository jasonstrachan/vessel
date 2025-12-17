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

export const resolveDitherGradPalette = (fg: RGBA, bg: RGBA, bgFill: boolean | undefined): [RGBA, RGBA] => {
  if (bgFill !== false) {
    return [fg, bg];
  }
  return [fg, [0, 0, 0, 0]];
};

const DEFAULT_TILE_SIZE = 8;
const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);

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

  for (let y = 0; y < height; y += pixelSize) {
    const tileY = ((origin.y + y) % tileSize + tileSize) % tileSize;
    for (let x = 0; x < width; x += pixelSize) {
      const tileX = ((origin.x + x) % tileSize + tileSize) % tileSize;
      const tileVal = tile[tileY * tileSize + tileX];

      // Use the pixel center for smoother ramping
      const sampleX = x + pixelSize * 0.5;
      const sampleY = y + pixelSize * 0.5;
      const proj =
        ((sampleX - axis.start.x) * safeDir.x + (sampleY - axis.start.y) * safeDir.y) /
        safeLength;
      const coverage = clamp01(proj);
      const paletteIndex = coverage >= tileVal ? 1 : 0;
      const color = paletteRGBA[paletteIndex] ?? paletteRGBA[paletteRGBA.length - 1];

      for (let py = 0; py < pixelSize; py += 1) {
        const yy = y + py;
        if (yy >= height) break;
        for (let px = 0; px < pixelSize; px += 1) {
          const xx = x + px;
          if (xx >= width) break;
          const offset = (yy * width + xx) * 4;
          writePixel(data, offset, color);
        }
      }
    }
  }

  return imageData;
}

/**
 * Nearest-neighbor pixelation of an ImageData.
 * Leaves content unchanged when blockSize <= 1.
 */
export function pixelateImageData(source: ImageData, blockSize: number): ImageData {
  const size = Math.max(1, Math.floor(blockSize));
  if (size <= 1) return source;

  const { width, height } = source;
  const src = source.data;
  const out = new ImageData(width, height);
  const dst = out.data;

  for (let y = 0; y < height; y += size) {
    for (let x = 0; x < width; x += size) {
      const srcIdx = (y * width + x) * 4;
      const r = src[srcIdx];
      const g = src[srcIdx + 1];
      const b = src[srcIdx + 2];
      const a = src[srcIdx + 3];
      const maxY = Math.min(height, y + size);
      const maxX = Math.min(width, x + size);
      for (let yy = y; yy < maxY; yy += 1) {
        for (let xx = x; xx < maxX; xx += 1) {
          const dstIdx = (yy * width + xx) * 4;
          dst[dstIdx] = r;
          dst[dstIdx + 1] = g;
          dst[dstIdx + 2] = b;
          dst[dstIdx + 3] = a;
        }
      }
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
