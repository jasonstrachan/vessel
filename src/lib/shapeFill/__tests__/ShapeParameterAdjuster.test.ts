import { createVerticalSpacingMapper, ShapeParameterAdjustSequence } from '../ShapeParameterAdjuster';
import type { Vec2 } from '../types';

describe('createVerticalSpacingMapper', () => {
  const centroid: Vec2 = { x: 100, y: 200 };
  const bounds = { min: 4, max: 80, exponent: 1.05 };

  it('returns the reference value when distance matches reference distance', () => {
    const mapper = createVerticalSpacingMapper({
      centroid,
      referenceDistance: 40,
      referenceValue: 12,
      bounds,
    });

    const { value } = mapper({ x: 120, y: centroid.y + 40 });
    expect(value).toBeCloseTo(12, 5);
  });

  it('increases the value when the cursor moves further from the centroid', () => {
    const mapper = createVerticalSpacingMapper({
      centroid,
      referenceDistance: 30,
      referenceValue: 10,
      bounds,
    });

    const near = mapper({ x: centroid.x, y: centroid.y + 15 }).value;
    const far = mapper({ x: centroid.x, y: centroid.y + 60 }).value;

    expect(far).toBeGreaterThan(near);
    expect(far).toBeGreaterThan(10);
  });

  it('clamps to the minimum when the cursor is at the centroid', () => {
    const mapper = createVerticalSpacingMapper({
      centroid,
      referenceDistance: 20,
      referenceValue: 8,
      bounds,
    });

    const { value } = mapper({ x: centroid.x, y: centroid.y });
    expect(value).toBeGreaterThanOrEqual(bounds.min);
  });
});

describe('ShapeParameterAdjustSequence', () => {
  const centroid: Vec2 = { x: 0, y: 0 };
  const bounds = { min: 4, max: 40, exponent: 1.02 };

  it('updates and commits a single spacing step', () => {
    const updates: number[] = [];
    let committed = 0;
    let committedDistance = 0;

    const mapper = createVerticalSpacingMapper({
      centroid,
      referenceDistance: 10,
      referenceValue: 12,
      bounds,
    });

    const sequence = new ShapeParameterAdjustSequence([
      {
        id: 'spacing',
        mapper,
        onUpdate: (value) => {
          updates.push(value);
        },
        onCommit: (value, distance) => {
          committed = value;
          committedDistance = distance;
        },
      },
    ]);

    const pointer = { x: centroid.x, y: centroid.y + 20 };

    sequence.begin(pointer, 1);
    sequence.update({ x: centroid.x, y: centroid.y + 25 }, 1);
    const result = sequence.commit(1);

    expect(updates.length).toBeGreaterThan(0);
    expect(committed).toBeGreaterThan(12);
    expect(committedDistance).toBeGreaterThan(0);
    expect(result).toEqual({ id: 'spacing', value: committed, done: true });
  });

  it('ignores updates from other pointers', () => {
    const mapper = createVerticalSpacingMapper({
      centroid,
      referenceDistance: 15,
      referenceValue: 18,
      bounds,
    });

    const onUpdate = jest.fn();
    const commitSpy = jest.fn();

    const sequence = new ShapeParameterAdjustSequence([
      {
        id: 'spacing',
        mapper,
        onUpdate,
        onCommit: (value, distance) => {
          commitSpy(value, distance);
        },
      },
    ]);

    sequence.begin({ x: centroid.x, y: centroid.y + 15 }, 5);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    
    sequence.update({ x: centroid.x, y: centroid.y + 30 }, 2);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(commitSpy).not.toHaveBeenCalled();
  });
});
