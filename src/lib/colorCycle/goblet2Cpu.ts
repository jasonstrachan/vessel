import {
  applyGradientSeamProfile,
  normalizeGradientSeamProfile,
  type GradientSeamProfile,
} from '@/lib/colorCycle/gradientSeamProfile';
import {
  clampGobletByte,
  decodeColorCycleSpeedByte,
  GOBLET_FLOW_MODE_FORWARD,
  GOBLET_FLOW_MODE_PINGPONG,
  GOBLET_FLOW_MODE_REVERSE,
  normalizeGobletGradientStops,
  resolveGobletPaletteIndex,
  resolveGobletPalettePosition,
  resolveGobletPaletteRow,
  resolveGobletPhase01,
  resolveGobletFlowMode,
  sampleGobletGradient,
} from '@/lib/colorCycle/gobletPlaybackMath';

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

export const GOBLET2_FLOW_FORWARD = GOBLET_FLOW_MODE_FORWARD;
export const GOBLET2_FLOW_REVERSE = GOBLET_FLOW_MODE_REVERSE;
export const GOBLET2_FLOW_PINGPONG = GOBLET_FLOW_MODE_PINGPONG;

const clamp255 = clampGobletByte;

const mod = (value: number, divisor: number): number => {
  const remainder = value % divisor;
  return remainder < 0 ? remainder + divisor : remainder;
};

const normalizeStops = normalizeGobletGradientStops;
const sampleGradient = sampleGobletGradient;

export const decodeSpeedByte = (byte: number, speedMin: number, speedMax: number): number =>
  decodeColorCycleSpeedByte(byte, speedMin, speedMax, 0, 0);

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

const samplePaletteTable = (
  paletteTable: Goblet2PaletteTable,
  slot: number,
  position: number,
  out: Uint8ClampedArray,
  outIndex: number
): void => {
  const paletteSize = Math.max(1, paletteTable.width);
  const row = Math.max(0, Math.min(Math.max(1, paletteTable.height) - 1, slot));
  const wrapped = mod(position, paletteSize);
  const lower = Math.floor(wrapped);
  const upper = (lower + 1) % paletteSize;
  const t = wrapped - lower;
  const lowerBase = (row * paletteSize + lower) * 4;
  const upperBase = (row * paletteSize + upper) * 4;
  out[outIndex] = clamp255(paletteTable.data[lowerBase] + (paletteTable.data[upperBase] - paletteTable.data[lowerBase]) * t);
  out[outIndex + 1] = clamp255(paletteTable.data[lowerBase + 1] + (paletteTable.data[upperBase + 1] - paletteTable.data[lowerBase + 1]) * t);
  out[outIndex + 2] = clamp255(paletteTable.data[lowerBase + 2] + (paletteTable.data[upperBase + 2] - paletteTable.data[lowerBase + 2]) * t);
  out[outIndex + 3] = clamp255(paletteTable.data[lowerBase + 3] + (paletteTable.data[upperBase + 3] - paletteTable.data[lowerBase + 3]) * t);
};

export const renderBrushFrame = (params: {
  indexBuffer: Uint8Array;
  gradientIdBuffer: Uint8Array;
  speedBuffer: Uint8Array;
  flowBuffer?: Uint8Array | null;
  phaseBuffer?: Uint8Array | null;
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
    flowBuffer = null,
    phaseBuffer = null,
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
    const rawGradientId = gradientIdBuffer[i] ?? 0;
    const slot = resolveGobletPaletteRow(rawGradientId, slotCount);
    const speedByte = speedBuffer[i] ?? 0;
    const basePhase = speedByte === 0
      ? legacyOffset01
      : timeSeconds * decodeColorCycleSpeedByte(speedByte, speedMin, speedMax, 0, 0);
    const phaseByte = phaseBuffer?.[i] ?? 0;
    const phase = resolveGobletPhase01(basePhase, phaseByte);
    const flowMode = flowBuffer
      ? resolveGobletFlowMode(flowBuffer[i] ?? GOBLET2_FLOW_FORWARD)
      : resolveGobletFlowMode(rawGradientId >> 8);
    const paletteIndex = resolveGobletPaletteIndex(idx, paletteSize, true);
    const palettePosition = resolveGobletPalettePosition(paletteIndex, phase, flowMode, paletteSize);
    samplePaletteTable(paletteTable, slot, palettePosition, out, outIndex);
  }
  return out;
};
