import fs from 'node:fs';
import path from 'node:path';

import { bakePaletteTable, renderBrushFrame, type Goblet2GradientStop } from '@/lib/colorCycle/goblet2Cpu';
import { applyGradientSeamProfile, type GradientSeamProfile } from '@/lib/colorCycle/gradientSeamProfile';

type FixtureThresholds = {
  maxChannelDelta: number;
  maxAlphaDelta: number;
  maxMismatchedPixels: number;
};

type CCFixture = {
  id: string;
  description?: string;
  width: number;
  height: number;
  timeSeconds: number;
  legacyOffset01?: number;
  speedMin: number;
  speedMax: number;
  paletteSize?: number;
  thresholds: FixtureThresholds;
  brushState: {
    indexBuffer: number[];
    gradientIdBuffer: number[];
    speedBuffer: number[];
    gradientStops: Goblet2GradientStop[];
  };
  slotPalettes?: Array<{ slot: number; stops: Goblet2GradientStop[]; seamProfile?: GradientSeamProfile }>;
};

const clamp01 = (value: number): number => {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
};

const clamp255 = (value: number): number => {
  const rounded = Math.round(value);
  if (rounded <= 0) return 0;
  if (rounded >= 255) return 255;
  return rounded;
};

const mod = (value: number, divisor: number): number => {
  const remainder = value % divisor;
  return remainder < 0 ? remainder + divisor : remainder;
};

const parseHexColor = (value: string): { r: number; g: number; b: number; a: number } => {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed.startsWith('#')) {
    return { r: 255, g: 255, b: 255, a: 255 };
  }

  const hex = trimmed.slice(1);
  if (hex.length === 3 || hex.length === 4) {
    const r = parseInt(hex[0] + hex[0], 16);
    const g = parseInt(hex[1] + hex[1], 16);
    const b = parseInt(hex[2] + hex[2], 16);
    const a = hex.length === 4 ? parseInt(hex[3] + hex[3], 16) : 255;
    return { r, g, b, a };
  }

  if (hex.length === 6 || hex.length === 8) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) : 255;
    return { r, g, b, a };
  }

  return { r: 255, g: 255, b: 255, a: 255 };
};

const normalizeStops = (stops: Goblet2GradientStop[]): Array<{ position: number; rgba: { r: number; g: number; b: number; a: number } }> => {
  if (!Array.isArray(stops) || stops.length === 0) {
    return [
      { position: 0, rgba: { r: 0, g: 0, b: 0, a: 255 } },
      { position: 1, rgba: { r: 255, g: 255, b: 255, a: 255 } },
    ];
  }

  const sorted = stops
    .map((entry) => ({
      position: clamp01(typeof entry.position === 'number' ? entry.position : Number(entry.position)),
      rgba: parseHexColor(entry.color),
    }))
    .sort((a, b) => a.position - b.position);

  if (sorted[0].position > 0) {
    sorted.unshift({ position: 0, rgba: sorted[0].rgba });
  }

  const last = sorted[sorted.length - 1];
  if (last.position < 1) {
    sorted.push({ position: 1, rgba: last.rgba });
  }

  if (sorted.length === 1) {
    sorted.push({ position: 1, rgba: sorted[0].rgba });
  }

  return sorted;
};

const sampleStops = (
  normalizedStops: Array<{ position: number; rgba: { r: number; g: number; b: number; a: number } }>,
  position: number,
): { r: number; g: number; b: number; a: number } => {
  const p = clamp01(position);
  for (let i = 0; i < normalizedStops.length - 1; i += 1) {
    const left = normalizedStops[i];
    const right = normalizedStops[i + 1];
    if (p >= left.position && p <= right.position) {
      const span = right.position - left.position;
      const t = span > 0 ? (p - left.position) / span : 0;
      return {
        r: clamp255(left.rgba.r + (right.rgba.r - left.rgba.r) * t),
        g: clamp255(left.rgba.g + (right.rgba.g - left.rgba.g) * t),
        b: clamp255(left.rgba.b + (right.rgba.b - left.rgba.b) * t),
        a: clamp255(left.rgba.a + (right.rgba.a - left.rgba.a) * t),
      };
    }
  }

  return { ...normalizedStops[normalizedStops.length - 1].rgba };
};

