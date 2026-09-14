import { TEMP_SAMPLE_SLOT } from '@/constants/colorCycle';
import type { ColorCyclePaintSnapshot } from '@/lib/colorCycle/document';
import { parseCssColorToRgba } from '@/hooks/canvas/utils/colorCycleHelpers';
import type { StoredStop } from '@/utils/colorCycleGradientDefs';
import { OKLabConverter, type OKLabColor } from '@/lib/colorCycle/colorSpace/OKLabConverter';

export type SampledStampPositions = {
  tags: Uint32Array;
  epoch: number;
  distances: number[];
  primary: Uint8Array;
};

const saturatedInk = (L: number, hue: number): OKLabColor => {
  let low = 0;
  let high = 0.4;
  const atChroma = (chroma: number): OKLabColor => ({
    L, a: Math.cos(hue) * chroma, b: Math.sin(hue) * chroma,
  });
  // Find the displayable chroma boundary. A clipped conversion no longer
  // round-trips to the requested perceptual colour (allowing 8-bit rounding).
  for (let step = 0; step < 12; step++) {
    const mid = (low + high) / 2;
    const requested = atChroma(mid);
    const actual = OKLabConverter.rgbToOKLab(OKLabConverter.oklabToRGB(requested));
    if (Math.hypot(actual.L - L, actual.a - requested.a, actual.b - requested.b) < 0.003) low = mid;
    else high = mid;
  }
  return atChroma(low);
};

/** Separate local inks in perceptual space, preserving sample positions and alpha. */
export const buildSampledInkPalettes = (stops: StoredStop[], spread = 0): {
  primary: StoredStop[];
  secondary: StoredStop[];
} => {
  const amount = Number.isFinite(spread) ? Math.max(0, Math.min(100, spread)) / 100 : 0;
  const primary: StoredStop[] = [];
  const secondary: StoredStop[] = [];
  for (const stop of stops) {
    if (amount === 0) {
      primary.push({ ...stop });
      secondary.push({ ...stop });
      continue;
    }
    const [r, g, b, alpha] = parseCssColorToRgba(stop.color);
    const base = OKLabConverter.rgbToOKLab({ r, g, b });
    // Neutral samples use a stable blue/yellow axis rather than losing colour.
    const hue = Math.hypot(base.a, base.b) < 0.015 ? -Math.PI / 2 : Math.atan2(base.b, base.a);
    const dark = saturatedInk(0.35, hue);
    const light = saturatedInk(0.8, hue + Math.PI);
    const interpolate = (target: OKLabColor): StoredStop => {
      const rgb = OKLabConverter.oklabToRGB({
        L: base.L + (target.L - base.L) * amount,
        a: base.a + (target.a - base.a) * amount,
        b: base.b + (target.b - base.b) * amount,
      });
      return { ...stop, color: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha / 255})` };
    };
    primary.push(interpolate(dark));
    secondary.push(interpolate(light));
  }
  return { primary, secondary };
};

/** Rebind only this stroke's pixels. Ownership keeps overlapping stamps and self-crossings intact. */
export const alignSampledStampPositions = (
  snapshot: ColorCyclePaintSnapshot,
  ownership: SampledStampPositions,
  bandPx: number,
  secondary?: { slot: number; defId: number },
  speedByte?: number,
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
  const total = ownership.distances.at(-1) ?? 0;
  const spacing = Number.isFinite(bandPx) ? Math.max(1, Math.min(256, Math.round(bandPx))) : 20;
  const indices = ownership.distances.map((distance) => {
    const grouped = Math.min(total, (Math.floor(distance / spacing) + 0.5) * spacing);
    return 1 + Math.round(total > 0 ? grouped / total * 254 : 0);
  });
  for (let i = 0; i < paint.length; i++) {
    if (!paint[i] || gids[i] !== TEMP_SAMPLE_SLOT || (ownership.tags[i] >>> 16) !== (ownership.epoch & 0xffff)) continue;
    const index = indices[ownership.tags[i] & 0xffff];
    if (index === undefined) continue;
    const isSecondary = ownership.primary[i] !== paint[i];
    paint[i] = index;
    phases[i] = 0;
    flows[i] = 1;
    if (speedByte !== undefined) speeds[i] = speedByte;
    if (secondary && isSecondary) {
      gids[i] = secondary.slot;
      defs[i] = secondary.defId;
    }
  }
  return { ...snapshot, paintBuffer: paint.buffer, gradientIdBuffer: gids.buffer,
    gradientDefIdBuffer: defs.buffer, phaseBuffer: phases.buffer, flowBuffer: flows.buffer, speedBuffer: speeds.buffer };
};
