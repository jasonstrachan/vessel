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

const clampByte = (value: number): number => Math.max(0, Math.min(255, Math.round(value)));

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

const blurAlpha = (
  source: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
): Uint8ClampedArray => {
  const blurRadius = Math.max(0, Math.floor(radius));
  if (blurRadius <= 0) {
    return new Uint8ClampedArray(source);
  }

  const horizontal = new Float32Array(width * height);
  const output = new Uint8ClampedArray(width * height);
  const diameter = blurRadius * 2 + 1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let offset = -blurRadius; offset <= blurRadius; offset += 1) {
        const sx = x + offset;
        sum += sx < 0 || sx >= width ? 0 : source[y * width + sx] ?? 0;
      }
      horizontal[y * width + x] = sum / diameter;
    }
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let offset = -blurRadius; offset <= blurRadius; offset += 1) {
        const sy = y + offset;
        sum += sy < 0 || sy >= height ? 0 : horizontal[sy * width + x] ?? 0;
      }
      output[y * width + x] = clampByte(sum / diameter);
    }
  }

  return output;
};

const isCoveredInteriorPixel = (
  alpha: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  radius: number,
): boolean => {
  const edgeRadius = Math.max(0, Math.floor(radius));
  if (edgeRadius <= 0) {
    return true;
  }
  for (let offsetY = -edgeRadius; offsetY <= edgeRadius; offsetY += 1) {
    const sampleY = y + offsetY;
    if (sampleY < 0 || sampleY >= height) {
      return false;
    }
    for (let offsetX = -edgeRadius; offsetX <= edgeRadius; offsetX += 1) {
      const sampleX = x + offsetX;
      if (sampleX < 0 || sampleX >= width || alpha[sampleY * width + sampleX] !== 255) {
        return false;
      }
    }
  }
  return true;
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

  const blurRadius = Math.max(0, Math.floor(radius));
  const blurredAlpha = blurAlpha(hardAlpha, width, height, blurRadius);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (
        hardAlpha[index] === 255
        && isCoveredInteriorPixel(hardAlpha, width, height, x, y, blurRadius)
      ) {
        blurredAlpha[index] = 255;
      }
    }
  }

  const softEdgeMaskImageData = createMaskImageData(width, height, blurredAlpha);
  const softEdgeMask = document.createElement('canvas');
  softEdgeMask.width = width;
  softEdgeMask.height = height;
  softEdgeMask.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings)
    ?.putImageData(softEdgeMaskImageData, 0, 0);

  return { softEdgeMask, softEdgeMaskImageData };
};
