import { createCcBristleWriter, getCcBristlePhase, getCcBristleBaseIndex } from '../ccBristles';
import { clearStrokeDefIdsForStamp } from '../strokeDefClear';

it('keeps one-pixel strands stable as the brush grows and adds variation at its edges', () => {
  const crossSection = (size: number) => {
    const phases = new Uint8Array(size);
    const write = createCcBristleWriter(phases, { x: 100, y: 100 }, { x: 90, y: 100 }, 1, 100);
    for (let i = 0; i < size; i += 1) write(i, 100, 100 - size / 2 + i);
    return Array.from(phases);
  };
  const small = crossSection(24);
  const large = crossSection(48);
  expect(large.slice(12, 36)).toEqual(small);
  const strandCount = (values: number[]) => values.filter((value, i) => i === 0 || value !== values[i - 1]).length;
  expect(strandCount(small)).toBe(24);
  expect(strandCount(large)).toBe(48);
});

it('changes strand identity at half-pixel boundaries', () => {
  expect(getCcBristlePhase(0.01, 0.5, 100)).toBe(getCcBristlePhase(0.49, 0.5, 100));
  expect(getCcBristlePhase(0.49, 0.5, 100)).not.toBe(getCcBristlePhase(0.51, 0.5, 100));
  expect(getCcBristlePhase(0.51, 0.5, 100)).toBe(getCcBristlePhase(0.99, 0.5, 100));
  expect(getCcBristlePhase(-0.49, 0.5, 100)).toBe(getCcBristlePhase(-0.01, 0.5, 100));
  expect(getCcBristlePhase(-0.51, 0.5, 100)).not.toBe(getCcBristlePhase(-0.49, 0.5, 100));
});

it('keeps strand phases constant along a straight stroke and varies across it', () => {
  const phases = new Uint8Array(3);
  const first = createCcBristleWriter(phases, { x: 20, y: 20 }, { x: 10, y: 20 });
  first(0, 20, 16);
  const next = createCcBristleWriter(phases, { x: 40, y: 20 }, { x: 20, y: 20 });
  next(1, 40, 16);
  expect(phases[0]).toBe(phases[1]);
  expect(new Set(Array.from({ length: 24 }, (_, i) => getCcBristlePhase(i * 2 - 24))).size).toBeGreaterThan(10);
});

it('rotates strands with the stroke and preserves direction for stationary stamps', () => {
  const phases = new Uint8Array(3);
  createCcBristleWriter(phases, { x: 20, y: 20 }, { x: 20, y: 10 })(0, 24, 20);
  createCcBristleWriter(phases, { x: 20, y: 30 }, { x: 20, y: 20 })(1, 24, 30);
  createCcBristleWriter(phases, { x: 20, y: 30 }, { x: 20, y: 30 })(2, 24, 30);
  expect([...phases]).toEqual([phases[0], phases[0], phases[0]]);
});

it.each(['horizontal', 'vertical'] as const)('keeps %s strands straight through both stroke caps', (direction) => {
  const phases = new Uint8Array(5);
  const previous = direction === 'horizontal' ? { x: 10, y: 20 } : { x: 20, y: 10 };
  const write = createCcBristleWriter(phases, { x: 20, y: 20 }, previous);
  [6, 10, 15, 20, 24].forEach((along, index) => {
    write(index, direction === 'horizontal' ? along : 22, direction === 'horizontal' ? 22 : along);
  });
  expect(new Set(phases).size).toBe(1);
});

it('keeps strands straight across the initial stationary stamp', () => {
  const phases = new Uint8Array(3);
  const write = createCcBristleWriter(phases, { x: 20, y: 20 }, null);
  [16, 20, 24].forEach((x, index) => write(index, x, 22));
  expect(new Set(phases).size).toBe(1);
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
  createCcBristleWriter(phase, { x: 20, y: 20 }, { x: 10, y: 20 })(0, 15, 21);
  const expected = phase[0];
  phase[0] = 0; // The next native stamp clears phase before bristles are applied.
  createCcBristleWriter(phase, { x: 30, y: 30 }, { x: 20, y: 20 })(0, 15, 21);
  expect(phase[0]).toBe(expected);
});

it('uses the configured strand width without rounding it to whole pixels', () => {
  for (const width of [0.5, 1, 1.5, 4, 8]) {
    const phases = new Uint8Array(3);
    const write = createCcBristleWriter(phases, { x: 20, y: 20 }, { x: 10, y: 20 }, width, 100);
    [0.1, width - 0.1, width + 0.1].forEach((across, i) => write(i, 15, 19.5 + across));
    expect(phases[0]).toBe(phases[1]);
    expect(phases[1]).not.toBe(phases[2]);
  }
});


it('reduces signed colour variation without moving strand boundaries, with the original look at 100%', () => {
  const signed = (phase: number) => phase > 127 ? phase - 256 : phase;
  for (const width of [0.5, 0.6, 1, 4]) {
    for (let lane = -32; lane < 32; lane++) {
      const across = (lane + 0.25) * width;
      const hash = Math.imul(lane + 101, 1597334677) >>> 0;
      const original = ((hash >>> 16) % 65) - 32;
      expect(signed(getCcBristlePhase(across, width, 100))).toBe(original);
      expect(signed(getCcBristlePhase(across, width))).toBe(Math.sign(original) * Math.round(Math.abs(original) * 0.25) || 0);
      expect(getCcBristlePhase(across, width, 0)).toBe(0);
      expect(getCcBristlePhase(across, width, 25)).toBe(getCcBristlePhase((lane + 0.75) * width, width, 25));
    }
  }
});

it('clamps invalid strength and writes matching phases for both ink pixels on a strand', () => {
  const phases = new Uint8Array(2);
  createCcBristleWriter(phases, { x: 20, y: 20 }, { x: 10, y: 20 }, 0.6, 12)(0, 14, 21);
  createCcBristleWriter(phases, { x: 20, y: 20 }, { x: 10, y: 20 }, 0.6, 12)(1, 16, 21);
  expect(phases[0]).toBe(phases[1]);
  expect(getCcBristlePhase(2, 1, -1)).toBe(0);
  expect(getCcBristlePhase(2, 1, 200)).toBe(getCcBristlePhase(2, 1, 100));
  expect(getCcBristlePhase(2, 1, NaN)).toBe(getCcBristlePhase(2, 1, 25));
});


it('keeps equal opposite strand offsets balanced at reduced strengths', () => {
  const byOffset = new Map<number, number>();
  for (let lane = -512; lane <= 512; lane++) {
    const raw = ((Math.imul(lane + 101, 1597334677) >>> 16) % 65) - 32;
    byOffset.set(raw, lane + 0.25);
  }
  const signed = (value: number) => value > 127 ? value - 256 : value;
  for (const strength of [25, 50, 75]) {
    for (let offset = 1; offset <= 32; offset++) {
      const positive = signed(getCcBristlePhase(byOffset.get(offset)!, 1, strength));
      const negative = signed(getCcBristlePhase(byOffset.get(-offset)!, 1, strength));
      expect(positive + negative).toBe(0);
    }
  }
});
