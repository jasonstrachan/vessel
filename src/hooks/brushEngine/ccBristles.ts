type Point = { x: number; y: number };
const baseIndices = new WeakMap<Uint8Array, number>();

export const getCcBristleBaseIndex = (phase: Uint8Array, index: number, startsStroke: boolean): number => {
  if (startsStroke || !baseIndices.has(phase)) baseIndices.set(phase, index);
  return baseIndices.get(phase)!;
};

const directions = new WeakMap<Uint8Array, Point>();
const strandFields = new WeakMap<Uint8Array, { distance: Float32Array; phase: Uint8Array }>();

/** Stable strand identity across the tip; no per-stamp random reseeding. */
export const getCcBristlePhase = (across: number): number => {
  const lane = Math.floor((across + 0.5) * 24);
  const hash = Math.imul(lane + 101, 1597334677) >>> 0;
  const offset = ((hash >>> 16) % 65) - 32;
  return (offset + 256) % 256;
};

export const createCcBristleWriter = (
  phase: Uint8Array,
  center: Point,
  previous: Point | null,
  size: number,
): ((index: number, x: number, y: number) => void) => {
  let field = strandFields.get(phase);
  if (!field || field.distance.length !== phase.length) {
    field = { distance: new Float32Array(phase.length).fill(Infinity), phase: new Uint8Array(phase.length) };
    strandFields.set(phase, field);
  } else if (!previous) {
    field.distance.fill(Infinity);
  }
  let dx = previous ? center.x - previous.x : 1;
  let dy = previous ? center.y - previous.y : 0;
  if (previous && Math.hypot(dx, dy) < 0.001) {
    const direction = directions.get(phase);
    dx = direction?.x ?? 1;
    dy = direction?.y ?? 0;
  }
  const length = Math.hypot(dx, dy) || 1;
  directions.set(phase, { x: dx / length, y: dy / length });
  return (index, x, y) => {
    const across = ((x + 0.5 - center.x) * -dy + (y + 0.5 - center.y) * dx)
      / (length * Math.max(1, size));
    const start = previous ?? center;
    const sx = center.x - start.x, sy = center.y - start.y;
    const lengthSq = sx * sx + sy * sy;
    const t = lengthSq > 0 ? Math.max(0, Math.min(1,
      ((x + 0.5 - start.x) * sx + (y + 0.5 - start.y) * sy) / lengthSq)) : 0;
    const distance = (x + 0.5 - start.x - t * sx) ** 2 + (y + 0.5 - start.y - t * sy) ** 2;
    // Overlapping stamp caps must not overwrite a strand closer to the path.
    // Native stamp writes reset phase, so restore the retained value as well.
    if (distance <= field.distance[index] + 0.0001) {
      field.distance[index] = distance;
      field.phase[index] = getCcBristlePhase(Math.sign(across) * Math.sqrt(distance) / Math.max(1, size));
    }
    phase[index] = field.phase[index];
  };
};
