export { buildCcInkPalettes as buildSampledInkPalettes } from '@/utils/colorCycle/ccInkSpread';
import { TEMP_SAMPLE_SLOT } from '@/constants/colorCycle';
import type { ColorCyclePaintSnapshot } from '@/lib/colorCycle/document';

export type SampledStampPositions = {
  tags: Uint32Array;
  epoch: number;
  primary: Uint8Array;
  distances?: number[];
  points?: Array<{ x: number; y: number }>;
};

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
