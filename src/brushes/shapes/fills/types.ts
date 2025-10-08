import type { BrushSettings } from '@/types';

export type Point = { x: number; y: number };

export type ShapeFillOptions = {
  spacingOverride?: number;
  randomSeed?: number;
  previewDetail?: 'minimal' | 'full';
  strokeColorOverride?: string;
};

export interface ShapeFillParams {
  ctx: CanvasRenderingContext2D;
  vertices: Point[];
  brushSettings: BrushSettings;
  isPreview?: boolean;
  options?: ShapeFillOptions;
}
