import type { StoredStop } from '@/utils/colorCycleGradientDefs';
import { computeDistanceField } from '@/utils/colorCycle/concentricFillCore';

const COLOR_BIN_LEVELS = 32;
const COLOR_BIN_COUNT = COLOR_BIN_LEVELS ** 3;
const K_MEANS_ITERATIONS = 4;

type Oklab = { l: number; a: number; b: number };

type ColorEntry = Oklab & {
  r: number;
  g: number;
  blue: number;
  weight: number;
  projection: number;
};

export type ShapeFootprintSamplingInput = {
  width: number;
  height: number;
  originX: number;
  originY: number;
  sampleScaleX: number;
  sampleScaleY: number;
  vertices: Float32Array;
  compositePixels: Uint8ClampedArray;
  referencePixels?: Uint8ClampedArray;
  maxColors: number;
  mode: 'linear' | 'concentric';
  directionX?: number;
  directionY?: number;
};

export type ShapeFootprintSamplingResult = {
  stops: StoredStop[];
  stats: {
    sampledPixels: number;
    uniqueColorBins: number;
    outputColors: number;
    alphaWeight: number;
  };
};

const srgbChannelToLinear = (value: number): number => {
  const normalized = value / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
};

const linearChannelToSrgb = (value: number): number => {
  const clamped = Math.max(0, Math.min(1, value));
  const normalized = clamped <= 0.0031308
    ? clamped * 12.92
    : 1.055 * clamped ** (1 / 2.4) - 0.055;
  return Math.round(normalized * 255);
};

