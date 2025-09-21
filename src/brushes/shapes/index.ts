/**
 * Utility functions for drawing shapes
 * Extracted from useBrushEngine for better organization
 * These remain as fast utility functions, not classes, to avoid performance overhead
 */

import { BrushShape } from '../../types';

/**
 * Draw a pixel-perfect square
 */
export function drawSquareShape(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  antialiasing: boolean = false
): void {
  if (antialiasing) {
    ctx.fillRect(x - size / 2, y - size / 2, size, size);
  } else {
    // Pixel-perfect square
    const halfSize = Math.floor(size / 2);
    const startX = Math.round(x) - halfSize;
    const startY = Math.round(y) - halfSize;
    ctx.fillRect(startX, startY, size, size);
  }
}

/**
 * Draw a round/circular shape
 */
export function drawRoundShape(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number
): void {
  ctx.beginPath();
  ctx.arc(x, y, size / 2, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Draw a triangle shape
 */
export function drawTriangleShape(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number
): void {
  const radius = size / 2;
  ctx.beginPath();
  ctx.moveTo(x, y - radius);
  ctx.lineTo(x - radius * 0.866, y + radius * 0.5);
  ctx.lineTo(x + radius * 0.866, y + radius * 0.5);
  ctx.closePath();
  ctx.fill();
}

/**
 * Draw a pixel-perfect line using Bresenham's algorithm
 */
export function drawPixelPerfectLine(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  drawPixel: (x: number, y: number) => void
): void {
  x0 = Math.round(x0);
  y0 = Math.round(y0);
  x1 = Math.round(x1);
  y1 = Math.round(y1);

  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;

  while (true) {
    drawPixel(x0, y0);

    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      y0 += sy;
    }
  }
}

/**
 * Draw an antialiased line using Wu's algorithm
 */
export function drawAntialiasedLine(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: string,
  opacity: number = 1
): void {
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  
  if (dx === 0 && dy === 0) {
    ctx.fillStyle = color;
    ctx.globalAlpha = opacity;
    ctx.fillRect(Math.floor(x0), Math.floor(y0), 1, 1);
    return;
  }

  // Simple antialiased line using stroke
  ctx.strokeStyle = color;
  ctx.globalAlpha = opacity;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

/**
 * Shape drawing function map for default brushes
 */
export const SHAPE_DRAW_FUNCTIONS: Partial<Record<BrushShape, typeof drawSquareShape>> = {
  [BrushShape.SQUARE]: drawSquareShape,
  [BrushShape.ROUND]: drawRoundShape,
  [BrushShape.PIXEL_ROUND]: drawRoundShape,
  [BrushShape.TRIANGLE]: drawTriangleShape,
};

/**
 * Get the appropriate shape drawing function
 */
export function getShapeDrawFunction(shape: BrushShape): typeof drawSquareShape | null {
  return SHAPE_DRAW_FUNCTIONS[shape] || null;
}