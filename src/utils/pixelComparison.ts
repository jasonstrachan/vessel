import { logError } from '@/utils/debug';
// Direct pixel comparison utilities for debugging preview vs cache discrepancies

export interface PixelDifference {
  index: number;
  x: number;
  y: number;
  preview: { r: number; g: number; b: number; a: number };
  cache: { r: number; g: number; b: number; a: number };
  diff: { r: number; g: number; b: number; a: number };
}

export interface ComparisonResult {
  identical: boolean;
  totalPixels: number;
  differingPixels: number;
  maxDifference: number;
  differences: PixelDifference[];
  summary: {
    avgRedDiff: number;
    avgGreenDiff: number;
    avgBlueDiff: number;
    avgAlphaDiff: number;
  };
}

/**
 * Compare two ImageData objects pixel by pixel
 * @param previewData ImageData from preview rendering
 * @param cacheData ImageData from cached brush
 * @param tolerance Maximum allowed difference per channel (0-255)
 * @param maxDifferencesToLog Maximum number of differences to include in result
 */
export function compareImageData(
  previewData: ImageData,
  cacheData: ImageData,
  tolerance: number = 0,
  maxDifferencesToLog: number = 10
): ComparisonResult {

  // Check dimensions first
  if (previewData.width !== cacheData.width || previewData.height !== cacheData.height) {
    logError('[PixelComparison] Dimension mismatch!', {
      preview: `${previewData.width}x${previewData.height}`,
      cache: `${cacheData.width}x${cacheData.height}`
    });
    return {
      identical: false,
      totalPixels: 0,
      differingPixels: -1,
      maxDifference: -1,
      differences: [],
      summary: { avgRedDiff: -1, avgGreenDiff: -1, avgBlueDiff: -1, avgAlphaDiff: -1 }
    };
  }

  const width = previewData.width;
  const height = previewData.height;
  const totalPixels = width * height;
  const previewPixels = previewData.data;
  const cachePixels = cacheData.data;

  const differences: PixelDifference[] = [];
  let differingPixels = 0;
  let maxDifference = 0;
  let totalRedDiff = 0;
  let totalGreenDiff = 0;
  let totalBlueDiff = 0;
  let totalAlphaDiff = 0;

  for (let i = 0; i < previewPixels.length; i += 4) {
    const pixelIndex = i / 4;
    const x = pixelIndex % width;
    const y = Math.floor(pixelIndex / width);

    const previewR = previewPixels[i];
    const previewG = previewPixels[i + 1];
    const previewB = previewPixels[i + 2];
    const previewA = previewPixels[i + 3];

    const cacheR = cachePixels[i];
    const cacheG = cachePixels[i + 1];
    const cacheB = cachePixels[i + 2];
    const cacheA = cachePixels[i + 3];

    const diffR = Math.abs(previewR - cacheR);
    const diffG = Math.abs(previewG - cacheG);
    const diffB = Math.abs(previewB - cacheB);
    const diffA = Math.abs(previewA - cacheA);

    const maxChannelDiff = Math.max(diffR, diffG, diffB, diffA);

    if (maxChannelDiff > tolerance) {
      differingPixels++;
      maxDifference = Math.max(maxDifference, maxChannelDiff);
      totalRedDiff += diffR;
      totalGreenDiff += diffG;
      totalBlueDiff += diffB;
      totalAlphaDiff += diffA;

      // Log first few differences for debugging
      if (differences.length < maxDifferencesToLog) {
        differences.push({
          index: pixelIndex,
          x,
          y,
          preview: { r: previewR, g: previewG, b: previewB, a: previewA },
          cache: { r: cacheR, g: cacheG, b: cacheB, a: cacheA },
          diff: { r: diffR, g: diffG, b: diffB, a: diffA }
        });
      }
    }
  }

  const result: ComparisonResult = {
    identical: differingPixels === 0,
    totalPixels,
    differingPixels,
    maxDifference,
    differences,
    summary: {
      avgRedDiff: differingPixels > 0 ? totalRedDiff / differingPixels : 0,
      avgGreenDiff: differingPixels > 0 ? totalGreenDiff / differingPixels : 0,
      avgBlueDiff: differingPixels > 0 ? totalBlueDiff / differingPixels : 0,
      avgAlphaDiff: differingPixels > 0 ? totalAlphaDiff / differingPixels : 0,
    }
  };



  return result;
}

/**
 * Extract ImageData from an HTMLCanvasElement
 * @param canvas The canvas element to extract from
 * @param label Label for logging
 */
export function extractImageDataFromCanvas(canvas: HTMLCanvasElement, label: string): ImageData | null {
  const ctx = canvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
  if (!ctx) {
    logError(`[PixelComparison] Failed to get context for ${label} canvas`);
    return null;
  }

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

  return imageData;
}

/**
 * Create a clean temporary canvas and copy source canvas to it
 * @param sourceCanvas Canvas to copy from
 * @param label Label for logging
 */
export function createCleanCanvasCopy(sourceCanvas: HTMLCanvasElement, label: string): HTMLCanvasElement | null {
  try {
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = sourceCanvas.width;
    tempCanvas.height = sourceCanvas.height;
    
    const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
    if (!tempCtx) {
      logError(`[PixelComparison] Failed to get temp context for ${label}`);
      return null;
    }

    // Clear and copy
    tempCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);
    tempCtx.drawImage(sourceCanvas, 0, 0);


    return tempCanvas;
  } catch (error) {
    logError(`[PixelComparison] Error creating clean copy for ${label}:`, error);
    return null;
  }
}

/**
 * Global function to compare the latest preview and cache ImageData
 * Available in browser console as window.compareLatestBrushData()
 */
export function compareLatestBrushData(tolerance: number = 0): void {
  const windowWithDebugData = window as Window & {
    latestPreviewImageData?: ImageData;
    latestCacheImageData?: ImageData;
  };
  const previewData = windowWithDebugData.latestPreviewImageData;
  const cacheData = windowWithDebugData.latestCacheImageData;

  if (!previewData) {
    logError('[PixelComparison] No preview ImageData available. Make sure to interact with MiniCanvas first.');
    return;
  }

  if (!cacheData) {
    logError('[PixelComparison] No cache ImageData available. Make sure to draw on canvas first.');
    return;
  }

  compareImageData(previewData, cacheData, tolerance, 20);

}

// Make the comparison function globally available
if (typeof window !== 'undefined') {
  (window as Window & { compareLatestBrushData?: typeof compareLatestBrushData }).compareLatestBrushData = compareLatestBrushData;
}