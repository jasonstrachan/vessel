import {
  buildFreehandShape,
  buildRectangleShape,
  getCanvasBounds,
  isPointInCanvasShape,
  normalizeCanvasShape,
  resizeCanvasShape,
} from '@/utils/canvasShape';

const bounds = getCanvasBounds(100, 100);

describe('canvasShape', () => {
  it('normalizes to a rectangle when missing', () => {
    const shape = normalizeCanvasShape(null, 100, 50);
    expect(shape.kind).toBe('rectangle');
    expect(shape.bounds.width).toBe(100);
    expect(shape.bounds.height).toBe(50);
  });

  it('expands a full-canvas rectangle to resized document bounds', () => {
    const shape = resizeCanvasShape(
      buildRectangleShape({ x: 0, y: 0 }, { x: 512, y: 512 }, getCanvasBounds(512, 512)),
      512,
      512,
      1000,
      512,
    );

    expect(shape).toEqual({
      kind: 'rectangle',
      bounds: { x: 0, y: 0, width: 1000, height: 512 },
    });
  });

  it('preserves an authored rectangle when resizing document bounds', () => {
    const shape = resizeCanvasShape(
      buildRectangleShape({ x: 10, y: 12 }, { x: 80, y: 70 }, bounds),
      100,
      100,
      200,
      150,
    );

    expect(shape).toEqual({
      kind: 'rectangle',
      bounds: { x: 10, y: 12, width: 70, height: 58 },
    });
  });

  it('detects points inside a rectangle', () => {
    const shape = buildRectangleShape({ x: 10, y: 10 }, { x: 60, y: 40 }, bounds);
    expect(isPointInCanvasShape(shape, { x: 20, y: 20 })).toBe(true);
    expect(isPointInCanvasShape(shape, { x: 2, y: 2 })).toBe(false);
  });

  it('closes freehand shapes and bounds hit tests', () => {
    const shape = buildFreehandShape(
      [
        { x: 10, y: 10 },
        { x: 50, y: 10 },
        { x: 50, y: 50 },
        { x: 10, y: 50 },
      ],
      bounds
    );
    expect(shape.kind).toBe('freehand');
    if (shape.kind !== 'freehand') {
      throw new Error('Expected freehand shape');
    }
    expect(shape.points[0]).toEqual(shape.points[shape.points.length - 1]);
    expect(isPointInCanvasShape(shape, { x: 30, y: 30 })).toBe(true);
    expect(isPointInCanvasShape(shape, { x: 80, y: 80 })).toBe(false);
  });
});
