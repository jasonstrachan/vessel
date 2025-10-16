import { ShapePoint, CustomBrush, BrushShape } from '../types';
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
 * Fills a polygon using pixel-perfect scanline algorithm
 * This creates hard pixel edges without antialiasing
 */
function fillPolygonPixelPerfect(
  ctx: CanvasRenderingContext2D,
  points: ShapePoint[],
  color: string
): void {
  if (points.length < 3) return;

  // Find bounding box
  let minX = points[0].x;
  let maxX = points[0].x;
  let minY = points[0].y;
  let maxY = points[0].y;
  
  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  
  // Round to pixel boundaries
  minX = Math.floor(minX);
  maxX = Math.ceil(maxX);
  minY = Math.floor(minY);
  maxY = Math.ceil(maxY);
  
  ctx.fillStyle = color;
  
  // Scanline fill algorithm
  for (let y = minY; y <= maxY; y++) {
    const intersections: number[] = [];
    
    // Find all intersections with horizontal scanline at y
    for (let i = 0; i < points.length; i++) {
      const p1 = points[i];
      const p2 = points[(i + 1) % points.length];
      
      // Check if edge crosses scanline
      if ((p1.y <= y && p2.y > y) || (p2.y <= y && p1.y > y)) {
        // Calculate intersection x coordinate
        const x = p1.x + (y - p1.y) * (p2.x - p1.x) / (p2.y - p1.y);
        intersections.push(x);
      }
    }
    
    // Sort intersections
    intersections.sort((a, b) => a - b);
    
    // Fill pixels between pairs of intersections
    for (let i = 0; i < intersections.length; i += 2) {
      if (i + 1 < intersections.length) {
        const startX = Math.floor(intersections[i]);
        const endX = Math.floor(intersections[i + 1]);
        
        for (let x = startX; x <= endX; x++) {
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }
  }
}

/**
 * Renders a filled shape using the current brush color or custom brush pattern
 * Now supports brush-aware edge rendering for pixel vs soft brushes
 */
export function renderShape(
  ctx: CanvasRenderingContext2D,
  path: Path2D,
  color: string,
  customBrush?: CustomBrush,
  useSwatchColor?: boolean,
  hueShift?: number,
  saturationAdjust?: number,
  brushShape?: BrushShape,
  antiAliasing?: boolean,
  points?: ShapePoint[]
): void {
  ctx.save();

  // Apply brush-specific rendering settings
  const isPixelBrush = brushShape === BrushShape.PIXEL_ROUND;
  const shouldUsePixelPerfect = isPixelBrush || antiAliasing === false;
  
  if (shouldUsePixelPerfect) {
    ctx.imageSmoothingEnabled = false;
  } else {
    ctx.imageSmoothingEnabled = true;
  }

  // For pixel brushes, use pixel-perfect fill if we have the points
  if (shouldUsePixelPerfect && points && points.length >= 3 && !customBrush) {
    // Use pixel-perfect scanline fill for hard edges
    fillPolygonPixelPerfect(ctx, points, color);
  } else if (customBrush && !useSwatchColor) {
    // Fill with tiled custom brush pattern
    const patternCanvas = document.createElement('canvas');
    patternCanvas.width = customBrush.width;
    patternCanvas.height = customBrush.height;
    const patternCtx = patternCanvas.getContext('2d', { colorSpace: 'srgb' });
    
    if (patternCtx) {
      // Apply same rendering mode to pattern canvas
      patternCtx.imageSmoothingEnabled = ctx.imageSmoothingEnabled;
      
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
    // Fill with solid color using standard path fill
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
  saturationAdjust?: number,
  brushShape?: BrushShape,
  antiAliasing?: boolean,
  points?: ShapePoint[]
): void {
  ctx.save();
  ctx.globalAlpha = brushOpacity * 0.7; // Slightly more transparent for preview, but respect brush opacity
  
  renderShape(ctx, path, color, customBrush, useSwatchColor, hueShift, saturationAdjust, brushShape, antiAliasing, points);
  
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

/**
 * Douglas-Peucker algorithm for better path simplification
 * Preserves important vertices while removing redundant ones
 */
export function simplifyPathDouglasPeucker(points: ShapePoint[], epsilon: number = 1.5): ShapePoint[] {
  if (points.length <= 2) {
    return points;
  }

  // Find the point with max distance from line between start and end
  let maxDist = 0;
  let maxIndex = 0;
  const start = points[0];
  const end = points[points.length - 1];
  
  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistance(points[i], start, end);
    if (dist > maxDist) {
      maxDist = dist;
      maxIndex = i;
    }
  }
  
  // If max distance is greater than epsilon, recursively simplify
  if (maxDist > epsilon) {
    const left = simplifyPathDouglasPeucker(points.slice(0, maxIndex + 1), epsilon);
    const right = simplifyPathDouglasPeucker(points.slice(maxIndex), epsilon);
    
    // Combine results (remove duplicate middle point)
    return [...left.slice(0, -1), ...right];
  } else {
    // Return just the endpoints
    return [start, end];
  }
}

/**
 * Calculate perpendicular distance from point to line
 */
function perpendicularDistance(point: ShapePoint, lineStart: ShapePoint, lineEnd: ShapePoint): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  
  if (dx === 0 && dy === 0) {
    // lineStart and lineEnd are the same point
    return Math.hypot(point.x - lineStart.x, point.y - lineStart.y);
  }
  
  const normalLength = Math.hypot(dx, dy);
  const distance = Math.abs((dy * point.x - dx * point.y + lineEnd.x * lineStart.y - lineEnd.y * lineStart.x) / normalLength);
  
  return distance;
}