const decodeSpeed = (byte: number, speedMin: number, speedMax: number): number => {
  if (!Number.isFinite(byte) || byte <= 0) {
    return 0;
  }
  const normalized = Math.max(0, Math.min(254, Math.round(byte) - 1)) / 254;
  return speedMin + normalized * (speedMax - speedMin);
};

const buildReferencePaletteTable = (
  slotPalettes: Map<number, { stops: Goblet2GradientStop[]; seamProfile?: GradientSeamProfile }> | null,
  fallbackGradient: Goblet2GradientStop[],
  paletteSize: number,
  slotCount: number,
): Uint8Array => {
  const data = new Uint8Array(Math.max(1, paletteSize) * Math.max(1, slotCount) * 4);
  const fallbackStops = normalizeStops(fallbackGradient);
  for (let slot = 0; slot < slotCount; slot += 1) {
    const slotPalette = slotPalettes?.get(slot);
    const normalized = slotPalette ? normalizeStops(slotPalette.stops) : fallbackStops;
    for (let i = 0; i < paletteSize; i += 1) {
      const t = paletteSize === 1 ? 0 : i / (paletteSize - 1);
      const c = sampleStops(normalized, t);
      const base = (slot * paletteSize + i) * 4;
      data[base] = c.r;
      data[base + 1] = c.g;
      data[base + 2] = c.b;
      data[base + 3] = c.a;
    }
    applyGradientSeamProfile(data, {
      paletteSize,
      seamProfile: slotPalette?.seamProfile,
      offset: slot * paletteSize * 4,
    });
  }
  return data;
};

const renderVesselReferenceFrame = (params: {
  indexBuffer: Uint8Array;
  gradientIdBuffer: Uint8Array;
  speedBuffer: Uint8Array;
  fallbackGradient: Goblet2GradientStop[];
  slotPalettes: Map<number, { stops: Goblet2GradientStop[]; seamProfile?: GradientSeamProfile }> | null;
  paletteSize: number;
  slotCount: number;
  speedMin: number;
  speedMax: number;
  timeSeconds: number;
  legacyOffset01: number;
}): Uint8ClampedArray => {
  const {
    indexBuffer,
    gradientIdBuffer,
    speedBuffer,
    fallbackGradient,
    slotPalettes,
    paletteSize,
    slotCount,
    speedMin,
    speedMax,
    timeSeconds,
    legacyOffset01,
  } = params;

  const palette = buildReferencePaletteTable(slotPalettes, fallbackGradient, paletteSize, slotCount);
  const output = new Uint8ClampedArray(indexBuffer.length * 4);

  for (let i = 0; i < indexBuffer.length; i += 1) {
    const index = indexBuffer[i] ?? 0;
    const outIndex = i * 4;

    if (index === 0) {
      output[outIndex + 3] = 0;
      continue;
    }

    const slot = Math.min(gradientIdBuffer[i] ?? 0, slotCount - 1);
    const speedByte = speedBuffer[i] ?? 0;
    const shift = speedByte === 0
      ? -legacyOffset01 * paletteSize
      : -((timeSeconds * decodeSpeed(speedByte, speedMin, speedMax)) % 1) * paletteSize;

    const baseIndex = Math.max(0, Math.min(paletteSize - 1, index - 1));
    const shifted = mod(baseIndex + shift, paletteSize);
    const paletteIndex = (slot * paletteSize + shifted) * 4;

    output[outIndex] = palette[paletteIndex];
    output[outIndex + 1] = palette[paletteIndex + 1];
    output[outIndex + 2] = palette[paletteIndex + 2];
    output[outIndex + 3] = 255;
  }

  return output;
};

const loadFixtures = (): CCFixture[] => {
  const fixtureDir = path.resolve(process.cwd(), 'tests/fixtures/cc');
  return fs
    .readdirSync(fixtureDir)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => {
      const raw = fs.readFileSync(path.join(fixtureDir, file), 'utf8');
      return JSON.parse(raw) as CCFixture;
    });
};

