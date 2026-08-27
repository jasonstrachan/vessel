import {
  createAdjustmentLayerCompositeCache,
  hasVisibleAdjustmentLayers,
  renderAdjustmentAwareLayerStack,
} from '@/stores/layers/adjustmentLayerCompositor';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import type { Layer } from '@/types';

const applyAdjustmentEffect = jest.fn(({ sourceCanvas }) => sourceCanvas);

jest.mock('@/lib/displayFilterPipeline', () => ({
  applyAdjustmentEffect: (options: unknown) => applyAdjustmentEffect(options),
  createDisplayFilterPipelineState: () => ({}),
}));

const createLayer = (
  id: string,
  order: number,
  overrides: Partial<Layer> = {},
): Layer => ({
  id,
  name: id,
  visible: true,
  opacity: 0.5,
  blendMode: 'multiply',
  locked: false,
  order,
  imageData: null,
  framebuffer: document.createElement('canvas'),
  alignment: createDefaultLayerAlignment(),
  layerType: 'normal',
  ...overrides,
});

const createAdjustment = (
  targetLayerIds?: string[],
): Layer => createLayer('adjustment', 2, {
  opacity: 1,
  blendMode: 'source-over',
  layerType: 'adjustment',
  adjustmentData: {
    effect: { id: 'pixelate', settings: { cellSize: 4 } },
    ...(targetLayerIds !== undefined ? { targetLayerIds } : {}),
  },
});

const renderStack = (layers: Layer[]) => {
  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 8;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Expected a Canvas2D context');
  const drawLayer = jest.fn();

  renderAdjustmentAwareLayerStack({
    context,
    sortedLayers: layers,
    layerGroups: [],
    width: 8,
    height: 8,
    cache: createAdjustmentLayerCompositeCache(),
    drawLayer,
  });

  return { context, drawLayer };
};

describe('adjustment layer compositor targets', () => {
  beforeEach(() => {
    applyAdjustmentEffect.mockClear();
  });

  it('applies an explicit adjustment only to its named lower layer', () => {
    const target = createLayer('target', 0);
    const unaffected = createLayer('unaffected', 1);
    const { drawLayer } = renderStack([target, unaffected, createAdjustment([target.id])]);

    expect(applyAdjustmentEffect).toHaveBeenCalledTimes(1);
    expect(drawLayer).toHaveBeenCalledTimes(2);
    expect(drawLayer.mock.calls[0]?.[1]).toMatchObject({
      id: target.id,
      opacity: 1,
      blendMode: 'source-over',
    });
    expect(drawLayer.mock.calls[1]?.[1]).toBe(unaffected);
  });

  it('keeps adjustment render surfaces pixel-perfect', () => {
    const target = createLayer('target', 0);
    const { context, drawLayer } = renderStack([target, createAdjustment([target.id])]);
    const adjustmentContext = drawLayer.mock.calls[0]?.[0] as CanvasRenderingContext2D;

    expect(adjustmentContext).not.toBe(context);
    expect(adjustmentContext.imageSmoothingEnabled).toBe(false);
  });

  it('keeps omitted targets as the legacy all-lower-stack behavior', () => {
    const target = createLayer('target', 0);
    renderStack([target, createAdjustment()]);

    expect(applyAdjustmentEffect).toHaveBeenCalledTimes(1);
  });

  it('treats an explicit empty target list as affecting no layers', () => {
    const target = createLayer('target', 0);
    const adjustment = createAdjustment([]);
    renderStack([target, adjustment]);

    expect(applyAdjustmentEffect).not.toHaveBeenCalled();
    expect(hasVisibleAdjustmentLayers([target, adjustment])).toBe(false);
  });
});