const rgbToOklab = (r: number, g: number, b: number): Oklab => {
  const linearR = srgbChannelToLinear(r);
  const linearG = srgbChannelToLinear(g);
  const linearB = srgbChannelToLinear(b);
  const l = Math.cbrt(0.4122214708 * linearR + 0.5363325363 * linearG + 0.0514459929 * linearB);
  const m = Math.cbrt(0.2119034982 * linearR + 0.6806995451 * linearG + 0.1073969566 * linearB);
  const s = Math.cbrt(0.0883024619 * linearR + 0.2817188376 * linearG + 0.6299787005 * linearB);
  return {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
};

const oklabToRgb = ({ l, a, b }: Oklab): [number, number, number] => {
  const lRoot = l + 0.3963377774 * a + 0.2158037573 * b;
  const mRoot = l - 0.1055613458 * a - 0.0638541728 * b;
  const sRoot = l - 0.0894841775 * a - 1.291485548 * b;
  const linearL = lRoot ** 3;
  const linearM = mRoot ** 3;
  const linearS = sRoot ** 3;
  return [
    linearChannelToSrgb(4.0767416621 * linearL - 3.3077115913 * linearM + 0.2309699292 * linearS),
    linearChannelToSrgb(-1.2684380046 * linearL + 2.6097574011 * linearM - 0.3413193965 * linearS),
    linearChannelToSrgb(-0.0041960863 * linearL - 0.7034186147 * linearM + 1.707614701 * linearS),
  ];
};

const colorDistanceSquared = (a: Oklab, b: Oklab): number => {
  const dl = a.l - b.l;
  const da = a.a - b.a;
  const db = a.b - b.b;
  return dl * dl + da * da + db * db;
};

const toHex = (r: number, g: number, b: number): string => {
  const channel = (value: number) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
};

const buildColorEntries = (input: ShapeFootprintSamplingInput): {
  entries: ColorEntry[];
  sampledPixels: number;
  alphaWeight: number;
} => {
  const weights = new Float64Array(COLOR_BIN_COUNT);
  const redSums = new Float64Array(COLOR_BIN_COUNT);
  const greenSums = new Float64Array(COLOR_BIN_COUNT);
  const blueSums = new Float64Array(COLOR_BIN_COUNT);
  const projectionSums = new Float64Array(COLOR_BIN_COUNT);
  const activeBins: number[] = [];
  const mask = new Uint8Array(input.width * input.height);
  const intersections: Array<{ x: number; delta: 1 | -1 }> = [];
  const vertexCount = input.vertices.length / 2;
  const scaleX = Math.max(1, input.sampleScaleX);
  const scaleY = Math.max(1, input.sampleScaleY);
  const rawDirectionLength = Math.hypot(input.directionX ?? 0, input.directionY ?? 0);
  const directionX = rawDirectionLength > 1e-6 ? (input.directionX ?? 0) / rawDirectionLength : 1;
  const directionY = rawDirectionLength > 1e-6 ? (input.directionY ?? 0) / rawDirectionLength : 0;
  let sampledPixels = 0;
  let alphaWeight = 0;

  for (let y = 0; y < input.height; y += 1) {
    const worldY = input.originY + (y + 0.5) * scaleY;
    intersections.length = 0;
    for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1) {
      const nextIndex = (vertexIndex + 1) % vertexCount;
      const x1 = input.vertices[vertexIndex * 2];
      const y1 = input.vertices[vertexIndex * 2 + 1];
      const x2 = input.vertices[nextIndex * 2];
      const y2 = input.vertices[nextIndex * 2 + 1];
      const upward = y1 <= worldY && y2 > worldY;
      const downward = y2 <= worldY && y1 > worldY;
      if (!upward && !downward) {
        continue;
      }
      intersections.push({
        x: x1 + ((worldY - y1) * (x2 - x1)) / (y2 - y1),
        delta: upward ? 1 : -1,
      });
    }
    intersections.sort((left, right) => left.x - right.x || right.delta - left.delta);

    let winding = 0;
    let spanStart: number | null = null;
    for (const intersection of intersections) {
      if (winding !== 0 && spanStart !== null && intersection.x > spanStart) {
        const startX = Math.max(0, Math.ceil((spanStart - input.originX) / scaleX - 0.5));
        const endX = Math.min(
          input.width - 1,
          Math.floor((intersection.x - input.originX) / scaleX - 0.5),
        );
        for (let x = startX; x <= endX; x += 1) {
          mask[y * input.width + x] = 1;
        }
      }
      winding += intersection.delta;
      spanStart = winding !== 0 ? intersection.x : null;
    }
  }

  const concentricDistances = input.mode === 'concentric'
    ? computeDistanceField(mask, input.width, input.height)
    : null;
  for (let y = 0; y < input.height; y += 1) {
    for (let x = 0; x < input.width; x += 1) {
      const pixelIndex = y * input.width + x;
      if (!mask[pixelIndex]) continue;
      const pixelOffset = pixelIndex * 4;
      const referenceAlpha = input.referencePixels?.[pixelOffset + 3] ?? 0;
      const pixels = referenceAlpha > 0 && input.referencePixels
        ? input.referencePixels
        : input.compositePixels;
      const alpha = pixels[pixelOffset + 3] / 255;
      if (alpha <= 0) continue;

      const r = pixels[pixelOffset];
      const g = pixels[pixelOffset + 1];
      const b = pixels[pixelOffset + 2];
      const bin = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      if (weights[bin] === 0) activeBins.push(bin);
      const worldX = input.originX + (x + 0.5) * scaleX;
      const worldY = input.originY + (y + 0.5) * scaleY;
      const projection = concentricDistances
        ? concentricDistances[pixelIndex]
        : worldX * directionX + worldY * directionY;
      weights[bin] += alpha;
      redSums[bin] += r * alpha;
      greenSums[bin] += g * alpha;
      blueSums[bin] += b * alpha;
      projectionSums[bin] += projection * alpha;
      sampledPixels += 1;
      alphaWeight += alpha;
    }
  }

  const entries = activeBins.map((bin): ColorEntry => {
    const weight = weights[bin];
    const r = redSums[bin] / weight;
    const g = greenSums[bin] / weight;
    const blue = blueSums[bin] / weight;
    return {
      ...rgbToOklab(r, g, blue),
      r,
      g,
      blue,
      weight,
      projection: projectionSums[bin] / weight,
    };
  });

  return { entries, sampledPixels, alphaWeight };
};

