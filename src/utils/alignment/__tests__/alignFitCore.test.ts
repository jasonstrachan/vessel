import { computePlacement } from '@/utils/alignment/alignFitCore';

describe('computePlacement', () => {
  it('positions auto contain content within the leftover frame space', () => {
    const placement = computePlacement({
      surface: { width: 80, height: 60 },
      painted: { width: 20, height: 10 },
      frame: { x: 0, y: 0, width: 80, height: 60 },
      design: { width: 80, height: 60 },
      doc: { width: 80, height: 60 },
      align: {
        fit: 'contain',
        positioning: 'auto',
        offsetPercent: { x: 25, y: 50 },
      },
    });

    expect(placement.dest).toEqual({
      x: 15,
      y: 25,
      width: 20,
      height: 10,
    });
  });

  it('keeps auto fill content at the frame origin', () => {
    const placement = computePlacement({
      surface: { width: 80, height: 60 },
      painted: { width: 20, height: 10 },
      frame: { x: 4, y: 6, width: 80, height: 60 },
      doc: { width: 80, height: 60 },
      align: {
        fit: 'fill',
        positioning: 'auto',
        offsetPercent: { x: 50, y: 50 },
      },
    });

    expect(placement.dest).toEqual({
      x: 4,
      y: 6,
      width: 80,
      height: 60,
    });
  });
});
