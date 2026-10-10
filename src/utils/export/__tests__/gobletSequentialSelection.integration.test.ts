import { useAppStore } from '@/stores/useAppStore';
import historyManager from '@/history/historyService';
import { waitForPendingHistoryCommits } from '@/history/pendingHistoryCommits';
import { isFeatureFlagEnabled, setFeatureFlag } from '@/config/featureFlags';
import { clearSequentialLayerRendererAll } from '@/lib/sequential/SequentialLayerRenderer';
import { snapshotSequentialSelectionClip } from '@/lib/sequential/selectionClip';
import { BrushShape, type Layer, type SequentialStrokeEvent } from '@/types';
import { captureSequentialLayerFrameTextures } from '@/utils/export/goblet/gobletSequentialSerializer';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

const paint = (id: string, frameIndex: number, color: string): SequentialStrokeEvent => ({
  id, layerId: 'seq', strokeId: id, timestampMs: 0, frameIndex,
  brush: { tool: 'brush', brushShape: BrushShape.SQUARE, size: 16, opacity: 1, blendMode: 'source-over', rotation: 0, spacing: 1, color },
  stamps: [{ x: 8, y: 8, pressure: 1, rotation: 0, size: 16, alpha: 1 }],
});

describe('Goblet recorded selection frame integration', () => {
  it.each([false, true])('exports exact clipped frames through the real materializer (crop %s)', async (cropped) => {
    const gpu = isFeatureFlagEnabled('enableSequentialGpuAcceleration');
    const worker = isFeatureFlagEnabled('enableSequentialWorkerMaterialization');
    setFeatureFlag('enableSequentialGpuAcceleration', false);
    setFeatureFlag('enableSequentialWorkerMaterialization', false);
    clearSequentialLayerRendererAll();
    const canvasMockState = globalThis as typeof globalThis & { __VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__?: boolean };
    const previousRasterize = canvasMockState.__VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__;
    canvasMockState.__VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__ = true;
    const captured: Uint8ClampedArray[] = [];
    jest.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, callback: BlobCallback, type?: string) {
      const bytes = this.getContext('2d')!.getImageData(0, 0, this.width, this.height).data.slice();
      captured.push(bytes);
      callback(new Blob([new Uint8Array(bytes)], { type: type ?? 'image/png' }));
    });
    const base = paint('base', 0, '#ff0000');
    const selected = paint('selected', 0, '#0000ff');
    selected.brush.selectionClip = { kind: 'rect', minX: 4, minY: 3, maxX: 10, maxY: 11 };
    const next = paint('next', 1, '#00ff00');
    const selectionMask = new ImageData(16, 16);
    for (let y = 0; y < 16; y += 1) {
      for (let x = 0; x < 16; x += 1) {
        selectionMask.data[(y * 16 + x) * 4 + 3] = x >= 6 && x < 10 && y >= 6 && y < 10 ? 0 : 80;
      }
    }
    next.brush.selectionClip = snapshotSequentialSelectionClip({ selectionStart: null, selectionEnd: null, selectionMask, selectionMaskBounds: { x: 0, y: 0, width: 16, height: 16 } });
    selectionMask.data.fill(0);
    const events = [base, selected, next];
    const original = JSON.stringify(events);
    const layer: Layer = {
      id: 'seq', name: 'SEQ', visible: true, opacity: 1, blendMode: 'source-over', locked: false, order: 0,
      imageData: null, framebuffer: document.createElement('canvas'), alignment: createDefaultLayerAlignment(), layerType: 'sequential',
      sequentialData: { frameCount: 4, fps: 1, durationMs: 4000, events },
    };
    try {
      const result = await captureSequentialLayerFrameTextures({ layer, width: 16, height: 16, frameCount: 4, cropBounds: cropped ? { x: 4, y: 4, width: 8, height: 8 } : null });
      expect(captured).toHaveLength(4);
      expect(result?.frameMap).toEqual([0, 1, 2, 2]);
      const size = cropped ? 8 : 16;
      const offset = cropped ? 4 : 0;
      const expectedFirst = new Uint8ClampedArray(size * size * 4);
      const expectedNext = new Uint8ClampedArray(size * size * 4);
      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          const worldX = x + offset;
          const worldY = y + offset;
          expectedFirst.set(worldX >= 4 && worldX < 10 && worldY >= 3 && worldY < 11 ? [0, 0, 255, 255] : [255, 0, 0, 255], (y * size + x) * 4);
          if (!(worldX >= 6 && worldX < 10 && worldY >= 6 && worldY < 10)) {
            expectedNext.set([0, 255, 0, 255], (y * size + x) * 4);
          }
        }
      }
      expect(captured[0]).toEqual(expectedFirst);
      expect(captured[1]).toEqual(expectedNext);
      expect(captured[2]).toEqual(new Uint8ClampedArray(size * size * 4));
      expect(captured[3]).toEqual(captured[2]);
      expect(JSON.stringify(events)).toBe(original);
    } finally {
      jest.restoreAllMocks();
      clearSequentialLayerRendererAll();
      setFeatureFlag('enableSequentialGpuAcceleration', gpu);
      setFeatureFlag('enableSequentialWorkerMaterialization', worker);
      canvasMockState.__VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__ = previousRasterize;
    }
  });
});


