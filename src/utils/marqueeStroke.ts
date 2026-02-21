const MARQUEE_LIGHT_COLOR = '#ffffff';
const MARQUEE_DARK_COLOR = '#000000';
const MARQUEE_LINE_WIDTH = 1;
const MARQUEE_DASH_LENGTH = 5;

export interface MarqueeStrokeOptions {
  scale: number;
  marchingAntsOffset?: number;
  animated?: boolean;
  lineWidthMultiplier?: number;
}

const getSafeScale = (scale: number): number => Math.max(0.001, scale);

const applyLightStroke = (
  ctx: CanvasRenderingContext2D,
  options: MarqueeStrokeOptions
): void => {
  const safeScale = getSafeScale(options.scale);
  const lineWidthMultiplier = options.lineWidthMultiplier ?? 1;
  ctx.strokeStyle = MARQUEE_LIGHT_COLOR;
  ctx.lineWidth = (MARQUEE_LINE_WIDTH * lineWidthMultiplier) / safeScale;
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;
};

const applyDarkStroke = (
  ctx: CanvasRenderingContext2D,
  options: MarqueeStrokeOptions
): void => {
  const safeScale = getSafeScale(options.scale);
  const lineWidthMultiplier = options.lineWidthMultiplier ?? 1;
  const dashLength = MARQUEE_DASH_LENGTH / safeScale;
  ctx.strokeStyle = MARQUEE_DARK_COLOR;
  ctx.lineWidth = (MARQUEE_LINE_WIDTH * lineWidthMultiplier) / safeScale;
  ctx.setLineDash([dashLength, dashLength]);
  if (options.animated === false) {
    ctx.lineDashOffset = 0;
    return;
  }
  const offset = options.marchingAntsOffset ?? 0;
  ctx.lineDashOffset = -offset / safeScale;
};

export const strokeCurrentMarqueePath = (
  ctx: CanvasRenderingContext2D,
  options: MarqueeStrokeOptions
): void => {
  applyLightStroke(ctx, options);
  ctx.stroke();
  applyDarkStroke(ctx, options);
  ctx.stroke();
  ctx.setLineDash([]);
};

export const strokeMarqueePath = (
  ctx: CanvasRenderingContext2D,
  path: Path2D,
  options: MarqueeStrokeOptions
): void => {
  applyLightStroke(ctx, options);
  ctx.stroke(path);
  applyDarkStroke(ctx, options);
  ctx.stroke(path);
  ctx.setLineDash([]);
};

export const strokeMarqueeRect = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  options: MarqueeStrokeOptions
): void => {
  applyLightStroke(ctx, options);
  ctx.strokeRect(x, y, width, height);
  applyDarkStroke(ctx, options);
  ctx.strokeRect(x, y, width, height);
  ctx.setLineDash([]);
};
