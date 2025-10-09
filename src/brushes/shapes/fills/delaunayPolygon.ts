import type { BrushSettings } from '@/types';
import { drawDelaunayFill } from './delaunayFill';
import type { ShapeFillOptions, Point } from './types';

export type { ShapeFillOptions } from './types';

export type DrawDelaunayPolygonParams = {
  ctx: CanvasRenderingContext2D;
  polygonData: { vertices: Point[]; fillColor?: string };
  brushSettings: BrushSettings;
  isPreview?: boolean;
  options?: ShapeFillOptions;
};

export const drawDelaunayPolygon = ({
  ctx,
  polygonData,
  brushSettings,
  isPreview = false,
  options,
}: DrawDelaunayPolygonParams): void => {
  drawDelaunayFill({
    ctx,
    vertices: polygonData.vertices,
    brushSettings,
    isPreview,
    options,
  });
};
