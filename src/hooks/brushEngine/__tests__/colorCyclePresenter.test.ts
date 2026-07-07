import { ColorCyclePresenter, type ColorCyclePresenterCompositeLayer } from '../colorCyclePresenter';
import type { ColorCycleAnimator } from '@/lib/ColorCycleAnimator';
import type { ColorCycleLayerDocumentRead } from '@/lib/colorCycle/document';

const makeCanvas = (width = 8, height = 6): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

const makeDocumentRead = (version: number): ColorCycleLayerDocumentRead => ({
  version,
  snapshot: {} as ColorCycleLayerDocumentRead['snapshot'],
});

const makeAnimator = (renderToCanvas2D: jest.Mock): ColorCycleAnimator => ({
  builtFromVersion: 1,
  getDimensions: () => ({ width: 8, height: 6 }),
  hasPendingDerivedSurfaceRebuild: () => false,
  renderToCanvas2D,
  rebuild: jest.fn(),
} as unknown as ColorCycleAnimator);

describe('ColorCyclePresenter', () => {
  it('flushes versioned dirty batches to the scheduled render callback', () => {
    const target = makeCanvas();
    document.body.appendChild(target);
    const requestAnimationFrameSpy = jest
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        callback(0);
        return 1;
      });
    const presenter = new ColorCyclePresenter(target);
    const forceLayerRender = jest.fn();
    const render = jest.fn();
    const dirtyBatch = {
      layerId: 'dirty-layer',
      version: 7,
      rects: [{ x: 1, y: 2, width: 3, height: 4 }],
    };

    presenter.markLayerDirty('dirty-layer', dirtyBatch);
    presenter.scheduleDirtyRender({
      isAnimating: false,
      forceLayerRender,
      render,
    });

    expect(forceLayerRender).toHaveBeenCalledWith('dirty-layer', dirtyBatch);
    expect(render).toHaveBeenCalledWith([dirtyBatch]);

    requestAnimationFrameSpy.mockRestore();
    target.remove();
  });

  it('caches static tier renders by document version and redraws animated overlays every frame', () => {
    const target = makeCanvas();
    document.body.appendChild(target);

    const presenter = new ColorCyclePresenter(target);
    const staticRender = jest.fn();
    const animatedRender = jest.fn();
    const staticAnimator = makeAnimator(staticRender);
    const animatedAnimator = makeAnimator(animatedRender);

    const staticLayer: ColorCyclePresenterCompositeLayer = {
      layerId: 'static-layer',
      animator: staticAnimator,
      documentRead: makeDocumentRead(1),
      tier: 'static',
    };
    const animatedLayer: ColorCyclePresenterCompositeLayer = {
      layerId: 'animated-layer',
      animator: animatedAnimator,
      documentRead: makeDocumentRead(1),
      tier: 'animated',
    };

    expect(presenter.renderCompositeLayers([staticLayer, animatedLayer], 'test')).toBe(true);
    expect(presenter.renderCompositeLayers([staticLayer, animatedLayer], 'test')).toBe(true);

    expect(staticRender).toHaveBeenCalledTimes(1);
    expect(animatedRender).toHaveBeenCalledTimes(2);

    (staticAnimator as unknown as { builtFromVersion: number }).builtFromVersion = 2;
    const nextStaticLayer = {
      ...staticLayer,
      documentRead: makeDocumentRead(2),
    };
    expect(presenter.renderCompositeLayers([nextStaticLayer, animatedLayer], 'test')).toBe(true);

    expect(staticRender).toHaveBeenCalledTimes(2);
    expect(animatedRender).toHaveBeenCalledTimes(3);

    target.remove();
  });
});
