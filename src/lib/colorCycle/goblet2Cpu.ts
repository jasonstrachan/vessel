import {
  applyGradientSeamProfile,
  normalizeGradientSeamProfile,
  type GradientSeamProfile,
} from '@/lib/colorCycle/gradientSeamProfile';

export type Goblet2GradientStop = { position: number; color: string };
export type Goblet2SlotPalette = {
  stops: Goblet2GradientStop[];
  seamProfile?: GradientSeamProfile;
};

export type Goblet2PaletteTable = {
  data: Uint8Array;
  width: number;
  height: number;
};

const clamp01 = (value: number): number => {
  if (value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }
  return value;
};

const clamp255 = (value: number): number => {
  const rounded = Math.round(value);
  if (rounded <= 0) {
    return 0;
  }
  if (rounded >= 255) {
    return 255;
  }
  return rounded;
};

const parseColor = (value: string): { r: number; g: number; b: number; a: number } => {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.startsWith('#')) {
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
  }
  return { r: 255, g: 255, b: 255, a: 255 };
};

const normalizeStops = (stops: Goblet2GradientStop[]): Array<{ position: number; rgba: { r: number; g: number; b: number; a: number } }> => {
  if (!Array.isArray(stops) || stops.length === 0) {
    return [
      { position: 0, rgba: { r: 0, g: 0, b: 0, a: 255 } },
      { position: 1, rgba: { r: 255, g: 255, b: 255, a: 255 } }
    ];
  }
  const normalized = stops
    .map((stop) => ({
      position: clamp01(typeof stop.position === 'number' ? stop.position : parseFloat(String(stop.position))),
      rgba: parseColor(stop.color)
    }))
    .sort((a, b) => a.position - b.position);
  if (normalized[0].position > 0) {
    normalized.unshift({ position: 0, rgba: normalized[0].rgba });
  }
  const last = normalized[normalized.length - 1];
  if (last.position < 1) {
    normalized.push({ position: 1, rgba: last.rgba });
  }
  if (normalized.length === 1) {
    normalized.push({ position: 1, rgba: normalized[0].rgba });
  }
  return normalized;
};

const sampleGradient = (stops: Array<{ position: number; rgba: { r: number; g: number; b: number; a: number } }>, position: number) => {
  const pos = clamp01(position);
  for (let i = 0; i < stops.length - 1; i += 1) {
    const left = stops[i];
    const right = stops[i + 1];
    if (pos >= left.position && pos <= right.position) {
      const span = right.position - left.position;
      const t = span > 0 ? (pos - left.position) / span : 0;
      return {
        r: clamp255(left.rgba.r + (right.rgba.r - left.rgba.r) * t),
        g: clamp255(left.rgba.g + (right.rgba.g - left.rgba.g) * t),
        b: clamp255(left.rgba.b + (right.rgba.b - left.rgba.b) * t),
        a: clamp255(left.rgba.a + (right.rgba.a - left.rgba.a) * t)
      };
    }
  }
  return { ...stops[stops.length - 1].rgba };
};

export const decodeSpeedByte = (byte: number, speedMin: number, speedMax: number): number => {
  if (!Number.isFinite(byte) || byte <= 0) {
    return 0;
  }
  const minV = Number.isFinite(speedMin) ? speedMin : 0;
  const maxV = Number.isFinite(speedMax) ? speedMax : 0;
  const normalized = Math.max(0, Math.min(254, Math.round(byte) - 1));
  const t = normalized / 254;
  return minV + t * (maxV - minV);
};

export const bakePaletteTable = (
  slotPalettes: Map<number, Goblet2GradientStop[] | Goblet2SlotPalette> | null,
  fallbackGradient: Goblet2GradientStop[],
  paletteSize = 256,
  slotCount = 64
): Goblet2PaletteTable => {
  const size = Math.max(1, Math.round(paletteSize));
  const data = new Uint8Array(size * slotCount * 4);
  const fallbackStops = normalizeStops(fallbackGradient);
  for (let slot = 0; slot < slotCount; slot += 1) {
    const slotPalette = slotPalettes?.get(slot) ?? null;
    const slotStops = Array.isArray(slotPalette)
      ? slotPalette
      : slotPalette?.stops ?? null;
    const seamProfile = Array.isArray(slotPalette)
      ? 'hard'
      : normalizeGradientSeamProfile(slotPalette?.seamProfile);
    const stops = slotStops ? normalizeStops(slotStops) : fallbackStops;
    for (let i = 0; i < size; i += 1) {
      const t = size === 1 ? 0 : i / (size - 1);
      const c = sampleGradient(stops, t);
      const idx = (slot * size + i) * 4;
      data[idx] = c.r;
      data[idx + 1] = c.g;
      data[idx + 2] = c.b;
      data[idx + 3] = c.a;
    }
    applyGradientSeamProfile(data, {
      paletteSize: size,
      seamProfile,
      offset: slot * size * 4,
    });
  }
  return { data, width: size, height: slotCount };
};

export const renderBrushFrame = (params: {
  indexBuffer: Uint8Array;
  gradientIdBuffer: Uint8Array;
  speedBuffer: Uint8Array;
  paletteTable: Goblet2PaletteTable;
  speedMin: number;
  speedMax: number;
  timeSeconds: number;
  legacyOffset01?: number;
}): Uint8ClampedArray => {
  const {
    indexBuffer,
    gradientIdBuffer,
    speedBuffer,
    paletteTable,
    speedMin,
    speedMax,
    timeSeconds,
    legacyOffset01 = 0
  } = params;
  const length = indexBuffer.length;
  const out = new Uint8ClampedArray(length * 4);
  const paletteSize = paletteTable.width;
  const slotCount = paletteTable.height;
  for (let i = 0; i < length; i += 1) {
    const idx = indexBuffer[i];
    const outIndex = i * 4;
    if (idx === 0) {
      out[outIndex + 3] = 0;
      continue;
    }
    const slot = Math.min(gradientIdBuffer[i] ?? 0, slotCount - 1);
    const speedByte = speedBuffer[i] ?? 0;
    let shift = 0;
    if (speedByte === 0) {
      shift = -legacyOffset01 * paletteSize;
    } else {
      const speed = decodeSpeedByte(speedByte, speedMin, speedMax);
      shift = -((timeSeconds * speed) % 1) * paletteSize;
    }
    let paletteIndex = idx - 1;
    if (paletteIndex < 0) {
      paletteIndex = 0;
    } else if (paletteIndex >= paletteSize) {
      paletteIndex = paletteSize - 1;
    }
    let shifted = paletteIndex + shift;
    shifted %= paletteSize;
    if (shifted < 0) {
      shifted += paletteSize;
    }
    const base = (slot * paletteSize + shifted) * 4;
    out[outIndex] = paletteTable.data[base];
    out[outIndex + 1] = paletteTable.data[base + 1];
    out[outIndex + 2] = paletteTable.data[base + 2];
    out[outIndex + 3] = 255;
  }
  return out;
};
