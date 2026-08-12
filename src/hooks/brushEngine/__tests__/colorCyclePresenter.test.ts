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
  pixelVersion: version,
  snapshot: {} as ColorCycleLayerDocumentRead['snapshot'],
});

const makeAnimator = (renderToCanvas2D: jest.Mock): ColorCycleAnimator => ({
  builtFromVersion: 1,
  forceRender: jest.fn(() => true),
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

  it('preserves disjoint dirty rects marked before the scheduled render flushes', () => {
    const target = makeCanvas(16, 16);
    document.body.appendChild(target);
    const requestAnimationFrameSpy = jest
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation(() => 1);
    const presenter = new ColorCyclePresenter(target);
    const forceLayerRender = jest.fn();
    const render = jest.fn();

    presenter.markLayerDirty('dirty-layer', {
      layerId: 'dirty-layer',
      version: 7,
      rects: [{ x: 1, y: 1, width: 2, height: 2 }],
    });
    presenter.markLayerDirty('dirty-layer', {
      layerId: 'dirty-layer',
      version: 8,
      rects: [{ x: 10, y: 10, width: 2, height: 2 }],
    });
    presenter.scheduleDirtyRender({
      isAnimating: false,
      forceLayerRender,
      render,
    });
    presenter.flushScheduledRender({ forceLayerRender, render });

    const mergedBatch = {
      layerId: 'dirty-layer',
      version: 8,
      rects: [
        { x: 1, y: 1, width: 2, height: 2 },
        { x: 10, y: 10, width: 2, height: 2 },
      ],
    };
    expect(forceLayerRender).toHaveBeenCalledWith('dirty-layer', mergedBatch);
    expect(render).toHaveBeenCalledWith([mergedBatch]);

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

  it('preserves the previous layer frame when a transactional direct render fails', () => {
    const target = makeCanvas();
    const targetCtx = target.getContext('2d');
    if (!targetCtx) {
      throw new Error('Missing test canvas context');
    }
    const presenter = new ColorCyclePresenter(target);
    const animator = makeAnimator(jest.fn());
    const targetDraw = jest.spyOn(targetCtx, 'drawImage');
    const targetClear = jest.spyOn(targetCtx, 'clearRect');
    jest.spyOn(presenter, 'renderAnimatorToContext').mockImplementation(() => {
      throw new Error('replacement render failed');
    });

    expect(() => presenter.renderDirectToCanvas({
      targetCanvas: target,
      ctx: targetCtx,
      layerId: 'layer-failed-frame',
      animator,
      documentRead: makeDocumentRead(1),
      hasRenderableContent: true,
      preserveExternalBase: false,
    })).toThrow('replacement render failed');

    expect(targetClear).not.toHaveBeenCalled();
    expect(targetDraw).not.toHaveBeenCalled();
  });

  it('does not publish a partially masked replacement frame when masking fails', () => {
    const target = makeCanvas();
    const targetCtx = target.getContext('2d');
    if (!targetCtx) throw new Error('Missing test canvas context');
    const presenter = new ColorCyclePresenter(target);
    const animator = makeAnimator(jest.fn());
    const targetDraw = jest.spyOn(targetCtx, 'drawImage');
    jest.spyOn(presenter, 'renderAnimatorToContext').mockImplementation((_animator, scratchCtx) => {
      scratchCtx.fillRect(0, 0, 1, 1);
    });

    expect(() => presenter.renderDirectToCanvas({
      targetCanvas: target,
      ctx: targetCtx,
      layerId: 'layer-mask-failure',
      animator,
      documentRead: makeDocumentRead(1),
      hasRenderableContent: true,
      preserveExternalBase: false,
      applyMask: (_layerId, scratchCtx) => {
        scratchCtx.clearRect(0, 0, 1, 1);
        throw new Error('mask failed');
      },
    })).toThrow('mask failed');

    expect(targetDraw).not.toHaveBeenCalled();
  });

  it('preserves the previous layer frame when the derived-surface rebuild fails', () => {
    const target = makeCanvas();
    const targetCtx = target.getContext('2d');
    if (!targetCtx) {
      throw new Error('Missing test canvas context');
    }
    const presenter = new ColorCyclePresenter(target);
    const animator = makeAnimator(jest.fn());
    (animator.forceRender as jest.Mock).mockReturnValue(false);
    const targetDraw = jest.spyOn(targetCtx, 'drawImage');
    const targetClear = jest.spyOn(targetCtx, 'clearRect');

    expect(() => presenter.renderDirectToCanvas({
      targetCanvas: target,
      ctx: targetCtx,
      layerId: 'layer-failed-rebuild',
      animator,
      documentRead: makeDocumentRead(1),
      hasRenderableContent: true,
      preserveExternalBase: false,
    })).toThrow('Color-cycle derived surface render failed');

    expect(targetClear).not.toHaveBeenCalled();
    expect(targetDraw).not.toHaveBeenCalled();
  });

  it('rebuilds a stale derived surface from the canonical document before publication', () => {
    const target = makeCanvas();
    const targetCtx = target.getContext('2d');
    if (!targetCtx) {
      throw new Error('Missing test canvas context');
    }
    const presenter = new ColorCyclePresenter(target);
    const animator = makeAnimator(jest.fn());
    const documentRead = makeDocumentRead(2);
    (animator.rebuild as jest.Mock).mockImplementation((_snapshot, version: number) => {
      (animator as unknown as { builtFromVersion: number }).builtFromVersion = version;
    });

    presenter.renderDirectToCanvas({
      targetCanvas: target,
      ctx: targetCtx,
      layerId: 'layer-stale-rebuild',
      animator,
      documentRead,
      hasRenderableContent: true,
      preserveExternalBase: false,
    });

    expect(animator.rebuild).toHaveBeenCalledWith(documentRead.snapshot, documentRead.version);
  });

  it('blocks publication when a stale derived surface remains stale after rebuild', () => {
    const target = makeCanvas();
    const targetCtx = target.getContext('2d');
    if (!targetCtx) {
      throw new Error('Missing test canvas context');
    }
    const presenter = new ColorCyclePresenter(target);
    const animator = makeAnimator(jest.fn());
    const targetDraw = jest.spyOn(targetCtx, 'drawImage');

    expect(() => presenter.renderDirectToCanvas({
      targetCanvas: target,
      ctx: targetCtx,
      layerId: 'layer-still-stale',
      animator,
      documentRead: makeDocumentRead(2),
      hasRenderableContent: true,
      preserveExternalBase: false,
    })).toThrow('Color-cycle derived surface is stale');

    expect(targetDraw).not.toHaveBeenCalled();
  });

  it('publishes a completed transactional direct render to the layer canvas', () => {
    const target = makeCanvas();
    const targetCtx = target.getContext('2d');
    if (!targetCtx) {
      throw new Error('Missing test canvas context');
    }
    const presenter = new ColorCyclePresenter(target);
    const renderToCanvas2D = jest.fn();
    const animator = makeAnimator(renderToCanvas2D);
    const targetClear = jest.spyOn(targetCtx, 'clearRect');
    const targetDraw = jest.spyOn(targetCtx, 'drawImage');

    presenter.renderDirectToCanvas({
      targetCanvas: target,
      ctx: targetCtx,
      layerId: 'layer-complete-frame',
      animator,
      documentRead: makeDocumentRead(1),
      hasRenderableContent: true,
      preserveExternalBase: false,
    });

    expect(targetClear).not.toHaveBeenCalled();
    expect(renderToCanvas2D).toHaveBeenCalledWith(expect.anything());
    expect(targetDraw).toHaveBeenCalled();
  });

  it('presents the current frame without forcing or rebuilding the animator', () => {
    const target = makeCanvas();
    const targetCtx = target.getContext('2d');
    if (!targetCtx) {
      throw new Error('Missing test canvas context');
    }
    const presenter = new ColorCyclePresenter(target);
    const renderToCanvas2D = jest.fn();
    const animator = makeAnimator(renderToCanvas2D);

    presenter.presentCurrentFrameToCanvas({
      targetCanvas: target,
      ctx: targetCtx,
      layerId: 'layer-current-frame',
      animator,
      documentRead: makeDocumentRead(1),
      hasRenderableContent: true,
      preserveExternalBase: false,
    });

    expect(animator.forceRender).not.toHaveBeenCalled();
    expect(animator.rebuild).not.toHaveBeenCalled();
    expect(renderToCanvas2D).toHaveBeenCalledTimes(1);
  });

  it('defers stale presentation without forcing, rebuilding, or replacing the visible frame', () => {
    const target = makeCanvas();
    const targetCtx = target.getContext('2d');
    if (!targetCtx) {
      throw new Error('Missing test canvas context');
    }
    const presenter = new ColorCyclePresenter(target);
    const renderToCanvas2D = jest.fn();
    const animator = makeAnimator(renderToCanvas2D);
    const targetDraw = jest.spyOn(targetCtx, 'drawImage');

    expect(() => presenter.presentCurrentFrameToCanvas({
      targetCanvas: target,
      ctx: targetCtx,
      layerId: 'layer-stale-current-frame',
      animator,
      documentRead: makeDocumentRead(2),
      hasRenderableContent: true,
      preserveExternalBase: false,
    })).not.toThrow();

    expect(animator.forceRender).not.toHaveBeenCalled();
    expect(animator.rebuild).not.toHaveBeenCalled();
    expect(renderToCanvas2D).not.toHaveBeenCalled();
    expect(targetDraw).not.toHaveBeenCalled();
  });
});
