import { OKLabConverter } from '@/lib/colorCycle/colorSpace/OKLabConverter';
import { TEMP_SAMPLE_SLOT } from '@/constants/colorCycle';
import type { ColorCyclePaintSnapshot } from '@/lib/colorCycle/document';
import { parseCssColorToRgba } from '@/hooks/canvas/utils/colorCycleHelpers';
import type { StoredStop } from '@/utils/colorCycleGradientDefs';

export type SampledStampPositions = {
  tags: Uint32Array;
  epoch: number;
  primary: Uint8Array;
  distances?: number[];
};

const toLinear = (byte: number): number => {
  const value = byte / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
};
const toByte = (linear: number): number => Math.round(255 * (
  linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055
));

/** Measure visible ink area after dither finalization, excluding other strokes. */
export const measureSampledInkCoverage = (
  paint: Uint8Array,
  gids: Uint8Array,
  ownership: Pick<SampledStampPositions, 'tags' | 'primary' | 'epoch'>,
): number => {
  let primary = 0;
  let total = 0;
  for (let i = 0; i < paint.length; i++) {
    if (!paint[i] || gids[i] !== TEMP_SAMPLE_SLOT ||
        (ownership.tags[i] >>> 16) !== (ownership.epoch & 0xffff) || !ownership.primary[i]) continue;
    total++;
    if (paint[i] === ownership.primary[i]) primary++;
  }
  return total ? primary / total : 0.5;
};

/** Separate inks while preserving their area-weighted linear-light mixture. */
export const buildSampledInkPalettes = (stops: StoredStop[], spread = 0, primaryCoverage = 0.5): {
  primary: StoredStop[];
  secondary: StoredStop[];
} => {
  const amount = Number.isFinite(spread) ? Math.max(0, Math.min(100, spread)) / 100 : 0;
  const coverage = Number.isFinite(primaryCoverage) ? Math.max(0, Math.min(1, primaryCoverage)) : 0.5;
  const primary: StoredStop[] = [];
  const secondary: StoredStop[] = [];
  for (const stop of stops) {
    if (amount === 0 || coverage === 0 || coverage === 1) {
      primary.push({ ...stop });
      secondary.push({ ...stop });
      continue;
    }
    const [r, g, b, alpha] = parseCssColorToRgba(stop.color);
    const lab = OKLabConverter.rgbToOKLab({ r, g, b });
    const chroma = Math.hypot(lab.a, lab.b);
    const weight = chroma * chroma / (chroma * chroma + 0.06 ** 2);
    const mean = (r + g + b) / 3;
    const axis = [mean - r, mean - g, mean - b];
    const magnitude = Math.max(...axis.map(Math.abs));
    const directions = axis.map((component, channel) =>
      (channel === 2 ? 1 : -1) * (1 - weight) +
      (magnitude > 0 ? component / magnitude : 0) * weight,
    );
    // Hue adaptation chooses the direction, not the strength of the control.
    // Blended axes can partially cancel; normalize before applying Spread so
    // 100 still reaches the available gamut boundary for interior colours.
    const directionMagnitude = Math.max(...directions.map(Math.abs));
    const a: number[] = [];
    const other: number[] = [];
    for (const [channel, byte] of [r, g, b].entries()) {
      const target = toLinear(byte);
      // Move smoothly from neutral cool/warm inks to an opposing axis suited
      // to the target hue. No hue-angle seam or near-grey threshold can flip it.
      const direction = directions[channel] / directionMagnitude;
      const distance = direction > 0
        ? Math.min((1 - target) / (1 - coverage), target / coverage)
        : Math.min(target / (1 - coverage), (1 - target) / coverage);
      const delta = direction * distance * amount;
      a.push(toByte(Math.max(0, Math.min(1, target + (1 - coverage) * delta))));
      other.push(toByte(Math.max(0, Math.min(1, target - coverage * delta))));
    }
    const ink = (rgb: number[]): StoredStop => ({
      ...stop, color: `rgba(${rgb.join(', ')}, ${alpha / 255})`,
    });
    primary.push(ink(a));
    secondary.push(ink(other));
  }
  return { primary, secondary };
};

/** Rebind only this stroke's pixels. Ownership keeps overlapping stamps and self-crossings intact. */
export const alignSampledStampPositions = (
  snapshot: ColorCyclePaintSnapshot,
  ownership: SampledStampPositions,
  secondary?: { slot: number; defId: number },
  speedByte?: number,
  preservePhase = false,
  previewSourceIndices?: Uint8Array,
): ColorCyclePaintSnapshot => {
  const paint = new Uint8Array(snapshot.paintBuffer.slice(0));
  const gids = new Uint8Array(snapshot.gradientIdBuffer!.slice(0));
  const defs = snapshot.gradientDefIdBuffer
    ? new Uint16Array(snapshot.gradientDefIdBuffer.slice(0)) : new Uint16Array(paint.length);
  const phases = snapshot.phaseBuffer
    ? new Uint8Array(snapshot.phaseBuffer.slice(0)) : new Uint8Array(paint.length);
  const flows = snapshot.flowBuffer
    ? new Uint8Array(snapshot.flowBuffer.slice(0)) : new Uint8Array(paint.length);
  const speeds = snapshot.speedBuffer
    ? new Uint8Array(snapshot.speedBuffer.slice(0)) : new Uint8Array(paint.length);
  for (let i = 0; i < paint.length; i++) {
    if (!paint[i] || gids[i] !== TEMP_SAMPLE_SLOT || (ownership.tags[i] >>> 16) !== (ownership.epoch & 0xffff)) continue;
    const index = previewSourceIndices?.[ownership.tags[i] & 65535] ?? ownership.primary[i];
    if (!index) continue;
    const isSecondary = ownership.primary[i] !== paint[i];
    paint[i] = index;
    // Keep distance-authored bands for both inks. Normalizing by total stroke
    // length would stretch the gradient during preview and again on release.
    if (speedByte !== undefined) {
      // Bristles use this phase for strand identity; both inks retain it.
      if (!preservePhase) phases[i] = 0;
      flows[i] = 1;
    }
    if (speedByte !== undefined) speeds[i] = speedByte;
    if (secondary && isSecondary) {
      gids[i] = secondary.slot;
      defs[i] = secondary.defId;
    }
  }
  return { ...snapshot, paintBuffer: paint.buffer, gradientIdBuffer: gids.buffer,
    gradientDefIdBuffer: defs.buffer, phaseBuffer: phases.buffer, flowBuffer: flows.buffer, speedBuffer: speeds.buffer };
};
