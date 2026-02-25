import type { DitherAlgorithm } from '@/utils/ditherAlgorithms';
import { applyDithering } from '@/hooks/brushEngine/dithering';

export type FillDitherAlgorithm =
  | 'floyd-steinberg'
  | 'jarvis-judice-ninke'
  | 'stucki'
  | 'burkes'
  | 'sierra-3'
  | 'sierra-2'
  | 'sierra-lite'
  | 'atkinson'
  | 'bayer'
  | 'blue-noise'
  | 'void-and-cluster'
  | 'pattern';

export type FillDitherConfig = {
  levels: number;
  pixelSize: number;
  algorithm: FillDitherAlgorithm;
  perceptual: boolean;
  patternStyle?: string;
  customPalette?: string[];
  phaseOffset?: { x: number; y: number };
};

const applyDitheringWithFillResolution = (
  imageData: ImageData,
  config: Omit<FillDitherConfig, 'perceptual'>
): ImageData => {
  const pixelSize = Math.max(1, Math.floor(config.pixelSize));
  const resolvedAlgorithm = config.algorithm || 'sierra-lite';

  if (pixelSize <= 1) {
    return applyDithering(
      imageData,
      config.levels,
      resolvedAlgorithm as DitherAlgorithm,
      config.patternStyle,
      config.customPalette,
      config.phaseOffset
    );
  }

  if (resolvedAlgorithm === 'sierra-lite') {
    return applySierraLiteDitherWithPixelSize(
      imageData,
      config.levels,
      pixelSize,
      config.customPalette
    );
  }

  return downsampleDitherAndScale(
    imageData,
    config.levels,
    pixelSize,
    resolvedAlgorithm,
    config.patternStyle,
    config.customPalette,
    config.phaseOffset
  );
};

const applySierraLiteDitherWithPixelSize = (
  imageData: ImageData,
  numColors: number,
  pixelSize: number,
  customPalette?: string[]
): ImageData => {
  return downsampleDitherAndScale(
    imageData,
    numColors,
    pixelSize,
    'sierra-lite',
    undefined,
    customPalette
  );
};

const downsampleDitherAndScale = (
  imageData: ImageData,
  numColors: number,
  pixelSize: number,
  algorithm: FillDitherAlgorithm,
  patternStyle?: string,
  customPalette?: string[],
  phaseOffset?: { x: number; y: number }
): ImageData => {
  const downsampled = createDownsampledImageData(imageData, pixelSize);
  const resolvedPhase = phaseOffset
    ? {
        x: Math.floor(phaseOffset.x / pixelSize),
        y: Math.floor(phaseOffset.y / pixelSize)
      }
    : undefined;
  const dithered = applyDithering(
    downsampled,
    numColors,
    algorithm as DitherAlgorithm,
    patternStyle,
    customPalette,
    resolvedPhase
  );
  return expandNearestNeighbor(dithered, imageData.width, imageData.height, pixelSize);
};

const createDownsampledImageData = (imageData: ImageData, blockSize: number): ImageData => {
  const width = imageData.width;
  const height = imageData.height;
  const blockWidth = Math.max(1, Math.ceil(width / blockSize));
  const blockHeight = Math.max(1, Math.ceil(height / blockSize));
  const blockData = new Uint8ClampedArray(blockWidth * blockHeight * 4);
  const source = imageData.data;

  // Preserve crisp color by sampling the highest-alpha pixel in each block (falls back to first pixel).
  for (let by = 0; by < blockHeight; by++) {
    const startY = by * blockSize;
    const endY = Math.min(startY + blockSize, height);
    for (let bx = 0; bx < blockWidth; bx++) {
      const startX = bx * blockSize;
      const endX = Math.min(startX + blockSize, width);

      let bestA = -1;
      let r = 0, g = 0, b = 0, a = 0;

      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
          const idx = (y * width + x) * 4;
          const alpha = source[idx + 3];
          if (alpha > bestA) {
            bestA = alpha;
            r = source[idx];
            g = source[idx + 1];
            b = source[idx + 2];
            a = alpha;
          }
        }
      }

      const target = (by * blockWidth + bx) * 4;
      blockData[target] = r;
      blockData[target + 1] = g;
      blockData[target + 2] = b;
      blockData[target + 3] = a;
    }
  }

  return new ImageData(blockData, blockWidth, blockHeight);
};

const expandNearestNeighbor = (
  source: ImageData,
  targetWidth: number,
  targetHeight: number,
  blockSize: number
): ImageData => {
  const output = new ImageData(targetWidth, targetHeight);
  const out = output.data;
  const src = source.data;
  const blockWidth = source.width;
  const blockHeight = source.height;

  for (let by = 0; by < blockHeight; by++) {
    const startY = by * blockSize;
    const endY = Math.min(startY + blockSize, targetHeight);
    for (let bx = 0; bx < blockWidth; bx++) {
      const startX = bx * blockSize;
      const endX = Math.min(startX + blockSize, targetWidth);
      const srcIdx = (by * blockWidth + bx) * 4;
      const r = src[srcIdx];
      const g = src[srcIdx + 1];
      const b = src[srcIdx + 2];
      const a = src[srcIdx + 3];
      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
          const idx = (y * targetWidth + x) * 4;
          out[idx] = r;
          out[idx + 1] = g;
          out[idx + 2] = b;
          out[idx + 3] = a;
        }
      }
    }
  }
  return output;
};

export const fillLinear = (imageData: ImageData, config: FillDitherConfig): ImageData => {
  return applyDitheringWithFillResolution(imageData, config);
};

export const fillConcentric = (imageData: ImageData, config: FillDitherConfig): ImageData => {
  return applyDitheringWithFillResolution(imageData, config);
};
