import type { ShapeFillFinalizePayload } from '@/shapeFill';
import { applyLostEdgeErosionToContext } from '@/shapeFill/lostEdgeErosion';
import { toPixelPerfectFill } from '@/shapeFill/pixelPerfect';
import { renderFill } from '@/shapeFill/renderers/cpuRenderer';
import type { FillParams, FillResult } from '@/shapeFill/types';
import type { Layer } from '@/types';

import {
  getShapeFillPolygonForMode,
  getShapeFillRenderBounds,
  hasVisibleShapeFillOverlayPixels,
  shapeFillBoundingBoxToRoi,
  type ShapeFillBoundingBox,
  type ShapeFillRoi,
} from './shapeFillGeometry';

const LOST_EDGE_TILE_SIZE = 4;

export type ShapeFillFinalizeOutcome =
  | 'committed-raster'
  | 'blocked-unsupported-layer'
  | 'failed-empty-overlay'
  | 'failed-missing-target'
  | 'failed-invalid-project-size';

export type ShapeFillFinalizeTarget =
  | {
      ok: true;
      layer: Layer;
      project: { width: number; height: number };
    }
  | {
      ok: false;
      outcome: Exclude<ShapeFillFinalizeOutcome, 'committed-raster' | 'failed-empty-overlay'>;
      message: string;
    };

export const validateShapeFillFinalizeTarget = ({
  activeLayer,
  project,
}: {
  activeLayer: Layer | undefined;
  project: { width: number; height: number } | null | undefined;
}): ShapeFillFinalizeTarget => {
  if (!activeLayer) {
    return {
      ok: false,
      outcome: 'failed-missing-target',
      message: 'Shape Fill needs an active raster layer.',
    };
  }

  if (activeLayer.layerType === 'color-cycle') {
    return {
      ok: false,
      outcome: 'blocked-unsupported-layer',
      message: 'Shape Fill cannot commit to a Color Cycle layer yet. Select a normal layer.',
    };
  }

  if (!project || project.width <= 0 || project.height <= 0) {
    return {
      ok: false,
      outcome: 'failed-invalid-project-size',
      message: 'Shape Fill could not commit because the project size is invalid.',
    };
  }

  return { ok: true, layer: activeLayer, project };
};

export const renderShapeFillFinalOverlay = ({
  canvas,
  ctx,
  payload,
  fillParams,
  primaryColor,
  secondaryColor,
  pixelPerfect,
  showOutline,
  opacity,
  boundingBox,
  project,
  applyTransparencyLock,
}: {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  payload: ShapeFillFinalizePayload;
  fillParams: FillParams;
  primaryColor: string;
  secondaryColor?: string;
  pixelPerfect: boolean;
  showOutline: boolean;
  opacity: number;
  boundingBox: ShapeFillBoundingBox | null;
  project: { width: number; height: number };
  applyTransparencyLock: () => void;
}): {
  params: FillParams;
  result: FillResult;
  roi?: ShapeFillRoi;
  hasVisibleOverlay: boolean;
  effectiveBoundingBox: ShapeFillBoundingBox | null;
} => {
  const paramsWithColor: FillParams = {
    ...fillParams,
    fillColor: primaryColor,
  };
  if (secondaryColor) {
    paramsWithColor.backgroundColor = secondaryColor;
  } else if ('backgroundColor' in paramsWithColor) {
    delete (paramsWithColor as { backgroundColor?: string }).backgroundColor;
  }

  const polygonPoints = getShapeFillPolygonForMode(payload.shape.points, pixelPerfect);
  const renderBounds = getShapeFillRenderBounds(payload.shape.bounds, polygonPoints, pixelPerfect);
  const finalResult = payload.strategy.apply(payload.shape, paramsWithColor);
  const renderedResult = pixelPerfect ? toPixelPerfectFill(finalResult) : finalResult;
  const rawLostEdge = paramsWithColor.lostEdge ?? 0;
  const lostEdge = Math.max(0, Math.min(100, rawLostEdge));

  const drawFillToContext = (targetCtx: CanvasRenderingContext2D): void => {
    targetCtx.save();
    targetCtx.globalAlpha = opacity;
    targetCtx.globalCompositeOperation = 'source-over';
    if (secondaryColor && polygonPoints.length >= 3) {
      targetCtx.save();
      targetCtx.fillStyle = secondaryColor;
      targetCtx.beginPath();
      targetCtx.moveTo(polygonPoints[0].x, polygonPoints[0].y);
      for (let i = 1; i < polygonPoints.length; i += 1) {
        targetCtx.lineTo(polygonPoints[i].x, polygonPoints[i].y);
      }
      targetCtx.closePath();
      targetCtx.fill();
      targetCtx.restore();
    }
    targetCtx.lineWidth = pixelPerfect ? 1 : paramsWithColor.thickness ?? 1;
    targetCtx.strokeStyle = primaryColor;
    targetCtx.fillStyle = primaryColor;
    renderFill(targetCtx, renderedResult);
    if (showOutline && polygonPoints.length >= 3) {
      targetCtx.strokeStyle = 'rgba(0,0,0,0.35)';
      targetCtx.beginPath();
      targetCtx.moveTo(polygonPoints[0].x, polygonPoints[0].y);
      for (let i = 1; i < polygonPoints.length; i += 1) {
        targetCtx.lineTo(polygonPoints[i].x, polygonPoints[i].y);
      }
      targetCtx.closePath();
      targetCtx.stroke();
    }
    targetCtx.restore();
  };

  ctx.save();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = !pixelPerfect;
  drawFillToContext(ctx);
  ctx.restore();

  if (lostEdge > 0) {
    const padding = Math.max(
      4,
      Math.ceil((paramsWithColor.thickness ?? 1) * 2 + (paramsWithColor.spacing ?? 0))
    );
    applyLostEdgeErosionToContext(ctx, polygonPoints, renderBounds, padding, lostEdge, LOST_EDGE_TILE_SIZE);
  }

  applyTransparencyLock();

  const roi = shapeFillBoundingBoxToRoi(boundingBox, project);
  return {
    params: paramsWithColor,
    result: renderedResult,
    roi,
    hasVisibleOverlay: hasVisibleShapeFillOverlayPixels(canvas, roi),
    effectiveBoundingBox: boundingBox,
  };
};
