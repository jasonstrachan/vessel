import type { Layer } from '@/types';

export interface ColorCycleSoftEdgeMaskResult {
  softEdgeMask: HTMLCanvasElement;
  softEdgeMaskImageData: ImageData;
}

export interface ColorCycleSoftEdgeCoverage {
  width: number;
  height: number;
  alpha: Uint8ClampedArray;
}

export type ColorCycleSoftEdgeDitherAlgorithm = 'ordered' | 'sierra-lite';

export interface ColorCycleSoftEdgeMaskOptions {
  ditherSize?: number;
  ditherAlgorithm?: ColorCycleSoftEdgeDitherAlgorithm;
}

const DISTANCE_INF = 0xffff;

const BAYER_8X8 = [
  [0, 32, 8, 40, 2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21],
];

const createMaskImageData = (width: number, height: number, alpha: Uint8ClampedArray): ImageData => {
  const imageData = new ImageData(width, height);
  for (let index = 0, src = 0; index < imageData.data.length; index += 4, src += 1) {
    const value = alpha[src] ?? 0;
    imageData.data[index] = 255;
    imageData.data[index + 1] = 255;
    imageData.data[index + 2] = 255;
    imageData.data[index + 3] = value;
  }
  return imageData;
};

const computeInteriorDistance = (
  hardAlpha: Uint8ClampedArray,
  width: number,
  height: number,
): Uint16Array => {
  const distance = new Uint16Array(width * height);
  for (let index = 0; index < distance.length; index += 1) {
    distance[index] = hardAlpha[index] === 255 ? DISTANCE_INF : 0;
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (distance[index] === 0) {
        continue;
      }
      let best = distance[index];
      if (x === 0 || y === 0) {
        best = 1;
      }
      if (x > 0) {
        best = Math.min(best, (distance[index - 1] ?? DISTANCE_INF) + 1);
      }
      if (y > 0) {
        best = Math.min(best, (distance[index - width] ?? DISTANCE_INF) + 1);
      }
      distance[index] = Math.min(best, DISTANCE_INF);
    }
  }

  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = width - 1; x >= 0; x -= 1) {
      const index = y * width + x;
      if (distance[index] === 0) {
        continue;
      }
      let best = distance[index];
      if (x === width - 1 || y === height - 1) {
        best = Math.min(best, 1);
      }
      if (x < width - 1) {
        best = Math.min(best, (distance[index + 1] ?? DISTANCE_INF) + 1);
      }
      if (y < height - 1) {
        best = Math.min(best, (distance[index + width] ?? DISTANCE_INF) + 1);
      }
      distance[index] = Math.min(best, DISTANCE_INF);
    }
  }

  return distance;
};

const computeTargetAlpha = (
  hardAlpha: Uint8ClampedArray,
  distance: Uint16Array,
  width: number,
  height: number,
  radius: number,
): Float32Array => {
  const edgeWidth = Math.max(0, Math.floor(radius));
  const targetAlpha = new Float32Array(width * height);
  if (edgeWidth <= 0) {
    for (let index = 0; index < hardAlpha.length; index += 1) {
      targetAlpha[index] = hardAlpha[index] === 255 ? 1 : 0;
    }
    return targetAlpha;
  }

  const rampDenominator = edgeWidth + 1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (hardAlpha[index] !== 255) {
        targetAlpha[index] = 0;
        continue;
      }
      const edgeDistance = distance[index] ?? 0;
      if (edgeDistance > edgeWidth) {
        targetAlpha[index] = 1;
        continue;
      }
      targetAlpha[index] = Math.max(0, Math.min(1, edgeDistance / rampDenominator));
    }
  }

  return targetAlpha;
};

const orderedDitherAlpha = (
  targetAlpha: Float32Array,
  width: number,
  height: number,
  ditherSize: number,
): Uint8ClampedArray => {
  const cellSize = Math.max(1, Math.min(32, Math.round(ditherSize)));
  const output = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const alpha = targetAlpha[index] ?? 0;
      if (alpha <= 0) {
        output[index] = 0;
        continue;
      }
      if (alpha >= 1) {
        output[index] = 255;
        continue;
      }
      const sampleX = Math.floor(x / cellSize);
      const sampleY = Math.floor(y / cellSize);
      const threshold = ((BAYER_8X8[sampleY & 7]?.[sampleX & 7] ?? 0) + 0.5) / 64;
      output[index] = alpha >= threshold ? 255 : 0;
    }
  }
  return output;
};

