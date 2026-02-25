import type { AppState } from '@/stores/useAppStore';

type Point = { x: number; y: number };

export const drawEraserSegment = (
  state: AppState,
  ctx: CanvasRenderingContext2D,
  p1: Point,
  p2: Point
): void => {
  const eraserSize = state.tools.eraserSettings.size ?? state.tools.brushSettings.size ?? 20;
  const opacity = state.tools.eraserSettings.opacity || 1;

  // Use the configured eraser size directly; doubling was making the stroke appear oversized.
  ctx.lineWidth = eraserSize;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // The "color" of the eraser determines its strength. Black with opacity.
  ctx.strokeStyle = `rgba(0, 0, 0, ${opacity})`;

  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.stroke();
};
