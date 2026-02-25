import { applySierraLiteLostEdgeMask } from '@/utils/ditherAlgorithms';

export type Point = { x: number; y: number };
export type Bounds = { minX: number; maxX: number; minY: number; maxY: number };

/**
 * Apply lost-edge erosion to the already-rendered shape fill on the given context.
 * Expects the fill to be drawn on ctx.canvas; builds a silhouette mask in an ROI and
 * multiplies the fill alpha by the dithered keep mask.
 */
export function applyLostEdgeErosionToContext(
  ctx: CanvasRenderingContext2D,
  polygonPoints: Point[],
  bounds: Bounds,
  padding: number,
  lostEdge: number,
  tileSize = 4
): void {
  if (!ctx || lostEdge <= 0 || polygonPoints.length === 0) return;

  const canvas = ctx.canvas;
  const sx = Math.max(0, Math.floor(bounds.minX - padding));
  const sy = Math.max(0, Math.floor(bounds.minY - padding));
  const sw = Math.max(
    1,
    Math.min(canvas.width - sx, Math.ceil(bounds.maxX - bounds.minX + padding * 2))
  );
  const sh = Math.max(
    1,
    Math.min(canvas.height - sy, Math.ceil(bounds.maxY - bounds.minY + padding * 2))
  );

  if (sw <= 0 || sh <= 0) return;

  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = sw;
  maskCanvas.height = sh;
  const maskCtx = maskCanvas.getContext('2d');
  if (!maskCtx) return;

  // Build binary silhouette in ROI coords
  maskCtx.save();
  maskCtx.clearRect(0, 0, sw, sh);
  maskCtx.fillStyle = '#ffffff';
  maskCtx.beginPath();
  maskCtx.moveTo(polygonPoints[0].x - sx, polygonPoints[0].y - sy);
  for (let i = 1; i < polygonPoints.length; i += 1) {
    const pt = polygonPoints[i];
    maskCtx.lineTo(pt.x - sx, pt.y - sy);
  }
  maskCtx.closePath();
  maskCtx.fill();
  maskCtx.restore();

  const maskImage = maskCtx.getImageData(0, 0, sw, sh);
  const maskAlpha = new Uint8Array(sw * sh);
  for (let i = 0, j = 3; i < maskAlpha.length; i += 1, j += 4) {
    maskAlpha[i] = maskImage.data[j];
  }

  const keep = applySierraLiteLostEdgeMask(maskAlpha, sw, sh, lostEdge, tileSize);

  const region = ctx.getImageData(sx, sy, sw, sh);
  const data = region.data;
  for (let i = 0, j = 3; i < keep.length; i += 1, j += 4) {
    const k = keep[i];
    if (k === 255) continue;
    const a = data[j];
    if (a === 0) continue;
    data[j] = Math.round((a * k) / 255);
  }

  ctx.putImageData(region, sx, sy);
}
