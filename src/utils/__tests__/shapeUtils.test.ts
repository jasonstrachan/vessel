import type { ShapePoint } from '@/types';

describe('shapeUtils', () => {
  describe('createShapePath', () => {
    class MockPath2D {
      public moves: Array<{ type: 'move' | 'line' | 'close'; x?: number; y?: number }> = [];
      moveTo(x: number, y: number) {
        this.moves.push({ type: 'move', x, y });
      }
      lineTo(x: number, y: number) {
        this.moves.push({ type: 'line', x, y });
      }
      closePath() {
        this.moves.push({ type: 'close' });
      }
    }

    const originalPath2D = global.Path2D;

    beforeEach(() => {
      global.Path2D = MockPath2D as unknown as typeof Path2D;
    });

    afterEach(() => {
      global.Path2D = originalPath2D;
    });

    it('builds a closed path from points', async () => {
      const { createShapePath } = await import('../shapeUtils');
      const path = createShapePath([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
      ]);

      const mock = path as unknown as MockPath2D;
      expect(mock.moves[0]).toEqual({ type: 'move', x: 0, y: 0 });
      expect(mock.moves[1]).toEqual({ type: 'line', x: 1, y: 0 });
      expect(mock.moves[mock.moves.length - 1]).toEqual({ type: 'close' });
    });

    it('returns empty path for <2 points', async () => {
      const { createShapePath } = await import('../shapeUtils');
      const path = createShapePath([{ x: 0, y: 0 }]);
      const mock = path as unknown as MockPath2D;
      expect(mock.moves.length).toBe(0);
    });
  });

  describe('getShapeBounds', () => {
    it('computes bounding box', async () => {
      const { getShapeBounds } = await import('../shapeUtils');
      const bounds = getShapeBounds([
        { x: 1, y: 2 },
        { x: -1, y: 3 },
        { x: 2, y: -2 },
      ]);
      expect(bounds).toEqual({ x: -1, y: -2, width: 3, height: 5 });
    });

    it('returns zeros for empty points', async () => {
      const { getShapeBounds } = await import('../shapeUtils');
      expect(getShapeBounds([])).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    });
  });

  describe('renderShape pixel-perfect path', () => {
    it('fills polygon using fillRect for pixel brush', async () => {
      const { renderShape } = await import('../shapeUtils');
      const fills: Array<{ x: number; y: number }> = [];
      const ctx = {
        save: jest.fn(),
        restore: jest.fn(),
        fillStyle: '',
        imageSmoothingEnabled: true,
        fillRect: (x: number, y: number) => fills.push({ x, y }),
        fill: jest.fn(),
      } as unknown as CanvasRenderingContext2D;

      const path = {} as Path2D;
      const triangle: ShapePoint[] = [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 0, y: 2 },
      ];

      renderShape(ctx, path, '#ff0000', undefined, false, undefined, undefined, undefined, 'pixel-round' as any, false, triangle);

      expect(fills.length).toBeGreaterThan(0);
      expect(ctx.imageSmoothingEnabled).toBe(false);
    });
  });
});
