import { TEMP_SAMPLE_SLOT } from '@/constants/colorCycle';
import type { ColorCyclePaintSnapshot } from '@/lib/colorCycle/document';
import { encodeSampledPathColors, SAMPLED_PATH_FLOW, SAMPLED_PATH_SECTION_SIZE } from '@/lib/colorCycle/sampledPathPalette';
import type { ColorCycleGradientDefStoreEntry } from '@/types';
import { allocateNextColorCycleDefId } from '@/utils/colorCycleDefIds';
import { parseCssColorToRgba } from '@/hooks/canvas/utils/colorCycleHelpers';
import type { StoredStop } from '@/utils/colorCycleGradientDefs';
import type { SampledStampPositions } from './alignSampledStroke';

export const sampleFixedPathBands = (
  points: Array<{ x: number; y: number }>,
  spacingPx: number,
  sampleColor: (x: number, y: number) => string,
): StoredStop[] => {
  if (!points.length) return [];
  const spacing = Number.isFinite(spacingPx) ? Math.max(1, Math.min(256, Math.round(spacingPx))) : 20;
  const distances = [0];
  for (let i = 1; i < points.length; i++) distances.push(distances[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  const length = distances.at(-1)!;
  const count = Math.floor(length / spacing) + 1;
  if (count > 65280) throw new Error('This sampled stroke exceeds 65,280 bands. Finish it as separate strokes.');
  const stops: StoredStop[] = [];
  let segment = 0;
  for (let band = 0; band < count; band++) {
    const distance = Math.min(length, (band + 0.5) * spacing);
    while (segment + 1 < points.length - 1 && distances[segment + 1] < distance) segment++;
    const a = points[segment], b = points[Math.min(segment + 1, points.length - 1)];
    const span = (distances[segment + 1] ?? length) - distances[segment];
    const along = distance - distances[segment];
    // Normalize direction first: dividing the distance and multiplying it back
    // can put an exact pixel centre just below its integer coordinate.
    const dx = span > 0 ? (b.x - a.x) / span : 0;
    const dy = span > 0 ? (b.y - a.y) / span : 0;
    stops.push({ position: band / Math.max(1, count - 1), color: sampleColor(a.x + dx * along, a.y + dy * along) });
  }
  return stops;
};

/** Native palette sections retain all source bands, instead of rescaling a 255-entry cycle. */
export const buildSampledPathStroke = (args: {
  snapshot: ColorCyclePaintSnapshot;
  ownership: SampledStampPositions;
  bandPx: number;
  primary: StoredStop[];
  secondary?: StoredStop[];
  definitions: ColorCycleGradientDefStoreEntry[];
  speedByte: number;
}): { snapshot: ColorCyclePaintSnapshot; definitions: ColorCycleGradientDefStoreEntry[] } => {
  const { snapshot, ownership, primary, secondary, speedByte } = args;
  const spacing = Number.isFinite(args.bandPx) ? Math.max(1, Math.min(256, Math.round(args.bandPx))) : 20;
  if (!ownership.distances || !primary.length) throw new Error('The sampled stroke source positions are missing.');
  const definitions = [...args.definitions];
  const ids: number[][] = [];
  for (const stops of secondary ? [primary, secondary] : [primary]) {
    const rgba = new Uint8Array(stops.length * 4);
    stops.forEach((stop, i) => {
      const color = parseCssColorToRgba(stop.color);
      color[3] = Math.round(color[3] * (stop.opacity ?? 1));
      rgba.set(color, i * 4);
    });
    const encoded = encodeSampledPathColors(rgba);
    const inkIds: number[] = [];
    for (let offset = 0; offset < stops.length; offset += SAMPLED_PATH_SECTION_SIZE) {
      const { id } = allocateNextColorCycleDefId({ ids: definitions.map(def => def.id) });
      if (id === null) throw new Error('No palette definitions remain for this sampled stroke.');
      const section = Array.from({ length: 256 }, (_, index) => ({
        ...stops[(offset + index) % stops.length], position: index / 255,
      }));
      definitions.push({ id, kind: 'linear', stops: section, source: 'sampled',
        sampledPath: { rgba: encoded, offset }, hash: `path:${id}:${offset}`,
        seamProfile: 'hard', createdAtMs: Date.now() });
      inkIds.push(id);
    }
    ids.push(inkIds);
  }
  const paint = new Uint8Array(snapshot.paintBuffer.slice(0));
  const gid = new Uint8Array(snapshot.gradientIdBuffer!.slice(0));
  const def = new Uint16Array(snapshot.gradientDefIdBuffer?.slice(0) ?? new ArrayBuffer(paint.length * 2));
  const flow = new Uint8Array(snapshot.flowBuffer?.slice(0) ?? new ArrayBuffer(paint.length));
  const phase = new Uint8Array(snapshot.phaseBuffer?.slice(0) ?? new ArrayBuffer(paint.length));
  const speed = new Uint8Array(snapshot.speedBuffer?.slice(0) ?? new ArrayBuffer(paint.length));
  for (let i = 0; i < paint.length; i++) {
    if (!paint[i] || gid[i] !== TEMP_SAMPLE_SLOT || (ownership.tags[i] >>> 16) !== (ownership.epoch & 65535)) continue;
    const distance = ownership.distances[ownership.tags[i] & 65535];
    if (!Number.isFinite(distance) || !ownership.primary[i]) continue;
    const band = Math.min(primary.length - 1, Math.floor(distance / spacing));
    const ink = secondary && paint[i] !== ownership.primary[i] ? 1 : 0;
    paint[i] = 1 + band % SAMPLED_PATH_SECTION_SIZE;
    def[i] = ids[ink][Math.floor(band / SAMPLED_PATH_SECTION_SIZE)];
    gid[i] = 0;
    flow[i] = SAMPLED_PATH_FLOW;
    phase[i] = 0;
    speed[i] = speedByte;
  }
  return { definitions, snapshot: { ...snapshot, paintBuffer: paint.buffer,
    gradientIdBuffer: gid.buffer, gradientDefIdBuffer: def.buffer,
    flowBuffer: flow.buffer, phaseBuffer: phase.buffer, speedBuffer: speed.buffer } };
};
