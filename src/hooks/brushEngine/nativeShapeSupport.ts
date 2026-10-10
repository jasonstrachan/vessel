const prepareSupport = (
  rawCtx: CanvasRenderingContext2D,
  supportCtx: CanvasRenderingContext2D,
): void => {
  supportCtx.save();
  supportCtx.setTransform(rawCtx.getTransform());
  supportCtx.fillStyle = rawCtx.fillStyle;
  supportCtx.globalAlpha = rawCtx.globalAlpha;
  supportCtx.globalCompositeOperation = rawCtx.globalCompositeOperation;
  supportCtx.filter = rawCtx.filter;
  supportCtx.imageSmoothingEnabled = rawCtx.imageSmoothingEnabled;
  supportCtx.imageSmoothingQuality = rawCtx.imageSmoothingQuality;
  supportCtx.shadowColor = rawCtx.shadowColor;
  supportCtx.shadowBlur = rawCtx.shadowBlur;
  supportCtx.shadowOffsetX = rawCtx.shadowOffsetX;
  supportCtx.shadowOffsetY = rawCtx.shadowOffsetY;
};

/** Record authored coverage even where cumulative raw alpha is already saturated. */
export const emitNativeSupportRect = (
  rawCtx: CanvasRenderingContext2D,
  supportCtx: CanvasRenderingContext2D | null | undefined,
  x: number,
  y: number,
  width: number,
  height: number,
): void => {
  if (!supportCtx) return;
  prepareSupport(rawCtx, supportCtx);
  supportCtx.fillRect(x, y, width, height);
  supportCtx.restore();
};

export const emitNativeSupportImage = (
  rawCtx: CanvasRenderingContext2D,
  supportCtx: CanvasRenderingContext2D | null | undefined,
  image: CanvasImageSource,
  x: number,
  y: number,
): void => {
  if (!supportCtx) return;
  prepareSupport(rawCtx, supportCtx);
  supportCtx.drawImage(image, x, y);
  supportCtx.restore();
};

export const emitNativeSupportCircle = (
  rawCtx: CanvasRenderingContext2D,
  supportCtx: CanvasRenderingContext2D | null | undefined,
  x: number,
  y: number,
  radius: number,
): void => {
  if (!supportCtx) return;
  prepareSupport(rawCtx, supportCtx);
  supportCtx.beginPath();
  supportCtx.arc(x, y, radius, 0, Math.PI * 2);
  supportCtx.fill();
  supportCtx.restore();
};

export const emitNativeSupportTriangle = (
  rawCtx: CanvasRenderingContext2D,
  supportCtx: CanvasRenderingContext2D | null | undefined,
  x: number,
  y: number,
  halfWidth: number,
  halfHeight: number,
): void => {
  if (!supportCtx) return;
  prepareSupport(rawCtx, supportCtx);
  supportCtx.beginPath();
  supportCtx.moveTo(x, y - halfHeight);
  supportCtx.lineTo(x - halfWidth, y + halfHeight);
  supportCtx.lineTo(x + halfWidth, y + halfHeight);
  supportCtx.closePath();
  supportCtx.fill();
  supportCtx.restore();
};
