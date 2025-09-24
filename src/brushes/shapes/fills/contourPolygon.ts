import { BrushShape, type BrushSettings } from '@/types';

import { drawContourFill } from './contour';
import { drawDelaunayFill } from './delaunator';
import { drawLinesFill } from './lines';
import { drawLines2Fill } from './lines2';
import { drawFlowFill } from './flow';
import type {
  ContourLineOptions,
  ShapeFillDependencies,
  Point,
} from './types';

export type { ContourLineOptions } from './types';
export type { ShapeFillDependencies as DrawContourPolygonDependencies } from './types';

export type DrawContourPolygonParams = {
  ctx: CanvasRenderingContext2D;
  polygonData: { vertices: Point[]; fillColor?: string };
  brushSettings: BrushSettings;
  dependencies: ShapeFillDependencies;
  isPreview?: boolean;
  lineOptions?: ContourLineOptions;
};

const shouldFillPolygon = (
  mode: string,
  fillColor: string | undefined,
  vertexCount: number
) => fillColor !== undefined && vertexCount >= 3 && !['contour', 'lines', 'lines2', 'triangle', 'flow'].includes(mode);

export const drawContourPolygon = ({
  ctx,
  polygonData,
  brushSettings,
  dependencies,
  isPreview = false,
  lineOptions,
}: DrawContourPolygonParams): void => {
  const rawVertices = polygonData?.vertices ?? [];
  const vertices = rawVertices.filter(
    (vertex): vertex is Point => Boolean(vertex) && typeof vertex.x === 'number' && typeof vertex.y === 'number'
  );

  if (vertices.length < 3) {
    return;
  }

  const rawMode = brushSettings.shapeGradientMode || 'contour';
  const mode = rawMode === 'mesh' ? 'lines' : rawMode;

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.lineJoin = 'miter';
  ctx.lineCap = 'butt';
  ctx.globalAlpha = brushSettings.opacity;
  ctx.globalCompositeOperation = brushSettings.blendMode || 'source-over';

  try {
    if (shouldFillPolygon(mode, polygonData?.fillColor, vertices.length)) {
      try {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(Math.round(vertices[0].x), Math.round(vertices[0].y));
        for (let i = 1; i < vertices.length; i++) {
          ctx.lineTo(Math.round(vertices[i].x), Math.round(vertices[i].y));
        }
        ctx.closePath();
        const prevStyle = ctx.fillStyle;
        const prevAlpha = ctx.globalAlpha;
        ctx.fillStyle = polygonData?.fillColor as string;
        ctx.globalAlpha = brushSettings.opacity;
        ctx.fill();
        ctx.fillStyle = prevStyle;
        ctx.globalAlpha = prevAlpha;
        ctx.restore();
      } catch {
        // ignore fill failures to keep drawing resilient
      }
    }

    const minX = Math.floor(Math.min(...vertices.map(v => v.x)));
    const minY = Math.floor(Math.min(...vertices.map(v => v.y)));
    const maxX = Math.ceil(Math.max(...vertices.map(v => v.x)));
    const maxY = Math.ceil(Math.max(...vertices.map(v => v.y)));
    const boundWidth = maxX - minX;
    const boundHeight = maxY - minY;

    if (mode === 'lines') {
      const shapeGradientMode = brushSettings.shapeGradientMode === 'mesh'
        ? 'lines'
        : brushSettings.shapeGradientMode;
      const isLines2Variant =
        lineOptions?.variant === 'lines2' ||
        brushSettings.brushShape === BrushShape.CONTOUR_LINES2 ||
        (brushSettings.brushShape === BrushShape.CONTOUR_POLYGON && shapeGradientMode === 'lines2');

      if (isLines2Variant) {
        drawLines2Fill({
          ctx,
          vertices,
          brushSettings,
          lineOptions,
        });
        return;
      }

      drawLinesFill({
        ctx,
        vertices,
        brushSettings,
        lineOptions,
      });
      return;
    }

    if (mode === 'flow') {
      drawFlowFill({
        ctx,
        vertices,
        brushSettings,
        dependencies,
        isPreview,
        randomSeed: lineOptions?.randomSeed,
        strokeColorOverride: lineOptions?.strokeColorOverride,
      });
      return;
    }

    if (mode === 'triangle') {
      drawDelaunayFill({
        ctx,
        vertices,
        brushSettings,
        boundWidth,
        boundHeight,
        isPreview,
        strokeColorOverride: lineOptions?.strokeColorOverride,
      });
      return;
    }

    const spacingOverride = lineOptions?.contourSpacingOverride ?? lineOptions?.lineSpacingA ?? lineOptions?.lineSpacingB;

    drawContourFill({
      ctx,
      vertices,
      brushSettings,
      dependencies,
      isPreview,
      spacingOverride,
      randomSeed: lineOptions?.randomSeed,
      previewDetail: lineOptions?.previewDetail,
      strokeColorOverride: lineOptions?.strokeColorOverride,
    });
  } finally {
    ctx.restore();
  }
};
