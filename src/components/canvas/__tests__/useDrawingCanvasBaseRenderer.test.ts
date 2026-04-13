import {
  createTileableNoiseGrid,
  getNextFilterWorkCanvas,
  getSeamlessNoisePatternSize,
} from '@/lib/displayFilterPipeline';

describe('getNextFilterWorkCanvas', () => {
  it('alternates away from the canvas that just became current', () => {
    const sourceCanvas = document.createElement('canvas');
    const workCanvasA = document.createElement('canvas');
    const workCanvasB = document.createElement('canvas');

    expect(getNextFilterWorkCanvas(workCanvasA, workCanvasA, workCanvasB)).toBe(workCanvasB);
    expect(getNextFilterWorkCanvas(workCanvasB, workCanvasA, workCanvasB)).toBe(workCanvasA);

    // The first pass starts from the source canvas and writes into work A.
    // The second pass must target work B, not clear work A in place.
    let currentCanvas = sourceCanvas;
    currentCanvas = workCanvasA;
    const nextCanvas = getNextFilterWorkCanvas(currentCanvas, workCanvasA, workCanvasB);
    expect(nextCanvas).toBe(workCanvasB);
  });
});

describe('getSeamlessNoisePatternSize', () => {
  it('always returns a pattern size that tiles cleanly for the requested noise step', () => {
    expect(getSeamlessNoisePatternSize(3) % 3).toBe(0);
    expect(getSeamlessNoisePatternSize(7) % 7).toBe(0);
    expect(getSeamlessNoisePatternSize(19) % 19).toBe(0);
  });

  it('keeps the pattern at a practical size while staying aligned to the tile step', () => {
    expect(getSeamlessNoisePatternSize(1)).toBe(128);
    expect(getSeamlessNoisePatternSize(8)).toBe(256);
    expect(getSeamlessNoisePatternSize(32)).toBe(256);
  });
});

describe('createTileableNoiseGrid', () => {
  it('wraps opposite edges so repeated noise tiles do not show a boundary seam', () => {
    const grid = createTileableNoiseGrid(6, 5, 3);

    for (let y = 0; y < grid.length; y += 1) {
      expect(grid[y][grid[y].length - 1]).toBe(grid[y][0]);
    }

    for (let x = 0; x < grid[0].length; x += 1) {
      expect(grid[grid.length - 1][x]).toBe(grid[0][x]);
    }
  });
});
