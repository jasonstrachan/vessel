jest.mock('@/lib/sequential/SequentialLayerRenderer', () => ({
  getSequentialLayerRenderCanvas: jest.fn(),
}));

import { __TESTING__ } from '../webglExporter';
import { getSequentialLayerRenderCanvas } from '@/lib/sequential/SequentialLayerRenderer';
import type { Layer } from '@/types';

const { captureSequentialLayerFrameTextures } = __TESTING__;

const getSequentialLayerRenderCanvasMock = getSequentialLayerRenderCanvas as jest.MockedFunction<
  typeof getSequentialLayerRenderCanvas
>;

describe('webglExporter sequential capture', () => {
  beforeEach(() => {
    getSequentialLayerRenderCanvasMock.mockReset();
    jest.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(() => 'data:image/png;base64,test');
    jest.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function toBlob(callback: BlobCallback) {
      callback(new Blob(['test'], { type: 'image/png' }));
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('captures playback frames without holding previous content on empty sequential frames', async () => {
    getSequentialLayerRenderCanvasMock.mockImplementation(({ frameIndex }) => {
      const canvas = document.createElement('canvas');
      canvas.width = 16;
      canvas.height = 16;
      canvas.dataset.frame = String(frameIndex);
      return canvas;
    });

    await captureSequentialLayerFrameTextures({
      layer: {
        id: 'seq-layer',
        name: 'Sequential Layer',
        visible: true,
        opacity: 1,
        blendMode: 'source-over',
        locked: false,
        transparencyLocked: false,
        order: 0,
        imageData: null,
        framebuffer: null,
        alignment: null,
        layerType: 'sequential',
        sequentialData: {
          frameCount: 2,
          fps: 12,
          durationMs: Math.round((2 * 1000) / 12),
          events: [{
            id: 'seq-event-0',
            layerId: 'seq-layer',
            strokeId: 'seq-stroke-0',
            timestampMs: 0,
            frameIndex: 0,
            brush: {
              tool: 'brush',
              brushShape: 'round',
              size: 4,
              opacity: 1,
              blendMode: 'source-over',
              rotation: 0,
              spacing: 1,
              color: '#ff0000',
            },
            stamps: [{
              x: 4,
              y: 4,
              pressure: 1,
              rotation: 0,
              size: 4,
              alpha: 1,
            }],
          }],
        },
        version: 1,
      } as unknown as Layer,
      frameCount: 2,
      width: 16,
      height: 16,
    });

    expect(getSequentialLayerRenderCanvasMock).toHaveBeenCalledTimes(2);
    expect(getSequentialLayerRenderCanvasMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        frameIndex: 0,
        holdPreviousOnEmptyFrames: false,
      })
    );
    expect(getSequentialLayerRenderCanvasMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        frameIndex: 1,
        holdPreviousOnEmptyFrames: false,
      })
    );
  });
});
