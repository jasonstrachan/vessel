describe('selectionMaskContourPath', () => {
  class MockPath2D {
    public moves: Array<{ type: 'move' | 'line'; x: number; y: number }> = [];

    moveTo(x: number, y: number) {
      this.moves.push({ type: 'move', x, y });
    }

    lineTo(x: number, y: number) {
      this.moves.push({ type: 'line', x, y });
    }
  }

  const originalPath2D = global.Path2D;

  beforeEach(() => {
    global.Path2D = MockPath2D as unknown as typeof Path2D;
  });

  afterEach(() => {
    global.Path2D = originalPath2D;
  });

  const createMask = (width: number, height: number, filled: Array<[number, number]>): ImageData => {
    const data = new Uint8ClampedArray(width * height * 4);
    for (const [x, y] of filled) {
      const idx = (y * width + x) * 4;
      data[idx + 3] = 255;
    }
    return new ImageData(data, width, height);
  };

  it('builds a closed contour loop for a single filled pixel', async () => {
    const { createSelectionMaskContourPath } = await import('../selectionMaskContourPath');
    const mask = createMask(2, 2, [[0, 0]]);
    const path = createSelectionMaskContourPath(mask) as unknown as MockPath2D;

    expect(path.moves[0]).toEqual({ type: 'move', x: 0, y: 1 });
    expect(path.moves[path.moves.length - 1]).toEqual({ type: 'line', x: 0, y: 1 });
  });

  it('reuses cached contour path for the same mask instance', async () => {
    const { getSelectionMaskContourPath } = await import('../selectionMaskContourPath');
    const mask = createMask(3, 3, [[1, 1]]);

    const first = getSelectionMaskContourPath(mask);
    const second = getSelectionMaskContourPath(mask);

    expect(second).toBe(first);
  });
});
