const setIndexSpy = jest.fn();
const paintSquareSpy = jest.fn();
const paintTriangleSpy = jest.fn();
const setFlowDirectionSpy = jest.fn();

jest.mock('../../../lib/ColorCycleAnimator', () => {
  return {
    ColorCycleAnimator: class {
      private width: number;
      private height: number;

      constructor({ width, height }: { width: number; height: number }) {
        this.width = width;
        this.height = height;
      }

      setGradient() {}
      resize() {}
      paintSquare(
        _x: number,
        _y: number,
        _brushSize: number,
        colorIndex?: number,
        _maskTile?: Uint8Array,
        _tileSize?: number
      ) {
        paintSquareSpy(colorIndex);
      }
      paintTriangle(
        _x: number,
        _y: number,
        _brushSize: number,
        colorIndex?: number,
        _maskTile?: Uint8Array,
        _tileSize?: number
      ) {
        paintTriangleSpy(colorIndex);
      }
      paint() {}
      paintLine() {}
      forceRender() {}
      drawTo() {}
      setFPS() {}
      setSpeed() {}
      start() {}
      onFrame() {}
      getCanvas() {
        const canvas = document.createElement('canvas');
        canvas.width = this.width;
        canvas.height = this.height;
        return canvas;
      }
      setFlowMode(mode: 'forward' | 'reverse' | 'pingpong') {
        setFlowDirectionSpy(mode);
      }
      setFlowDirection(direction: 'forward' | 'backward') {
        setFlowDirectionSpy(direction);
      }
      setIndex(x: number, y: number, colorIndex: number) {
        setIndexSpy({ x, y, colorIndex });
      }
    }
  };
});

import { ColorCycleBrushCanvas2D } from '../ColorCycleBrushCanvas2D';

