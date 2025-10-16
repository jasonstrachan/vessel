export interface ColorSwatch {
  color: string;
  count: number;
}

/**
 * Analyzes canvas and returns most frequently used colors
 * Uses sampling for performance - doesn't check every pixel
 */
export function analyzeLayerColors(
  canvas: OffscreenCanvas | HTMLCanvasElement,
  maxSwatches: number = 6,
  sampleRate: number = 10
): ColorSwatch[] {
  const ctx = get2dContext(canvas);
  if (!ctx) return [];

  const width = canvas.width;
  const height = canvas.height;
  
  // Get image data with sampling
  try {
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    
    // Color frequency map
    const colorMap = new Map<string, number>();
    
    // Sample pixels at intervals for performance
    for (let y = 0; y < height; y += sampleRate) {
      for (let x = 0; x < width; x += sampleRate) {
        const idx = (y * width + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const a = data[idx + 3];
        
        // Skip transparent pixels
        if (a < 10) continue;
        
        // Create hex color (with some quantization for grouping similar colors)
        const quantize = (value: number) => Math.min(255, Math.round(value / 8) * 8);
        const qr = quantize(r);
        const qg = quantize(g);
        const qb = quantize(b);
        const color = `#${((1 << 24) + (qr << 16) + (qg << 8) + qb).toString(16).slice(1)}`;
        
        colorMap.set(color, (colorMap.get(color) || 0) + 1);
      }
    }
    
    // Sort by frequency and return top colors
    const sortedColors = Array.from(colorMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxSwatches)
      .map(([color, count]) => ({ color, count }));
    
    return sortedColors;
  } catch {
    // Canvas might be tainted or empty
    return [];
  }
}

type CanvasLike = OffscreenCanvas | HTMLCanvasElement;
type Canvas2DContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function get2dContext(canvas: CanvasLike): Canvas2DContext | null {
  if (canvas instanceof HTMLCanvasElement) {
    return canvas.getContext('2d', { willReadFrequently: true });
  }

  return canvas.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings);
}

/**
 * Throttled color analyzer to prevent performance issues
 */
export class ThrottledColorAnalyzer {
  private analysisTimer: NodeJS.Timeout | null = null;
  private lastAnalysis = 0;
  private minInterval = 500; // Minimum 500ms between analyses
  
  analyze(
    canvas: OffscreenCanvas | HTMLCanvasElement,
    callback: (swatches: ColorSwatch[]) => void,
    maxSwatches: number = 6
  ) {
    const now = Date.now();
    
    // Clear existing timer
    if (this.analysisTimer) {
      clearTimeout(this.analysisTimer);
    }
    
    // Schedule analysis
    const delay = Math.max(0, this.minInterval - (now - this.lastAnalysis));
    
    this.analysisTimer = setTimeout(() => {
      this.lastAnalysis = Date.now();
      const swatches = analyzeLayerColors(canvas, maxSwatches);
      callback(swatches);
    }, delay);
  }
  
  dispose() {
    if (this.analysisTimer) {
      clearTimeout(this.analysisTimer);
      this.analysisTimer = null;
    }
  }
}
