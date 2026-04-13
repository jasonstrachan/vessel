import { getNextFilterWorkCanvas } from '@/components/canvas/useDrawingCanvasBaseRenderer';

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
