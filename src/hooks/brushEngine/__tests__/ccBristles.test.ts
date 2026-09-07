import { createCcBristleWriter, getCcBristlePhase, getCcBristleBaseIndex } from '../ccBristles';
import { clearStrokeDefIdsForStamp } from '../strokeDefClear';

it('keeps strand phases constant along a straight stroke and varies across it', () => {
  const phases = new Uint8Array(3);
  const first = createCcBristleWriter(phases, { x: 20, y: 20 }, { x: 10, y: 20 }, 24);
  first(0, 20, 16);
  const next = createCcBristleWriter(phases, { x: 40, y: 20 }, { x: 20, y: 20 }, 24);
  next(1, 40, 16);
  expect(phases[0]).toBe(phases[1]);
  expect(new Set(Array.from({ length: 24 }, (_, i) => getCcBristlePhase(i / 24 - 0.5))).size).toBeGreaterThan(10);
});

it('rotates strands with the stroke and preserves direction for stationary stamps', () => {
  const phases = new Uint8Array(3);
  createCcBristleWriter(phases, { x: 20, y: 20 }, { x: 20, y: 10 }, 24)(0, 24, 20);
  createCcBristleWriter(phases, { x: 20, y: 30 }, { x: 20, y: 20 }, 24)(1, 24, 30);
  createCcBristleWriter(phases, { x: 20, y: 30 }, { x: 20, y: 30 }, 24)(2, 24, 30);
  expect([...phases]).toEqual([phases[0], phases[0], phases[0]]);
});

it('writes only painted pixels in the stamp coverage and preserves dither bindings', () => {
  const paint = new Uint8Array(100).fill(1), gid = new Uint8Array(100).fill(2);
  const def = new Uint16Array(100).fill(7), phase = new Uint8Array(100);
  paint[55] = 0;
  clearStrokeDefIdsForStamp({ buffers: { paint, gid, def }, width: 10, height: 10,
    x: 5, y: 5, brushSize: 4, flowSlot: 2, shape: 'round', clearDefIds: false,
    onPaintPixel: (index) => { phase[index] = 42; },
  });
  expect(phase[0]).toBe(0);
  expect(phase[55]).toBe(0);
  expect(phase.some((p) => p === 42)).toBe(true);
  expect(def.every((d) => d === 7)).toBe(true);
});

it('keeps strand colour stable between stamps and reloads at the next stroke', () => {
  const phase = new Uint8Array(10);
  expect(getCcBristleBaseIndex(phase, 14, true)).toBe(14);
  expect(getCcBristleBaseIndex(phase, 70, false)).toBe(14);
  expect(getCcBristleBaseIndex(phase, 25, true)).toBe(25);
});

it('retains the nearest strand when a later stamp cap overlaps a bend', () => {
  const phase = new Uint8Array(1);
  createCcBristleWriter(phase, { x: 20, y: 20 }, { x: 10, y: 20 }, 24)(0, 15, 21);
  const expected = phase[0];
  phase[0] = 0; // The next native stamp clears phase before bristles are applied.
  createCcBristleWriter(phase, { x: 30, y: 30 }, { x: 20, y: 20 }, 24)(0, 15, 21);
  expect(phase[0]).toBe(expected);
});
