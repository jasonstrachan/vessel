import { BrushShape, type BrushSettings } from '@/types';

import { isWebGPUSupported } from '@/lib/shapeFill/gpu/WebGPUDeviceManager';
import type { PathInput } from '@/lib/shapeFill/hybrid/runtime';
import type { FillContour, FillSolid } from '@/lib/shapeFill/hybrid/types';
import { parseCssColor } from '@/utils/color/parseCssColor';

import { resolveCoordinateSnap } from './common';
import { drawContourFill } from './contour';
import { drawDelaunayFill } from './delaunator';
import { drawLinesFill } from './lines';
import { drawLines2Fill } from './lines2';
import { drawFlowFill } from './flow';
import { drawInkRibbonsFill } from './inkRibbons';
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
) => fillColor !== undefined && vertexCount >= 3 && !['contour', 'lines', 'lines2', 'triangle', 'flow', 'inkRibbons'].includes(mode);

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const toNormalizedRgba = (color: string | undefined, fallback: [number, number, number, number]): [number, number, number, number] => {
  const fallbackColor = {
    r: clamp01(fallback[0]) * 255,
    g: clamp01(fallback[1]) * 255,
    b: clamp01(fallback[2]) * 255,
    a: clamp01(fallback[3]) * 255,
  };
  const parsed = parseCssColor(color ?? '', fallbackColor);
  return [parsed.r / 255, parsed.g / 255, parsed.b / 255, parsed.a / 255];
};

const createSolidFill = (color: string | undefined, opacity: number): FillSolid => {
  const rgba = toNormalizedRgba(color, [1, 1, 1, opacity]);
  rgba[3] = clamp01(opacity * rgba[3]);
  return { type: 'solid', rgba };
};

const createContourFill = (
  brushSettings: BrushSettings,
  fillColor: string | undefined,
  spacingOverride?: number
): FillContour => {
  const spacing = Math.max(0.5, spacingOverride ?? brushSettings.contourSpacing ?? 4);
  const join = (() => {
    const smoothness = brushSettings.contourSmoothness ?? 0;
    if (smoothness > 0.66) return 'round';
    if (smoothness > 0.33) return 'bevel';
    return 'miter';
  })();
  const miterLimit = Math.max(1, brushSettings.shapeFillLineWidth ?? 4);
  return {
    type: 'contour',
    spacing,
    join,
    miterLimit,
    base: createSolidFill(fillColor, brushSettings.opacity),
  };
};

const toPathInput = (vertices: Point[], snap: (value: number) => number): PathInput => {
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
  toPathInput,
  createContourFill,
};

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
  const pixelMode = brushSettings.shapeFillPixelMode ?? true;
  const snap = resolveCoordinateSnap(pixelMode);
  const minX = Math.floor(Math.min(...vertices.map(v => v.x)));
  const minY = Math.floor(Math.min(...vertices.map(v => v.y)));
  const maxX = Math.ceil(Math.max(...vertices.map(v => v.x)));
  const maxY = Math.ceil(Math.max(...vertices.map(v => v.y)));

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
        dependencies,
        isPreview,
        strokeColorOverride: lineOptions?.strokeColorOverride,
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

    if (mode === 'inkRibbons') {
      drawInkRibbonsFill({
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
        dependencies,
      });
      return;
    }

    const spacingOverride = lineOptions?.contourSpacingOverride ?? lineOptions?.lineSpacingA ?? lineOptions?.lineSpacingB;

    const controller = dependencies.hybridController;
    const runtimeContext = lineOptions?.runtimeContext;
    const overlayCanvas = dependencies.getOverlayCanvas?.() ?? runtimeContext?.overlayCanvas ?? ctx.canvas ?? null;
    const finalCanvas = dependencies.getCompositeCanvas?.() ?? runtimeContext?.finalCanvas ?? null;

    if (controller && overlayCanvas && isWebGPUSupported()) {
      controller.attachCanvases(overlayCanvas, finalCanvas);
      const viewTransform = dependencies.getViewTransform?.() ?? runtimeContext?.viewTransform;
      const path = toPathInput(vertices, snap);
      const fill = createContourFill(brushSettings, lineOptions?.strokeColorOverride ?? polygonData?.fillColor ?? brushSettings.color, spacingOverride);

      void controller.build({
        paths: [path],
        fill,
        preview: isPreview,
        viewportScale: viewTransform?.scale,
        viewTransform,
      }).catch(error => {
        console.warn('[HybridShapeFill] contour build failed, falling back to CPU', error);
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
      });
      return;
    }

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
