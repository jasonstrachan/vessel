import { FillParams, FillResult, ShapeDefinition, Vec2 } from '../types';
import { computeBounds, pointInPolygon } from '../utils/geometry';
import { createRng, hashPoints } from '../utils/random';
import { clamp } from '../utils/math';
import { parseCssColor } from '@/utils/color/parseCssColor';

const MAX_CELLS = 180_000;
const WHITE_RGB = { r: 255, g: 255, b: 255 };
const BLACK_RGB = { r: 0, g: 0, b: 0 };

export function noiseFill(shape: ShapeDefinition, params: FillParams): FillResult {
  if (shape.points.length < 3) {
    return { dotInstances: [], clipPath: [] };
  }

  const bounds = computeBounds(shape.points);

  const requestedSize = Math.max(0.1, params.spacing ?? 0.5);
  let pixelSize = clamp(requestedSize, 0.1, 8);
  const jitter = clamp01(params.variance ?? 0.3);
  const randomness = clamp01(params.noiseRandomness ?? 0);
  const contrast = clamp(0.1 + (params.noiseContrast ?? 0.65) * 2.9, 0.1, 3);
  const colorBleed = clamp01((params.noiseScale ?? 48) / 240);
  const scanlineStrength =
    clamp01(((params.noiseOctaves ?? 3) - 1) / 5) * 0.4;
  const seedOffset = params.seed ?? 0;
  const seed = hashPoints(shape.points) ^ seedOffset;
  const rng = createRng(seed);
  const whiteBias = clamp01(params.noiseThreshold ?? 0.5);
  const biasShift = (whiteBias - 0.5) * 0.9;

  const pad = pixelSize * 2;
  const startX = Math.max(0, Math.floor(bounds.minX - pad));
  const startY = Math.max(0, Math.floor(bounds.minY - pad));
  const endX = Math.floor(bounds.maxX + pad);
  const endY = Math.floor(bounds.maxY + pad);

  const width = Math.max(1, endX - startX);
  const height = Math.max(1, endY - startY);
  const estimatedCols = Math.max(1, Math.ceil(width / pixelSize));
  const estimatedRows = Math.max(1, Math.ceil(height / pixelSize));
  const estimatedCells = estimatedCols * estimatedRows;

  if (estimatedCells > MAX_CELLS) {
    const scale = Math.sqrt(estimatedCells / MAX_CELLS);
    pixelSize = clamp(pixelSize * scale, 0.1, 8);
  }

  const hasCustomFillColor = typeof params.fillColor === 'string' && params.fillColor.trim().length > 0;
  const parsedFill = hasCustomFillColor ? parseCssColor(params.fillColor as string) : null;
  const baseFillColor = parsedFill
    ? { r: parsedFill.r, g: parsedFill.g, b: parsedFill.b }
    : WHITE_RGB;
  const normalizedContrast = clamp01((contrast - 0.1) / (3 - 0.1));
  const highlightMix = clamp01(0.2 + colorBleed * 0.55 + normalizedContrast * 0.15);
  const shadowMix = clamp01(0.35 + normalizedContrast * 0.4);
  const highlightColor = hasCustomFillColor ? mixColor(baseFillColor, WHITE_RGB, highlightMix) : WHITE_RGB;
  const shadowColor = hasCustomFillColor ? mixColor(baseFillColor, BLACK_RGB, shadowMix) : BLACK_RGB;
  const fillAlpha = parsedFill ? clamp01(parsedFill.a / 255) : 1;
  const luminanceScale = 0.23 * contrast;
  const jitterScale = 0.25 * jitter;
  const hotPixelChance = 0.0005 * contrast;
  const coldPixelChance = 0.00035 * contrast;

  const dotInstances: NonNullable<FillResult['dotInstances']> = [];

  let rowIndex = 0;
  for (let y = startY; y < endY && dotInstances.length < MAX_CELLS; y += pixelSize, rowIndex += 1) {
    const scanlineMask =
      1 - scanlineStrength * (0.5 + 0.5 * Math.sin((rowIndex + seed * 0.00037) * 0.9));

    for (let x = startX; x < endX && dotInstances.length < MAX_CELLS; x += pixelSize) {
      const baseCenter: Vec2 = { x: x + pixelSize * 0.5, y: y + pixelSize * 0.5 };
      if (!pointInPolygon(baseCenter, shape.points)) {
        continue;
      }

      let center = baseCenter;
      if (randomness > 0) {
        const jitterExtent = pixelSize * randomness * 0.75;
        const offsetX = (rng() - 0.5) * 2 * jitterExtent;
        const offsetY = (rng() - 0.5) * 2 * jitterExtent;
        const candidate: Vec2 = {
          x: baseCenter.x + offsetX,
          y: baseCenter.y + offsetY,
        };

        if (pointInPolygon(candidate, shape.points)) {
          center = candidate;
        } else {
          center = {
            x: baseCenter.x + offsetX * 0.35,
            y: baseCenter.y + offsetY * 0.35,
          };
        }
      }

      const baseNoise = clamp01(
        0.5 + gaussianNoise(rng) * luminanceScale + (rng() - 0.5) * jitterScale
      );

      let rSample = clamp01(baseNoise + (rng() - 0.5) * colorBleed * 0.9 + biasShift);
      let gSample = clamp01(baseNoise + (rng() - 0.5) * colorBleed * 0.6 + biasShift);
      let bSample = clamp01(baseNoise + (rng() - 0.5) * colorBleed * 1.1 + biasShift);

      const flicker = 1 + (rng() - 0.5) * 0.06 * contrast;
      rSample = clamp01(rSample * flicker);
      gSample = clamp01(gSample * flicker);
      bSample = clamp01(bSample * flicker);

      const hotRoll = rng();
      if (hotRoll < hotPixelChance) {
        rSample = clamp01(rSample + 0.6 + rng() * 0.4);
        gSample = clamp01(gSample + 0.2 + rng() * 0.3);
        bSample = clamp01(bSample + 0.1 + rng() * 0.2);
      } else if (hotRoll - hotPixelChance < coldPixelChance) {
        rSample *= rng() * 0.4;
        gSample *= rng() * 0.3;
        bSample *= rng() * 0.3;
      }

      const maskedR = clamp01(rSample * scanlineMask);
      const maskedG = clamp01(gSample * scanlineMask);
      const maskedB = clamp01(bSample * scanlineMask);
      const r = lerp(shadowColor.r, highlightColor.r, maskedR);
      const g = lerp(shadowColor.g, highlightColor.g, maskedG);
      const b = lerp(shadowColor.b, highlightColor.b, maskedB);

      const color = formatCssColor({ r, g, b }, fillAlpha);
      const luminance = (rSample + gSample + bSample) / 3;

      let dotSize = pixelSize;
      if (randomness > 0) {
        const sizeVariance = 1 + (rng() - 0.5) * randomness * 0.8;
        dotSize = clamp(dotSize * sizeVariance, pixelSize * 0.45, pixelSize * 1.6);
      }

      dotInstances.push({
        center,
        radius: dotSize * 0.5,
        alpha: 1,
        shape: 'square',
        size: dotSize,
        color,
        shade: luminance >= 0.5 ? 1 : -1,
      });
    }
  }

  return {
    dotInstances,
    clipPath: [...shape.points],
  };
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

type RGB = { r: number; g: number; b: number };

function mixColor(a: RGB, b: RGB, t: number): RGB {
  return {
    r: lerp(a.r, b.r, t),
    g: lerp(a.g, b.g, t),
    b: lerp(a.b, b.b, t),
  };
}

function formatCssColor(rgb: RGB, alpha: number): string {
  const r = clampChannel(rgb.r);
  const g = clampChannel(rgb.g);
  const b = clampChannel(rgb.b);
  const normalizedAlpha = clamp01(alpha);
  if (normalizedAlpha >= 0.999) {
    return `rgb(${r}, ${g}, ${b})`;
  }
  const roundedAlpha = Math.round(normalizedAlpha * 1000) / 1000;
  return `rgba(${r}, ${g}, ${b}, ${roundedAlpha})`;
}

function clampChannel(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(255, Math.round(value)));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function gaussianNoise(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
