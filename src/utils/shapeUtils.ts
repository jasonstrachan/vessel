import { ShapePoint, CustomBrush } from '../types';
import { adjustHueAndSaturation } from './imageProcessing';

/**
 * Creates a closed path from an array of points
 */
export function createShapePath(points: ShapePoint[]): Path2D {
  if (points.length < 2) {
    return new Path2D();
  }

  const path = new Path2D();
  path.moveTo(points[0].x, points[0].y);
  
  for (let i = 1; i < points.length; i++) {
    path.lineTo(points[i].x, points[i].y);
  }
  
  // Close the shape
  path.closePath();
  return path;
}

/**
 * Renders a filled shape using the current brush color or custom brush pattern
 */
export function renderShape(
  ctx: CanvasRenderingContext2D,
  path: Path2D,
  color: string,
  customBrush?: CustomBrush,
  useSwatchColor?: boolean,
  hueShift?: number,
  saturationAdjust?: number
): void {
  ctx.save();

  if (customBrush && !useSwatchColor) {
    // Fill with tiled custom brush pattern
    const patternCanvas = document.createElement('canvas');
    patternCanvas.width = customBrush.width;
    patternCanvas.height = customBrush.height;
    const patternCtx = patternCanvas.getContext('2d');
    
    if (patternCtx) {
      let imageData = customBrush.imageData;
      
      // Apply hue shift and saturation adjustments if needed
      if ((hueShift !== undefined && hueShift !== 0) || 
          (saturationAdjust !== undefined && saturationAdjust !== 100)) {
        imageData = adjustHueAndSaturation(
          imageData, 
          hueShift || 0, 
          saturationAdjust || 100
        );
      }
      
      patternCtx.putImageData(imageData, 0, 0);
      const pattern = ctx.createPattern(patternCanvas, 'repeat');
      
      if (pattern) {
        ctx.fillStyle = pattern;
        ctx.fill(path);
      }
    }
  } else {
    // Fill with solid color
    ctx.fillStyle = color;
    ctx.fill(path);
  }

  ctx.restore();
}

/**
 * Renders a preview of the shape being drawn (should look identical to final result)
 */
export function renderShapePreview(
  ctx: CanvasRenderingContext2D,
  path: Path2D,
  color: string,
  customBrush?: CustomBrush,
  useSwatchColor?: boolean,
  brushOpacity: number = 1.0,
  hueShift?: number,
  saturationAdjust?: number
): void {
  ctx.save();
  ctx.globalAlpha = brushOpacity * 0.7; // Slightly more transparent for preview, but respect brush opacity
  
  renderShape(ctx, path, color, customBrush, useSwatchColor, hueShift, saturationAdjust);
  
  ctx.restore();
}

/**
 * Calculates the bounding box of a set of points
 */
export function getShapeBounds(points: ShapePoint[]): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  if (points.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  let minX = points[0].x;
  let maxX = points[0].x;
  let minY = points[0].y;
  let maxY = points[0].y;

  for (let i = 1; i < points.length; i++) {
    const point = points[i];
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY
  };
}

/**
 * Simplifies a path by removing points that are too close together
 */
export function simplifyPath(points: ShapePoint[], tolerance: number = 2): ShapePoint[] {
  if (points.length <= 2) {
    return points;
  }

  const simplified: ShapePoint[] = [points[0]];
  
  for (let i = 1; i < points.length; i++) {
    const lastPoint = simplified[simplified.length - 1];
    const currentPoint = points[i];
    
    const distance = Math.sqrt(
      Math.pow(currentPoint.x - lastPoint.x, 2) + 
      Math.pow(currentPoint.y - lastPoint.y, 2)
    );
    
    if (distance >= tolerance) {
      simplified.push(currentPoint);
    }
  }
  
  return simplified;
}