import type { ColorCycleAnimator } from '@/lib/ColorCycleAnimator';
import type { ColorCycleLayerDocumentRead } from '@/lib/colorCycle/document';
import {
  getColorCyclePresentationCanvas,
  resolveColorCyclePresentation,
} from '@/components/canvas/resolveColorCyclePresentation';
import * as maskManagerModule from '@/layers/MaskManager';
import type { Layer } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

import { ColorCyclePresenter } from '../colorCyclePresenter';

import {
  renderColorCycleDirectToCanvas,
  presentColorCycleCurrentFrameToCanvas,
  type ColorCycleRenderCommitContext,
} from '../colorCycleRenderCommitRuntime';

const makeCanvas = (): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 4;
  return canvas;
};

const makeDocumentRead = (hasContent: boolean): ColorCycleLayerDocumentRead => ({
  version: 3,
  pixelVersion: 3,
  snapshot: {
    layerId: 'layer-document-content',
    width: 4,
    height: 4,
    hasContent,
    sources: {
      brushStateSnapshot: false,
      topLevelBuffers: true,
      legacyStateRefs: false,
    },
  },
});

describe('renderColorCycleDirectToCanvas', () => {
  it('restores missing runtime stroke state before presenting canonical document content', () => {
    const animator = {} as ColorCycleAnimator;
    const documentRead = makeDocumentRead(true);
    const renderDirectToCanvas = jest.fn();
    const restoredStrokeState = {
      hasContent: true,
      externalBase: { hasExternalBase: false },
    };
    const context = {
      getAnimator: jest.fn(() => animator),
      getStrokeState: jest.fn(() => undefined),
      getLayerDocumentRead: jest.fn(() => documentRead),
      restoreRuntimeFromDocument: jest.fn(() => restoredStrokeState),
      paintHasContent: jest.fn(() => false),
      getCanvasWidth: jest.fn(() => 4),
      getCanvasHeight: jest.fn(() => 4),
      getLayerColorCycleMeta: jest.fn(() => null),
      applyDefBindingsForLayer: jest.fn(),
      renderDirectToCanvas,
    } as unknown as ColorCycleRenderCommitContext;

    renderColorCycleDirectToCanvas(context, makeCanvas(), 'layer-document-content');

    expect(context.restoreRuntimeFromDocument).toHaveBeenCalledWith(
      'layer-document-content',
      animator,
      documentRead,
    );
    expect(context.applyDefBindingsForLayer).toHaveBeenCalledWith(
      'layer-document-content',
      animator,
      restoredStrokeState,
      undefined,
    );
    expect(renderDirectToCanvas).toHaveBeenCalledWith(expect.objectContaining({
      documentRead,
      hasRenderableContent: true,
      layerId: 'layer-document-content',
    }));
  });

  it('fails before publication when canonical runtime restoration yields no content', () => {
    const animator = {} as ColorCycleAnimator;
    const context = {
      getAnimator: jest.fn(() => animator),
      getStrokeState: jest.fn(() => undefined),
      getLayerDocumentRead: jest.fn(() => makeDocumentRead(true)),
      restoreRuntimeFromDocument: jest.fn(() => ({
        hasContent: false,
        externalBase: { hasExternalBase: false },
      })),
      paintHasContent: jest.fn(() => false),
      getCanvasWidth: jest.fn(() => 4),
      getCanvasHeight: jest.fn(() => 4),
      renderDirectToCanvas: jest.fn(),
    } as unknown as ColorCycleRenderCommitContext;

    expect(() => renderColorCycleDirectToCanvas(
      context,
      makeCanvas(),
      'layer-failed-restore',
    )).toThrow('Color-cycle runtime restore produced no content');
    expect(context.renderDirectToCanvas).not.toHaveBeenCalled();
  });
});


