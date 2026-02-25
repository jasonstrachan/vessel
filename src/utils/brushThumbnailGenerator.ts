import { BrushPreset, BrushShape } from '../types';

export interface ThumbnailOptions {
  size?: number;
  backgroundColor?: string;
  brushColor?: string;
  strokeCount?: number;
}

const DEFAULT_OPTIONS: Required<ThumbnailOptions> = {
  size: 40,
  backgroundColor: 'transparent',
  brushColor: '#ffffff',
  strokeCount: 1
};

export function generateBrushThumbnail(
  preset: BrushPreset,
  options: ThumbnailOptions = {}
): string {
  if (typeof document === 'undefined') {
    return '';
  }

  const opts = { ...DEFAULT_OPTIONS, ...options };

  const canvas = document.createElement('canvas');
  canvas.width = opts.size;
  canvas.height = opts.size;
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
  }

  if (opts.backgroundColor !== 'transparent') {
    ctx.fillStyle = opts.backgroundColor;
    ctx.fillRect(0, 0, opts.size, opts.size);
  }

  ctx.fillStyle = opts.brushColor;
  ctx.strokeStyle = opts.brushColor;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const baseStrokeWidth = 2.5;
  ctx.lineWidth = baseStrokeWidth;

  const shapeComponent = preset.components.find((component) => component.type === 'shape');
  const brushShape = (shapeComponent?.parameters?.shape as BrushShape) ?? BrushShape.ROUND;

  const aaComponent = preset.components.find((component) => component.type === 'antialiasing');
  const isAntialiased = aaComponent?.parameters?.mode !== 'pixel';

  if (!isAntialiased) {
    ctx.imageSmoothingEnabled = false;
  }

  switch (brushShape) {
    case BrushShape.SQUARE:
      generateSquareThumbnail(ctx, opts, isAntialiased, baseStrokeWidth);
      break;
    case BrushShape.PIXEL_DITHER:
    case BrushShape.PIXEL_ROUND:
      generatePixelRoundThumbnail(ctx, opts, baseStrokeWidth);
      break;
    case BrushShape.TRIANGLE:
    case BrushShape.COLOR_CYCLE_TRIANGLE:
      generateTriangleThumbnail(ctx, opts, isAntialiased, baseStrokeWidth);
      break;
    case BrushShape.RECTANGLE_GRADIENT:
      generateRectangleGradientThumbnail(ctx, opts, baseStrokeWidth);
      break;
    case BrushShape.POLYGON_GRADIENT:
    case BrushShape.DITHER_GRADIENT:
    case BrushShape.SHAPE_FILL:
      generatePolygonGradientThumbnail(ctx, opts, baseStrokeWidth);
      break;
    case BrushShape.RESAMPLER:
      generateResamplerThumbnail(ctx, opts, baseStrokeWidth);
      break;
    case BrushShape.COLOR_CYCLE:
    case BrushShape.COLOR_CYCLE_SHAPE:
      generateColorCycleThumbnail(ctx, opts, baseStrokeWidth);
      break;
    case BrushShape.SPAM_TEXT:
      generateSpamTextThumbnail(ctx, opts, baseStrokeWidth);
      break;
    case BrushShape.MOSAIC:
      generateMosaicThumbnail(ctx, opts, baseStrokeWidth);
      break;
    case BrushShape.ROUND:
    default:
      generateRoundThumbnail(ctx, opts, baseStrokeWidth);
      break;
  }

  try {
    return canvas.toDataURL();
  } catch (error) {
    console.warn('Failed to generate brush thumbnail:', error);
    return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
  }
}

function generateRoundThumbnail(
  ctx: CanvasRenderingContext2D,
  opts: Required<ThumbnailOptions>,
  strokeWidth: number
) {
  const center = opts.size / 2;
  const radius = Math.max(strokeWidth, opts.size * 0.26);

  ctx.globalAlpha = 1;
  ctx.lineWidth = strokeWidth;
  ctx.beginPath();
  ctx.arc(center, center, radius, 0, Math.PI * 2);
  ctx.stroke();
}

function generateSquareThumbnail(
  ctx: CanvasRenderingContext2D,
  opts: Required<ThumbnailOptions>,
  isAntialiased: boolean,
  strokeWidth: number
) {
  const center = opts.size / 2;
  const size = opts.size * 0.5;

  ctx.globalAlpha = 1;

  if (isAntialiased) {
    const inset = strokeWidth / 2;
    ctx.lineWidth = strokeWidth;
    ctx.strokeRect(center - size / 2 + inset, center - size / 2 + inset, size - strokeWidth, size - strokeWidth);
  } else {
    const pixelStroke = Math.max(1, Math.round(strokeWidth));
    ctx.lineWidth = pixelStroke;
    const inset = ctx.lineWidth / 2;
    const startX = Math.round(center - size / 2 + inset);
    const startY = Math.round(center - size / 2 + inset);
    const dimension = Math.max(1, Math.round(size - ctx.lineWidth));
    ctx.strokeRect(startX, startY, dimension, dimension);
    ctx.lineWidth = strokeWidth;
  }
}

function generatePixelRoundThumbnail(
  ctx: CanvasRenderingContext2D,
  opts: Required<ThumbnailOptions>,
  strokeWidth: number
) {
  const center = opts.size / 2;
  const radius = Math.max(1.5, opts.size * 0.26);

  ctx.imageSmoothingEnabled = true;
  ctx.globalAlpha = 1;
  ctx.lineWidth = strokeWidth;
  ctx.beginPath();
  ctx.arc(center, center, radius, 0, Math.PI * 2);
  ctx.stroke();
}