const buildRepresentativeColors = (
  entries: ColorEntry[],
  requestedColors: number,
): Array<{ color: string; projection: number; luminance: number }> => {
  if (entries.length === 0) {
    return [];
  }

  const colorCount = Math.min(Math.max(1, requestedColors), entries.length);
  if (colorCount === 1) {
    let weight = 0;
    let l = 0;
    let a = 0;
    let b = 0;
    let projection = 0;
    for (const entry of entries) {
      weight += entry.weight;
      l += entry.l * entry.weight;
      a += entry.a * entry.weight;
      b += entry.b * entry.weight;
      projection += entry.projection * entry.weight;
    }
    const mean = { l: l / weight, a: a / weight, b: b / weight };
    const [r, g, blue] = oklabToRgb(mean);
    return [{
      color: toHex(r, g, blue),
      projection: projection / weight,
      luminance: mean.l,
    }];
  }

  const centers: Oklab[] = [];
  let first = entries[0];
  for (const entry of entries) {
    if (entry.weight > first.weight) {
      first = entry;
    }
  }
  centers.push({ l: first.l, a: first.a, b: first.b });

  while (centers.length < colorCount) {
    let bestEntry: ColorEntry | null = null;
    let bestScore = -1;
    for (const entry of entries) {
      let nearestDistance = Infinity;
      for (const center of centers) {
        nearestDistance = Math.min(nearestDistance, colorDistanceSquared(entry, center));
      }
      const score = nearestDistance * Math.sqrt(entry.weight);
      if (score > bestScore) {
        bestScore = score;
        bestEntry = entry;
      }
    }
    if (!bestEntry || bestScore <= 1e-12) {
      break;
    }
    centers.push({ l: bestEntry.l, a: bestEntry.a, b: bestEntry.b });
  }

  const assignments = new Int16Array(entries.length);
  for (let iteration = 0; iteration < K_MEANS_ITERATIONS; iteration += 1) {
    const clusterWeights = new Float64Array(centers.length);
    const lSums = new Float64Array(centers.length);
    const aSums = new Float64Array(centers.length);
    const bSums = new Float64Array(centers.length);
    for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
      const entry = entries[entryIndex];
      let nearestIndex = 0;
      let nearestDistance = Infinity;
      for (let centerIndex = 0; centerIndex < centers.length; centerIndex += 1) {
        const distance = colorDistanceSquared(entry, centers[centerIndex]);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = centerIndex;
        }
      }
      assignments[entryIndex] = nearestIndex;
      clusterWeights[nearestIndex] += entry.weight;
      lSums[nearestIndex] += entry.l * entry.weight;
      aSums[nearestIndex] += entry.a * entry.weight;
      bSums[nearestIndex] += entry.b * entry.weight;
    }
    for (let centerIndex = 0; centerIndex < centers.length; centerIndex += 1) {
      const weight = clusterWeights[centerIndex];
      if (weight > 0) {
        centers[centerIndex] = {
          l: lSums[centerIndex] / weight,
          a: aSums[centerIndex] / weight,
          b: bSums[centerIndex] / weight,
        };
      }
    }
  }

  const clusterWeights = new Float64Array(centers.length);
  const projectionSums = new Float64Array(centers.length);
  const nearestEntries: Array<ColorEntry | null> = Array.from({ length: centers.length }, () => null);
  const nearestDistances = new Float64Array(centers.length).fill(Infinity);
  for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
    const entry = entries[entryIndex];
    let nearestIndex = 0;
    let nearestDistance = Infinity;
    for (let centerIndex = 0; centerIndex < centers.length; centerIndex += 1) {
      const distance = colorDistanceSquared(entry, centers[centerIndex]);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = centerIndex;
      }
    }
    assignments[entryIndex] = nearestIndex;
    clusterWeights[nearestIndex] += entry.weight;
    projectionSums[nearestIndex] += entry.projection * entry.weight;
    if (
      nearestDistance < nearestDistances[nearestIndex]
      || (nearestDistance === nearestDistances[nearestIndex]
        && entry.weight > (nearestEntries[nearestIndex]?.weight ?? 0))
    ) {
      nearestDistances[nearestIndex] = nearestDistance;
      nearestEntries[nearestIndex] = entry;
    }
  }

  const representatives = centers.flatMap((center, index) => {
    const representative = nearestEntries[index];
    if (!representative || clusterWeights[index] <= 0) {
      return [];
    }
    return [{
      color: toHex(representative.r, representative.g, representative.blue),
      projection: projectionSums[index] / clusterWeights[index],
      luminance: center.l,
    }];
  });
  const distinct = new Map<string, (typeof representatives)[number]>();
  for (const representative of representatives) {
    const existing = distinct.get(representative.color);
    if (!existing) {
      distinct.set(representative.color, representative);
    }
  }
  return Array.from(distinct.values());
};

export const sampleShapeFootprintGradient = (
  input: ShapeFootprintSamplingInput,
): ShapeFootprintSamplingResult | null => {
  if (
    input.width <= 0
    || input.height <= 0
    || input.vertices.length < 6
    || input.compositePixels.length < input.width * input.height * 4
  ) {
    return null;
  }

  const { entries, sampledPixels, alphaWeight } = buildColorEntries(input);
  const representatives = buildRepresentativeColors(
    entries,
    Math.max(1, Math.min(16, Math.round(input.maxColors))),
  ).sort((left, right) => left.projection - right.projection || left.luminance - right.luminance);
  if (representatives.length === 0) {
    return null;
  }

  const stops: StoredStop[] = representatives.length === 1
    ? [
        { position: 0, color: representatives[0].color },
        { position: 1, color: representatives[0].color },
      ]
    : representatives.map((representative, index) => ({
        position: index / (representatives.length - 1),
        color: representative.color,
      }));

  return {
    stops,
    stats: {
      sampledPixels,
      uniqueColorBins: entries.length,
      outputColors: representatives.length,
      alphaWeight,
    },
  };
};
