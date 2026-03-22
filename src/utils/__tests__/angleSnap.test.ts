import { snapPointToAngle, snapAngle } from '../angleSnap';

describe('angleSnap utilities', () => {
  test('snapAngle rounds to nearest 45°', () => {
    const rad = (d: number) => (d * Math.PI) / 180;
    expect(snapAngle(rad(1))).toBeCloseTo(rad(0));
    expect(snapAngle(rad(-1))).toBeCloseTo(rad(0));
    expect(snapAngle(rad(-10))).toBeCloseTo(rad(0));
    expect(snapAngle(rad(10))).toBeCloseTo(rad(0));
    expect(snapAngle(rad(23))).toBeCloseTo(rad(45));
    expect(snapAngle(rad(44))).toBeCloseTo(rad(45));
    expect(snapAngle(rad(46))).toBeCloseTo(rad(45));
    expect(snapAngle(rad(80))).toBeCloseTo(rad(90));
    expect(snapAngle(rad(89))).toBeCloseTo(rad(90));
  });

  test('snapPointToAngle preserves distance and snaps direction', () => {
    const origin = { x: 0, y: 0 };
    const p1 = { x: 10, y: 1 }; // ~5.71° -> 0°
    const snapped1 = snapPointToAngle(origin, p1, 45);
    const dist1 = Math.hypot(p1.x - origin.x, p1.y - origin.y);
    expect(Math.hypot(snapped1.x - origin.x, snapped1.y - origin.y)).toBeCloseTo(dist1);
    expect(snapped1.y).toBeCloseTo(0, 5);

    const p1Negative = { x: 10, y: -1 }; // ~-5.71° -> 0°, not -45°
    const snapped1Negative = snapPointToAngle(origin, p1Negative, 45);
    const dist1Negative = Math.hypot(p1Negative.x - origin.x, p1Negative.y - origin.y);
    expect(Math.hypot(snapped1Negative.x - origin.x, snapped1Negative.y - origin.y)).toBeCloseTo(dist1Negative);
    expect(snapped1Negative.y).toBeCloseTo(0, 5);

    const p2 = { x: 3, y: 4 }; // ~53.13° -> 45°
    const snapped2 = snapPointToAngle(origin, p2, 45);
    const dist2 = Math.hypot(3, 4);
    expect(Math.hypot(snapped2.x, snapped2.y)).toBeCloseTo(dist2);
    // Along 45°, x ≈ y
    expect(snapped2.x).toBeCloseTo(snapped2.y, 5);

    const p3 = { x: -2, y: -5 }; // ~-111.8° -> -90°
    const snapped3 = snapPointToAngle(origin, p3, 45);
    const dist3 = Math.hypot(-2, -5);
    expect(Math.hypot(snapped3.x, snapped3.y)).toBeCloseTo(dist3);
    expect(snapped3.x).toBeCloseTo(0, 5);
    expect(snapped3.y).toBeCloseTo(-dist3, 5);
  });
});