function generateTriangleThumbnail(
  ctx: CanvasRenderingContext2D,
  opts: Required<ThumbnailOptions>,
  isAntialiased: boolean,
  strokeWidth: number
) {
  const center = opts.size / 2;
  const size = opts.size * 0.5;
  const height = size * 0.866;
  const adjust = (value: number): number => (isAntialiased ? value : Math.round(value));

  ctx.globalAlpha = 1;
  ctx.lineWidth = strokeWidth;
  ctx.beginPath();
  ctx.moveTo(adjust(center), adjust(center - height / 2));
  ctx.lineTo(adjust(center - size / 2), adjust(center + height / 2));
  ctx.lineTo(adjust(center + size / 2), adjust(center + height / 2));
  ctx.closePath();
  ctx.stroke();
}

function generateRectangleGradientThumbnail(
  ctx: CanvasRenderingContext2D,
  opts: Required<ThumbnailOptions>,
  strokeWidth: number
) {
  const center = opts.size / 2;
  const width = opts.size * 0.6;
  const height = opts.size * 0.35;
  const x = center - width / 2 + strokeWidth / 2;
  const y = center - height / 2 + strokeWidth / 2;

  ctx.globalAlpha = 1;
  ctx.lineWidth = strokeWidth;

  const gradient = ctx.createLinearGradient(x, y, x + width, y + height);
  gradient.addColorStop(0, opts.brushColor);
  gradient.addColorStop(1, '#ffffff');

  ctx.strokeStyle = gradient;
  ctx.strokeRect(x, y, width - strokeWidth, height - strokeWidth);
  ctx.strokeStyle = opts.brushColor;
}

function generateMosaicThumbnail(
  ctx: CanvasRenderingContext2D,
  opts: Required<ThumbnailOptions>,
  strokeWidth: number
) {
  const tilePx = Math.max(6, Math.round(opts.size / 4));
  const gap = 0;
  const totalSize = tilePx * 2 + gap;
  const startX = Math.round((opts.size - totalSize) / 2);
  const startY = Math.round((opts.size - totalSize) / 2);

  ctx.imageSmoothingEnabled = false;
  ctx.strokeStyle = opts.brushColor;
  ctx.lineWidth = strokeWidth;

  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 2; col++) {
      const x = startX + col * (tilePx + gap);
      const y = startY + row * (tilePx + gap);
      ctx.strokeRect(x, y, tilePx, tilePx);
    }
  }
}

function generateResamplerThumbnail(
  ctx: CanvasRenderingContext2D,
  opts: Required<ThumbnailOptions>,
  strokeWidth: number
) {
  const center = opts.size / 2;
  const size = opts.size * 0.45;
  const x = center - size / 2 + strokeWidth / 2;
  const y = center - size / 2 + strokeWidth / 2;

  ctx.globalAlpha = 1;
  ctx.lineWidth = strokeWidth;
  ctx.strokeRect(x, y, size - strokeWidth, size - strokeWidth);
}

function generatePolygonGradientThumbnail(
  ctx: CanvasRenderingContext2D,
  opts: Required<ThumbnailOptions>,
  strokeWidth: number
) {
  const center = opts.size / 2;
  const radius = opts.size * 0.28;
  const sides = 6;

  ctx.globalAlpha = 1;
  ctx.lineWidth = strokeWidth;

  const gradient = ctx.createLinearGradient(center - radius, center - radius, center + radius, center + radius);
  gradient.addColorStop(0, opts.brushColor);
  gradient.addColorStop(1, '#ffffff');
  ctx.strokeStyle = gradient;

  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const angle = (i * 2 * Math.PI) / sides;
    const x = center + (radius - strokeWidth / 2) * Math.cos(angle);
    const y = center + (radius - strokeWidth / 2) * Math.sin(angle);

    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.closePath();
  ctx.stroke();
  ctx.strokeStyle = opts.brushColor;
}

function generateColorCycleThumbnail(
  ctx: CanvasRenderingContext2D,
  opts: Required<ThumbnailOptions>,
  strokeWidth: number
) {
  const center = opts.size / 2;
  const size = opts.size * 0.45;
  const x = center - size / 2 + strokeWidth / 2;
  const y = center - size / 2 + strokeWidth / 2;

  ctx.globalAlpha = 1;
  ctx.lineWidth = strokeWidth;

  const pad = size * 0.2;
  const gradient = ctx.createLinearGradient(x - pad, y - pad, x + size + pad, y + size + pad);
  gradient.addColorStop(0.0, '#ff4d5e');
  gradient.addColorStop(0.17, '#ff9933');
  gradient.addColorStop(0.33, '#ffcc33');
  gradient.addColorStop(0.5, '#4fd6b8');
  gradient.addColorStop(0.67, '#4da6ff');
  gradient.addColorStop(0.83, '#8090ff');
  gradient.addColorStop(1.0, '#b56dff');

  ctx.strokeStyle = gradient;
  ctx.strokeRect(x, y, size - strokeWidth, size - strokeWidth);
  ctx.strokeStyle = opts.brushColor;
}

function generateSpamTextThumbnail(
  ctx: CanvasRenderingContext2D,
  opts: Required<ThumbnailOptions>,
  strokeWidth: number
) {
  const center = opts.size / 2;

  ctx.globalAlpha = 1;
  ctx.lineWidth = strokeWidth;
  const fontSize = Math.round(opts.size * 0.6);
  ctx.font = `600 ${fontSize}px "IBM Plex Mono", "Courier New", monospace`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const offsetX = center - fontSize * 0.4;
  ctx.fillText('a', offsetX, center);
}
