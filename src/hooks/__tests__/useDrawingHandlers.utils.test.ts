import { dedupePolylineForSampling, computePolylineLength } from '@/hooks/useDrawingHandlers';

describe('useDrawingHandlers utilities', () => {
  describe('dedupePolylineForSampling', () => {
    it('returns empty array for no points', () => {
      expect(dedupePolylineForSampling([])).toEqual([]);
    });

    it('drops points closer than epsilon while keeping order', () => {
      const pts = [
        { x: 0, y: 0 },
        { x: 0.1, y: 0.1 }, // within default eps 0.25
        { x: 1, y: 0 },
        { x: 1.1, y: 0.05 },
      ];
      const result = dedupePolylineForSampling(pts);
      expect(result).toEqual([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ]);
    });

    it('keeps close points when epsilon is tighter', () => {
      const pts = [
        { x: 0, y: 0 },
        { x: 0.1, y: 0.1 },
      ];
      const result = dedupePolylineForSampling(pts, 0.05);
      expect(result).toHaveLength(2);
    });
  });

  describe('computePolylineLength', () => {
    it('returns 0 for fewer than two points', () => {
      expect(computePolylineLength([])).toBe(0);
      expect(computePolylineLength([{ x: 1, y: 1 }])).toBe(0);
    });

    it('sums segment lengths', () => {
      const pts = [
        { x: 0, y: 0 },
        { x: 3, y: 4 }, // length 5
        { x: 3, y: 8 }, // length 4
      ];
      expect(computePolylineLength(pts)).toBeCloseTo(9);
    });
  });
});
