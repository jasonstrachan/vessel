import type {
  BrushSettings,
  CustomBrush,
  CustomBrushColorCycleData,
} from '@/types';

/**
 * Configuration for the brush engine facade.
 */
export interface BrushEngineConfig {
  brushSettings: BrushSettings;
  transparencyLockEnabled?: boolean;
  getPatternTempContext?: (width: number, height: number) => CanvasRenderingContext2D | null;
  brushStampCache?: Map<string, HTMLCanvasElement>;
  createPixelCircleStamp?: (size: number) => HTMLCanvasElement | null;
  createPixelSquareStamp?: (size: number) => HTMLCanvasElement | null;
  getRotationTempContext?: (width: number, height: number) => CanvasRenderingContext2D | null;
  customBrushes?: CustomBrush[];
}

/**
 * Simplified custom brush stroke data.
 */
export interface CustomBrushStrokeData {
  imageData: ImageData;
  width: number;
  height: number;
  isColorizable?: boolean;
  isResampler?: boolean;
  cacheKey?: string;
  colorCycle?: CustomBrushColorCycleData;
}

export interface BrushStrokeParams {
  from: { x: number; y: number };
  to: { x: number; y: number };
  pressure: number;
  velocity: number;
  timestamp: number;
  customBrushData?: CustomBrushStrokeData;
}

export const resolveCustomPatternDimensions = (
  customBrushData?: CustomBrushStrokeData,
): { width: number; height: number } | undefined => {
  if (!customBrushData) {
    return undefined;
  }

  const width = Number(customBrushData.width);
  const height = Number(customBrushData.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return undefined;
  }

  return { width, height };
};
