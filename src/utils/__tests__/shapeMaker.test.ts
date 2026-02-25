import { appendSegmentWithDynamicResampling, ensurePolygonFromDrag } from '../shapeMaker';

describe('shapeMaker helpers', () => {
  describe('ensurePolygonFromDrag', () => {
    it('returns existing polygon when already valid', () => {
      const existing = [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ];

      const result = ensurePolygonFromDrag({
        existingPoints: existing,
        start: { x: 0, y: 0 },
        end: { x: 10, y: 10 },
        zoom: 1,
        brushSize: 12,
      });

      expect(result).not.toBeNull();
      expect(result).toEqual(existing);
    });

    it('returns a polygon when only minimal drag data exists', () => {
      const existing = [{ x: 0, y: 0 }];
      const result = ensurePolygonFromDrag({
        existingPoints: existing,
        start: { x: 0, y: 0 },
        end: { x: 10, y: 0 },
        zoom: 1,
        brushSize: 8,
      });

      expect(result).not.toBeNull();
      if (!result) {
        throw new Error('Expected polygon result');
      }
      expect(result.length).toBeGreaterThanOrEqual(3);
      expect(result[result.length - 1]).toEqual({ x: 10, y: 0 });
    });

    it('returns null when start or end is missing', () => {
      expect(
        ensurePolygonFromDrag({
          existingPoints: [],
          start: null,
          end: null,
          zoom: 1,
          brushSize: 8,
        })
      ).toBeNull();
    });
  });

  describe('appendSegmentWithDynamicResampling', () => {
    it('appends intermediate points based on spacing rules', () => {
      const points = [{ x: 0, y: 0 }];
      const added = appendSegmentWithDynamicResampling(points, { x: 5, y: 0 }, 1, 10);
      expect(added).toBeGreaterThan(0);
      expect(points[points.length - 1]).toEqual({ x: 5, y: 0 });
    });
  });
});