describe('current-frame erase-mask ownership', () => {
  beforeEach(() => {
    // Canvas I/O is the only double: preserve real presenter, mask owner, and resolver.
    // The shared mock neither composites drawImage nor implements save/restore.
    const states = new WeakMap<CanvasRenderingContext2D, Array<{
      operation: GlobalCompositeOperation;
      alpha: number;
    }>>();
    jest.spyOn(CanvasRenderingContext2D.prototype, 'save').mockImplementation(function save(this: CanvasRenderingContext2D) {
      const stack = states.get(this) ?? [];
      stack.push({ operation: this.globalCompositeOperation, alpha: this.globalAlpha });
      states.set(this, stack);
    });
    jest.spyOn(CanvasRenderingContext2D.prototype, 'restore').mockImplementation(function restore(this: CanvasRenderingContext2D) {
      const state = states.get(this)?.pop();
      if (state) {
        this.globalCompositeOperation = state.operation;
        this.globalAlpha = state.alpha;
      }
    });
    jest.spyOn(CanvasRenderingContext2D.prototype, 'drawImage').mockImplementation(function drawImage(this: CanvasRenderingContext2D, source) {
      const sourceCanvas = source as HTMLCanvasElement;
      const sourcePixels = sourceCanvas.getContext('2d')!.getImageData(0, 0, 4, 4);
      const output = this.getImageData(0, 0, 4, 4);
      for (let index = 0; index < output.data.length; index += 4) {
        const sourceAlpha = sourcePixels.data[index + 3] / 255 * this.globalAlpha;
        if (this.globalCompositeOperation === 'destination-out') {
          output.data[index + 3] = Math.round(output.data[index + 3] * (1 - sourceAlpha));
        } else if (this.globalCompositeOperation === 'copy') {
          output.data.set(sourcePixels.data.subarray(index, index + 3), index);
          output.data[index + 3] = Math.round(sourceAlpha * 255);
        } else {
          const destinationAlpha = output.data[index + 3] / 255;
          const alpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
          for (let channel = 0; channel < 3; channel += 1) {
            output.data[index + channel] = alpha ? Math.round((
              sourcePixels.data[index + channel] * sourceAlpha +
              output.data[index + channel] * destinationAlpha * (1 - sourceAlpha)
            ) / alpha) : 0;
          }
          output.data[index + 3] = Math.round(alpha * 255);
        }
      }
      this.putImageData(output, 0, 0);
    });
  });

  afterEach(() => { jest.restoreAllMocks(); });

  const makeFixture = () => {
    const runtimeCanvas = makeCanvas();
    const eraseMask = makeCanvas();
    const opaquePixels = new ImageData(4, 4);
    const maskPixels = new ImageData(4, 4);
    for (let index = 0; index < opaquePixels.data.length; index += 4) {
      opaquePixels.data.set([28, 28, 32, 255], index);
      maskPixels.data.set([255, 255, 255, 128], index);
    }
    runtimeCanvas.getContext('2d')!.putImageData(opaquePixels, 0, 0);
    eraseMask.getContext('2d')!.putImageData(maskPixels, 0, 0);
    let layer: Layer = {
      id: 'partial-eraser', name: 'CC', visible: true, opacity: 1,
      blendMode: 'source-over', locked: false, order: 0, imageData: null,
      framebuffer: runtimeCanvas, alignment: createDefaultLayerAlignment(),
      layerType: 'color-cycle',
      colorCycleData: { canvas: runtimeCanvas, eraseMask, eraseMaskVersion: 1, runtimeHydrationState: 'active' },
    };
    const masks = new maskManagerModule.MaskManager({
      getLayer: () => layer,
      getProjectSize: () => ({ width: 4, height: 4 }),
      updateLayer: (_id, patch) => {
        layer = { ...layer, colorCycleData: { ...layer.colorCycleData, ...patch.colorCycleData } };
      },
    });
    jest.spyOn(maskManagerModule, 'getMaskManager').mockReturnValue(masks);
    const animator = {
      builtFromVersion: 3, forceRender: () => true,
      hasPendingDerivedSurfaceRebuild: () => false,
      getDimensions: () => ({ width: 4, height: 4 }),
      renderToCanvas2D: (ctx: CanvasRenderingContext2D) => ctx.putImageData(opaquePixels, 0, 0),
    } as unknown as ColorCycleAnimator;
    const presenter = new ColorCyclePresenter(runtimeCanvas);
    const context = {
      getAnimator: () => animator,
      getStrokeState: () => ({ hasContent: true, externalBase: { hasExternalBase: false } }),
      getLayerDocumentRead: () => makeDocumentRead(true),
      getLayerColorCycleMeta: () => null,
      applyDefBindingsForLayer: () => {},
      renderDirectToCanvas: presenter.renderDirectToCanvas.bind(presenter),
      presentCurrentFrameToCanvas: presenter.presentCurrentFrameToCanvas.bind(presenter),
    } as unknown as ColorCycleRenderCommitContext;
    const presentedAlpha = () => {
      const source = resolveColorCyclePresentation({
        layer, activeLayerId: layer.id, projectWidth: 4, projectHeight: 4,
      });
      const ctx = getColorCyclePresentationCanvas(source, layer)!.getContext('2d') as
        CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
      return ctx.getImageData(0, 0, 1, 1).data[3];
    };
    return { context, runtimeCanvas, eraseMask, masks, presentedAlpha, layerId: layer.id };
  };

  it('applies a partial erase mask once across held, repeated current-frame, and version refreshes', () => {
    const fixture = makeFixture();
    expect(fixture.presentedAlpha()).toBe(127);
    for (const bumpVersion of [false, false, true, true]) {
      if (bumpVersion) fixture.masks.bumpVersion(fixture.layerId);
      presentColorCycleCurrentFrameToCanvas(fixture.context, fixture.runtimeCanvas, fixture.layerId);
      expect(fixture.presentedAlpha()).toBe(127);
      expect(fixture.runtimeCanvas.getContext('2d')!.getImageData(0, 0, 1, 1).data[3]).toBe(255);
      expect(fixture.eraseMask.getContext('2d')!.getImageData(0, 0, 1, 1).data[3]).toBe(128);
    }
  });

  it('retains one erase-mask application for a direct render consumer', () => {
    const fixture = makeFixture();
    const directTarget = makeCanvas();
    renderColorCycleDirectToCanvas(fixture.context, directTarget, fixture.layerId);
    expect(directTarget.getContext('2d')!.getImageData(0, 0, 1, 1).data[3]).toBe(127);
    expect(fixture.runtimeCanvas.getContext('2d')!.getImageData(0, 0, 1, 1).data[3]).toBe(255);
    expect(fixture.eraseMask.getContext('2d')!.getImageData(0, 0, 1, 1).data[3]).toBe(128);
  });
});
