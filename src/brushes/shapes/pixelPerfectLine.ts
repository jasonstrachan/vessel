export function drawPixelPerfectLine(
  _ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  drawPixel: (x: number, y: number) => void
): void {
  let startX = Math.round(x0);
  let startY = Math.round(y0);
  const endX = Math.round(x1);
  const endY = Math.round(y1);

  const dx = Math.abs(endX - startX);
  const dy = Math.abs(endY - startY);
  const sx = startX < endX ? 1 : -1;
  const sy = startY < endY ? 1 : -1;
  let err = dx - dy;

  while (true) {
    drawPixel(startX, startY);

    if (startX === endX && startY === endY) {
      break;
    }

    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      startX += sx;
    }
    if (e2 < dx) {
      err += dx;
      startY += sy;
    }
  }
}
