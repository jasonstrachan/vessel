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

  ctx.strokeStyle = color;
  ctx.globalAlpha = opacity;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}
