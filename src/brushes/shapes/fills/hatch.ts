import type { BrushSettings } from '@/types';

type Point = { x: number; y: number };

export type DrawCrossHatchPolygonParams = {
  ctx: CanvasRenderingContext2D;
  polygonData: { vertices: Point[]; fillColor?: string };
  brushSettings: BrushSettings;
  isPreview?: boolean;
};

const clampLineWidth = (value: number | undefined | null, fallback: number) => {
  if (value == null) {
    return fallback;
  }
  return Math.max(0.5, value);
};

export const drawCrossHatchPolygon = ({
  ctx,
  polygonData,
  brushSettings,
  isPreview = false,
}: DrawCrossHatchPolygonParams): void => {
  const { vertices } = polygonData || {};
  void isPreview;

  if (!vertices || !Array.isArray(vertices) || vertices.length < 3) {
    return;
  }

  const validVertices = vertices.filter(
    (vertex): vertex is Point => Boolean(vertex) && typeof vertex.x === 'number' && typeof vertex.y === 'number'
  );

  if (validVertices.length < 3) {
    return;
  }

  ctx.save();
  ctx.globalAlpha = brushSettings.opacity;
  ctx.globalCompositeOperation = brushSettings.blendMode || 'source-over';

  const rotation = (brushSettings.crossHatchRotation || 45) * Math.PI / 180;
  const spacing = brushSettings.crossHatchSpacing || 10;
  const defaultCrossHatchWidth = 1.25;
  const lineWidth = clampLineWidth(brushSettings.crossHatchLineWidth, defaultCrossHatchWidth);

  const minX = Math.min(...validVertices.map(v => v.x)) - spacing;
  const maxX = Math.max(...validVertices.map(v => v.x)) + spacing;
  const minY = Math.min(...validVertices.map(v => v.y)) - spacing;
  const maxY = Math.max(...validVertices.map(v => v.y)) + spacing;
  const width = maxX - minX;
  const height = maxY - minY;
  const diagonal = Math.sqrt(width * width + height * height);

  ctx.beginPath();
  ctx.moveTo(validVertices[0].x, validVertices[0].y);
  for (let i = 1; i < validVertices.length; i++) {
    ctx.lineTo(validVertices[i].x, validVertices[i].y);
  }
  ctx.closePath();
  ctx.clip();

  ctx.strokeStyle = '#000000';
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  ctx.miterLimit = 2.5;

  const drawWavyLine = (x1: number, y1: number, x2: number, y2: number) => {
    const segments = 8;
    const amplitude = Math.min(0.9, Math.max(0.35, lineWidth * 0.45));
    ctx.beginPath();
    ctx.moveTo(x1, y1);

    for (let i = 1; i <= segments; i++) {
      const t = i / segments;
      const baseX = x1 + (x2 - x1) * t;
      const baseY = y1 + (y2 - y1) * t;

      const perpAngle = Math.atan2(y2 - y1, x2 - x1) + Math.PI / 2;
      const offset = Math.sin(t * Math.PI * 4) * amplitude * (0.5 + Math.random() * 0.5);
      const wobbleX = baseX + Math.cos(perpAngle) * offset;
      const wobbleY = baseY + Math.sin(perpAngle) * offset;

      if (i === segments) {
        ctx.lineTo(x2, y2);
      } else {
        ctx.lineTo(wobbleX, wobbleY);
      }
    }

    ctx.stroke();
  };

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  for (let i = -diagonal; i <= diagonal; i += spacing) {
    const offset = i;

    const startX = centerX + Math.cos(rotation + Math.PI / 2) * offset - Math.cos(rotation) * diagonal;
    const startY = centerY + Math.sin(rotation + Math.PI / 2) * offset - Math.sin(rotation) * diagonal;
    const endX = centerX + Math.cos(rotation + Math.PI / 2) * offset + Math.cos(rotation) * diagonal;
    const endY = centerY + Math.sin(rotation + Math.PI / 2) * offset + Math.sin(rotation) * diagonal;

    drawWavyLine(startX, startY, endX, endY);
  }

  const rotation2 = rotation + Math.PI / 2;

  for (let i = -diagonal; i <= diagonal; i += spacing) {
    const offset = i;
    const jitterRange = Math.min(spacing * 0.12, 0.75);
    const jitter = (Math.random() - 0.5) * 2 * jitterRange;

    const startX = centerX + Math.cos(rotation2 + Math.PI / 2) * (offset + jitter) - Math.cos(rotation2) * diagonal;
    const startY = centerY + Math.sin(rotation2 + Math.PI / 2) * (offset + jitter) - Math.sin(rotation2) * diagonal;
    const endX = centerX + Math.cos(rotation2 + Math.PI / 2) * (offset + jitter) + Math.cos(rotation2) * diagonal;
    const endY = centerY + Math.sin(rotation2 + Math.PI / 2) * (offset + jitter) + Math.sin(rotation2) * diagonal;

    drawWavyLine(startX, startY, endX, endY);
  }

  ctx.restore();
};
