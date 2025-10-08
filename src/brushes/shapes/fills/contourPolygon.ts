import { BrushShape, type BrushSettings } from '@/types';
import { debugLog } from '@/utils/debug';
import { parseCssColor } from '@/utils/color/parseCssColor';

import { resolveCoordinateSnap } from './common';
import { drawNewShapeFill } from './newShapeFill';
import type { ShapeFillOptions, Point } from './types';

export type { ShapeFillOptions } from './types';

export type DrawContourPolygonParams = {
  ctx: CanvasRenderingContext2D;
  polygonData: { vertices: Point[]; fillColor?: string };
  brushSettings: BrushSettings;
  isPreview?: boolean;
  options?: ShapeFillOptions;
};

const shouldFillPolygon = (
  mode: string,
  fillColor: string | undefined,
  vertexCount: number
) => fillColor !== undefined && vertexCount >= 3 && !['contour', 'lines', 'lines2', 'triangle', 'flow', 'inkRibbons'].includes(mode);

type TestContourFillBase = {
  type: 'solid';
  rgba: [number, number, number, number];
};

type TestContourFill = {
  type: 'contour';
  spacing: number;
  join: 'miter' | 'round' | 'bevel';
  miterLimit: number;
  base: TestContourFillBase;
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const createContourFillForTests = (
  brushSettings: BrushSettings,
  fillColor: string | undefined,
  spacingOverride?: number,
): TestContourFill => {
  const spacing = Math.max(0.5, spacingOverride ?? brushSettings.contourSpacing ?? 4);
  const join = (() => {
    const smoothness = brushSettings.contourSmoothness ?? 0;
    if (smoothness > 0.66) return 'round';
    if (smoothness > 0.33) return 'bevel';
    return 'miter';
  })();
  const parsed = parseCssColor(fillColor ?? brushSettings.color ?? '#ffffff', {
    r: 255,
    g: 255,
    b: 255,
    a: clamp01(brushSettings.opacity ?? 1) * 255,
  });
  const rgba: [number, number, number, number] = [
    parsed.r / 255,
    parsed.g / 255,
    parsed.b / 255,
    clamp01((brushSettings.opacity ?? 1) * (parsed.a / 255)),
  ];
  return {
    type: 'contour',
    spacing,
    join,
    miterLimit: Math.max(1, brushSettings.shapeFillLineWidth ?? 4),
    base: {
      type: 'solid',
      rgba,
    },
  };
};

const toPathInputForTests = (vertices: Point[], snap: (value: number) => number) => {
  const commands: Array<'moveTo' | 'lineTo' | 'closePath'> = [];
  const coords: number[] = [];
  if (!vertices.length) {
    return { commands, points: new Float32Array() };
  }
  commands.push('moveTo');
  coords.push(snap(vertices[0].x), snap(vertices[0].y));
  for (let i = 1; i < vertices.length; i += 1) {
    commands.push('lineTo');
    coords.push(snap(vertices[i].x), snap(vertices[i].y));
  }
  commands.push('closePath');
  return {
    commands,
    points: Float32Array.from(coords),
  };
};

export const __contourPolygonTestUtils = {
  toPathInput: toPathInputForTests,
  createContourFill: createContourFillForTests,
};

export const drawContourPolygon = ({
  ctx,
  polygonData,
  brushSettings,
  isPreview = false,
  options,
}: DrawContourPolygonParams): void => {
  const rawVertices = polygonData?.vertices ?? [];
  const vertices = rawVertices.filter(
    (vertex): vertex is Point => Boolean(vertex) && typeof vertex.x === 'number' && typeof vertex.y === 'number'
  );

  if (vertices.length < 3) {
    return;
  }

  if (
    brushSettings.brushShape === BrushShape.NEW_SHAPE_FILL ||
    brushSettings.brushShape === BrushShape.CONTOUR_POLYGON ||
    brushSettings.brushShape === BrushShape.CONTOUR_LINES2
  ) {
    drawNewShapeFill({
      ctx,
      vertices,
      brushSettings,
      isPreview,
      options: {
        spacingOverride: options?.spacingOverride,
        randomSeed: options?.randomSeed,
        previewDetail: options?.previewDetail,
        strokeColorOverride: options?.strokeColorOverride ?? polygonData?.fillColor,
      },
    });
    return;
  }

  const rawMode = brushSettings.shapeGradientMode || 'contour';
  const mode = rawMode === 'mesh' ? 'lines' : rawMode;
  const pixelMode = brushSettings.shapeFillPixelMode ?? true;
  const snap = resolveCoordinateSnap(pixelMode);
  ctx.save();
  ctx.imageSmoothingEnabled = !pixelMode;
  ctx.lineJoin = 'miter';
  ctx.lineCap = 'butt';
  ctx.globalAlpha = brushSettings.opacity;
  ctx.globalCompositeOperation = brushSettings.blendMode || 'source-over';

  try {
    if (shouldFillPolygon(mode, polygonData?.fillColor, vertices.length)) {
      try {
        ctx.save();
        const prevStyle = ctx.fillStyle;
        const prevAlpha = ctx.globalAlpha;

        ctx.beginPath();
        ctx.moveTo(snap(vertices[0].x), snap(vertices[0].y));
        for (let i = 1; i < vertices.length; i++) {
          ctx.lineTo(snap(vertices[i].x), snap(vertices[i].y));
        }
        ctx.closePath();

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

    if (mode === 'flow' || mode === 'inkRibbons' || mode === 'triangle') {
      debugLog('shape-fill', `Shape fill mode "${mode}" retired; using contour fallback.`);
    }

    debugLog('shape-fill', `Mode "${mode}" no longer supported; using new CPU fill.`);

    drawNewShapeFill({
      ctx,
      vertices,
      brushSettings,
      isPreview,
      options: {
        spacingOverride: options?.spacingOverride,
        randomSeed: options?.randomSeed,
        previewDetail: options?.previewDetail,
        strokeColorOverride: options?.strokeColorOverride ?? polygonData?.fillColor,
      },
    });
  } finally {
    ctx.restore();
  }
};
