import type { BrushSettings } from '@/types';

import type { Point } from './types';

export type DrawCrossHatchPolygonParams = {
  ctx: CanvasRenderingContext2D;
  polygonData: {
    vertices: Point[];
    fillColor?: string;
    spacingOverride?: number;
    rotationOverride?: number;
    lineWidthOverride?: number;
  };
  brushSettings: BrushSettings;
  isPreview?: boolean;
};

type Bounds = {
  minx: number;
  maxx: number;
  miny: number;
  maxy: number;
};

type HatchLine = {
  base: number;
  tilt: number;
  bow: number;
  waveAmp: number;
  waveFreq: number;
  wavePhase: number;
  waveAmp2: number;
  waveFreq2: number;
  wavePhase2: number;
  weight: number;
  constant: number;
};

type HatchLineSet = {
  angle: number;
  cos: number;
  sin: number;
  lines: HatchLine[];
};

type HatchContext = {
  startY: number;
  endY: number;
  rangeY: number;
  segmentStep: number;
  cx: number;
  cy: number;
};

const DEFAULT_LINE_WIDTH = 1.25;
const DEFAULT_ORGANIC = 0.75;
const DEFAULT_HIGHLIGHT_SCALE = 1.05;

export const drawCrossHatchPolygon = ({
  ctx,
  polygonData,
  brushSettings,
  isPreview = false,
}: DrawCrossHatchPolygonParams): void => {
  const vertices = (polygonData?.vertices ?? []).filter(
    (vertex): vertex is Point => Boolean(vertex) && typeof vertex.x === 'number' && typeof vertex.y === 'number'
  );

  if (vertices.length < 3) {
    return;
  }

  void isPreview;

  ctx.save();
  ctx.globalAlpha = brushSettings.opacity;
  ctx.globalCompositeOperation = brushSettings.blendMode || 'source-over';

  tracePolygonPath(ctx, vertices);
  ctx.clip('nonzero');

  const angle = (((polygonData?.rotationOverride ?? brushSettings.crossHatchRotation) ?? 45) * Math.PI) / 180;
  const spacing = Math.max(2, polygonData?.spacingOverride ?? brushSettings.crossHatchSpacing ?? 10);
  const lineWidth = Math.max(
    0.2,
    polygonData?.lineWidthOverride ?? brushSettings.crossHatchLineWidth ?? DEFAULT_LINE_WIDTH
  );
  const cross = true;
  const highlightScale = DEFAULT_HIGHLIGHT_SCALE;
  const organic = clamp01(DEFAULT_ORGANIC);
  const color = polygonData?.fillColor ?? brushSettings.color ?? '#000000';

  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const bounds = computeBounds(vertices);
  const canvas = ctx.canvas;
  const pad = Math.hypot(canvas.width, canvas.height);
  const cx = (bounds.minx + bounds.maxx) / 2;
  const cy = (bounds.miny + bounds.maxy) / 2;

  const context: HatchContext = {
    startY: bounds.miny - pad,
    endY: bounds.maxy + pad,
    rangeY: Math.max(1, bounds.maxy - bounds.miny + pad * 2),
    segmentStep: Math.max(6, spacing * 0.35),
    cx,
    cy,
  };

  const baseSeed = hashPoints(vertices);
  const mainSet = buildLineSet({
    angle,
    spacing,
    bounds,
    pad,
    rng: createRng(baseSeed ^ 0x9e3779b9 ^ (Math.floor(angle * 1000) >>> 0)),
    context,
    organic,
  });

  drawLineSet(ctx, mainSet, context, lineWidth);

  if (cross) {
    const crossAngle = angle + Math.PI / 2;
    const crossSet = buildLineSet({
      angle: crossAngle,
      spacing,
      bounds,
      pad,
      rng: createRng(baseSeed ^ 0x51633e2d ^ (Math.floor(crossAngle * 873) >>> 0)),
      context,
      organic,
    });

    drawLineSet(ctx, crossSet, context, lineWidth);
    drawCrossHighlights(ctx, mainSet, crossSet, {
      color,
      lineWidth,
      polygon: vertices,
      bounds,
      context,
      highlightScale,
    });
  }

  ctx.restore();
};

