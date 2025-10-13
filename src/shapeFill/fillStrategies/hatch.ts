import { FillParams, FillResult, FillStrokeSegment, ShapeDefinition, Vec2 } from '../types';
import { pointInPolygon } from '../utils/geometry';
import { hashPoints, createRng } from '../utils/random';

const DEG_TO_RAD = Math.PI / 180;
const MIN_CONTEXT_PAD = 12;
const MIN_STEP = 2;

type HatchShearSettings = {
  spacing: number;
  lineWidth: number;
  spacingJitter: number;
  offset: number;
  organic: number;
  cutSegments: number;
  verticalAlpha: number;
  horizontalAlpha: number;
};

type HatchContext = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
};

type VerticalProfile = {
  base: number;
  lean: number;
  curve: number;
  wave1Amp: number;
  wave2Amp: number;
  wave3Amp: number;
  wave1Phase: number;
  wave2Phase: number;
  wave3Phase: number;
  weight: number;
};

type HorizontalProfile = {
  baseJitter: number;
  yWave1Amp: number;
  yWave2Amp: number;
  yPhase1: number;
  yPhase2: number;
  xWaveAmp: number;
  xPhase: number;
  weight: number;
};

type Polygon2D = Vec2[];

export function hatchFill(shape: ShapeDefinition, params: FillParams): FillResult {
  if (!shape || shape.points.length < 3) {
    return { lines: [], clipPath: [...(shape?.points ?? [])] };
  }

  const baseSeed = params.seed ?? hashPoints(shape.points);
  const settings = normalizeSettings(params);
  const rotation = 0;

  const strokeSegments: FillStrokeSegment[] = [];

  strokeSegments.push(
    ...generateHatchSegments(shape, settings, rotation, baseSeed, 1)
  );

  if (params.cross) {
    strokeSegments.push(
      ...generateHatchSegments(shape, settings, rotation + 90, baseSeed ^ 0x51633e2d, 0.82)
    );
  }

  return {
    strokeSegments,
    lineWidth: settings.lineWidth,
    clipPath: [...shape.points],
  };
}

function normalizeSettings(params: FillParams): HatchShearSettings {
  const spacing = Math.max(4, params.spacing ?? 18);
  const thickness = Math.max(0.25, params.thickness ?? Math.max(1.25, spacing * 0.12));
  const organic = clamp01(params.organic ?? 0.7);
  const spacingJitter = clamp01(params.variance ?? 0.35);

  return {
    spacing,
    lineWidth: thickness,
    spacingJitter,
    offset: Math.max(thickness * 2.2, spacing * 0.55),
    organic,
    cutSegments: Math.max(1, Math.round(3 + organic * 3)),
    verticalAlpha: clamp01(0.7 + organic * 0.25),
    horizontalAlpha: clamp01(0.48 + organic * 0.35),
  };
}

function generateHatchSegments(
  shape: ShapeDefinition,
  settings: HatchShearSettings,
  rotationDeg: number,
  seed: number,
  alphaScale: number
): FillStrokeSegment[] {
  const centroid = shape.centroid;
  const rad = rotationDeg * DEG_TO_RAD;
  const cosR = Math.cos(rad);
  const sinR = Math.sin(rad);

  const toLocal = (point: Vec2): Vec2 => {
    const dx = point.x - centroid.x;
    const dy = point.y - centroid.y;
    return {
      x: cosR * dx + sinR * dy,
      y: -sinR * dx + cosR * dy,
    };
  };

  const toWorld = (point: Vec2): Vec2 => {
    return {
      x: centroid.x + cosR * point.x - sinR * point.y,
      y: centroid.y + sinR * point.x + cosR * point.y,
    };
  };

  const localPolygon: Polygon2D = shape.points.map(toLocal);
  if (localPolygon.length < 3) {
    return [];
  }

  const bounds = computeLocalBounds(localPolygon);
  const pad = Math.max(settings.spacing * 2, settings.offset * 2, MIN_CONTEXT_PAD);
  const context: HatchContext = {
    minX: bounds.minX - pad,
    minY: bounds.minY - pad,
    maxX: bounds.maxX + pad,
    maxY: bounds.maxY + pad,
    width: 0,
    height: 0,
  };
  context.width = Math.max(1, context.maxX - context.minX);
  context.height = Math.max(1, context.maxY - context.minY);

  const spacingRngX = settings.spacingJitter > 1e-4 ? createRng(seed ^ 0x37a4b4c9) : null;
  const profileRngX = createRng(seed ^ 0x51f15af1);
  const spacingRngY = settings.spacingJitter > 1e-4 ? createRng(seed ^ 0x4b1f2cd3) : null;
  const crossRng = createRng(seed ^ 0x6ac690c5);

  const verticalLines = buildVerticalLines(context, settings, spacingRngX, profileRngX);
  const rows = buildAxisPositions(
    context.minY,
    context.maxY,
    settings.spacing,
    settings.spacingJitter,
    spacingRngY
  );
  const segmentAssignments = assignSegments(verticalLines, settings.cutSegments);

  const segments: FillStrokeSegment[] = [];

  segments.push(
    ...buildVerticalSegments(verticalLines, context, localPolygon, settings, toWorld, alphaScale)
  );
  segments.push(
    ...buildHorizontalSegments(
      verticalLines,
      segmentAssignments,
      rows,
      context,
      localPolygon,
      settings,
      toWorld,
      crossRng,
      alphaScale
    )
  );

  return segments;
}