const sierraLiteDitherAlpha = (
  targetAlpha: Float32Array,
  width: number,
  height: number,
  ditherSize: number,
): Uint8ClampedArray => {
  const cellSize = Math.max(1, Math.min(32, Math.round(ditherSize)));
  const cellsWide = Math.ceil(width / cellSize);
  const cellsHigh = Math.ceil(height / cellSize);
  const cellTargets = new Float32Array(cellsWide * cellsHigh);
  const cellCounts = new Uint16Array(cellsWide * cellsHigh);

  for (let y = 0; y < height; y += 1) {
    const cellY = Math.floor(y / cellSize);
    for (let x = 0; x < width; x += 1) {
      const cellX = Math.floor(x / cellSize);
      const cellIndex = cellY * cellsWide + cellX;
      cellTargets[cellIndex] += targetAlpha[y * width + x] ?? 0;
      cellCounts[cellIndex] += 1;
    }
  }

  for (let index = 0; index < cellTargets.length; index += 1) {
    cellTargets[index] = cellCounts[index] > 0
      ? cellTargets[index] / cellCounts[index]
      : 0;
  }

  const cellOutput = new Uint8Array(cellsWide * cellsHigh);
  const work = new Float32Array(cellTargets);
  for (let y = 0; y < cellsHigh; y += 1) {
    const leftToRight = (y & 1) === 0;
    const xStart = leftToRight ? 0 : cellsWide - 1;
    const xEnd = leftToRight ? cellsWide : -1;
    const xStep = leftToRight ? 1 : -1;
    const dir = leftToRight ? 1 : -1;

    for (let x = xStart; x !== xEnd; x += xStep) {
      const index = y * cellsWide + x;
      const oldValue = Math.max(0, Math.min(1, work[index] ?? 0));
      const newValue = oldValue >= 0.5 ? 1 : 0;
      cellOutput[index] = newValue === 1 ? 255 : 0;
      const error = oldValue - newValue;

      const right = x + dir;
      if (right >= 0 && right < cellsWide) {
        work[y * cellsWide + right] += error * 0.5;
      }
      if (y + 1 < cellsHigh) {
        const down = (y + 1) * cellsWide + x;
        work[down] += error * 0.25;
        const downLeft = x - dir;
        if (downLeft >= 0 && downLeft < cellsWide) {
          work[(y + 1) * cellsWide + downLeft] += error * 0.25;
        }
      }
    }
  }

  const output = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y += 1) {
    const cellY = Math.floor(y / cellSize);
    for (let x = 0; x < width; x += 1) {
      const alpha = targetAlpha[y * width + x] ?? 0;
      if (alpha <= 0) {
        output[y * width + x] = 0;
        continue;
      }
      if (alpha >= 1) {
        output[y * width + x] = 255;
        continue;
      }
      const cellX = Math.floor(x / cellSize);
      output[y * width + x] = cellOutput[cellY * cellsWide + cellX] ?? 0;
    }
  }

  return output;
};

const ditherEdgeAlpha = (
  hardAlpha: Uint8ClampedArray,
  distance: Uint16Array,
  width: number,
  height: number,
  radius: number,
  ditherSize: number,
  ditherAlgorithm: ColorCycleSoftEdgeDitherAlgorithm,
): Uint8ClampedArray => {
  const targetAlpha = computeTargetAlpha(hardAlpha, distance, width, height, radius);
  return ditherAlgorithm === 'sierra-lite'
    ? sierraLiteDitherAlpha(targetAlpha, width, height, ditherSize)
    : orderedDitherAlpha(targetAlpha, width, height, ditherSize);
};

const normalizeCoverage = (
  coverage: ColorCycleSoftEdgeCoverage | null | undefined,
): ColorCycleSoftEdgeCoverage | null => {
  if (!coverage || coverage.width <= 0 || coverage.height <= 0) {
    return null;
  }
  const width = Math.max(1, Math.floor(coverage.width));
  const height = Math.max(1, Math.floor(coverage.height));
  if (coverage.alpha.length < width * height) {
    return null;
  }
  return {
    width,
    height,
    alpha: coverage.alpha,
  };
};

const imageDataToCoverage = (source: ImageData): ColorCycleSoftEdgeCoverage => {
  const width = source.width;
  const height = source.height;
  const alpha = new Uint8ClampedArray(width * height);
  for (let src = 3, dst = 0; src < source.data.length; src += 4, dst += 1) {
    alpha[dst] = (source.data[src] ?? 0) > 0 ? 255 : 0;
  }
  return { width, height, alpha };
};

const resolveCoverageFromImageData = (layer: Layer): ColorCycleSoftEdgeCoverage | null => {
  const data = layer.colorCycleData;
  const canvas = data?.canvas;
  if (canvas) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings);
    if (ctx && canvas.width > 0 && canvas.height > 0) {
      try {
        return imageDataToCoverage(ctx.getImageData(0, 0, canvas.width, canvas.height));
      } catch {
        // Fall back to the persisted preview below.
      }
    }
  }
  return data?.canvasImageData ? imageDataToCoverage(data.canvasImageData) : null;
};

export const buildColorCycleSoftEdgeMask = (
  layer: Layer,
  radius: number,
  coverageSource?: ColorCycleSoftEdgeCoverage | null,
  options: ColorCycleSoftEdgeMaskOptions = {},
): ColorCycleSoftEdgeMaskResult | null => {
  if (layer.layerType !== 'color-cycle' || typeof document === 'undefined') {
    return null;
  }

  const coverage = normalizeCoverage(coverageSource) ?? resolveCoverageFromImageData(layer);
  if (!coverage) {
    return null;
  }

  const width = coverage.width;
  const height = coverage.height;
  const hardAlpha = new Uint8ClampedArray(width * height);
  let hasCoverage = false;
  for (let dst = 0; dst < hardAlpha.length; dst += 1) {
    const alpha = coverage.alpha[dst] ?? 0;
    hardAlpha[dst] = alpha > 0 ? 255 : 0;
    hasCoverage = hasCoverage || alpha > 0;
  }
  if (!hasCoverage) {
    return null;
  }

  const edgeDistance = computeInteriorDistance(hardAlpha, width, height);
  const ditheredAlpha = ditherEdgeAlpha(
    hardAlpha,
    edgeDistance,
    width,
    height,
    radius,
    options.ditherSize ?? 1,
    options.ditherAlgorithm ?? 'ordered',
  );

  const softEdgeMaskImageData = createMaskImageData(width, height, ditheredAlpha);
  const softEdgeMask = document.createElement('canvas');
  softEdgeMask.width = width;
  softEdgeMask.height = height;
  softEdgeMask.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings)
    ?.putImageData(softEdgeMaskImageData, 0, 0);

  return { softEdgeMask, softEdgeMaskImageData };
};
