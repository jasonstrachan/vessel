const setIndexSpy = jest.fn();

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
      paintSquare() {}
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
      (global as any).ImageData = class {
        width: number;
        height: number;
        data: Uint8ClampedArray;

        constructor(width: number, height: number) {
          this.width = width;
          this.height = height;
          this.data = new Uint8ClampedArray(width * height * 4);
        }
      } as unknown as typeof ImageData;
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
    expect(firstCall.colorIndex).toBeGreaterThanOrEqual(0);
  });
});