function buildVerticalSegments(
  lines: VerticalProfile[],
  context: HatchContext,
  polygon: Polygon2D,
  settings: HatchShearSettings,
  toWorld: (point: Vec2) => Vec2,
  alphaScale: number
): FillStrokeSegment[] {
  if (!lines.length) {
    return [];
  }

  const segments: FillStrokeSegment[] = [];
  const samples = Math.max(24, Math.ceil(context.height / Math.max(6, settings.spacing * 0.35)));
  const step = context.height / samples;

  for (const line of lines) {
    const current: Vec2[] = [];
    const lineWidth = Math.max(0.2, settings.lineWidth * line.weight);
    const lineAlpha = clamp01(settings.verticalAlpha * alphaScale);

    for (let i = 0; i <= samples; i += 1) {
      const y = context.minY + step * i;
      const x = sampleVertical(line, y, context);
      const localPoint = { x, y };
      if (pointInPolygon(localPoint, polygon)) {
        current.push(localPoint);
      } else if (current.length > 1) {
        segments.push({
          points: current.map(toWorld),
          lineWidth,
          alpha: lineAlpha,
        });
        current.length = 0;
      } else {
        current.length = 0;
      }
    }

    if (current.length > 1) {
      segments.push({
        points: current.map(toWorld),
        lineWidth,
        alpha: lineAlpha,
      });
    }
  }

  return segments;
}

function buildHorizontalSegments(
  lines: VerticalProfile[],
  segmentAssignments: number[],
  rows: number[],
  context: HatchContext,
  polygon: Polygon2D,
  settings: HatchShearSettings,
  toWorld: (point: Vec2) => Vec2,
  rng: () => number,
  alphaScale: number
): FillStrokeSegment[] {
  if (lines.length < 2 || rows.length === 0) {
    return [];
  }

  const segments: FillStrokeSegment[] = [];

  for (const row of rows) {
    const profile = createHorizontalProfile(rng, settings);
    const baseRow = clampNumber(row + profile.baseJitter, context.minY, context.maxY);
    const weight = Math.max(0.2, settings.lineWidth * profile.weight);
    const alpha = clamp01(settings.horizontalAlpha * alphaScale);

    for (let i = 0; i < lines.length - 1; i += 1) {
      const segmentIndex = segmentAssignments[i];
      if (segmentIndex < 0) {
        continue;
      }

      const offsetActive = segmentIndex % 2 === 1;
      const baseY = clampNumber(baseRow + (offsetActive ? settings.offset : 0), context.minY, context.maxY);

      const startLine = lines[i];
      const endLine = lines[i + 1];
      const startBase = sampleVertical(startLine, baseY, context);
      const endBase = sampleVertical(endLine, baseY, context);
      const span = Math.abs(endBase - startBase);
      if (span < 1e-2) {
        continue;
      }

      const samples = Math.max(4, Math.ceil(span / Math.max(6, settings.spacing * 0.35)));
      const current: Vec2[] = [];

      for (let s = 0; s <= samples; s += 1) {
        const t = s / samples;
        const wave = computeHorizontalWave(profile, t);
        const drawY = clampNumber(baseY + wave, context.minY, context.maxY);
        const startX = sampleVertical(startLine, drawY, context);
        const endX = sampleVertical(endLine, drawY, context);

        let drawX: number;
        if (s === 0) {
          drawX = startX;
        } else if (s === samples) {
          drawX = endX;
        } else {
          const baseX = startX + (endX - startX) * t;
          const jitter = Math.sin(t * Math.PI * 2 + profile.xPhase) * profile.xWaveAmp;
          drawX = baseX + jitter;
        }

        const localPoint = { x: drawX, y: drawY };
        if (pointInPolygon(localPoint, polygon)) {
          current.push(localPoint);
        } else if (current.length > 1) {
          segments.push({
            points: current.map(toWorld),
            lineWidth: weight,
            alpha,
          });
          current.length = 0;
        } else {
          current.length = 0;
        }
      }

      if (current.length > 1) {
        segments.push({
          points: current.map(toWorld),
          lineWidth: weight,
          alpha,
        });
      }
    }
  }

  return segments;
}

