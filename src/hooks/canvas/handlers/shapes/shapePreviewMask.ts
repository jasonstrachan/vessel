export const applyPolygonMaskToCanvasContext = (
  targetCtx: CanvasRenderingContext2D,
  vertices: Array<{ x: number; y: number }>
): void => {
  if (vertices.length < 3) {
    return;
  }

  targetCtx.save();
  targetCtx.globalCompositeOperation = 'destination-in';
  targetCtx.beginPath();
  targetCtx.moveTo(vertices[0].x, vertices[0].y);
  for (let i = 1; i < vertices.length; i += 1) {
    targetCtx.lineTo(vertices[i].x, vertices[i].y);
  }
  targetCtx.closePath();
  targetCtx.fillStyle = '#ffffff';
  targetCtx.fill();
  targetCtx.restore();
};