describe('Goblet moved Sequence selection integration', () => {
  it.each([false, true])('exports committed raw RGBA move frames (crop %s)', async (cropped) => {
    await waitForPendingHistoryCommits();
    historyManager.clear();
    const savedState = useAppStore.getState();
    const gpu = isFeatureFlagEnabled('enableSequentialGpuAcceleration');
    const worker = isFeatureFlagEnabled('enableSequentialWorkerMaterialization');
    setFeatureFlag('enableSequentialGpuAcceleration', false);
    setFeatureFlag('enableSequentialWorkerMaterialization', false);
    clearSequentialLayerRendererAll();
    const canvasState = globalThis as typeof globalThis & { __VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__?: boolean };
    const previousRasterize = canvasState.__VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__;
    canvasState.__VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__ = true;
    const frames: Uint8ClampedArray[] = [];
    jest.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, callback: BlobCallback, type?: string) {
      const pixels = this.getContext('2d')!.getImageData(0, 0, this.width, this.height).data.slice();
      frames.push(pixels);
      callback(new Blob([new Uint8Array(pixels)], { type: type ?? 'image/png' }));
    });
    const red = paint('red', 0, '#ff0000');
    const blue = paint('blue', 0, '#0000ff');
    blue.brush.selectionClip = { kind: 'rect', minX: 5, minY: 4, maxX: 7, maxY: 8 };
    const events = [red, blue, paint('green', 1, '#00ff00')];
    const layer: Layer = {
      id: 'seq', name: 'SEQ', visible: true, opacity: 1, blendMode: 'source-over', locked: false, order: 0,
      imageData: null, framebuffer: document.createElement('canvas'), alignment: createDefaultLayerAlignment(), layerType: 'sequential',
      sequentialData: { frameCount: 4, fps: 1, durationMs: 4000, events },
    };
    try {
      useAppStore.setState((state) => ({
        project: { ...state.project!, width: 16, height: 16 }, layers: [layer], activeLayerId: layer.id,
        floatingPaste: null, floatingPasteHistoryContext: null,
        selectionStart: { x: 4, y: 4 }, selectionEnd: { x: 8, y: 8 },
        selectionMask: null, selectionMaskBounds: null, selectionMaskLayerId: null,
        sequentialRecord: { ...state.sequentialRecord, currentFrame: 0, isPointerDown: false },
      }));
      expect(useAppStore.getState().extractSelectionToFloatingPaste()).toBe(true);
      useAppStore.getState().updateFloatingPastePosition({ x: 10, y: 4 });
      await useAppStore.getState().commitFloatingPaste();
      const moved = useAppStore.getState().layers[0];
      expect(moved.sequentialData!.events).toHaveLength(5);
      const result = await captureSequentialLayerFrameTextures({
        layer: moved, width: 16, height: 16, frameCount: 4,
        cropBounds: cropped ? { x: 4, y: 4, width: 10, height: 8 } : null,
      });
      expect(frames).toHaveLength(4);
      expect(result?.frameMap).toEqual([0, 1, 2, 2]);
      const width = cropped ? 10 : 16;
      const height = cropped ? 8 : 16;
      const expected = new Uint8ClampedArray(width * height * 4);
      const green = new Uint8ClampedArray(width * height * 4);
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const worldX = x + (cropped ? 4 : 0);
          const worldY = y + (cropped ? 4 : 0);
          const sourceCleared = worldX >= 4 && worldX < 8 && worldY >= 4 && worldY < 8;
          const pastedBlue = worldX >= 11 && worldX < 13 && worldY >= 4 && worldY < 8;
          expected.set(sourceCleared ? [0, 0, 0, 0] : pastedBlue ? [0, 0, 255, 255] : [255, 0, 0, 255], (y * width + x) * 4);
          green.set([0, 255, 0, 255], (y * width + x) * 4);
        }
      }
      expect(frames[0]).toEqual(expected);
      expect(frames[1]).toEqual(green);
      expect(frames[2]).toEqual(new Uint8ClampedArray(width * height * 4));
      expect(frames[3]).toEqual(frames[2]);
    } finally {
      jest.restoreAllMocks();
      useAppStore.setState(savedState);
      historyManager.clear();
      clearSequentialLayerRendererAll();
      setFeatureFlag('enableSequentialGpuAcceleration', gpu);
      setFeatureFlag('enableSequentialWorkerMaterialization', worker);
      canvasState.__VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__ = previousRasterize;
    }
  });
});
