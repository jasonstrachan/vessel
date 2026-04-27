import { DEFAULT_GRADIENT_STOPS } from '@/utils/gradientPresets';
import { parseCssColor, type RGBAColor } from '@/utils/color/parseCssColor';

type RecoverableGradientStop = {
  position: number;
  color: string | { r: number; g: number; b: number };
};

type RecoverCompatibilitySnapshotPaintBufferOptions = {
  imageData: ImageData;
  width: number;
  height: number;
  gradientStops?: RecoverableGradientStop[];
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const parseStopColor = (color: RecoverableGradientStop['color']): RGBAColor => {
  if (typeof color === 'string') {
    return parseCssColor(color, { r: 255, g: 255, b: 255, a: 255 });
  }
  return {
    r: Math.max(0, Math.min(255, Math.round(color.r))),
    g: Math.max(0, Math.min(255, Math.round(color.g))),
    b: Math.max(0, Math.min(255, Math.round(color.b))),
    a: 255,
  };
};

const sampleGradientColor = (
  stops: Array<RecoverableGradientStop & { parsedColor: RGBAColor }>,
  position: number,
): RGBAColor => {
  const clamped = clamp01(position);
  let previous = stops[0];
  let next = stops[stops.length - 1];

  for (let stopIndex = 0; stopIndex < stops.length - 1; stopIndex += 1) {
    const current = stops[stopIndex];
    const upcoming = stops[stopIndex + 1];
    if (clamped >= current.position && clamped <= upcoming.position) {
      previous = current;
      next = upcoming;
      break;
    }
  }

  const span = next.position - previous.position;
  const t = span > 0 ? (clamped - previous.position) / span : 0;
  return {
    r: Math.round(previous.parsedColor.r + (next.parsedColor.r - previous.parsedColor.r) * t),
    g: Math.round(previous.parsedColor.g + (next.parsedColor.g - previous.parsedColor.g) * t),
    b: Math.round(previous.parsedColor.b + (next.parsedColor.b - previous.parsedColor.b) * t),
    a: Math.round(previous.parsedColor.a + (next.parsedColor.a - previous.parsedColor.a) * t),
  };
};

const buildRecoveryPalette = (gradientStops?: RecoverableGradientStop[]): Uint8ClampedArray => {
  const normalizedStops = (gradientStops?.length ? gradientStops : DEFAULT_GRADIENT_STOPS)
    .map((stop) => ({
      ...stop,
      position: clamp01(Number(stop.position)),
      parsedColor: parseStopColor(stop.color),
    }))
    .sort((a, b) => a.position - b.position);

  const stops = normalizedStops.length > 0
    ? normalizedStops
    : DEFAULT_GRADIENT_STOPS.map((stop) => ({
        ...stop,
        position: clamp01(stop.position),
        parsedColor: parseStopColor(stop.color),
      }));

  const palette = new Uint8ClampedArray(256 * 3);
  for (let index = 1; index <= 255; index += 1) {
    const position = (index - 1) / 254;
    const color = sampleGradientColor(stops, position);
    const offset = index * 3;
    palette[offset] = color.r;
    palette[offset + 1] = color.g;
    palette[offset + 2] = color.b;
  }
  return palette;
};

const findNearestPaletteIndex = (
  palette: Uint8ClampedArray,
  red: number,
  green: number,
  blue: number,
): number => {
  let nearestIndex = 1;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (let index = 1; index <= 255; index += 1) {
    const offset = index * 3;
    const deltaRed = red - palette[offset];
    const deltaGreen = green - palette[offset + 1];
    const deltaBlue = blue - palette[offset + 2];
    const distance = deltaRed * deltaRed + deltaGreen * deltaGreen + deltaBlue * deltaBlue;
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
      if (distance === 0) {
        break;
      }
    }
  }

  return nearestIndex;
};

export const recoverCompatibilitySnapshotPaintBuffer = ({
  imageData,
  width,
  height,
  gradientStops,
}: RecoverCompatibilitySnapshotPaintBufferOptions): ArrayBuffer | undefined => {
  if (width <= 0 || height <= 0 || imageData.width !== width || imageData.height !== height) {
    return undefined;
  }

  const pixelCount = width * height;
  const paint = new Uint8Array(pixelCount);
  const palette = buildRecoveryPalette(gradientStops);
  let hasVisiblePixel = false;

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const imageOffset = pixelIndex * 4;
    if (imageData.data[imageOffset + 3] === 0) {
      continue;
    }
    paint[pixelIndex] = findNearestPaletteIndex(
      palette,
      imageData.data[imageOffset],
      imageData.data[imageOffset + 1],
      imageData.data[imageOffset + 2],
    );
    hasVisiblePixel = true;
  }

  return hasVisiblePixel ? paint.buffer : undefined;
};
