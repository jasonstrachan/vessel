import type { ColorCycleAnimator } from '@/lib/ColorCycleAnimator';
import type { ColorCycleLayerDocumentRead } from '@/lib/colorCycle/document';

import {
  renderColorCycleDirectToCanvas,
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
