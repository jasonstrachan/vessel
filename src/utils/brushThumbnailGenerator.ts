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
  // Check if we're in a browser environment
  if (typeof document === 'undefined') {
    return '';
  }
  
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
  const canvas = document.createElement('canvas');
  canvas.width = opts.size;
  canvas.height = opts.size;
  const ctx = canvas.getContext('2d');
  
  if (!ctx) {
    // Return a simple fallback thumbnail as data URL
    return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
  }

  // Set background
  if (opts.backgroundColor !== 'transparent') {
    ctx.fillStyle = opts.backgroundColor;
    ctx.fillRect(0, 0, opts.size, opts.size);
  }

  // Set brush properties
  ctx.fillStyle = opts.brushColor;
  ctx.strokeStyle = opts.brushColor;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Determine brush shape from preset
  const shapeComponent = preset.components.find(c => c.type === 'shape');
  const brushShape = shapeComponent?.parameters?.shape as BrushShape || BrushShape.ROUND;
  
  // Determine if antialiased
  const aaComponent = preset.components.find(c => c.type === 'antialiasing');
  const isAntialiased = aaComponent?.parameters?.mode !== 'pixel';

  // Set antialiasing
  if (!isAntialiased) {
    ctx.imageSmoothingEnabled = false;
  }

  // Generate thumbnail based on brush type
  switch (brushShape) {
    case BrushShape.SQUARE:
      generateSquareThumbnail(ctx, opts, isAntialiased);
      break;
    case BrushShape.PIXEL_ROUND:
      generatePixelRoundThumbnail(ctx, opts);
      break;
    case BrushShape.TRIANGLE:
      generateTriangleThumbnail(ctx, opts, isAntialiased);
      break;
    case BrushShape.RECTANGLE_GRADIENT:
      generateRectangleGradientThumbnail(ctx, opts);
      break;
    case BrushShape.POLYGON_GRADIENT:
      generatePolygonGradientThumbnail(ctx, opts);
      break;
    case BrushShape.RESAMPLER:
      generateResamplerThumbnail(ctx, opts);
      break;
    case BrushShape.COLOR_CYCLE:
      generateColorCycleThumbnail(ctx, opts);
      break;
    case BrushShape.ROUND:
    default:
      generateRoundThumbnail(ctx, opts, isAntialiased);
      break;
  }

  try {
    return canvas.toDataURL();
  } catch (error) {
    console.warn('Failed to generate brush thumbnail:', error);
    // Return a simple fallback thumbnail as data URL
    return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
  }
}

function generateRoundThumbnail(
  ctx: CanvasRenderingContext2D, 
  opts: Required<ThumbnailOptions>,
  isAntialiased: boolean
) {
  const center = opts.size / 2;
  const radius = opts.size * 0.35;
  
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(center, center, radius, 0, Math.PI * 2);
  ctx.fill();
}

function generateSquareThumbnail(
  ctx: CanvasRenderingContext2D, 
  opts: Required<ThumbnailOptions>,
  isAntialiased: boolean
) {
  const center = opts.size / 2;
  const size = opts.size * 0.7;
  const x = center - size / 2;
  const y = center - size / 2;
  
  ctx.globalAlpha = 1;
  
  if (isAntialiased) {
    ctx.fillRect(x, y, size, size);
  } else {
    // For pixel brushes, draw crisp squares
    ctx.fillRect(Math.floor(x), Math.floor(y), Math.ceil(size), Math.ceil(size));
  }
}

function generatePixelRoundThumbnail(
  ctx: CanvasRenderingContext2D, 
  opts: Required<ThumbnailOptions>
) {
  const center = opts.size / 2;
  const radius = Math.floor(opts.size * 0.3);
  
  ctx.imageSmoothingEnabled = false;
  ctx.globalAlpha = 1;
  
  // Draw a pixelated circle by filling pixels in a circular pattern
  for (let x = -radius; x <= radius; x++) {
    for (let y = -radius; y <= radius; y++) {
      if (x * x + y * y <= radius * radius) {
        ctx.fillRect(
          Math.floor(center + x), 
          Math.floor(center + y), 
          1, 
          1
        );
      }
    }
  }
}

function generateTriangleThumbnail(
  ctx: CanvasRenderingContext2D, 
  opts: Required<ThumbnailOptions>,
  isAntialiased: boolean
) {
  const center = opts.size / 2;
  const size = opts.size * 0.6;
  const height = size * 0.866; // Equilateral triangle height
  
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.moveTo(center, center - height / 2);
  ctx.lineTo(center - size / 2, center + height / 2);
  ctx.lineTo(center + size / 2, center + height / 2);
  ctx.closePath();
  ctx.fill();
}

function generateRectangleGradientThumbnail(
  ctx: CanvasRenderingContext2D, 
  opts: Required<ThumbnailOptions>
) {
  const center = opts.size / 2;
  const width = opts.size * 0.7;
  const height = opts.size * 0.4;
  const x = center - width / 2;
  const y = center - height / 2;
  
  ctx.globalAlpha = 1;
  ctx.fillStyle = opts.brushColor;
  ctx.fillRect(x, y, width, height);
}

function generateResamplerThumbnail(
  ctx: CanvasRenderingContext2D, 
  opts: Required<ThumbnailOptions>
) {
  // Draw a square icon for the resampler brush
  const center = opts.size / 2;
  const size = opts.size * 0.65;
  const x = center - size / 2;
  const y = center - size / 2;
  
  ctx.globalAlpha = 1;
  ctx.fillStyle = opts.brushColor;
  ctx.fillRect(x, y, size, size);
}

function generatePolygonGradientThumbnail(
  ctx: CanvasRenderingContext2D, 
  opts: Required<ThumbnailOptions>
) {
  const center = opts.size / 2;
  const radius = opts.size * 0.35;
  const sides = 6;
  
  ctx.globalAlpha = 1;
  ctx.fillStyle = opts.brushColor;
  
  // Draw solid hexagon
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const angle = (i * 2 * Math.PI) / sides;
    const x = center + radius * Math.cos(angle);
    const y = center + radius * Math.sin(angle);
    
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.closePath();
  ctx.fill();
}

function generateColorCycleThumbnail(
  ctx: CanvasRenderingContext2D, 
  opts: Required<ThumbnailOptions>
) {
  // Color cycle brush uses square shape
  const center = opts.size / 2;
  const size = opts.size * 0.7;
  const x = center - size / 2;
  const y = center - size / 2;
  
  ctx.globalAlpha = 1;
  ctx.fillStyle = opts.brushColor;
  ctx.fillRect(x, y, size, size);
}