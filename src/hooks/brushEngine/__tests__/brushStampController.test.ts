import {
  createPixelCircleStamp,
  createPixelSquareStamp,
  getPatternTempContext,
  getRotationTempContext,
} from '../brushStampController';

describe('brushStampController', () => {
  it('reuses and resizes pattern temp canvas', () => {
    const patternTempCanvasRef = { current: null as HTMLCanvasElement | null };

    getPatternTempContext({ width: 32, height: 24, patternTempCanvasRef });
    expect(patternTempCanvasRef.current).not.toBeNull();
    expect(patternTempCanvasRef.current?.width).toBe(32);
    expect(patternTempCanvasRef.current?.height).toBe(24);

    const firstCanvas = patternTempCanvasRef.current;
    getPatternTempContext({ width: 32, height: 24, patternTempCanvasRef });
    expect(patternTempCanvasRef.current).toBe(firstCanvas);

    getPatternTempContext({ width: 48, height: 40, patternTempCanvasRef });
    expect(patternTempCanvasRef.current).toBe(firstCanvas);
    expect(patternTempCanvasRef.current?.width).toBe(48);
    expect(patternTempCanvasRef.current?.height).toBe(40);
  });

  it('reuses and resizes rotation temp canvas', () => {
    const rotationTempCanvasRef = { current: null as HTMLCanvasElement | null };

    getRotationTempContext({ width: 16, height: 16, rotationTempCanvasRef });
    const firstCanvas = rotationTempCanvasRef.current;
    expect(firstCanvas).not.toBeNull();
    expect(firstCanvas?.width).toBe(16);
    expect(firstCanvas?.height).toBe(16);

    getRotationTempContext({ width: 24, height: 20, rotationTempCanvasRef });
    expect(rotationTempCanvasRef.current).toBe(firstCanvas);
    expect(rotationTempCanvasRef.current?.width).toBe(24);
    expect(rotationTempCanvasRef.current?.height).toBe(20);
  });

  it('caches pixel square and circle stamps by size', () => {
    const brushStampCache = new Map<string, HTMLCanvasElement>();

    const squareA = createPixelSquareStamp({ size: 5, brushStampCache });
    const squareB = createPixelSquareStamp({ size: 5, brushStampCache });
    expect(squareA).toBe(squareB);

    const circleA = createPixelCircleStamp({ size: 9, brushStampCache });
    const circleB = createPixelCircleStamp({ size: 9, brushStampCache });
    expect(circleA).toBe(circleB);

    expect(brushStampCache.has('pixel_square_5')).toBe(true);
    expect(brushStampCache.has('pixel_circle_9')).toBe(true);
  });
});