function buildLineSet({
  angle,
  spacing,
  bounds,
  pad,
  rng,
  context,
  organic,
}: {
  angle: number;
  spacing: number;
  bounds: Bounds;
  pad: number;
  rng: () => number;
  context: HatchContext;
  organic: number;
}): HatchLineSet {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const lines: HatchLine[] = [];
  const min = bounds.minx - pad - spacing * 3;
  const max = bounds.maxx + pad + spacing * 3;
  const wobble = clamp01(organic);
  let pos = min + (rng() - 0.5) * spacing * wobble;
  const guardLimit = 2000;
  let guard = 0;

  while (pos <= max && guard < guardLimit) {
    const base = pos + (rng() - 0.5) * spacing * 0.75 * wobble;
    const line: HatchLine = {
      base,
      tilt: (rng() - 0.5) * spacing * 0.45 * wobble,
      bow: (rng() - 0.5) * spacing * 0.35 * wobble,
      waveAmp: spacing * (0.14 + rng() * 0.22) * wobble,
      waveFreq: (0.7 + rng() * 1.1) / Math.max(160, spacing * 10),
      wavePhase: rng() * Math.PI * 2,
      waveAmp2: spacing * 0.09 * (0.5 + rng() * 0.7) * wobble,
      waveFreq2: (1.4 + rng() * 1.6) / Math.max(220, spacing * 12),
      wavePhase2: rng() * Math.PI * 2,
      weight: 1 + (rng() - 0.5) * 0.22 * (0.35 + wobble * 0.65),
      constant: 0,
    };
    line.constant = computeLineConstant(line.base, cos, sin, context.cx, context.cy);
    lines.push(line);

    const spacingFactor = 1 + (rng() - 0.5) * 0.6 * wobble;
    pos += spacing * Math.max(0.35, spacingFactor);
    guard++;
  }

  if (lines.length === 0) {
    const fallback: HatchLine = {
      base: (bounds.minx + bounds.maxx) / 2,
      tilt: 0,
      bow: 0,
      waveAmp: 0,
      waveFreq: 1,
      wavePhase: 0,
      waveAmp2: 0,
      waveFreq2: 1,
      wavePhase2: 0,
      weight: 1,
      constant: 0,
    };
    fallback.constant = computeLineConstant(fallback.base, cos, sin, context.cx, context.cy);
    lines.push(fallback);
  }

  return { angle, cos, sin, lines };
}

function drawLineSet(ctx: CanvasRenderingContext2D, set: HatchLineSet, context: HatchContext, baseLineWidth: number): void {
  ctx.save();
  ctx.translate(context.cx, context.cy);
  ctx.rotate(set.angle);
  ctx.translate(-context.cx, -context.cy);

  const startY = context.startY;
  const endY = context.endY;
  const step = context.segmentStep;

  for (const line of set.lines) {
    ctx.lineWidth = Math.max(0.2, baseLineWidth * line.weight);
    ctx.beginPath();
    let first = true;
    let y = startY;
    while (y <= endY) {
      const x = evalLineLocalX(line, y, context);
      if (first) {
        ctx.moveTo(x, y);
        first = false;
      } else {
        ctx.lineTo(x, y);
      }
      y += step;
    }
    if (y - step < endY) {
      const xEnd = evalLineLocalX(line, endY, context);
      ctx.lineTo(xEnd, endY);
    }
    ctx.stroke();
  }

  ctx.restore();
}

