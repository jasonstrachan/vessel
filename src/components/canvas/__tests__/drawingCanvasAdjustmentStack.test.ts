import { drawAdjustmentCompositeStack } from '@/components/canvas/drawingCanvasAdjustmentStack';
import type { AppState } from '@/stores/useAppStore';
import type { Layer } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

const createLayer = (id: string, order: number, overrides: Partial<Layer> = {}): Layer => ({
  id,
  name: id,
  visible: true,
  opacity: 1,
  blendMode: 'source-over',
  locked: false,
  order,
  imageData: null,
  framebuffer: document.createElement('canvas'),
  alignment: createDefaultLayerAlignment(),
  layerType: 'normal',
  ...overrides,
});

describe('drawAdjustmentCompositeStack', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('disables smoothing on the viewport surface before resampling visible pixels', () => {
    const outputCanvas = document.createElement('canvas');
    outputCanvas.width = 16;
    outputCanvas.height = 16;
    const outputContext = outputCanvas.getContext('2d');
    if (!outputContext) throw new Error('Expected a Canvas2D context');
    const source = createLayer('source', 0);
    const adjustment = createLayer('adjustment', 1, {
      layerType: 'adjustment',
      adjustmentData: {
        effect: {
          id: 'hue-sat',
          settings: {
            hue: 0,
            saturation: 0,
            vibrance: 0,
            lightness: 0,
            contrast: 0,
            red: 0,
            green: 0,
            blue: 0,
            hueRangeEnabled: false,
            hueRangeStart: 0,
            hueRangeEnd: 360,
          },
        },
      },
    });
    const createdContexts: CanvasRenderingContext2D[] = [];
    const createElement = document.createElement.bind(document);
    const drawImageSpy = jest.spyOn(CanvasRenderingContext2D.prototype, 'drawImage');
    jest.spyOn(document, 'createElement').mockImplementation((tagName) => {
      const element = createElement(tagName);
      if (tagName === 'canvas') {
        const context = (element as HTMLCanvasElement).getContext('2d');
        if (context) createdContexts.push(context);
      }
      return element;
    });

    expect(drawAdjustmentCompositeStack({
      ctx: outputContext,
      visibleRect: { x: 0.25, y: 0.25, width: 8.5, height: 8.5 },
      destination: { x: 0.25, y: 0.25, width: 8.5, height: 8.5 },
      sortedLayers: [source, adjustment],
      storeState: {
        project: { width: 16, height: 16, backgroundColor: 'transparent' },
        layerGroups: [],
      } as unknown as AppState,
      shouldHoldPreviousSequentialFrame: false,
    })).toBe(true);

    expect(createdContexts.length).toBeGreaterThan(0);
    expect(createdContexts.every((context) => context.imageSmoothingEnabled === false)).toBe(true);
    expect(drawImageSpy).toHaveBeenCalledWith(
      source.framebuffer,
      0,
      0,
      9,
      9,
      0,
      0,
      9,
      9,
    );
  });
});