const diffFrames = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
  if (a.length !== b.length) {
    return {
      maxChannelDelta: Number.POSITIVE_INFINITY,
      maxAlphaDelta: Number.POSITIVE_INFINITY,
      mismatchedPixels: Number.POSITIVE_INFINITY,
    };
  }

  let maxChannelDelta = 0;
  let maxAlphaDelta = 0;
  let mismatchedPixels = 0;

  for (let i = 0; i < a.length; i += 4) {
    const dr = Math.abs(a[i] - b[i]);
    const dg = Math.abs(a[i + 1] - b[i + 1]);
    const db = Math.abs(a[i + 2] - b[i + 2]);
    const da = Math.abs(a[i + 3] - b[i + 3]);

    const maxRgb = Math.max(dr, dg, db);
    maxChannelDelta = Math.max(maxChannelDelta, maxRgb);
    maxAlphaDelta = Math.max(maxAlphaDelta, da);

    if (maxRgb > 0 || da > 0) {
      mismatchedPixels += 1;
    }
  }

  return { maxChannelDelta, maxAlphaDelta, mismatchedPixels };
};

describe('Color cycle runtime parity (Vessel reference vs Goblet2 CPU)', () => {
  const fixtures = loadFixtures();

  it('loads at least one CC fixture', () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  fixtures.forEach((fixture) => {
    it(`keeps parity for fixture: ${fixture.id}`, () => {
      const pixelCount = fixture.width * fixture.height;
      expect(fixture.brushState.indexBuffer).toHaveLength(pixelCount);
      expect(fixture.brushState.gradientIdBuffer).toHaveLength(pixelCount);
      expect(fixture.brushState.speedBuffer).toHaveLength(pixelCount);

      const indexBuffer = Uint8Array.from(fixture.brushState.indexBuffer);
      const gradientIdBuffer = Uint8Array.from(fixture.brushState.gradientIdBuffer);
      const speedBuffer = Uint8Array.from(fixture.brushState.speedBuffer);
      const slotPalettes = fixture.slotPalettes
        ? new Map<number, { stops: Goblet2GradientStop[]; seamProfile?: GradientSeamProfile }>(
            fixture.slotPalettes.map((entry) => [
              entry.slot,
              { stops: entry.stops, seamProfile: entry.seamProfile },
            ]),
          )
        : null;

      const paletteSize = Math.max(1, Math.round(fixture.paletteSize ?? 256));
      const highestSlotInPalettes = fixture.slotPalettes?.reduce((max, entry) => Math.max(max, entry.slot), 0) ?? 0;
      const slotCount = Math.max(1, highestSlotInPalettes + 1);

      const gobletPalette = bakePaletteTable(
        slotPalettes,
        fixture.brushState.gradientStops,
        paletteSize,
        slotCount,
      );

      const frameTimes = [fixture.timeSeconds, fixture.timeSeconds + 0.5];
      frameTimes.forEach((timeSeconds) => {
        const gobletFrame = renderBrushFrame({
          indexBuffer,
          gradientIdBuffer,
          speedBuffer,
          paletteTable: gobletPalette,
          speedMin: fixture.speedMin,
          speedMax: fixture.speedMax,
          timeSeconds,
          legacyOffset01: fixture.legacyOffset01 ?? 0,
        });

        const vesselFrame = renderVesselReferenceFrame({
          indexBuffer,
          gradientIdBuffer,
          speedBuffer,
          fallbackGradient: fixture.brushState.gradientStops,
          slotPalettes,
          paletteSize,
          slotCount,
          speedMin: fixture.speedMin,
          speedMax: fixture.speedMax,
          timeSeconds,
          legacyOffset01: fixture.legacyOffset01 ?? 0,
        });

        const deltas = diffFrames(vesselFrame, gobletFrame);
        expect(deltas.maxChannelDelta).toBeLessThanOrEqual(fixture.thresholds.maxChannelDelta);
        expect(deltas.maxAlphaDelta).toBeLessThanOrEqual(fixture.thresholds.maxAlphaDelta);
        expect(deltas.mismatchedPixels).toBeLessThanOrEqual(fixture.thresholds.maxMismatchedPixels);
      });
    });
  });
});