function buildVerticalLines(
  context: HatchContext,
  settings: HatchShearSettings,
  spacingRng: (() => number) | null,
  profileRng: () => number
): VerticalProfile[] {
  const basePositions = buildAxisPositions(
    context.minX,
    context.maxX,
    settings.spacing,
    settings.spacingJitter,
    spacingRng
  );

  const lines: VerticalProfile[] = [];
  let prior = -Infinity;

  for (const pos of basePositions) {
    const line = createVerticalProfile(pos, settings, profileRng);
    if (line.base <= prior + 0.15) {
      line.base = prior + 0.15;
    }
    lines.push(line);
    prior = line.base;
  }

  return lines;
}

function buildAxisPositions(
  min: number,
  max: number,
  spacing: number,
  jitter: number,
  rng: (() => number) | null
): number[] {
  const step = Math.max(MIN_STEP, spacing);
  const values: number[] = [];
  let current = min;
  let guard = 0;
  const useJitter = rng && jitter > 1e-4;
  const minStep = Math.max(1.2, step * 0.35);
  const maxStep = step * (1 + jitter * 1.5);

  values.push(current);

  while (current < max && guard < 10000) {
    guard += 1;
    let nextStep = step;
    if (useJitter && rng) {
      const factor = 1 + (rng() - 0.5) * 2 * jitter;
      nextStep = clampNumber(step * factor, minStep, maxStep);
    }
    current += nextStep;
    if (current >= max) {
      break;
    }
    values.push(current);
  }

  if (values[values.length - 1] < max - 1e-3) {
    values.push(max);
  } else {
    values[values.length - 1] = max;
  }

  return values;
}

function assignSegments(lines: VerticalProfile[], requested: number): number[] {
  if (lines.length < 2) {
    return [];
  }
  const groupSize = Math.max(1, Math.round(requested));
  const assignments = new Array(Math.max(0, lines.length - 1)).fill(-1);
  for (let i = 0; i < assignments.length; i += 1) {
    assignments[i] = Math.floor(i / groupSize);
  }
  return assignments;
}

function createVerticalProfile(position: number, settings: HatchShearSettings, rng: () => number): VerticalProfile {
  const organic = clamp01(settings.organic);
  const jitterScale = 0.35 + settings.spacingJitter * 0.9;
  const random = () => rng();
  const next = () => random() - 0.5;

  return {
    base: position + next() * settings.spacing * 0.45 * organic * jitterScale,
    lean: next() * 0.12 * organic,
    curve: next() * 0.06 * organic * jitterScale,
    wave1Amp: next() * settings.spacing * 0.22 * organic * jitterScale,
    wave2Amp: next() * settings.spacing * 0.12 * organic * jitterScale,
    wave3Amp: next() * settings.spacing * 0.08 * organic * jitterScale,
    wave1Phase: random() * Math.PI * 2,
    wave2Phase: random() * Math.PI * 2,
    wave3Phase: random() * Math.PI * 2,
    weight: 1 + next() * 0.28 * organic,
  };
}

function sampleVertical(line: VerticalProfile, y: number, context: HatchContext): number {
  const norm = clamp01((y - context.minY) / context.height);
  const span = y - context.minY;
  const centered = norm - 0.5;
  const curve = line.curve * centered * centered * context.height;
  const wave = Math.sin(Math.PI * norm + line.wave1Phase) * line.wave1Amp
    + Math.sin(Math.PI * 2 * norm + line.wave2Phase) * line.wave2Amp
    + Math.sin(Math.PI * 3 * norm + line.wave3Phase) * line.wave3Amp;
  return line.base + line.lean * span + curve + wave;
}

function createHorizontalProfile(rng: () => number, settings: HatchShearSettings): HorizontalProfile {
  const organic = clamp01(settings.organic);
  const jitterScale = 0.25 + settings.spacingJitter * 0.9;
  const next = () => rng() - 0.5;

  return {
    baseJitter: next() * settings.spacing * 0.25 * organic * jitterScale,
    yWave1Amp: next() * settings.spacing * 0.2 * organic * jitterScale,
    yWave2Amp: next() * settings.spacing * 0.12 * organic * jitterScale,
    yPhase1: rng() * Math.PI * 2,
    yPhase2: rng() * Math.PI * 2,
    xWaveAmp: next() * settings.spacing * 0.16 * organic * jitterScale,
    xPhase: rng() * Math.PI * 2,
    weight: 1 + next() * 0.3 * organic,
  };
}

function computeHorizontalWave(profile: HorizontalProfile, t: number): number {
  return Math.sin(Math.PI * t + profile.yPhase1) * profile.yWave1Amp
    + Math.sin(Math.PI * 2 * t + profile.yPhase2) * profile.yWave2Amp;
}

function computeLocalBounds(points: Polygon2D): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }

  return { minX, minY, maxX, maxY };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
