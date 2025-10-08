import type { StrokeJob } from '../types';

export interface PixelRasterizerOptions {
  resolution: {
    width: number;
    height: number;
    scale: number;
    fieldResolution?: number;
  };
  color?: { r: number; g: number; b: number; a: number };
  bounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  };
  pixelMode?: boolean;
  hardeningStrength?: number;
  edgeFeather?: number;
  threshold?: number;
}

export interface PixelRasterizerResult {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  origin: { x: number; y: number };
  release(): void;
}

export class PixelRasterizer {
  async rasterize(
    _job: StrokeJob,
    _mesh: unknown,
    _options: PixelRasterizerOptions
  ): Promise<PixelRasterizerResult | null> {
    void _job;
    void _mesh;
    void _options;
    return null;
  }
}
