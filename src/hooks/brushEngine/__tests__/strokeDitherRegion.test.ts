import { __TESTING__ } from '@/hooks/brushEngine/strokeDitherRegion';

describe('strokeDitherRegion', () => {
  it('promotes partially covered edge cells to full cells when pxlEdge is enabled', () => {
    const imageData = new ImageData(4, 2);
    const { data } = imageData;

    // Single painted pixel in the left 2x2 block.
    data[0] = 200;
    data[1] = 20;
    data[2] = 10;
    data[3] = 255;

    __TESTING__.promoteWholePixelCellsForDitherEdges(imageData, 2);

    // Left 2x2 block should now be fully occupied with the painted color.
    const occupiedIndices = [
      0, // (0,0)
      4, // (1,0)
      16, // (0,1)
      20, // (1,1)
    ];
    for (const idx of occupiedIndices) {
      expect(data[idx]).toBe(200);
      expect(data[idx + 1]).toBe(20);
      expect(data[idx + 2]).toBe(10);
      expect(data[idx + 3]).toBe(255);
    }

    // Right 2x2 block remains empty.
    const emptyIndices = [
      8, // (2,0)
      12, // (3,0)
      24, // (2,1)
      28, // (3,1)
    ];
    for (const idx of emptyIndices) {
      expect(data[idx + 3]).toBe(0);
    }
  });

  it('promotes each touched cell independently without color bleeding across cells', () => {
    const imageData = new ImageData(4, 2);
    const { data } = imageData;

    // Touch one pixel in each 2x2 cell with different colors.
    // Left cell: red-ish
    data[0] = 220;
    data[1] = 40;
    data[2] = 20;
    data[3] = 255;
    // Right cell: green-ish at (2,0)
    const rightIdx = (0 * 4 + 2) * 4;
    data[rightIdx] = 15;
    data[rightIdx + 1] = 200;
    data[rightIdx + 2] = 35;
    data[rightIdx + 3] = 255;

    __TESTING__.promoteWholePixelCellsForDitherEdges(imageData, 2);

    // Entire left 2x2 should match left source color.
    const leftIndices = [0, 4, 16, 20];
    for (const idx of leftIndices) {
      expect(data[idx]).toBe(220);
      expect(data[idx + 1]).toBe(40);
      expect(data[idx + 2]).toBe(20);
      expect(data[idx + 3]).toBe(255);
    }

    // Entire right 2x2 should match right source color.
    const rightIndices = [8, 12, 24, 28];
    for (const idx of rightIndices) {
      expect(data[idx]).toBe(15);
      expect(data[idx + 1]).toBe(200);
      expect(data[idx + 2]).toBe(35);
      expect(data[idx + 3]).toBe(255);
    }
  });
});
