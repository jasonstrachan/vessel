import { computeBoundingBox, ensureFloat32Vertices, prepareStrokeGeometry } from '../tileManager';
import type { FieldGeneratorConfig, TileDescriptor } from '../types';

describe('tileManager helpers', () => {
  describe('ensureFloat32Vertices', () => {
    it('snaps vertices when pixelMode is true', () => {
      const vertices = [
        { x: 10.2, y: 4.7 },
        { x: 40.8, y: 7.1 },
        { x: 17.5, y: 29.9 },
      ] as const;
      const result = ensureFloat32Vertices(vertices, true);
      expect(Array.from(result)).toEqual([10, 5, 41, 7, 18, 30]);
    });

    it('preserves decimals when pixelMode is false', () => {
      const vertices = new Float32Array([0.25, 0.75, 15.5, 1.25, 3.125, 9.875]);
      const result = ensureFloat32Vertices(vertices, false);
      expect(result).toBe(vertices); // returns the original buffer when no snapping is required
    });
  });

  describe('computeBoundingBox', () => {
    it('computes min/max extents from flat float array', () => {
      const vertices = new Float32Array([0, 0, 10, -5, 20, 30]);
      const bounds = computeBoundingBox(vertices);
      expect(bounds).toEqual({ minX: 0, minY: -5, maxX: 20, maxY: 30 });
    });
  });

  describe('prepareStrokeGeometry', () => {
    const baseJob = {
      id: 'test',
      vertices: [
        { x: 0, y: 0 },
        { x: 512, y: 0 },
        { x: 512, y: 512 },
        { x: 0, y: 512 },
      ],
    } as const;

    it('produces a single tile when bounds fit within a tile plus margin', () => {
      const config: FieldGeneratorConfig = { tileSize: 1024, overlap: 64, margin: 32, defaultResolution: 1 };
      const geometry = prepareStrokeGeometry(baseJob, config);
      expect(geometry.tiles).toHaveLength(1);
      const tile = geometry.tiles[0];
      expect(tile.origin.x).toBeCloseTo(-96); // margin (32) + overlap (64)
      expect(tile.origin.y).toBeCloseTo(-96);
      expect(tile.gridWidth).toBe(Math.ceil(1024 / 1));
    });

    it('creates multiple tiles for wide geometry', () => {
      const wideJob = {
        ...baseJob,
        vertices: [
          { x: 0, y: 0 },
          { x: 2048, y: 0 },
          { x: 2048, y: 256 },
          { x: 0, y: 256 },
        ],
      } as const;
      const config: FieldGeneratorConfig = { tileSize: 1024, overlap: 64, margin: 32, defaultResolution: 1 };
      const geometry = prepareStrokeGeometry(wideJob, config);
      expect(geometry.tiles.length).toBeGreaterThan(1);
      const origins = geometry.tiles.map(tile => tile.origin.x);
      expect(new Set(origins).size).toBeGreaterThan(1);

      const sortedByOrder = [...geometry.tiles].sort((a, b) => a.order - b.order);
      expect(sortedByOrder[0].origin.x + sortedByOrder[0].size.x * 0.5).toBeGreaterThan(0);
    });

    it('orders tiles by proximity to centroid (breadth-first)', () => {
      const tallJob = {
        ...baseJob,
        vertices: [
          { x: 0, y: 0 },
          { x: 512, y: 0 },
          { x: 512, y: 2048 },
          { x: 0, y: 2048 },
        ],
      } as const;
      const config: FieldGeneratorConfig = { tileSize: 1024, overlap: 64, margin: 32, defaultResolution: 1 };
      const geometry = prepareStrokeGeometry(tallJob, config);
      expect(geometry.tiles.length).toBeGreaterThan(1);

      const ordered: TileDescriptor[] = [...geometry.tiles].sort((a, b) => a.order - b.order);
      const first = ordered[0];
      const last = ordered[ordered.length - 1];

      const centroidY = (geometry.bounds.minY + geometry.bounds.maxY) * 0.5;
      const firstCenterY = first.origin.y + first.size.y * 0.5;
      const lastCenterY = last.origin.y + last.size.y * 0.5;

      expect(Math.abs(firstCenterY - centroidY)).toBeLessThan(Math.abs(lastCenterY - centroidY));
    });
  });
});
