import { drawSierraLiteInterlace } from '@/lib/interlace/interlaceRenderer';
import type { InterlaceGroupSettings } from '@/types';

const createContext = () => ({
  setTransform: jest.fn(),
  clearRect: jest.fn(),
  fillRect: jest.fn(),
  drawImage: jest.fn(),
  createPattern: jest.fn(() => ({})),
  save: jest.fn(),
  restore: jest.fn(),
  translate: jest.fn(),
  scale: jest.fn(),
  fillStyle: '',
  globalAlpha: 1,
  globalCompositeOperation: 'source-over',
  imageSmoothingEnabled: true,
}) as unknown as CanvasRenderingContext2D;

describe('Interlace renderer', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('builds one Sierra plate and translates that same plate fractionally over stationary sources', () => {
    const maskContext = createContext();
    const tileContext = createContext();
    const layerContext = createContext();
    const compositeModes: GlobalCompositeOperation[] = [];
    let compositeMode: GlobalCompositeOperation = 'source-over';
    Object.defineProperty(layerContext, 'globalCompositeOperation', {
      configurable: true,
      get: () => compositeMode,
      set: (value: GlobalCompositeOperation) => {
        compositeMode = value;
        compositeModes.push(value);
      },
    });
    const contexts = [maskContext, tileContext, layerContext];
    const canvases: HTMLCanvasElement[] = [];
    const createElement = document.createElement.bind(document);
    jest.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      if (tagName !== 'canvas') {
        return createElement(tagName);
      }
      const context = contexts.shift();
      const canvas = {
        width: 0,
        height: 0,
        getContext: () => context,
      } as unknown as HTMLCanvasElement;
      canvases.push(canvas);
      return canvas;
    }) as typeof document.createElement);
    const targetContext = createContext();
    const settings: InterlaceGroupSettings = {
      cellSize: 16,
      dominance: 0.92,
      patternPreset: 'sierra-travel',
      motionMode: 'fixed',
      direction: 'right',
      travelCycles: 1,
      loopDurationSeconds: 10,
      seed: 0,
    };
    const sources = [
      { source: {} as CanvasImageSource, opacity: 1, blendMode: 'source-over' as const },
      { source: {} as CanvasImageSource, opacity: 1, blendMode: 'source-over' as const },
    ];

    expect(drawSierraLiteInterlace({
      context: targetContext,
      width: 64,
      height: 48,
      sources,
      settings,
      elapsedSeconds: 2.5,
    })).toBe(true);
    const plateFillCount = (tileContext.fillRect as jest.Mock).mock.calls.length;

    expect(drawSierraLiteInterlace({
      context: targetContext,
      width: 64,
      height: 48,
      sources,
      settings,
      elapsedSeconds: 5,
    })).toBe(true);

    expect(plateFillCount).toBeGreaterThan(0);
    expect(tileContext.fillRect).toHaveBeenCalledTimes(plateFillCount);
    expect(tileContext.clearRect).toHaveBeenCalledTimes(1);
    expect(canvases[1]).toMatchObject({ width: 448, height: 48 });
    expect(maskContext.fillRect).not.toHaveBeenCalled();
    expect(maskContext.drawImage).toHaveBeenNthCalledWith(1, canvases[1], -144, 0);
    expect(maskContext.drawImage).toHaveBeenNthCalledWith(2, canvases[1], -96, 0);
    expect(maskContext.createPattern).not.toHaveBeenCalled();
    expect(compositeModes).toEqual(expect.arrayContaining([
      'destination-out',
      'destination-in',
    ]));
    expect(layerContext.drawImage).toHaveBeenCalledWith(sources[0].source, 0, 0);
    expect(layerContext.drawImage).toHaveBeenCalledWith(sources[1].source, 0, 0);
  });
});