function drawCrossHighlights(
  ctx: CanvasRenderingContext2D,
  setA: HatchLineSet,
  setB: HatchLineSet,
  options: {
    color: string;
    lineWidth: number;
    polygon: Point[];
    bounds: Bounds;
    context: HatchContext;
    highlightScale?: number;
  }
): void {
  const intersections = computeIntersections(setA, setB, options);
  if (!intersections.length) return;

  ctx.save();
  ctx.fillStyle = options.color;
  ctx.globalAlpha = 1;
  const scale = options.highlightScale && Number.isFinite(options.highlightScale)
    ? Math.max(0, options.highlightScale)
    : DEFAULT_HIGHLIGHT_SCALE;
  for (const inter of intersections) {
    const baseWidth = Math.max(inter.widthA, inter.widthB);
    const radius = Math.max(0.1, baseWidth * scale);
    ctx.beginPath();
    ctx.arc(inter.x, inter.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function computeIntersections(
  setA: HatchLineSet,
  setB: HatchLineSet,
  options: {
    lineWidth: number;
    polygon: Point[];
    bounds: Bounds;
    context: HatchContext;
  }
): Array<{ x: number; y: number; widthA: number; widthB: number }> {
  const results: Array<{ x: number; y: number; widthA: number; widthB: number }> = [];
  const bounds = options.bounds;
  const margin = Math.max(6, (options.lineWidth || 1) * 4);
  for (const lineA of setA.lines) {
    for (const lineB of setB.lines) {
      const det = setA.cos * setB.sin - setA.sin * setB.cos;
      if (Math.abs(det) < 1e-6) continue;
      const px = (lineA.constant * setB.sin - setA.sin * lineB.constant) / det;
      const py = (-lineA.constant * setB.cos + setA.cos * lineB.constant) / det;
      if (
        px < bounds.minx - margin ||
        px > bounds.maxx + margin ||
        py < bounds.miny - margin ||
        py > bounds.maxy + margin
      ) {
        continue;
      }
      if (!pointInPoly(px, py, options.polygon)) continue;

      const localA = toLocal(px, py, setA.angle, options.context.cx, options.context.cy);
      const localB = toLocal(px, py, setB.angle, options.context.cx, options.context.cy);
      const adjAx = evalLineLocalX(lineA, localA.y, options.context);
      const adjBx = evalLineLocalX(lineB, localB.y, options.context);
      const worldA = toWorld(adjAx, localA.y, setA.angle, options.context.cx, options.context.cy);
      const worldB = toWorld(adjBx, localB.y, setB.angle, options.context.cx, options.context.cy);
      const ix = (worldA.x + worldB.x) * 0.5;
      const iy = (worldA.y + worldB.y) * 0.5;
      results.push({
        x: ix,
        y: iy,
        widthA: Math.max(0.2, options.lineWidth * lineA.weight),
        widthB: Math.max(0.2, options.lineWidth * lineB.weight),
      });
    }
  }
  return results;
}

function evalLineLocalX(line: HatchLine, y: number, context: HatchContext): number {
  const t = (y - context.startY) / context.rangeY;
  const centered = t - 0.5;
  const lean = line.tilt * centered * 1.2;
  const bow = line.bow * (centered * centered - 0.25) * 2.4;
  const wave1 = Math.sin(y * line.waveFreq + line.wavePhase) * line.waveAmp;
  const wave2 = Math.sin(y * line.waveFreq2 + line.wavePhase2) * line.waveAmp2;
  return line.base + lean + bow + wave1 + wave2;
}

function computeLineConstant(base: number, cos: number, sin: number, cx: number, cy: number): number {
  return (base - cx) + cos * cx + sin * cy;
}

function toLocal(x: number, y: number, angle: number, cx: number, cy: number): { x: number; y: number } {
  const dx = x - cx;
  const dy = y - cy;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: cos * dx + sin * dy + cx,
    y: -sin * dx + cos * dy + cy,
  };
}

function toWorld(x: number, y: number, angle: number, cx: number, cy: number): { x: number; y: number } {
  const dx = x - cx;
  const dy = y - cy;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: cos * dx - sin * dy + cx,
    y: sin * dx + cos * dy + cy,
  };
}

function hashPoints(points: Point[]): number {
  let hash = 2166136261;
  for (const pt of points) {
    hash ^= Math.round(pt.x * 16);
    hash = Math.imul(hash, 16777619);
    hash ^= Math.round(pt.y * 16);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createRng(seed: number): () => number {
  let state = seed >>> 0;
  if (state === 0) state = 0x6d2b79f5;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp01(value: number): number {
  if (Number.isNaN(value) || value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function computeBounds(points: Point[]): Bounds {
  let minx = points[0].x;
  let maxx = points[0].x;
  let miny = points[0].y;
  let maxy = points[0].y;

  for (const pt of points) {
    if (pt.x < minx) minx = pt.x;
    if (pt.x > maxx) maxx = pt.x;
    if (pt.y < miny) miny = pt.y;
    if (pt.y > maxy) maxy = pt.y;
  }

  return { minx, maxx, miny, maxy };
}

function pointInPoly(x: number, y: number, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-6) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function tracePolygonPath(ctx: CanvasRenderingContext2D, vertices: Point[]): void {
  ctx.beginPath();
  ctx.moveTo(vertices[0].x, vertices[0].y);
  for (let i = 1; i < vertices.length; i += 1) {
    ctx.lineTo(vertices[i].x, vertices[i].y);
  }
  ctx.closePath();
}
