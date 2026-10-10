jest.mock('@/lib/sequential/SequentialLayerRenderer', () => ({
  getSequentialLayerRenderCanvas: jest.fn(),
}));

import { __TESTING__ } from '../webglExporter';
import { getSequentialLayerRenderCanvas } from '@/lib/sequential/SequentialLayerRenderer';
import { BrushShape, type Layer, type SequentialStrokeEvent } from '@/types';
import { setFeatureFlag } from '@/config/featureFlags';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import { waitForPendingHistoryCommits } from '@/history/pendingHistoryCommits';
import historyManager from '@/history/historyService';
import { runFillToolPointerDown } from '@/hooks/canvas/handlers/fillTool';
import type { EventHandlerDependencies, EventHandlerDynamicDeps } from '@/hooks/canvas/utils/types';
import { useAppStore } from '@/stores/useAppStore';
import type { Project } from '@/types';

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

  it.each([false, true])('encodes real CPU presentation with straight partial RGBA (cropped: %s)', async (cropped) => {
    const actualRenderer = jest.requireActual<typeof import('@/lib/sequential/SequentialLayerRenderer')>(
      '@/lib/sequential/SequentialLayerRenderer',
    );
    setFeatureFlag('enableSequentialGpuAcceleration', false);
    setFeatureFlag('enableSequentialWorkerMaterialization', false);
    actualRenderer.clearSequentialLayerRendererAll();
    getSequentialLayerRenderCanvasMock.mockImplementation(actualRenderer.getSequentialLayerRenderCanvas);
    const canvasMockState = globalThis as typeof globalThis & { __VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__?: boolean };
    const previousRasterize = canvasMockState.__VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__;
    canvasMockState.__VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__ = true;
    const captured: { width: number; height: number; bytes: Uint8ClampedArray }[] = [];
    jest.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
      this: HTMLCanvasElement,
      callback: BlobCallback,
      type?: string,
    ) {
      const bytes = this.getContext('2d')!.getImageData(0, 0, this.width, this.height).data.slice();
      captured.push({ width: this.width, height: this.height, bytes });
      callback(new Blob([new Uint8Array(bytes)], { type: type ?? 'image/png' }));
    });
    const paint: SequentialStrokeEvent = {
      id: 'paint', layerId: 'seq-layer', strokeId: 'paint', timestampMs: 0, frameIndex: 0,
      brush: {
        tool: 'brush', brushShape: BrushShape.SQUARE, size: 4, opacity: 1,
        blendMode: 'source-over', rotation: 0, spacing: 1, color: '#ff0000',
      },
      stamps: [{ x: 8, y: 8, pressure: 1, rotation: 0, size: 4, alpha: 1 }],
    };
    const erase: SequentialStrokeEvent = {
      ...paint, id: 'erase', strokeId: 'erase',
      brush: { ...paint.brush, tool: 'eraser', blendMode: 'destination-out', size: 2 },
      stamps: [{ ...paint.stamps[0], size: 2, alpha: 0.5 }],
    };
    const blue: SequentialStrokeEvent = {
      ...paint, id: 'blue', frameIndex: 1, brush: { ...paint.brush, color: '#0000ff' },
    };
    const events = [paint, erase, blue];
    const originalEvents = JSON.stringify(events);
    const layer: Layer = {
      id: 'seq-layer', name: 'SEQ', visible: true, opacity: 1, blendMode: 'source-over',
      locked: false, order: 0, imageData: null, framebuffer: document.createElement('canvas'),
      alignment: createDefaultLayerAlignment(), layerType: 'sequential',
      sequentialData: { frameCount: 4, fps: 12, durationMs: 333, events },
    };
    try {
      const result = await captureSequentialLayerFrameTextures({
        layer, width: 16, height: 16, frameCount: 4,
        cropBounds: cropped ? { x: 6, y: 6, width: 4, height: 4 } : null,
      });
      expect(captured).toHaveLength(4);
      expect(result?.frameMap).toEqual([0, 1, 2, 2]);
      const size = cropped ? 4 : 16;
      expect(result?.sourceSize).toEqual({ width: size, height: size });
      expect(JSON.stringify(events)).toBe(originalEvents);
      for (const frame of captured) {
        expect([frame.width, frame.height]).toEqual([size, size]);
      }
      expect(Array.from(captured[2].bytes)).toEqual(new Array(size * size * 4).fill(0));
      expect(captured[3].bytes).toEqual(captured[2].bytes);
      const expectedRed = new Uint8ClampedArray(size * size * 4);
      const expectedBlue = new Uint8ClampedArray(size * size * 4);
      const offset = cropped ? 6 : 0;
      for (let y = 6; y < 10; y += 1) {
        for (let x = 6; x < 10; x += 1) {
          const index = ((y - offset) * size + x - offset) * 4;
          expectedRed.set([255, 0, 0, x >= 7 && x < 9 && y >= 7 && y < 9 ? 128 : 255], index);
          expectedBlue.set([0, 0, 255, 255], index);
        }
      }
      expect(captured[1].bytes).toEqual(expectedBlue);
      expect(captured[0].bytes).toEqual(expectedRed);
    } finally {
      actualRenderer.clearSequentialLayerRendererAll();
      canvasMockState.__VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__ = previousRasterize;
    }
  });

  it('exports canonical selected Fill and Erase edits on their authored frames', async () => {
    const actualRenderer = jest.requireActual<typeof import('@/lib/sequential/SequentialLayerRenderer')>(
      '@/lib/sequential/SequentialLayerRenderer',
    );
    setFeatureFlag('enableSequentialGpuAcceleration', false);
    setFeatureFlag('enableSequentialWorkerMaterialization', false);
    actualRenderer.clearSequentialLayerRendererAll();
    historyManager.clear();
    getSequentialLayerRenderCanvasMock.mockImplementation(actualRenderer.getSequentialLayerRenderCanvas);
    const canvasMockState = globalThis as typeof globalThis & { __VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__?: boolean };
    const previousRasterize = canvasMockState.__VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__;
    canvasMockState.__VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__ = true;
    const captured: Uint8ClampedArray[] = [];
    jest.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
      this: HTMLCanvasElement, callback: BlobCallback, type?: string,
    ) {
      const bytes = this.getContext('2d')!.getImageData(0, 0, this.width, this.height).data.slice();
      captured.push(bytes);
      callback(new Blob([new Uint8Array(bytes)], { type: type ?? 'image/png' }));
    });
    const makePaint = (frameIndex: number, color: string): SequentialStrokeEvent => ({
      id: `fill-export-base-${frameIndex}`, layerId: 'fill-export-seq', strokeId: `fill-export-base-${frameIndex}`,
      timestampMs: 0, frameIndex,
      brush: { tool: 'brush', brushShape: BrushShape.SQUARE, size: 6, opacity: 1, blendMode: 'source-over', rotation: 0, spacing: 1, color },
      stamps: [{ x: 3, y: 2, pressure: 1, rotation: 0, size: 6, alpha: 1 }],
    });
    const framebuffer = document.createElement('canvas');
    framebuffer.width = 1;
    framebuffer.height = 1;
    const layer: Layer = {
      id: 'fill-export-seq', name: 'Sequence', visible: true, opacity: 1, blendMode: 'source-over',
      locked: false, order: 0, imageData: null, framebuffer,
      alignment: createDefaultLayerAlignment(), layerType: 'sequential',
      sequentialData: { frameCount: 3, fps: 12, durationMs: 250, events: [makePaint(0, '#ff0000'), makePaint(1, '#0000ff')] },
    };
    useAppStore.setState((state) => ({
      layers: [layer], activeLayerId: layer.id,
      project: { ...state.project, id: 'fill-export', width: 6, height: 4, layers: [layer] } as Project,
      selectionStart: { x: 1, y: 1 }, selectionEnd: { x: 5, y: 3 }, selectionMask: null, selectionMaskBounds: null,
      palette: { ...state.palette, activeSlot: 'foreground', foregroundColor: '#00ff00' },
      tools: { ...state.tools, currentTool: 'fill', fillSettings: { threshold: 0, contiguous: true, eraseInstead: false } },
      sequentialRecord: { ...state.sequentialRecord, currentFrame: 0, isPointerDown: false },
      colorCyclePlayback: { ...state.colorCyclePlayback, desiredPlaying: false },
    }));
    const dispatch = () => {
      const state = useAppStore.getState();
      runFillToolPointerDown({
        dynamic: state as unknown as EventHandlerDynamicDeps,
        deps: { updateLayer: state.updateLayer, compositeCanvasDirtyRef: { current: false }, compositeCanvasRef: { current: null } } as unknown as EventHandlerDependencies,
        worldPos: { x: 0, y: 0 },
      });
    };
    try {
      dispatch();
      await waitForPendingHistoryCommits();
      useAppStore.setState((state) => ({
        tools: { ...state.tools, fillSettings: { ...state.tools.fillSettings, eraseInstead: true } },
        sequentialRecord: { ...state.sequentialRecord, currentFrame: 1 },
      }));
      dispatch();
      await waitForPendingHistoryCommits();
      const result = await captureSequentialLayerFrameTextures({ layer: useAppStore.getState().layers[0], width: 6, height: 4, frameCount: 3 });
      expect(result?.frameMap).toEqual([0, 1, 2]);
      expect(captured).toHaveLength(3);
      const expectedFill = new Uint8ClampedArray(6 * 4 * 4);
      const expectedErase = new Uint8ClampedArray(6 * 4 * 4);
      for (let y = 0; y < 4; y += 1) {
        for (let x = 0; x < 6; x += 1) {
          const selected = x >= 1 && x < 5 && y >= 1 && y < 3;
          expectedFill.set(selected ? [0, 255, 0, 255] : [255, 0, 0, 255], (y * 6 + x) * 4);
          expectedErase.set(selected ? [0, 0, 0, 0] : [0, 0, 255, 255], (y * 6 + x) * 4);
        }
      }
      expect(captured[0]).toEqual(expectedFill);
      expect(captured[1]).toEqual(expectedErase);
      expect(captured[2]).toEqual(new Uint8ClampedArray(6 * 4 * 4));
    } finally {
      await waitForPendingHistoryCommits();
      actualRenderer.clearSequentialLayerRendererAll();
      canvasMockState.__VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__ = previousRasterize;
      historyManager.clear();
    }
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
