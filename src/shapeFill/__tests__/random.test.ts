import { createRng, hashPoints } from '../utils/random';
import { Vec2 } from '../types';

describe('random utilities', () => {
  it('produces deterministic sequence for same seed', () => {
    const rngA = createRng(123);
    const rngB = createRng(123);

    const sequenceA = Array.from({ length: 5 }, () => rngA());
    const sequenceB = Array.from({ length: 5 }, () => rngB());

    expect(sequenceA).toEqual(sequenceB);
  });

  it('hashes points deterministically', () => {
    const points: Vec2[] = [
      { x: 1.5, y: -2.5 },
      { x: 7.75, y: 4 },
    ];

    const hash1 = hashPoints(points);
    const hash2 = hashPoints(points);
    expect(hash1).toBe(hash2);
  });
});