describe('ColorCycleBrushCanvas2D paintCustomStamp', () => {
  beforeAll(() => {
    if (typeof ImageData === 'undefined') {
      type ImageDataConstructor = typeof ImageData;
      const globalWithImageData = globalThis as typeof globalThis & { ImageData: ImageDataConstructor };

      class ImageDataPolyfill {
        width: number;
        height: number;
        data: Uint8ClampedArray;

        constructor(width: number, height: number) {
          this.width = width;
          this.height = height;
          this.data = new Uint8ClampedArray(width * height * 4);
        }
      }

      globalWithImageData.ImageData = ImageDataPolyfill as unknown as ImageDataConstructor;
    }

    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      writable: true,
      value: jest.fn(() => ({
        clearRect: jest.fn(),
        drawImage: jest.fn(),
        getImageData: jest.fn(() => new ImageData(1, 1)),
        putImageData: jest.fn(),
        save: jest.fn(),
        restore: jest.fn(),
        translate: jest.fn(),
        rotate: jest.fn(),
        setTransform: jest.fn(),
        beginPath: jest.fn(),
        arc: jest.fn(),
        fill: jest.fn(),
        fillRect: jest.fn(),
        createLinearGradient: jest.fn(() => ({ addColorStop: jest.fn() })),
        createPattern: jest.fn(),
        getContextAttributes: jest.fn(),
        canvas: document.createElement('canvas'),
        globalCompositeOperation: 'source-over',
        globalAlpha: 1,
        imageSmoothingEnabled: true
      }))
    });
  });

  beforeEach(() => {
    setIndexSpy.mockClear();
    paintSquareSpy.mockClear();
    paintTriangleSpy.mockClear();
    setFlowDirectionSpy.mockClear();
  });

  it('records setIndex calls for custom stamps', () => {
    const baseCanvas = document.createElement('canvas');
    baseCanvas.width = 64;
    baseCanvas.height = 64;

    const brush = new ColorCycleBrushCanvas2D(baseCanvas, { brushSize: 8, fps: 30 });
    brush.setGradient(
      [
        { position: 0, color: '#ff0000' },
        { position: 1, color: '#00ff00' }
      ],
      'layer-1'
    );

    const stampData = new ImageData(2, 2);
    for (let i = 0; i < stampData.data.length; i += 4) {
      stampData.data[i + 3] = 255;
    }

    brush.paintCustomStamp(
      {
        imageData: stampData,
        width: 2,
        height: 2,
        cacheKey: 'unit-test-stamp'
      },
      16,
      16,
      'layer-1',
      1,
      0
    );

    expect(setIndexSpy).toHaveBeenCalled();
    const firstCall = setIndexSpy.mock.calls[0][0];
    expect(firstCall.x).toBeGreaterThan(0);
    expect(firstCall.y).toBeGreaterThan(0);
    expect(firstCall.colorIndex).toBeGreaterThanOrEqual(1);
  });

  it('advances color indices across the full gradient range for short gradients', () => {
    const baseCanvas = document.createElement('canvas');
    baseCanvas.width = 64;
    baseCanvas.height = 64;

    const brush = new ColorCycleBrushCanvas2D(baseCanvas, { brushSize: 8, fps: 30 });
    brush.setGradient(
      [
        { position: 0, color: '#112233' },
        { position: 0.5, color: '#abcdef' },
        { position: 1, color: '#112233' }
      ],
      'layer-short'
    );
    brush.setGradientBands(3);

    brush.paint(8, 8, 'layer-short');
    brush.paint(10, 10, 'layer-short');
    brush.paint(12, 12, 'layer-short');

    const indices = paintSquareSpy.mock.calls.map(call => call[0]);
    expect(indices).toEqual([1, 128, 255]);
  });

  it('routes stamping through triangle renderer when configured', () => {
    const baseCanvas = document.createElement('canvas');
    baseCanvas.width = 64;
    baseCanvas.height = 64;

    const brush = new ColorCycleBrushCanvas2D(baseCanvas, { brushSize: 12, fps: 30 });
    brush.setGradient(
      [
        { position: 0, color: '#ff0000' },
        { position: 1, color: '#00ff00' }
      ],
      'layer-triangle'
    );
    brush.setStampShape('triangle');

    brush.paint(16, 16, 'layer-triangle');

    expect(paintTriangleSpy).toHaveBeenCalledTimes(1);
    expect(paintSquareSpy).not.toHaveBeenCalled();
  });

  it('restarts band progression after switching gradient presets', () => {
    const baseCanvas = document.createElement('canvas');
    baseCanvas.width = 64;
    baseCanvas.height = 64;

    const brush = new ColorCycleBrushCanvas2D(baseCanvas, { brushSize: 10, fps: 30 });
    brush.setGradient(
      [
        { position: 0, color: '#ff0000' },
        { position: 0.5, color: '#00ff00' },
        { position: 1, color: '#0000ff' }
      ],
      'layer-cycle'
    );

    brush.paint(20, 20, 'layer-cycle');
    brush.paint(24, 24, 'layer-cycle');

    paintSquareSpy.mockClear();

    brush.setGradient(
      [
        { position: 0.0, color: '#000000' },
        { position: 0.9, color: '#ffffff' },
        { position: 1.0, color: '#000000' }
      ],
      'layer-cycle'
    );

    brush.paint(28, 28, 'layer-cycle');
    brush.paint(32, 32, 'layer-cycle');
    brush.paint(36, 36, 'layer-cycle');

    const indices = paintSquareSpy.mock.calls.map(call => call[0]);
    expect(indices).toEqual([1, 24, 47]);
  });

  it('applies stored flow direction when creating a new animator', () => {
    const baseCanvas = document.createElement('canvas');
    baseCanvas.width = 64;
    baseCanvas.height = 64;

    const brush = new ColorCycleBrushCanvas2D(baseCanvas, { brushSize: 8, fps: 30 });
    brush.setFlowDirection('backward');
    setFlowDirectionSpy.mockClear();

    brush.setGradient(
      [
        { position: 0, color: '#000000' },
        { position: 1, color: '#ffffff' }
      ],
      'layer-flow'
    );

    expect(setFlowDirectionSpy).toHaveBeenCalledWith('reverse');
  });

  it('propagates pingpong flow mode to new animators', () => {
    const baseCanvas = document.createElement('canvas');
    baseCanvas.width = 64;
    baseCanvas.height = 64;

    const brush = new ColorCycleBrushCanvas2D(baseCanvas, { brushSize: 8, fps: 30 });
    brush.setFlowMode('pingpong');
    setFlowDirectionSpy.mockClear();

    brush.setGradient(
      [
        { position: 0, color: '#000000' },
        { position: 1, color: '#ffffff' }
      ],
      'layer-flow-mode'
    );

    expect(setFlowDirectionSpy).toHaveBeenCalledWith('pingpong');
  });
});
